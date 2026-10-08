import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { fitHeadline, ogSvg, renderOg, wrap } from './og.js';
import {
  FEED_EDITIONS, SEARCH_EDITIONS, buildFeed, buildSearchIndex, buildSitemap, feedItems, longDate, ogDescription, ogMeta, rfc822, stampOgMeta, xmlEscape,
} from './site-build.js';

const fixture = JSON.parse(await readFile(new URL('../../schemas/fixtures/edition-2026-10-07.json', import.meta.url), 'utf8'));
const SITE = 'https://example.org';

/** A copy of the fixture on another date, with ids made unique so editions don't collide. */
function edition(day) {
  const date = `2026-09-${String(day).padStart(2, '0')}`;
  const tag = (item) => ({ ...item, id: `${day.toString(16).padStart(2, '0')}${item.id.slice(2)}` });
  const copy = JSON.parse(JSON.stringify(fixture));
  copy.date = date;
  copy.generatedAt = `${date}T11:30:00Z`;
  copy.lead = tag(copy.lead);
  copy.top = copy.top.map(tag);
  copy.innovations = copy.innovations.map(tag);
  copy.byCategory = Object.fromEntries(Object.entries(copy.byCategory).map(([k, v]) => [k, v.map(tag)]));
  return copy;
}
const editions = (n) => Array.from({ length: n }, (_, i) => edition(30 - i)); // newest first
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', isArray: (n) => n === 'item' });

test('xml escaping, RFC 822 dates and long dates', () => {
  assert.equal(xmlEscape(`A & B <c> "d" 'e'`), 'A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;');
  assert.equal(rfc822('2026-10-08T10:01:29Z'), 'Thu, 08 Oct 2026 10:01:29 GMT');
  assert.equal(longDate('2026-10-08'), 'Thursday, October 8, 2026');
});

test('feed is well-formed RSS 2.0 with a channel and a self link', () => {
  const rss = parser.parse(buildFeed({ siteUrl: `${SITE}/`, editions: editions(2) })).rss;
  assert.equal(rss['@_version'], '2.0');
  const c = rss.channel;
  assert.equal(c.title, 'AI Signal');
  assert.equal(c.link, `${SITE}/`);
  assert.equal(c['atom:link']['@_href'], `${SITE}/feed.xml`);
  assert.equal(c['atom:link']['@_rel'], 'self');
  assert.equal(c.language, 'en-us');
  assert.equal(c.lastBuildDate, rfc822('2026-09-30T11:30:00Z'));
});

test('each feed item links to the original and uses our summary as its description', () => {
  const eds = editions(1);
  const items = parser.parse(buildFeed({ siteUrl: SITE, editions: eds })).rss.channel.item;
  const expected = feedItems(eds[0]);
  assert.equal(items.length, 1 + eds[0].top.length + eds[0].innovations.length);
  expected.forEach((src, i) => {
    assert.equal(items[i].link, src.url);
    assert.equal(items[i].description, src.summary);
    assert.equal(items[i].title, src.title);
    assert.equal(items[i].guid['#text'], src.id);
    assert.equal(items[i].guid['@_isPermaLink'], 'false');
    assert.equal(items[i].category, src.category);
  });
  assert.equal(items[0].title, eds[0].lead.title, 'lead comes first');
});

test('the feed carries the last 7 editions and no duplicate guids', () => {
  const items = parser.parse(buildFeed({ siteUrl: SITE, editions: editions(10) })).rss.channel.item;
  assert.equal(FEED_EDITIONS, 7);
  assert.equal(items.length, 7 * feedItems(fixture).length);
  const guids = items.map((i) => i.guid['#text']);
  assert.equal(new Set(guids).size, guids.length);
});

test('feed text with ampersands and angle brackets stays well-formed', () => {
  const e = edition(1);
  e.lead = { ...e.lead, title: 'R&D <beta> "launch"', summary: 'Costs < $5 & falling' };
  const items = parser.parse(buildFeed({ siteUrl: SITE, editions: [e] })).rss.channel.item;
  assert.equal(items[0].title, 'R&D <beta> "launch"');
  assert.equal(items[0].description, 'Costs < $5 & falling');
});

test('sitemap lists the static pages and one URL per edition', () => {
  const archive = [{ date: '2026-10-08' }, { date: '2026-10-07' }];
  const xml = buildSitemap({ siteUrl: `${SITE}/`, archive, latestDate: '2026-10-08' });
  const urls = parser.parse(xml).urlset.url;
  const locs = (Array.isArray(urls) ? urls : [urls]).map((u) => u.loc);
  assert.deepEqual(locs, [`${SITE}/`, `${SITE}/archive.html`, `${SITE}/about.html`, `${SITE}/methodology.html`, `${SITE}/subscribe.html`, `${SITE}/edition.html?date=2026-10-08`, `${SITE}/edition.html?date=2026-10-07`]);
  assert.ok(xml.includes('<loc>https://example.org/edition.html?date=2026-10-07</loc><lastmod>2026-10-07</lastmod>'));
});

test('search index: newest 30 editions, one entry per item, compact fields', () => {
  const eds = editions(35);
  const index = buildSearchIndex(eds);
  assert.equal(SEARCH_EDITIONS, 30);
  const dates = new Set(index.map((e) => e.d));
  assert.equal(dates.size, 30);
  assert.ok(!dates.has(eds[30].date) && dates.has(eds[29].date));
  assert.equal(new Set(index.map((e) => e.id)).size, index.length);
  assert.deepEqual(Object.keys(index[0]).sort(), ['c', 'd', 'g', 'id', 'm', 's', 't', 'u']);
  // an item that appears in two editions is indexed once, under the newest
  const again = edition(2);
  again.lead = { ...eds[0].lead };
  assert.equal(buildSearchIndex([eds[0], again]).filter((e) => e.id === eds[0].lead.id)[0].d, eds[0].date);
});

test('social description is whole words and at most 300 characters', () => {
  assert.equal(ogDescription('Short note.'), 'Short note.');
  const long = 'word '.repeat(200);
  const cut = ogDescription(long);
  assert.ok(cut.length <= 300 && cut.endsWith('…') && !/\s…$/.test(cut));
  assert.ok(!cut.slice(0, -1).endsWith('wor'), 'does not cut mid-word');
});

test('homepage meta: title = lead headline, description = editor note, absolute image URL', () => {
  const e = edition(5);
  e.lead = { ...e.lead, title: 'Q&A: "GPT-6" <live>' };
  e.editorNote = 'A note with "quotes" & an ampersand.';
  const meta = ogMeta({ siteUrl: `${SITE}/`, edition: e });
  assert.ok(meta.includes('<meta property="og:title" content="Q&amp;A: &quot;GPT-6&quot; &lt;live&gt;">'));
  assert.ok(meta.includes('<meta property="og:description" content="A note with &quot;quotes&quot; &amp; an ampersand.">'));
  assert.ok(meta.includes('<meta property="og:image" content="https://example.org/og/2026-09-05.png">'));
  assert.ok(meta.includes('og:image:width" content="1200"') && meta.includes('og:image:height" content="630"'));
  assert.ok(meta.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(meta.includes('<meta name="twitter:title" content="Q&amp;A: &quot;GPT-6&quot; &lt;live&gt;">'));
});

test('stampOgMeta rewrites only between the markers, idempotently', () => {
  const html = '<head>\n  <!-- og-meta:start -->\n  <!-- og-meta:end -->\n  <title>x</title>\n</head>';
  const once = stampOgMeta(html, '<meta a>\n<meta b>');
  assert.ok(once.includes('  <meta a>\n  <meta b>\n  <!-- og-meta:end -->'));
  assert.equal(stampOgMeta(once, '<meta a>\n<meta b>'), once);
  assert.ok(stampOgMeta(once, '<meta c>').includes('<meta c>') && !stampOgMeta(once, '<meta c>').includes('<meta a>'));
  assert.equal(stampOgMeta('<head></head>', '<meta a>'), '<head></head>');
});

test('headline wrapping: short headlines get the biggest size, long ones shrink, extreme ones truncate', () => {
  const short = fitHeadline('GPT-6 and Intelligent UI for everyone');
  assert.equal(short.size, 76);
  assert.ok(short.lines.length <= 3);
  const medium = fitHeadline('Mistral says its new open-weight model can challenge the best AI systems on reasoning and coding benchmarks while costing far less to run');
  assert.ok(medium.size < 76 && medium.lines.length * medium.size * medium.lineHeight <= 290);
  const huge = fitHeadline('word '.repeat(120));
  assert.ok(huge.lines.at(-1).endsWith('…'));
  assert.ok(huge.lines.length * huge.size * huge.lineHeight <= 290);
  assert.deepEqual(wrap('', 60, 800, 500), []);
  assert.ok(wrap('Supercalifragilisticexpialidocious', 76, 800, 300).length === 1, 'an over-long word stays whole');
});

test('the preview image is a 1200x630 PNG and the SVG escapes its text', () => {
  const svg = ogSvg({ dateLabel: 'Thursday, October 8, 2026', headline: 'A & B <c>', tagline: 'The day in AI, ranked.' });
  assert.ok(svg.includes('A &amp; B &lt;c&gt;') && !svg.includes('<c>'));
  const png = renderOg({ dateLabel: 'Thursday, October 8, 2026', headline: 'GPT-6 and Intelligent UI for everyone', tagline: 'The day in AI, ranked.' });
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
