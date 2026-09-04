import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIP_MIN_PX,
  MARK_BOX_PAD_PX,
  badgePositionForRect,
  clampPointToRect,
  clipByRects,
  expandRect,
  intersectRects,
  isVisibleEnough,
} from './annotate-clip.js';

test('intersectRects returns overlap', () => {
  assert.deepEqual(intersectRects([0, 0, 100, 100], [50, 50, 100, 100]), [50, 50, 50, 50]);
});

test('intersectRects returns null when disjoint', () => {
  assert.equal(intersectRects([0, 0, 10, 10], [20, 20, 5, 5]), null);
  assert.equal(intersectRects([0, 0, 10, 10], [10, 0, 5, 5]), null); // edge touch, zero area
});

test('intersectRects null args', () => {
  assert.equal(intersectRects(null, [0, 0, 1, 1]), null);
  assert.equal(intersectRects([0, 0, 1, 1], undefined), null);
});

test('clipByRects chains intersections', () => {
  const target = [0, 0, 200, 200];
  const clips = [
    [0, 0, 100, 100], // phone screen
    [0, 40, 100, 60], // scrolled app viewport
  ];
  assert.deepEqual(clipByRects(target, clips), [0, 40, 100, 60]);
});

test('clipByRects empty clips keeps target', () => {
  assert.deepEqual(clipByRects([1, 2, 3, 4], []), [1, 2, 3, 4]);
  assert.deepEqual(clipByRects([1, 2, 3, 4], null), [1, 2, 3, 4]);
});

test('clipByRects scrolled fully out yields null', () => {
  const target = [0, 0, 40, 40];
  const clips = [[0, 100, 100, 200]]; // clip below target
  assert.equal(clipByRects(target, clips), null);
});

test('isVisibleEnough respects CLIP_MIN_PX', () => {
  assert.equal(isVisibleEnough([0, 0, CLIP_MIN_PX, CLIP_MIN_PX]), true);
  assert.equal(isVisibleEnough([0, 0, CLIP_MIN_PX - 1, 10]), false);
  assert.equal(isVisibleEnough(null), false);
});

test('clampPointToRect keeps point inside', () => {
  assert.deepEqual(clampPointToRect(-5, 50, [0, 0, 100, 100]), [0, 50]);
  assert.deepEqual(clampPointToRect(150, 150, [0, 0, 100, 100]), [99, 99]);
});

test('badgePositionForRect stays near clipped frame', () => {
  const pos = badgePositionForRect([10, 20, 80, 40], 11);
  assert.ok(pos.left >= 10 - 11 && pos.left <= 10 + 80 - 11);
  assert.ok(pos.top >= 20 - 11 && pos.top <= 20 + 40 - 11);
});

test('expandRect pads outward by MARK_BOX_PAD_PX', () => {
  assert.equal(MARK_BOX_PAD_PX, 4);
  assert.deepEqual(expandRect([10, 20, 100, 40]), [6, 16, 108, 48]);
  assert.deepEqual(expandRect([10, 20, 100, 40], 0), [10, 20, 100, 40]);
  assert.equal(expandRect(null), null);
});
