// On-topic filter for community sources (sources/keywords.json). Matches whole words or phrases,
// case-insensitively, against the title only.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compile = (terms) =>
  terms.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null;

/** @param {{ include: string[], exclude: string[] }} keywords */
export function createKeywordFilter({ include, exclude }) {
  const inc = compile(include);
  const exc = compile(exclude);
  return (title) => Boolean(inc?.test(title)) && !exc?.test(title);
}
