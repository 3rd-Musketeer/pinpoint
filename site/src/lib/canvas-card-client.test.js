import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshBadges, waitForFrameBoot } from './canvas-card-client.js';
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
