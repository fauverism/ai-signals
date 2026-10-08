import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, itemId } from './url.js';

const c = canonicalizeUrl;

test('strips utm_*, ref and fbclid but keeps meaningful params', () => {
  assert.equal(c('https://example.com/post?id=7&utm_source=hn&utm_medium=x&fbclid=abc&ref=newsletter'), 'https://example.com/post?id=7');
  assert.equal(c('https://example.com/post?UTM_Campaign=a'), 'https://example.com/post');
  assert.equal(c('https://example.com/post?reference=1'), 'https://example.com/post?reference=1');
});

test('sorts remaining query params so order does not matter', () => {
  assert.equal(c('https://example.com/s?b=2&a=1'), c('https://example.com/s?a=1&b=2'));
});

test('normalizes host case, www, scheme, default ports and fragments', () => {
  assert.equal(c('HTTP://WWW.Example.COM:80/Path#section'), 'https://example.com/Path');
  assert.equal(c('https://example.com:8443/x'), 'https://example.com:8443/x');
});

test('removes trailing slashes, including on the root', () => {
  assert.equal(c('https://example.com/'), 'https://example.com');
  assert.equal(c('https://example.com/a/b/'), 'https://example.com/a/b');
  assert.equal(c('https://example.com/a//'), 'https://example.com/a');
});

test('arXiv abs, pdf, html and versioned links all map to the abs URL', () => {
  const abs = 'https://arxiv.org/abs/2610.00417';
  assert.equal(c('https://arxiv.org/abs/2610.00417'), abs);
  assert.equal(c('https://arxiv.org/abs/2610.00417v3'), abs);
  assert.equal(c('http://arxiv.org/pdf/2610.00417v2.pdf'), abs);
  assert.equal(c('https://arxiv.org/pdf/2610.00417'), abs);
  assert.equal(c('https://www.arxiv.org/html/2610.00417v1/'), abs);
  assert.equal(c('https://export.arxiv.org/abs/2610.00417v1'), abs);
  assert.equal(c('https://arxiv.org/abs/2610.00417?utm_source=x'), abs);
  assert.equal(c('https://arxiv.org/pdf/cs/0301001v2.pdf'), 'https://arxiv.org/abs/cs/0301001');
});

test('non-article arXiv paths are left alone', () => {
  assert.equal(c('https://arxiv.org/list/cs.AI/recent'), 'https://arxiv.org/list/cs.AI/recent');
});

test('reddit alias hosts collapse to reddit.com', () => {
  assert.equal(c('https://old.reddit.com/r/LocalLLaMA/comments/abc/title/'), 'https://reddit.com/r/LocalLLaMA/comments/abc/title');
  assert.equal(c('https://www.reddit.com/r/LocalLLaMA/comments/abc/title'), 'https://reddit.com/r/LocalLLaMA/comments/abc/title');
});

test('resolves relative URLs against a base', () => {
  assert.equal(c('/blog/post?utm_source=x', 'https://example.com/feed.xml'), 'https://example.com/blog/post');
});

test('rejects non-http(s) and garbage input', () => {
  assert.equal(c('mailto:a@b.com'), null);
  assert.equal(c('javascript:alert(1)'), null);
  assert.equal(c('not a url'), null);
  assert.equal(c(''), null);
});

test('equivalent URLs get the same id, and ids are sha1 hex', () => {
  const a = itemId(c('https://www.example.com/post/?utm_source=a'));
  const b = itemId(c('http://example.com/post#top'));
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{40}$/);
});
