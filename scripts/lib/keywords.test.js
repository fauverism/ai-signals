import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeywordFilter } from './keywords.js';

const ok = createKeywordFilter({ include: ['ai', 'llm', 'machine learning', 'a.i.'], exclude: ['bitcoin', 'hiring'] });

test('matches whole words and phrases, case-insensitively', () => {
  assert.equal(ok('New LLM beats benchmarks'), true);
  assert.equal(ok('Machine Learning for beginners'), true);
  assert.equal(ok('How A.I. is changing code'), true);
  assert.equal(ok('AI-assisted coding'), true);
});

test('does not match inside other words', () => {
  assert.equal(ok('Said the chair was fair'), false);
  assert.equal(ok('Maintaining a garden'), false);
});

test('exclude terms win over include terms', () => {
  assert.equal(ok('AI startup is hiring'), false);
  assert.equal(ok('Bitcoin and AI'), false);
});

test('no include match means off-topic', () => {
  assert.equal(ok('Show HN: my tiny database'), false);
});
