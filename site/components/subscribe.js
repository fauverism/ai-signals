// Newsletter signup. One component, three placements (inline, footer, standalone page).
//
// Markup comes from subscribeMarkup(), used twice: here in the browser to render each form, and by
// scripts/sync-subscribe.js to write the static <noscript> fallback into the HTML. Same function, so the
// two cannot drift apart. The form posts straight to Buttondown's hosted verification page; JavaScript only adds inline validation.
import { BUTTONDOWN_USERNAME, SUBSCRIBE_HEADLINE, SUBSCRIBE_SUBLINE, SUBSCRIBE_TAGS } from '../config.js';

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
    '<meta property="og:site_name" content="AI Broadside">',
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
  const msg = document.getElementById(`bd-msg-${id}`);
  const status = document.getElementById(`bd-status-${id}`);

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

  // Validate here for a clear inline message; a valid form then submits normally, so the visitor lands on
  // Buttondown's hosted verification page (its human check can't be completed from a background request).
  form.addEventListener('submit', (event) => {
    if (!input.checkValidity()) {
      event.preventDefault();
      showError(input.validity.valueMissing ? MESSAGES.missing : MESSAGES.invalid);
    }
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
