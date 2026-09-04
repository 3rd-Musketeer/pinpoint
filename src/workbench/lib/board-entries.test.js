import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACHED_SECTION_ID,
  CANVAS_ENTRY_ID,
  ENTRY_TAG_LABELS,
  attachedEntrySrc,
  boardEntries,
  canvasBoard,
  contentsModel,
  defaultEntryId,
  entryById,
  entryForm,
  entryTag,
  resolveEntry,
  withAttachedScreens,
  withEntryWeb,
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


/* ---- 阶段 7：类型 tag 与「内容」区坍缩 ---------------------------------- */

test('entryTag：画布 / 文档 / 网页；草稿不打标（tag 由产物条目独占）', () => {
  const entries = boardEntries(mixedBoard());
  assert.equal(entryTag(entries[0]), 'canvas');
  assert.equal(entryTag(entries[1]), 'doc');
  assert.equal(entryTag(withEntryWeb(entries, 'url')[1]), 'web');
  assert.equal(entryTag(null), null);
  assert.equal(ENTRY_TAG_LABELS.canvas, '画布');
  assert.equal(ENTRY_TAG_LABELS.doc, '文档');
  assert.equal(ENTRY_TAG_LABELS.web, '网页');
});

test('withEntryWeb：page.kind === "url" 时产物 doc 条目打 web 标记，其余原样', () => {
  const entries = boardEntries(mixedBoard());
  const marked = withEntryWeb(entries, 'url');
  assert.equal(marked[0].web, undefined);   // 画布条目不打标
  assert.equal(marked[1].web, true);        // 产物 doc 打标
  assert.equal(marked[2].web, undefined);   // 草稿不打标（网页是产物类型）
  assert.equal(marked[1].kind, 'doc');      // 行为键不动
  // 非 url 页原样返回（同一数组引用，零拷贝）
  assert.equal(withEntryWeb(entries, 'dir'), entries);
  assert.equal(withEntryWeb(entries, undefined), entries);
  assert.deepEqual(withEntryWeb([], 'url'), []);
  assert.equal(withEntryWeb(null, 'url'), null);
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

test('contentsModel：纯单 doc 屏页整区隐藏；单网页条目页仍出行', () => {
  const singleDoc = boardEntries({
    sections: [{ id: 'd', title: 'D', layout: 'column', screens: [{ id: 'v1', shell: 'doc' }] }],
  });
  assert.equal(contentsModel(singleDoc).hidden, true);
  // 同一形态但来自 url 条目（web 标记）：tag 不能坍缩掉 → 区仍出
  const web = contentsModel(withEntryWeb(singleDoc, 'url'));
  assert.equal(web.hidden, false);
  assert.equal(web.tree, false);
  assert.deepEqual(web.productRows.map((e) => e.id), ['v1']);
  assert.equal(entryTag(web.productRows[0]), 'web');
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

/* ---- 阶段 8：registry attach 条目合并（pinpoint add --page）--------------- */

function attachedFixtures() {
  return [
    { id: 'live-draft', title: '按钮三 variant', kind: 'file', path: '/tmp/x/Live Draft.html', page: 'mixed', role: 'draft' },
    { id: 'notes', title: '笔记目录', kind: 'dir', path: '/tmp/notes', page: 'mixed' },
    { id: 'other-page-entry', kind: 'file', path: '/tmp/x/o.html', page: 'elsewhere' },
    { id: 'webapp', kind: 'url', url: 'https://x.localhost', page: 'mixed' }, // 非法组合（registry 已拦），这里诚实跳过
  ];
}

test('attachedEntrySrc：file → sites/<id>/<percent-encode 文件名>，dir → sites/<id>/，url → null', () => {
  assert.equal(attachedEntrySrc(attachedFixtures()[0]), 'sites/live-draft/Live%20Draft.html');
  assert.equal(attachedEntrySrc(attachedFixtures()[1]), 'sites/notes/');
  assert.equal(attachedEntrySrc(attachedFixtures()[3]), null);
  assert.equal(attachedEntrySrc(null), null);
  assert.equal(attachedEntrySrc({ id: 'x', kind: 'file' }), null, 'file 缺 path 不合成');
});

test('withAttachedScreens：归属本页的条目合并成「登记」section 的合成 doc 屏', () => {
  const merged = withAttachedScreens(mixedBoard(), attachedFixtures(), 'mixed');
  assert.equal(merged.sections.length, 3);
  const sec = merged.sections[2];
  assert.equal(sec.id, ATTACHED_SECTION_ID);
  assert.equal(sec.layout, 'column');
  assert.equal(sec.shell, 'doc');
  assert.deepEqual(sec.screens.map((s) => s.id), ['live-draft', 'notes']);
  assert.deepEqual(sec.screens[0], {
    id: 'live-draft', title: '按钮三 variant', note: '', shell: 'doc',
    role: 'draft', src: 'sites/live-draft/Live%20Draft.html', attached: true,
  });
  assert.equal(sec.screens[1].role, 'product', 'role 缺省 = product');
  // 别的页的归属 / 非法 url 组合不合并；原 board 不被改写
  const bare = mixedBoard();
  assert.equal(bare.sections.length, 2);
  assert.equal(withAttachedScreens(mixedBoard(), attachedFixtures(), 'elsewhere').sections.length, 3, 'elsewhere 页有自己的归属条目');
  assert.equal(withAttachedScreens(bare, attachedFixtures(), 'nobody'), bare, '无归属条目的页原样返回（同引用）');
  assert.equal(withAttachedScreens(bare, [], 'mixed'), bare);
  assert.equal(withAttachedScreens(bare, null, 'mixed'), bare);
});

test('withAttachedScreens：屏 id / section id 撞名时追加序号', () => {
  const board = {
    sections: [{
      id: ATTACHED_SECTION_ID, title: '撞名', layout: 'column', shell: 'doc',
      screens: [{ id: 'live-draft', shell: 'doc' }],
    }],
  };
  const merged = withAttachedScreens(board, [attachedFixtures()[0]], 'mixed');
  assert.equal(merged.sections[1].id, ATTACHED_SECTION_ID + '-2');
  assert.equal(merged.sections[1].screens[0].id, 'live-draft-2');
});

test('attach 屏经 boardEntries 派生成 doc 条目（带 attached 标记），withEntryWeb 不打网页 tag', () => {
  const merged = withAttachedScreens(mixedBoard(), attachedFixtures(), 'mixed');
  const entries = boardEntries(merged);
  assert.deepEqual(entries.map((e) => e.id), [CANVAS_ENTRY_ID, 'spec', 'draft-variants', 'live-draft', 'notes']);
  assert.equal(entries[3].role, 'draft');
  assert.equal(entries[3].attached, true);
  assert.equal(entries[4].attached, true);
  assert.equal(entries[1].attached, undefined, '本页自己的 doc 屏不带标记');
  // 即便目标页本身是 url 条目页，attach 进来的产物条目也不是「网页」
  const marked = withEntryWeb(boardEntries(merged), 'url');
  assert.equal(marked[4].web, undefined);
  assert.equal(marked[1].web, true, '页自己的产物 doc 仍打网页 tag');
  // 分组：attach 草稿进草稿组，attach 产物进产物组
  const model = contentsModel(entries);
  assert.deepEqual(model.drafts.map((e) => e.id), ['draft-variants', 'live-draft']);
  assert.deepEqual(model.productRows.map((e) => e.id), [CANVAS_ENTRY_ID, 'spec', 'notes']);
});
