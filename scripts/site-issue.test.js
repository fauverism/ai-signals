import assert from 'node:assert/strict';
import test from 'node:test';
import { issueOf, roman } from '../site/js/lib.js';

const archive = ['2026-10-20', '2026-10-19', '2026-10-17', '2026-10-08'].map((date) => ({ date }));

test('roman numerals', () => {
  assert.deepEqual([1, 4, 9, 14, 40, 1994].map(roman), ['I', 'IV', 'IX', 'XIV', 'XL', 'MCMXCIV']);
});

test('issue number counts editions up to and including the date; volume I in the first year', () => {
  assert.deepEqual(issueOf(archive, '2026-10-08'), { volume: 'I', number: 1 });
  assert.deepEqual(issueOf(archive, '2026-10-19'), { volume: 'I', number: 3 });
  assert.deepEqual(issueOf(archive, '2026-10-20'), { volume: 'I', number: 4 });
});

test('a new volume starts on the first anniversary', () => {
  const later = [...archive, { date: '2027-10-07' }, { date: '2027-10-08' }, { date: '2028-10-08' }];
  assert.equal(issueOf(later, '2027-10-07').volume, 'I');
  assert.equal(issueOf(later, '2027-10-08').volume, 'II');
  assert.equal(issueOf(later, '2028-10-08').volume, 'III');
});

test('an edition missing from the archive still counts itself; bad input gives null', () => {
  assert.equal(issueOf(archive, '2026-10-21').number, 5);
  assert.equal(issueOf([], '2026-10-08').number, 1);
  assert.equal(issueOf(undefined, '2026-10-08').number, 1);
  assert.equal(issueOf(archive, 'nope'), null);
});
