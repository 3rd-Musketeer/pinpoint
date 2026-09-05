import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterPages,
  folderOfPage,
  groupPages,
  isTemplatePage,
  nextFolderId,
  orderOfPage,
  pushRecent,
  recentRows,
  visiblePages,
  PAGE_KIND_ICONS,
  pageKindKey
} from './page-groups.js';

var PAGES = [
  { id: 'components', title: 'Component Library' },
  { id: 'library', title: 'Example Library' },
  { id: 'weekly', title: '周报卡', folder: 'time', order: 1 },
  { id: 'daily', title: 'daily review', folder: 'time', order: 0 },
  { id: 'ghost', title: '指着不存在的夹', folder: 'gone' },
  { id: 'loose', title: 'my-todos' }
];

test('模板页默认藏起来，当前页除外（选中态不能没有落点）', () => {
  assert.equal(isTemplatePage('doc-library'), true);
  assert.equal(isTemplatePage('weekly'), false);

  assert.deepEqual(
    visiblePages(PAGES, {}).map((p) => p.id),
    ['weekly', 'daily', 'ghost', 'loose']
  );
  assert.deepEqual(
    visiblePages(PAGES, { keepId: 'library' }).map((p) => p.id),
    ['library', 'weekly', 'daily', 'ghost', 'loose']
  );
  assert.equal(visiblePages(PAGES, { showTemplates: true }).length, PAGES.length);
});

test('搜索：标题或 id 的大小写无关子串，空查询全留', () => {
  assert.deepEqual(filterPages(PAGES, '周报').map((p) => p.id), ['weekly']);
  assert.deepEqual(filterPages(PAGES, 'LIBRARY').map((p) => p.id), ['components', 'library']);
  assert.deepEqual(filterPages(PAGES, '  ').length, PAGES.length);
});

test('归属：条目看自己的 folder / order，模板页看顶层 pageFolders / pageOrder', () => {
  assert.equal(folderOfPage({ id: 'weekly', folder: 'time' }, { weekly: 'other' }), 'time');
  assert.equal(folderOfPage({ id: 'library' }, { library: 'tpl' }), 'tpl');
  assert.equal(folderOfPage({ id: 'library' }, {}), null);
  assert.equal(orderOfPage({ id: 'library' }, { library: 3 }), 3);
  assert.equal(orderOfPage({ id: 'library' }, {}), null);
});

test('分组：夹在前散页在后，未知夹的页落回散页，夹内「默认」档吃 order', () => {
  var model = groupPages({
    pages: PAGES,
    folders: [{ id: 'time', name: 'areta-time', collapsed: true }],
    pageFolders: { library: 'time' },
    sort: 'default'
  });

  assert.deepEqual(model.folders.map((f) => [f.id, f.name, f.collapsed]), [['time', 'areta-time', true]]);
  // daily(order 0) 在 weekly(order 1) 前；library 没有 order，沉底。
  assert.deepEqual(model.folders[0].pages.map((p) => p.id), ['daily', 'weekly', 'library']);
  // 指着不存在的夹的 ghost 与真散页都在散页区，书写顺序保持。
  assert.deepEqual(model.loose.map((p) => p.id), ['components', 'ghost', 'loose']);
});

test('分组：非「默认」档夹内按该档排，order 不参与', () => {
  var model = groupPages({
    pages: PAGES,
    folders: [{ id: 'time' }],
    sort: 'name'
  });
  assert.equal(model.folders[0].name, 'time', 'name 缺省等于 id');
  // zh locale：汉字标题排在拉丁标题前（与 page-sort 的「名称」档同一条比较）。
  assert.deepEqual(model.folders[0].pages.map((p) => p.id), ['weekly', 'daily']);
});

test('新夹 id：名称能派生 slug 就用，中文名或撞车落 folder-N', () => {
  assert.equal(nextFolderId([], 'Design Drafts'), 'design-drafts');
  assert.equal(nextFolderId(['design-drafts'], 'Design Drafts'), 'folder-1');
  assert.equal(nextFolderId(['folder-1'], '设计稿'), 'folder-2');
});

test('最近：最新在前、去重、封顶五条；只渲染还存在的页', () => {
  var list = [];
  ['a', 'b', 'c', 'd', 'e', 'f'].forEach((id, i) => { list = pushRecent(list, id, 100 + i); });
  assert.deepEqual(list.map((r) => r.id), ['f', 'e', 'd', 'c', 'b']);

  list = pushRecent(list, 'b', 200);
  assert.deepEqual(list.map((r) => r.id), ['b', 'f', 'e', 'd', 'c']);
  assert.equal(list[0].at, 200);

  var rows = recentRows(list, [{ id: 'b', title: 'B' }, { id: 'e', title: 'E' }]);
  assert.deepEqual(rows.map((r) => [r.page.id, r.at]), [['b', 200], ['e', 104]]);
});

test('pageKindKey：画布 / 文档 / 网页三分，每种都有图标', () => {
  assert.equal(pageKindKey({ id: 'x', kind: 'dir', mode: 'ios' }), 'canvas');
  assert.equal(pageKindKey({ id: 'x', kind: 'dir', mode: 'html' }), 'doc');
  assert.equal(pageKindKey({ id: 'x', kind: 'file', mode: 'html' }), 'doc');
  assert.equal(pageKindKey({ id: 'x', kind: 'url', mode: 'html' }), 'web');
  assert.equal(pageKindKey({ id: 'components', title: 'Component Library', system: true, mode: 'ios' }), 'canvas');
  assert.equal(pageKindKey({ id: 'library', mode: 'ios' }), 'canvas');
  assert.equal(pageKindKey({ id: 'doc-library', mode: 'html' }), 'doc');
  for (const k of ['canvas', 'doc', 'web']) assert.ok(PAGE_KIND_ICONS[k]);
});
