import test from 'node:test';
import assert from 'node:assert/strict';

import { placeWikiPanel } from './wiki-panel.js';

const anchor = { left: 1040, right: 1160, top: 10, bottom: 42, width: 120 };

test('wiki 面板：桌面锚在按钮右下角，间距 8、宽 320', () => {
  const p = placeWikiPanel({ anchor, panelW: 320, panelH: 200, viewportW: 1440, viewportH: 900, maxH: 480 });
  assert.equal(p.left, anchor.right - 320);
  assert.equal(p.top, anchor.bottom + 8);
  assert.equal(p.width, 320);
  assert.equal(p.maxHeight, 480);
});

test('wiki 面板：高度上限取 min(60dvh, 480)，矮屏用 60dvh', () => {
  const tall = placeWikiPanel({ anchor, panelW: 320, panelH: 900, viewportW: 1440, viewportH: 900, maxH: 480 });
  assert.equal(tall.maxHeight, 480);
  const short = placeWikiPanel({ anchor, panelW: 320, panelH: 900, viewportW: 1440, viewportH: 700, maxH: 420 });
  assert.equal(short.maxHeight, 420);
});

test('wiki 面板：贴着视口右缘时往左收，右边至少留 12', () => {
  const edge = { left: 1380, right: 1432, top: 10, bottom: 42, width: 52 };
  const p = placeWikiPanel({ anchor: edge, panelW: 320, panelH: 200, viewportW: 1440, viewportH: 900, maxH: 480 });
  assert.equal(p.left, 1440 - 12 - 320);
  assert.ok(p.left + p.width <= 1440 - 12);
});

test('wiki 面板：窄屏比按钮宽时贴左缘 12，不从按钮右下角向左长出去', () => {
  const narrow = { left: 250, right: 366, top: 8, bottom: 40, width: 116 };
  const p = placeWikiPanel({ anchor: narrow, panelW: 366, panelH: 300, viewportW: 390, viewportH: 844, maxH: 480 });
  assert.equal(p.left, 12);
  assert.equal(p.top, narrow.bottom + 8);
  assert.ok(p.left + p.width <= 390 - 12);
});

test('wiki 面板：minTop 把面板压到顶栏下沿之下', () => {
  const wrapped = { left: 12, right: 140, top: 8, bottom: 36, width: 128 };
  const p = placeWikiPanel({ anchor: wrapped, panelW: 366, panelH: 300, viewportW: 390, viewportH: 844, maxH: 480, minTop: 90 });
  assert.equal(p.top, 90);
  assert.equal(p.left, 12);
});

test('wiki 面板：下面放不下就翻到按钮上方，仍留 12', () => {
  const low = { left: 1040, right: 1160, top: 820, bottom: 860, width: 120 };
  const p = placeWikiPanel({ anchor: low, panelW: 320, panelH: 200, viewportW: 1440, viewportH: 900, maxH: 480 });
  assert.equal(p.top, low.top - 8 - 200);
  assert.ok(p.top >= 12);
});
