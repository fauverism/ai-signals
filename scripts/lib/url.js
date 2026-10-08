import { createHash } from 'node:crypto';

const TRACKING_PARAMS = new Set(['ref', 'ref_src', 'fbclid', 'gclid', 'mc_cid', 'mc_eid']);
const isTracking = (name) => name.startsWith('utm_') || TRACKING_PARAMS.has(name);

// Mobile / alias subdomains that serve the same content as the bare host.
const HOST_ALIASES = new Map([
  ['old.reddit.com', 'reddit.com'],
  ['np.reddit.com', 'reddit.com'],
  ['m.reddit.com', 'reddit.com'],
  ['export.arxiv.org', 'arxiv.org'],
]);

// arxiv.org/{abs,pdf,html}/<id>[vN][.pdf] -> arxiv.org/abs/<id>. IDs are 2610.00417 or cs/0301001.
function canonicalArxivPath(pathname) {
  const m = pathname.match(/^\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/);
  if (!m) return null;
  return `/abs/${m[1].replace(/v\d+$/, '')}`;
}

/**
 * Returns the canonical form of an http(s) URL, or null if it isn't one.
 * https, lowercase host without www., no fragment, no tracking params, sorted query, no trailing slash.
 */
export function canonicalizeUrl(input, base) {
  let u;
  try {
    u = new URL(input, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  let host = u.hostname.toLowerCase().replace(/^www\./, '');
  host = HOST_ALIASES.get(host) ?? host;
  const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : '';

  let pathname = u.pathname;
  let search = '';
  if (host === 'arxiv.org') {
    pathname = canonicalArxivPath(pathname) ?? pathname;
  } else {
    const kept = [...u.searchParams].filter(([k]) => !isTracking(k.toLowerCase()));
    kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (kept.length) search = `?${new URLSearchParams(kept)}`;
  }
  pathname = pathname.replace(/\/+$/, '');

  return `https://${host}${port}${pathname}${search}`;
}

/** Item id: sha1 hex of the canonical URL. */
export const itemId = (canonicalUrl) => createHash('sha1').update(canonicalUrl).digest('hex');
