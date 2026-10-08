// Pure generators for the files scripts/build.js writes: RSS feed, sitemap, search index, social metadata.
import { editionItems } from './rank.js';

export const FEED_EDITIONS = 7;
export const SEARCH_EDITIONS = 30;
export const OG_KEEP = 14;
export const OG_DESCRIPTION_MAX = 300;
export const PAGES = ['', 'archive.html', 'about.html', 'methodology.html', 'subscribe.html'];

export const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const attr = xmlEscape;
export const rfc822 = (iso) => new Date(iso).toUTCString();
export const trimSlash = (url) => url.replace(/\/+$/, '');

const dateFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
/** "2026-10-08" -> "Thursday, October 8, 2026" */
export const longDate = (date) => dateFormat.format(new Date(`${date}T12:00:00Z`));

/** Lead, top 5 and innovations, in that order, each once. */
export function feedItems(edition) {
  const seen = new Set();
  return [edition.lead, ...edition.top, ...edition.innovations].filter((item) => !seen.has(item.id) && seen.add(item.id));
}

/**
 * RSS 2.0. Each item links to the original publisher and carries our own summary as its description.
 * @param {{ siteUrl: string, editions: any[] }} input editions newest first
 */
export function buildFeed({ siteUrl, editions }) {
  const base = trimSlash(siteUrl);
  const recent = editions.slice(0, FEED_EDITIONS);
  const items = recent.flatMap((edition) =>
    feedItems(edition).map(
      (item) => `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${xmlEscape(item.url)}</link>
      <guid isPermaLink="false">${xmlEscape(item.id)}</guid>
      <pubDate>${rfc822(edition.generatedAt)}</pubDate>
      <category>${xmlEscape(item.category)}</category>
      <description>${xmlEscape(item.summary)}</description>
    </item>`,
    ),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>AI Signal</title>
    <link>${xmlEscape(`${base}/`)}</link>
    <description>The day in AI, ranked: news, research, tutorials, tools and releases. Every link goes to the original publisher.</description>
    <language>en-us</language>
    <lastBuildDate>${rfc822(recent[0].generatedAt)}</lastBuildDate>
    <atom:link href="${attr(`${base}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>
`;
}

/** Sitemap: the static pages plus one URL per edition. */
export function buildSitemap({ siteUrl, archive, latestDate }) {
  const base = trimSlash(siteUrl);
  const url = (loc, lastmod) => `  <url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  const pages = PAGES.map((p) => url(`${base}/${p}`, p === '' || p === 'archive.html' ? latestDate : null));
  const editions = archive.map((e) => url(`${base}/edition.html?date=${e.date}`, e.date));
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...pages, ...editions].join('\n')}
</urlset>
`;
}

/** Compact search index over the newest editions, one entry per item (newest edition wins). */
export function buildSearchIndex(editions) {
  const seen = new Set();
  const out = [];
  for (const edition of editions.slice(0, SEARCH_EDITIONS)) {
    for (const item of editionItems(edition)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({ id: item.id, t: item.title, u: item.url, s: item.source, c: item.category, g: item.tags, m: item.summary, d: edition.date });
    }
  }
  return out;
}

/** The editor's note as a social description: whole words, at most `max` characters. */
export function ogDescription(note, max = OG_DESCRIPTION_MAX) {
  const text = note.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

export const ogImagePath = (date) => `og/${date}.png`;

/** Open Graph and Twitter tags for the homepage: title = lead headline, description = editor's note. */
export function ogMeta({ siteUrl, edition }) {
  const base = trimSlash(siteUrl);
  const title = attr(edition.lead.title);
  const desc = attr(ogDescription(edition.editorNote));
  const image = attr(`${base}/${ogImagePath(edition.date)}`);
  return [
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="AI Signal">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${attr(`${base}/`)}">`,
    `<meta property="og:image" content="${image}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${attr(`AI Signal, ${longDate(edition.date)}: ${edition.lead.title}`)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${image}">`,
  ].join('\n');
}

/** Rewrites the block between the og-meta markers; returns the page unchanged if it has none. */
export function stampOgMeta(html, meta) {
  return html.replace(/^([ \t]*)<!-- og-meta:start -->[\s\S]*?<!-- og-meta:end -->/m, (_, pad) => {
    const body = meta.split('\n').map((line) => pad + line).join('\n');
    return `${pad}<!-- og-meta:start -->\n${body}\n${pad}<!-- og-meta:end -->`;
  });
}
