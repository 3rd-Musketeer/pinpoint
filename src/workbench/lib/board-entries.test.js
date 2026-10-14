import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANVAS_ENTRY_ID,
  ENTRY_TAG_LABELS,
  boardEntries,
  boardHasCanvas,
  boardShowsTabBar,
  contentsModel,
  defaultEntryId,
  entryById,
  entryForm,
  entryTag,
  outlineSlice,
  resolveEntry,
  tabHasOutline,
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

/* ---- 阶段 7：类型 tag 与「内容」区坍缩 ---------------------------------- */

test('entryTag：画布 / 文档；草稿不打标（tag 由产物条目独占）', () => {
  const entries = boardEntries(mixedBoard());
  assert.equal(entryTag(entries[0]), 'canvas');
  assert.equal(entryTag(entries[1]), 'doc');
  assert.equal(entryTag(null), null);
  assert.equal(ENTRY_TAG_LABELS.canvas, '画布');
  assert.equal(ENTRY_TAG_LABELS.doc, '文档');
});

test('contentsModel：纯画布页坍缩条目行（无「画布」行），树保留', () => {
  const canvasOnly = boardEntries({
    sections: [{ id: 'a', title: 'A', layout: 'row', screens: [{ id: 'home', shell: 'app' }] }],
  });
  const model = contentsModel(canvasOnly);
  assert.equal(model.hidden, false);
  assert.equal(model.tree, true);
  assert.deepEqual(model.productRows, []);       // 条目行坍缩
  assert.deepEqual(model.drafts, []);
  assert.equal(model.canvas.id, CANVAS_ENTRY_ID);
});

test('contentsModel：纯单 doc 屏页整区隐藏', () => {
  const singleDoc = boardEntries({
    sections: [{ id: 'd', title: 'D', layout: 'column', screens: [{ id: 'v1', shell: 'doc' }] }],
  });
  assert.equal(contentsModel(singleDoc).hidden, true);
});

test('contentsModel：混合页产物 / 草稿分组全出；多文档页出产物行', () => {
  const mixed = contentsModel(boardEntries(mixedBoard()));
  assert.equal(mixed.hidden, false);
  assert.equal(mixed.tree, true);
  assert.deepEqual(mixed.productRows.map((e) => e.id), [CANVAS_ENTRY_ID, 'spec']);
  assert.deepEqual(mixed.drafts.map((e) => e.id), ['draft-variants']);

  const multiDoc = contentsModel(boardEntries({
    sections: [{ id: 'd', title: 'D', layout: 'column', screens: [{ id: 'v1', shell: 'doc' }, { id: 'v2', shell: 'doc', role: 'draft' }] }],
  }));
  assert.equal(multiDoc.hidden, false);
  assert.equal(multiDoc.tree, false);            // 无画布 → 无树
  assert.deepEqual(multiDoc.productRows.map((e) => e.id), ['v1']);
  assert.deepEqual(multiDoc.drafts.map((e) => e.id), ['v2']);

  assert.equal(contentsModel([]).hidden, true);  // 空板
  assert.equal(contentsModel(null).hidden, true);
});

test('outlineSlice：按 tab 切画布 section，文档只留在第一个 tab；无 tab 是整棵树', () => {
  const tabbed = {
    tabs: [
      { id: 'comps', title: '组件', sections: [{
        id: 'btn', title: '按钮', layout: 'row',
        screens: [
          { id: 'btn-a', title: '默认', shell: 'app' },
          { id: 'spec', title: '说明', shell: 'doc' },
        ],
      }] },
      { id: 'flow', title: '交互', sections: [{
        id: 'onboard', title: '引导', layout: 'row',
        screens: [
          { id: 'ob', title: '欢迎', shell: 'app' },
          { id: 'note', title: '笔记', shell: 'doc' },
        ],
      }] },
    ],
  };
  const first = outlineSlice(tabbed, 'comps');
  assert.deepEqual(first.entries.map((e) => e.id), [CANVAS_ENTRY_ID, 'spec', 'note']);
  assert.deepEqual(first.view.sections.map((s) => s.id), ['btn']);
  assert.equal(first.showDocs, true);
  const second = outlineSlice(tabbed, 'flow');
  assert.deepEqual(second.entries.map((e) => e.id), [CANVAS_ENTRY_ID]);
  assert.deepEqual(second.view.sections.map((s) => s.id), ['onboard']);
  assert.equal(second.showDocs, false);
  const whole = outlineSlice(tabbed, '');
  assert.deepEqual(whole.view.sections.map((s) => s.id), ['btn']);
  assert.equal(whole.showDocs, true);
  const legacy = outlineSlice(mixedBoard(), '');
  assert.deepEqual(legacy.entries.map((e) => e.id), [CANVAS_ENTRY_ID, 'spec', 'draft-variants']);
  assert.deepEqual(legacy.view.sections.map((s) => s.id), ['proto', 'writeup']);
  assert.equal(boardHasCanvas(tabbed), true);
  assert.equal(boardHasCanvas(mixedBoard()), true);
  assert.equal(boardHasCanvas({
    sections: [{ id: 'd', screens: [{ id: 'v1', shell: 'doc' }] }],
  }), false);
});

test('纯文档的多 tab 页：条照出；每个 tab 的浮层只列自己的文档，不到 2 篇的 tab 不带大纲钮', () => {
  const docTabs = {
    tabs: [
      { id: 'versions', title: '版本', sections: [{
        id: 'vers', title: '版本', shell: 'doc',
        screens: [{ id: 'v1', title: 'V1', shell: 'doc' }, { id: 'v2', title: 'V2', shell: 'doc' }],
      }] },
      { id: 'compare', title: '对比', sections: [{
        id: 'cmp', title: '对比', shell: 'doc',
        screens: [{ id: 'a', title: 'A', shell: 'doc' }, { id: 'b', title: 'B', shell: 'doc' }, { id: 'c', title: 'C', shell: 'doc' }],
      }] },
      { id: 'solo', title: '单篇', sections: [{
        id: 'one', title: '单篇', shell: 'doc', screens: [{ id: 's1', title: 'S1', shell: 'doc' }],
      }] },
    ],
  };
  assert.equal(boardHasCanvas(docTabs), false);
  assert.equal(boardShowsTabBar(docTabs), true);
  assert.deepEqual(outlineSlice(docTabs, 'versions').entries.map((e) => e.id), ['v1', 'v2']);
  assert.deepEqual(outlineSlice(docTabs, 'compare').entries.map((e) => e.id), ['a', 'b', 'c']);
  assert.deepEqual(outlineSlice(docTabs, '').entries.map((e) => e.id), ['v1', 'v2']);
  assert.equal(tabHasOutline(docTabs, 'versions'), true);
  assert.equal(tabHasOutline(docTabs, 'solo'), false);

  // 单 tab 的纯文档页、没有 tab 的纯文档页：不出条
  const oneTab = { tabs: [docTabs.tabs[1]] };
  assert.equal(boardShowsTabBar(oneTab), false);
  assert.equal(boardShowsTabBar({ sections: [{ id: 'd', screens: [{ id: 'v1', shell: 'doc' }] }] }), false);
  // 有画布的页：不论几个 tab 都出，每个 tab 都带大纲钮
  assert.equal(boardShowsTabBar(mixedBoard()), true);
  assert.equal(tabHasOutline(mixedBoard(), ''), true);
});
