// Newsletter email: build the Markdown from the weekly edition and create it in Buttondown as a draft.
// Pure builders first, then the API call. Nothing here ever sends an email.

export const MAX_WORDS = 600;
export const SUBJECT_HEADLINE_MAX = 60;
export const API_URL = 'https://api.buttondown.com/v1/emails';
export const USER_AGENT = 'AI-Signal/0.1 (+https://github.com/fauverism/ai-signals; newsletter draft)';
export const NEWSLETTER_NAME = 'Last Week in AI Design';
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

export const editionSubject = (edition) => `${NEWSLETTER_NAME}: ${trimHeadline(edition.lead.title)} and ${edition.top.length} more`;

/** Words as a reader counts them: link URLs and Markdown punctuation don't count. */
export function wordCount(markdown) {
  const text = markdown.replace(/\]\([^)]*\)/g, ']').replace(/[#*_>\[\]`|-]+/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const link = (item) => `[${item.title.replace(/[[\]]/g, '')}](${item.url})`;
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const footer = (siteUrl) => ['---', `[Read it on the site](${siteUrl}/) · [Browse the archive](${siteUrl}/archive.html)`].join('\n\n');

/**
 * The weekly email. If it would run over the word limit it sheds detail in a fixed order (top-item
 * "why it matters" lines, then innovations), so the same edition always gives the same email.
 */
export function editionMarkdown(edition, { siteUrl, maxWords = MAX_WORDS } = {}) {
  const build = ({ why, innovations }) => {
    const parts = [`*${NEWSLETTER_NAME} · ${longDate(edition.date)}*`, edition.editorNote.trim(), `## ${link(edition.lead)}`, oneLine(edition.lead.summary), `**Why it matters:** ${oneLine(edition.lead.whyItMatters)}`];
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
