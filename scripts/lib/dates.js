// Date helpers. Stored timestamps are ISO 8601 UTC; the edition date is the America/New_York day.
const EDITION_TZ = 'America/New_York';
const HOUR_MS = 3600 * 1000;
// Feeds sometimes stamp items a little ahead of our clock; tolerate that much.
const FUTURE_SLACK_MS = HOUR_MS;

const editionFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: EDITION_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD for the America/New_York calendar day containing `now`. */
export function editionDate(now = new Date()) {
  const p = Object.fromEntries(editionFormat.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** ISO 8601 UTC without milliseconds, e.g. 2026-10-07T13:45:00Z. */
export const toUtcIso = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Parses any date string JavaScript understands (ISO 8601, RFC 822). Returns UTC ISO or null. */
export function parseToUtcIso(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1990) return null;
  return toUtcIso(d);
}

/** True when `iso` is within the last `hours` hours (and not meaningfully in the future). */
export function isInWindow(iso, now, hours) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t >= now.getTime() - hours * HOUR_MS && t <= now.getTime() + FUTURE_SLACK_MS;
}

/** Start of the window as a Date. */
export const windowStart = (now, hours) => new Date(now.getTime() - hours * HOUR_MS);
