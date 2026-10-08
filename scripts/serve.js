#!/usr/bin/env node
// Serves the repo root on localhost so /site/ can fetch ../data/*.json.
// Usage: node scripts/serve.js [--port 8080] [--dry]
//   --dry maps /data/latest.json, /data/archive.json and /data/editions/<date>.json to the newest
//   data/work/<date>.dry-*.json files, to preview a dry-run edition before anything is published.
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { root } from './lib/schemas.js';

const argv = process.argv.slice(2);
const port = Number(argv[argv.indexOf('--port') + 1] || 8080);
const dry = argv.includes('--dry');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

async function newestDry(suffix) {
  const names = (await readdir(path.join(root, 'data/work')).catch(() => [])).filter((n) => n.endsWith(`.dry-${suffix}.json`)).sort();
  return names.length ? path.join(root, 'data/work', names.at(-1)) : null;
}

async function resolve(urlPath) {
  if (dry) {
    if (urlPath === '/data/latest.json') return newestDry('latest');
    if (urlPath === '/data/archive.json') return newestDry('archive');
    const m = urlPath.match(/^\/data\/editions\/(\d{4}-\d{2}-\d{2})\.json$/);
    if (m) return path.join(root, 'data/work', `${m[1]}.dry-edition.json`);
  }
  const file = path.join(root, decodeURIComponent(urlPath));
  if (file !== root && !file.startsWith(root + path.sep)) return null; // no path traversal
  const s = await stat(file).catch(() => null);
  return s?.isDirectory() ? path.join(file, 'index.html') : file;
}

http
  .createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/') {
      res.writeHead(302, { location: '/site/' }).end();
      return;
    }
    const file = await resolve(pathname).catch(() => null);
    const s = file && (await stat(file).catch(() => null));
    if (!s?.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`Serving ${root}${dry ? ' (dry-run data)' : ''}\n  http://127.0.0.1:${port}/site/`));
