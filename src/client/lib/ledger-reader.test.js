import test from 'node:test';
import assert from 'node:assert/strict';
import { readLedgerDocument, rememberLedgerDocument } from './ledger-reader.js';

test('两个打包入口按 origin/桶/账本共用首读；结果晚于 SSE 也保留新版', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url) => new Promise((resolve) => requests.push({ url, resolve })));
  const secondBundle = await import('./ledger-reader.js?second-bundle');
  const a = readLedgerDocument('http://one.test', 'p_a', '@canvas');
  const b = secondBundle.readLedgerDocument('http://one.test/', 'p_a', '@canvas');
  assert.equal(requests.length, 1);
  const newer = { revision: 2, annotations: [{ id: 'new' }] };
  rememberLedgerDocument('http://one.test', 'p_a', '@canvas', newer);
  requests[0].resolve({ ok: true, json: async () => ({ revision: 1, annotations: [] }) });
  assert.deepEqual(await a, newer);
  assert.deepEqual(await b, newer);
  assert.deepEqual(await secondBundle.readLedgerDocument('http://one.test', 'p_a', '@canvas'), newer);
  assert.equal(requests.length, 1);
  const others = [readLedgerDocument('http://two.test', 'p_a', '@canvas'), readLedgerDocument('http://one.test', 'p_b', '@canvas'), readLedgerDocument('http://one.test', 'p_a', '@prose')];
  assert.equal(requests.length, 4);
  for (const r of requests.slice(1)) r.resolve({ ok: true, json: async () => ({ revision: 0, annotations: [] }) });
  await Promise.all(others);
});

test('刷新不复用断线前的在途请求，失败后的首读能重试', async (t) => {
  const pending = [];
  t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => pending.push(resolve)));
  const first = readLedgerDocument('http://refresh.test', 'p_a', '@canvas');
  const refresh = readLedgerDocument('http://refresh.test', 'p_a', '@canvas', true);
  assert.equal(pending.length, 2);
  pending[1]({ ok: true, json: async () => ({ revision: 3, annotations: [{ id: 'latest' }] }) });
  await refresh;
  pending[0]({ ok: true, json: async () => ({ revision: 1, annotations: [] }) });
  assert.equal((await first).revision, 3);
  const failed = readLedgerDocument('http://refresh.test', 'failed', '@canvas');
  pending[2]({ ok: false, status: 503 });
  await assert.rejects(failed, /503/);
  const retry = readLedgerDocument('http://refresh.test', 'failed', '@canvas');
  pending[3]({ ok: true, json: async () => ({ revision: 0, annotations: [] }) });
  assert.equal((await retry).revision, 0);
});
