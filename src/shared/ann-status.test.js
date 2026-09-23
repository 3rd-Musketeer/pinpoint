import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANN_STATUS_COLORS, annStatusVar } from './ann-status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const ROOT = path.resolve(SRC, '..');

/** WCAG 2.x 相对亮度 + 白字对比度（与 owner 要的「AA 大字 3:1」同一把尺）。 */
function srgbLin(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  return 0.2126 * srgbLin(parseInt(hex.slice(1, 3), 16))
    + 0.7152 * srgbLin(parseInt(hex.slice(3, 5), 16))
    + 0.0722 * srgbLin(parseInt(hex.slice(5, 7), 16));
}
function whiteContrast(hex) {
  return 1.05 / (luminance(hex) + 0.05);
}

test('status → color variable mapping (unknown falls back to open)', () => {
  assert.equal(annStatusVar('open'), '--ann-st-open');
  assert.equal(annStatusVar('check'), '--ann-st-check');
  assert.equal(annStatusVar('done'), '--ann-st-done');
  assert.equal(annStatusVar('close'), '--ann-st-close');
  assert.equal(annStatusVar(undefined), '--ann-st-open');
  assert.equal(annStatusVar('bogus'), '--ann-st-open');
});

test('status colors are value-identical at all three CSS definition sites', () => {
  // SSOT = 本模块；两个定义端：client [data-ann-ui] 基规则（annotate.js）、
  // workbench #wbann-pop（index.html）。ann-list.css 只消费不定义。
  const annotate = fs.readFileSync(path.join(SRC, 'client', 'annotate.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const listCss = fs.readFileSync(path.join(SRC, 'shared', 'ann-list.css'), 'utf8');
  for (const [status, hex] of Object.entries(ANN_STATUS_COLORS)) {
    const name = '--ann-st-' + status;
    const clientMatches = annotate.match(new RegExp(name + ':(' + hex + ')'));
    assert.ok(clientMatches, `annotate.js [data-ann-ui] pins ${name}:${hex}`);
    const wbMatches = indexHtml.match(new RegExp(name + ':(' + hex + ')'));
    assert.ok(wbMatches, `index.html #wbann-pop pins ${name}:${hex}`);
    assert.match(listCss, new RegExp('var\\(' + name + ',\\s*' + hex + '\\)'), `ann-list.css consumes ${name} with the same fallback`);
  }
  // 画布钉子的三态只许换 --ann-st 一跳（点亮环跟着同色 mix）。
  for (const status of ['check', 'done', 'close']) {
    assert.match(annotate, new RegExp('\\.ann-badge--' + status + '\\{--ann-st:var\\(--ann-st-' + status));
  }
});

test('white-on-status contrast ratios (WCAG AA large-text bar = 3:1)', () => {
  // 算出来的值（2026-09-23）：open 4.17 · done 3.39 过线；check 2.94、
  // close 2.55 在线下一侧 —— check 是 owner 指定的琥珀（等 owner 看），
  // close 是有意的弱化。这里钉住当前值，改色 = 有意识更新这段。
  assert.ok(whiteContrast(ANN_STATUS_COLORS.open) >= 3, 'open ≥ 3:1');
  assert.ok(whiteContrast(ANN_STATUS_COLORS.done) >= 3, 'done ≥ 3:1');
  const check = whiteContrast(ANN_STATUS_COLORS.check);
  assert.ok(check > 2.8 && check < 3, 'check sits just under 3:1 (owner-picked amber)');
  const closed = whiteContrast(ANN_STATUS_COLORS.close);
  assert.ok(closed > 2.4 && closed < 2.7, 'close sits well under 3:1 (deliberate de-emphasis)');
});
