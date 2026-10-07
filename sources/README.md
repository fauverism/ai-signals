# sources

Source registry, read by `scripts/collect.js`.

| File | What it is |
| --- | --- |
| `sources.json` | The registry: only sources verified to respond with a valid feed. **Generated** by `npm run verify-sources`; don't edit by hand. |
| `candidates.json` | Unverified wish list the verifier reads. Edit this, then re-run the verifier. |
| `keywords.json` | `include` / `exclude` lists that keep community sources (tier 3, and broad feeds) on-topic. |

Entry fields: `id`, `name`, `type` (`rss` \| `atom` \| `api` \| `html-list`), `url`, `tier` (1 primary/official, 2 established press or researchers, 3 community), `defaultCategory`, `enabled`, `notes`.

## Verifying

```
npm run verify-sources            # NODE_USE_ENV_PROXY=1 if you're behind an HTTPS proxy
```

Fetches every candidate (20 s timeout, one retry). Entries pass if they return HTTP 200 and a real RSS/Atom feed with at least one item, JSON with a non-empty list (`api`), or an HTML page with at least 10 links (`html-list`). A feed served as the other format is kept and retyped. Failures are dropped and listed; details go to `data/logs/verify-sources.json`.

## Keywords

Match case-insensitively on whole words/phrases against the **title only** (never body text). Keep an item if it matches any `include` term and no `exclude` term. Apply to tier 3 sources and to broad feeds noted as needing it.
