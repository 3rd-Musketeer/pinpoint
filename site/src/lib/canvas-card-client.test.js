import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshBadges } from './canvas-card-client.js';
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
