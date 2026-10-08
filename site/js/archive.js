// The archive: every edition newest first, plus search over the last 30 editions.
// The search index (site/search-index.json, written by scripts/build.js) is fetched the first time the
// search box is used, not on page load.
import { fmtEditionDate, fmtShortDate, h } from './lib.js';
import { fetchJson } from './lib.js';
import { MAX_RESULTS, debounce, search, segments, termsOf } from './search.js';

const $ = (id) => document.getElementById(id);
const status = $('status');
const list = $('archive-list');

// ---------- Edition list ----------

async function showEditions() {
  try {
    status.textContent = 'Loading the archive…';
    status.hidden = false;
    const archive = await fetchJson('archive.json');
    status.hidden = true;
    if (!archive.length) {
      status.textContent = 'No editions yet.';
      status.hidden = false;
      return;
    }
    list.replaceChildren(
      ...archive.map((e) =>
        h(
          'li',
          {},
          h('p', { class: 'meta' }, h('time', { datetime: e.date }, fmtEditionDate(e.date)), `${e.count} ${e.count === 1 ? 'item' : 'items'}`),
          h('a', { href: `edition.html?date=${e.date}` }, e.leadTitle),
        ),
      ),
    );
    list.hidden = false;
  } catch {
    status.textContent = 'We could not load the archive. Try again in a moment.';
    status.setAttribute('role', 'alert');
    status.hidden = false;
  }
}

// ---------- Search ----------

const input = $('q');
const count = $('search-count');
const results = $('results');
let indexPromise = null;

/** Fetches the index once, on first use. */
function loadIndex() {
  indexPromise ??= fetch(new URL('search-index.json', document.baseURI), { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .catch((error) => {
      indexPromise = null; // let the next attempt retry
      throw error;
    });
  return indexPromise;
}

const marked = (text, terms) => segments(text, terms).map((s) => (s.hit ? h('mark', {}, s.text) : s.text));

function resultItem(e, terms) {
  return h(
    'li',
    {},
    h(
      'p',
      { class: 'meta' },
      h('a', { href: `edition.html?date=${e.d}` }, h('time', { datetime: e.d }, fmtShortDate(e.d))),
      h('span', { class: 'src' }, e.s),
      h('span', { class: 'tag' }, e.c),
    ),
    h('p', { class: 'card-title' }, h('a', { href: e.u, rel: 'noopener' }, ...marked(e.t, terms), h('span', { class: 'ext', 'aria-hidden': 'true' }, '↗'))),
    h('p', { class: 'summary' }, ...marked(e.m, terms)),
    e.g.length ? h('p', { class: 'result-tags' }, h('span', { class: 'vh' }, 'Tags: '), ...e.g.map((tag) => h('span', {}, `#${tag}`))) : null,
  );
}

async function run() {
  const query = input.value.trim();
  if (!query) {
    results.hidden = true;
    results.replaceChildren();
    list.hidden = false;
    count.textContent = '';
    return;
  }
  let index;
  try {
    count.textContent = 'Loading search…';
    index = await loadIndex();
  } catch {
    count.textContent = 'Search is not available right now. You can still browse the editions below.';
    list.hidden = false;
    return;
  }
  if (input.value.trim() !== query) return; // the box changed while the index loaded; a newer run will follow
  const { entries, total } = search(index, query);
  const terms = termsOf(query);
  list.hidden = true;
  results.hidden = false;
  results.replaceChildren(...entries.map((e) => resultItem(e, terms)));
  count.textContent = total === 0
    ? `No matches for "${query}" in the last 30 editions.`
    : total > MAX_RESULTS
      ? `${total} matches for "${query}". Showing the first ${MAX_RESULTS}.`
      : `${total} ${total === 1 ? 'match' : 'matches'} for "${query}".`;
}

const debounced = debounce(run, 150);
input.addEventListener('focus', () => loadIndex().catch(() => {}), { once: true });
input.addEventListener('input', debounced);
$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run();
});

showEditions();
