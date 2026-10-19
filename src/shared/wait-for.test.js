import test from 'node:test';
import assert from 'node:assert/strict';

import { waitFor } from './wait-for.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('waitFor: 就绪即 resolve(true)，不再轮询', async () => {
  let polls = 0;
  const ok = await waitFor({
    test: () => (++polls >= 3),
    interval: 5,
    deadline: 1000,
  });
  assert.equal(ok, true);
  assert.equal(polls, 3);
});

test('waitFor: 超时 reject，错误带等待目标与时长', async () => {
  await assert.rejects(
    waitFor({ test: () => false, interval: 5, deadline: 40, what: '工作台就绪' }),
    (err) => {
      assert.match(err.message, /工作台就绪/);
      assert.match(err.message, /超时/);
      assert.match(err.message, /等了 \d+ms/);
      return true;
    },
  );
});

test('waitFor: signal 中止 reject 原因；已中止的 signal 立即 reject', async () => {
  const controller = new AbortController();
  const pending = waitFor({ test: () => false, interval: 5, deadline: 10_000, signal: controller.signal, what: '卡片客户端' });
  await tick(10);
  controller.abort();
  await assert.rejects(pending, (err) => /已取消|AbortError/.test(err.name + err.message));

  const dead = new AbortController();
  dead.abort();
  await assert.rejects(
    waitFor({ test: () => true, signal: dead.signal }),
    (err) => err instanceof Error,
  );
});

test('waitFor: 中止优先于超时，且停止轮询；test 抛错按未就绪处理', async () => {
  let polls = 0;
  const controller = new AbortController();
  const pending = waitFor({
    test: () => { polls += 1; return false; },
    interval: 5,
    deadline: 10_000,
    signal: controller.signal,
  });
  await tick(12);
  controller.abort();
  await assert.rejects(pending);
  const at = polls;
  await tick(30);
  assert.equal(polls, at, '中止后不再轮询');

  await assert.rejects(
    waitFor({ test: () => { throw new Error('boom'); }, interval: 5, deadline: 30 }),
    (err) => /超时/.test(err.message),
  );
});
