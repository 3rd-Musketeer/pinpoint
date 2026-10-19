import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshBadges, sheetText, waitForFrameBoot } from './canvas-card-client.js';
import { pageLedgerName } from './canvas-card.js';
import { readLedgerDocument, rememberLedgerDocument } from '../../../src/client/lib/ledger-reader.js';

test('整批读取等待邻接账本期间收到 SSE，绘制时按每本账本的最新版合并', async (t) => {
  for (const updated of ['@canvas', 'html']) {
    await t.test(updated, async (t) => {
      const entry = 'neighbor-' + updated;
      const url = '/sites/' + entry + '/long.html';
      const html = pageLedgerName(url);
      const requests = new Map();
      t.mock.method(globalThis, 'fetch', (url) => new Promise((resolve) => {
        requests.set(decodeURIComponent(new URL(url).pathname.split('/').pop()), resolve);
      }));
      const badge = { textContent: '', hidden: true };
      const card = {
        dataset: { page: entry, frames: 'phone-card long' },
        querySelector: () => badge,
        querySelectorAll: () => [{ dataset: { docUrl: url, screen: 'long' } }],
      };
      const pending = refreshBadges([card], true);
      const first = updated === '@canvas' ? '@canvas' : html;
      const delayed = updated === '@canvas' ? html : '@canvas';
      const answer = (name) => requests.get(name)({ ok: true, json: async () => ({ revision: 0, annotations: [] }) });
      answer(first);
      // 确认第一本已经解析，Promise.all 仍在等待邻接账本。
      await readLedgerDocument('', entry, first);
      rememberLedgerDocument('', entry, first, { revision: 2, annotations: [
        { id: 'new', status: 'open', ...(first === '@canvas' ? { screenId: 'phone-card' } : {}) },
      ] });
      answer(delayed);
      await pending; // 等实际的批次合并与绘制完成，再观察徽标。
      assert.equal(badge.textContent, '1 条标注');
      assert.equal(badge.hidden, false);
    });
  }
});

test('waitForFrameBoot：标记已在立刻放行；标记不来就到点放行，不一直等', async () => {
  const root = { dataset: {} };
  const observed = [];
  const observer = {
    observe(target, opts) { observed.push({ target, opts }); },
    disconnect() { observed.push('off'); },
  };
  const real = globalThis.MutationObserver;
  globalThis.MutationObserver = function (cb) { observer.cb = cb; return observer; };
  try {
    const done = { dataset: { frameBoot: 'done' } };
    assert.equal(await waitForFrameBoot(done, { setTimer() { throw new Error('已完成不该起定时器'); } }), undefined);
    assert.equal(await waitForFrameBoot(null), undefined);

    let fire;
    const pending = waitForFrameBoot(root, {
      timeout: 3000,
      setTimer(fn, ms) { assert.equal(ms, 3000); fire = fn; return 1; },
      clearTimer() { fire = null; },
    });
    assert.equal(observed[0].opts.attributeFilter[0], 'data-frame-boot');
    fire();
    await pending;
    assert.equal(observed.at(-1), 'off');

    // 等待期间标记到了：定时器清掉，不等到点。
    const arriving = { dataset: {} };
    let cleared = false;
    const again = waitForFrameBoot(arriving, {
      setTimer() { return 7; },
      clearTimer() { cleared = true; },
    });
    arriving.dataset.frameBoot = 'done';
    observer.cb();
    await again;
    assert.equal(cleared, true);
  } finally {
    globalThis.MutationObserver = real;
  }
});

// 有上限的等待：旧实现里循环 import 的两张表互等，Promise 永远不落定；超时就算挂，不无限等。
const settleWithin = (promise, ms = 2000) => Promise.race([
  promise,
  new Promise((_, reject) => { setTimeout(() => reject(new Error(`${ms}ms 内没有落定`)), ms).unref?.(); }),
]);

test('sheetText：循环 import 在限时内落定为 null（帧退回 iframe），之后的卡片再取同一张表也一样', async (t) => {
  const origin = 'http://cycle.test/sites/demo_page/';
  const texts = new Map([
    [`${origin}article.css`, '@import "./a.css";'],
    [`${origin}a.css`, '@import "./b.css"; [data-probe]{color:rgb(255,0,0)}'],
    [`${origin}b.css`, '@import "./a.css"; [data-probe]{font-weight:bold}'],
  ]);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(url);
    const key = url.replace(/[?&]direct$/, '');
    return { ok: texts.has(key), text: async () => texts.get(key) };
  });
  // 两张卡同时取（挂载队列并发 6）：入口表与它 import 的表都可能是别的卡正在展开的那张。
  const [first, second] = await settleWithin(Promise.all([sheetText(`${origin}article.css`), sheetText(`${origin}a.css`)]));
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(await settleWithin(sheetText(`${origin}b.css`)), null);
  // 原文按 URL 只取一次。
  assert.deepEqual(requests.sort(), [`${origin}a.css?direct`, `${origin}article.css?direct`, `${origin}b.css?direct`]);
});

test('sheetText：没有循环的 import 展开成内联文本，:root 搬到 :host', async (t) => {
  const origin = 'http://plain.test/sites/demo_page/';
  const texts = new Map([
    [`${origin}article.css`, '@import "./tokens.css"; .card{color:var(--c)}'],
    [`${origin}tokens.css`, ':root{--c:red}'],
  ]);
  t.mock.method(globalThis, 'fetch', async (url) => {
    const key = url.replace(/[?&]direct$/, '');
    return { ok: texts.has(key), text: async () => texts.get(key) };
  });
  assert.equal(await settleWithin(sheetText(`${origin}article.css`)), ':host{--c:red} .card{color:var(--c)}');
});
