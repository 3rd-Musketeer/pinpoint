import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PHONE_FILL,
  PHONE_SCREEN_H,
  PHONE_SCREEN_W,
  VIEWPORT_LABELS,
  VIEWPORT_PHONE,
  VIEWPORT_WINDOW,
  entryHasViewport,
  normalizeViewport,
  phoneScaleFor,
  readViewportPrefs,
  viewportForPage,
  withViewportPref,
} from './viewport.js';

var canvasEntry = { id: '@canvas', kind: 'canvas', role: 'product', title: '画布' };
var docEntry = { id: 'spec', kind: 'doc', role: 'product', title: '设计说明' };
var draftEntry = { id: 'draft-variants', kind: 'doc', role: 'draft', title: '草稿' };

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

test('phoneScaleFor：屏高 = 可用高（舞台高 − 横条带）的九成，上限 1', () => {
  assert.equal(PHONE_SCREEN_W, 402);
  assert.equal(PHONE_SCREEN_H, 874);
  assert.equal(PHONE_FILL, 0.9);
  // 1600 × 1000，横条带 62：可用高 938 → 屏高 844.2 → k = 844.2 / 874
  var k = phoneScaleFor({ width: 1600, height: 1000, stripBand: 62 }, { width: 402, height: 874 });
  assert.equal(k, Math.round(0.9 * 938 / 874 * 10000) / 10000);
  assert.ok(Math.abs(k * 874 - 0.9 * 938) < 0.1);
  // 机壳 有：整块屏 438 × 910 才是要装进九成的那块
  var kb = phoneScaleFor({ width: 1600, height: 1000, stripBand: 62 }, { width: 438, height: 910 });
  assert.ok(kb < k);
  assert.ok(Math.abs(kb * 910 - 0.9 * 938) < 0.1);
  // 舞台足够高：永不放大到 1 以上
  assert.equal(phoneScaleFor({ width: 1600, height: 3000, stripBand: 62 }, { width: 402, height: 874 }), 1);
  // 窄舞台：宽也不许超过舞台宽的九成
  var kw = phoneScaleFor({ width: 300, height: 3000, stripBand: 62 }, { width: 402, height: 874 });
  assert.ok(Math.abs(kw * 402 - 0.9 * 300) < 0.1);
});

test('phoneScaleFor：缺 shell 按裸屏 402 × 874 算；量不出舞台时回 1', () => {
  var k = phoneScaleFor({ width: 1280, height: 720, stripBand: 62 });
  assert.ok(Math.abs(k * 874 - 0.9 * 658) < 0.1);
  assert.equal(phoneScaleFor({ width: 1280, height: 720, stripBand: 62 }, { width: 0, height: 0 }), k);
  assert.equal(phoneScaleFor({ width: 0, height: 0 }), 1);
  assert.equal(phoneScaleFor(null), 1);
  assert.equal(phoneScaleFor({ width: 1280, height: 50, stripBand: 62 }), 1);
  assert.equal(phoneScaleFor({ width: NaN, height: 700 }), 1);
  // stripBand 缺省 = 0
  assert.ok(phoneScaleFor({ width: 1280, height: 720 }) > phoneScaleFor({ width: 1280, height: 720, stripBand: 62 }));
});
