import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANVAS_ENTRY_ID,
  boardEntries,
  canvasBoard,
  defaultEntryId,
  entryById,
  entryForm,
  resolveEntry,
} from './board-entries.js';

function mixedBoard() {
  return {
    sections: [
      {
        id: 'proto',
        title: '原型',
        layout: 'row',
        screens: [
          { id: 'home', title: '首页', shell: 'app' },
          { id: 'detail', title: '详情', shell: 'lock' },
        ],
      },
      {
        id: 'writeup',
        title: '文稿',
        layout: 'column',
        shell: 'doc',
        screens: [
          { id: 'spec', title: '设计说明', shell: 'doc' },
          { id: 'draft-variants', title: '气泡三手感', shell: 'doc', role: 'draft' },
        ],
      },
    ],
  };
}

test('boardEntries: 混合板 → 画布条目居首 + 每个 doc 屏一个条目', () => {
  const entries = boardEntries(mixedBoard());
  assert.deepEqual(entries.map((e) => e.id), [CANVAS_ENTRY_ID, 'spec', 'draft-variants']);
  assert.deepEqual(entries.map((e) => e.kind), ['canvas', 'doc', 'doc']);
  assert.deepEqual(entries.map((e) => e.role), ['product', 'product', 'draft']);
  assert.equal(entries[0].title, '画布');
  assert.equal(entries[1].section, '文稿');
  assert.equal(entries[1].sectionId, 'writeup');
  // doc 屏条目缺 title 时回退 screenId
  const bare = boardEntries({
    sections: [{ id: 's', title: '', layout: 'column', screens: [{ id: 'only', shell: 'doc' }] }],
  });
  assert.equal(bare[0].title, 'only');
});

test('boardEntries: 纯画布板只有画布条目；纯 doc 板没有画布条目', () => {
  const canvasOnly = boardEntries({
    sections: [{ id: 'a', title: 'A', layout: 'row', screens: [{ id: 'home', shell: 'app' }, 'legacy'] }],
  });
  assert.deepEqual(canvasOnly.map((e) => e.id), [CANVAS_ENTRY_ID]);
  assert.equal(canvasOnly[0].kind, 'canvas');

  const docOnly = boardEntries({
    sections: [{ id: 'd', title: 'D', layout: 'column', screens: [{ id: 'v1', shell: 'doc' }, { id: 'v2', shell: 'doc' }] }],
  });
  assert.deepEqual(docOnly.map((e) => e.id), ['v1', 'v2']);
  assert.ok(docOnly.every((e) => e.kind === 'doc'));

  assert.deepEqual(boardEntries({ sections: [] }), []);
  assert.deepEqual(boardEntries(null), []);
});

test('画布条目 id 落在 screen id 契约之外，永不撞车', () => {
  assert.equal(CANVAS_ENTRY_ID, '@canvas');
  assert.ok(!/^[a-zA-Z0-9_-]+$/.test(CANVAS_ENTRY_ID));
});

test('defaultEntryId / entryById / resolveEntry：非法选中落默认条目', () => {
  const entries = boardEntries(mixedBoard());
  assert.equal(defaultEntryId(entries), CANVAS_ENTRY_ID);
  assert.equal(defaultEntryId([]), null);
  assert.equal(entryById(entries, 'spec').kind, 'doc');
  assert.equal(entryById(entries, 'nope'), null);
  assert.equal(resolveEntry(entries, 'draft-variants').role, 'draft');
  assert.equal(resolveEntry(entries, 'nope').id, CANVAS_ENTRY_ID);
  assert.equal(resolveEntry(entries, null).id, CANVAS_ENTRY_ID);
  assert.equal(resolveEntry([], 'x'), null);
});

test('entryForm: 文档条目 → html 阅读器形态，画布条目 → ios 画布形态', () => {
  const entries = boardEntries(mixedBoard());
  assert.equal(entryForm(entries[0]), 'ios');
  assert.equal(entryForm(entries[1]), 'html');
  assert.equal(entryForm(null), 'ios');
});

test('canvasBoard: 摘掉 doc 屏、丢掉空 section，画布屏顺序不动', () => {
  const view = canvasBoard(mixedBoard());
  assert.deepEqual(view.sections.map((s) => s.id), ['proto']);
  assert.deepEqual(view.sections[0].screens.map((s) => s.id), ['home', 'detail']);
  // 原 board 不被改写
  assert.equal(mixedBoard().sections.length, 2);
  // 混合 section 只滤屏不丢 section；纯 doc 板 → 空 sections
  const mixed = canvasBoard({
    sections: [{ id: 'm', title: 'M', layout: 'row', screens: [{ id: 'a', shell: 'app' }, { id: 'd', shell: 'doc' }] }],
  });
  assert.deepEqual(mixed.sections[0].screens.map((s) => s.id), ['a']);
  assert.deepEqual(canvasBoard({
    sections: [{ id: 'd', title: 'D', layout: 'column', screens: [{ id: 'v', shell: 'doc' }] }],
  }).sections, []);
});
