#!/usr/bin/env node
// Plumbing for the scheduled daily run (prompts/daily-run.md). The judging is Claude's; this does the rest.
//   npm run daily:start            clean leftovers, git pull, reset today's work files, record the run's date
//   npm run daily:publish          re-verify, commit "Edition YYYY-MM-DD" and push (rolls the commit back if the push fails)
//   npm run daily:summary          print the five-line summary
//   npm run daily:fail -- "<step>" "<reason>"   write data/logs/<date>-failed.md (never touches git)
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { editionDate, toUtcIso } from './lib/dates.js';
import { GENERATED_ROOTS, INDEX_HTML, PUSH_RETRY_DELAYS_MS, classifyDirty, failureReport, formatSummary, isPushRejection, parsePorcelain, publishSpecs, staleWorkFiles } from './lib/daily.js';
import { root } from './lib/schemas.js';
import { stampOgMeta } from './lib/site-build.js';

const [command, ...args] = process.argv.slice(2);
const stateFile = path.join(root, 'data/work/daily-run.json');
const rel = (p) => path.relative(root, p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const git = (gitArgs, { quiet = false } = {}) => {
  const r = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
  if (!quiet && r.status !== 0) console.error(`git ${gitArgs.join(' ')}\n${r.stderr.trim()}`);
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const readJson = (file) => readFile(file, 'utf8').then(JSON.parse, () => null);
const node = (script, scriptArgs) => spawnSync(process.execPath, [path.join(root, 'scripts', script), ...scriptArgs], { cwd: root, stdio: 'inherit' }).status;
const die = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
async function requireState() {
  const state = await readJson(stateFile);
  if (!state) die('No daily run is in progress (data/work/daily-run.json is missing). Run `npm run daily:start` first.');
  return state;
}
/** Specs that match something git knows or could add (git add errors on a spec that matches nothing). */
const liveSpecs = (specs) => specs.filter((s) => git(['ls-files', '--cached', '--others', '--exclude-standard', '--', s], { quiet: true }).out.trim());

// ---------- start ----------
async function start() {
  const date = editionDate();
  const dirty = parsePorcelain(git(['status', '--porcelain', '--untracked-files=all']).out);

  let indexOnlyMeta = false;
  if (dirty.some((d) => d.path === INDEX_HTML)) {
    const head = git(['show', `HEAD:${INDEX_HTML}`], { quiet: true }).out;
    const work = await readFile(path.join(root, INDEX_HTML), 'utf8');
    indexOnlyMeta = head && stampOgMeta(head, '') === stampOgMeta(work, '');
  }
  const { generated, other } = classifyDirty(dirty, { indexOnlyMeta });
  if (other.length) die(`The working tree has uncommitted changes outside generated files, so a daily run can't start safely:\n  ${other.join('\n  ')}\nCommit or stash them first.`);

  if (generated.length) {
    // Leftovers of an earlier failed run: discard them (data/logs/*-failed.md is ignored by git and stays).
    const specs = [...GENERATED_ROOTS, ...(indexOnlyMeta ? [INDEX_HTML] : [])];
    const tracked = specs.filter((s) => git(['ls-files', '--', s], { quiet: true }).out.trim());
    if (tracked.length) git(['restore', '--staged', '--worktree', '--source=HEAD', '--', ...tracked]);
    git(['clean', '-fd', '--', ...GENERATED_ROOTS], { quiet: true });
    console.log(`Discarded ${generated.length} leftover generated file(s) from an earlier run.`);
  }

  const pull = git(['pull', '--ff-only']);
  if (pull.status !== 0) die('git pull --ff-only failed (see above). Nothing was changed.');
  console.log(pull.out.trim() || 'Already up to date.');

  // A fresh run owns today's work files; the old edition goes too, so its editor's note can't carry over.
  const work = path.join(root, 'data/work');
  for (const name of staleWorkFiles(date, await readdir(work).catch(() => []))) await rm(path.join(work, name));
  await rm(path.join(root, 'data/editions', `${date}.json`), { force: true });
  await rm(path.join(root, 'data/logs', `${date}-failed.md`), { force: true });
  await rm(path.join(root, 'data/logs', `${date}-check.json`), { force: true });

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  const head = git(['rev-parse', '--short', 'HEAD']).out.trim();
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify({ date, startedAt: toUtcIso(new Date()), branch, head, failed: false }, null, 2)}\n`);
  console.log(`\nDaily run for edition ${date} on ${branch} at ${head}`);
}

// ---------- publish ----------
async function publish() {
  const state = await requireState();
  const { date } = state;

  // Defence in depth: never commit an edition that wouldn't pass the gate right now (links were checked by the run).
  if (node('gate.js', ['--require', '--date', date, '--offline']) !== 0) die('The edition does not pass the publish gate; nothing was committed.');
  if (node('build.js', ['--check']) !== 0) die('The generated site files are stale; run `npm run build`. Nothing was committed.');

  const specs = liveSpecs(publishSpecs(date));
  if (git(['add', '-A', '--', ...specs]).status !== 0) die('git add failed.');
  if (git(['diff', '--cached', '--quiet'], { quiet: true }).status === 0) {
    console.log(`Nothing to commit: edition ${date} is identical to what is already published.`);
    return;
  }

  const identity = git(['config', 'user.email'], { quiet: true }).out.trim() ? [] : ['-c', 'user.name=AI Signal', '-c', 'user.email=ai-signal@users.noreply.github.com'];
  if (git([...identity, 'commit', '-q', '-m', `Edition ${date}`]).status !== 0) die('git commit failed.');
  console.log(`Committed: Edition ${date}`);

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  for (let attempt = 0; ; attempt++) {
    const push = git(['push', '-u', 'origin', branch], { quiet: true });
    if (push.status === 0) {
      console.log(`Pushed to origin/${branch}. The host redeploys on push.`);
      return;
    }
    if (isPushRejection(push.err) || attempt >= PUSH_RETRY_DELAYS_MS.length) {
      git(['reset', '--mixed', 'HEAD~1'], { quiet: true }); // un-commit; the working tree keeps the edition
      die(`git push failed${isPushRejection(push.err) ? ' (rejected)' : ` after ${attempt + 1} attempts`}:\n${push.err.trim()}\nThe commit was rolled back; nothing was published.`);
    }
    console.log(`push failed (${push.err.trim().split('\n').at(-1)}); retrying in ${PUSH_RETRY_DELAYS_MS[attempt] / 1000}s…`);
    await sleep(PUSH_RETRY_DELAYS_MS[attempt]);
  }
}

// ---------- summary ----------
async function summary() {
  const state = await readJson(stateFile);
  const date = state?.date ?? editionDate();
  const latest = await readJson(path.join(root, 'data/latest.json'));
  const edition = latest?.date === date ? latest : null;
  const collectLog = await readJson(path.join(root, 'data/logs', `${date}.json`));
  const failure = state?.failed ? state.reason ?? 'see data/logs' : null;
  console.log(formatSummary({ edition: failure ? null : edition, collectLog, failure }));
}

// ---------- fail ----------
async function fail() {
  const [step = 'unknown step', ...reason] = args;
  const state = (await readJson(stateFile)) ?? { date: editionDate() };
  const date = state.date;
  const check = await readJson(path.join(root, 'data/logs', `${date}-check.json`));
  const file = path.join(root, 'data/logs', `${date}-failed.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, failureReport({ date, step, reason: reason.join(' ') || 'no reason given', now: toUtcIso(new Date()), check }));
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify({ ...state, failed: true, reason: `${step}: ${reason.join(' ')}`.slice(0, 200) }, null, 2)}\n`);
  console.log(`Wrote ${rel(file)}. Nothing was pushed.`);
}

const commands = { start, publish, summary, fail };
if (!command) {
  console.log('The daily run is judged by Claude Code, so it is a prompt, not a script: run prompts/daily-run.md.\nThis file is its plumbing: ' + Object.keys(commands).map((c) => `daily:${c}`).join(', ') + '.');
  process.exit(0);
}
if (!commands[command]) die(`Unknown command "${command}". Use one of: ${Object.keys(commands).join(', ')}.`);
await commands[command]();
