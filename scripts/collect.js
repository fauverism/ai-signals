#!/usr/bin/env node
// Fetches every enabled source and writes data/raw/<edition-date>.json (metadata only, no body text).
// Usage: node scripts/collect.js [--date YYYY-MM-DD] [--hours 36]
//   Window length can also come from COLLECT_WINDOW_HOURS. Behind an HTTPS proxy: NODE_USE_ENV_PROXY=1.
// One failing source never fails the run; problems go to data/logs/<edition-date>.json.
// robots.txt is honored for feeds. API sources (Algolia, GitHub) are governed by their published terms.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { adapterFor } from './adapters/index.js';
import { editionDate, isInWindow, toUtcIso } from './lib/dates.js';
import { parseFeed } from './lib/feed.js';
import { createHttp } from './lib/http.js';
import { createKeywordFilter } from './lib/keywords.js';
import { buildRawItem } from './lib/raw-item.js';
import { root, schemaErrors } from './lib/schemas.js';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};

const now = new Date();
const date = flag('date') ?? editionDate(now);
const windowHours = Number(flag('hours') ?? process.env.COLLECT_WINDOW_HOURS ?? 36);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date must be YYYY-MM-DD, got "${date}"`);
if (!(windowHours > 0)) throw new Error(`window hours must be a positive number, got "${windowHours}"`);

const paths = {
  sources: path.join(root, 'sources/sources.json'),
  keywords: path.join(root, 'sources/keywords.json'),
  cache: path.join(root, 'data/cache/http.json'),
  raw: path.join(root, 'data/raw', `${date}.json`),
  log: path.join(root, 'data/logs', `${date}.json`),
};

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`cannot read ${path.relative(root, file)}: ${e.message}`);
  }
};

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, file);
}

const sources = (await readJson(paths.sources)).filter((s) => s.enabled);
const matchesTopic = createKeywordFilter(await readJson(paths.keywords));
// Bump when feed parsing changes: cached parses from an older parser are discarded.
const PARSER_VERSION = 2;
const loaded = await readJson(paths.cache, { entries: {} });
const cache = loaded.parserVersion === PARSER_VERSION ? loaded : { entries: {} };
cache.parserVersion = PARSER_VERSION;
const http = createHttp();
const ctx = { now, windowHours };

/** Feed sources: conditional GET, falling back to the cached parse on 304. */
async function fetchFeed(source) {
  if (!(await http.robotsAllows(source.url))) return { blocked: true };
  const cached = cache.entries[source.url];
  const headers = {
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  };
  if (cached?.items) {
    if (cached.etag) headers['if-none-match'] = cached.etag;
    if (cached.lastModified) headers['if-modified-since'] = cached.lastModified;
  }
  const res = await http.get(source.url, { headers });
  const fetchedAt = toUtcIso(new Date());
  if (res.status === 304 && cached?.items) {
    cached.checkedAt = fetchedAt;
    return { items: cached.items, fetchedAt, status: 'cached' };
  }
  const items = parseFeed(res.text);
  cache.entries[source.url] = {
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    checkedAt: fetchedAt,
    items,
  };
  return { items, fetchedAt, status: 'ok' };
}

/** API sources: a typed adapter per host builds the request and maps the JSON. */
async function fetchApi(source) {
  const adapter = adapterFor(source.url);
  if (!adapter) throw new Error(`no adapter for ${new URL(source.url).hostname}`);
  const { url, headers } = adapter.request(source, ctx);
  const res = await http.get(url, { headers: { accept: 'application/json', ...headers } });
  return { items: adapter.parse(JSON.parse(res.text)), fetchedAt: toUtcIso(new Date()), status: 'ok' };
}

async function runSource(source) {
  const row = { id: source.id, tier: source.tier, status: 'ok', fetched: 0, kept: 0, errors: 0, notes: [] };
  const raw = [];
  try {
    if (source.type === 'html-list') {
      row.status = 'skipped';
      row.notes.push('html-list sources are not supported yet');
      return { row, raw };
    }
    const result = source.type === 'api' ? await fetchApi(source) : await fetchFeed(source);
    if (result.blocked) {
      row.status = 'robots';
      row.notes.push('disallowed by robots.txt');
      return { row, raw };
    }
    row.status = result.status;
    row.fetched = result.items.length;
    for (const item of result.items) {
      if (!isInWindow(item.publishedAt, now, windowHours)) continue;
      if (source.tier === 3 && !matchesTopic(item.title)) continue;
      try {
        const rawItem = buildRawItem(source, item, result.fetchedAt);
        const problems = schemaErrors('raw-item', rawItem);
        if (problems.length) throw new Error(`${problems[0]} (${rawItem.canonicalUrl})`);
        raw.push(rawItem);
      } catch (e) {
        row.errors++;
        if (row.notes.length < 3) row.notes.push(e.message);
      }
    }
    row.kept = raw.length;
  } catch (e) {
    row.status = 'error';
    row.errors++;
    row.notes.push(e.name === 'TimeoutError' ? 'timed out' : (e.cause?.code ?? e.message));
  }
  return { row, raw };
}

const startedAt = toUtcIso(new Date());
const results = await Promise.all(sources.map(runSource));
const rows = results.map((r) => r.row);

const items = results
  .flatMap((r) => r.raw)
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));

const problems = schemaErrors('raw-file', items);
if (problems.length) throw new Error(`refusing to write an invalid raw file: ${problems[0]}`);

// Keep cache entries only for feeds still in the registry.
const liveUrls = new Set(sources.map((s) => s.url));
cache.entries = Object.fromEntries(Object.entries(cache.entries).filter(([url]) => liveUrls.has(url)));
await writeJson(paths.cache, cache);
await writeJson(paths.raw, items);
await writeJson(paths.log, {
  date,
  startedAt,
  finishedAt: toUtcIso(new Date()),
  windowHours,
  totals: {
    sources: rows.length,
    fetched: rows.reduce((n, r) => n + r.fetched, 0),
    kept: items.length,
    errors: rows.reduce((n, r) => n + r.errors, 0),
  },
  sources: rows,
});

// Per-source table.
const pad = (s, n) => String(s).padEnd(n);
const num = (n, w) => String(n).padStart(w);
const idWidth = Math.max(6, ...rows.map((r) => r.id.length));
console.log(`${pad('source', idWidth)}  tier  ${pad('status', 8)} fetched    kept  errors  notes`);
for (const r of rows) {
  const note = r.notes.join('; ');
  console.log(
    `${pad(r.id, idWidth)}  ${num(r.tier, 4)}  ${pad(r.status, 8)} ${num(r.fetched, 7)} ${num(r.kept, 7)} ${num(r.errors, 7)}  ${note.length > 70 ? `${note.slice(0, 69)}…` : note}`,
  );
}
const total = (k) => rows.reduce((n, r) => n + r[k], 0);
console.log(`${pad('TOTAL', idWidth)}  ${num('', 4)}  ${pad('', 8)} ${num(total('fetched'), 7)} ${num(total('kept'), 7)} ${num(total('errors'), 7)}`);
console.log(`\nEdition ${date}, last ${windowHours}h: ${items.length} items -> ${path.relative(root, paths.raw)}`);
console.log(`Log: ${path.relative(root, paths.log)}`);
