#!/usr/bin/env node
// Dedupes, clusters and pre-scores data/raw/<edition-date>.json -> data/raw/<edition-date>.deduped.json.
// Usage: node scripts/dedupe.js [--date YYYY-MM-DD] [--cap 150] [--per-source-cap N]
// Deterministic: same raw file and same recent editions give the same result.
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULTS, dedupe } from './lib/dedupe.js';
import { editionDate, toUtcIso } from './lib/dates.js';
import { root, schemaErrors } from './lib/schemas.js';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};

const date = flag('date') ?? editionDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date must be YYYY-MM-DD, got "${date}"`);
const cap = Number(flag('cap') ?? DEFAULTS.cap);
const perSourceCap = flag('per-source-cap') == null ? null : Number(flag('per-source-cap'));
const LOOKBACK = 7;

const rawFile = path.join(root, 'data/raw', `${date}.json`);
const outFile = path.join(root, 'data/raw', `${date}.deduped.json`);
const editionsDir = path.join(root, 'data/editions');

const raw = JSON.parse(await readFile(rawFile, 'utf8').catch(() => {
  throw new Error(`${path.relative(root, rawFile)} not found; run "npm run collect" first`);
}));

// The most recent editions before this date.
const names = (await readdir(editionsDir).catch(() => []))
  .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n) && n.slice(0, 10) < date)
  .sort()
  .slice(-LOOKBACK);
const editions = [];
for (const name of names) {
  try {
    editions.push({ date: name.slice(0, 10), edition: JSON.parse(await readFile(path.join(editionsDir, name), 'utf8')) });
  } catch (e) {
    console.warn(`skipping unreadable edition ${name}: ${e.message}`);
  }
}

const { items, clusters, allClusters, stats } = dedupe(raw, { editions, cap, perSourceCap });
const result = {
  date,
  generatedAt: toUtcIso(new Date()),
  params: { ...DEFAULTS, cap, perSourceCap },
  stats,
  items,
  clusters: clusters.map(({ id, label, itemIds, leadItemId, sources, size, entities, trendDelta }) => ({
    id, label, itemIds, leadItemId, sources, size, entities, trendDelta,
  })),
};

const problems = schemaErrors('deduped', result);
if (problems.length) throw new Error(`refusing to write an invalid file: ${problems.slice(0, 3).join('; ')}`);
await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(`${outFile}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
await rename(`${outFile}.tmp`, outFile);

// Report.
const tiers = items.reduce((m, i) => ((m[i.sourceTier] = (m[i.sourceTier] ?? 0) + 1), m), {});
console.log(`Edition ${date}  (history: ${stats.priorEditions} prior edition${stats.priorEditions === 1 ? '' : 's'})`);
console.log(`  raw items              ${String(stats.before).padStart(5)}`);
console.log(`  after exact URL dedupe ${String(stats.afterExact).padStart(5)}   (-${stats.before - stats.afterExact})`);
console.log(`  after near-dup titles  ${String(stats.afterNearDup).padStart(5)}   (-${stats.afterExact - stats.afterNearDup})`);
console.log(`  clusters (2+ stories)  ${String(stats.clusters).padStart(5)}`);
console.log(`  sent to ranking        ${String(stats.afterCap).padStart(5)}   (cap ${cap}${perSourceCap ? `, max ${perSourceCap}/source` : ''}; by tier: ${Object.entries(tiers).map(([t, n]) => `T${t}=${n}`).join(' ')})`);
console.log(`  -> ${path.relative(root, outFile)}\n`);
console.log('10 largest clusters (stories / distinct sources; "kept" = stories inside the ranking cap):');
for (const c of allClusters.slice(0, 10)) {
  const trend = c.trendDelta == null ? 'n/a' : (c.trendDelta > 0 ? '+' : '') + c.trendDelta;
  console.log(`  ${String(c.size).padStart(2)} stories, ${String(c.sources.length).padStart(2)} sources, kept ${c.kept}, trend ${trend}  ${c.label}`);
  console.log(`      entities: ${c.entities.join(', ') || '-'}`);
}
if (!allClusters.length) console.log('  (none)');
