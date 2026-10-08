# CLAUDE.md — AI Signal

AI Signal is a daily aggregator of AI industry news, research, tutorials, tools
and releases. It ranks links by **importance**, **trend momentum** and
**novelty**, then features the best ones on a static site with a Buttondown
newsletter signup.

These rules apply to every session. Follow them unless the user explicitly
overrides one.

## Stack

- **Site:** plain HTML, CSS and vanilla JavaScript. No framework, no bundler,
  no build step. The files in `/site` are what gets deployed.
- **Pipeline:** Node 20+ scripts in `/scripts`. ES modules (`"type": "module"`),
  no framework. Prefer Node built-ins (`fetch`, `node:fs/promises`,
  `node:test`) over dependencies; add a dependency only with a clear reason.
- **Database:** JSON files in `/data` are the only database. No SQLite,
  no hosted DB, no server.
- Validate every JSON file written to `/data` against its schema in `/schemas`.

## Division of labor

**Scripts (deterministic)** do: fetching, parsing, normalizing, dedupe,
counting (mentions, velocity, source tallies), schema validation, and
rendering editions into site data. Same input must give the same output.

**Claude (judgment only)** does: scoring against the rubric, short original
summaries, cluster labels, and the daily editor's note.

Do not use Claude for anything a script can do reliably, and do not hand-roll
heuristics in scripts for things that need judgment. Claude's outputs are
written to JSON files so they are reviewable and reproducible.

## Copyright

- Store only: **title, URL, source, author, published date, and an original
  1–2 sentence summary** written by us.
- **Never store or display article body text.** Never store or display quotes
  longer than 15 words (applies to summaries, editor's notes and the site).
- Always link to the original URL. Never rehost articles, images or media.
- Summaries must be in our own words, not paraphrases that track the source
  sentence by sentence.
- Fetch scripts must discard body text after extracting metadata and counts;
  nothing body-derived is persisted in `/data`.

## Dates and time

- All stored timestamps are **ISO 8601 in UTC** (e.g. `2026-10-07T13:45:00Z`).
- The **edition date** is the `America/New_York` calendar day (`YYYY-MM-DD`),
  computed with `Intl.DateTimeFormat`/`timeZone`, never by hand-offsetting UTC.
  Mind DST boundaries.
- Convert to a display timezone only in the site's rendering layer.

## Accessibility (WCAG 2.1 AA)

- Semantic HTML first: landmarks, headings in order, lists for lists, `button`
  for actions, `a` for navigation. ARIA only when native elements can't do it.
- Everything keyboard reachable, with a visible focus indicator and a skip link.
- Color contrast ≥ 4.5:1 for text, 3:1 for UI components. Never use color alone
  to convey meaning.
- Respect `prefers-reduced-motion` (no non-essential animation when set).
- Support **light and dark themes** via `prefers-color-scheme` and CSS custom
  properties; both must meet contrast requirements.
- Form fields (newsletter signup) have programmatic labels and accessible
  error/success messaging.
- Meaningful link text; no "click here". Images need `alt` (or `alt=""` if
  decorative).

## Secrets

- **Never commit secrets**, tokens or keys, including in `/data`, logs, fixtures
  or examples.
- `BUTTONDOWN_API_KEY` comes from the environment only. Scripts must fail
  clearly if it is missing and must never print it.
- The client-side signup form uses Buttondown's public form endpoint; the API
  key must never reach `/site`.
- `.env` files stay gitignored. Redact secrets and tokens from `/data/logs`.

## Folder map

| Path | Purpose |
| --- | --- |
| `/sources` | Source registry: feeds, APIs, per-source config |
| `/scripts` | Node pipeline (fetch, parse, dedupe, count, build, publish) |
| `/schemas` | JSON Schemas for every file in `/data` |
| `/data/raw` | Fetched item metadata, as received (no body text) |
| `/data/work` | Intermediate files: deduped, counted, scored, clustered |
| `/data/editions` | Final per-day edition files (`YYYY-MM-DD.json`) |
| `/data/logs`, `/data/cache` | Run logs and errors; HTTP cache (gitignored) |
| `/site` | Static HTML, CSS, JS — the deployed site |
| `/prompts` | Scoring rubric and run instructions for Claude |

Put new files in the folder that matches this map. Don't add top-level
directories without updating this file.

## Pipeline order

1. Fetch from `/sources` → `/data/raw`
2. Parse and normalize; dedupe by canonical URL and title similarity
3. Count mentions and momentum signals
4. Claude scores, summarizes, clusters, and writes the editor's note
   (per `/prompts`)
5. Validate against `/schemas`; write the edition to `/data/editions`
6. Site reads editions as static JSON; newsletter sent via Buttondown

Each step is re-runnable and idempotent for a given edition date.

## Working conventions

- Match the existing code style; keep scripts small and single-purpose.
- Scripts take the edition date as an argument and default to today in
  `America/New_York`.
- Network code: set timeouts, a descriptive User-Agent, honor robots.txt and
  rate limits, and log failures to `/data/logs` without aborting the whole run.
- Tests use `node --test`. Add tests for dedupe, counting and date logic.
- Keep the site working from a plain static file server (no server-side code).
- Commit small, descriptive changes. Don't rewrite or delete committed
  editions in `/data/editions` except to fix schema or copyright violations.
