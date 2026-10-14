import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterPages,
  visiblePages,
  PAGE_KIND_ICONS,
  pageKindKey
} from './page-groups.js';

var PAGES = [
  { id: 'library', title: 'Example Library' },
  { id: 'weekly', title: '周报卡' },
  { id: 'daily', title: 'daily review' },
  { id: 'loose', title: 'my-todos' }
];

test('visiblePages：模板页机制退役后全量返回（pp2 切片 3）', () => {
  assert.deepEqual(visiblePages(PAGES).map((p) => p.id), PAGES.map((p) => p.id));
  assert.deepEqual(visiblePages([]), []);
});

test('搜索：标题或 id 的大小写无关子串，空查询全留', () => {
  assert.deepEqual(filterPages(PAGES, '周报').map((p) => p.id), ['weekly']);
  assert.deepEqual(filterPages(PAGES, 'LIBRARY').map((p) => p.id), ['library']);
  assert.deepEqual(filterPages(PAGES, '  ').length, PAGES.length);
});

test('pageKindKey：画布 / 文档 / 网页三分，每种都有图标', () => {
  assert.equal(pageKindKey({ id: 'x', kind: 'dir', mode: 'ios' }), 'canvas');
  assert.equal(pageKindKey({ id: 'x', kind: 'dir', mode: 'html' }), 'doc');
  assert.equal(pageKindKey({ id: 'x', kind: 'file', mode: 'html' }), 'doc');
  assert.equal(pageKindKey({ id: 'x', kind: 'url', mode: 'html' }), 'web');
  assert.equal(pageKindKey({ id: 'library', mode: 'ios' }), 'canvas');
  assert.equal(pageKindKey({ id: 'doc-library', mode: 'html' }), 'doc');
  for (const k of ['canvas', 'doc', 'web']) assert.ok(PAGE_KIND_ICONS[k]);
});
