import assert from 'node:assert/strict';
import test from 'node:test';

import { applyProseOps, authorLabel, formatWhen, isProseRow, newProseRow, threadMessages } from './prose-thread.js';

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
