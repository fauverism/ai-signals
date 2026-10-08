// Deterministic parts of ranking: totals, the Trend baseline, batching, featuring rules, edition assembly.
// Claude supplies the four scores and the text; everything derived from them lives here, in code.

export const WEIGHTS = { importance: 0.35, trend: 0.25, novelty: 0.25, credibility: 0.15 };
export const CATEGORIES = ['News', 'Research', 'Tutorials', 'Tools & Releases', 'Policy & Safety', 'Business', 'Opinion'];
export const EDITOR_NOTE_PLACEHOLDER = "PENDING: Claude writes the editor's note here (see prompts/rank-run.md).";

const LIMITS = { top: 5, innovations: 6, trending: 6, perCategory: 10, perOrgInTop: 2, maxFetches: 15 };
export const MAX_FETCHES = LIMITS.maxFetches;

// Integer weights (percent) keep the arithmetic exact: total = round((35i + 25t + 25n + 15c) / 10) / 10.
const WEIGHT_PCT = Object.fromEntries(Object.entries(WEIGHTS).map(([k, w]) => [k, Math.round(w * 100)]));

/** Weighted total to one decimal; credibility under 4 caps it at 5. */
export function totalOf({ importance, trend, novelty, credibility }) {
  const sum = WEIGHT_PCT.importance * importance + WEIGHT_PCT.trend * trend + WEIGHT_PCT.novelty * novelty + WEIGHT_PCT.credibility * credibility;
  const total = Math.round(sum / 10) / 10;
  return credibility < 4 ? Math.min(total, 5) : total;
}

/** The Trend score the numbers imply (the rubric's table). Claude may move it by at most 2. */
export function trendBaseline({ signals, trendDelta }) {
  const cross = Math.min(4, Math.max(0, (signals.crossSourceCount ?? 1) - 1));
  const d = trendDelta;
  const delta = d == null || d <= 0 ? 0 : d <= 2 ? 1 : d <= 4 ? 2 : d <= 6 ? 3 : 4;
  const notable = [
    signals.hnPoints >= 100,
    signals.hnComments >= 50,
    signals.redditScore >= 500,
    signals.githubStars >= 1000,
    signals.githubStarsDelta >= 300,
  ].filter(Boolean).length;
  return Math.min(10, cross + delta + Math.min(2, notable));
}

// --- Text rules -------------------------------------------------------------------------------

const HYPE = /\b(revolutionary|revolutionize[sd]?|game[- ]?chang(?:ing|er|ers)|insane(?:ly)?|groundbreaking|mind[- ]?blowing|stunning|jaw[- ]?dropping)\b/gi;
const QUOTED = /["“]([^"”]+)["”]/g;

/** Problems with a piece of published text: hype words and long quotations. */
export function textProblems(text, label) {
  const out = [];
  for (const [word] of text.matchAll(HYPE)) out.push(`${label}: hype word "${word}"`);
  for (const [, quoted] of text.matchAll(QUOTED)) {
    const words = quoted.trim().split(/\s+/).length;
    if (words > 15) out.push(`${label}: quotes ${words} words (limit 15)`);
  }
  return out;
}

export const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

// --- Batching ---------------------------------------------------------------------------------

/** Splits items into batches of ~size, never splitting a cluster. Clusters stay in first-seen order. */
export function makeBatches(items, size) {
  const byCluster = new Map();
  const groups = [];
  for (const item of items) {
    if (!item.clusterId) {
      groups.push([item]);
    } else if (byCluster.has(item.clusterId)) {
      byCluster.get(item.clusterId).push(item);
    } else {
      const g = [item];
      byCluster.set(item.clusterId, g);
      groups.push(g);
    }
  }
  const batches = [];
  let current = [];
  for (const g of groups) {
    if (current.length && current.length + g.length > size) {
      batches.push(current);
      current = [];
    }
    current.push(...g);
  }
  if (current.length) batches.push(current);
  return batches;
}

// --- From a scored judgment to a RankedItem ---------------------------------------------------

/**
 * Merges the deduped item with Claude's judgment. Returns { item, org, problems, notes }.
 * - total is recomputed; any model-written total is ignored
 * - trend must be within 2 of the baseline and explained when it differs
 */
export function buildRankedItem(deduped, judged) {
  const problems = [];
  const notes = [];
  const baseline = trendBaseline(deduped);
  const scores = { ...judged.scores };

  if (scores.trend !== baseline) {
    if (Math.abs(scores.trend - baseline) > 2) {
      notes.push(`${deduped.id}: trend ${scores.trend} is more than 2 from baseline ${baseline}; clamped`);
      scores.trend = Math.min(baseline + 2, Math.max(baseline - 2, scores.trend));
    }
    if (!judged.trendReason) problems.push(`${deduped.id}: trend differs from the baseline (${baseline}) but has no trendReason`);
  }
  if (judged.total != null && Math.abs(judged.total - totalOf(scores)) > 0.05) {
    notes.push(`${deduped.id}: ignored model-written total ${judged.total}; recomputed ${totalOf(scores)}`);
  }

  for (const [field, text] of [['summary', judged.summary], ['whyItMatters', judged.whyItMatters]]) {
    problems.push(...textProblems(text, `${deduped.id} ${field}`));
  }

  const item = {
    id: deduped.id,
    url: deduped.url,
    canonicalUrl: deduped.canonicalUrl,
    title: deduped.title,
    source: deduped.source,
    sourceTier: deduped.sourceTier,
    categoryHint: deduped.categoryHint,
    author: deduped.author,
    publishedAt: deduped.publishedAt,
    fetchedAt: deduped.fetchedAt,
    signals: deduped.signals,
    scores,
    total: totalOf(scores),
    category: judged.category,
    tags: judged.tags,
    summary: judged.summary,
    whyItMatters: judged.whyItMatters,
    featuredSlot: null,
    previouslyFeatured: deduped.previouslyFeatured,
  };
  return { item, org: judged.organization?.trim().toLowerCase() || null, problems, notes };
}

// --- Featuring --------------------------------------------------------------------------------

/** Highest total first; ties go to higher credibility, then earlier publication, then id. */
export const byRank = (a, b) =>
  b.item.total - a.item.total ||
  b.item.scores.credibility - a.item.scores.credibility ||
  a.item.publishedAt.localeCompare(b.item.publishedAt) ||
  a.item.id.localeCompare(b.item.id);

const byNovelty = (a, b) => b.item.scores.novelty - a.item.scores.novelty || byRank(a, b);

/**
 * Applies the rubric's featuring rules to entries of { item, org, clusterId }.
 * Returns { lead, leadFallback, top, innovations, notes }, or { error } when a slot can't be filled.
 */
export function selectFeatured(entries) {
  const sorted = [...entries].sort(byRank);
  const notes = [];

  const choose = (forceTop) => {
    const usedClusters = new Set();
    const claim = (e) => {
      if (e.clusterId && usedClusters.has(e.clusterId)) return false;
      if (e.clusterId) usedClusters.add(e.clusterId);
      return true;
    };

    // lead: credibility >= 7 and not previously featured; relax in a fixed order if nothing qualifies.
    const levels = [
      [(e) => e.item.scores.credibility >= 7 && !e.item.previouslyFeatured, null],
      [(e) => e.item.scores.credibility >= 7, 'allowed a previously featured item'],
      [(e) => e.item.scores.credibility >= 6, 'relaxed credibility to 6'],
    ];
    let lead = null;
    let leadFallback = null;
    for (const [test, label] of levels) {
      lead = sorted.find(test);
      if (lead) {
        leadFallback = label;
        break;
      }
    }
    if (!lead) return { error: 'no item qualifies for lead (credibility >= 6)' };
    claim(lead);

    // top: next 5, at most 2 per organization, one per cluster. A forced Tutorials pick goes in first.
    const top = [];
    const orgCount = new Map();
    const add = (e) => {
      if (e.org && (orgCount.get(e.org) ?? 0) >= LIMITS.perOrgInTop) return false;
      if (!claim(e)) return false;
      if (e.org) orgCount.set(e.org, (orgCount.get(e.org) ?? 0) + 1);
      top.push(e);
      return true;
    };
    if (forceTop) add(forceTop);
    for (const e of sorted) {
      if (top.length >= LIMITS.top) break;
      if (e === lead || top.includes(e)) continue;
      add(e);
    }
    if (top.length < LIMITS.top) return { error: `only ${top.length} items are eligible for top (need ${LIMITS.top})` };
    top.sort(byRank);

    const innovations = [];
    for (const e of [...sorted].sort(byNovelty)) {
      if (innovations.length >= LIMITS.innovations) break;
      if (e.item.scores.novelty < 8 || e === lead || top.includes(e)) continue;
      if (claim(e)) innovations.push(e);
    }
    return { lead, leadFallback, top, innovations };
  };

  let result = choose(null);
  if (result.error) return result;

  // Tutorials: if any scores >= 6, one must be in top or innovations.
  const tutorials = sorted.filter((e) => e.item.category === 'Tutorials' && e.item.total >= 6 && e !== result.lead);
  if (tutorials.length && !tutorials.some((e) => result.top.includes(e) || result.innovations.includes(e))) {
    const forced = choose(tutorials[0]);
    if (!forced.error && forced.top.includes(tutorials[0])) {
      notes.push(`Tutorials rule: moved "${tutorials[0].item.title}" into top`);
      result = forced;
    } else {
      notes.push('Tutorials rule: no Tutorials item could be placed (cluster or organization conflict)');
    }
  }
  if (result.leadFallback) notes.push(`lead: ${result.leadFallback}`);
  return { ...result, notes };
}

/**
 * Builds the Edition from ranked entries and the deduped clusters.
 * @param {Array<{item: any, org: string|null, clusterId: string|null}>} entries
 * @param {{ date: string, generatedAt: string, editorNote: string, clusters: any[], labels: Map<string,string>, stats: any }} ctx
 * @returns {{ edition?: any, errors: string[], notes: string[] }}
 */
export function buildEdition(entries, ctx) {
  const errors = [];
  const sel = selectFeatured(entries);
  if (sel.error) return { errors: [sel.error], notes: [] };
  const notes = [...sel.notes];

  const slot = new Map();
  slot.set(sel.lead.item.id, 'lead');
  sel.top.forEach((e) => slot.set(e.item.id, 'top'));
  sel.innovations.forEach((e) => slot.set(e.item.id, 'innovation'));

  // trending: up to 6 clusters, biggest trendDelta first (null last).
  const byId = new Map(entries.map((e) => [e.item.id, e]));
  const candidates = ctx.clusters
    .map((c) => ({ c, members: c.itemIds.filter((id) => byId.has(id)).map((id) => byId.get(id)).sort(byRank) }))
    .filter(({ members }) => members.length)
    .sort((a, b) => (b.c.trendDelta ?? -Infinity) - (a.c.trendDelta ?? -Infinity) || b.c.size - a.c.size || b.c.sources.length - a.c.sources.length || a.c.id.localeCompare(b.c.id))
    .slice(0, LIMITS.trending);

  const trending = candidates.map(({ c, members }) => {
    const label = ctx.labels.get(c.id);
    if (!label) errors.push(`trending cluster ${c.id} ("${c.label}") has no label in any scored file`);
    else if (wordCount(label) < 3 || wordCount(label) > 6) errors.push(`trending cluster ${c.id} label "${label}" must be 3-6 words`);
    else errors.push(...textProblems(label, `cluster ${c.id} label`));
    const lead = members.find((m) => m.item.id === c.leadItemId) ?? members[0];
    if (!slot.has(lead.item.id)) slot.set(lead.item.id, 'trending');
    return { c, label, members, lead };
  });

  for (const e of entries) e.item.featuredSlot = slot.get(e.item.id) ?? null;

  // byCategory: slotted items first so featured items are always listed, then the best of the rest.
  const byCategory = Object.fromEntries(CATEGORIES.map((cat) => [cat, []]));
  const ranked = [...entries].sort(byRank);
  for (const cat of CATEGORIES) {
    const inCat = ranked.filter((e) => e.item.category === cat);
    const chosen = [...inCat.filter((e) => e.item.featuredSlot), ...inCat.filter((e) => !e.item.featuredSlot)].slice(0, LIMITS.perCategory);
    byCategory[cat] = chosen.sort(byRank).map((e) => e.item);
  }
  const pool = new Set([sel.lead.item.id, ...sel.top.map((e) => e.item.id), ...sel.innovations.map((e) => e.item.id), ...Object.values(byCategory).flat().map((i) => i.id)]);

  const trendingClusters = trending
    .map(({ c, label, members, lead }) => {
      const itemIds = members.map((m) => m.item.id).filter((id) => pool.has(id));
      if (!itemIds.length) return null;
      return {
        id: c.id,
        label: label ?? c.label,
        itemIds,
        leadItemId: itemIds.includes(lead.item.id) ? lead.item.id : itemIds[0],
        sources: c.sources,
        trendDelta: c.trendDelta ?? null,
      };
    })
    .filter(Boolean);

  const edition = {
    date: ctx.date,
    generatedAt: ctx.generatedAt,
    editorNote: ctx.editorNote,
    lead: sel.lead.item,
    top: sel.top.map((e) => e.item),
    innovations: sel.innovations.map((e) => e.item),
    trending: trendingClusters,
    byCategory,
    stats: ctx.stats,
  };
  return { edition, errors, notes };
}

/** Distinct items an edition lists (lead, top, innovations and byCategory). */
export const editionItems = (edition) => {
  const all = new Map();
  for (const i of [edition.lead, ...edition.top, ...edition.innovations, ...Object.values(edition.byCategory).flat()]) all.set(i.id, i);
  return [...all.values()];
};

/** Re-checks an edition against the rubric's rules (used after Claude edits the editor's note). */
export function editionProblems(edition) {
  const out = [];
  const items = editionItems(edition);
  // Check every occurrence, not one per id: an item is listed in several places and each copy must be right.
  const occurrences = [[edition.lead, 'lead'], ...edition.top.map((i) => [i, 'top']), ...edition.innovations.map((i) => [i, 'innovations']), ...Object.entries(edition.byCategory).flatMap(([cat, list]) => list.map((i) => [i, `byCategory.${cat}`]))];
  for (const [i, where] of occurrences) {
    if (i.total !== totalOf(i.scores)) out.push(`${where} ${i.id}: total ${i.total} does not match its scores (${totalOf(i.scores)})`);
  }
  for (const i of items) out.push(...textProblems(i.summary, `${i.id} summary`), ...textProblems(i.whyItMatters, `${i.id} whyItMatters`));
  if (edition.lead.scores.credibility < 6) out.push('lead: credibility is below 6');
  for (const i of edition.innovations) if (i.scores.novelty < 8) out.push(`innovation ${i.id}: novelty ${i.scores.novelty} is below 8`);
  for (const c of edition.trending) {
    if (wordCount(c.label) < 3 || wordCount(c.label) > 6) out.push(`trending ${c.id}: label "${c.label}" must be 3-6 words`);
  }
  const tutorials = items.filter((i) => i.category === 'Tutorials' && i.total >= 6 && i.id !== edition.lead.id);
  const featured = new Set([...edition.top, ...edition.innovations].map((i) => i.id));
  if (tutorials.length && !tutorials.some((i) => featured.has(i.id))) out.push('Tutorials rule: a Tutorials item scored >= 6 but none is in top or innovations');
  if (edition.editorNote === EDITOR_NOTE_PLACEHOLDER) out.push("editorNote is still the placeholder; write the editor's note");
  else out.push(...textProblems(edition.editorNote, 'editorNote'));
  return out;
}

/** The archive entry for an edition. count = distinct items it lists. */
export const archiveEntry = (edition) => ({ date: edition.date, leadTitle: edition.lead.title.slice(0, 300), count: editionItems(edition).length });

/** Inserts or replaces an edition's entry, newest first. */
export const upsertArchive = (archive, entry) => [...archive.filter((a) => a.date !== entry.date), entry].sort((a, b) => b.date.localeCompare(a.date));
