import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpsLedger } from './ops-ledger.js';

/** 假的 /save：按 baseRevision 判冲突，冲突时回盘上的版本（与 annotation-store save 同一条规则）。 */
function fakeServer(disk) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answer = (status, data) => ({ ok: status < 400, status, json: async () => data });
    if (body.baseRevision !== disk.revision) return answer(409, { error: 'revision_conflict', ...structuredClone(disk) });
    if (disk.reject) return answer(409, { error: 'illegal_transition', detail: 'close → check' });
    disk.revision += 1;
    disk.annotations = body.annotations;
    disk.path = body.path;
    return answer(200, structuredClone(disk));
  };
  return { calls, fetch };
}

async function settle(ledger) {
  for (let i = 0; i < 50 && !ledger.settled(); i += 1) await new Promise((r) => setTimeout(r, 1));
}

test('画布账本的状态操作：撞 409 时重放到盘上的新版，agent 刚写的回复和别的字段都留着，path 原样带回', async (t) => {
  const disk = { revision: 3, path: '/workbench/', annotations: [{ id: 'a', n: 4, screenId: 'done', status: 'check', images: [{ file: 'x.png' }], messages: [] }] };
  const server = fakeServer(disk);
  t.mock.method(globalThis, 'fetch', server.fetch);
  let changes = 0;
  const ledger = createOpsLedger({ server: '', entry: 'demo_flow', ledger: '@canvas', path: (d) => d, onChange: () => { changes += 1; } });
  ledger.accept(structuredClone(disk));
  // 水合之后、保存之前，agent 在盘上回了一句（revision 4）。
  disk.revision = 4;
  disk.annotations = [{ ...disk.annotations[0], messages: [{ who: 'agent', text: '改了', at: 't' }] }];
  ledger.enqueue({ op: 'status', id: 'a', status: 'close' });
  assert.equal(ledger.rows()[0].status, 'close'); // 先在界面上生效
  await settle(ledger);
  assert.equal(server.calls.length, 2);
  assert.equal(server.calls[0].baseRevision, 3);
  assert.equal(server.calls[1].baseRevision, 4);
  assert.equal(server.calls[1].page, '@canvas');
  assert.equal(server.calls[1].path, '/workbench/');
  assert.deepEqual(disk.annotations, [{ id: 'a', n: 4, screenId: 'done', status: 'close', images: [{ file: 'x.png' }], messages: [{ who: 'agent', text: '改了', at: 't' }] }]);
  assert.equal(disk.revision, 5);
  assert.equal(ledger.error(), '');
  assert.ok(changes > 0);
});

test('服务拒了操作：退回盘上的样子，报原因，调用方可以把字放回去', async (t) => {
  const disk = { revision: 1, annotations: [{ id: 'a', n: 1, status: 'close' }] };
  disk.reject = true;
  const server = fakeServer(disk);
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const res = await server.fetch(url, init);
    // 非法转换按 409 但不带 annotations 数组 = 不是 revision 冲突。
    return { ...res, json: async () => ({ error: 'illegal_transition', detail: 'close → check' }) };
  });
  let rejected = null;
  const ledger = createOpsLedger({ server: '', entry: 'e', ledger: '@prose', onRejected: (ops) => { rejected = ops; return true; } });
  ledger.accept(structuredClone(disk));
  ledger.enqueue({ op: 'status', id: 'a', status: 'check' });
  await settle(ledger);
  assert.deepEqual(rejected, [{ op: 'status', id: 'a', status: 'check' }]);
  assert.equal(ledger.rows()[0].status, 'close');
  assert.equal(ledger.error(), '保存被拒：close → check。原文已放回输入框');
});

test('SSE 推来的旧版本不用；保存在途时推来的新版本等应答回来再用', async (t) => {
  const disk = { revision: 2, annotations: [{ id: 'a', n: 1, status: 'open' }] };
  let release;
  const gate = new Promise((r) => { release = r; });
  const server = fakeServer(disk);
  t.mock.method(globalThis, 'fetch', async (url, init) => { const res = await server.fetch(url, init); await gate; return res; });
  const ledger = createOpsLedger({ server: '', entry: 'e', ledger: '@canvas' });
  ledger.accept(structuredClone(disk));
  ledger.remote({ revision: 1, annotations: [] });
  assert.equal(ledger.rows().length, 1);
  ledger.enqueue({ op: 'status', id: 'a', status: 'close' });
  ledger.remote({ revision: 9, annotations: [{ id: 'a', n: 1, status: 'close' }, { id: 'b', n: 2, status: 'open' }] });
  assert.equal(ledger.rows().length, 1); // 在途：先不换
  release();
  await settle(ledger);
  assert.deepEqual(ledger.rows().map((r) => r.id), ['a', 'b']);
});
