# data

JSON files here are the project's only database.

- `raw/` — collected item metadata, one file per edition date
- `work/` — intermediate pipeline files (deduped, counted, scored)
- `editions/` — final edition per day, `YYYY-MM-DD.json`
- `logs/` — run logs (contents are gitignored)
- `latest.json` — copy of the newest edition (written by `build`)
- `archive.json` — `[{ date, leadTitle, count }]`, newest first (written by `build`)

Dates are ISO 8601 UTC; edition dates are America/New_York days. Metadata only: no article body text.
