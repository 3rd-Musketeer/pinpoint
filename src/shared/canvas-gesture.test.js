import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHROME_GAP,
  PAN_DRAG_THRESHOLD_SQ,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP_IN,
  ZOOM_STEP_OUT,
  clampZoom,
  formatZoomLabel,
  isExplicitPanGesture,
  scrollAfterZoom,
} from './canvas-gesture.js';

test('手势常量与 zoom 轴：步进落在轴范围内，两端夹取一致', () => {
  // ctrl+wheel 一步从轴端往里缩不出范围（0.92 × 0.5 夹回 0.5）。
  assert.equal(clampZoom(ZOOM_MIN * ZOOM_STEP_OUT), ZOOM_MIN);
  assert.equal(clampZoom(ZOOM_MAX * ZOOM_STEP_IN), ZOOM_MAX);
  assert.ok(ZOOM_STEP_OUT < 1 && ZOOM_STEP_IN > 1);
  assert.equal(PAN_DRAG_THRESHOLD_SQ, 16, '拖动判定 = 位移 4px（平方 16）');
  assert.equal(CHROME_GAP, 12, 'chromeInsets 的浮动间隙');
});

test('scrollAfterZoom：指针底下的画布点缩放前后不动', () => {
  // wrap 左上角在 scroll 坐标 (200, 100)；指针在视口 (300, 150)，scroll (300, 250)
  // → 指针底下的画布点是 (600, 400)。放大 1.5 倍后它必须仍在指针底下：
  // 新画布点 = origin + (旧画布点 - origin) × ratio = 新 scroll + mouse。
  var ratio = 1.5;
  var left = scrollAfterZoom(300, 300, 200, ratio);
  var top = scrollAfterZoom(250, 150, 100, ratio);
  assert.equal(left + 300, 200 + (600 - 200) * ratio);
  assert.equal(top + 150, 100 + (400 - 100) * ratio);
  // ratio = 1 时 scroll 原样。
  assert.equal(scrollAfterZoom(37, 300, 200, 1), 37);
});

test('isExplicitPanGesture：中键与空格+左键是显式手势，其余不是', () => {
  assert.equal(isExplicitPanGesture(1, false), true);
  assert.equal(isExplicitPanGesture(0, true), true);
  assert.equal(isExplicitPanGesture(0, false), false);
  assert.equal(isExplicitPanGesture(2, true), false);
  assert.equal(isExplicitPanGesture(1, true), true);
});

test('clampZoom / formatZoomLabel：坏值回落，两位小数', () => {
  assert.equal(clampZoom('nope'), 1);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom(1.08 * 0.92), 0.99);
  assert.equal(formatZoomLabel(0.855), '86%');
  assert.equal(formatZoomLabel(undefined), '100%');
});
