import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { root } from './lib/schemas.js';

const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/bundle.js'), ...args], { encoding: 'utf8' });

test('bundle puts the site at the root and only the published data under /data', async () => {
  const out = path.join(root, 'dist-test');
  try {
    assert.equal(run('--out', 'dist-test').status, 0);
    for (const f of ['index.html', 'config.js', 'js/app.js', 'data/latest.json', 'data/archive.json']) assert.ok(existsSync(path.join(out, f)), f);
    for (const f of ['data/raw', 'data/work', 'data/logs', 'README.md', 'data/editions/README.md']) assert.ok(!existsSync(path.join(out, f)), `${f} must not be deployed`);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('bundle refuses an output folder outside the repository', () => {
  assert.notEqual(run('--out', '/tmp/somewhere-else').status, 0);
});
