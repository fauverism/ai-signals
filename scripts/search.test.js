import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RESULTS, debounce, search, segments, termsOf } from '../site/js/search.js';

const entry = (o) => ({ id: o.id ?? o.t, t: o.t, u: 'https://e.example/x', s: 'Src', c: 'News', g: o.g ?? [], m: o.m ?? '', d: o.d ?? '2026-10-01' });
const titles = (r) => r.entries.map((e) => e.t);

test('terms are lowercased, split on whitespace and de-duplicated', () => {
  assert.deepEqual(termsOf('  Open  WEIGHT open '), ['open', 'weight']);
  assert.deepEqual(termsOf('   '), []);
});

test('every term must match somewhere in title, tags or summary, case-insensitively', () => {
  const index = [
    entry({ t: 'Mistral releases Large 4', g: ['open-weights'], m: 'A new model.' }),
    entry({ t: 'Agents in production', g: ['agents'], m: 'Mistral is mentioned here.' }),
    entry({ t: 'Unrelated', g: ['x'], m: 'Nothing.' }),
  ];
  assert.deepEqual(titles(search(index, 'MISTRAL')), ['Mistral releases Large 4', 'Agents in production']);
  assert.deepEqual(titles(search(index, 'mistral agents')), ['Agents in production']);
  assert.deepEqual(titles(search(index, 'open-weights')), ['Mistral releases Large 4']);
  assert.equal(search(index, 'zzz').total, 0);
  assert.equal(search(index, '   ').total, 0);
});

test('title hits outrank tag hits outrank summary hits; ties go to the newest edition', () => {
  const index = [
    entry({ t: 'A', m: 'about rag systems', d: '2026-10-05' }),
    entry({ t: 'B', g: ['rag'], d: '2026-10-04' }),
    entry({ t: 'RAG in practice', d: '2026-10-01' }),
    entry({ t: 'C', m: 'rag again', d: '2026-10-06' }),
  ];
  assert.deepEqual(titles(search(index, 'rag')), ['RAG in practice', 'B', 'C', 'A']);
});

test('results are capped but the total is reported', () => {
  const index = Array.from({ length: MAX_RESULTS + 20 }, (_, i) => entry({ t: `Agents ${i}`, d: `2026-09-${String((i % 28) + 1).padStart(2, '0')}` }));
  const r = search(index, 'agents');
  assert.equal(r.entries.length, MAX_RESULTS);
  assert.equal(r.total, MAX_RESULTS + 20);
});

test('segments mark every match, merge overlaps and keep the original text and case', () => {
  const parts = segments('Open-weight models: OPEN source', ['open', 'weight']);
  assert.equal(parts.map((p) => p.text).join(''), 'Open-weight models: OPEN source');
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.text), ['Open', 'weight', 'OPEN']);
  assert.deepEqual(segments('abcabc', ['abc', 'bca']).map((p) => [p.text, p.hit]), [['abcabc', true]]);
  assert.deepEqual(segments('nothing here', ['zzz']), [{ text: 'nothing here', hit: false }]);
  assert.deepEqual(segments('', ['a']), []);
});

test('debounce runs once, 150ms after the last call', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const calls = [];
    const fn = debounce((x) => calls.push(x), 150);
    fn('a'); mock.timers.tick(100);
    fn('b'); mock.timers.tick(100);
    fn('c'); mock.timers.tick(149);
    assert.deepEqual(calls, []);
    mock.timers.tick(1);
    assert.deepEqual(calls, ['c']);
  } finally {
    mock.timers.reset();
  }
});
