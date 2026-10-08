// Site-wide settings. The newsletter signup reads everything it needs from here.
//
// To go live, change the one line below to your Buttondown username, then run:  npm run sync
// (`npm run sync` copies these values into the no-JavaScript fallbacks in the HTML; `npm run check` fails if they differ.)
export const BUTTONDOWN_USERNAME = 'YOUR_USERNAME';

export const SUBSCRIBE_HEADLINE = 'The day in AI, ranked.';
export const SUBSCRIBE_SUBLINE = "One email each morning: the lead story, the top 5, and what's new. No hype.";

// One tag per placement, so Buttondown shows where each subscriber signed up.
export const SUBSCRIBE_TAGS = { inline: 'site-inline', footer: 'site-footer', page: 'subscribe-page' };

// The response from Buttondown can't be read from the browser (the request is cross-origin), so this is
// worded as the next step, not as a confirmed subscription.
export const SUBSCRIBE_SUCCESS = 'Check your inbox to confirm your subscription';
