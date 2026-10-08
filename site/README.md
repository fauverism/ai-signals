# site

The deployed site: plain HTML, CSS and vanilla JavaScript, no build step. Must meet WCAG 2.1 AA, honor `prefers-reduced-motion`, support light and dark themes, and send every link to the original publisher.

| File | What it is |
| --- | --- |
| `index.html`, `edition.html`, `js/app.js`, `js/render.js` | The front page (always the latest edition) and `edition.html?date=YYYY-MM-DD` (any past one). Both render with the same components; "3h ago" labels on an archived edition are relative to that edition, not to today. |
| `archive.html`, `js/archive.js`, `js/search.js` | Every edition newest first, plus search over the last 30 editions' titles, summaries and tags. The search index loads the first time the box is used; typing is debounced 150 ms; no library. |
| `about.html` | The four scores and their weights in plain language, with a worked example. A test fails if its numbers drift from the code. |
| `methodology.html` | How stories are collected, featured and limited. |
| `subscribe.html` | A standalone signup page to link from social posts (has Open Graph and Twitter metadata). |
| `config.js` | The newsletter's username, headline, subline, tags and confirmation wording, and the site URL. |
| `components/subscribe.js`, `css/subscribe.css` | The signup form: inline after Top 5, in every footer, and on `subscribe.html`. |
| `css/site.css` | Design tokens (palette, type scale, 4px spacing steps) and components. |
| `js/lib.js`, `js/theme.js` | DOM and date helpers; the theme toggle (saved in `localStorage` inside try/catch). |
| `fonts/` | DM Sans, one variable woff2 (SIL OFL 1.1, from Google Fonts), self-hosted. |

## Run it

```
npm run serve              # http://127.0.0.1:8080/site/
npm run serve -- --dry     # preview the newest dry-run edition before anything is published
```

The pages fetch `../data/*.json`, so `/site` and `/data` must be served side by side (the dev server serves the repo root). To deploy `/site` on its own, publish `/data` next to it, or change `data-data-base` on `<html>`.

## Newsletter signup

Everything lives in `config.js`. To go live, change this one line, then run `npm run sync`:

```js
export const BUTTONDOWN_USERNAME = 'YOUR_USERNAME';
```

With JavaScript, `components/subscribe.js` renders each form from the config and submits it with `fetch` (`mode: "no-cors"`). Buttondown's answer can't be read from the browser, so the message ("Check your inbox to confirm your subscription") is a next step, not a confirmation. If the request can't leave (offline, blocked), the form falls back to a normal submit. Without JavaScript, a static copy inside `<noscript>` posts straight to Buttondown's hosted confirmation page.

That static copy is generated from the same markup function by `npm run sync` and checked by `npm run check`, so it can't silently drift from `config.js`.

## Generated files (`npm run build`)

`scripts/build.js` writes these from `data/latest.json`, `data/archive.json` and `data/editions/`. It runs in `npm run daily` after ranking, and `npm run check` fails if they are stale. None exist until the first edition is published.

| File | What it is |
| --- | --- |
| `feed.xml` | RSS 2.0: lead, top 5 and innovations of the last 7 editions. Each item links to the original publisher and carries our summary. |
| `sitemap.xml` | The static pages plus one URL per edition. |
| `search-index.json` | Compact index of the last 30 editions (roughly 25 KB each), loaded lazily by the archive search. |
| `og/<date>.png` | 1200×630 social preview with the date and lead headline. One per day, so link previews don't go stale; the newest 14 are kept. |
| `index.html`, between the `og-meta` markers | Open Graph and Twitter tags: title = lead headline, description = the editor's note (cut at 300 characters on a word boundary). |

Set `SITE_URL` in `config.js` (or in the environment) before the first real build: the feed, sitemap and preview image need absolute URLs, and `/site` is assumed to be the web root. Preview with `npm run build -- --dry`, then `npm run serve -- --dry`.

## Rules the code follows

- Feed-derived text is only ever set with `textContent`, never `innerHTML`.
- Text is `--fg` or `--fg-muted` only; the accent colors fill, outline and mark but never carry small text or meaning on their own (score chips show a number and a word).
- Interactive targets are at least 44px; focus rings are 3px; motion is off under `prefers-reduced-motion`.
- Audit with axe: serve locally, then `npx @axe-core/cli http://127.0.0.1:8080/site/ --load-delay 2000` (the page renders after a fetch, so it needs the delay).
