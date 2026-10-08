import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEAD_SHARE, MIN_RANKED, duplicateUrls, featuredItems, mergeDropped, planDrops, structuralProblems } from './gate.js';
import { EDITOR_NOTE_PLACEHOLDER, buildEdition, totalOf } from './rank.js';
import { itemId } from './url.js';

let n = 0;
const entry = (o = {}) => {
  n++;
  const url = o.url ?? `https://e.example/${n}`;
  const scores = o.scores ?? { importance: 5, trend: 5, novelty: 5, credibility: 8 };
  return {
    org: null,
    clusterId: o.clusterId ?? null,
    item: {
      id: itemId(url), url, canonicalUrl: o.canonicalUrl ?? url, title: o.title ?? `Story ${n}`, source: 'Src', sourceTier: 2, categoryHint: null, author: null,
      publishedAt: '2026-10-07T10:00:00Z', fetchedAt: '2026-10-07T12:00:00Z',
      signals: { hnPoints: null, hnComments: null, redditScore: null, githubStars: null, githubStarsDelta: null, crossSourceCount: 1 },
      scores, total: totalOf(scores), category: o.category ?? 'News', tags: [], summary: 's', whyItMatters: 'w', featuredSlot: null, previouslyFeatured: false,
    },
  };
};
const edition = ({ ranked = 40, note = 'A plain note about the day.', extra = [] } = {}) => {
  const lead = entry({ scores: { importance: 10, trend: 10, novelty: 10, credibility: 10 } });
  const rest = Array.from({ length: 5 }, () => entry());
  const { edition: e, errors } = buildEdition([lead, ...rest, ...extra], {
    date: '2026-10-08', generatedAt: '2026-10-08T10:00:00Z', editorNote: note, clusters: [], labels: new Map(), stats: { collected: 100, afterDedupe: 90, ranked },
  });
  assert.deepEqual(errors, []);
  return e;
};

test('a well-formed edition has no problems', () => {
  assert.deepEqual(structuralProblems(edition()), []);
});

test('fewer than 20 ranked items fails, 20 passes', () => {
  assert.equal(MIN_RANKED, 20);
  assert.match(structuralProblems(edition({ ranked: 19 })).join('\n'), /only 19 items were ranked; at least 20 are required/);
  assert.deepEqual(structuralProblems(edition({ ranked: 20 })), []);
});

test('a placeholder editor note fails the rules check', () => {
  assert.match(structuralProblems(edition({ note: EDITOR_NOTE_PLACEHOLDER })).join('\n'), /placeholder/);
});

test('schema problems are reported first and on their own', () => {
  const e = edition();
  delete e.lead;
  const problems = structuralProblems(e);
  assert.ok(problems.length > 0 && problems.every((p) => p.startsWith('schema:')));
});

test('distinct items that share a URL (as given or canonical) are duplicates', () => {
  const dup = entry({ url: 'https://e.example/same', canonicalUrl: 'https://e.example/canon-a' });
  const twin = entry({ url: 'https://e.example/other', canonicalUrl: 'https://e.example/same' });
  const e = edition({ extra: [dup, twin] });
  const d = duplicateUrls(e);
  assert.ok(d.some((x) => x.url === 'https://e.example/same' && x.ids.length === 2));
  assert.match(structuralProblems(e).join('\n'), /duplicate URL https:\/\/e\.example\/same/);
  assert.deepEqual(duplicateUrls(edition()), [], 'the lead listed twice (slot and category) is one item, not a duplicate');
});

test('featured items are the lead, top 5, innovations and trending leads, each once', () => {
  const e = edition();
  const f = featuredItems(e);
  assert.equal(f.length, new Set(f.map((i) => i.id)).size);
  assert.equal(f[0].id, e.lead.id);
  assert.ok(f.length >= 6);
  const withTrend = { ...e, trending: [{ id: 'c-x', label: 'a b c', itemIds: [e.top[0].id], leadItemId: e.top[0].id, sources: ['S'], trendDelta: null }] };
  assert.equal(featuredItems(withTrend).length, f.length, 'a trending lead that is already featured is not counted twice');
});

test('planDrops names the failed items and their reason', () => {
  const featured = [{ id: 'a', url: 'https://a.example' }, { id: 'b', url: 'https://b.example' }, { id: 'c', url: 'https://c.example' }, { id: 'd', url: 'https://d.example' }];
  const results = [{ ok: true, status: 200 }, { ok: false, status: 404, error: 'HTTP 404' }, { ok: true, status: 301 }, { ok: true, status: 200 }];
  const plan = planDrops(featured, results);
  assert.deepEqual(plan.failed, [{ id: 'b', url: 'https://b.example', reason: 'HTTP 404' }]);
  assert.equal(plan.looksBroken, false);
});

test('when half or more links fail at once it is treated as a network problem', () => {
  assert.equal(MAX_DEAD_SHARE, 0.5);
  const featured = [{ id: 'a', url: 'u1' }, { id: 'b', url: 'u2' }, { id: 'c', url: 'u3' }, { id: 'd', url: 'u4' }];
  const down = { ok: false, status: null, error: 'ENOTFOUND' };
  assert.equal(planDrops(featured, [down, down, { ok: true, status: 200 }, { ok: true, status: 200 }]).looksBroken, true);
  assert.equal(planDrops(featured, [down, { ok: true, status: 200 }, { ok: true, status: 200 }, { ok: true, status: 200 }]).looksBroken, false);
});

test('mergeDropped keeps earlier drops, one entry per id', () => {
  const first = mergeDropped(null, '2026-10-08', [{ id: 'a'.repeat(40), url: 'https://a.example', reason: 'HTTP 404' }], '2026-10-08T10:00:00Z');
  const second = mergeDropped(first, '2026-10-08', [{ id: 'b'.repeat(40), url: 'https://b.example', reason: 'timed out after 5s' }, { id: 'a'.repeat(40), url: 'https://a.example', reason: 'HTTP 410' }], '2026-10-08T10:05:00Z');
  assert.deepEqual(second.dropped.map((d) => [d.id[0], d.reason]), [['a', 'HTTP 410'], ['b', 'timed out after 5s']]);
});
