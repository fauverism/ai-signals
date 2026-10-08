#!/usr/bin/env node
// Assembles what gets deployed into dist/: the contents of /site at the root, plus the published data at /data
// (the pages fetch "../data/", which from the site root is /data/). Only the edition files go out; the raw,
// work and log folders stay in the repo. Node built-ins only, so the host needs no `npm install`.
//   node scripts/bundle.js [--out dist]
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { root } from './lib/schemas.js';

export const PUBLISHED_DATA = ['latest.json', 'archive.json', 'editions'];

const argv = process.argv.slice(2);
const out = path.resolve(root, argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'dist');
if (out === root || !out.startsWith(root + path.sep)) {
  console.error('✗ --out must be a folder inside the repository.');
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'data'), { recursive: true });
const skipDocs = (src) => path.basename(src) !== 'README.md'; // folder notes stay in the repo
await cp(path.join(root, 'site'), out, { recursive: true, filter: skipDocs });
for (const name of PUBLISHED_DATA) await cp(path.join(root, 'data', name), path.join(out, 'data', name), { recursive: true, filter: skipDocs });
console.log(`Bundled site/ and ${PUBLISHED_DATA.map((n) => `data/${n}`).join(', ')} into ${path.relative(root, out)}/`);
