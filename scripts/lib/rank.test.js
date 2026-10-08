import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITOR_NOTE_PLACEHOLDER, WEIGHTS, buildEdition, buildRankedItem, editionProblems, makeBatches, selectFeatured,
  textProblems, totalOf, trendBaseline, upsertArchive, archiveEntry,
} from './rank.js';
import { itemId } from './url.js';

const S = (importance, trend, novelty, credibility) => ({ importance, trend, novelty, credibility });
const signals = (o = {}) => ({ hnPoints: null, hnComments: null, redditScore: null, githubStars: null, githubStarsDelta: null, crossSourceCount: 1, ...o });

let n = 0;
/** An entry as selectFeatured/buildEdition see it. */
const entry = (o = {}) => {
  n++;
  const url = `https://e.example/${n}`;
  const scores = o.scores ?? S(5, 5, 5, 8);
  return {
    org: o.org ?? null,
    clusterId: o.clusterId ?? null,
    item: {
      id: itemId(url), url, canonicalUrl: url, title: o.title ?? `Story ${n}`, source: 'Src', sourceTier: 2, categoryHint: null, author: null,
      publishedAt: o.at ?? '2026-10-07T10:00:00Z', fetchedAt: '2026-10-07T12:00:00Z', signals: signals(),
      scores, total: o.total ?? totalOf(scores), category: o.category ?? 'News', tags: [], summary: 's', whyItMatters: 'w',
      featuredSlot: null, previouslyFeatured: o.prev ?? false,
    },
  };
};

test('weights sum to 1 and totals are computed from them', () => {
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 1);
  assert.equal(totalOf(S(10, 10, 10, 10)), 10);
  assert.equal(totalOf(S(0, 0, 0, 0)), 0);
  assert.equal(totalOf(S(8, 6, 7, 9)), 7.4); // 2.8 + 1.5 + 1.75 + 1.35 = 7.4
  assert.equal(totalOf(S(7, 4, 6, 8)), 6.2); // 2.45 + 1 + 1.5 + 1.2 = 6.15 -> rounds half up
});

test('credibility under 4 caps the total at 5; 4 does not', () => {
  assert.equal(totalOf(S(10, 10, 10, 3)), 5);
  assert.equal(totalOf(S(10, 10, 10, 4)), 9.1);
  assert.equal(totalOf(S(2, 2, 2, 3)), 2.2); // below the cap: untouched (2.15 rounds half up)
});

test('trend baseline follows the rubric table', () => {
  const base = { signals: signals(), trendDelta: null };
  assert.equal(trendBaseline(base), 0);
  assert.equal(trendBaseline({ ...base, signals: signals({ crossSourceCount: 3 }) }), 2);
  assert.equal(trendBaseline({ ...base, signals: signals({ crossSourceCount: 9 }) }), 4);
  assert.equal(trendBaseline({ ...base, trendDelta: 1.5 }), 1);
  assert.equal(trendBaseline({ ...base, trendDelta: 7 }), 4);
  assert.equal(trendBaseline({ ...base, signals: signals({ hnPoints: 150, hnComments: 60 }) }), 2);
  assert.equal(trendBaseline({ signals: signals({ crossSourceCount: 5, hnPoints: 500, githubStars: 5000 }), trendDelta: 9 }), 10);
});

test('buildRankedItem recomputes the total, ignores the model total, and clamps/explains trend', () => {
  const d = { id: 'a'.repeat(40), url: 'https://e.example/x', canonicalUrl: 'https://e.example/x', title: 't', source: 's', sourceTier: 2, categoryHint: null, author: null, publishedAt: '2026-10-07T10:00:00Z', fetchedAt: '2026-10-07T12:00:00Z', signals: signals(), trendDelta: null, previouslyFeatured: true, mergedSources: ['s'], clusterId: null, preScore: 3 };
  const judged = { id: d.id, scores: S(8, 6, 7, 9), category: 'News', tags: [], summary: 'ok', whyItMatters: 'ok', organization: ' OpenAI ', total: 9.9 };
  const r = buildRankedItem(d, judged);
  assert.equal(r.item.total, totalOf(S(8, 2, 7, 9))); // trend 6 clamped to baseline 0 + 2
  assert.equal(r.item.scores.trend, 2);
  assert.equal(r.org, 'openai');
  assert.equal(r.item.previouslyFeatured, true);
  assert.equal(r.item.featuredSlot, null);
  assert.ok(r.problems.some((p) => /no trendReason/.test(p)));
  assert.ok(r.notes.some((x) => /ignored model-written total/.test(x)));
  assert.ok(!('mergedSources' in r.item) && !('preScore' in r.item) && !('clusterId' in r.item));
  assert.equal(buildRankedItem(d, { ...judged, scores: S(8, 1, 7, 9), trendReason: 'shared arXiv cross-list' }).problems.length, 0);
});

test('text rules: hype words and long quotes', () => {
  assert.equal(textProblems('A solid release with measured gains.', 'x').length, 0);
  assert.equal(textProblems('A revolutionary new model', 'x').length, 1);
  assert.equal(textProblems('This is insane and game-changing', 'x').length, 2);
  assert.equal(textProblems('The authors say "it works well" here', 'x').length, 0);
  const long = '"' + Array.from({ length: 16 }, (_, i) => `w${i}`).join(' ') + '"';
  assert.equal(textProblems(`They wrote ${long}`, 'x').length, 1);
});

test('batches keep every cluster whole and stay near the size', () => {
  const items = [];
  for (let i = 0; i < 7; i++) items.push({ id: `s${i}`, clusterId: null });
  for (let i = 0; i < 5; i++) items.push({ id: `c${i}`, clusterId: 'cl-a' });
  for (let i = 7; i < 12; i++) items.push({ id: `s${i}`, clusterId: null });
  items.splice(3, 0, { id: 'c-late', clusterId: 'cl-a' }); // a cluster member far from its siblings
  const batches = makeBatches(items, 8);
  assert.equal(batches.flat().length, items.length);
  const home = batches.map((b) => b.some((x) => x.clusterId === 'cl-a'));
  assert.equal(home.filter(Boolean).length, 1);
  for (const b of batches) assert.ok(b.length <= 8);
});

test('lead: highest total with credibility >= 7 that is not previously featured', () => {
  const flashy = entry({ scores: S(10, 10, 10, 5) }); // highest total, credibility too low
  const old = entry({ scores: S(9, 9, 9, 9), prev: true });
  const good = entry({ scores: S(8, 6, 7, 8) });
  const rest = Array.from({ length: 6 }, () => entry({ scores: S(4, 4, 4, 8) }));
  const r = selectFeatured([flashy, old, good, ...rest]);
  assert.equal(r.lead, good);
  assert.equal(r.leadFallback, null);
});

test('lead falls back in order, and errors when nothing is credible enough', () => {
  const rest = Array.from({ length: 6 }, () => entry({ scores: S(4, 4, 4, 5) }));
  const onlyOld = entry({ scores: S(9, 9, 9, 9), prev: true });
  assert.equal(selectFeatured([onlyOld, ...rest]).leadFallback, 'allowed a previously featured item');
  const six = entry({ scores: S(7, 7, 7, 6) });
  assert.equal(selectFeatured([six, ...rest]).leadFallback, 'relaxed credibility to 6');
  assert.match(selectFeatured(rest).error, /no item qualifies for lead/);
});

test('top: next 5, at most 2 per organization, lead excluded from the limit', () => {
  const lead = entry({ scores: S(10, 10, 10, 10), org: 'acme' });
  const acme = [1, 2, 3].map(() => entry({ scores: S(9, 8, 8, 9), org: 'acme' }));
  const others = [7, 6, 5, 4, 3].map((v, i) => entry({ scores: S(v, v, v, 8), org: `org${i}` }));
  const r = selectFeatured([lead, ...acme, ...others]);
  assert.equal(r.lead, lead);
  assert.equal(r.top.length, 5);
  assert.equal(r.top.filter((e) => e.org === 'acme').length, 2);
  assert.ok(r.top.includes(others[0]) && r.top.includes(others[1]) && r.top.includes(others[2]));
});

test('innovations: novelty >= 8, not already lead/top, up to 6, most novel first', () => {
  const lead = entry({ scores: S(10, 10, 10, 10) });
  const top = Array.from({ length: 5 }, () => entry({ scores: S(8, 8, 5, 8) }));
  const novel = [9, 8, 10].map((v) => entry({ scores: S(2, 2, v, 7) }));
  const almost = entry({ scores: S(2, 2, 7, 7) });
  const r = selectFeatured([lead, ...top, ...novel, almost]);
  assert.deepEqual(r.innovations.map((e) => e.item.scores.novelty), [10, 9, 8]);
  assert.ok(!r.innovations.includes(almost));
});

test('one slot per cluster among lead, top and innovations', () => {
  const lead = entry({ scores: S(10, 10, 10, 10), clusterId: 'cl-x' });
  const sibling = entry({ scores: S(9, 9, 9, 9), clusterId: 'cl-x' });
  const rest = Array.from({ length: 5 }, () => entry({ scores: S(5, 5, 5, 8) }));
  const r = selectFeatured([lead, sibling, ...rest]);
  assert.ok(!r.top.includes(sibling));
});

test('Tutorials rule: a Tutorials item scoring >= 6 gets into top', () => {
  const lead = entry({ scores: S(10, 10, 10, 10) });
  const strong = Array.from({ length: 5 }, () => entry({ scores: S(9, 9, 6, 9) }));
  const tutorial = entry({ scores: S(6, 6, 6, 7), category: 'Tutorials' }); // total 6.1, would miss top
  const r = selectFeatured([lead, ...strong, tutorial]);
  assert.ok(r.top.includes(tutorial));
  assert.equal(r.top.length, 5);
  assert.ok(r.notes.some((x) => /Tutorials rule/.test(x)));
  const weak = entry({ scores: S(3, 3, 3, 7), category: 'Tutorials' }); // total < 6: no rule
  assert.ok(!selectFeatured([lead, ...strong, weak]).top.includes(weak));
});

const ctx = (extra = {}) => ({
  date: '2026-10-07', generatedAt: '2026-10-07T12:00:00Z', editorNote: EDITOR_NOTE_PLACEHOLDER,
  clusters: [], labels: new Map(), stats: { collected: 100, afterDedupe: 90, ranked: 20 }, ...extra,
});

test('buildEdition assigns slots, fills byCategory and picks trending clusters by trendDelta', () => {
  const lead = entry({ scores: S(10, 10, 10, 10), category: 'News' });
  const top = Array.from({ length: 5 }, () => entry({ scores: S(8, 8, 5, 8), category: 'Research' }));
  const a1 = entry({ scores: S(3, 3, 3, 6), clusterId: 'cl-a', category: 'Tools & Releases' });
  const a2 = entry({ scores: S(2, 2, 2, 6), clusterId: 'cl-a', category: 'Tools & Releases' });
  const b1 = entry({ scores: S(3, 3, 3, 6), clusterId: 'cl-b', category: 'Business' });
  const clusters = [
    { id: 'cl-a', label: 'x', itemIds: [a1.item.id, a2.item.id], leadItemId: a2.item.id, sources: ['S1', 'S2'], size: 2, trendDelta: 4 },
    { id: 'cl-b', label: 'y', itemIds: [b1.item.id], leadItemId: b1.item.id, sources: ['S3'], size: 3, trendDelta: 1 },
  ];
  const labels = new Map([['cl-a', 'On-device vector search'], ['cl-b', 'Inference chip funding']]);
  const { edition, errors } = buildEdition([lead, ...top, a1, a2, b1], ctx({ clusters, labels }));
  assert.deepEqual(errors, []);
  assert.equal(edition.lead.featuredSlot, 'lead');
  assert.ok(edition.top.every((i) => i.featuredSlot === 'top'));
  assert.deepEqual(edition.trending.map((c) => c.id), ['cl-a', 'cl-b']);
  assert.equal(edition.trending[0].leadItemId, a2.item.id);
  assert.equal(edition.trending[0].trendDelta, 4);
  assert.equal(edition.trending[1].trendDelta, 1);
  assert.equal(a2.item.featuredSlot, 'trending');
  assert.ok(edition.byCategory['Tools & Releases'].some((i) => i.id === a2.item.id));
  assert.deepEqual(Object.keys(edition.byCategory).length, 7);
  assert.equal(edition.stats.ranked, 20);
});

test('trending clusters need labels of 3-6 words', () => {
  const lead = entry({ scores: S(10, 10, 10, 10) });
  const rest = Array.from({ length: 5 }, () => entry({ scores: S(5, 5, 5, 8) }));
  const c = entry({ scores: S(3, 3, 3, 6), clusterId: 'cl-a' });
  const clusters = [{ id: 'cl-a', label: 'x', itemIds: [c.item.id], leadItemId: c.item.id, sources: ['S'], size: 2, trendDelta: 2 }];
  assert.match(buildEdition([lead, ...rest, c], ctx({ clusters })).errors[0], /no label/);
  assert.match(buildEdition([lead, ...rest, c], ctx({ clusters, labels: new Map([['cl-a', 'Two words']]) })).errors[0], /3-6 words/);
  assert.deepEqual(buildEdition([lead, ...rest, c], ctx({ clusters, labels: new Map([['cl-a', 'Three little words']]) })).errors, []);
});

test('editionProblems flags the placeholder note, wrong totals and low-novelty innovations', () => {
  const lead = entry({ scores: S(10, 10, 10, 10) });
  const rest = Array.from({ length: 5 }, () => entry({ scores: S(5, 5, 5, 8) }));
  const { edition } = buildEdition([lead, ...rest], ctx());
  assert.ok(editionProblems(edition).some((p) => /placeholder/.test(p)));
  edition.editorNote = 'Plain note about the day.';
  assert.deepEqual(editionProblems(edition), []);
  edition.top[0] = { ...edition.top[0], total: 9.9 }; // byCategory still holds the correct copy
  edition.innovations.push({ ...edition.top[1], scores: S(5, 5, 7, 8) });
  const p = editionProblems(edition);
  assert.ok(p.some((x) => /does not match its scores/.test(x)));
  assert.ok(p.some((x) => /novelty 7 is below 8/.test(x)));
});

test('archive entries are upserted newest first', () => {
  const lead = entry({ scores: S(10, 10, 10, 10) });
  const rest = Array.from({ length: 5 }, () => entry({ scores: S(5, 5, 5, 8) }));
  const { edition } = buildEdition([lead, ...rest], ctx());
  const a = upsertArchive([{ date: '2026-10-05', leadTitle: 'old', count: 3 }, { date: '2026-10-07', leadTitle: 'stale', count: 1 }], archiveEntry(edition));
  assert.deepEqual(a.map((x) => x.date), ['2026-10-07', '2026-10-05']);
  assert.equal(a[0].leadTitle, lead.item.title);
  assert.equal(a[0].count, 6);
});
