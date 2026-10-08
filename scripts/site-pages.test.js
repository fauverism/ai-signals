import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEIGHTS } from './lib/rank.js';
import { PAGES } from './lib/site-build.js';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');
const read = (name) => readFile(path.join(site, name), 'utf8');
const ids = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).sort();

test('about.html states the same weights the code uses', async () => {
  const html = await read('about.html');
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const label = name[0].toUpperCase() + name.slice(1);
    const row = html.match(new RegExp(`<th scope="row">${label}</th><td class="pct">(\\d+)%</td>`));
    assert.ok(row, `${label} row is present`);
    assert.equal(Number(row[1]), Math.round(weight * 100), `${label} weight matches rank.js`);
  }
  const barWidths = [...html.matchAll(/--w: (\d+)%/g)].map((m) => Number(m[1]));
  assert.deepEqual(barWidths, Object.values(WEIGHTS).map((w) => Math.round(w * 100)), 'bars match the numbers');
  assert.match(html, /below 4, the total can never be higher than 5/);
});

test("about.html's worked example adds up the way totalOf does", async () => {
  const { totalOf } = await import('./lib/rank.js');
  assert.equal(totalOf({ importance: 8, trend: 6, novelty: 7, credibility: 9 }), 7.4);
  assert.match(await read('about.html'), /total\s+= 7\.4/);
});

test('the front page and the edition page have the same sections', async () => {
  const strip = (list) => list.filter((id) => !id.startsWith('subscribe-title') && !id.startsWith('bd-'));
  assert.deepEqual(strip(ids(await read('index.html'))), strip(ids(await read('edition.html'))));
  assert.match(await read('index.html'), /data-page="home"/);
  assert.match(await read('edition.html'), /data-page="edition"/);
});

test('every page links the feed, has an About link in the footer, and loads the shared stylesheet', async () => {
  for (const page of ['index.html', 'edition.html', 'archive.html', 'about.html', 'methodology.html', 'subscribe.html']) {
    const html = await read(page);
    assert.match(html, /<link rel="alternate" type="application\/rss\+xml" title="AI Signal" href="feed\.xml">/, `${page}: feed autodiscovery`);
    const footer = html.slice(html.indexOf('<footer'));
    if (page !== 'about.html') assert.match(footer, /href="about\.html"/, `${page}: footer links About`);
    assert.match(footer, /href="feed\.xml"/, `${page}: footer links RSS`);
    assert.match(html, /css\/site\.css/);
  }
});

test('the homepage has the og-meta markers build.js fills', async () => {
  const html = await read('index.html');
  assert.match(html, /<!-- og-meta:start -->[\s\S]*<!-- og-meta:end -->/);
});

test('every page the sitemap lists exists (the homepage is index.html)', async () => {
  for (const p of PAGES) await access(path.join(site, p === '' ? 'index.html' : p));
  await access(path.join(site, 'edition.html'));
});

test('methodology no longer repeats the weights; it points to About', async () => {
  const html = await read('methodology.html');
  assert.ok(!/<table/.test(html));
  assert.match(html, /href="about\.html"/);
});

test('validate.js ignores unmapped scratch files in data/work but still flags one named explicitly', async () => {
  const { spawnSync } = await import('node:child_process');
  const { writeFile, rm } = await import('node:fs/promises');
  const scratch = path.resolve(site, '../data/work/zz-scratch-test.json');
  await writeFile(scratch, '{}');
  try {
    const discovered = spawnSync(process.execPath, [path.resolve(site, '../scripts/validate.js')], { encoding: 'utf8' });
    assert.ok(!discovered.stdout.includes('zz-scratch-test'), 'not picked up by discovery');
    const named = spawnSync(process.execPath, [path.resolve(site, '../scripts/validate.js'), scratch], { encoding: 'utf8' });
    assert.equal(named.status, 1);
    assert.match(named.stdout, /no schema is mapped/);
  } finally {
    await rm(scratch, { force: true });
  }
});
