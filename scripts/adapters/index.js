// Adapters turn an `api` source into collectable items. One per API host.
import * as hackernews from './hackernews.js';
import * as github from './github.js';

/**
 * @typedef {Object} Signals
 * @property {number|null} hnPoints
 * @property {number|null} hnComments
 * @property {number|null} redditScore
 * @property {number|null} githubStars
 * @property {number|null} githubStarsDelta
 */

/**
 * @typedef {Object} AdapterItem
 * @property {string} title
 * @property {string} url
 * @property {string|null} author
 * @property {string|null} publishedAt  ISO 8601 UTC
 * @property {Partial<Signals>} signals  only the signals this API provides
 */

/**
 * @typedef {Object} AdapterContext
 * @property {Date} now
 * @property {number} windowHours
 */

/**
 * @typedef {Object} Adapter
 * @property {(source: {url: string}, ctx: AdapterContext) => {url: string, headers?: Record<string,string>}} request
 *   builds the request for this run (e.g. restricts results to the date window)
 * @property {(json: unknown) => AdapterItem[]} parse
 */

/** @type {Record<string, Adapter>} */
const byHost = {
  'hn.algolia.com': hackernews,
  'api.github.com': github,
};

/** @returns {Adapter|null} */
export const adapterFor = (url) => byHost[new URL(url).hostname] ?? null;
