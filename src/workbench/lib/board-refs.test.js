import test from 'node:test';
import assert from 'node:assert/strict';

import { boardRefs, frameRef, sectionLetter } from './board-refs.js';

const BOARD = {
  sections: [
    { id: 'home', title: '首页', layout: 'column', screens: [{ id: 'home', title: 'Today' }] },
    { id: 'flow', title: '流程', layout: 'row', screens: [
      { id: 'a', title: '第一步' },
      'b',
      { id: 'c' },
    ] },
  ],
};

test('sectionLetter: 0→A … 25→Z，26 起表格列名式递进', () => {
  assert.equal(sectionLetter(0), 'A');
  assert.equal(sectionLetter(1), 'B');
  assert.equal(sectionLetter(25), 'Z');
  assert.equal(sectionLetter(26), 'AA');
  assert.equal(sectionLetter(27), 'AB');
  assert.equal(sectionLetter(52), 'BA');
});

test('boardRefs: 引用号纯由顺序派生，字符串 screen 与无 title 走 id 兜底', () => {
  const { outline, bySection, byFrame } = boardRefs(BOARD);
  assert.equal(outline.length, 2);
  assert.deepEqual(outline[0], {
    id: 'home', title: '首页', letter: 'A',
    frames: [{ id: 'home', title: 'Today', ref: 'A1' }],
  });
  assert.equal(outline[1].letter, 'B');
  assert.deepEqual(outline[1].frames.map((f) => f.ref), ['B1', 'B2', 'B3']);
  assert.equal(outline[1].frames[1].title, 'b'); // 字符串 screen 无 title → id
  assert.equal(outline[1].frames[2].title, 'c'); // 无 title → id
  assert.equal(bySection.flow, 'B');
  assert.equal(byFrame['flow\0c'], 'B3');
});

test('boardRefs: _empty 占位不进引用体系，空 board 安全返回', () => {
  const { outline } = boardRefs({ sections: [{ id: '_empty', screens: [{ id: 'x' }] }] });
  assert.equal(outline.length, 0);
  assert.deepEqual(boardRefs(null), { outline: [], bySection: {}, byFrame: {} });
  assert.deepEqual(boardRefs({}), { outline: [], bySection: {}, byFrame: {} });
});

test('boardRefs: 同一 screen 重复挂载取首次出现的引用号', () => {
  const { byFrame } = boardRefs({
    sections: [
      { id: 's1', screens: ['dup'] },
      { id: 's2', screens: ['dup'] },
    ],
  });
  assert.equal(byFrame['s1\0dup'], 'A1');
  assert.equal(byFrame['s2\0dup'], 'B1');
});

test('frameRef: 命中返回引用号，缺参/未命中返回空串', () => {
  assert.equal(frameRef(BOARD, 'flow', 'b'), 'B2');
  assert.equal(frameRef(BOARD, 'flow', 'nope'), '');
  assert.equal(frameRef(BOARD, 'nope', 'b'), '');
  assert.equal(frameRef(null, 'flow', 'b'), '');
  assert.equal(frameRef(BOARD, '', 'b'), '');
});
