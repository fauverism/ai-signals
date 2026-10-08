import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from './feed.js';

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom"><channel>
<item><title>Hello &amp; welcome &#8217;26</title><link>https://example.com/a?utm_source=x</link><pubDate>Tue, 06 Oct 2026 15:00:00 GMT</pubDate>
  <dc:creator>Ines Okafor</dc:creator><description>FULL BODY TEXT THAT MUST NOT BE KEPT</description></item>
<item><title>Email style author</title><link>https://example.com/b</link><dc:date>2026-10-06T11:00:00-04:00</dc:date><author>me@example.com (Jane Doe)</author></item>
<item><title>Revised paper</title><link>https://arxiv.org/abs/2610.00001</link><arxiv:announce_type>replace</arxiv:announce_type></item>
<item><title><![CDATA[<b>Markup</b> in title]]></title><guid isPermaLink="true">https://example.com/c</guid></item>
</channel></rss>`;

test('parses RSS: title, link, date, author; entities decoded', () => {
  const [a, b] = parseFeed(rss);
  assert.deepEqual(a, { title: 'Hello & welcome ’26', url: 'https://example.com/a?utm_source=x', author: 'Ines Okafor', publishedAt: '2026-10-06T15:00:00Z' });
  assert.equal(b.author, 'Jane Doe');
  assert.equal(b.publishedAt, '2026-10-06T15:00:00Z');
});

test('never returns body text', () => {
  assert.ok(!JSON.stringify(parseFeed(rss)).includes('FULL BODY'));
});

test('skips arXiv "replace" announcements, strips markup, falls back to guid', () => {
  const items = parseFeed(rss);
  assert.equal(items.length, 3);
  assert.equal(items[2].title, 'Markup in title');
  assert.equal(items[2].url, 'https://example.com/c');
});

test('parses Atom: alternate link, published date, author name', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Post</title>
    <link rel="self" href="https://example.com/self"/><link rel="alternate" href="https://example.com/post"/>
    <updated>2026-10-06T15:00:00Z</updated><author><name>Wen Zhao</name></author></entry></feed>`;
  assert.deepEqual(parseFeed(atom), [{ title: 'Post', url: 'https://example.com/post', author: 'Wen Zhao', publishedAt: '2026-10-06T15:00:00Z' }]);
});

test('long author lists are cut at a name boundary', () => {
  const names = Array.from({ length: 30 }, (_, i) => `Author Number${i}`).join(', ');
  const [item] = parseFeed(`<rss><channel><item><title>t</title><link>https://e.com/x</link><author>${names}</author></item></channel></rss>`);
  assert.ok(item.author.length <= 120);
  assert.ok(item.author.endsWith(', et al.'));
});

test('items without a date get publishedAt null', () => {
  const [item] = parseFeed('<rss><channel><item><title>t</title><link>https://e.com/x</link></item></channel></rss>');
  assert.equal(item.publishedAt, null);
});

test('rejects non-feed documents', () => {
  assert.throws(() => parseFeed('<html><body>hi</body></html>'), /not an RSS/);
});

test('decodes entities that feeds double-escape', () => {
  const [item] = parseFeed('<rss><channel><item><title>ChatGPT&amp;#8217;s &amp;#8216;Intelligent UI&amp;#8217; &amp;amp; more &amp;#x1F9E0;</title><link>https://e.com/x</link></item></channel></rss>');
  assert.equal(item.title, 'ChatGPT’s ‘Intelligent UI’ & more 🧠');
});
