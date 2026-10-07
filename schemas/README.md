# schemas

JSON Schemas (draft 2020-12) for every file in `/data`, checked by `scripts/validate.js` with Ajv.

| Schema | Describes |
| --- | --- |
| `raw-item` / `raw-file` | RawItem, and `data/raw/YYYY-MM-DD.json` (an array of them) |
| `cluster` | Cluster |
| `ranked-item` | RankedItem = RawItem + Claude's scores, category, summary |
| `edition` | `data/editions/YYYY-MM-DD.json` and `data/latest.json` |
| `archive` | `data/archive.json` |
| `common` | shared definitions (UTC timestamp, category, score…) |

`fixtures/` holds fictional sample files (`.example` domains) used to test the schemas.

Schemas can't enforce the copyright rule on quotes (≤ 15 words) or that text is original; the `rank` step and review do.
