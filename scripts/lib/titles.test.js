import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entitiesOf, isVersionToken, jaccard, tokenize } from './titles.js';

test('tokenize joins versions, drops filler and plural endings', () => {
  assert.deepEqual([...tokenize('GPT-5 and GPT 5 launches new models')].sort(), ['gpt5']);
  // "Top 10" is a list size, not a version, so it is not joined; "Large 4" is.
  assert.deepEqual([...tokenize("Top 10 Tools for Mistral's Large 4")].sort(), ['large4', 'mistral', 'tool', 'top']);
});

test('jaccard of identical, disjoint and overlapping sets', () => {
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0);
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['b', 'c'])), 1 / 3);
});

test('entities: known names, versions, acronyms, brand case, mid-title proper nouns', () => {
  const e = entitiesOf('Google DeepMind releases Gemini 3.5 Flash for NVIDIA GPUs');
  for (const want of ['google', 'deepmind', 'gemini', 'gemini3.5', 'nvidia']) assert.ok(e.has(want), want);
  assert.ok(entitiesOf('Ask Alexander about OpenAI').has('alexander'));
  assert.ok(entitiesOf('New LLM and GPU tricks').size === 0);
});

test('Title Case headlines do not turn every word into an entity', () => {
  const e = entitiesOf('How To Build Better Retrieval Systems With Careful Evaluation');
  assert.equal(e.size, 0);
});

test('isVersionToken', () => {
  for (const t of ['gpt5', 'llama4', 'atlas2', 'gemini3.5', 'gpt4o']) assert.ok(isVersionToken(t), t);
  for (const t of ['top10', 'q3', 'h100', 'openai', '2026']) assert.ok(!isVersionToken(t), t);
});
