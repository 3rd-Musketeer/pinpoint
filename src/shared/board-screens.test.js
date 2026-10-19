import assert from 'node:assert/strict';
import test from 'node:test';

import { screenEntries, screenEntry } from './board-screens.js';

test('screenEntries：按板序逐屏产出，字符串屏归一，带所在 section', () => {
  const board = {
    sections: [
      { id: 's1', title: '一', screens: ['a', { id: 'b', title: 'B' }] },
      { id: 's2', screens: [{ id: 'c', shell: 'doc' }] },
    ],
  };
  const entries = screenEntries(board);
  assert.deepEqual(entries.map((e) => e.screen.id), ['a', 'b', 'c']);
  assert.deepEqual(entries[0].screen, { id: 'a' });
  assert.equal(entries[1].screen.title, 'B');
  assert.equal(entries[2].section.id, 's2');
  assert.equal(entries[0].section.title, '一');
});

test('screenEntries：同一屏 id 只出第一次（编译 / 装载 / findScreen 的既有口径）', () => {
  const board = {
    sections: [
      { id: 's1', screens: [{ id: 'a', title: '第一处' }] },
      { id: 's2', screens: [{ id: 'a', title: '第二处' }, 'b'] },
    ],
  };
  const entries = screenEntries(board);
  assert.deepEqual(entries.map((e) => e.screen.id), ['a', 'b']);
  assert.equal(entries[0].screen.title, '第一处');
  assert.equal(entries[0].section.id, 's1');
});

test('screenEntries：tabs 摊平后遍历（与读侧归一同一条）', () => {
  const board = {
    tabs: [
      { id: 't1', title: '一', sections: [{ id: 's1', screens: ['a'] }] },
      { id: 't2', title: '二', sections: [{ id: 's2', screens: ['b'] }] },
    ],
  };
  const entries = screenEntries(board);
  assert.deepEqual(entries.map((e) => e.screen.id), ['a', 'b']);
  assert.equal(entries[1].section.tabId, 't2');
});

test('screenEntries：坏形状宽容跳过，不校验 id 合法性（归 validateBoard / 编译侧）', () => {
  assert.deepEqual(screenEntries(null), []);
  assert.deepEqual(screenEntries({}), []);
  assert.deepEqual(screenEntries({ sections: 'x' }), []);
  const entries = screenEntries({
    sections: [
      null,
      { id: 's1', screens: [null, 42, {}, { id: '' }, { id: 'ok' }] },
      { id: 's2' },
    ],
  });
  assert.deepEqual(entries.map((e) => e.screen.id), ['ok']);
});

test('screenEntry：屏 id → 第一个命中；没有 → null', () => {
  const board = { sections: [{ id: 's1', screens: ['a', { id: 'b' }] }] };
  assert.equal(screenEntry(board, 'b').screen.id, 'b');
  assert.equal(screenEntry(board, 'a').section.id, 's1');
  assert.equal(screenEntry(board, 'nope'), null);
  assert.equal(screenEntry(null, 'a'), null);
});
