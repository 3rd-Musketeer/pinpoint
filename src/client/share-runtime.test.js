import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// 分享运行时是经典脚本（内联进导出文件），没有 export：在 vm 里以一个不会走到
// boot 的假 document 跑一遍，取 window.__pinpointShare 上的纯函数来测。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(__dirname, 'share-runtime.js'), 'utf8');

// vm 里造出来的对象带另一个 realm 的 Object.prototype：展开成本 realm 的对象再比。
function plain(value) {
  return { ...value };
}

function loadShare() {
  const listeners = [];
  const window = {};
  const document = {
    readyState: 'loading',
    addEventListener(type, fn) { listeners.push([type, fn]); },
  };
  window.window = window;
  window.document = document;
  const context = vm.createContext({ window, document });
  vm.runInContext(SOURCE, context, { filename: 'share-runtime.js' });
  assert.deepEqual(listeners.map(([type]) => type), ['DOMContentLoaded']);
  return window.__pinpointShare;
}

test('share-runtime is a self-contained classic script', () => {
  assert.doesNotMatch(SOURCE, /<\/script/i);
  assert.doesNotMatch(SOURCE, /^\s*import\s|\bimport\s*\(|\bexport\s|\bfetch\s*\(|\bXMLHttpRequest\b/m);
});

test('zoom axis clamps to 0.5–5 with two decimals (canvas-zoom parity)', () => {
  const share = loadShare();
  assert.equal(share.clampZoom(0.1), 0.5);
  assert.equal(share.clampZoom(9), 5);
  assert.equal(share.clampZoom(1 * 1.08), 1.08);
  assert.equal(share.clampZoom(1 * 0.92 * 0.92), 0.85);
  assert.equal(share.clampZoom('nope'), 1);
  assert.equal(share.formatZoomLabel(1), '100%');
  assert.equal(share.formatZoomLabel(0.85), '85%');
  assert.equal(share.formatZoomLabel(NaN), '100%');
});

test('focus scroll centers fitting targets in the usable viewport and leading-aligns oversized ones', () => {
  const share = loadShare();
  const viewport = { width: 1000, height: 700, scrollWidth: 8000, scrollHeight: 12000 };
  // 与 src/workbench/lib/board-navigation.test.js 同一组数：无占位时行为逐字节相同。
  assert.deepEqual(
    plain(share.focusScrollForRect({ left: 3200, top: 3300, width: 400, height: 600 }, viewport)),
    { left: 2900, top: 3250 },
  );
  assert.deepEqual(
    plain(share.focusScrollForRect({ left: 3200, top: 3300, width: 1200, height: 900 }, viewport)),
    { left: 3176, top: 3276 },
  );
  assert.deepEqual(plain(share.focusScrollForRect({ left: 0, top: 0, width: 100, height: 100 }, viewport)), { left: 0, top: 0 });
  // 面板占左 264、横条占下 62：可用区 736 × 638，结果减掉起始边占位。
  const withChrome = { ...viewport, insets: { left: 264, bottom: 62 } };
  assert.deepEqual(plain(share.usableViewport(withChrome)), { left: 264, top: 0, width: 736, height: 638 });
  assert.deepEqual(
    plain(share.focusScrollForRect({ left: 3200, top: 3300, width: 400, height: 600 }, withChrome)),
    { left: 3200 + 200 - 368 - 264, top: 3300 - 24 }, // 高 600 + 2×24 > 638：纵向放不下，起点贴上沿
  );
});

test('usable viewport never collapses below 1px when chrome is wider than the window', () => {
  const share = loadShare();
  assert.deepEqual(plain(share.usableViewport({ width: 200, height: 100, insets: { left: 300, bottom: 200 } })), {
    left: 300, top: 0, width: 1, height: 1,
  });
});

test('fit zoom keeps 100% when the first section fits and shrinks it otherwise', () => {
  const share = loadShare();
  // 一个 section 三帧：3 × 438 + 2 × 28 + 48 = 1418 布局宽 → 视觉 709 @ 100%
  assert.equal(share.fitZoomForWidth(1418, 1200), 1);
  // 可用 600 − 48 inset = 552 → 552 / 709 = 0.78
  assert.equal(share.fitZoomForWidth(1418, 600), 0.78);
  // 再窄也停在 zoom 轴下限
  assert.equal(share.fitZoomForWidth(1418, 80), 0.5);
  // 窄屏竖排：一列 486 布局宽塞进 375，允许放大到 1.54
  assert.equal(share.fitZoomForWidth(486, 375, { inset: 0, maxZoom: 5 }), 1.54);
  assert.equal(share.fitZoomForWidth(0, 375), 1);
});
