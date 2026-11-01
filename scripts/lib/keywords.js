// Topic filters (sources/keywords.json). Match whole words or phrases, case-insensitively, against the title only.
// The edition covers AI *and* UI/UX, so a title has to land in that overlap:
//   `include` = AI terms, `focus` = UI / UX / visual-design terms, `exclude` always wins.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compile = (terms = []) =>
  terms.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null;

/** @param {{ include: string[], exclude: string[] }} keywords  True when the title has an include term and no exclude term. */
export function createKeywordFilter({ include, exclude }) {
  const inc = compile(include);
  const exc = compile(exclude);
  return (title) => Boolean(inc?.test(title)) && !exc?.test(title);
}

/**
 * Per-source filter for the AI x UI/UX overlap, chosen by the source's `scope`:
 *   "ai" (default)  an AI source: the title needs a focus (UI/UX/design) term; tier 3 also needs an AI term.
 *   "design"        a design source: the title needs an AI term.
 *   "both"          the source already covers AI in design: only `exclude` applies.
 * @param {{ include: string[], focus?: string[], exclude: string[] }} keywords
 * @returns {(source: { scope?: string, tier: number }, title: string) => boolean}
 */
export function createTopicFilter({ include, focus = [], exclude }) {
  const ai = compile(include);
  const design = compile(focus);
  const exc = compile(exclude);
  const has = (re, title) => Boolean(re?.test(title));
  return (source, title) => {
    if (has(exc, title)) return false;
    const scope = source.scope ?? 'ai';
    if (scope === 'both') return true;
    if (scope === 'design') return has(ai, title);
    return has(design, title) && (source.tier !== 3 || has(ai, title));
  };
}
