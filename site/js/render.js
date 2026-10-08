// Renders an Edition into the page's sections. Shared by the front page and the archived-edition page.
import { fmtClock, fmtEditionDate, fmtStamp, h, scoreWord, slug, timeAgo } from './lib.js';

const $ = (id) => document.getElementById(id);
const CATEGORIES = ['News', 'Research', 'Tutorials', 'Tools & Releases', 'Policy & Safety', 'Business', 'Opinion'];

// ---------- Pieces ----------

/** The whole title is the link; ↗ marks that it leaves the site. */
function titleLink(item) {
  return h('a', { href: item.url, rel: 'noopener' }, item.title, h('span', { class: 'ext', 'aria-hidden': 'true' }, '↗'));
}

function when(item, now) {
  return h('time', { datetime: item.publishedAt, title: fmtStamp(item.publishedAt) }, timeAgo(item.publishedAt, now));
}

function chip(kind, label, value, word) {
  return h('li', { class: `chip chip-${kind}` }, h('span', { class: 'k' }, label), h('span', { class: 'n' }, value), h('span', { class: 'w' }, word));
}

/** mode: 'full' = all four scores + total; 'novelty' = novelty + total; 'total' = total only. */
function chips(item, mode) {
  const s = item.scores;
  const dims = { full: ['importance', 'trend', 'novelty', 'credibility'], novelty: ['novelty'], total: [] }[mode];
  return h(
    'ul',
    { class: 'chips', role: 'list', 'aria-label': 'Scores out of 10' },
    dims.map((d) => chip(d, d[0].toUpperCase() + d.slice(1), String(s[d]), scoreWord(s[d]))),
    chip('score', 'Score', item.total.toFixed(1), scoreWord(item.total)),
  );
}

function meta(item, now, { category = false } = {}) {
  return h('p', { class: 'meta' }, category && h('span', { class: 'tag' }, item.category), h('span', { class: 'src' }, item.source), when(item, now));
}

function card(item, now, { chipMode = 'full', category = false, className = '', rank = null } = {}) {
  return h(
    'article',
    { class: `card ${className}`.trim() },
    rank != null && h('span', { class: 'rank', 'aria-hidden': 'true' }, String(rank)),
    meta(item, now, { category }),
    h('h3', { class: 'card-title' }, titleLink(item)),
    h('p', { class: 'summary' }, item.summary),
    h('p', { class: 'why' }, h('span', { class: 'why-label' }, 'Why it matters'), item.whyItMatters),
    chips(item, chipMode),
  );
}

// ---------- Sections ----------

function renderHeader(edition) {
  const date = $('edition-date');
  date.textContent = fmtEditionDate(edition.date);
  date.setAttribute('datetime', edition.date);
  const updated = $('updated');
  updated.textContent = `Updated ${fmtClock(edition.generatedAt)}`;
  updated.setAttribute('datetime', edition.generatedAt);
  document.title = `AI Signal, ${fmtEditionDate(edition.date)}`;
}

function renderNote(text) {
  const p = $('note-text');
  const more = $('note-more');
  p.textContent = text;
  p.classList.add('is-clamped');
  let expanded = false;
  const update = () => {
    if (!expanded) more.hidden = !(p.scrollHeight > p.clientHeight + 1);
  };
  more.addEventListener('click', () => {
    expanded = !expanded;
    p.classList.toggle('is-clamped', !expanded);
    more.setAttribute('aria-expanded', String(expanded));
    more.textContent = expanded ? 'Show less' : 'Read more';
    more.hidden = false;
  });
  update();
  new ResizeObserver(update).observe(p);
  $('note').hidden = false;
}

function renderLead(edition, now) {
  $('lead-card').replaceChildren(card(edition.lead, now, { className: 'lead', category: true }));
  $('lead').hidden = false;
}

function renderTop(edition, now) {
  $('top-list').replaceChildren(...edition.top.map((item, i) => h('li', {}, card(item, now, { category: true, rank: i + 1 }))));
  $('top').hidden = false;
}

function renderInnovations(edition, now) {
  const items = edition.innovations;
  $('innov-list').replaceChildren(...items.map((item) => h('li', {}, card(item, now, { chipMode: 'novelty', category: true }))));
  $('innov-list').hidden = items.length === 0;
  $('innov-empty').hidden = items.length > 0;
  $('innovations').hidden = false;
}

/** Momentum from trendDelta: today's topic size minus its recent average. */
function momentum(delta) {
  if (delta == null) return { glyph: '–', word: 'No baseline yet', cls: '' };
  const sign = delta > 0 ? '+' : '';
  const text = `${sign}${Number.isInteger(delta) ? delta : delta.toFixed(1)}`;
  if (delta >= 4) return { glyph: '▲▲', word: `Surging ${text}`, cls: 'm-hot' };
  if (delta > 1) return { glyph: '▲', word: `Rising ${text}`, cls: 'm-up' };
  if (delta >= -1) return { glyph: '■', word: `Steady ${text}`, cls: '' };
  return { glyph: '▼', word: `Cooling ${text}`, cls: 'm-down' };
}

function renderTrending(edition, pool, now) {
  const list = $('trend-chips');
  const panel = $('trend-panel');
  const clusters = edition.trending;
  $('trend-empty').hidden = clusters.length > 0;
  let open = null;
  const buttons = clusters.map((c) => {
    const m = momentum(c.trendDelta);
    const n = c.itemIds.length;
    const btn = h(
      'button',
      { class: 'cluster-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'trend-panel' },
      h('span', { class: 'label' }, c.label),
      h('span', { class: 'count' }, `${n} ${n === 1 ? 'item' : 'items'}`),
      h('span', { class: `momentum ${m.cls}` }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, m.glyph), m.word),
    );
    btn.addEventListener('click', () => {
      const closing = open === c.id;
      open = closing ? null : c.id;
      buttons.forEach((b, i) => b.setAttribute('aria-expanded', String(clusters[i].id === open)));
      panel.hidden = closing;
      if (closing) return;
      const links = c.itemIds.map((id) => pool.get(id)).filter(Boolean);
      panel.replaceChildren(
        h('h3', {}, c.label),
        h('p', { class: 'meta' }, `Covered by ${c.sources.length} ${c.sources.length === 1 ? 'source' : 'sources'}: ${c.sources.join(', ')}`),
        h('ul', { class: 'link-list', role: 'list' }, links.map((item) => h('li', {}, h('a', { href: item.url, rel: 'noopener' }, item.title, h('span', { class: 'ext', 'aria-hidden': 'true' }, '↗')), meta(item, now)))),
      );
    });
    return btn;
  });
  list.replaceChildren(...buttons.map((b) => h('li', {}, b)));
  list.hidden = clusters.length === 0;
  $('trending').hidden = false;
}

function renderCategories(edition, now) {
  const tablist = $('tablist');
  const panels = $('tabpanels');
  const tabs = [];
  CATEGORIES.forEach((cat, i) => {
    const items = edition.byCategory[cat] ?? [];
    const id = slug(cat);
    const tab = h(
      'button',
      { class: 'tab', type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': String(i === 0), 'aria-controls': `panel-${id}`, tabindex: i === 0 ? '0' : '-1' },
      cat,
      h('span', { class: 'count' }, `(${items.length})`),
    );
    const panel = h(
      'div',
      { class: 'tabpanel', role: 'tabpanel', id: `panel-${id}`, 'aria-labelledby': `tab-${id}`, hidden: i === 0 ? null : true, tabindex: items.length ? null : '0' },
      items.length
        ? h(
            'ul',
            { role: 'list' },
            items.map((item) =>
              h(
                'li',
                { class: 'cat-item' },
                h('p', { class: 'card-title' }, titleLink(item)),
                meta(item, now),
                h('p', { class: 'summary' }, item.summary),
                chips(item, 'total'),
              ),
            ),
          )
        : h('p', { class: 'empty' }, `Nothing in ${cat} today.`),
    );
    tabs.push({ tab, panel });
  });

  const select = (index, focus) => {
    tabs.forEach(({ tab, panel }, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
    if (focus) tabs[index].tab.focus();
  };
  tablist.addEventListener('click', (e) => {
    const i = tabs.findIndex(({ tab }) => tab === e.target.closest('[role="tab"]'));
    if (i > -1) select(i, false);
  });
  tablist.addEventListener('keydown', (e) => {
    const current = tabs.findIndex(({ tab }) => tab === document.activeElement);
    if (current < 0) return;
    const last = tabs.length - 1;
    const target = { ArrowRight: current === last ? 0 : current + 1, ArrowLeft: current === 0 ? last : current - 1, Home: 0, End: last }[e.key];
    if (target == null) return;
    e.preventDefault();
    select(target, true);
  });

  tablist.replaceChildren(...tabs.map((t) => t.tab));
  panels.replaceChildren(...tabs.map((t) => t.panel));
  $('categories').hidden = false;
}

/**
 * Fills every section from an edition. `now` anchors the "3h ago" labels: the real time on the front page,
 * the edition's own generation time on an archived edition, so it reads the way it did that day.
 */
export function renderEdition(edition, now) {
  const pool = new Map();
  for (const item of [edition.lead, ...edition.top, ...edition.innovations, ...Object.values(edition.byCategory).flat()]) pool.set(item.id, item);
  renderHeader(edition);
  renderNote(edition.editorNote);
  renderLead(edition, now);
  renderTop(edition, now);
  renderInnovations(edition, now);
  renderTrending(edition, pool, now);
  renderCategories(edition, now);
}
