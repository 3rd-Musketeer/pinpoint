import test from 'node:test';
import assert from 'node:assert/strict';
import { pageKeyFromPathname } from '../shared/annotate-page-key.js';

test('HTML 卡片收到 SSE 后，迟到的旧 GET 和重装板都不能清空新版计数', async (t) => {
  const events = new EventTarget();
  globalThis.window = events;
  globalThis.document = { baseURI: 'http://example.test/' };
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  const pending = [];
  t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => pending.push(resolve)));
  const { syncHtmlCardCounts } = await import('./html-cards.js');
  const src = '/sites/p_a/page.html';
  const key = pageKeyFromPathname(src);
  const card = { setAttribute(name, value) { this[name] = value; }, querySelector(sel) {
    return sel === 'iframe.wb-html-card-frame' ? { getAttribute: () => src } : node;
  } };
  const node = { textContent: '', closest: () => card, toggleAttribute() {} };
  const panel = { querySelectorAll: () => [card] };
  syncHtmlCardCounts(panel, 'p_a');
  const event = new Event('wb:annotations');
  event.detail = { entry: 'p_a', page: key, revision: 2, annotations: [{ id: 'a' }] };
  events.dispatchEvent(event);
  assert.equal(node.textContent, '1 条标注');
  pending.shift()({ ok: true, json: async () => ({ revision: 1, annotations: [] }) });
  await new Promise((r) => setImmediate(r));
  assert.equal(node.textContent, '1 条标注');
  syncHtmlCardCounts(panel, 'p_a');
  assert.equal(node.textContent, '1 条标注');
  pending.shift()({ ok: true, json: async () => ({ revision: 0, annotations: [] }) });
  await new Promise((r) => setImmediate(r));
  assert.equal(card['data-ann-count'], '1');
  event.detail = { ...event.detail, revision: 3, annotations: [] };
  events.dispatchEvent(event);
  assert.equal(node.textContent, '');
});
