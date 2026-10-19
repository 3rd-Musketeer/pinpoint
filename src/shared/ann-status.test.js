import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANN_STATUS_COLORS,
  ANN_FILTERS,
  annStatusLabel,
  annStatusOf,
  filterIncludesStatus,
  annFilterCounts,
  annFilterRows,
  isClosed,
  readAnnFilter,
  writeAnnFilter,
} from './ann-status.js';
import { ANN_TOKENS_DARK, ANN_UI_LIGHT } from './ann-tokens.js';

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

test('status colors are value-identical at every CSS site (one token source)', () => {
  // 源 = scripts/tokens/source.mjs → ann-tokens.js（本模块的值）；定义端：client [data-ann-ui] 基规则
  //（annotate-css.js 拼进 ANN_UI_LIGHT）、workbench wb-tokens.css；ann-list.css 只消费，兜底同值。
  const client = fs.readFileSync(path.join(SRC, 'client', 'annotate-css.js'), 'utf8');
  assert.match(client, /'\[data-ann-ui\]\{font-family:[^\n]*' \+ ANN_UI_LIGHT \+ '\}'/, '[data-ann-ui] 基规则拼进 ANN_UI_LIGHT');
  const base = ANN_UI_LIGHT;
  const tokens = fs.readFileSync(path.join(SRC, 'workbench', 'wb-tokens.css'), 'utf8');
  const listCss = fs.readFileSync(path.join(SRC, 'shared', 'ann-list.css'), 'utf8');
  for (const [status, hex] of Object.entries(ANN_STATUS_COLORS)) {
    const name = '--ann-st-' + status;
    assert.ok(base.includes(name + ':' + hex + ';'), `[data-ann-ui] pins ${name}:${hex}`);
    assert.match(tokens, new RegExp('^  ' + name + ':' + hex + ';', 'm'), `wb-tokens.css defines ${name}:${hex}`);
    assert.match(listCss, new RegExp('var\\(' + name + ',\\s*' + hex + '\\)'), `ann-list.css consumes ${name} with the same fallback`);
  }
  // 画布钉子的三态只许换 --ann-st 一跳（点亮环跟着同色 mix），数字色跟着换。
  for (const status of ['check', 'done', 'close']) {
    assert.match(client, new RegExp('\\.ann-badge--' + status + '\\{--ann-st:var\\(--ann-st-' + status + ',[^)]+\\);--ann-st-ink:var\\(--ann-st-' + status + '-fg'));
  }
});

test('white-on-status contrast ratios (WCAG AA large-text bar = 3:1)', () => {
  // 亮色四态都是白字小圆，都要过 3:1。2026-10-15 候选 2 的值：
  // open #1f5f8f 6.79 · check #b85a14 4.66 · done #7a4fd0 5.45 · close #8d8d8d 3.32。
  for (const status of ['open', 'check', 'done', 'close']) {
    assert.ok(whiteContrast(ANN_STATUS_COLORS[status]) >= 3, status + ' ≥ 3:1');
  }
});

test('annStatusOf / isClosed：没写 status 的行算 open，close 才算已关闭', () => {
  assert.equal(annStatusOf({}), 'open');
  assert.equal(annStatusOf({ status: 'check' }), 'check');
  assert.equal(annStatusOf(null), 'open');
  assert.equal(annStatusOf({ status: '' }), 'open');
  assert.equal(isClosed({ status: 'close' }), true);
  assert.equal(isClosed({ status: 'done' }), false);
  assert.equal(isClosed({}), false);
  assert.equal(isClosed(null), false);
});

/* ---- 状态筛选（annFilterCounts / annFilterRows / LS 读写）---- */

const ROWS = [
  { n: 1, status: 'open' },
  { n: 2, status: 'check' },
  { n: 3, status: 'done' },
  { n: 4, status: 'close' },
  { n: 5, status: 'open' },
  { n: 6, status: 'close' },
];

test('two filters: pending = open / check / done, closed = close', () => {
  assert.deepEqual(ANN_FILTERS, ['pending', 'closed']);
  assert.equal(annStatusLabel('pending'), 'pending');
  assert.equal(annStatusLabel('closed'), 'closed');
  assert.equal(annStatusLabel('nope'), 'pending');
  for (const st of ['open', 'check', 'done', undefined]) {
    assert.equal(filterIncludesStatus('pending', st), true, `pending includes ${st}`);
    assert.equal(filterIncludesStatus('closed', st), false);
  }
  assert.equal(filterIncludesStatus('closed', 'close'), true);
  assert.equal(filterIncludesStatus('pending', 'close'), false);
  assert.equal(filterIncludesStatus('bogus', 'close'), false, 'unknown key reads as pending');
});

test('annFilterCounts: pending = not close, closed = close', () => {
  assert.deepEqual(annFilterCounts(ROWS), { pending: 4, closed: 2 });
  assert.deepEqual(annFilterCounts([]), { pending: 0, closed: 0 });
  assert.deepEqual(annFilterCounts(undefined), { pending: 0, closed: 0 });
  // 缺 status 的行按 open 计（与 annRowModel 默认一致）。
  assert.deepEqual(annFilterCounts([{ n: 9 }]), { pending: 1, closed: 0 });
});

test('annFilterRows: keeps original order within each filter', () => {
  assert.deepEqual(annFilterRows(ROWS, 'pending').map((r) => r.n), [1, 2, 3, 5]);
  assert.deepEqual(annFilterRows(ROWS, 'closed').map((r) => r.n), [4, 6]);
  // 未知筛选键按 pending（防脏 LS 值）。
  assert.deepEqual(annFilterRows(ROWS, 'bogus').map((r) => r.n), [1, 2, 3, 5]);
  // 不改传入数组。
  assert.equal(ROWS[3].status, 'close');
  assert.equal(ROWS.length, 6);
});

test('annFilter storage helpers: roundtrip, legacy values, throwing storage', () => {
  const backing = new Map();
  const storage = { getItem: (k) => (backing.has(k) ? backing.get(k) : null), setItem: (k, v) => backing.set(k, v), removeItem: (k) => backing.delete(k) };
  assert.equal(readAnnFilter(storage, 'k'), 'pending', 'missing → pending');
  writeAnnFilter(storage, 'k', 'closed');
  assert.equal(readAnnFilter(storage, 'k'), 'closed');
  for (const legacy of ['all', 'open', 'check', 'done', 'bogus']) {
    backing.set('k', legacy);
    assert.equal(readAnnFilter(storage, 'k'), 'pending', `09-23 value ${legacy} → pending`);
  }
  writeAnnFilter(storage, 'k', 'nope');
  assert.equal(backing.has('k'), false, 'bad write clears the slot');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readAnnFilter(throwing, 'k'), 'pending', 'throwing read → pending');
  assert.doesNotThrow(() => writeAnnFilter(throwing, 'k', 'closed'), 'throwing write is swallowed');
});

test('dark status pins: number color on status color ≥ 4.5:1', () => {
  // 暗色四态换成提亮的底色，数字色跟着换（--ann-st-*-fg）：小字要过 4.5:1。
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const status of ['open', 'check', 'done', 'close']) {
    const bg = ANN_TOKENS_DARK['--ann-st-' + status];
    const fg = ANN_TOKENS_DARK['--ann-st-' + status + '-fg'];
    assert.ok(contrast(bg, fg) >= 4.5, `${status} dark ${fg} on ${bg}`);
  }
});
