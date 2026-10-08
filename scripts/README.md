# scripts

The Node 20+ pipeline (ES modules, no framework). Scripts are deterministic: fetch, parse, dedupe, count, validate, build. Judgment (scoring, summaries, editor's note) is Claude's, driven by `/prompts`.

| npm script | file | does |
| --- | --- | --- |
| `collect` | `collect.js` | fetch enabled sources → `data/raw/<edition-date>.json`, log to `data/logs` |
| `dedupe` | `dedupe.js` | dedupe, cluster, pre-score → `data/raw/<date>.deduped.json` |
| `rank` | `rank.js` | `--prepare` batches, `--assemble` the Edition from Claude's scores, `--validate` after the note (see `prompts/rank-run.md`) |
| `build` | `build.js` | `feed.xml`, `sitemap.xml`, `search-index.json`, the social preview PNG and the homepage's Open Graph tags, from the published editions (`--check` for staleness, `--dry` to preview, `--out`/`--data` for other locations) |
| `check` | `validate.js`, `sync-subscribe.js --check`, `build.js --check`, `gate.js` | schemas, signup fallbacks, generated site files, then the publish gate (lead, ≥ 20 ranked, no duplicate URLs, every featured link answers HEAD with 2xx/3xx). Exit 2 = dead links dropped and the edition re-featured |
| `test` | `*.test.js` | `node --test` unit tests |
| `sync` | `sync-subscribe.js` | stamp `site/config.js` into the no-JS signup fallbacks in the HTML (`check` fails if they are stale) |
| `serve` | `serve.js` | local static server for `/site` and `/data` (`--dry` previews a dry-run edition) |
| `verify-sources` | `verify-sources.js` | regenerate `sources/sources.json` from `sources/candidates.json` |
| `daily` | `daily.js` | prints how the daily run works; the run itself is `prompts/daily-run.md` |
| `daily:start` | `daily.js start` | discard leftovers of a failed run, `git pull --ff-only` from the deploy branch, clear today's work files, record the run's date |
| `daily:publish` | `daily.js publish` | re-verify, commit `Edition YYYY-MM-DD` and push (rolls the commit back if the push fails) |
| `daily:summary` | `daily.js summary` | the five-line end-of-run summary |
| `daily:fail` | `daily.js fail` | write `data/logs/<date>-failed.md`; never touches git |

`node scripts/validate.js [file ...]` validates the given files, or everything it can find when run with no arguments.

## collect

`node scripts/collect.js [--date YYYY-MM-DD] [--hours 36]` (or `COLLECT_WINDOW_HOURS`). Behind an HTTPS proxy, set `NODE_USE_ENV_PROXY=1`.

- 10 s timeout, max 3 concurrent requests per host, descriptive User-Agent, one retry after a 429/503.
- Feeds use `ETag` / `Last-Modified` via `data/cache/http.json` (gitignored); a 304 reuses the cached parse, so re-runs are idempotent.
- robots.txt is honored for feeds (Reddit's disallows everything, so those sources are reported as `robots`). API sources follow their published terms.
- Keeps items from the last N hours; tier-3 sources must also pass `sources/keywords.json`.
- `html-list` sources are skipped until a scraper exists. Hosts for `api` sources need an adapter in `adapters/` (Hacker News, GitHub).
- A failing source is logged and skipped; it never fails the run. The log is `data/logs/<edition-date>.json`.
- `GITHUB_TOKEN` (optional, from the environment) raises GitHub's rate limit.

## dedupe

`node scripts/dedupe.js [--date YYYY-MM-DD] [--cap 150] [--per-source-cap N]`. Deterministic; reads `data/raw/<date>.json` and the 7 most recent earlier files in `data/editions`.

1. **Exact:** one story per `canonicalUrl`. The best copy wins (lowest tier, then earliest); numeric signals take the max, and `mergedSources` lists every source that carried it.
2. **Near-duplicate:** titles with token Jaccard ≥ 0.6 (and 2+ shared tokens) published within 48 h are one story.
3. **Clusters:** stories about the same event, linked by IDF-weighted title cosine plus shared entities (model versions, companies, brand names; see `lib/titles.js`), within 72 h, capped at 30 stories. A cluster needs two distinct sources, so one source's series doesn't count. Lead = tier 1 if present, else earliest. `label` is the lead's title; relabeling is Claude's job.
4. `signals.crossSourceCount` = distinct sources in the item's cluster.
5. **History:** `previouslyFeatured` = the item was lead/top/innovation (or had a featured slot) in the last 7 editions. `trendDelta` = today's cluster size minus the topic's average size over those editions, matched on key entities; `null` with no history or no usable entities. Editions only hold featured items, so prior sizes are lower bounds.
6. `preScore` = tier weight (3/2/1) + min(crossSourceCount, 8) + community signals (0–3, log-scaled HN points/comments, Reddit score, GitHub stars).
7. **Cap:** all tier 1 first, then by `preScore`, newest first on ties. `--per-source-cap` is an opt-in guard so one source (e.g. arXiv) can't fill the set.

## rank

Claude Code does the judging between `--prepare` and `--assemble`; nothing here calls an API. Totals (weights in `lib/rank.js`), the Trend baseline and every featuring rule are computed in code, so a model-written `total` is ignored and a trend score more than 2 from its baseline is clamped. `--dry-run` writes `data/work/<date>.dry-*.json` instead of the real Edition, `latest.json` and `archive.json`. Exits non-zero, printing what's wrong, on any schema or rule failure.

## The publish gate (`gate.js`)

`npm run check` ends with the gate. `--require` fails when nothing is published, `--date D` insists the edition is for D, `--offline` skips the link check. Featured links (lead, top 5, innovations, trending leads) get a `HEAD` request with a 5 s timeout; redirects count as answering, as do 401/403/429 (the server answered, it just refuses bots), and a server that doesn't implement `HEAD` (405/501) gets one tiny `GET` instead. A failing link is written to `data/work/<date>.dropped.json` and `rank --assemble` runs again without it (exit 2). If half or more of the links fail at once the gate assumes the network is down and drops nothing (exit 1).

`npm run collect`, `check` and `verify-sources` set `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses `HTTPS_PROXY` in sandboxed runners; it does nothing without a proxy.
