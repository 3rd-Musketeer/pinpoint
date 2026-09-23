import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NOTE_CARD_W, noteCardPosition } from './note-card-pos.js';

const CARD_H = 60;

test('right side has room: card sits beside the row with the comment-bubble gap', () => {
  // 1280 视口，行右缘 940（工作台列表贴横条右端的几何）：右侧放得下。
  const pos = noteCardPosition({ left: 660, right: 940, top: 100 }, NOTE_CARD_W, CARD_H, 1280, 720);
  assert.equal(pos.left, 940 + 13);
  assert.equal(pos.top, 100 - 4);
});

test('right side crowded: flip to the left of the row, same gap', () => {
  // 行右缘离视口右沿只剩 200 < 186 + 13 + 12，翻左。
  const pos = noteCardPosition({ left: 600, right: 1100, top: 100 }, NOTE_CARD_W, CARD_H, 1280, 720);
  assert.equal(pos.left, 600 - NOTE_CARD_W - 13);
});

test('neither side fits whole: clamp inside the viewport margin, never out of view', () => {
  // 行贴着右沿：右侧溢出 → 翻左后仍为负 → 钳到左缘边距（退化位，卡压行，但不许出视口）。
  const pos = noteCardPosition({ left: 40, right: 1268, top: 100 }, NOTE_CARD_W, CARD_H, 1280, 720);
  assert.equal(pos.left, 12);
});

test('vertical clamp: a row near the top or bottom edge keeps the card in view', () => {
  const topRow = noteCardPosition({ left: 0, right: 300, top: 2 }, NOTE_CARD_W, CARD_H, 1280, 720);
  assert.equal(topRow.top, 12);
  const bottomRow = noteCardPosition({ left: 0, right: 300, top: 700 }, NOTE_CARD_W, CARD_H, 1280, 720);
  assert.equal(bottomRow.top, 720 - CARD_H - 12);
});

test('position is rounded to whole pixels', () => {
  const pos = noteCardPosition({ left: 100.4, right: 300.6, top: 100.5 }, NOTE_CARD_W, CARD_H, 1280, 720);
  assert.equal(pos.left, Math.round(pos.left));
  assert.equal(pos.top, Math.round(pos.top));
  assert.equal(pos.left, Math.round(300.6 + 13));
});
