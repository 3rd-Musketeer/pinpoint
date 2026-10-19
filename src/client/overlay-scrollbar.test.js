import assert from 'node:assert/strict';
import test from 'node:test';

import { MIN_THUMB, thumbGeometry } from './overlay-scrollbar.js';

test('thumbGeometry: 不可滚时没有条', () => {
  assert.equal(thumbGeometry(0, 400, 400, 0, 400), null);
  assert.equal(thumbGeometry(0, 401, 400, 0, 400), null); // 1px 的差算不可滚（亚像素取整）
  assert.equal(thumbGeometry(0, 800, 400, 0, 0), null);
});

test('thumbGeometry: 条长按可见比例，位置按滚动比例落在轨道里', () => {
  assert.deepEqual(thumbGeometry(0, 800, 400, 10, 400), { start: 10, len: 200, travel: 200, range: 400 });
  assert.deepEqual(thumbGeometry(200, 800, 400, 10, 400), { start: 110, len: 200, travel: 200, range: 400 });
  assert.equal(thumbGeometry(400, 800, 400, 10, 400).start, 210);
  // 回弹越界夹回轨道。
  assert.equal(thumbGeometry(-30, 800, 400, 10, 400).start, 10);
  assert.equal(thumbGeometry(999, 800, 400, 10, 400).start, 210);
});

test('thumbGeometry: 很长的内容条不短于下限，轨道比下限还短时取轨道长', () => {
  assert.equal(thumbGeometry(0, 100000, 400, 0, 400).len, MIN_THUMB);
  assert.equal(thumbGeometry(0, 100000, 10, 0, 10).len, 10);
});

test('手机视口藏条注入不进 /annotate.js 注入包（只有工作台 import 那两个出口）', async () => {
  const { buildAnnotateBundle } = await import('../server/lib/annotate-bundle.js');
  const a = await buildAnnotateBundle({ minify: false });
  assert.ok(!a.js.includes('data-pp-phone-scrollbar'), 'hidePhoneDocScrollbar 被 tree-shake 掉');
  assert.ok(a.js.includes('installOverlayScrollbars'), '注入包仍在用浮条安装');
});
