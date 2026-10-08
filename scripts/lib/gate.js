// The checks an edition must pass before it is published. Pure functions; scripts/gate.js runs them.
import { editionItems, editionProblems } from './rank.js';
import { schemaErrors } from './schemas.js';
import { semanticErrors } from './semantic.js';

export const MIN_RANKED = 20;
// If this share of the featured links fail at once, the problem is almost certainly our network, not the links.
export const MAX_DEAD_SHARE = 0.5;

/** Everything the page features: lead, top 5, innovations and each trending cluster's lead item, once each. */
export function featuredItems(edition) {
  const pool = new Map(editionItems(edition).map((item) => [item.id, item]));
  const ids = [edition.lead.id, ...edition.top.map((i) => i.id), ...edition.innovations.map((i) => i.id), ...edition.trending.map((c) => c.leadItemId)];
  return [...new Set(ids)].map((id) => pool.get(id)).filter(Boolean);
}

/** Groups of distinct items that share a URL (as given, or canonical). */
export function duplicateUrls(edition) {
  const seen = new Map();
  for (const item of editionItems(edition)) {
    for (const url of new Set([item.url, item.canonicalUrl])) {
      if (!seen.has(url)) seen.set(url, []);
      seen.get(url).push(item.id);
    }
  }
  return [...seen].filter(([, ids]) => ids.length > 1).map(([url, ids]) => ({ url, ids }));
}

/** Schema, structure and rule problems that need no network. Empty means the edition is publishable. */
export function structuralProblems(edition, { minRanked = MIN_RANKED } = {}) {
  const schema = schemaErrors('edition', edition);
  if (schema.length) return schema.slice(0, 10).map((e) => `schema: ${e}`);
  const problems = [];
  problems.push(...semanticErrors('edition', edition, 'edition.json').map((e) => `structure: ${e}`));
  problems.push(...editionProblems(edition).map((e) => `rules: ${e}`));
  if (!edition.lead?.title) problems.push('there is no lead story');
  if (edition.stats.ranked < minRanked) problems.push(`only ${edition.stats.ranked} items were ranked; at least ${minRanked} are required`);
  for (const d of duplicateUrls(edition)) problems.push(`duplicate URL ${d.url} (items ${d.ids.map((i) => i.slice(0, 8)).join(', ')})`);
  return problems;
}

/**
 * Turns link-check results into a decision.
 * @param {Array<{id: string, url: string}>} featured
 * @param {Array<{ok: boolean, status: number|null, error?: string}>} results same order as featured
 * @returns {{ failed: Array<{id: string, url: string, reason: string}>, looksBroken: boolean }}
 */
export function planDrops(featured, results) {
  const failed = featured.flatMap((item, i) => (results[i].ok ? [] : [{ id: item.id, url: item.url, reason: results[i].error ?? `HTTP ${results[i].status}` }]));
  return { failed, looksBroken: featured.length > 0 && failed.length / featured.length >= MAX_DEAD_SHARE };
}

/** Adds new drops to an existing dropped-file document (one entry per id). */
export function mergeDropped(existing, date, failed, checkedAt) {
  const byId = new Map((existing?.dropped ?? []).map((d) => [d.id, d]));
  for (const f of failed) byId.set(f.id, { id: f.id, url: f.url, reason: f.reason.slice(0, 200), checkedAt });
  return { date, dropped: [...byId.values()] };
}
