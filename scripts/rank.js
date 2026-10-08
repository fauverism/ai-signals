#!/usr/bin/env node
// Ranking pipeline. The judging is done by Claude Code between --prepare and --assemble (see prompts/rank-run.md);
// this script only does the deterministic work around it.
//   npm run rank -- --prepare   write data/work/<date>.batch-N.json from the deduped file
//   npm run rank -- --assemble  merge data/work/<date>.scored-N.json, recompute totals, apply the featuring
//                               rules, write the Edition, latest.json and archive.json
//   npm run rank -- --validate  after Claude writes the editor's note: re-check everything, sync latest/archive
// Options: --date YYYY-MM-DD  --batch-size 30  --dry-run (write data/work/<date>.dry-*.json instead of the real files)
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { editionDate, toUtcIso } from './lib/dates.js';
import {
  EDITOR_NOTE_PLACEHOLDER, MAX_FETCHES, archiveEntry, buildEdition, buildRankedItem, editionItems, editionProblems,
  makeBatches, trendBaseline, upsertArchive,
} from './lib/rank.js';
import { root, schemaErrors } from './lib/schemas.js';
import { semanticErrors } from './lib/semantic.js';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};

const modes = ['prepare', 'assemble', 'validate'].filter(has);
if (modes.length !== 1) {
  console.error('Usage: npm run rank -- (--prepare | --assemble | --validate) [--date YYYY-MM-DD] [--batch-size 30] [--dry-run]');
  process.exit(2);
}
const mode = modes[0];
const date = flag('date') ?? editionDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail([`--date must be YYYY-MM-DD, got "${date}"`]);
const batchSize = Number(flag('batch-size') ?? 30);
const dry = has('dry-run');

const rel = (p) => path.relative(root, p);
const file = (...p) => path.join(root, ...p);
const paths = {
  deduped: file('data/raw', `${date}.deduped.json`),
  workDir: file('data/work'),
  edition: dry ? file('data/work', `${date}.dry-edition.json`) : file('data/editions', `${date}.json`),
  latest: dry ? file('data/work', `${date}.dry-latest.json`) : file('data/latest.json'),
  archive: dry ? file('data/work', `${date}.dry-archive.json`) : file('data/archive.json'),
  realArchive: file('data/archive.json'),
  log: file('data/logs', `${date}.rank.json`),
};

function fail(problems) {
  console.error(`\n✗ ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const readJson = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (e.code === 'ENOENT') fail([`${rel(p)} not found`]);
    return fail([`cannot parse ${rel(p)}: ${e.message}`]);
  }
};

async function writeJson(p, data) {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(`${p}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
  await rename(`${p}.tmp`, p);
}

/** Schema + semantic problems for a data file, labelled with its path. */
function check(kind, data, p) {
  const errs = schemaErrors(kind, data);
  return (errs.length ? errs : semanticErrors(kind, data, p)).map((e) => `${rel(p)}: ${e}`);
}

const workFiles = async (re) => {
  const names = (await readdir(paths.workDir).catch(() => [])).filter((n) => re.test(n));
  return names.sort((a, b) => Number(a.match(/-(\d+)\.json$/)[1]) - Number(b.match(/-(\d+)\.json$/)[1]));
};

// --- prepare ---------------------------------------------------------------------------------

async function prepare() {
  const deduped = await readJson(paths.deduped);
  const problems = check('deduped', deduped, paths.deduped);
  if (problems.length) fail(problems);

  const clusters = new Map(deduped.clusters.map((c) => [c.id, c]));
  const batches = makeBatches(deduped.items, batchSize);

  for (const old of await workFiles(new RegExp(`^${date}\\.batch-\\d+\\.json$`))) await rm(path.join(paths.workDir, old));
  const stale = await workFiles(new RegExp(`^${date}\\.scored-\\d+\\.json$`));
  if (stale.length) console.warn(`warning: ${stale.length} scored file(s) already exist for ${date} and may not match the new batches: ${stale.join(', ')}`);

  console.log(`Edition ${date}: ${deduped.items.length} candidates -> ${batches.length} batches`);
  for (const [i, items] of batches.entries()) {
    const ids = new Set(items.map((x) => x.clusterId).filter(Boolean));
    const batch = {
      date,
      batch: i + 1,
      of: batches.length,
      clusters: [...ids].map((id) => ({ id, label: clusters.get(id).label, size: clusters.get(id).size, sources: clusters.get(id).sources, trendDelta: clusters.get(id).trendDelta })),
      items: items.map((x) => ({
        id: x.id,
        title: x.title,
        source: x.source,
        sourceTier: x.sourceTier,
        url: x.url,
        author: x.author,
        publishedAt: x.publishedAt,
        categoryHint: x.categoryHint,
        signals: x.signals,
        trendDelta: x.trendDelta,
        trendBaseline: trendBaseline(x),
        previouslyFeatured: x.previouslyFeatured,
        clusterId: x.clusterId,
        clusterLabel: x.clusterId ? clusters.get(x.clusterId).label : null,
      })),
    };
    const out = path.join(paths.workDir, `${date}.batch-${i + 1}.json`);
    const bad = check('batch', batch, out);
    if (bad.length) fail(bad);
    await writeJson(out, batch);
    console.log(`  ${rel(out)}  ${String(items.length).padStart(3)} items, ${ids.size} cluster${ids.size === 1 ? '' : 's'}`);
  }
  console.log('\nNext: follow prompts/rank-run.md to write the scored files, then run --assemble.');
}

// --- publish (shared by assemble and validate) -------------------------------------------------

async function publish(edition) {
  const problems = [];
  const messages = [];

  const archiveBase = (await readJson(paths.archive, null)) ?? (await readJson(paths.realArchive, []));
  const archive = upsertArchive(archiveBase, archiveEntry(edition));
  problems.push(...check('archive', archive, paths.archive));

  const existingLatest = await readJson(paths.latest, null);
  const updateLatest = !existingLatest || existingLatest.date <= edition.date;
  if (!updateLatest) messages.push(`${rel(paths.latest)} is from ${existingLatest.date}, newer than ${edition.date}; left alone`);
  if (problems.length) return { problems, messages };

  if (updateLatest) await writeJson(paths.latest, edition);
  await writeJson(paths.archive, archive);
  messages.push(`${rel(paths.archive)}: ${archive.length} edition${archive.length === 1 ? '' : 's'}`);
  if (updateLatest) messages.unshift(`${rel(paths.latest)} updated`);
  return { problems, messages };
}

// --- assemble --------------------------------------------------------------------------------

async function assemble() {
  const deduped = await readJson(paths.deduped);
  const dedupedProblems = check('deduped', deduped, paths.deduped);
  if (dedupedProblems.length) fail(dedupedProblems);
  const byId = new Map(deduped.items.map((i) => [i.id, i]));

  const problems = [];
  const notes = [];

  // Batches define what must be judged.
  const batchNames = await workFiles(new RegExp(`^${date}\\.batch-\\d+\\.json$`));
  if (!batchNames.length) fail([`no batch files for ${date}; run --prepare first`]);
  const expected = new Map(); // id -> batch number
  for (const name of batchNames) {
    const b = await readJson(path.join(paths.workDir, name));
    for (const item of b.items) expected.set(item.id, b.batch);
  }

  // Scored files.
  const scoredNames = await workFiles(new RegExp(`^${date}\\.scored-\\d+\\.json$`));
  const judged = new Map();
  const skipped = new Map();
  const labels = new Map();
  const fetches = [];
  for (const name of scoredNames) {
    const p = path.join(paths.workDir, name);
    const s = await readJson(p);
    const bad = check('scored', s, p);
    if (bad.length) {
      problems.push(...bad);
      continue;
    }
    const n = Number(name.match(/-(\d+)\.json$/)[1]);
    if (s.batch !== n) problems.push(`${rel(p)}: "batch" is ${s.batch} but the file is batch ${n}`);
    for (const j of s.items) {
      if (expected.get(j.id) !== n) problems.push(`${rel(p)}: ${j.id} is not in batch ${n}`);
      else if (judged.has(j.id) || skipped.has(j.id)) problems.push(`${rel(p)}: ${j.id} appears more than once`);
      else judged.set(j.id, j);
    }
    for (const k of s.skipped) {
      if (expected.get(k.id) !== n) problems.push(`${rel(p)}: skipped id ${k.id} is not in batch ${n}`);
      else if (judged.has(k.id) || skipped.has(k.id)) problems.push(`${rel(p)}: ${k.id} appears more than once`);
      else skipped.set(k.id, k.reason);
    }
    for (const l of s.clusterLabels) labels.set(l.id, l.label);
    fetches.push(...(s.fetches ?? []));
  }
  if (fetches.length > MAX_FETCHES) problems.push(`${fetches.length} source fetches recorded; the limit is ${MAX_FETCHES}`);

  const missing = [...expected.keys()].filter((id) => !judged.has(id) && !skipped.has(id));
  if (missing.length) {
    const nums = [...new Set(missing.map((id) => expected.get(id)))].sort((a, b) => a - b);
    problems.push(`${missing.length} item(s) are neither scored nor skipped (batches ${nums.join(', ')}): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
  }

  // Build ranked items.
  const entries = [];
  const adjustments = [];
  for (const [id, j] of judged) {
    const d = byId.get(id);
    const built = buildRankedItem(d, j);
    problems.push(...built.problems);
    notes.push(...built.notes);
    if (built.item.scores.trend !== trendBaseline(d)) adjustments.push({ id, from: trendBaseline(d), to: built.item.scores.trend, reason: j.trendReason ?? null });
    entries.push({ item: built.item, org: built.org, clusterId: d.clusterId });
  }
  if (problems.length) fail(problems);

  // Cluster records limited to the items that survived scoring.
  const clusters = deduped.clusters.map((c) => ({ ...c }));
  const prior = await readJson(paths.edition, null);
  const keptNote = prior && prior.editorNote !== EDITOR_NOTE_PLACEHOLDER ? prior.editorNote : null;

  const { edition, errors, notes: featuringNotes } = buildEdition(entries, {
    date,
    generatedAt: toUtcIso(new Date()),
    editorNote: keptNote ?? EDITOR_NOTE_PLACEHOLDER,
    clusters,
    labels,
    stats: { collected: deduped.stats.before, afterDedupe: deduped.stats.afterNearDup, ranked: entries.length },
  });
  notes.push(...featuringNotes);
  if (errors.length) fail(errors);

  const editionErrors = check('edition', edition, paths.edition);
  if (editionErrors.length) fail(editionErrors);

  await writeJson(paths.edition, edition);
  const published = await publish(edition);
  if (published.problems.length) fail(published.problems);

  await writeJson(paths.log, {
    date,
    generatedAt: edition.generatedAt,
    dryRun: dry,
    scored: entries.length,
    skipped: [...skipped].map(([id, reason]) => ({ id, reason })),
    trendAdjustments: adjustments,
    fetches,
    notes,
  });

  // Report.
  const line = (e) => `  ${String(e.scores.importance).padStart(2)} ${String(e.scores.trend).padStart(2)} ${String(e.scores.novelty).padStart(2)} ${String(e.scores.credibility).padStart(2)}  ${e.total.toFixed(1).padStart(4)}  ${e.title.slice(0, 70)}  [${e.source}]`;
  console.log(`Edition ${date}${dry ? ' (dry run)' : ''}: ${entries.length} scored, ${skipped.size} skipped, ${editionItems(edition).length} listed`);
  console.log('\n  Imp Tr Nov Cr  Total');
  console.log('LEAD');
  console.log(line(edition.lead));
  console.log('TOP');
  edition.top.forEach((i) => console.log(line(i)));
  console.log('INNOVATIONS');
  if (!edition.innovations.length) console.log('  (no further items with novelty >= 8)');
  edition.innovations.forEach((i) => console.log(line(i)));
  console.log('TRENDING');
  if (!edition.trending.length) console.log('  (no clusters)');
  edition.trending.forEach((c) => console.log(`  ${c.label}  (${c.itemIds.length} items, ${c.sources.length} sources)`));
  if (notes.length) console.log(`\nNotes:\n${notes.map((n) => `  - ${n}`).join('\n')}`);
  published.messages.forEach((m) => console.log(m));
  console.log(`Wrote ${rel(paths.edition)}`);
  console.log(keptNote ? "Kept the existing editor's note." : `\nNext: write the editor's note into ${rel(paths.edition)}, then run --validate.`);
}

// --- validate --------------------------------------------------------------------------------

async function validate() {
  const edition = await readJson(paths.edition);
  const schemaProblems = schemaErrors('edition', edition).map((e) => `${rel(paths.edition)}: ${e}`);
  if (schemaProblems.length) fail(schemaProblems);
  const problems = [...semanticErrors('edition', edition, paths.edition).map((e) => `${rel(paths.edition)}: ${e}`), ...editionProblems(edition)];
  if (problems.length) fail(problems);

  const published = await publish(edition);
  if (published.problems.length) fail(published.problems);
  console.log(`✓ ${rel(paths.edition)} is valid (${editionItems(edition).length} items, lead: ${edition.lead.title.slice(0, 60)})`);
  published.messages.forEach((m) => console.log(`✓ ${m}`));
}

await { prepare, assemble, validate }[mode]();
