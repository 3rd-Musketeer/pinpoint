import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIP_MIN_PX,
  MARK_BOX_PAD_PX,
  BADGE_EDGE_PX,
  badgePositionForRect,
  badgePositionInBox,
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

test('badgePositionForRect stays near clipped frame', () => {
  const pos = badgePositionForRect([10, 20, 80, 40], 11);
  assert.ok(pos.left >= 10 - 11 && pos.left <= 10 + 80 - 11);
  assert.ok(pos.top >= 20 - 11 && pos.top <= 20 + 40 - 11);
});

test('badgePositionInBox pulls a pin on a flush-right frame back inside the box', () => {
  // 2026-10-15 手机视口：贴视口右边的块（外扩 4px 后右缘 = 391），钉子默认 left = 380，22px 宽落到 402，
  // 超出 387 宽的视口 15px。收边后整枚钉子留在视口内、离边 BADGE_EDGE_PX。
  const frame = [-4, 213, 395, 42];
  const box = [0, 0, 387, 874];
  assert.equal(badgePositionForRect(frame, 11).left + 22 > 387, true);
  const pos = badgePositionInBox(frame, box, 11);
  assert.equal(pos.left, 387 - 22 - BADGE_EDGE_PX);
  assert.equal(pos.top, badgePositionForRect(frame, 11).top);
});

test('badgePositionInBox clamps the top edge too, and leaves pins already inside alone', () => {
  assert.deepEqual(badgePositionInBox([100, 0, 50, 30], [0, 0, 400, 800], 11), { left: 139, top: BADGE_EDGE_PX });
  assert.deepEqual(badgePositionInBox([100, 100, 50, 30], [0, 0, 400, 800], 11), badgePositionForRect([100, 100, 50, 30], 11));
});

test('badgePositionInBox keeps the preferred spot when the frame is outside the box or there is no box', () => {
  // 滚出视口的标注不许全堆到视口边上。
  const below = [10, 2000, 100, 40];
  assert.deepEqual(badgePositionInBox(below, [0, 0, 400, 800], 11), badgePositionForRect(below, 11));
  assert.deepEqual(badgePositionInBox([390, 10, 40, 40], null, 11), badgePositionForRect([390, 10, 40, 40], 11));
});

test('expandRect pads outward by MARK_BOX_PAD_PX', () => {
  assert.equal(MARK_BOX_PAD_PX, 4);
  assert.deepEqual(expandRect([10, 20, 100, 40]), [6, 16, 108, 48]);
  assert.deepEqual(expandRect([10, 20, 100, 40], 0), [10, 20, 100, 40]);
  assert.equal(expandRect(null), null);
});
