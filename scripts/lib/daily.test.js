import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDirty, failureReport, formatSummary, isPushRejection, parsePorcelain, publishSpecs, staleWorkFiles } from './daily.js';

test('porcelain output is parsed, including renames', () => {
  assert.deepEqual(parsePorcelain(' M data/latest.json\n?? data/raw/2026-10-08.json\nR  a.txt -> b.txt\n'), [
    { xy: ' M', path: 'data/latest.json' }, { xy: '??', path: 'data/raw/2026-10-08.json' }, { xy: 'R ', path: 'b.txt' },
  ]);
});

test('only generated paths count as discardable leftovers', () => {
  const entries = parsePorcelain(' M data/editions/2026-10-08.json\n?? site/og/2026-10-08.png\n M site/feed.xml\n M scripts/rank.js\n M site/css/site.css\n M data/README.md');
  const { generated, other } = classifyDirty(entries);
  assert.deepEqual(generated, ['data/editions/2026-10-08.json', 'site/og/2026-10-08.png', 'site/feed.xml']);
  assert.deepEqual(other, ['scripts/rank.js', 'site/css/site.css', 'data/README.md']);
});

test('site/index.html is generated only when just its meta block changed', () => {
  const entries = parsePorcelain(' M site/index.html');
  assert.deepEqual(classifyDirty(entries, { indexOnlyMeta: false }).other, ['site/index.html']);
  assert.deepEqual(classifyDirty(entries, { indexOnlyMeta: true }).generated, ['site/index.html']);
});

test("a fresh run clears that day's batches, scored files and dropped links only", () => {
  const names = ['2026-10-08.batch-1.json', '2026-10-08.scored-2.json', '2026-10-08.dropped.json', '2026-10-07.scored-1.json', '2026-10-08.dry-edition.json', 'daily-run.json', 'README.md'];
  assert.deepEqual(staleWorkFiles('2026-10-08', names), ['2026-10-08.batch-1.json', '2026-10-08.scored-2.json', '2026-10-08.dropped.json']);
});

test("the commit contains the day's data, the edition and the built site files, nothing else", () => {
  const specs = publishSpecs('2026-10-08');
  for (const want of ['data/editions/2026-10-08.json', 'data/latest.json', 'data/archive.json', 'data/work/2026-10-08.scored-*.json', 'data/raw/2026-10-08.deduped.json', 'site/feed.xml', 'site/sitemap.xml', 'site/search-index.json', 'site/og', 'site/index.html']) assert.ok(specs.includes(want), want);
  assert.ok(!specs.some((s) => s.startsWith('scripts') || s.startsWith('prompts') || s.startsWith('schemas') || s.startsWith('sources')));
  assert.ok(!specs.some((s) => s.includes('2026-10-07')), 'only this date');
});

const edition = { lead: { title: 'GPT-6 and Intelligent UI for everyone' }, stats: { collected: 1027, afterDedupe: 801, ranked: 110 } };
const log = { totals: { sources: 67, kept: 1027 }, sources: [{ id: 'a', status: 'ok' }, { id: 'hn-llm', status: 'error', notes: ['HTTP 503'] }, { id: 'reddit-x', status: 'robots' }] };

test('the summary is exactly five lines', () => {
  const lines = formatSummary({ edition, collectLog: log }).split('\n');
  assert.equal(lines.length, 5);
  assert.deepEqual(lines, [
    'Collected: 1,027 items from 67 sources',
    'After dedupe: 801 stories',
    'Ranked: 110 items',
    'Lead: GPT-6 and Intelligent UI for everyone',
    'Source errors (1): hn-llm (HTTP 503)',
  ]);
});

test('no errored sources says so; robots and skipped sources are not errors', () => {
  const clean = formatSummary({ edition, collectLog: { ...log, sources: [{ id: 'r', status: 'robots' }, { id: 's', status: 'skipped' }] } });
  assert.equal(clean.split('\n').at(-1), 'Source errors: none');
});

test('a failed run still produces five lines and says why', () => {
  const lines = formatSummary({ edition: null, collectLog: log, failure: 'check: only 12 items were ranked' }).split('\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[3], 'Lead: none (run failed: check: only 12 items were ranked)');
  assert.equal(lines[1], 'After dedupe: n/a stories');
  assert.equal(formatSummary({ edition: null, collectLog: null }).split('\n').length, 5);
});

test('the failure report names the step and reason and says nothing was pushed', () => {
  const md = failureReport({ date: '2026-10-08', step: 'check', reason: 'only 12 items were ranked', now: '2026-10-08T11:00:00Z', check: { checkedAt: 'x', passed: false, problems: ['p1'], dropped: [{ url: 'https://d.example', reason: 'HTTP 404' }] } });
  assert.match(md, /^# Daily run failed: 2026-10-08/);
  assert.match(md, /\*\*Step:\*\* check/);
  assert.match(md, /only 12 items were ranked/);
  assert.match(md, /Pushed:\*\* nothing/);
  assert.match(md, /- p1/);
  assert.match(md, /https:\/\/d\.example \(HTTP 404\)/);
});

test('push rejections are not retried, network errors are', () => {
  assert.equal(isPushRejection('! [rejected] main -> main (fetch first)'), true);
  assert.equal(isPushRejection('remote: Permission to x denied'), true);
  assert.equal(isPushRejection('fatal: unable to access: Could not resolve host'), false);
});
