import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatRelativeTime,
  PAGE_SORTS,
  pageTime,
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

test('normalizePageSort 保留旧偏好并接受双向排序，拦非法值', () => {
  for (const sort of PAGE_SORTS) assert.equal(normalizePageSort(sort), sort);
  assert.equal(normalizePageSort('updated'), 'updated');
  assert.equal(normalizePageSort('bogus'), 'default');
  assert.equal(normalizePageSort(undefined), 'default');
});

test('formatRelativeTime 档位', () => {
  // 本地时间构造，避免跨日界；2026-08-17 是周一
  const now = new Date(2026, 7, 17, 12, 0, 0).getTime();
  assert.equal(formatRelativeTime(now - 20 * 1000, now), '刚刚');
  assert.equal(formatRelativeTime(now - 5 * 60000, now), '5 分钟前');
  assert.equal(formatRelativeTime(now - 3 * 3600000, now), '3 小时前');
  assert.equal(formatRelativeTime(new Date(2026, 7, 16, 9, 0, 0).getTime(), now), '昨天');
  assert.equal(formatRelativeTime(new Date(2026, 7, 14, 12, 0, 0).getTime(), now), '周五');
  assert.equal(formatRelativeTime(new Date(2026, 7, 10, 12, 0, 0).getTime(), now), '8-10');
  assert.equal(formatRelativeTime(new Date(2025, 11, 25, 12, 0, 0).getTime(), now), '2025-12-25');
  // 未来时间（时钟漂移）按「刚刚」处理，不出负数
  assert.equal(formatRelativeTime(now + 60000, now), '刚刚');
});


test('时间正反序都把未知值放末尾，行内时间保持所选依据', () => {
  for (const [sort, key] of [['added', 'addedAt'], ['updated', 'mtime'], ['annotated', 'annotatedAt']]) {
    const pages = [{ id: 'unknown' }, { id: 'new', [key]: 300 }, { id: 'old', [key]: 100 }];
    assert.deepEqual(sortPages(pages, sort).map(p => p.id), ['new', 'old', 'unknown']);
    assert.deepEqual(sortPages(pages, sort + '-asc').map(p => p.id), ['old', 'new', 'unknown']);
    assert.equal(pageTime({ addedAt: 1, mtime: 2, annotatedAt: 3 }, sort + '-asc'), { addedAt: 1, mtime: 2, annotatedAt: 3 }[key]);
  }
  assert.deepEqual(sortPages([{ id: 'A' }, { id: 'Z' }], 'name-desc').map(p => p.id), ['Z', 'A']);
});
