// "Trending" AI/ML repositories via the GitHub search API: repos created inside the date window,
// ordered by stars. GitHub has no official Trending API. Set GITHUB_TOKEN for a higher rate limit.
import { parseToUtcIso, windowStart } from '../lib/dates.js';
import { truncate } from '../lib/feed.js';

/** @type {import('./index.js').Adapter['request']} */
export function request(source, { now, windowHours }) {
  const u = new URL(source.url);
  const since = windowStart(now, windowHours).toISOString().slice(0, 10);
  const q = (u.searchParams.get('q') ?? '').replace(/\s*created:\S+/g, '');
  u.searchParams.set('q', `${q} created:>=${since}`.trim());
  u.searchParams.set('sort', 'stars');
  u.searchParams.set('order', 'desc');
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return { url: u.toString(), headers };
}

/** @type {import('./index.js').Adapter['parse']} */
export function parse(json) {
  const repos = /** @type {any} */ (json)?.items;
  if (!Array.isArray(repos)) throw new Error('unexpected GitHub response: no items array');
  return repos.map((r) => ({
    // The one-line repo description acts as the title's subtitle; READMEs are never read.
    title: truncate(r.description ? `${r.full_name}: ${r.description}` : r.full_name, 300),
    url: r.html_url,
    author: r.owner?.login ?? null,
    publishedAt: parseToUtcIso(r.created_at),
    // The API reports the current star count only; a delta needs history we don't keep yet.
    signals: { githubStars: r.stargazers_count ?? null },
  }));
}
