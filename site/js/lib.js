// Small helpers shared by the pages. Everything is built with DOM APIs and textContent, never innerHTML,
// so feed-derived strings can't inject markup.

/** h('a', { href, class: 'x', onclick }, 'text', childNode, …) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const editionFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const clockFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
const stampFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });

/** "2026-10-08" -> "Thursday, October 8, 2026" (the edition date is a calendar day, not an instant). */
export const fmtEditionDate = (date) => editionFormat.format(new Date(`${date}T12:00:00Z`));
export const fmtShortDate = (date) => shortFormat.format(new Date(`${date}T12:00:00Z`));
/** "6:15 AM ET" in New York time. */
export const fmtClock = (iso) => `${clockFormat.format(new Date(iso))} ET`.replace(/ /g, ' ');
export const fmtStamp = (iso) => `${stampFormat.format(new Date(iso))} ET`.replace(/ /g, ' ');

/** "3h ago" style; older than two weeks falls back to a date. */
export function timeAgo(iso, now = new Date()) {
  const minutes = Math.round((now - new Date(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return fmtShortDate(iso.slice(0, 10));
}

/** A word for a 0-10 score, so a number never has to carry meaning alone. */
export function scoreWord(n) {
  const v = Math.round(n);
  if (v <= 2) return 'Low';
  if (v <= 4) return 'Modest';
  if (v <= 6) return 'Solid';
  if (v <= 8) return 'Strong';
  return 'Exceptional';
}

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Where data files live, relative to the page; overridable with <html data-data-base="...">. */
export const dataUrl = (file) => new URL(file, new URL(document.documentElement.dataset.dataBase ?? '../data/', document.baseURI));

export async function fetchJson(file) {
  const res = await fetch(dataUrl(file), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
}
