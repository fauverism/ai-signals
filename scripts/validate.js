#!/usr/bin/env node
// Validates every JSON file in the repo that has a schema, plus the fixtures.
// Usage: node scripts/validate.js [file ...]   (no args = discover everything)
import { readFile, readdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { root, schemaErrors } from './lib/schemas.js';
import { semanticErrors } from './lib/semantic.js';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const listJson = async (dir) =>
  (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json')).sort().map((n) => path.join(dir, n));

// Which schema applies to which file, by location and name.
function schemaFor(file) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (/^data\/raw\/[\d-]+\.deduped\.json$/.test(rel)) return 'deduped';
  if (/^data\/raw\/[\d-]+\.json$/.test(rel) || /^schemas\/fixtures\/raw-/.test(rel)) return 'raw-file';
  if (/^data\/work\/[\d-]+\.batch-\d+\.json$/.test(rel)) return 'batch';
  if (/^data\/work\/[\d-]+\.dropped\.json$/.test(rel)) return 'dropped';
  if (/^data\/work\/[\d-]+\.scored-\d+\.json$/.test(rel)) return 'scored';
  if (/^data\/work\/[\d-]+\.dry-edition\.json$/.test(rel)) return 'edition';
  if (/^data\/work\/[\d-]+\.dry-archive\.json$/.test(rel)) return 'archive';
  if (rel.startsWith('data/editions/') || rel === 'data/latest.json' || /^data\/work\/[\d-]+\.dry-latest\.json$/.test(rel) || /^schemas\/fixtures\/edition-/.test(rel)) return 'edition';
  if (rel === 'data/archive.json') return 'archive';
  if (rel === 'sources/sources.json' || rel === 'sources/candidates.json') return 'sources';
  if (rel === 'sources/keywords.json') return 'keywords';
  return null;
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
    ...(await listJson(d('data/work'))).filter((f) => schemaFor(f)),
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
