import assert from 'node:assert/strict';
import test from 'node:test';

import { KEEPALIVE_MAX_BYTES, byteLength, postSave, saveInit } from './save-request.js';

const okResponse = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

test('saveInit: keepalive for small bodies, plain fetch above the budget (bytes, not chars)', () => {
  assert.equal(saveInit('{"a":1}').keepalive, true);
  const big = JSON.stringify({ s: 'x'.repeat(KEEPALIVE_MAX_BYTES) });
  assert.equal(saveInit(big).keepalive, undefined);
  // 汉字一个 3 字节：字符数没超、字节数超了也不带 keepalive。
  const cjk = '评'.repeat(Math.ceil(KEEPALIVE_MAX_BYTES / 3) + 1);
  assert.ok(cjk.length < KEEPALIVE_MAX_BYTES);
  assert.ok(byteLength(cjk) > KEEPALIVE_MAX_BYTES);
  assert.equal(saveInit(cjk).keepalive, undefined);
});

test('postSave: sends keepalive, returns { ok, status, data }', async () => {
  const calls = [];
  const res = await postSave('http://s', { a: 1 }, async (url, init) => { calls.push([url, init]); return okResponse({ revision: 2 }); });
  assert.deepEqual(res, { ok: true, status: 200, data: { revision: 2 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'http://s/save');
  assert.equal(calls[0][1].keepalive, true);
  assert.equal(calls[0][1].body, '{"a":1}');
});

test('postSave: a refused keepalive request is retried once without keepalive; 409 passes through', async () => {
  const calls = [];
  const res = await postSave('http://s', { a: 1 }, async (url, init) => {
    calls.push(init.keepalive === true);
    if (init.keepalive) throw new TypeError('keepalive quota');
    return okResponse({ revision: 5 }, 409);
  });
  assert.deepEqual(calls, [true, false]);
  assert.deepEqual(res, { ok: false, status: 409, data: { revision: 5 } });
});

test('postSave: a plain request that fails is not retried', async () => {
  let n = 0;
  const big = { s: 'x'.repeat(KEEPALIVE_MAX_BYTES) };
  await assert.rejects(postSave('http://s', big, async () => { n += 1; throw new TypeError('offline'); }), /offline/);
  assert.equal(n, 1);
});
