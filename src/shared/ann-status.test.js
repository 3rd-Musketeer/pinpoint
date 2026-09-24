import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANN_STATUS_COLORS,
  ANN_FILTERS,
  annStatusVar,
  annStatusLabel,
  filterIncludesStatus,
  annFilterCounts,
  annFilterRows,
  readAnnFilter,
  writeAnnFilter,
} from './ann-status.js';

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
  // 2026-09-23：四色白字都要过 3:1（钉子与序号圆是白字小圆）。算出来的值：
  // open 4.17 · check 3.54 · done 3.39 · close 3.32。首版 check #c98a1b 2.94、
  // close #9aa3ae 2.55 没过线，已各压暗一档。
  for (const status of ['open', 'check', 'done', 'close']) {
    assert.ok(whiteContrast(ANN_STATUS_COLORS[status]) >= 3, status + ' ≥ 3:1');
  }
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
