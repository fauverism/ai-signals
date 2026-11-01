# prompts

Claude's rubric and run instructions. Claude does judgment only (scoring, summaries, cluster labels, the editor's note); scripts do everything deterministic.

| File | What it is |
| --- | --- |
| `editorial-rubric.md` | The ranking standard: four scored dimensions with anchors, the total formula, featuring rules, skip rules, writing rules. |
| `rank-run.md` | How Claude Code runs a day's ranking with `npm run rank`: prepare, score batches, assemble, write the editor's note, validate. |
| `weekly-run.md` | The one file the Monday scheduled task executes: pull, collect, dedupe, rank, build, check, publish, summarize; and what to do when any step fails. |
| `daily-run.md` | Retired stub that points to `weekly-run.md`, kept so an older scheduled task still works. |
