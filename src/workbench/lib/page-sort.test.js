import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatRelativeTime,
  nextPageSort,
  normalizePageSort,
  sortPages
} from './page-sort.js';

test('sortPages default 保持原顺序且不改原数组', () => {
  const pages = [{ id: 'b' }, { id: 'a' }];
  const out = sortPages(pages, 'default');
  assert.deepEqual(out.map((p) => p.id), ['b', 'a']);
  assert.deepEqual(pages.map((p) => p.id), ['b', 'a'], '原数组不被改写');
});

test('sortPages updated = mtime 倒序，无 mtime 按原相对顺序沉底', () => {
  const pages = [
    { id: 'no-time-1', mtime: null },
    { id: 'old', mtime: 100 },
    { id: 'no-time-2' },
    { id: 'new', mtime: 300 },
    { id: 'mid', mtime: 200 },
  ];
  assert.deepEqual(
    sortPages(pages, 'updated').map((p) => p.id),
    ['new', 'mid', 'old', 'no-time-1', 'no-time-2'],
  );
});

test('sortPages name = 标题 locale 排序（zh 排序规则：CJK 在前，数字先于字母）', () => {
  const pages = [
    { id: '1', title: 'Example HTML' },
    { id: '2', title: 'E2E Site' },
    { id: '3', title: 'E2E Dir' },
    { id: '4', title: '周报' },
  ];
  assert.deepEqual(
    sortPages(pages, 'name').map((p) => p.title),
    ['周报', 'E2E Dir', 'E2E Site', 'Example HTML'],
  );
});

test('nextPageSort 循环三档；normalizePageSort 拦非法值', () => {
  assert.equal(nextPageSort('default'), 'updated');
  assert.equal(nextPageSort('updated'), 'name');
  assert.equal(nextPageSort('name'), 'default');
  assert.equal(normalizePageSort('updated'), 'updated');
  assert.equal(normalizePageSort('bogus'), 'default');
  assert.equal(normalizePageSort(undefined), 'default');
});

test('formatRelativeTime 档位', () => {
  const now = Date.parse('2026-08-17T12:00:00Z');
  assert.equal(formatRelativeTime(now - 20 * 1000, now), '刚刚');
  assert.equal(formatRelativeTime(now - 5 * 60000, now), '5m');
  assert.equal(formatRelativeTime(now - 3 * 3600000, now), '3h');
  assert.equal(formatRelativeTime(now - 2 * 86400000, now), '2d');
  // 同年超 7 天 → MM-DD（本地时区渲染，用本地时间构造避免跨日界）
  const local = new Date(2026, 7, 17, 12, 0, 0);
  assert.equal(formatRelativeTime(new Date(2026, 7, 10, 12, 0, 0).getTime(), local.getTime()), '08-10');
  assert.equal(formatRelativeTime(new Date(2025, 11, 25, 12, 0, 0).getTime(), local.getTime()), '2025-12-25');
  // 未来时间（时钟漂移）按「刚刚」处理，不出负数
  assert.equal(formatRelativeTime(now + 60000, now), '刚刚');
});
