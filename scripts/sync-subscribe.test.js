import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUTTONDOWN_USERNAME, SUBSCRIBE_HEADLINE, SUBSCRIBE_SUBLINE, SUBSCRIBE_TAGS } from '../site/config.js';
import { subscribeMarkup, subscribeMeta } from '../site/components/subscribe.js';
import { PAGES, stamp } from './sync-subscribe.js';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');
const idsIn = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

test('each variant posts to the Buttondown embed endpoint with its own tag and the embed flag', () => {
  for (const variant of ['inline', 'footer', 'page']) {
    const html = subscribeMarkup(variant);
    assert.ok(html.includes(`action="https://buttondown.com/api/emails/embed-subscribe/${encodeURIComponent(BUTTONDOWN_USERNAME)}"`));
    assert.ok(html.includes('method="post"') && html.includes('class="subscribe-form"'));
    assert.ok(html.includes('name="embed" value="1"'));
    assert.ok(html.includes(`name="tag" value="${SUBSCRIBE_TAGS[variant]}"`));
    assert.ok(html.includes('type="email" name="email"') && /\srequired\s/.test(html) && html.includes('autocomplete="email"'));
  }
  assert.deepEqual(SUBSCRIBE_TAGS, { inline: 'site-inline', footer: 'site-footer', page: 'subscribe-page' });
});

test('copy comes from config, HTML-escaped', () => {
  const html = subscribeMarkup('inline');
  assert.ok(html.includes(SUBSCRIBE_HEADLINE));
  assert.ok(html.includes(SUBSCRIBE_SUBLINE.replace(/'/g, '&#39;')));
  assert.equal(SUBSCRIBE_HEADLINE, 'The day in AI, ranked.');
  assert.equal(SUBSCRIBE_SUBLINE, "One email each morning: the lead story, the top 5, and what's new. No hype.");
});

test('ids are unique across instances and across repeats of a variant', () => {
  const all = [subscribeMarkup('inline'), subscribeMarkup('footer'), subscribeMarkup('inline', '-2')].flatMap(idsIn);
  assert.equal(new Set(all).size, all.length);
});

test('the email field is described by the inline message element that exists in the markup', () => {
  const html = subscribeMarkup('footer');
  const described = html.match(/aria-describedby="([^"]+)"/)[1];
  assert.ok(html.includes(`id="${described}"`));
  assert.ok(html.includes('aria-live="polite"'));
});

test('the standalone page leads with an h1; placements inside a page use h2', () => {
  assert.match(subscribeMarkup('page'), /<h1 id="subscribe-title-page"/);
  assert.match(subscribeMarkup('inline'), /<h2 id="subscribe-title-inline"/);
  assert.match(subscribeMarkup('footer'), /<h2 id="subscribe-title-footer"/);
  assert.throws(() => subscribeMarkup('sidebar'), /unknown subscribe variant/);
});

test('share metadata carries the headline and subline', () => {
  const meta = subscribeMeta();
  assert.ok(meta.includes('property="og:title" content="The day in AI, ranked."'));
  assert.ok(meta.includes('name="twitter:card"'));
});

test('the generated no-JS fallbacks in the HTML are in sync with site/config.js', async () => {
  for (const page of PAGES) {
    const html = await readFile(path.join(site, page), 'utf8');
    assert.equal(stamp(html), html, `site/${page} is out of date: run "npm run sync"`);
    assert.equal(stamp(stamp(html)), stamp(html), 'stamping is idempotent');
  }
});

test('every page has its slots, and ids inside a page do not repeat', async () => {
  const expected = { 'index.html': ['inline', 'footer'], 'edition.html': ['inline', 'footer'], 'archive.html': ['footer'], 'about.html': ['footer'], 'methodology.html': ['footer'], 'subscribe.html': ['page'] };
  for (const [page, variants] of Object.entries(expected)) {
    const html = await readFile(path.join(site, page), 'utf8');
    assert.deepEqual([...html.matchAll(/data-subscribe="(\w+)"/g)].map((m) => m[1]), variants, page);
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${page} has duplicate ids`);
  }
});
