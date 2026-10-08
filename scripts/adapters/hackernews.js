// Hacker News via the Algolia search API (https://hn.algolia.com/api).
import { toUtcIso } from '../lib/dates.js';

/** @type {import('./index.js').Adapter['request']} */
export function request(source, { now, windowHours }) {
  const u = new URL(source.url);
  const since = Math.floor(now.getTime() / 1000 - windowHours * 3600);
  const filters = (u.searchParams.get('numericFilters') ?? '').split(',').filter((f) => f && !f.startsWith('created_at_i'));
  u.searchParams.set('numericFilters', [...filters, `created_at_i>${since}`].join(','));
  return { url: u.toString() };
}

/** @type {import('./index.js').Adapter['parse']} */
export function parse(json) {
  const hits = /** @type {any} */ (json)?.hits;
  if (!Array.isArray(hits)) throw new Error('unexpected Algolia response: no hits array');
  return hits.map((h) => ({
    title: String(h.title ?? h.story_title ?? '').trim(),
    // Ask HN / text posts have no external URL: link to the discussion itself.
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    // The submitter is not the article's author.
    author: null,
    publishedAt: Number.isFinite(h.created_at_i) ? toUtcIso(new Date(h.created_at_i * 1000)) : null,
    signals: { hnPoints: h.points ?? null, hnComments: h.num_comments ?? null },
  }));
}
