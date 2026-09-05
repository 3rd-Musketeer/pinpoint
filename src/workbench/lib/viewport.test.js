import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEWPORT_LABELS,
  VIEWPORT_PHONE,
  VIEWPORT_WINDOW,
  entryHasViewport,
  exportBoardFor,
  normalizeViewport,
  readViewportPrefs,
  stageFormFor,
  viewportForPage,
  withViewportPref,
} from './viewport.js';

var canvasEntry = { id: '@canvas', kind: 'canvas', role: 'product', title: '画布' };
var docEntry = { id: 'spec', kind: 'doc', role: 'product', title: '设计说明' };
var draftEntry = { id: 'draft-variants', kind: 'doc', role: 'draft', title: '草稿' };

function mixedBoard() {
  return {
    sections: [
      { id: 'proto', title: '原型', layout: 'row', screens: [
        { id: 'home', title: '首页', shell: 'app' },
        { id: 'detail', title: '详情', shell: 'lock' },
      ] },
      { id: 'docs', title: '文稿', layout: 'column', screens: [
        { id: 'spec', title: '设计说明', shell: 'doc' },
        { id: 'draft-variants', title: '草稿', shell: 'doc', role: 'draft' },
      ] },
    ],
  };
}

test('normalizeViewport：只认 phone，其余一律窗口', () => {
  assert.equal(normalizeViewport('phone'), VIEWPORT_PHONE);
  assert.equal(normalizeViewport('window'), VIEWPORT_WINDOW);
  assert.equal(normalizeViewport(undefined), VIEWPORT_WINDOW);
  assert.equal(normalizeViewport('tablet'), VIEWPORT_WINDOW);
  assert.equal(normalizeViewport(1), VIEWPORT_WINDOW);
  assert.deepEqual(VIEWPORT_LABELS, { window: '窗口', phone: '手机' });
});

test('viewportForPage：偏好宽容读，缺失 / 脏值 / 非对象都落窗口', () => {
  assert.equal(viewportForPage({}, 'a'), 'window');
  assert.equal(viewportForPage(null, 'a'), 'window');
  assert.equal(viewportForPage({ viewportByPage: { a: 'phone' } }, 'a'), 'phone');
  assert.equal(viewportForPage({ viewportByPage: { a: 'phone' } }, 'b'), 'window');
  assert.equal(viewportForPage({ viewportByPage: { a: 'desk' } }, 'a'), 'window');
  assert.equal(viewportForPage({ viewportByPage: ['phone'] }, '0'), 'window');
  assert.equal(viewportForPage({ viewportByPage: 'phone' }, 'a'), 'window');
  assert.equal(viewportForPage({ viewportByPage: { a: 'phone' } }, null), 'window');
  assert.deepEqual(readViewportPrefs({ viewportByPage: { a: 'phone' } }), { a: 'phone' });
  assert.deepEqual(readViewportPrefs({ viewportByPage: 3 }), {});
});

test('withViewportPref：手机写 key，回窗口删 key（默认值不积灰），不改入参', () => {
  var prefs = { viewportByPage: { a: 'phone' }, other: 1 };
  assert.deepEqual(withViewportPref(prefs, 'b', 'phone'), { viewportByPage: { a: 'phone', b: 'phone' } });
  assert.deepEqual(withViewportPref(prefs, 'a', 'window'), { viewportByPage: {} });
  assert.deepEqual(withViewportPref(prefs, 'a', 'nonsense'), { viewportByPage: {} });
  assert.deepEqual(withViewportPref({}, 'a', 'phone'), { viewportByPage: { a: 'phone' } });
  assert.deepEqual(prefs.viewportByPage, { a: 'phone' });
});

test('entryHasViewport：只有文档条目（含草稿）有视口，画布 / 空没有', () => {
  assert.equal(entryHasViewport(docEntry), true);
  assert.equal(entryHasViewport(draftEntry), true);
  assert.equal(entryHasViewport(canvasEntry), false);
  assert.equal(entryHasViewport(null), false);
});

test('stageFormFor：文档条目 + 手机 = 画布；文档 + 窗口 = 阅读器；画布条目不看视口', () => {
  assert.equal(stageFormFor(docEntry, 'window'), 'html');
  assert.equal(stageFormFor(docEntry, undefined), 'html');
  assert.equal(stageFormFor(docEntry, 'phone'), 'ios');
  assert.equal(stageFormFor(draftEntry, 'phone'), 'ios');
  assert.equal(stageFormFor(canvasEntry, 'phone'), 'ios');
  assert.equal(stageFormFor(canvasEntry, 'window'), 'ios');
  assert.equal(stageFormFor(null, 'phone'), 'ios');
});

test('exportBoardFor：手机视口只列当前文档那一帧，其余形态照 canvasBoard', () => {
  var board = mixedBoard();
  var phone = exportBoardFor(board, docEntry, 'phone');
  assert.deepEqual(phone.sections.map((s) => s.id), ['docs']);
  assert.deepEqual(phone.sections[0].screens.map((s) => s.id), ['spec']);
  assert.equal(phone.sections[0].title, '文稿');

  var win = exportBoardFor(board, docEntry, 'window');
  assert.deepEqual(win.sections.map((s) => s.id), ['proto']);
  assert.deepEqual(win.sections[0].screens.map((s) => s.id), ['home', 'detail']);

  var canvas = exportBoardFor(board, canvasEntry, 'phone');
  assert.deepEqual(canvas.sections.map((s) => s.id), ['proto']);

  // 条目不在板上（换页途中）→ 空树，不抛
  assert.deepEqual(exportBoardFor(board, { id: 'nope', kind: 'doc' }, 'phone'), { sections: [] });
  assert.deepEqual(exportBoardFor(null, docEntry, 'phone'), { sections: [] });
});
