import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editionDate, isInWindow, parseToUtcIso, toUtcIso, windowStart } from './dates.js';

const at = (iso) => new Date(iso);

test('editionDate is the America/New_York day (EDT, UTC-4)', () => {
  assert.equal(editionDate(at('2026-10-08T03:59:59Z')), '2026-10-07'); // 23:59 EDT
  assert.equal(editionDate(at('2026-10-08T04:00:00Z')), '2026-10-08'); // 00:00 EDT
});

test('editionDate is the America/New_York day (EST, UTC-5)', () => {
  assert.equal(editionDate(at('2026-12-15T04:59:59Z')), '2026-12-14'); // 23:59 EST
  assert.equal(editionDate(at('2026-12-15T05:00:00Z')), '2026-12-15'); // 00:00 EST
});

test('editionDate handles the DST transitions', () => {
  // Spring forward, 2026-03-08: midnight is still EST (UTC-5).
  assert.equal(editionDate(at('2026-03-08T04:59:59Z')), '2026-03-07');
  assert.equal(editionDate(at('2026-03-08T05:00:00Z')), '2026-03-08');
  // Fall back, 2026-11-01: midnight is still EDT (UTC-4), and the next midnight is EST.
  assert.equal(editionDate(at('2026-11-01T03:59:59Z')), '2026-10-31');
  assert.equal(editionDate(at('2026-11-01T04:00:00Z')), '2026-11-01');
  assert.equal(editionDate(at('2026-11-02T04:59:59Z')), '2026-11-01');
  assert.equal(editionDate(at('2026-11-02T05:00:00Z')), '2026-11-02');
});

test('toUtcIso drops milliseconds and keeps the Z', () => {
  assert.equal(toUtcIso(at('2026-10-07T13:45:00.123Z')), '2026-10-07T13:45:00Z');
});

test('parseToUtcIso converts RFC 822 and offset dates to UTC', () => {
  assert.equal(parseToUtcIso('Tue, 06 Oct 2026 15:00:00 GMT'), '2026-10-06T15:00:00Z');
  assert.equal(parseToUtcIso('Tue, 06 Oct 2026 11:00:00 -0400'), '2026-10-06T15:00:00Z');
  assert.equal(parseToUtcIso('2026-10-06T11:00:00-04:00'), '2026-10-06T15:00:00Z');
});

test('parseToUtcIso rejects missing and invalid dates', () => {
  assert.equal(parseToUtcIso(undefined), null);
  assert.equal(parseToUtcIso(''), null);
  assert.equal(parseToUtcIso('not a date'), null);
});

const now = at('2026-10-07T12:00:00Z');

test('window keeps items published within the last 36 hours', () => {
  assert.equal(isInWindow('2026-10-07T11:59:00Z', now, 36), true);
  assert.equal(isInWindow('2026-10-06T00:00:01Z', now, 36), true);
});

test('window boundary: exactly 36h old is in, older is out', () => {
  assert.equal(isInWindow('2026-10-05T23:59:59Z', now, 36), false);
  assert.equal(isInWindow('2026-10-06T00:00:00Z', now, 36), true);
});

test('window is configurable', () => {
  assert.equal(isInWindow('2026-10-06T00:00:00Z', now, 12), false);
  assert.equal(isInWindow('2026-10-06T00:00:00Z', now, 72), true);
});

test('window allows a little clock skew but not far-future dates', () => {
  assert.equal(isInWindow('2026-10-07T12:30:00Z', now, 36), true);
  assert.equal(isInWindow('2026-10-07T13:00:01Z', now, 36), false);
  assert.equal(isInWindow('2026-10-20T00:00:00Z', now, 36), false);
});

test('window rejects missing or invalid dates', () => {
  assert.equal(isInWindow(null, now, 36), false);
  assert.equal(isInWindow('garbage', now, 36), false);
});

test('windowStart is `hours` before now', () => {
  assert.equal(windowStart(now, 36).toISOString(), '2026-10-06T00:00:00.000Z');
});
