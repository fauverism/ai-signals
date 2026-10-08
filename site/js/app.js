// Loads an edition and renders it. <html data-page="home"> shows the latest edition;
// <html data-page="edition"> shows the one named by ?date=YYYY-MM-DD (linked from the archive).
import { fetchJson, fmtEditionDate, h } from './lib.js';
import { renderEdition } from './render.js';

const status = document.getElementById('status');
const isEdition = document.documentElement.dataset.page === 'edition';

function fail(message) {
  status.replaceChildren(message, ' ', h('a', { href: 'archive.html' }, 'Browse the archive'), '.');
  status.setAttribute('role', 'alert');
  status.hidden = false;
}

async function main() {
  let file = 'latest.json';
  if (isEdition) {
    const date = new URLSearchParams(location.search).get('date');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return fail('Choose an edition from the archive.');
    file = `editions/${date}.json`;
  }
  status.textContent = isEdition ? 'Loading the edition…' : 'Loading the latest edition…';
  status.hidden = false;

  let edition;
  try {
    edition = await fetchJson(file);
  } catch {
    return fail(isEdition ? "We couldn't find that edition." : 'We could not load this edition.');
  }

  status.hidden = true;
  renderEdition(edition, isEdition ? new Date(edition.generatedAt) : new Date());
  if (isEdition) document.title = `AI Signal, ${fmtEditionDate(edition.date)}`;
}

main();
