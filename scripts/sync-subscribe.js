#!/usr/bin/env node
// Writes the static, no-JavaScript fallbacks for the newsletter forms (and the share metadata on
// subscribe.html) into the site's HTML, from site/config.js.
//   npm run sync     rewrite the generated blocks
//   npm run check    (runs this with --check) fails if any block is out of date
// With JavaScript, site/components/subscribe.js renders the forms from the same config at load time.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUTTONDOWN_USERNAME } from '../site/config.js';
import { PLACEHOLDER_USERNAME, subscribeMarkup, subscribeMeta } from '../site/components/subscribe.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PAGES = ['index.html', 'edition.html', 'archive.html', 'about.html', 'methodology.html', 'subscribe.html'];

const indent = (text, pad) => text.split('\n').map((line) => (line ? pad + line : line)).join('\n');

/** Returns the page with every generated block rebuilt from the current config. */
export function stamp(html) {
  const slot = /^([ \t]*)<div class="subscribe-slot" data-subscribe="(\w+)">\n([ \t]*)<!-- subscribe-fallback:start -->[\s\S]*?<!-- subscribe-fallback:end -->/gm;
  const withForms = html.replace(slot, (_, outer, variant, pad) => {
    const body = `<noscript>\n${indent(subscribeMarkup(variant), '  ')}\n</noscript>`;
    return `${outer}<div class="subscribe-slot" data-subscribe="${variant}">\n${pad}<!-- subscribe-fallback:start -->\n${indent(body, pad)}\n${pad}<!-- subscribe-fallback:end -->`;
  });
  const meta = /^([ \t]*)<!-- subscribe-meta:start -->[\s\S]*?<!-- subscribe-meta:end -->/gm;
  return withForms.replace(meta, (_, pad) => `${pad}<!-- subscribe-meta:start -->\n${indent(subscribeMeta(), pad)}\n${pad}<!-- subscribe-meta:end -->`);
}

async function main() {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const page of PAGES) {
    const file = path.join(root, 'site', page);
    const current = await readFile(file, 'utf8');
    const next = stamp(current);
    if (next === current) {
      console.log(`✓ site/${page} is in sync with site/config.js`);
    } else if (check) {
      stale++;
      console.log(`✗ site/${page} is out of date; run "npm run sync"`);
    } else {
      await writeFile(file, next);
      console.log(`updated site/${page}`);
    }
  }
  if (BUTTONDOWN_USERNAME === PLACEHOLDER_USERNAME) console.log(`note: BUTTONDOWN_USERNAME is still "${PLACEHOLDER_USERNAME}" in site/config.js`);
  process.exit(stale ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
