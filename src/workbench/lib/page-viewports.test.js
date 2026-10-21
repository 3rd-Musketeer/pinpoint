import test from 'node:test';
import assert from 'node:assert/strict';
import { pageViewport, savePageViewport, viewportKey } from './page-viewports.js';

const stored = new Map();
globalThis.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
};

test('视口的局部保存保留缩放、另一页及另一 tab 的存档', () => {
  savePageViewport('anchor::a', { scrollLeft: 2200, scrollTop: 2600, canvasZoom: '1.5' });
  savePageViewport('anchor::b', { scrollLeft: 2400, canvasZoom: '0.75' });
  savePageViewport('other', { scrollLeft: 10, canvasZoom: '2' });
  savePageViewport('anchor::a', { scrollLeft: 0, scrollTop: 0 });
  assert.deepEqual(pageViewport('anchor::a'), { scrollLeft: 0, scrollTop: 0, canvasZoom: '1.5' });
  assert.deepEqual(pageViewport('anchor::b'), { scrollLeft: 2400, canvasZoom: '0.75' });
  assert.deepEqual(pageViewport('other'), { scrollLeft: 10, canvasZoom: '2' });
  assert.equal(pageViewport('anchor'), null);
});

test('只有当前页的多 tab 板使用 tab 存档键，未挂载和跨页状态不借用旧 tab', () => {
  const active = { pageId: 'anchor', tabId: 'b', board: { tabs: [{ id: 'a' }, { id: 'b' }] } };
  assert.equal(viewportKey('anchor', active), 'anchor::b');
  assert.equal(viewportKey('other', active), 'other');
  assert.equal(viewportKey('anchor', null), 'anchor');
  assert.equal(viewportKey('anchor', { ...active, board: { tabs: [{ id: 'b' }] } }), 'anchor');
});
