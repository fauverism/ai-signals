// Newsletter signup. One component, three placements (inline, footer, standalone page).
//
// Markup comes from subscribeMarkup(), used twice: here in the browser to render each form, and by
// scripts/sync-subscribe.js to write the static <noscript> fallback into the HTML. Same function, so the
// two cannot drift apart. With JavaScript the form submits with fetch; without it, the same form posts
// straight to Buttondown's hosted confirmation page.
import { BUTTONDOWN_USERNAME, SUBSCRIBE_HEADLINE, SUBSCRIBE_SUBLINE, SUBSCRIBE_SUCCESS, SUBSCRIBE_TAGS } from '../config.js';

export const PLACEHOLDER_USERNAME = 'YOUR_USERNAME';
const ENDPOINT = 'https://buttondown.com/api/emails/embed-subscribe/';

const MESSAGES = {
  missing: 'Enter your email address.',
  invalid: "That doesn't look like an email address. Try name@example.com.",
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * HTML for one signup form. `suffix` keeps ids unique when a variant appears twice on a page.
 * @param {'inline'|'footer'|'page'} variant
 */
export function subscribeMarkup(variant, suffix = '') {
  const tag = SUBSCRIBE_TAGS[variant];
  if (!tag) throw new Error(`unknown subscribe variant: ${variant}`);
  const id = `${variant}${suffix}`;
  const heading = variant === 'page' ? 'h1' : 'h2';
  const action = `${ENDPOINT}${encodeURIComponent(BUTTONDOWN_USERNAME)}`;
  // Deliberately not a labelled region: two placements share one headline, and a signup box isn't a landmark.
  return `<section class="subscribe subscribe--${variant}">
  <${heading} id="subscribe-title-${id}" class="subscribe-title">${esc(SUBSCRIBE_HEADLINE)}</${heading}>
  <p class="subscribe-sub">${esc(SUBSCRIBE_SUBLINE)}</p>
  <form action="${esc(action)}" method="post" class="subscribe-form">
    <label for="bd-email-${id}">Email address</label>
    <div class="subscribe-row">
      <input type="email" name="email" id="bd-email-${id}" required autocomplete="email" aria-describedby="bd-msg-${id}">
      <input type="hidden" name="embed" value="1">
      <input type="hidden" name="tag" value="${esc(tag)}">
      <button type="submit">Subscribe</button>
    </div>
    <p class="subscribe-msg" id="bd-msg-${id}" hidden></p>
  </form>
  <p class="subscribe-status" id="bd-status-${id}" aria-live="polite" aria-atomic="true"></p>
</section>`;
}

/** Social-share and description metadata for the standalone page, so a shared link has a proper preview. */
export function subscribeMeta() {
  const t = esc(SUBSCRIBE_HEADLINE);
  const d = esc(SUBSCRIBE_SUBLINE);
  return [
    `<meta name="description" content="${d}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="AI Signal">',
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
  ].join('\n');
}

// ---------- Behavior (browser only) ----------

function enhance(root, id) {
  const form = root.querySelector('form');
  const input = form.querySelector('input[type="email"]');
  const button = form.querySelector('button');
  const msg = document.getElementById(`bd-msg-${id}`);
  const status = document.getElementById(`bd-status-${id}`);
  const idleLabel = button.textContent;
  let busy = false;

  // Our own inline message replaces the browser's validation bubble.
  form.noValidate = true;

  const clearError = () => {
    msg.hidden = true;
    msg.textContent = '';
    input.removeAttribute('aria-invalid');
  };
  const showError = (text) => {
    status.textContent = '';
    msg.textContent = text;
    msg.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };

  input.addEventListener('input', () => {
    clearError();
    status.textContent = '';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!input.checkValidity()) {
      showError(input.validity.valueMissing ? MESSAGES.missing : MESSAGES.invalid);
      return;
    }

    clearError();
    status.textContent = '';
    const hadFocus = form.contains(document.activeElement);
    busy = true;
    button.disabled = true; // only while the request is in flight
    button.textContent = 'Subscribing…';
    form.setAttribute('aria-busy', 'true');

    let fellBack = false;
    try {
      // The response is opaque (no-cors), so all we know is that the request went out.
      await fetch(form.action, { method: 'POST', mode: 'no-cors', body: new URLSearchParams(new FormData(form)) });
      status.textContent = SUBSCRIBE_SUCCESS;
      input.value = '';
    } catch {
      // The request never left (offline, blocked by an extension): do a normal form submit instead.
      fellBack = true;
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = idleLabel;
      form.removeAttribute('aria-busy');
      // A disabled button drops keyboard focus; give it back.
      if (hadFocus && document.activeElement === document.body) button.focus();
    }
    if (fellBack) HTMLFormElement.prototype.submit.call(form);
  });
}

function init() {
  if (BUTTONDOWN_USERNAME === PLACEHOLDER_USERNAME) {
    console.warn('[subscribe] BUTTONDOWN_USERNAME in site/config.js is still the placeholder; signups will not work yet.');
  }
  const used = new Map();
  for (const slot of document.querySelectorAll('[data-subscribe]')) {
    const variant = slot.dataset.subscribe;
    const n = (used.get(variant) ?? 0) + 1;
    used.set(variant, n);
    const id = n === 1 ? variant : `${variant}-${n}`;
    slot.innerHTML = subscribeMarkup(variant, n === 1 ? '' : `-${n}`);
    enhance(slot, id);
  }
}

if (typeof document !== 'undefined') init();
