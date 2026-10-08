#!/usr/bin/env node
// Validates every JSON file in the repo that has a schema, plus the fixtures.
// Usage: node scripts/validate.js [file ...]   (no args = discover everything)
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { root, schemaErrors } from './lib/schemas.js';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const listJson = async (dir) =>
  (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json')).sort().map((n) => path.join(dir, n));

// Which schema applies to which file, by location and name.
function schemaFor(file) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (rel.startsWith('data/raw/') || /^schemas\/fixtures\/raw-/.test(rel)) return 'raw-file';
  if (rel.startsWith('data/editions/') || rel === 'data/latest.json' || /^schemas\/fixtures\/edition-/.test(rel)) return 'edition';
  if (rel === 'data/archive.json') return 'archive';
  if (rel === 'sources/sources.json' || rel === 'sources/candidates.json') return 'sources';
  if (rel === 'sources/keywords.json') return 'keywords';
  return null;
}

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

// Rules JSON Schema can't express: ids, slots, references, ordering.
function semanticErrors(kind, data, file) {
  const errs = [];
  const checkId = (item, where) => {
    if (item.id !== sha1(item.canonicalUrl)) errs.push(`${where}: id is not the sha1 of canonicalUrl`);
  };
  if (kind === 'raw-file') {
    data.forEach((item, i) => checkId(item, `[${i}]`));
    return errs;
  }
  if (kind === 'sources') {
    const seen = new Set();
    data.forEach((s, i) => {
      if (seen.has(s.id)) errs.push(`[${i}]: duplicate id ${s.id}`);
      seen.add(s.id);
    });
    return errs;
  }
  if (kind === 'keywords') return errs;
  if (kind === 'archive') {
    for (let i = 1; i < data.length; i++) {
      if (data[i - 1].date <= data[i].date) errs.push(`[${i}]: not newest first / duplicate date ${data[i].date}`);
    }
    return errs;
  }

  // edition
  const stamp = path.basename(file).match(/(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
  if (stamp && stamp !== data.date) errs.push(`date ${data.date} does not match filename ${stamp}`);

  const pool = new Map();
  const add = (item, where, slot) => {
    checkId(item, where);
    if (slot && item.featuredSlot !== slot) errs.push(`${where}: featuredSlot is ${item.featuredSlot}, expected ${slot}`);
    pool.set(item.id, item);
  };
  add(data.lead, 'lead', 'lead');
  data.top.forEach((it, i) => add(it, `top[${i}]`, 'top'));
  data.innovations.forEach((it, i) => add(it, `innovations[${i}]`, 'innovation'));
  for (const [cat, items] of Object.entries(data.byCategory)) {
    items.forEach((it, i) => {
      add(it, `byCategory.${cat}[${i}]`);
      if (it.category !== cat) errs.push(`byCategory.${cat}[${i}]: category is ${it.category}`);
    });
  }
  if (new Set(data.top.map((it) => it.id)).size !== data.top.length) errs.push('top: duplicate items');
  data.trending.forEach((c, i) => {
    for (const id of c.itemIds) if (!pool.has(id)) errs.push(`trending[${i}]: itemId ${id} not found in this edition`);
    if (!c.itemIds.includes(c.leadItemId)) errs.push(`trending[${i}]: leadItemId is not in itemIds`);
  });
  const { collected, afterDedupe, ranked } = data.stats;
  if (!(collected >= afterDedupe && afterDedupe >= ranked)) errs.push('stats: need collected >= afterDedupe >= ranked');
  return errs;
}

async function validateFile(file) {
  const kind = schemaFor(file);
  if (!kind) return [`no schema is mapped to ${path.relative(root, file)}`];
  let data;
  try {
    data = await readJson(file);
  } catch (e) {
    return [`invalid JSON: ${e.message}`];
  }
  const errors = schemaErrors(kind, data);
  if (errors.length) return errors;
  return semanticErrors(kind, data, file);
}

async function discover() {
  const d = (p) => path.join(root, p);
  const files = [
    ...(await listJson(d('schemas/fixtures'))),
    ...(await listJson(d('data/raw'))),
    ...(await listJson(d('data/editions'))),
  ];
  for (const f of ['data/latest.json', 'data/archive.json', 'sources/sources.json', 'sources/candidates.json', 'sources/keywords.json']) {
    if (await readFile(d(f)).then(() => true, () => false)) files.push(d(f));
  }
  return files;
}

// data/latest.json must be an exact copy of the newest edition.
async function latestMismatch() {
  const editions = await listJson(path.join(root, 'data/editions'));
  const latest = path.join(root, 'data/latest.json');
  if (!editions.length || !(await readFile(latest).then(() => true, () => false))) return null;
  const newest = editions.at(-1);
  return isDeepStrictEqual(await readJson(newest), await readJson(latest))
    ? null
    : `data/latest.json differs from ${path.relative(root, newest)}`;
}

const args = process.argv.slice(2).map((a) => path.resolve(a));
const files = args.length ? args : await discover();
let failed = 0;

for (const file of files) {
  const errors = await validateFile(file);
  const rel = path.relative(root, file);
  if (errors.length) {
    failed++;
    console.log(`✗ ${rel}`);
    errors.forEach((e) => console.log(`    ${e}`));
  } else {
    console.log(`✓ ${rel}  (${schemaFor(file)})`);
  }
}
if (!args.length) {
  const mismatch = await latestMismatch();
  if (mismatch) {
    failed++;
    console.log(`✗ ${mismatch}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} passed`);
process.exit(failed ? 1 : 0);
