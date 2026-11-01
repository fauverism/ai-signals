# sources

Source registry, read by `scripts/collect.js`.

| File | What it is |
| --- | --- |
| `sources.json` | The registry: only sources verified to respond with a valid feed. **Generated** by `npm run verify-sources`; don't edit by hand. |
| `candidates.json` | Unverified wish list the verifier reads. Edit this, then re-run the verifier. |
| `keywords.json` | `include` (AI), `focus` (UI/UX/design) and `exclude` lists that keep every source on the AI x UI/UX beat. |

Entry fields: `id`, `name`, `type` (`rss` \| `atom` \| `api` \| `html-list`), `url`, `tier` (1 primary/official, 2 established press or researchers, 3 community), `defaultCategory`, `enabled`, `scope` (optional: `ai`, `design` or `both`; see Keywords), `notes`.

## Verifying

```
npm run verify-sources            # NODE_USE_ENV_PROXY=1 if you're behind an HTTPS proxy
```

Fetches every candidate (20 s timeout, one retry). Entries pass if they return HTTP 200 and a real RSS/Atom feed with at least one item, JSON with a non-empty list (`api`), or an HTML page with at least 10 links (`html-list`). A feed served as the other format is kept and retyped. Failures are dropped and listed; details go to `data/logs/verify-sources.json`.

## Keywords

Match case-insensitively on whole words/phrases against the **title only** (never body text). An `exclude` term always drops the item. Otherwise it depends on the source's `scope`:

- `ai` (default): an AI source. The title needs a `focus` term (UI, UX, design, Figma, skills…); tier 3 sources also need an `include` term.
- `design`: a design source. The title needs an `include` (AI) term.
- `both`: the source already covers AI in design (Figma's blog, an ai-design tag). Only `exclude` applies.

The keywords are deliberately loose; the rubric's `off-beat` skip rule catches what slips through.
