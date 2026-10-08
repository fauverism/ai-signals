// Pure dedupe / cluster / pre-score logic. No I/O: scripts/dedupe.js feeds it files and writes the result.
import { createHash } from 'node:crypto';
import { entitiesOf, isVersionToken, jaccard, sharedCount, tokenize } from './titles.js';

const HOUR = 3600 * 1000;

export const DEFAULTS = {
  cap: 150,
  perSourceCap: null, // opt-in: at most this many items from one source in the capped set
  nearDupHours: 48,
  nearDupJaccard: 0.6,
  clusterHours: 72,
};

// Cluster linking thresholds (cosine similarity of IDF-weighted title tokens).
const COS_STRONG = 0.55; // similar enough on its own
const COS_TWO_ENTITIES = 0.15; // plus two shared entities
const COS_ONE_SPECIFIC = 0.3; // plus one specific shared entity (model version or rare name)
const SPECIFIC_ENTITY_MAX_DF = 6;
const MAX_CLUSTER_SIZE = 30;
const MAX_POSTING = 60; // tokens in more titles than this are too common to link on

// preScore = tier weight + min(crossSourceCount, MAX_CROSS) + community (0..3).
export const TIER_WEIGHT = { 1: 3, 2: 2, 3: 1 };
const MAX_CROSS = 8;
const COMMUNITY_MAX = 3;
const SIGNAL_CAPS = { hnPoints: 500, hnComments: 300, redditScore: 3000, githubStars: 5000 };
const SIGNAL_KEYS = ['hnPoints', 'hnComments', 'redditScore', 'githubStars', 'githubStarsDelta'];

const ms = (item) => Date.parse(item.publishedAt);
const round2 = (x) => Math.round(x * 100) / 100;
const byRep = (a, b) => a.sourceTier - b.sourceTier || a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id);
const truncate = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.size = Array(n).fill(1);
  }
  find(i) {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]];
    return i;
  }
  /** Joins two sets unless the result would exceed `max`. */
  union(a, b, max = Infinity) {
    a = this.find(a);
    b = this.find(b);
    if (a === b || this.size[a] + this.size[b] > max) return false;
    this.parent[b] = a;
    this.size[a] += this.size[b];
    return true;
  }
  groups() {
    const out = new Map();
    for (let i = 0; i < this.parent.length; i++) {
      const r = this.find(i);
      if (!out.has(r)) out.set(r, []);
      out.get(r).push(i);
    }
    return [...out.values()];
  }
}

/** Collapses duplicates into the best representative: lowest tier, then earliest. Signals take the max. */
function mergeGroup(group) {
  const sorted = [...group].sort(byRep);
  const rep = { ...sorted[0], signals: { ...sorted[0].signals } };
  rep.author = sorted.find((i) => i.author)?.author ?? null;
  for (const key of SIGNAL_KEYS) {
    const values = sorted.map((i) => i.signals[key]).filter((v) => v != null);
    rep.signals[key] = values.length ? Math.max(...values) : null;
  }
  rep.mergedSources = [...new Set(sorted.flatMap((i) => i.mergedSources ?? [i.source]))].sort();
  return rep;
}

const mergeBy = (items, groups) => groups.map((g) => (g.length === 1 ? mergeGroup([items[g[0]]]) : mergeGroup(g.map((i) => items[i]))));

/** Step 1: one item per canonicalUrl. */
export function exactDedupe(items) {
  const byUrl = new Map();
  items.forEach((item, i) => {
    if (!byUrl.has(item.canonicalUrl)) byUrl.set(item.canonicalUrl, []);
    byUrl.get(item.canonicalUrl).push(i);
  });
  return mergeBy(items, [...byUrl.values()]);
}

/** Step 2: titles with Jaccard >= threshold (and 2+ shared tokens) published within the window are one story. */
export function nearDedupe(items, { nearDupHours, nearDupJaccard }) {
  const order = items.map((_, i) => i).sort((a, b) => ms(items[a]) - ms(items[b]) || a - b);
  const tokens = items.map((i) => tokenize(i.title));
  const uf = new UnionFind(items.length);
  for (let x = 0; x < order.length; x++) {
    const i = order[x];
    for (let y = x + 1; y < order.length; y++) {
      const j = order[y];
      if (ms(items[j]) - ms(items[i]) > nearDupHours * HOUR) break;
      if (sharedCount(tokens[i], tokens[j]) >= 2 && jaccard(tokens[i], tokens[j]) >= nearDupJaccard) uf.union(i, j);
    }
  }
  return mergeBy(items, uf.groups());
}

/** Lead item: tier 1 if present, else earliest. */
function pickLead(members) {
  const tier1 = members.filter((m) => m.sourceTier === 1);
  return [...(tier1.length ? tier1 : members)].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id))[0];
}

/** Entities shared by 2+ members (most common first); falls back to the lead's own entities. */
function keyEntities(memberEntities, leadEntities) {
  const counts = new Map();
  for (const set of memberEntities) for (const e of set) counts.set(e, (counts.get(e) ?? 0) + 1);
  const shared = [...counts].filter(([, n]) => n >= 2).sort((a, b) => isVersionToken(b[0]) - isVersionToken(a[0]) || b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([e]) => e);
  return (shared.length ? shared : [...leadEntities].sort()).slice(0, 5);
}

/** Step 3: groups of items about the same event. Returns arrays of item indexes (size >= 2 only). */
export function clusterIndexes(items, { clusterHours }) {
  const n = items.length;
  const tokens = items.map((i) => tokenize(i.title));
  const entities = items.map((i) => entitiesOf(i.title));
  const df = new Map();
  const entityDf = new Map();
  for (const set of tokens) for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
  for (const set of entities) for (const e of set) entityDf.set(e, (entityDf.get(e) ?? 0) + 1);

  const idf = (t) => Math.log(1 + n / df.get(t));
  const norm = tokens.map((set) => Math.sqrt([...set].reduce((sum, t) => sum + idf(t) ** 2, 0)) || 1);

  const postings = new Map();
  tokens.forEach((set, i) => {
    for (const t of set) {
      if (df.get(t) < 2 || df.get(t) > MAX_POSTING) continue;
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push(i);
    }
  });
  const dots = new Map();
  for (const [t, list] of postings) {
    const w = idf(t) ** 2;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const key = list[a] * n + list[b];
        dots.set(key, (dots.get(key) ?? 0) + w);
      }
    }
  }

  // Two stories from the same lone source are that source's series, not coverage of one event.
  const sameLoneSource = (a, b) => items[a].mergedSources.length === 1 && items[b].mergedSources.length === 1 && items[a].mergedSources[0] === items[b].mergedSources[0];

  const links = [];
  for (const [key, dot] of dots) {
    const i = Math.floor(key / n);
    const j = key % n;
    if (sameLoneSource(i, j)) continue;
    if (Math.abs(ms(items[i]) - ms(items[j])) > clusterHours * HOUR) continue;
    const cos = dot / (norm[i] * norm[j]);
    const shared = [...entities[i]].filter((e) => entities[j].has(e));
    const specific = shared.some((e) => isVersionToken(e) || entityDf.get(e) <= SPECIFIC_ENTITY_MAX_DF);
    if (cos >= COS_STRONG || (shared.length >= 2 && cos >= COS_TWO_ENTITIES) || (specific && cos >= COS_ONE_SPECIFIC)) {
      links.push({ i, j, cos });
    }
  }
  links.sort((a, b) => b.cos - a.cos || a.i - b.i || a.j - b.j);

  const uf = new UnionFind(n);
  for (const { i, j } of links) uf.union(i, j, MAX_CLUSTER_SIZE);
  // A cluster needs coverage from at least two distinct sources.
  return uf.groups().filter((g) => g.length >= 2 && new Set(g.flatMap((i) => items[i].mergedSources)).size >= 2);
}

/** Community signals normalized to 0..COMMUNITY_MAX (log scale, mean of whichever signals exist). */
export function communityScore(signals) {
  const parts = Object.entries(SIGNAL_CAPS)
    .map(([key, cap]) => (signals[key] == null ? null : Math.min(1, Math.log10(1 + Math.max(0, signals[key])) / Math.log10(1 + cap))))
    .filter((v) => v != null);
  return parts.length ? (COMMUNITY_MAX * parts.reduce((a, b) => a + b, 0)) / parts.length : 0;
}

export const preScoreOf = (item) =>
  round2(TIER_WEIGHT[item.sourceTier] + Math.min(item.signals.crossSourceCount, MAX_CROSS) + communityScore(item.signals));

/**
 * Summarizes the last editions: which item ids were featured, and every listed title's entities
 * (used to measure how big a topic was on earlier days).
 * @param {Array<{date: string, edition: any}>} editions
 */
export function summarizeEditions(editions) {
  return editions.map(({ date, edition }) => {
    const all = new Map();
    const featured = new Set();
    const add = (item) => item?.id && all.set(item.id, item);
    for (const item of [edition.lead, ...(edition.top ?? []), ...(edition.innovations ?? [])]) {
      add(item);
      if (item?.id) featured.add(item.id);
    }
    for (const items of Object.values(edition.byCategory ?? {})) {
      for (const item of items) {
        add(item);
        if (item.featuredSlot) featured.add(item.id);
      }
    }
    return { date, featured, entities: [...all.values()].map((i) => entitiesOf(i.title ?? '')) };
  });
}

/** Today's topic size minus its average size over the prior editions; null when there is nothing to compare. */
function trendDeltaFor(size, keys, history) {
  if (!history.length) return null;
  if (keys.length < 2 && !keys.some(isVersionToken)) return null; // one generic name would match everything
  const need = Math.min(2, keys.length);
  const sizes = history.map((day) => day.entities.filter((set) => keys.filter((k) => set.has(k)).length >= need).length);
  return round2(size - sizes.reduce((a, b) => a + b, 0) / sizes.length);
}

/**
 * @param {any[]} rawItems RawItem[] from data/raw/<date>.json
 * @param {{ editions?: Array<{date: string, edition: any}>, cap?: number, perSourceCap?: number|null,
 *           nearDupHours?: number, nearDupJaccard?: number, clusterHours?: number }} [options]
 */
export function dedupe(rawItems, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const history = summarizeEditions(options.editions ?? []);

  const afterExact = exactDedupe(rawItems);
  const stories = nearDedupe(afterExact, opts);
  stories.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id));

  // Clusters (full, before the cap) and per-item cluster facts.
  const groups = clusterIndexes(stories, opts);
  const entities = stories.map((s) => entitiesOf(s.title));
  const clusters = groups.map((idx) => {
    const members = idx.map((i) => stories[i]);
    const lead = pickLead(members);
    const keys = keyEntities(idx.map((i) => entities[i]), entities[stories.indexOf(lead)]);
    return {
      id: `c-${createHash('sha1').update(lead.id).digest('hex').slice(0, 10)}`,
      label: truncate(lead.title, 80),
      members,
      lead,
      sources: [...new Set(members.flatMap((m) => m.mergedSources))].sort(),
      size: members.length,
      entities: keys,
      trendDelta: trendDeltaFor(members.length, keys, history),
    };
  });
  const clusterOf = new Map();
  for (const c of clusters) for (const m of c.members) clusterOf.set(m.id, c);

  const featuredBefore = new Set(history.flatMap((d) => [...d.featured]));
  const scored = stories.map((story, i) => {
    const cluster = clusterOf.get(story.id);
    const own = entities[i];
    const keys = [...own].sort();
    const item = {
      ...story,
      signals: { ...story.signals, crossSourceCount: cluster ? cluster.sources.length : story.mergedSources.length },
      clusterId: cluster?.id ?? null,
      previouslyFeatured: featuredBefore.has(story.id),
      trendDelta: cluster ? cluster.trendDelta : trendDeltaFor(1, keys, history),
    };
    item.preScore = preScoreOf(item);
    return item;
  });

  // Cap: tier-1 first, then by preScore; ties go to the newest. Optional per-source limit.
  const priority = (a, b) =>
    (a.sourceTier === 1 ? 0 : 1) - (b.sourceTier === 1 ? 0 : 1) ||
    b.preScore - a.preScore ||
    b.publishedAt.localeCompare(a.publishedAt) ||
    a.id.localeCompare(b.id);
  const ranked = [...scored].sort(priority);
  const perSource = new Map();
  const kept = [];
  for (const item of ranked) {
    if (kept.length >= opts.cap) break;
    const used = perSource.get(item.source) ?? 0;
    if (opts.perSourceCap != null && used >= opts.perSourceCap) continue;
    perSource.set(item.source, used + 1);
    kept.push(item);
  }

  // Keep cluster records for the items that survived; re-pick the lead if the cap removed it.
  const keptIds = new Set(kept.map((i) => i.id));
  const outClusters = [];
  for (const c of clusters) {
    const members = c.members.filter((m) => keptIds.has(m.id));
    if (!members.length) continue;
    const lead = keptIds.has(c.lead.id) ? c.lead : pickLead(members);
    outClusters.push({
      id: c.id,
      label: truncate(lead.title, 80),
      itemIds: members.map((m) => m.id).sort(),
      leadItemId: lead.id,
      sources: c.sources,
      size: c.size,
      entities: c.entities,
      trendDelta: c.trendDelta,
    });
  }
  outClusters.sort((a, b) => b.size - a.size || b.sources.length - a.sources.length || a.id.localeCompare(b.id));

  // Every cluster found, with how many of its stories made it into the capped set (for reporting).
  const allClusters = clusters
    .map((c) => ({ id: c.id, label: truncate(c.lead.title, 80), size: c.size, sources: c.sources, kept: c.members.filter((m) => keptIds.has(m.id)).length, entities: c.entities, trendDelta: c.trendDelta }))
    .sort((a, b) => b.size - a.size || b.sources.length - a.sources.length || a.id.localeCompare(b.id));

  return {
    items: kept,
    clusters: outClusters,
    allClusters,
    stats: {
      before: rawItems.length,
      afterExact: afterExact.length,
      afterNearDup: stories.length,
      clusters: clusters.length,
      afterCap: kept.length,
      priorEditions: history.length,
    },
  };
}
