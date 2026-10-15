import test from 'node:test';
import assert from 'node:assert/strict';
import { pageKeyFromPathname } from '../shared/annotate-page-key.js';

test('工作台逐本计数：邻接 HTML 账本迟到，不重画另一账本的 SSE 新版', async (t) => {
  const events = new EventTarget();
  globalThis.window = events;
  globalThis.document = { baseURI: 'http://example.test/' };
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  const requests = [];
  t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => requests.push(resolve)));
  const { syncHtmlCardCounts } = await import('./html-cards.js?neighbor');
  const nodes = [{ textContent: '' }, { textContent: '' }];
  const urls = ['/sites/p_neighbor/early.html', '/sites/p_neighbor/late.html'];
  const cards = urls.map((url, i) => {
    const card = { setAttribute() {}, querySelector: (sel) => sel === 'iframe.wb-html-card-frame' ? { getAttribute: () => url } : nodes[i] };
    Object.assign(nodes[i], { closest: () => card, toggleAttribute() {} });
    return card;
  });
  syncHtmlCardCounts({ querySelectorAll: () => cards }, 'p_neighbor');
  requests[0]({ ok: true, json: async () => ({ revision: 0, annotations: [] }) });
  await new Promise((resolve) => setImmediate(resolve));
  const event = new Event('wb:annotations');
  event.detail = { entry: 'p_neighbor', page: pageKeyFromPathname(urls[0]), revision: 2, annotations: [{ id: 'new' }] };
  events.dispatchEvent(event);
  assert.equal(nodes[0].textContent, '1 条标注');
  requests[1]({ ok: true, json: async () => ({ revision: 0, annotations: [] }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(nodes.map((node) => node.textContent), ['1 条标注', '']);
});

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
