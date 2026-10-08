# scripts

The Node 20+ pipeline (ES modules, no framework). Scripts are deterministic: fetch, parse, dedupe, count, validate, build. Judgment (scoring, summaries, editor's note) is Claude's, driven by `/prompts`.

| npm script | file | does |
| --- | --- | --- |
| `collect` | `collect.js` | fetch enabled sources → `data/raw/<edition-date>.json`, log to `data/logs` |
| `dedupe` | `dedupe.js` | dedupe and count → `data/work` (not implemented yet) |
| `rank` | `rank.js` | Claude scoring step (not implemented yet) |
| `build` | `build.js` | write editions, `latest.json`, `archive.json` (not implemented yet) |
| `check` | `validate.js` | validate all JSON against `/schemas` |
| `test` | `*.test.js` | `node --test` unit tests |
| `verify-sources` | `verify-sources.js` | regenerate `sources/sources.json` from `sources/candidates.json` |
| `daily` | — | all of the above in order |

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
