import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adapterFor } from './index.js';
import * as hn from './hackernews.js';
import * as gh from './github.js';

const now = new Date('2026-10-07T12:00:00Z');

test('adapters are chosen by host', () => {
  assert.equal(adapterFor('https://hn.algolia.com/api/v1/search_by_date?query=LLM'), hn);
  assert.equal(adapterFor('https://api.github.com/search/repositories?q=topic%3Allm'), gh);
  assert.equal(adapterFor('https://example.com/api'), null);
});

test('HN request keeps the points filter and adds the window', () => {
  const { url } = hn.request({ url: 'https://hn.algolia.com/api/v1/search_by_date?query=LLM&numericFilters=points%3E20' }, { now, windowHours: 36 });
  const u = new URL(url);
  assert.equal(u.searchParams.get('query'), 'LLM');
  assert.equal(u.searchParams.get('numericFilters'), `points>20,created_at_i>${Math.floor(now / 1000) - 36 * 3600}`);
});

test('HN parse maps points and comments; Ask HN links to the thread', () => {
  const items = hn.parse({
    hits: [
      { objectID: '1', title: 'A model', url: 'https://example.com/m', points: 120, num_comments: 45, created_at_i: 1791360000, author: 'pg' },
      { objectID: '2', title: 'Ask HN: evals?', url: null, points: 9, num_comments: 3, created_at_i: 1791360000 },
    ],
  });
  assert.deepEqual(items[0], { title: 'A model', url: 'https://example.com/m', author: null, publishedAt: '2026-10-07T08:00:00Z', signals: { hnPoints: 120, hnComments: 45 } });
  assert.equal(items[1].url, 'https://news.ycombinator.com/item?id=2');
});

test('HN parse rejects an unexpected response', () => {
  assert.throws(() => hn.parse({ error: 'x' }), /no hits/);
});

test('GitHub request restricts to repos created in the window, by stars', () => {
  const { url, headers } = gh.request({ url: 'https://api.github.com/search/repositories?q=topic%3Allm&sort=updated&per_page=50' }, { now, windowHours: 36 });
  const u = new URL(url);
  assert.equal(u.searchParams.get('q'), 'topic:llm created:>=2026-10-06');
  assert.equal(u.searchParams.get('sort'), 'stars');
  assert.equal(u.searchParams.get('per_page'), '50');
  assert.equal(headers.accept, 'application/vnd.github+json');
});

test('GitHub parse fills stars only; delta stays unset', () => {
  const [item] = gh.parse({
    items: [{ full_name: 'tessera-dev/tessera', description: 'A tiny agent runtime', html_url: 'https://github.com/tessera-dev/tessera', owner: { login: 'tessera-dev' }, created_at: '2026-10-06T10:00:00Z', stargazers_count: 6100 }],
  });
  assert.deepEqual(item, { title: 'tessera-dev/tessera: A tiny agent runtime', url: 'https://github.com/tessera-dev/tessera', author: 'tessera-dev', publishedAt: '2026-10-06T10:00:00Z', signals: { githubStars: 6100 } });
});
