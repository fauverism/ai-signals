import assert from 'node:assert/strict';
import test from 'node:test';
import { createDraft, dailyMarkdown, dailySubject, persistentCluster, trimHeadline, weeklyMarkdown, weeklyTop, wordCount } from './newsletter.js';

const item = (n, total, extra = {}) => ({ id: `id${n}`, url: `https://example.com/${n}`, canonicalUrl: `https://example.com/${n}`, title: `Story number ${n}`, source: 'Src', summary: `Summary of story ${n}.`, whyItMatters: `Why ${n} matters.`, total, ...extra });
const edition = (date, extra = {}) => ({
  date, editorNote: 'A short note about the day.', lead: item(0, 8), top: [1, 2, 3, 4, 5].map((n) => item(n, 7 - n / 10)), innovations: [item(6, 5)],
  byCategory: { News: [item(7, 4)] }, trending: [], ...extra,
});
const siteUrl = 'https://example.org';

test('trimHeadline: short titles pass, long ones cut at a word with an ellipsis within 60 chars', () => {
  assert.equal(trimHeadline('Short title'), 'Short title');
  const long = 'GPT-6 and Intelligent UI for everyone arrives with a very long headline that keeps going';
  const t = trimHeadline(long);
  assert.ok(t.length <= 60 && t.endsWith('…'), t);
  assert.ok(long.startsWith(t.slice(0, -1)));
  assert.equal(trimHeadline('x'.repeat(80)).length, 60);
});

test('subject is the trimmed lead + " and 5 more"', () => {
  assert.equal(dailySubject(edition('2026-10-08')), 'Story number 0 and 5 more');
});

test('daily markdown has every section, links to originals, and fits the word limit', () => {
  const md = dailyMarkdown(edition('2026-10-08'), { siteUrl });
  assert.match(md, /^\*Thursday, October 8, 2026\*/);
  assert.match(md, /A short note about the day\./);
  assert.match(md, /## \[Story number 0\]\(https:\/\/example\.com\/0\)/);
  assert.match(md, /\*\*Why it matters:\*\* Why 0 matters\./);
  assert.equal((md.match(/^- \[Story number [1-5]\]/gm) ?? []).length, 5);
  assert.match(md, /## Innovations/);
  assert.match(md, /\[Read it on the site\]\(https:\/\/example\.org\/\) · \[Browse the archive\]\(https:\/\/example\.org\/archive\.html\)/);
  assert.ok(wordCount(md) < 600);
});

test('no innovations -> no Innovations heading; over-long mail sheds detail, then fails loudly', () => {
  assert.doesNotMatch(dailyMarkdown(edition('2026-10-08', { innovations: [] }), { siteUrl }), /Innovations/);
  const wordy = edition('2026-10-08');
  wordy.top.forEach((i) => { i.whyItMatters = 'word '.repeat(40); });
  const md = dailyMarkdown(wordy, { siteUrl, maxWords: 150 });
  assert.doesNotMatch(md, /word word/);
  assert.throws(() => dailyMarkdown(wordy, { siteUrl, maxWords: 20 }), /over 20 words/);
});

test('weekly: top 10 by total across editions, deduped by URL; most persistent cluster wins', () => {
  const mk = (date, base, trending) => edition(date, { lead: item(base, 9 - base / 100), top: [1, 2, 3, 4, 5].map((n) => item(base + n, 6)), innovations: [], byCategory: { News: [item(base + 9, 3)] }, trending });
  const a = mk('2026-10-04', 10, [{ id: 'c1', label: 'Old story', itemIds: ['id11'], leadItemId: 'id11', sources: ['A'] }, { id: 'c2', label: 'Short', itemIds: ['id12'], leadItemId: 'id12', sources: ['A'] }]);
  const b = mk('2026-10-05', 20, [{ id: 'c1b', label: 'Old story, day two', itemIds: ['id11', 'id21'], leadItemId: 'id21', sources: ['A', 'B'] }]);
  const top = weeklyTop([a, b]);
  assert.equal(top.length, 10);
  assert.ok(top.every((x, i) => i === 0 || top[i - 1].item.total >= x.item.total));
  assert.equal(new Set(top.map((x) => x.item.url)).size, 10);
  const c = persistentCluster([a, b]);
  assert.equal(c.days, 2);
  assert.equal(c.label, 'Old story, day two');
  assert.match(weeklyMarkdown([a, b], '2026-10-11', { siteUrl }), /Stayed in the news[\s\S]*2 days/);
  assert.equal(persistentCluster([edition('2026-10-08')]), null);
});

const KEY = 'sk_test_SECRET_KEY';
const respond = (status, json) => ({ ok: status < 400, status, text: async () => JSON.stringify(json) });
const recorder = (handler) => {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) }); return handler(url, init, calls); } };
};

test('createDraft POSTs status "draft" explicitly with the token auth header', async () => {
  const { calls, fetchImpl } = recorder((url, init) => (init.method === 'GET' ? respond(200, { results: [], next: null }) : respond(201, { id: 'em_1', status: 'draft', absolute_url: 'https://b/x' })));
  const r = await createDraft({ subject: 'S', body: 'B', marker: 'daily:2026-10-08' }, { apiKey: KEY, fetchImpl });
  assert.deepEqual(r, { id: 'em_1', url: 'https://b/x', action: 'created' });
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.url, 'https://api.buttondown.com/v1/emails');
  assert.equal(post.headers.authorization, `Token ${KEY}`);
  assert.equal(post.body.status, 'draft');
  assert.deepEqual(post.body.metadata, { ai_signal: 'daily:2026-10-08' });
  assert.ok(!calls.some((c) => c.headers['x-buttondown-live-dangerously']));
});

test('a same-day re-run updates the existing draft instead of creating another', async () => {
  const { calls, fetchImpl } = recorder((url, init) => (init.method === 'GET' ? respond(200, { results: [{ id: 'em_9', status: 'draft', metadata: { ai_signal: 'daily:2026-10-08' } }], next: null }) : respond(200, { id: 'em_9', status: 'draft' })));
  const r = await createDraft({ subject: 'S', body: 'B', marker: 'daily:2026-10-08' }, { apiKey: KEY, fetchImpl });
  assert.equal(r.action, 'updated');
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PATCH']);
  assert.match(calls[1].url, /\/emails\/em_9$/);
});

test('a sent email with the same marker is never touched', async () => {
  const { calls, fetchImpl } = recorder((url, init) => (init.method === 'GET' ? respond(200, { results: [{ id: 'em_9', status: 'sent', metadata: { ai_signal: 'daily:2026-10-08' } }], next: null }) : respond(201, { id: 'em_10', status: 'draft' })));
  await createDraft({ subject: 'S', body: 'B', marker: 'daily:2026-10-08' }, { apiKey: KEY, fetchImpl });
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST']);
});

test('refuses without a key; fails if the result is not a draft; errors never contain the key', async () => {
  await assert.rejects(createDraft({ subject: 'S', body: 'B', marker: 'm' }, { apiKey: undefined }), /BUTTONDOWN_API_KEY is not set/);
  const notDraft = recorder((url, init) => (init.method === 'GET' ? respond(200, { results: [] }) : respond(201, { id: 'em_2', status: 'about_to_send' })));
  await assert.rejects(createDraft({ subject: 'S', body: 'B', marker: 'm' }, { apiKey: KEY, fetchImpl: notDraft.fetchImpl }), /not "draft"/);
  const bad = recorder(() => ({ ok: false, status: 401, text: async () => `invalid token ${KEY}` }));
  await assert.rejects(createDraft({ subject: 'S', body: 'B', marker: 'm' }, { apiKey: KEY, fetchImpl: bad.fetchImpl }), (e) => /HTTP 401/.test(e.message) && !e.message.includes(KEY));
});
