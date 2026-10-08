import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkLink, checkLinks } from './links.js';

const hits = [];
const server = http.createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`);
  const route = {
    '/ok': () => res.writeHead(200).end(req.method === 'HEAD' ? undefined : 'body'),
    '/moved': () => res.writeHead(301, { location: '/gone' }).end(),
    '/gone': () => res.writeHead(404).end(),
    '/broken': () => res.writeHead(500).end(),
    '/forbidden': () => res.writeHead(403).end(),
    '/nohead': () => (req.method === 'HEAD' ? res.writeHead(405).end() : res.writeHead(206).end('x')),
    '/nohead-dead': () => (req.method === 'HEAD' ? res.writeHead(405).end() : res.writeHead(404).end()),
    '/hang': () => {},
  }[req.url];
  (route ?? (() => res.writeHead(404).end()))();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => { server.closeAllConnections(); server.close(); });

test('2xx passes', async () => {
  assert.deepEqual(await checkLink(`${base}/ok`), { ok: true, status: 200 });
  assert.ok(hits.includes('HEAD /ok'), 'uses HEAD');
});

test('3xx passes without following the redirect', async () => {
  hits.length = 0;
  assert.deepEqual(await checkLink(`${base}/moved`), { ok: true, status: 301 });
  assert.ok(!hits.includes('HEAD /gone'), 'the redirect target is not requested');
});

test('4xx and 5xx fail, except bot-blocks (401/403/429), which count as alive', async () => {
  assert.deepEqual(await checkLink(`${base}/gone`), { ok: false, status: 404, error: 'HTTP 404' });
  assert.deepEqual(await checkLink(`${base}/broken`), { ok: false, status: 500, error: 'HTTP 500' });
  assert.deepEqual(await checkLink(`${base}/forbidden`), { ok: true, status: 403 });
});

test('a server without HEAD (405) gets one GET instead of being called dead', async () => {
  hits.length = 0;
  assert.deepEqual(await checkLink(`${base}/nohead`), { ok: true, status: 206 });
  assert.deepEqual(hits, ['HEAD /nohead', 'GET /nohead']);
  assert.equal((await checkLink(`${base}/nohead-dead`)).ok, false, 'but a 404 on the GET is still dead');
});

test('a server that never answers times out', async () => {
  const started = Date.now();
  const r = await checkLink(`${base}/hang`, { timeoutMs: 150 });
  assert.equal(r.ok, false);
  assert.match(r.error, /timed out after 0\.15s/);
  assert.ok(Date.now() - started < 2000);
});

test('connection errors fail with a reason', async () => {
  const r = await checkLink('http://127.0.0.1:1/', { timeoutMs: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.status, null);
  assert.ok(r.error);
});

test('checkLinks keeps input order under limited concurrency', async () => {
  const urls = ['/ok', '/gone', '/moved', '/broken', '/ok'].map((p) => `${base}${p}`);
  const results = await checkLinks(urls, { concurrency: 2 });
  assert.deepEqual(results.map((r) => r.status), [200, 404, 301, 500, 200]);
  assert.deepEqual(await checkLinks([]), []);
});
