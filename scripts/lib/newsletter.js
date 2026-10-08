// Newsletter email: build the Markdown from an edition (or a week of them) and create it in Buttondown as a draft.
// Pure builders first, then the API call. Nothing here ever sends an email.

export const MAX_WORDS = 600;
export const SUBJECT_HEADLINE_MAX = 60;
export const API_URL = 'https://api.buttondown.com/v1/emails';
export const USER_AGENT = 'AI-Signal/0.1 (+https://github.com/fauverism/ai-signals; newsletter draft)';
const REQUEST_TIMEOUT_MS = 15000;

const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
/** "Thursday, October 8, 2026" for a YYYY-MM-DD edition date (a calendar date, so no timezone shift). */
export const longDate = (ymd) => dateFormat.format(new Date(`${ymd}T12:00:00Z`));

/** At most `max` characters, cut at a word boundary with an ellipsis (which counts toward the limit). */
export function trimHeadline(title, max = SUBJECT_HEADLINE_MAX) {
  const t = title.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const atWord = cut.replace(/\s+\S*$/, '');
  return `${(atWord.length >= max / 2 ? atWord : cut).replace(/[\s,;:.\-–—]+$/, '')}…`;
}

export const dailySubject = (edition) => `${trimHeadline(edition.lead.title)} and ${edition.top.length} more`;

/** Words as a reader counts them: link URLs and Markdown punctuation don't count. */
export function wordCount(markdown) {
  const text = markdown.replace(/\]\([^)]*\)/g, ']').replace(/[#*_>\[\]`|-]+/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const link = (item) => `[${item.title.replace(/[[\]]/g, '')}](${item.url})`;
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const footer = (siteUrl) => ['---', `[Read it on the site](${siteUrl}/) · [Browse the archive](${siteUrl}/archive.html)`].join('\n\n');

/**
 * The daily email. If it would run over the word limit it sheds detail in a fixed order (top-item
 * "why it matters" lines, then innovations), so the same edition always gives the same email.
 */
export function dailyMarkdown(edition, { siteUrl, maxWords = MAX_WORDS } = {}) {
  const build = ({ why, innovations }) => {
    const parts = [`*${longDate(edition.date)}*`, edition.editorNote.trim(), `## ${link(edition.lead)}`, oneLine(edition.lead.summary), `**Why it matters:** ${oneLine(edition.lead.whyItMatters)}`];
    parts.push('## Top 5', edition.top.map((i) => `- ${link(i)} (${i.source}): ${oneLine(i.summary)}${why ? ` *${oneLine(i.whyItMatters)}*` : ''}`).join('\n'));
    if (innovations && edition.innovations.length) {
      parts.push('## Innovations', edition.innovations.map((i) => `- ${link(i)} (${i.source}): ${oneLine(i.summary)}`).join('\n'));
    }
    parts.push(footer(siteUrl));
    return `${parts.join('\n\n')}\n`;
  };
  for (const level of [{ why: true, innovations: true }, { why: false, innovations: true }, { why: false, innovations: false }]) {
    const md = build(level);
    if (wordCount(md) < maxWords) return md;
  }
  throw new Error(`The email is over ${maxWords} words even without the extras; shorten the editor's note or summaries.`);
}

// ---------- weekly ----------

/** The N highest-total items across the editions, deduped by URL; ties go to the newer edition, then the title. */
export function weeklyTop(editions, n = 10) {
  const byUrl = new Map();
  for (const e of editions) {
    const all = [e.lead, ...e.top, ...e.innovations, ...Object.values(e.byCategory ?? {}).flat()].filter(Boolean);
    for (const item of all) {
      const key = item.canonicalUrl ?? item.url;
      const prev = byUrl.get(key);
      if (!prev || item.total > prev.item.total) byUrl.set(key, { item, date: e.date });
    }
  }
  return [...byUrl.values()]
    .sort((a, b) => b.item.total - a.item.total || b.date.localeCompare(a.date) || a.item.title.localeCompare(b.item.title))
    .slice(0, n);
}

/**
 * The trending cluster that stayed in the news longest: clusters on different days are the same story
 * when they share an item id or a lead item. Longest run of editions wins; ties go to more items, then the label.
 */
export function persistentCluster(editions) {
  const groups = []; // { ids: Set, dates: Set, labels: [], items: Set, latest: cluster }
  for (const e of [...editions].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const c of e.trending ?? []) {
      const ids = new Set([...c.itemIds, c.leadItemId]);
      const hit = groups.find((g) => [...ids].some((id) => g.ids.has(id)));
      if (hit) {
        ids.forEach((id) => hit.ids.add(id));
        hit.dates.add(e.date);
        hit.latest = { cluster: c, date: e.date };
      } else groups.push({ ids, dates: new Set([e.date]), latest: { cluster: c, date: e.date } });
    }
  }
  const best = groups.sort((a, b) => b.dates.size - a.dates.size || b.ids.size - a.ids.size || a.latest.cluster.label.localeCompare(b.latest.cluster.label))[0];
  if (!best) return null;
  const itemsById = new Map();
  for (const e of editions) for (const i of [e.lead, ...e.top, ...e.innovations, ...Object.values(e.byCategory ?? {}).flat()]) if (i) itemsById.set(i.id, i);
  return { label: best.latest.cluster.label, days: best.dates.size, lead: itemsById.get(best.latest.cluster.leadItemId) ?? null, sources: best.latest.cluster.sources };
}

export const weeklySubject = (top) => `The week in AI: ${trimHeadline(top[0].item.title, SUBJECT_HEADLINE_MAX)} and ${top.length - 1} more`;

export function weeklyMarkdown(editions, endDate, { siteUrl, maxWords = MAX_WORDS } = {}) {
  const top = weeklyTop(editions);
  const cluster = persistentCluster(editions);
  const first = [...editions].sort((a, b) => a.date.localeCompare(b.date))[0].date;
  const build = (why) => {
    const parts = [`*Week ending ${longDate(endDate)}*`, `The ${top.length} highest-ranked stories from ${editions.length === 1 ? 'this week\'s edition' : `${editions.length} editions, ${first} to ${endDate}`}.`];
    parts.push('## The week\'s top stories', top.map(({ item }, n) => `${n + 1}. ${link(item)} (${item.source}, ${item.total.toFixed(1)}): ${oneLine(item.summary)}${why ? ` *${oneLine(item.whyItMatters)}*` : ''}`).join('\n'));
    if (cluster) {
      const days = cluster.days === 1 ? 'one day' : `${cluster.days} days`;
      parts.push('## Stayed in the news', `**${cluster.label}** was in the trending list for ${days}, reported by ${cluster.sources.join(', ')}.${cluster.lead ? ` Start with ${link(cluster.lead)}.` : ''}`);
    }
    parts.push(footer(siteUrl));
    return `${parts.join('\n\n')}\n`;
  };
  for (const why of [true, false]) {
    const md = build(why);
    if (wordCount(md) < maxWords) return md;
  }
  throw new Error(`The weekly email is over ${maxWords} words even without the extras.`);
}

// ---------- Buttondown ----------

/** Error text must never contain the API key, whatever the server echoes back. */
const redact = (text, key) => String(text).split(key).join('[redacted]');

async function api(method, url, key, body, fetchImpl) {
  const res = await fetchImpl(url, {
    method,
    headers: { authorization: `Token ${key}`, 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(redact(`Buttondown ${method} ${new URL(url).pathname} answered HTTP ${res.status}: ${text.slice(0, 300)}`, key));
  return json;
}

/** The draft we made for this key earlier (so a re-run updates it instead of piling up copies), or null. */
async function findDraft(key, marker, fetchImpl) {
  for (let url = `${API_URL}?status=draft`, pages = 0; url && pages < 5; pages++) {
    const page = await api('GET', url, key, null, fetchImpl);
    const hit = (page?.results ?? []).find((e) => e.status === 'draft' && e.metadata?.ai_signal === marker);
    if (hit) return hit;
    url = page?.next ?? null;
  }
  return null;
}

/**
 * Creates (or refreshes) a DRAFT. `status: 'draft'` is always sent explicitly: Buttondown's default status
 * depends on the API version and has historically been "about_to_send". A sent email is never touched, and the
 * response is checked, so anything but a draft is reported as an error.
 * @returns {{ id: string, url: string, action: 'created'|'updated' }}
 */
export async function createDraft({ subject, body, marker }, { apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('BUTTONDOWN_API_KEY is not set. Export it in the environment; it is never read from a file.');
  const payload = { subject, body, status: 'draft', metadata: { ai_signal: marker } };
  const existing = await findDraft(apiKey, marker, fetchImpl);
  const saved = existing
    ? await api('PATCH', `${API_URL}/${existing.id}`, apiKey, { subject, body, status: 'draft', metadata: payload.metadata }, fetchImpl)
    : await api('POST', API_URL, apiKey, payload, fetchImpl);
  if (saved?.status !== 'draft') throw new Error(`Buttondown returned status "${saved?.status}" for email ${saved?.id}, not "draft". Check it in Buttondown before anything is sent.`);
  return { id: saved.id, url: saved.absolute_url ?? null, action: existing ? 'updated' : 'created' };
}
