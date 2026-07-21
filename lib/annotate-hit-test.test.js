import assert from 'node:assert/strict';
import test from 'node:test';

import { pickContained } from './annotate-hit-test.js';

test('pickContained keeps outermost fully-inside elements', () => {
  // Document order: ancestors before descendants. The dedup is one-level
  // (direct parent), mirroring the pre-refactor regionContains.
  const rect = [0, 0, 100, 100];
  const candidates = [
    { rect: [10, 10, 80, 80], selector: '#root', parentSelector: undefined }, // outermost -> kept
    { rect: [20, 20, 60, 60], selector: '#root > #a', parentSelector: '#root' }, // child of kept -> dropped
    { rect: [30, 30, 30, 30], selector: '#root > #a > .b', parentSelector: '#root > #a' }, // parent dropped (not seen) -> kept
    { rect: [90, 90, 30, 30], selector: '#c', parentSelector: undefined }, // straddles edge -> dropped
    { rect: [200, 200, 10, 10], selector: '#far', parentSelector: undefined }, // outside -> dropped
  ];
  const out = pickContained(candidates, rect);
  assert.deepEqual(out.map((o) => o.selector), ['#root', '#root > #a > .b']);
});

test('pickContained caps at 12', () => {
  const rect = [0, 0, 1000, 1000];
  const candidates = [];
  for (let i = 0; i < 30; i++) {
    candidates.push({ rect: [i, i, 5, 5], selector: '#e' + i, parentSelector: undefined });
  }
  assert.equal(pickContained(candidates, rect).length, 12);
});

test('pickContained ignores zero-area rects', () => {
  const rect = [0, 0, 100, 100];
  const candidates = [
    { rect: [10, 10, 0, 10], selector: '#zero', parentSelector: undefined },
    { rect: [10, 10, 10, 10], selector: '#ok', parentSelector: undefined },
  ];
  const out = pickContained(candidates, rect);
  assert.deepEqual(out.map((o) => o.selector), ['#ok']);
});
