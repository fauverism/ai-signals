// Archive search: plain functions, no DOM and no library, so they can be tested in Node.
// An index entry is { id, t: title, u: url, s: source, c: category, g: [tags], m: summary, d: 'YYYY-MM-DD' }.

export const MAX_RESULTS = 50;

/** Lowercased, whitespace-split search terms. */
export const termsOf = (query) => [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];

const fields = new WeakMap();
function lowered(entry) {
  if (!fields.has(entry)) fields.set(entry, { t: entry.t.toLowerCase(), g: entry.g.join(' ').toLowerCase(), m: entry.m.toLowerCase() });
  return fields.get(entry);
}

/**
 * Entries whose title, tags and summary together contain every term (substring, case-insensitive).
 * Ranked by where the terms hit (title 3, tag 2, summary 1 each), then newest first.
 * @returns {{ entries: object[], total: number }} at most MAX_RESULTS entries
 */
export function search(index, query) {
  const terms = termsOf(query);
  if (!terms.length) return { entries: [], total: 0 };
  const hits = [];
  for (const entry of index) {
    const f = lowered(entry);
    let score = 0;
    let all = true;
    for (const term of terms) {
      const inTitle = f.t.includes(term);
      const inTags = f.g.includes(term);
      const inSummary = f.m.includes(term);
      if (!inTitle && !inTags && !inSummary) {
        all = false;
        break;
      }
      score += (inTitle ? 3 : 0) + (inTags ? 2 : 0) + (inSummary ? 1 : 0);
    }
    if (all) hits.push({ entry, score });
  }
  hits.sort((a, b) => b.score - a.score || b.entry.d.localeCompare(a.entry.d) || a.entry.t.localeCompare(b.entry.t));
  return { entries: hits.slice(0, MAX_RESULTS).map((h) => h.entry), total: hits.length };
}

/** Splits text into [{ text, hit }] so matches can be wrapped in <mark> without touching innerHTML. */
export function segments(text, terms) {
  const lower = text.toLowerCase();
  const spans = [];
  for (const term of terms) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) spans.push([at, at + term.length]);
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  const out = [];
  let pos = 0;
  for (const [start, end] of merged) {
    if (start > pos) out.push({ text: text.slice(pos, start), hit: false });
    out.push({ text: text.slice(start, end), hit: true });
    pos = end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}

/** Runs `fn` once, `ms` after the last call. */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
