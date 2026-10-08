// Lists past editions from data/archive.json; each links back to the front page for that date.
import { fetchJson, fmtEditionDate, h } from './lib.js';

const status = document.getElementById('status');
const list = document.getElementById('archive-list');

try {
  status.textContent = 'Loading the archive…';
  status.hidden = false;
  const archive = await fetchJson('archive.json');
  status.hidden = true;
  if (!archive.length) {
    status.textContent = 'No editions yet.';
    status.hidden = false;
  } else {
    list.replaceChildren(
      ...archive.map((e) =>
        h(
          'li',
          {},
          h('p', { class: 'meta' }, h('time', { datetime: e.date }, fmtEditionDate(e.date)), `${e.count} ${e.count === 1 ? 'item' : 'items'}`),
          h('a', { href: `./?date=${e.date}` }, e.leadTitle),
        ),
      ),
    );
    list.hidden = false;
  }
} catch {
  status.textContent = 'We could not load the archive. Try again in a moment.';
  status.setAttribute('role', 'alert');
  status.hidden = false;
}
