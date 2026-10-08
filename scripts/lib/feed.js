// RSS / Atom / RDF parsing. Only metadata is extracted (title, link, date, author);
// summaries and content bodies are never read, so they can't leak into /data.
import { XMLParser } from 'fast-xml-parser';
import { parseToUtcIso } from './dates.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  htmlEntities: true,
  isArray: (name) => ['item', 'entry', 'link', 'author', 'dc:creator'].includes(name),
});

/** Text of a parsed node, which may be a string, a number or { '#text': ... }. */
const textOf = (node) => {
  if (node == null) return '';
  if (Array.isArray(node)) return textOf(node[0]);
  if (typeof node === 'object') return textOf(node['#text']);
  return String(node);
};

const clean = (s) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function truncate(s, max) {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Long author lists (arXiv) are cut at a name boundary. */
function limitAuthors(s, max = 120) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 9);
  const at = cut.lastIndexOf(',');
  return `${(at > 0 ? cut.slice(0, at) : cut).trim()}, et al.`;
}

function pickLink(entry) {
  const links = entry.link ?? [];
  const candidates = links.map((l) =>
    typeof l === 'object' ? { href: l['@_href'] ?? l['#text'], rel: l['@_rel'] } : { href: l, rel: undefined },
  );
  const best = candidates.find((l) => l.href && (!l.rel || l.rel === 'alternate')) ?? candidates.find((l) => l.href);
  if (best) return String(best.href).trim();
  const guid = entry.guid;
  if (guid && typeof guid === 'object' && guid['@_isPermaLink'] === 'false') return '';
  return clean(textOf(guid));
}

function pickAuthor(entry) {
  const names = [];
  for (const a of entry['dc:creator'] ?? []) names.push(clean(textOf(a)));
  for (const a of entry.author ?? []) {
    // RSS: "me@example.com (Jane Doe)"; Atom: <author><name>Jane Doe</name></author>
    const raw = typeof a === 'object' && a.name !== undefined ? textOf(a.name) : textOf(a);
    const m = raw.match(/\(([^)]+)\)/);
    const name = clean(m ? m[1] : raw);
    if (name && !/^[^\s@]+@[^\s@]+$/.test(name)) names.push(name);
  }
  const joined = [...new Set(names.filter(Boolean))].join(', ');
  return joined ? limitAuthors(joined) : null;
}

/**
 * @typedef {{ title: string, url: string, author: string|null, publishedAt: string|null }} FeedItem
 * @param {string} xml
 * @returns {FeedItem[]}
 */
export function parseFeed(xml) {
  const doc = parser.parse(xml);
  const entries = doc.rss?.channel?.item ?? doc['rdf:RDF']?.item ?? doc.feed?.entry;
  if (!Array.isArray(entries)) throw new Error('not an RSS, RDF or Atom feed');

  const items = [];
  for (const e of entries) {
    // arXiv re-announces revised papers as "replace"; the original was already listed.
    if (/replace/i.test(textOf(e['arxiv:announce_type']))) continue;
    items.push({
      title: clean(textOf(e.title)),
      url: pickLink(e),
      author: pickAuthor(e),
      publishedAt: parseToUtcIso(
        textOf(e.pubDate) || textOf(e['dc:date']) || textOf(e.published) || textOf(e.updated) || textOf(e['dcterms:issued']),
      ),
    });
  }
  return items;
}
