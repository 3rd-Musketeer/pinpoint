import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUTTER_BUBBLE_W,
  GUTTER_GAP,
  GUTTER_MARGIN,
  GUTTER_W,
  packGutter,
} from './annotate-bubble-layout.js';

test('constants match live gutter dimensions', () => {
  assert.equal(GUTTER_BUBBLE_W, 240);
  assert.equal(GUTTER_MARGIN, 12);
  assert.equal(GUTTER_GAP, 10);
  assert.equal(GUTTER_W, 264);
});

test('packGutter places a sparse anchor on the right at its Y', () => {
  const packed = packGutter(
    [{ n: 1, rect: [100, 80, 40, 20] }],
    { 1: 50 },
    { docW: 920 },
  );
  assert.equal(packed.length, 1);
  assert.equal(packed[0].left, 920 + GUTTER_MARGIN);
  assert.equal(packed[0].top, 80);
  assert.equal(packed[0].width, GUTTER_BUBBLE_W);
  assert.equal(packed[0].line.x1, 140);
  assert.equal(packed[0].line.x2, packed[0].left);
});

test('packGutter stacks dense anchors without overlap', () => {
  const packed = packGutter(
    [
      { n: 1, rect: [10, 40, 20, 10] },
      { n: 2, rect: [10, 50, 20, 10] },
      { n: 3, rect: [10, 60, 20, 10] },
    ],
    { 1: 40, 2: 40, 3: 40 },
    { docW: 500 },
  );
  assert.equal(packed.length, 3);
  assert.ok(packed[1].top >= packed[0].top + packed[0].height + GUTTER_GAP);
  assert.ok(packed[2].top >= packed[1].top + packed[1].height + GUTTER_GAP);
});

test('packGutter sorts by anchor Y regardless of input order', () => {
  const packed = packGutter(
    [
      { n: 2, rect: [0, 200, 10, 10] },
      { n: 1, rect: [0, 50, 10, 10] },
    ],
    { 1: 30, 2: 30 },
    { docW: 800 },
  );
  assert.deepEqual(packed.map((p) => p.n), [1, 2]);
});

test('packGutter Y-tie uses numeric n — never string sort ("11" before "7")', () => {
  const packed = packGutter(
    [
      { n: 11, rect: [0, 100, 10, 10] },
      { n: 7, rect: [40, 100, 10, 10] },
      { n: 12, rect: [80, 100, 10, 10] },
      { n: 8, rect: [120, 100, 10, 10] },
    ],
    { 7: 20, 8: 20, 11: 20, 12: 20 },
    { docW: 400 },
  );
  assert.deepEqual(packed.map((p) => p.n), [7, 8, 11, 12]);
});

test('packGutter sortBy n keeps authoring order for export', () => {
  const packed = packGutter(
    [
      { n: 9, rect: [200, 50, 10, 10] },
      { n: 6, rect: [0, 50, 10, 10] },
      { n: 7, rect: [0, 80, 10, 10] },
      { n: 8, rect: [100, 80, 10, 10] },
    ],
    { 6: 30, 7: 30, 8: 30, 9: 30 },
    { docW: 400, sortBy: 'n' },
  );
  assert.deepEqual(packed.map((p) => p.n), [6, 7, 8, 9]);
});

test('packGutter skips malformed anchors and uses fallback height', () => {
  const packed = packGutter(
    [
      { n: 1, rect: [0, 10, 10, 10] },
      { n: 2 },
      null,
    ],
    {},
    { docW: 400, fallbackHeight: 77 },
  );
  assert.equal(packed.length, 1);
  assert.equal(packed[0].height, 77);
});

test('packGutter accepts a Map for heights', () => {
  const heights = new Map([[1, 55]]);
  const packed = packGutter(
    [{ n: 1, rect: [0, 0, 10, 10] }],
    heights,
    { docW: 100 },
  );
  assert.equal(packed[0].height, 55);
});
