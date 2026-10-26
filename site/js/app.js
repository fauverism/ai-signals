// Loads an edition and renders it. <html data-page="home"> shows the latest edition;
// <html data-page="edition"> shows the one named by ?date=YYYY-MM-DD (linked from the archive).
import { fetchJson, fmtEditionDate, h, issueOf } from './lib.js';
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
  if (isEdition) document.title = `AI Broadside, ${fmtEditionDate(edition.date)}`;
  showIssue(edition.date);
}

// "Vol. I · No. 12" in the dateline. A nicety: if the archive can't be read, the dateline just goes without it.
async function showIssue(date) {
  const slot = document.getElementById('issue');
  if (!slot) return;
  try {
    const issue = issueOf(await fetchJson('archive.json'), date);
    if (!issue) return;
    slot.replaceChildren(
      h('span', { 'aria-hidden': 'true' }, `Vol. ${issue.volume} · No. ${issue.number}`),
      h('span', { class: 'vh' }, `Volume ${issue.volume}, number ${issue.number}`),
    );
    slot.hidden = false;
  } catch {
    /* leave it out */
  }
}

main();
