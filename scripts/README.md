# scripts

The Node 20+ pipeline (ES modules, no framework). Scripts are deterministic: fetch, parse, dedupe, count, validate, build. Judgment (scoring, summaries, editor's note) is Claude's, driven by `/prompts`.

| npm script | file | does |
| --- | --- | --- |
| `collect` | `collect.js` | fetch sources → `data/raw` (not implemented yet) |
| `dedupe` | `dedupe.js` | dedupe and count → `data/work` (not implemented yet) |
| `rank` | `rank.js` | Claude scoring step (not implemented yet) |
| `build` | `build.js` | write editions, `latest.json`, `archive.json` (not implemented yet) |
| `check` | `validate.js` | validate all JSON against `/schemas` |
| `daily` | — | all of the above in order |

`node scripts/validate.js [file ...]` validates the given files, or everything it can find when run with no arguments.
