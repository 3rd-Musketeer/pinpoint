import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyProseOps,
  authorLabel,
  canvasContentText,
  canvasRailItems,
  formatWhen,
  isProseClosed,
  isProseRow,
  isSendKey,
  newProseRow,
  railOrder,
  threadMessages,
} from './prose-thread.js';

const quote = { exact: '扣给谁', prefix: '会被扣、', suffix: '。' };

test('newProseRow：type prose、open、空线程，不带 n', () => {
  const row = newProseRow({ id: 'p1', content: '写全称', quote, section: 'why', path: '/demo/a/', at: '2026-10-13T00:00:00.000Z' });
  assert.deepEqual(row, {
    id: 'p1', type: 'prose', status: 'open', content: '写全称', quote, section: 'why', path: '/demo/a/',
    created_at: '2026-10-13T00:00:00.000Z', messages: [],
  });
  assert.equal(isProseRow(row), true);
  const hinted = newProseRow({ id: 'p2', content: '写全称', quote: { ...quote, start: 12, end: 15 }, at: 't' });
  assert.deepEqual(hinted.quote, { ...quote, start: 12 }, '带上位置提示 start，不带 end');
  assert.equal(isProseRow({ id: 'c1', type: 'element' }), false);
});

test('applyProseOps：create / reply / status 依次作用，不改原行；目标不在的操作跳过', () => {
  const base = [{ id: 'c1', type: 'element', content: '画布', status: 'open' }];
  const created = newProseRow({ id: 'p1', content: '写全称', quote, at: 't0' });
  const done = { ...created, n: 4, status: 'done', messages: [{ who: 'agent', text: '改了', at: 't1' }] };
  const ops = [
    { op: 'create', row: created },
    { op: 'reply', id: 'p1', text: '还差一点', at: 't2' },
    { op: 'status', id: 'ghost', status: 'close' },
  ];
  const out = applyProseOps(base, ops);
  assert.equal(out.length, 2);
  assert.equal(out[1].messages[0].text, '还差一点');
  assert.equal(base.length, 1);

  // 重放到磁盘上的新版本（agent 已回复、状态 done）：create 不重复，owner 回复接在 agent 后面并回 open。
  const replayed = applyProseOps([...base, done], ops);
  assert.equal(replayed.length, 2);
  assert.deepEqual(replayed[1].messages.map((m) => [m.who, m.text]), [['agent', '改了'], ['owner', '还差一点']]);
  assert.equal(replayed[1].status, 'open');
  assert.equal(replayed[1].n, 4);
  assert.equal(done.messages.length, 1, '原行不变');

  const closed = applyProseOps(replayed, [{ op: 'status', id: 'p1', status: 'close' }]);
  assert.equal(closed[1].status, 'close');
});

test('applyProseOps：重放同一条 reply（原文与 at 都相同）不追加第二遍；同文不同 at 照常追加', () => {
  const row = { id: 'a', type: 'prose', status: 'check', messages: [{ who: 'owner', text: '好', at: 't1' }] };
  const again = applyProseOps([row], [{ op: 'reply', id: 'a', text: '好', at: 't1' }]);
  assert.deepEqual(again[0].messages, [{ who: 'owner', text: '好', at: 't1' }]);
  assert.equal(again[0].status, 'check');
  const later = applyProseOps([row], [{ op: 'reply', id: 'a', text: '好', at: 't2' }]);
  assert.deepEqual(later[0].messages.map((m) => m.at), ['t1', 't2']);
  assert.equal(later[0].status, 'open');
});

test('threadMessages：第一句 = content，后接 messages；authorLabel', () => {
  const row = { content: '写全称', created_at: 't0', messages: [{ who: 'agent', text: '改了', at: 't1' }, null] };
  assert.deepEqual(threadMessages(row), [{ who: 'owner', text: '写全称', at: 't0' }, { who: 'agent', text: '改了', at: 't1' }]);
  assert.deepEqual(threadMessages(null), []);
  assert.deepEqual([authorLabel('owner'), authorLabel('agent')], ['你', 'agent']);
});

test('formatWhen：刚刚 / 分钟前 / 当天时分 / 月日时分；坏值为空', () => {
  const now = new Date(2026, 9, 13, 15, 30);
  assert.equal(formatWhen(new Date(2026, 9, 13, 15, 29, 40).toISOString(), now), '刚刚');
  assert.equal(formatWhen(new Date(2026, 9, 13, 15, 5).toISOString(), now), '25 分钟前');
  assert.equal(formatWhen(new Date(2026, 9, 13, 9, 7).toISOString(), now), '09:07');
  assert.equal(formatWhen(new Date(2026, 8, 2, 18, 0).toISOString(), now), '9月2日 18:00');
  assert.equal(formatWhen('', now), '');
  assert.equal(formatWhen('nope', now), '');
});

test('railOrder：按正文位置排，已关闭的留在原位；同位或失效按 #n，没发号的最后', () => {
  const pos = { a: 30, b: 10, c: Infinity, d: 5, e: 10, f: Infinity, g: Infinity };
  const rows = [
    { id: 'a', n: 1, status: 'open' },
    { id: 'b', n: 4, status: 'done' },
    { id: 'c', n: 2, status: 'check' },
    { id: 'd', n: 3, status: 'close' },
    { id: 'e', n: 2, status: 'open' },
    { id: 'f', status: 'open' },
    { id: 'g', n: 6, status: 'close' },
  ];
  const before = rows.slice();
  assert.deepEqual(railOrder(rows, (row) => pos[row.id]).map((r) => r.id), ['d', 'e', 'b', 'a', 'c', 'g', 'f']);
  assert.deepEqual(rows, before);
  assert.deepEqual(railOrder(null), []);
});

test('isProseClosed：只有 close 算关闭，done / check / 没写状态都不算', () => {
  assert.equal(isProseClosed({ status: 'close' }), true);
  for (const status of ['open', 'check', 'done', undefined]) assert.equal(isProseClosed({ status }), false);
  assert.equal(isProseClosed(null), false);
});

test('isSendKey：Enter 发送；Shift+Enter、组字中（isComposing / keyCode 229）、别的键不发送', () => {
  assert.equal(isSendKey({ key: 'Enter' }), true);
  assert.equal(isSendKey({ key: 'Enter', metaKey: true }), true);
  assert.equal(isSendKey({ key: 'Enter', shiftKey: true }), false);
  assert.equal(isSendKey({ key: 'Enter', isComposing: true }), false);
  assert.equal(isSendKey({ key: 'Enter', keyCode: 229 }), false);
  assert.equal(isSendKey({ key: 'a' }), false);
  assert.equal(isSendKey(null), false);
});

test('canvasRailItems：画布标注按帧归到本篇的卡片；别的页、不在卡片上的、正文评论不进', () => {
  const cards = [
    { section: 'confirm', page: 'demo_flow', frames: [{ id: 'sheet', title: '确认单' }, { id: 'done' }] },
    { section: 'mixed', page: 'demo_flow', frames: [{ id: 'bare', title: 'bare' }] },
  ];
  const rows = [
    { id: 'a', n: 4, screenId: 'done', section: 'confirm', pageId: 'demo_flow', status: 'check' },
    { id: 'b', n: 5, screenId: 'bare' }, // 没有 pageId = 这个桶
    { id: 'c', n: 6, screenId: 'gone', pageId: 'demo_flow' },
    { id: 'd', n: 7, screenId: 'sheet', pageId: 'other_page' },
    { id: 'e', n: 8, type: 'prose', screenId: 'sheet' },
    null,
  ];
  assert.deepEqual(canvasRailItems(rows, cards).map((x) => [x.row.id, x.section, x.frameId, x.frameTitle, x.card]), [
    ['a', 'confirm', 'done', 'done', 0],
    ['b', 'mixed', 'bare', 'bare', 1],
  ]);
  assert.deepEqual(canvasRailItems(rows, []), []);
  assert.deepEqual(canvasRailItems(null, cards), []);
});

test('railOrder：画布标注按卡片位置与正文评论合成一列', () => {
  const prose = [{ id: 'p1', n: 1, at: 10 }, { id: 'p2', n: 2, at: 80 }, { id: 'p3', n: 3, at: Infinity }];
  const canvas = [{ id: 'c9', n: 9, at: 49.5 }, { id: 'c4', n: 4, at: 49.5 }];
  assert.deepEqual(railOrder([...prose, ...canvas], (r) => r.at).map((r) => r.id), ['p1', 'c4', 'c9', 'p2', 'p3']);
});

test('canvasContentText：目标记号换成元素文字，找不到的去掉', () => {
  const row = { content: '把 [@t:i1] 改成主按钮，[@t:i2] 删掉 [@t:i3]', targets: [{ ref: 'i1', text: '确认支付' }, { ref: 'i2', text: '一段很长很长很长很长很长很长很长很长很长很长的说明文字' }] };
  assert.equal(canvasContentText(row), '把 “确认支付” 改成主按钮，“一段很长很长很长很长很长很长很长很长很长很长的…” 删掉');
  assert.equal(canvasContentText({ content: '整页太挤' }), '整页太挤');
  assert.equal(canvasContentText(null), '');
});
