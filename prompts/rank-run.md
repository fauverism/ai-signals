# Ranking run

How Claude Code runs a day's ranking. The judging is yours; the script does the rest. Standard: `prompts/editorial-rubric.md`.

Commands take `--date YYYY-MM-DD` (default: today in America/New_York) and `--dry-run` (writes `data/work/<date>.dry-*.json` instead of the real edition, `latest.json` and `archive.json`; use it for rehearsals).

## 1. Prepare

```
npm run rank -- --prepare
```

Writes `data/work/<date>.batch-N.json`, about 30 items each, with a cluster's stories always in one batch. Per item you get `id`, `title`, `source`, `sourceTier`, `url`, `author`, `publishedAt`, `categoryHint`, `signals`, `trendDelta`, `trendBaseline`, `previouslyFeatured`, `clusterId`, `clusterLabel`; per batch, the `clusters` it contains.

## 2. Score each batch

1. Read `prompts/editorial-rubric.md` in full before the first batch.
2. For each batch, in order, write `data/work/<date>.scored-N.json` straight away (don't hold batches in your head). Shape:

```json
{
  "date": "2026-10-08",
  "batch": 1,
  "items": [
    {
      "id": "<40-hex id from the batch>",
      "scores": { "importance": 5, "trend": 2, "novelty": 6, "credibility": 8 },
      "category": "Tools & Releases",
      "tags": ["vector-search", "on-device"],
      "summary": "One or two sentences in your own words, 280 characters at most.",
      "whyItMatters": "What changes for a practitioner, 140 characters at most.",
      "organization": "quillbase",
      "trendReason": "only when trend differs from trendBaseline"
    }
  ],
  "skipped": [{ "id": "<id>", "reason": "listicle" }],
  "clusterLabels": [{ "id": "<cluster id from the batch>", "label": "Three to six words" }],
  "fetches": [{ "id": "<id>", "reason": "title could not tell a release from a rumor" }]
}
```

3. **Every item in the batch appears exactly once**, in `items` or in `skipped`. Copy ids exactly.
4. Scores are whole numbers. Start `trend` at `trendBaseline`; if you change it, move it by 2 at most and say why in `trendReason`.
5. Give every cluster in the batch a 3–6 word label in your own words (not the placeholder).
6. Do not write `total`, `featuredSlot` or `previouslyFeatured`. Totals are recomputed in code from the rubric's weights; anything you write there is ignored.
7. Text rules from the rubric apply: original wording, no hype words, no quote over 15 words, nothing the title and metadata don't support.

### Opening source URLs

You only have titles and metadata. Open an item's `url` (WebFetch) **only when the title is ambiguous** enough to change a score or category, such as whether it is a release or a rumor, or what a paper is about. At most **15 fetches in the whole run, across all batches**. Log each in that batch's `fetches` (`id`, `reason`); assembly fails if the total passes 15. Use what you read only to decide; never copy its wording into the summary. If a fetch is blocked, go on with the title.

## 3. Assemble

```
npm run rank -- --assemble
```

Merges the scored files, recomputes every total in code, applies the featuring rules, and writes the Edition (`data/editions/<date>.json`), `data/latest.json` and `data/archive.json`. It lists the lead, top 5, innovations and trending clusters with their scores. On any problem it prints the list and exits non-zero without writing; fix the named scored file and run it again. Re-running keeps an existing editor's note. If `data/work/<date>.dropped.json` exists (the publish gate writes it when a featured link is dead), those items are left out and the edition is re-featured from the rest.

## 4. Editor's note

Open the Edition and replace the placeholder `editorNote` with the day's note, following the rubric: at most 600 characters, plain voice, naming the 1–2 real themes of the day from the lead, top items and trending clusters. Edit nothing else in the Edition by hand.

## 5. Validate

```
npm run rank -- --validate
```

Re-checks the Edition against the schema and the rubric's rules (totals, slot rules, label lengths, text rules, note present), then syncs `latest.json` and `archive.json`. On a schema or rule failure it prints what is wrong and exits non-zero. Fix and run again until it exits 0.

## 6. Report

(In a daily run, `prompts/daily-run.md` skips this step and prints its own summary.)

Tell the user the lead, the top 5 and the innovations with their four scores, anything unusual from the assembly notes (a lead fallback, a Tutorials swap, clamped trend scores), and how many source fetches you used.
