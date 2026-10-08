# Daily run

This is the one file the scheduled task executes. You are Claude Code, running unattended from the repository root, once a day (early morning, US Eastern). The goal: collect, rank and publish today's edition, or publish nothing and say why.

Scripts do everything deterministic. You do the judging: scoring each batch and writing the editor's note. Follow the steps in order. Don't ask questions; nobody is there to answer.

## Hard rules

- **Publish only through `npm run daily:publish`, and only after `npm run check` has exited 0.** Never run `git push` or `git commit` yourself, never use `--force`, never push to another branch, never open a pull request.
- **Never get green by weakening a check.** Don't edit scripts, schemas, prompts, sources or tests during a run. Don't edit anything in `data/` by hand except the `editorNote` in today's edition.
- **Stop at the first failure you can't repair** (the repair limits are in each step). Then follow [Failing](#failing), and stop. A day with no edition is better than a bad one.
- Individual source errors during collection are normal. They never fail a run on their own.
- Every command below runs in the repository root. "D" means the edition date that `daily:start` prints (an America/New_York calendar day).

## 0. Dependencies

If `node_modules` is missing, run `npm ci`.

## 1. Start

```
npm run daily:start
```

This discards leftovers from an earlier failed run (generated files only), runs `git pull --ff-only` from the deploy branch (the upstream, or origin's default branch on a fresh session branch), clears **today's** batches, scored files, dropped links and edition so this run starts clean and overwrites the day, and records D. Note D from its last line.

It refuses to start (exit 1) if the working tree has uncommitted changes to anything but generated files, or if the pull can't fast-forward. That is a failure: see [Failing](#failing).

## 2. Collect and dedupe

```
npm run collect
npm run dedupe
```

Ignore per-source errors in the table. Failure means a command exits non-zero, or `collect` keeps 0 items.

## 3. Rank

```
npm run rank -- --prepare
```

Then score every batch exactly as `prompts/rank-run.md` describes (sections 2 to 4), using `prompts/editorial-rubric.md`. Skip rank-run.md's section 6, "Report": the summary at the end of this file replaces it. In short:

1. Read `prompts/editorial-rubric.md` in full before the first batch.
2. For each `data/work/D.batch-N.json`, write `data/work/D.scored-N.json` at once. Every item exactly once, in `items` or `skipped`; a 3 to 6 word label for each cluster; `trendReason` whenever trend differs from `trendBaseline`; no `total`.
3. Open source URLs only for titles that are truly ambiguous. **At most 15 fetches in the whole run**, logged in `fetches`.

Then:

```
npm run rank -- --assemble
```

If it lists problems, fix the scored file it names and run it again. **At most 3 repair attempts**, then fail.

Then write the editor's note. Open `data/editions/D.json` and replace the placeholder `editorNote` with the note, following the rubric: at most 600 characters, plain voice, the day's one or two real themes taken from the lead, top items and trending clusters, no hype words, no quote over 15 words. Change nothing else in that file. Then:

```
npm run rank -- --validate
```

This checks the edition against the rubric's rules and syncs `data/latest.json` and `data/archive.json`. It must exit 0; fix what it names (at most 3 attempts).

## 4. Build and check

```
npm run build
npm run check -- --require --date D
```

`check` verifies: every data file against its schema, the site files are current, the edition has a lead, at least 20 ranked items and no duplicate URLs, and every featured URL answers a `HEAD` request with 2xx or 3xx (or 401/403/429, a server refusing bots) within 5 seconds. Read its exit code:

- **0: it passed.** Go to step 5.
- **2: dead links were dropped and the edition was re-featured.** This is not a failure. Read the new lead and top items it printed. Does the editor's note still describe the edition? If it names, or depends on, a story that was dropped, rewrite the note (same rules). Then run `npm run rank -- --validate`, `npm run build`, `npm run check -- --require --date D` again. **At most 3 rounds of this**; a fourth exit 2 is a failure.
- **1: it failed.** Its problems are printed and saved in `data/logs/D-check.json`. Do not try to work around them: the edition is not publishable. If the problem is something you caused in step 3 (for example an editor's note over the limit), you may fix that and re-run once. Otherwise fail, using the problems it printed as the reason.

## 5. Publish

```
npm run daily:publish
```

It re-verifies the edition, commits exactly `Edition D` (the day's data, the edition and the built site files, nothing else) and pushes. The host redeploys on push. Both of these outcomes are success:

- `Pushed to origin/<branch>`.
- `Nothing to commit: edition D is identical to what is already published` (a re-run that reproduced the same day).

If it exits non-zero it has already rolled its commit back and nothing was published. That is a failure: see [Failing](#failing).

## 6. Summary

Run step 7 first (it needs no summary line), then:

```
npm run daily:summary
```

Your final message is **exactly its five lines**, with nothing before or after:

```
Collected: <n> items from <m> sources
After dedupe: <n> stories
Ranked: <n> items
Lead: <the lead headline>
Source errors: none   (or: Source errors (<k>): <id> (<reason>), …)
```

## 7. Newsletter draft

Only after step 5 succeeded and pushed (including "Nothing to commit"). Never when the run failed.

```
npm run newsletter
```

It turns `data/latest.json` into a Markdown email (date, editor's note, lead, top 5, innovations, footer links) and saves it in Buttondown as a **draft**. A same-day re-run updates that draft instead of adding another. **Never send, schedule or publish anything:** the person reviews and sends from Buttondown, and the script has no way to do it. Needs `BUTTONDOWN_API_KEY` in the environment; never print it.

If D is a Sunday in America/New_York, also run `npm run newsletter -- --weekly` (a second draft: the week's 10 highest totals and the longest-running trending cluster).

The edition is already live, so a newsletter problem is **not** a run failure: don't run `daily:fail`, don't write a failed.md. Retry once; if it still fails, carry on to step 6 and keep the five-line summary as is. (The error is printed in the command output.)

## Failing

When something fails and you can't repair it within the limits above:

1. Do not push anything. Do not run `daily:publish`.
2. Run `npm run daily:fail -- "<step>" "<the reason, in one or two sentences, quoting the failing command's error>"`. It writes `data/logs/D-failed.md` (including the last gate report, if there is one). Use step names like `start`, `collect`, `dedupe`, `rank`, `check`, `publish`.
3. Run `npm run daily:summary`. Its five lines, with `Lead: none (run failed: …)`, are your final message.
4. Stop.

## Re-running the same day

Re-running this file the same day is safe. `daily:start` pulls the earlier edition, then clears that day's work files and edition so nothing stale (not even the old editor's note) carries over; the run regenerates everything and `daily:publish` commits only if the result differs. A failed run leaves nothing pushed, and the next run discards its generated leftovers before starting.

## What the exit codes and files mean

| Command | Exit | Meaning |
| --- | --- | --- |
| `npm run check` | 0 | publishable |
| | 1 | not publishable; reasons printed and in `data/logs/D-check.json` |
| | 2 | dead links dropped, edition re-featured; review the note, rebuild, re-check |
| `npm run daily:*` | 1 | it refused or failed; the message says why |

| File | What it is |
| --- | --- |
| `data/work/D.dropped.json` | featured items whose link failed the check; `rank --assemble` leaves them out |
| `data/logs/D.json` | the collection log (which sources errored) |
| `data/logs/D-check.json` | the last gate report |
| `data/work/D.newsletter.md` | the email's Markdown, written only by `npm run newsletter -- --dry-run` |
| `data/logs/D-failed.md` | why a run stopped (never pushed) |
| `data/work/daily-run.json` | the run's date and status (never pushed) |
