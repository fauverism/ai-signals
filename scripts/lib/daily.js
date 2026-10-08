// Pure helpers for the scheduled daily run (scripts/daily.js is the runner).

/** Paths a run generates. A failed run's leftovers here are safe to discard at the start of the next one. */
export const GENERATED_ROOTS = [
  'data/raw', 'data/work', 'data/editions', 'data/latest.json', 'data/archive.json',
  'site/feed.xml', 'site/sitemap.xml', 'site/search-index.json', 'site/og',
];
// site/index.html is source *and* generated (only its og-meta block), so it is judged separately.
export const INDEX_HTML = 'site/index.html';
export const PUSH_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000];

/** `git status --porcelain` -> [{ xy, path }] */
export function parsePorcelain(text) {
  return text.split('\n').filter(Boolean).map((line) => ({ xy: line.slice(0, 2), path: line.slice(3).replace(/^"|"$/g, '').split(' -> ').at(-1) }));
}

const inRoot = (p, root) => p === root || p.startsWith(`${root}/`);

/** Splits changed paths into generated leftovers and everything else (which a run must not touch). */
export function classifyDirty(entries, { indexOnlyMeta = false } = {}) {
  const generated = [];
  const other = [];
  for (const { path: p } of entries) {
    const isGenerated = GENERATED_ROOTS.some((root) => inRoot(p, root)) || (p === INDEX_HTML && indexOnlyMeta);
    (isGenerated ? generated : other).push(p);
  }
  return { generated, other };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Per-day work files a fresh run must start without (batches, scored files, dropped links). */
export const staleWorkFiles = (date, names) => names.filter((n) => new RegExp(`^${escapeRe(date)}\\.(batch-\\d+|scored-\\d+|dropped)\\.json$`).test(n));

/** What an edition's commit contains: the day's data, the edition, and the site files built from it. */
export function publishSpecs(date) {
  return [
    `data/raw/${date}.json`, `data/raw/${date}.deduped.json`,
    `data/work/${date}.batch-*.json`, `data/work/${date}.scored-*.json`, `data/work/${date}.dropped.json`,
    `data/editions/${date}.json`, 'data/latest.json', 'data/archive.json',
    'site/feed.xml', 'site/sitemap.xml', 'site/search-index.json', 'site/og', INDEX_HTML,
  ];
}

const n = (x) => Number(x).toLocaleString('en-US');

/**
 * The five-line end-of-run summary: collected, after dedupe, ranked, lead headline, sources that errored.
 * @param {{ edition: any|null, collectLog: any|null, failure?: string|null }} input
 */
export function formatSummary({ edition, collectLog, failure = null }) {
  const errored = (collectLog?.sources ?? []).filter((s) => s.status === 'error');
  const stats = edition?.stats;
  return [
    `Collected: ${stats ? n(stats.collected) : collectLog ? n(collectLog.totals.kept) : 'n/a'} items${collectLog ? ` from ${collectLog.totals.sources} sources` : ''}`,
    `After dedupe: ${stats ? n(stats.afterDedupe) : 'n/a'} stories`,
    `Ranked: ${stats ? n(stats.ranked) : 'n/a'} items`,
    failure || !edition ? `Lead: none (run failed: ${failure ?? 'no edition was produced'})` : `Lead: ${edition.lead.title}`,
    errored.length ? `Source errors (${errored.length}): ${errored.map((s) => `${s.id} (${s.notes?.[0] ?? 'error'})`).join(', ')}` : 'Source errors: none',
  ].join('\n');
}

/** The markdown written to data/logs/<date>-failed.md. */
export function failureReport({ date, step, reason, now, check = null }) {
  const lines = [
    `# Daily run failed: ${date}`,
    '',
    `- **When:** ${now}`,
    `- **Step:** ${step}`,
    `- **Reason:** ${reason}`,
    '- **Pushed:** nothing. The edition was not committed or published.',
  ];
  if (check) {
    lines.push('', '## Last publish-gate report', '', `- Checked at: ${check.checkedAt}`, `- Passed: ${check.passed}`);
    if (check.problems?.length) lines.push('- Problems:', ...check.problems.map((p) => `  - ${p}`));
    if (check.dropped?.length) lines.push('- Dead links dropped:', ...check.dropped.map((d) => `  - ${d.url} (${d.reason})`));
  }
  lines.push('', 'Fix the cause and run `prompts/daily-run.md` again; a re-run starts from a clean slate and overwrites the day.', '');
  return lines.join('\n');
}

/** True if a git push failure is a rejection (retrying won't help) rather than a network hiccup. */
export const isPushRejection = (stderr) => /rejected|non-fast-forward|fetch first|protected branch|permission|denied|403/i.test(stderr);
