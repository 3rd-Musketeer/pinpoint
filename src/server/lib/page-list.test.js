import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPageList, formatPageRow, matchPages, scorePage, suggestPages } from './page-list.js';

const ENTRIES = [
  { id: 'routine-creator', title: 'Routine 创建', kind: 'dir', path: '/w/topics/gtd-agents/tasks/2026-09-17-routine-creation/prototype' },
  { id: 'areta-ost-ui', title: 'areta-ost 界面方向', kind: 'dir', path: '/w/repos/dev/areta-ost/tasks/ui/prototype' },
  { id: 'areta-ost-handbook', title: 'Areta OST Handbook', kind: 'dir', path: '/w/handbook/dist-pinpoint' },
  { id: 'goal-weekly', title: 'Goal 周报卡', kind: 'dir', path: '/w/goal/prototype' },
  { id: 'weekly-review', title: '周报 · 手改终版素材', kind: 'dir', path: '/w/wr/prototype' },
  { id: 'my-todos', title: 'my-todos', kind: 'dir', path: '/w/todos/app' },
  { id: 'todos-sheet', title: 'sheet', kind: 'file', path: '/w/todos/sheet.html' },
];

const ROWS = buildPageList({
  entries: ENTRIES,
  manifestPages: [{ id: 'example', title: '范例：冲一杯' }, { id: 'routine-creator', title: 'dup' }],
  hasBoard: (entry) => entry.id !== 'areta-ost-handbook' && entry.id !== 'my-todos',
  countsFor: (id) => (id === 'areta-ost-ui' ? { open: 0, check: 1, done: 0, close: 1 } : null),
});

test('buildPageList: registry pages + template pages, one row each', () => {
  assert.deepEqual(ROWS.map((r) => r.id), ['areta-ost-handbook', 'areta-ost-ui', 'example', 'goal-weekly', 'my-todos', 'routine-creator', 'todos-sheet', 'weekly-review']);
  const byId = Object.fromEntries(ROWS.map((r) => [r.id, r]));
  assert.equal(byId['areta-ost-handbook'].kind, 'doc'); // dir without board.json
  assert.equal(byId['areta-ost-ui'].kind, 'compiled');
  assert.equal(byId['my-todos'].kind, 'doc');
  assert.equal(byId['my-todos'].path, '/w/todos/app');
  assert.equal(byId['todos-sheet'].kind, 'file');
  assert.equal(byId.example.template, true);
  assert.equal(byId['routine-creator'].title, 'Routine 创建'); // registry wins over a same-id template
});

test('matchPages: plural, mixed-language, multi-word, no-query', () => {
  assert.deepEqual(matchPages(ROWS, 'routines').map((r) => r.id), ['routine-creator']);
  assert.deepEqual(matchPages(ROWS, 'areta 界面').map((r) => r.id), ['areta-ost-ui']);
  assert.deepEqual(matchPages(ROWS, 'handbook').map((r) => r.id), ['areta-ost-handbook']);
  assert.deepEqual(matchPages(ROWS, '周报').map((r) => r.id), ['goal-weekly', 'weekly-review']);
  assert.equal(matchPages(ROWS, '').length, ROWS.length);
  assert.deepEqual(matchPages(ROWS, 'routine nothing-like-this'), []);
});

test('scorePage: id beats title beats path; exact id is highest', () => {
  const row = ROWS.find((r) => r.id === 'goal-weekly');
  assert.ok(scorePage(row, 'goal-weekly') > scorePage(row, 'goal'));
  assert.ok(scorePage(row, 'goal') > scorePage(row, '周报'));
  assert.ok(scorePage(row, '周报') > scorePage(row, 'prototype'));
});

test('suggestPages: a made-up id still lands on the right page, path-only noise is dropped', () => {
  assert.deepEqual(suggestPages(ROWS, 'routines-prototype').map((r) => r.id), ['routine-creator']);
  assert.deepEqual(suggestPages(ROWS, 'weekly').map((r) => r.id), ['goal-weekly', 'weekly-review']);
  // only a path word: falls back to path hits rather than nothing
  assert.ok(suggestPages(ROWS, 'dist-pinpoint').some((r) => r.id === 'areta-ost-handbook'));
  assert.deepEqual(suggestPages(ROWS, 'zz'), []);
});

test('formatPageRow: counts only when something is open; scorePage also matches aliases', () => {
  const ui = formatPageRow(ROWS.find((r) => r.id === 'areta-ost-ui'));
  assert.match(ui[0], /^areta-ost-ui {2}· {2}areta-ost 界面方向 {2}· {2}编译页 {2}· {2}open 0 · check 1 · done 0$/);
  const hb = formatPageRow(ROWS.find((r) => r.id === 'areta-ost-handbook'));
  assert.doesNotMatch(hb[0], /open/);
  assert.match(formatPageRow(ROWS.find((r) => r.id === 'example'))[0], /编译页（模板）/);
  assert.deepEqual(formatPageRow(ROWS.find((r) => r.id === 'todos-sheet')), ['todos-sheet  ·  sheet  ·  单文件', '    /w/todos/sheet.html']);
  // aliases：project 行带上文章 id 与标题，口头说文章名也能对上 project。
  const project = { id: 'browser-use', title: 'Browser Use', path: '/w/bu', aliases: ['payment-confirm', '付款确认'] };
  assert.ok(scorePage(project, '付款确认') > 0);
  assert.equal(scorePage({ ...project, aliases: [] }, '付款确认'), 0);
});
