import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeywordFilter, createTopicFilter } from './keywords.js';

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

const topic = createTopicFilter({
  include: ['ai', 'llm', 'agents'],
  focus: ['ui', 'ux', 'designer', 'designers', 'figma', 'skills'],
  exclude: ['hiring'],
});

test('AI sources keep only UI/UX titles', () => {
  const src = { tier: 1 };
  assert.equal(topic(src, 'A faster tokenizer for LLM serving'), false);
  assert.equal(topic(src, 'Generating UI from a prompt'), true);
  assert.equal(topic({ tier: 2, scope: 'ai' }, 'Agent skills for Figma'), true);
});

test('tier 3 AI sources need both an AI term and a focus term', () => {
  const src = { tier: 3, scope: 'ai' };
  assert.equal(topic(src, 'My favourite UX books'), false);
  assert.equal(topic(src, 'LLM agents that write UI code'), true);
});

test('design sources keep only AI titles', () => {
  const src = { tier: 2, scope: 'design' };
  assert.equal(topic(src, 'Grid layouts for designers'), false);
  assert.equal(topic(src, 'How designers use AI to prototype'), true);
});

test('"both" sources pass everything but exclude terms', () => {
  const src = { tier: 1, scope: 'both' };
  assert.equal(topic(src, 'Inside our new editing model'), true);
  assert.equal(topic(src, 'Figma is hiring'), false);
});
