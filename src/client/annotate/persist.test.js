// 走真实 requestSync / postSave / rebase，只隔离需要 DOM 的兄弟模块。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const STUBS = {
  './bubbles.js': 'export function renderLedgerChange() {}',
  './create.js': 'export function nextN() { return 1; }',
  './ui.js': 'export function notify() {} export function setStatus() {}',
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/annotate/persist.js') && STUBS[specifier]) {
      return { url: 'stub:persist/' + specifier, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:persist/')) {
      return { format: 'module', source: STUBS[url.slice('stub:persist/'.length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { bind_persist, requestSync, persist, setBase, deferRemoteDoc } = await import('./persist.js');
const { bind_marks } = await import('./marks.js');
hooks.deregister();

const copy = value => JSON.parse(JSON.stringify(value));
const row = (id = 'a', extra = {}) => ({ id, n: 1, content: '新正文', status: 'check', ...extra });

function setup(t, marks = [row()]) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cache = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: key => cache.get(key) ?? null,
    setItem: (key, value) => cache.set(key, value),
    removeItem: key => cache.delete(key),
  };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url, init) => new Promise(resolve => {
    requests.push({
      url, body: JSON.parse(init.body),
      respond(data, status = 200) {
        resolve({ ok: status === 200, status, json: async () => copy(data) });
      },
    });
  }));
  const ctx = {
    SERVER: 'http://ann', PAGE: 'page-a', ENTRY: 'notes', LEDGER_PATHNAME: '/page-a', LS_KEY: 'marks',
    marks: copy(marks), baseMarks: [], revision: 1, syncEpoch: 1,
    mutationVersion: 1, syncedMutationVersion: 0, syncing: false, syncError: false,
    deferredRemoteDoc: null,
  };
  bind_persist(ctx);
  bind_marks(ctx);
  setBase(marks.map(m => ({ ...m, content: '旧正文' })));
  async function reply(index, data, status) {
    const pending = ctx.inflightSync;
    requests[index].respond(data, status);
    await pending;
  }
  return { ctx, requests, reply, cached: () => JSON.parse(cache.get(ctx.LS_KEY) || '[]') };
}

test('409 retry 的成功应答把规范化 open、回复和编号采用到 marks 与缓存', async t => {
  const { ctx, requests, reply, cached } = setup(t);
  requestSync();
  await reply(0, { error: 'revision_conflict', revision: 7, annotations: [row('a', {
    content: '旧正文', n: 8, messages: [{ who: 'agent', text: '看一下', at: 'now' }],
  })] }, 409);
  assert.equal(requests[1].body.baseRevision, 7);
  assert.equal(requests[1].body.annotations[0].status, 'check');
  assert.equal(requests[1].body.annotations[0].content, '新正文');
  const ack = { revision: 8, annotations: [row('a', {
    status: 'open', n: 8, messages: [{ who: 'agent', text: '看一下', at: 'now' }],
  })] };
  await reply(1, ack);
  assert.equal(ctx.marks[0].status, 'open', 'ack 已返回 open，marks 必须采用');
  assert.deepEqual(ctx.marks, ack.annotations);
  assert.deepEqual(cached(), ack.annotations);
  assert.equal(ctx.syncedMutationVersion, ctx.mutationVersion);
  assert.equal(requests.length, 2, '采用应答本身不触发额外保存');
});

test('以实际发送的深快照保留在途正文和嵌套目标编辑，下一次保存用 ack revision', async t => {
  const { ctx, requests, reply } = setup(t, [row('a', {
    targets: [{ ref: 'i1', selector: '#one', text: '原目标' }],
  })]);
  requestSync();
  ctx.marks[0].content = '在途又改';
  ctx.marks[0].targets[0].text = '在途目标';
  persist();
  await reply(0, { revision: 2, annotations: [row('a', {
    n: 9, status: 'open', targets: [{ ref: 'i1', selector: '#one', text: '原目标' }],
    messages: [{ who: 'agent', text: '回复', at: 'now' }],
  })] });
  const next = requests[1].body;
  assert.equal(next.baseRevision, 2);
  assert.equal(next.annotations[0].content, '在途又改');
  assert.equal(next.annotations[0].targets[0].text, '在途目标');
  assert.equal(next.annotations[0].status, 'open');
  assert.equal(next.annotations[0].n, 9);
  assert.equal(next.annotations[0].messages[0].text, '回复');
  assert.equal(ctx.baseMarks[0].content, '新正文');
  assert.equal(ctx.syncedMutationVersion, 1, '后续编辑尚未确认');
  await reply(1, { revision: 3, annotations: next.annotations });
  assert.equal(ctx.syncedMutationVersion, 2);
});

test('应答不复活在途删除的行，也不丢在途新建的行', async t => {
  const { ctx, requests, reply } = setup(t, [row('a'), row('b', { n: 2 })]);
  requestSync();
  ctx.marks.splice(0, 1);
  ctx.marks.push(row('c', { n: 3, status: 'open', content: '在途新建' }));
  persist();
  await reply(0, { revision: 2, annotations: [row('a', { status: 'open' }), row('b', { n: 4, status: 'open' })] });
  assert.deepEqual(ctx.marks.map(m => m.id), ['b', 'c']);
  assert.deepEqual(requests[1].body.annotations.map(m => m.id), ['b', 'c']);
  assert.equal(ctx.marks[0].n, 4);
  assert.equal(ctx.marks[1].content, '在途新建');
});

for (const [sentStatus, localStatus] of [['check', 'close'], ['close', 'check']]) {
  test(`在途主动状态 ${sentStatus} → ${localStatus} 保留到下一次保存`, async t => {
    const { ctx, requests, reply } = setup(t, [row('a', { status: sentStatus })]);
    requestSync();
    ctx.marks[0].status = localStatus;
    persist();
    await reply(0, { revision: 2, annotations: [row('a', { n: 6, status: sentStatus === 'close' ? 'close' : 'open' })] });
    assert.equal(ctx.marks[0].status, localStatus);
    assert.equal(requests[1].body.annotations[0].status, localStatus);
    assert.equal(requests[1].body.annotations[0].n, 6);
  });
}

test('旧路由成功应答不碰新账本的 marks、revision、base 或同步状态', async t => {
  const { ctx, requests } = setup(t);
  requestSync();
  const pending = ctx.inflightSync;
  Object.assign(ctx, {
    syncEpoch: 2, marks: [row('new', { status: 'done' })], revision: 20,
    baseMarks: [row('new')], mutationVersion: 4, syncedMutationVersion: 3,
    syncing: true, syncError: true,
    deferredRemoteDoc: { revision: 21, annotations: [row('new')] },
  });
  const before = copy(ctx);
  requests[0].respond({ revision: 2, annotations: [row('a', { status: 'open' })] });
  await pending;
  assert.deepEqual(copy(ctx), before);
  assert.equal(requests.length, 1);
});

test('同账本较旧 revision 的 ack 不倒退已采用的远端行或编号', async t => {
  const { ctx, reply } = setup(t);
  requestSync();
  ctx.revision = 5;
  ctx.marks = [row('a', { n: 10, status: 'done', content: '远端最新' })];
  setBase(ctx.marks);
  const before = copy(ctx.marks);
  await reply(0, { revision: 2, annotations: [row('a', { n: 3, status: 'open' })] });
  assert.equal(ctx.revision, 5);
  assert.deepEqual(ctx.marks, before);
  assert.deepEqual(ctx.baseMarks, before);
});

test('较新 deferred remote 在 ack 之后采用，较旧 deferred 不盖掉 ack', async t => {
  const { ctx, requests, reply, cached } = setup(t);
  requestSync();
  const newest = { revision: 5, annotations: [row('a', { status: 'done', content: '远端最新' })] };
  deferRemoteDoc(newest);
  deferRemoteDoc({ revision: 3, annotations: [row()] });
  await reply(0, { revision: 2, annotations: [row('a', { status: 'open' })] });
  assert.equal(ctx.revision, 5);
  assert.deepEqual(ctx.marks, newest.annotations);
  assert.deepEqual(cached(), newest.annotations);
  assert.equal(ctx.deferredRemoteDoc, null);
  assert.equal(requests.length, 1);

  ctx.marks[0].content = '再改';
  persist();
  deferRemoteDoc({ revision: 5, annotations: newest.annotations });
  await reply(1, { revision: 6, annotations: [row('a', { content: '再改', status: 'open' })] });
  assert.equal(ctx.revision, 6);
  assert.equal(ctx.marks[0].status, 'open');
  assert.equal(ctx.marks[0].content, '再改');
});

test('在途编辑先接规范化 ack 再接较新 deferred，重试使用最新 revision', async t => {
  const { ctx, requests, reply } = setup(t);
  requestSync();
  ctx.marks[0].content = '在途又改';
  persist();
  deferRemoteDoc({ revision: 4, annotations: [row('a', {
    status: 'done', screenId: 'remote-frame', messages: [{ who: 'agent', text: '新回复', at: 'later' }],
  })] });
  await reply(0, { revision: 2, annotations: [row('a', { status: 'open' })] });
  assert.equal(ctx.revision, 4);
  assert.equal(ctx.marks[0].content, '在途又改');
  assert.equal(ctx.marks[0].status, 'done');
  assert.equal(ctx.marks[0].screenId, 'remote-frame');
  assert.equal(ctx.marks[0].messages[0].text, '新回复');
  assert.equal(requests[1].body.baseRevision, 4);
  assert.deepEqual(requests[1].body.annotations, ctx.marks);
});
