import { test } from 'node:test';
import assert from 'node:assert/strict';
import { communityScore, dedupe, exactDedupe, nearDedupe, preScoreOf } from './dedupe.js';
import { itemId } from './url.js';

const mk = ({ url, title, source, tier = 2, at = '2026-10-07T10:00:00Z', signals = {} }) => ({
  id: itemId(url),
  url,
  canonicalUrl: url,
  title,
  source,
  sourceTier: tier,
  categoryHint: null,
  author: null,
  publishedAt: at,
  fetchedAt: '2026-10-07T12:00:00Z',
  signals: { hnPoints: null, hnComments: null, redditScore: null, githubStars: null, githubStarsDelta: null, crossSourceCount: 1, ...signals },
});

// Unrelated stories so IDF weights behave like they do on a real day.
const fillers = ['Quantum', 'Volcano', 'Penguin', 'Origami', 'Glacier', 'Sonnet'].map((w, i) =>
  mk({ url: `https://f${i}.example/a`, title: `${w} ${w}s discovered near ${w}ville harbor`, source: `Filler ${i}` }),
);

const atlas1 = mk({ url: 'https://meridian.example/atlas-2', title: 'Meridian Labs releases Atlas-2 with million-token context window', source: 'Meridian Blog', tier: 1, at: '2026-10-07T11:00:00Z' });
const atlas2 = mk({ url: 'https://press.example/atlas-2', title: "Atlas-2 hands-on: Meridian's new context window beats rivals", source: 'Press', tier: 2, at: '2026-10-07T09:00:00Z' });

test('exact dedupe keeps the best tier, merges signals (max) and every source', () => {
  const feed = mk({ url: 'https://a.example/post', title: 'A post', source: 'Feed', tier: 2, at: '2026-10-07T10:00:00Z' });
  const hn = mk({ url: 'https://a.example/post', title: 'A post (HN title)', source: 'HN', tier: 3, signals: { hnPoints: 120, hnComments: 40 } });
  const [one, ...rest] = exactDedupe([hn, feed]);
  assert.equal(rest.length, 0);
  assert.equal(one.source, 'Feed');
  assert.equal(one.signals.hnPoints, 120);
  assert.equal(one.signals.githubStars, null);
  assert.deepEqual(one.mergedSources, ['Feed', 'HN']);
});

test('near-duplicate titles merge within 48h but not beyond it', () => {
  const a = mk({ url: 'https://x.example/1', title: 'Google rolls out improved SynthID detector globally', source: 'A', at: '2026-10-05T10:00:00Z' });
  const b = mk({ url: 'https://y.example/2', title: 'Google rolls out an improved SynthID detector, globally', source: 'B', at: '2026-10-06T10:00:00Z' });
  const c = mk({ url: 'https://z.example/3', title: 'Google rolls out improved SynthID detector globally', source: 'C', at: '2026-10-09T10:00:00Z' });
  const opts = { nearDupHours: 48, nearDupJaccard: 0.6 };
  assert.equal(nearDedupe([a, b], opts).length, 1);
  assert.equal(nearDedupe([a, c], opts).length, 2);
});

test('near-duplicate needs 2+ shared tokens and Jaccard >= 0.6', () => {
  const opts = { nearDupHours: 48, nearDupJaccard: 0.6 };
  const a = mk({ url: 'https://x.example/1', title: 'Llama 4', source: 'A' });
  const b = mk({ url: 'https://y.example/2', title: 'Llama 4 benchmarks released today by researchers', source: 'B' });
  assert.equal(nearDedupe([a, b], opts).length, 2);
});

test('clusters same-event stories; lead is tier 1 if present, else earliest', () => {
  const withTier1 = dedupe([atlas1, atlas2, ...fillers]);
  assert.equal(withTier1.clusters.length, 1);
  assert.equal(withTier1.clusters[0].leadItemId, atlas1.id);

  const noTier1 = dedupe([{ ...atlas1, sourceTier: 2 }, atlas2, ...fillers]);
  assert.equal(noTier1.clusters[0].leadItemId, atlas2.id); // 09:00 is earlier than 11:00
});

test('crossSourceCount = distinct sources in the cluster, including merged duplicates', () => {
  const hn = mk({ url: 'https://press.example/atlas-2', title: 'Atlas-2 review', source: 'Hacker News', tier: 3, signals: { hnPoints: 50 } });
  const { items } = dedupe([atlas1, atlas2, hn, ...fillers]);
  const inCluster = items.filter((i) => i.clusterId);
  assert.equal(inCluster.length, 2);
  for (const i of inCluster) assert.equal(i.signals.crossSourceCount, 3);
  assert.equal(items.find((i) => i.title.startsWith('Quantum')).signals.crossSourceCount, 1);
});

test("one source's own series is not a cluster", () => {
  const a = mk({ url: 'https://aws.example/1', title: 'How Acme cut costs with Amazon Bedrock', source: 'AWS Blog' });
  const b = mk({ url: 'https://aws.example/2', title: 'Build voice agents with Amazon Bedrock AgentCore', source: 'AWS Blog' });
  assert.equal(dedupe([a, b, ...fillers]).clusters.length, 0);
});

const edition = (items, featuredIds = []) => ({
  lead: { id: featuredIds[0] ?? 'x'.repeat(40), title: 'Something else' },
  top: [],
  innovations: [],
  byCategory: { News: items.map((i) => ({ ...i, featuredSlot: null })) },
});

test('previouslyFeatured marks items featured in recent editions, not merely listed', () => {
  const prior = [{ date: '2026-10-06', edition: { ...edition([atlas2]), lead: { id: atlas1.id, title: atlas1.title } } }];
  const { items } = dedupe([atlas1, atlas2, ...fillers], { editions: prior });
  assert.equal(items.find((i) => i.id === atlas1.id).previouslyFeatured, true);
  assert.equal(items.find((i) => i.id === atlas2.id).previouslyFeatured, false); // listed, never featured
});

test('trendDelta = today cluster size minus the topic average over prior editions', () => {
  const day1 = { date: '2026-10-05', edition: edition([{ id: 'a'.repeat(40), title: 'Atlas-2 leaks ahead of launch' }]) };
  const day2 = { date: '2026-10-06', edition: edition([{ id: 'b'.repeat(40), title: 'Unrelated news about penguins' }]) };
  const { clusters, items } = dedupe([atlas1, atlas2, ...fillers], { editions: [day1, day2] });
  assert.equal(clusters[0].trendDelta, 1.5); // 2 today - (1 + 0) / 2
  assert.equal(items.find((i) => i.id === atlas1.id).trendDelta, 1.5);
  assert.equal(dedupe([atlas1, atlas2, ...fillers]).clusters[0].trendDelta, null); // no history, no delta
});

test('preScore = tier weight + crossSourceCount + community signals', () => {
  const base = { sourceTier: 1, signals: { crossSourceCount: 1, hnPoints: null, hnComments: null, redditScore: null, githubStars: null } };
  assert.equal(preScoreOf(base), 4);
  assert.equal(preScoreOf({ ...base, sourceTier: 3, signals: { ...base.signals, hnPoints: 500, hnComments: 300 } }), 1 + 1 + 3);
  assert.equal(preScoreOf({ ...base, signals: { ...base.signals, crossSourceCount: 20 } }), 3 + 8); // cross-source is capped
  assert.equal(communityScore({}), 0);
  assert.ok(communityScore({ hnPoints: 50 }) < communityScore({ hnPoints: 400 }));
});

test('cap: tier-1 first, then preScore; items come out in that order', () => {
  const t1 = ['Alpha', 'Bravo', 'Charlie'].map((w, i) => mk({ url: `https://t1.example/${i}`, title: `${w} paper on ${w}ification`, source: `T1 ${i}`, tier: 1 }));
  const hot = mk({ url: 'https://hot.example/1', title: 'Viral community post about Zebras', source: 'HN', tier: 3, signals: { hnPoints: 900, hnComments: 500 } });
  const { items, stats } = dedupe([hot, ...t1], { cap: 2 });
  assert.equal(stats.afterNearDup, 4);
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.sourceTier === 1));
});

test('per-source cap limits one source from filling the set', () => {
  const papers = Array.from({ length: 6 }, (_, i) => mk({ url: `https://arxiv.example/${i}`, title: `Paper${'x'.repeat(i)} about topic${i} quirk${i}`, source: 'arXiv', tier: 1 }));
  const other = mk({ url: 'https://press.example/1', title: 'A press story about Zebras', source: 'Press', tier: 2 });
  const { items } = dedupe([...papers, other], { cap: 4, perSourceCap: 2 });
  assert.equal(items.filter((i) => i.source === 'arXiv').length, 2);
  assert.ok(items.some((i) => i.source === 'Press'));
});

test('clusters point only at kept items and re-pick a lead the cap dropped', () => {
  const { clusters, items } = dedupe([atlas1, atlas2, ...fillers], { cap: 1 });
  assert.equal(items.length, 1);
  assert.equal(clusters[0].itemIds.length, 1);
  assert.equal(clusters[0].leadItemId, items[0].id);
  assert.equal(clusters[0].size, 2); // size still reports the full cluster
});

test('output is deterministic', () => {
  const a = dedupe([atlas1, atlas2, ...fillers]);
  const b = dedupe([...fillers, atlas2, atlas1]);
  assert.deepEqual(a, b);
});
