# data/raw

`YYYY-MM-DD.json`: an array of RawItem (schema `raw-file`), written by `collect`. Metadata and counts only, never article body text.

`YYYY-MM-DD.deduped.json` (schema `deduped`), written by `dedupe`: exact and near-duplicate stories merged, clustered, pre-scored and capped for ranking.
