#!/usr/bin/env node
// Generates the files that depend on the published editions:
//   site/feed.xml          RSS 2.0: lead + top 5 + innovations of the last 7 editions, linking to the originals
//   site/sitemap.xml       static pages plus one URL per edition
//   site/search-index.json compact index of the last 30 editions, loaded lazily by the archive search
//   site/og/<date>.png     1200x630 social preview (date + lead headline); older ones are pruned
//   site/index.html        Open Graph / Twitter tags between the og-meta markers, from latest.json
// Usage: node scripts/build.js [--check] [--dry] [--data <dir>] [--out <dir>]
//   --check  write nothing; exit 1 if any generated file is stale (skips when nothing is published yet)
//   --dry    build from the newest data/work/*.dry-* edition into data/work/dry-site (preview with `npm run serve -- --dry`)
//   --data   directory holding latest.json, archive.json, editions/ (default: data)
//   --out    where to write (default: site)
// The site URL comes from site/config.js (SITE_URL), or the SITE_URL environment variable.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SITE_URL as CONFIG_SITE_URL, SUBSCRIBE_HEADLINE } from '../site/config.js';
import { renderOg } from './lib/og.js';
import { schemaErrors, root } from './lib/schemas.js';
import { OG_KEEP, SEARCH_EDITIONS, buildFeed, buildSearchIndex, buildSitemap, longDate, ogImagePath, ogMeta, stampOgMeta } from './lib/site-build.js';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};

const check = has('check');
const dry = has('dry');
const siteDir = path.join(root, 'site');
const dataDir = path.resolve(flag('data') ?? path.join(root, 'data'));
const outDir = path.resolve(flag('out') ?? (dry ? path.join(root, 'data/work/dry-site') : siteDir));
const siteUrl = (process.env.SITE_URL ?? CONFIG_SITE_URL).replace(/\/+$/, '');
const rel = (p) => path.relative(root, p);

const readJson = async (file, fallback) => {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`cannot read ${rel(file)}: ${e.message}`);
  }
};

/** The published editions, newest first, plus the archive list. */
async function load() {
  if (dry) {
    const work = path.join(root, 'data/work');
    const latestFiles = (await readdir(work).catch(() => [])).filter((n) => n.endsWith('.dry-latest.json')).sort();
    if (!latestFiles.length) return null;
    const date = latestFiles.at(-1).slice(0, 10);
    const latest = await readJson(path.join(work, `${date}.dry-latest.json`));
    return { latest, archive: await readJson(path.join(work, `${date}.dry-archive.json`), []), editions: [latest] };
  }
  const latest = await readJson(path.join(dataDir, 'latest.json'), null);
  if (!latest) return null;
  const archive = await readJson(path.join(dataDir, 'archive.json'), []);
  const editions = [];
  for (const { date } of archive.slice(0, SEARCH_EDITIONS)) {
    if (date === latest.date) editions.push(latest);
    else {
      const e = await readJson(path.join(dataDir, 'editions', `${date}.json`), null);
      if (e) editions.push(e);
      else console.warn(`warning: archive lists ${date} but ${rel(path.join(dataDir, 'editions', `${date}.json`))} is missing; skipped`);
    }
  }
  if (!editions.some((e) => e.date === latest.date)) editions.unshift(latest);
  return { latest, archive, editions: editions.sort((a, b) => b.date.localeCompare(a.date)) };
}

const data = await load();
if (!data) {
  console.log(check ? 'No published edition yet; nothing to check.' : 'No published edition found. Run the ranking pipeline first (see prompts/rank-run.md).');
  process.exit(check ? 0 : 1);
}

const problems = [];
for (const e of data.editions) for (const err of schemaErrors('edition', e)) problems.push(`edition ${e.date}: ${err}`);
for (const err of schemaErrors('archive', data.archive)) problems.push(`archive: ${err}`);
if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) in the input data:\n${problems.slice(0, 8).map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}

const { latest, archive, editions } = data;
const outputs = {
  'feed.xml': buildFeed({ siteUrl, editions }),
  'sitemap.xml': buildSitemap({ siteUrl, archive: archive.length ? archive : [{ date: latest.date }], latestDate: latest.date }),
  'search-index.json': JSON.stringify(buildSearchIndex(editions)),
};
const indexHtml = stampOgMeta(await readFile(path.join(siteDir, 'index.html'), 'utf8'), ogMeta({ siteUrl, edition: latest }));
outputs['index.html'] = indexHtml;

const png = path.join(outDir, ogImagePath(latest.date));
let stale = 0;

if (check) {
  for (const [name, text] of Object.entries(outputs)) {
    const current = await readFile(path.join(outDir, name), 'utf8').catch(() => null);
    const ok = current === text;
    if (!ok) stale++;
    console.log(`${ok ? '✓' : '✗'} ${rel(path.join(outDir, name))}${ok ? '' : current === null ? ' is missing; run "npm run build"' : ' is out of date; run "npm run build"'}`);
  }
  const hasPng = await readFile(png).then(() => true, () => false);
  if (!hasPng) stale++;
  console.log(`${hasPng ? '✓' : '✗'} ${rel(png)}${hasPng ? '' : ' is missing; run "npm run build"'}`);
  process.exit(stale ? 1 : 0);
}

await mkdir(path.dirname(png), { recursive: true });
for (const [name, text] of Object.entries(outputs)) {
  await mkdir(path.dirname(path.join(outDir, name)), { recursive: true });
  await writeFile(path.join(outDir, name), text);
}
await writeFile(png, renderOg({ dateLabel: longDate(latest.date), headline: latest.lead.title, tagline: SUBSCRIBE_HEADLINE }));

// Keep the newest few preview images; each day has its own URL so link previews don't go stale.
const images = (await readdir(path.join(outDir, 'og')).catch(() => [])).filter((n) => /^\d{4}-\d{2}-\d{2}\.png$/.test(n)).sort().reverse();
for (const old of images.slice(OG_KEEP)) await rm(path.join(outDir, 'og', old));

const feedCount = (outputs['feed.xml'].match(/<item>/g) ?? []).length;
console.log(`Built from edition ${latest.date} (${editions.length} edition${editions.length === 1 ? '' : 's'} loaded)${dry ? ' [dry run]' : ''}`);
console.log(`  ${rel(path.join(outDir, 'feed.xml'))}          ${feedCount} items from ${Math.min(editions.length, 7)} edition(s)`);
console.log(`  ${rel(path.join(outDir, 'sitemap.xml'))}       ${(outputs['sitemap.xml'].match(/<url>/g) ?? []).length} URLs`);
console.log(`  ${rel(path.join(outDir, 'search-index.json'))} ${JSON.parse(outputs['search-index.json']).length} items, ${(Buffer.byteLength(outputs['search-index.json']) / 1024).toFixed(0)} KB`);
console.log(`  ${rel(png)}  1200x630`);
console.log(`  ${rel(path.join(outDir, 'index.html'))}        Open Graph / Twitter tags for "${latest.lead.title.slice(0, 50)}"`);
if (siteUrl.includes('YOUR_DOMAIN')) console.log('\nnote: SITE_URL is still the placeholder (site/config.js); the feed, sitemap and preview image URLs will not resolve yet.');
