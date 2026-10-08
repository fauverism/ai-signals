#!/usr/bin/env node
// The publish gate. Checks the latest edition and, unless --offline, that every featured link answers a HEAD request.
//   exit 0  the edition may be published
//   exit 1  it may not (reasons printed, and saved to data/logs/<date>-check.json)
//   exit 2  some featured links were dead: they were dropped, the edition was re-featured and rewritten.
//           Review the editor's note, then run `npm run build` and `npm run check` again.
// Usage: node scripts/gate.js [--date YYYY-MM-DD] [--require] [--offline]
//   --date     the edition must be for this date
//   --require  fail (instead of skipping) when nothing is published yet
//   --offline  skip the link check
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { toUtcIso } from './lib/dates.js';
import { MIN_RANKED, featuredItems, mergeDropped, planDrops, structuralProblems } from './lib/gate.js';
import { checkLinks } from './lib/links.js';
import { root, schemaErrors } from './lib/schemas.js';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
const wantDate = flag('date');
const rel = (p) => path.relative(root, p);
const readJson = (file) => readFile(file, 'utf8').then(JSON.parse, (e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));

const latest = await readJson(path.join(root, 'data/latest.json'));
if (!latest) {
  if (!has('require')) {
    console.log('No published edition yet; nothing to check.');
    process.exit(0);
  }
  console.error('✗ data/latest.json does not exist: no edition was assembled.');
  process.exit(1);
}

const report = { date: latest.date, checkedAt: toUtcIso(new Date()), passed: false, problems: [], links: [], dropped: [] };
const logFile = path.join(root, 'data/logs', `${latest.date}-check.json`);
async function finish(code) {
  report.passed = code === 0;
  await mkdir(path.dirname(logFile), { recursive: true });
  await writeFile(logFile, `${JSON.stringify(report, null, 2)}\n`);
  process.exit(code);
}
const fail = (problems) => {
  report.problems.push(...problems);
  console.error(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'} (the edition must not be published):`);
  for (const p of problems) console.error(`  - ${p}`);
  return finish(1);
};

if (wantDate && latest.date !== wantDate) await fail([`data/latest.json is for ${latest.date}, but this run is for ${wantDate}`]);

const problems = structuralProblems(latest);
if (problems.length) await fail(problems);
console.log(`✓ edition ${latest.date}: schema valid, lead present, ${latest.stats.ranked} ranked (minimum ${MIN_RANKED}), no duplicate URLs`);

if (has('offline')) {
  console.log('  (link check skipped: --offline)');
  await finish(0);
}

// Every featured URL must answer 2xx/3xx to a HEAD request.
const featured = featuredItems(latest);
const results = await checkLinks(featured.map((i) => i.url));
featured.forEach((item, i) => report.links.push({ id: item.id, url: item.url, ...results[i] }));
const { failed, looksBroken } = planDrops(featured, results);
for (const [i, item] of featured.entries()) console.log(`  ${results[i].ok ? '✓' : '✗'} ${String(results[i].status ?? '---').padEnd(3)} ${item.url.slice(0, 90)}${results[i].ok ? '' : `  (${results[i].error})`}`);

if (!failed.length) {
  console.log(`✓ all ${featured.length} featured links answered`);
  await finish(0);
}
if (looksBroken) await fail([`${failed.length} of ${featured.length} featured links failed at once; this looks like a network problem, not dead links, so nothing was dropped`]);

// Drop the dead ones and re-feature from the rest.
const droppedFile = path.join(root, 'data/work', `${latest.date}.dropped.json`);
const doc = mergeDropped(await readJson(droppedFile), latest.date, failed, toUtcIso(new Date()));
const bad = schemaErrors('dropped', doc);
if (bad.length) await fail([`could not record the dropped links: ${bad[0]}`]);
await writeFile(droppedFile, `${JSON.stringify(doc, null, 2)}\n`);
report.dropped = failed;
console.log(`\n${failed.length} dead link${failed.length === 1 ? '' : 's'} dropped (${rel(droppedFile)}); re-featuring…\n`);

const run = spawnSync(process.execPath, [path.join(root, 'scripts/rank.js'), '--assemble', '--date', latest.date], { stdio: 'inherit' });
if (run.status !== 0) await fail([`re-featuring after dropping dead links failed (rank --assemble exited ${run.status})`]);
console.log('\nRE-FEATURED: the featured set changed. Check that the editor\'s note still describes it, then run `npm run build` and `npm run check` again.');
await finish(2);
