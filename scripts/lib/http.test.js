import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, parseRobots } from './http.js';

test('robots: our group beats *, longest rule wins, Allow wins ties', () => {
  const allowed = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: ai-signal\nDisallow: /private\nAllow: /private/ok\n`);
  assert.equal(allowed('/feed.xml'), true);
  assert.equal(allowed('/private/x'), false);
  assert.equal(allowed('/private/ok'), true);
});

test('robots: wildcard group, patterns with * and $', () => {
  const allowed = parseRobots(`User-agent: *\nDisallow: /search\nDisallow: /*.json$\n`);
  assert.equal(allowed('/search?q=1'), false);
  assert.equal(allowed('/data.json'), false);
  assert.equal(allowed('/data.json.txt'), true);
  assert.equal(allowed('/rss'), true);
});

test('robots: Disallow: / blocks everything, empty file allows everything', () => {
  assert.equal(parseRobots('User-agent: *\nDisallow: /').call(null, '/anything'), false);
  assert.equal(parseRobots('')('/anything'), true);
});

test('caps concurrent requests per host at 3', async () => {
  let active = 0;
  let peak = 0;
  const fetchImpl = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return new Response('ok', { status: 200 });
  };
  const http = createHttp({ fetchImpl });
  await Promise.all(Array.from({ length: 10 }, (_, i) => http.get(`https://same.example/${i}`)));
  assert.equal(peak, 3);
});

test('throws on non-200/304 responses', async () => {
  const http = createHttp({ fetchImpl: async () => new Response('no', { status: 404 }) });
  await assert.rejects(http.get('https://x.example/'), /HTTP 404/);
});

test('304 resolves with no body', async () => {
  const http = createHttp({ fetchImpl: async () => new Response(null, { status: 304 }) });
  const res = await http.get('https://x.example/');
  assert.equal(res.status, 304);
});
