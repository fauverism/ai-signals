import { canonicalizeUrl, itemId } from './url.js';
import { truncate } from './feed.js';

const NO_SIGNALS = {
  hnPoints: null,
  hnComments: null,
  redditScore: null,
  githubStars: null,
  githubStarsDelta: null,
  crossSourceCount: 1,
};

/**
 * Builds a RawItem from a parsed feed/API item. Throws with a short reason if the item is unusable.
 * Signals the source doesn't provide stay null; crossSourceCount starts at 1 (dedupe raises it).
 */
export function buildRawItem(source, item, fetchedAt) {
  const canonicalUrl = canonicalizeUrl(item.url, source.url);
  if (!canonicalUrl) throw new Error(`bad URL "${String(item.url).slice(0, 80)}"`);
  if (!item.title) throw new Error(`no title (${canonicalUrl})`);
  if (!item.publishedAt) throw new Error(`no usable date (${canonicalUrl})`);
  return {
    id: itemId(canonicalUrl),
    url: new URL(item.url, source.url).href,
    canonicalUrl,
    title: truncate(item.title, 300),
    source: truncate(source.name, 80),
    sourceTier: source.tier,
    categoryHint: source.defaultCategory ?? null,
    author: item.author ?? null,
    publishedAt: item.publishedAt,
    fetchedAt,
    signals: { ...NO_SIGNALS, ...item.signals },
  };
}
