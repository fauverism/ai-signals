#!/usr/bin/env node
// Fetches every entry in sources/candidates.json, keeps the ones that return a valid
// feed (or JSON / HTML index for api / html-list), and writes them to sources/sources.json.
// Usage: node scripts/verify-sources.js [--candidates file] [--out file]
// Behind an HTTPS proxy: NODE_USE_ENV_PROXY=1 node scripts/verify-sources.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? path.resolve(process.argv[i + 1]) : fallback;
};
const candidatesFile = arg('--candidates', path.join(root, 'sources/candidates.json'));
const outFile = arg('--out', path.join(root, 'sources/sources.json'));

const UA = 'ai-signal-source-check/0.1 (+https://github.com/fauverism/ai-signals)';
const TIMEOUT_MS = 20000;
const CONCURRENCY = 6;

// What the response actually is: 'rss' | 'atom' | 'api' | 'html-list' | null.
function detect(body, contentType) {
  const head = body.slice(0, 4000);
  if (/<rss[\s>]|<rdf:RDF/i.test(head) && /<item[\s>]/i.test(body)) return 'rss';
  if (/<feed[\s>]/i.test(head) && /<entry[\s>]/i.test(body)) return 'atom';
  if (/json/i.test(contentType) || /^\s*[[{]/.test(body)) {
    try {
      const json = JSON.parse(body);
      const lists = Array.isArray(json) ? [json] : Object.values(json).filter(Array.isArray);
      if (lists.some((l) => l.length > 0)) return 'api';
    } catch {}
    return null;
  }
  if (/html/i.test(contentType) && (body.match(/<a\s[^>]*href=/gi) ?? []).length >= 10) return 'html-list';
  return null;
}

async function fetchOnce(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/json, text/html;q=0.8, */*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', body: await res.text() };
}

async function check(entry) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { status, contentType, body } = await fetchOnce(entry.url);
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const actual = detect(body, contentType);
      if (!actual) throw new Error(`not a valid ${entry.type} (${contentType || 'no content-type'})`);
      return { ok: true, actual };
    } catch (e) {
      lastError = e.cause?.code ?? e.message;
    }
  }
  return { ok: false, reason: lastError };
}

const candidates = JSON.parse(await readFile(candidatesFile, 'utf8'));
const results = new Array(candidates.length);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < candidates.length) {
      const i = next++;
      results[i] = await check(candidates[i]);
    }
  }),
);

const kept = [];
const failed = [];
const retyped = [];
candidates.forEach((entry, i) => {
  const r = results[i];
  if (!r.ok) return failed.push({ id: entry.id, url: entry.url, reason: r.reason });
  if (r.actual !== entry.type) {
    retyped.push(`${entry.id}: ${entry.type} -> ${r.actual}`);
    entry = { ...entry, type: r.actual };
  }
  kept.push(entry);
});

await writeFile(outFile, JSON.stringify(kept, null, 2) + '\n');
const logDir = path.join(root, 'data/logs');
await mkdir(logDir, { recursive: true });
await writeFile(
  path.join(logDir, 'verify-sources.json'),
  JSON.stringify({ checkedAt: new Date().toISOString(), kept: kept.length, failed, retyped }, null, 2) + '\n',
);

console.log(`${kept.length} verified, ${failed.length} failed -> ${path.relative(root, outFile)}`);
if (retyped.length) console.log(`\nRetyped to match the real response:\n  ${retyped.join('\n  ')}`);
if (failed.length) console.log(`\nFailed (dropped):\n${failed.map((f) => `  ${f.id.padEnd(30)} ${f.reason}  ${f.url}`).join('\n')}`);
process.exit(kept.length ? 0 : 1);
