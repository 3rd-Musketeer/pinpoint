import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAnnotationStore } from '../server/lib/annotation-store.js';
import { rebaseAnnotations } from './ledger-rebase.js';

const row = (id, n, content, extra = {}) => ({ id, n, type: 'element', status: 'open', content, selector: `#${id}`, ...extra });
const reply = (text) => ({ who: 'agent', text, at: '2026-10-14T00:00:00.000Z' });

test('agent 写的状态与回复留下，owner 对另一条的改动用本地的', () => {
  const base = [row('a', 1, '第一条'), row('b', 2, '第二条')];
  const local = [row('a', 1, '第一条'), row('b', 2, '第二条改过')];
  const server = [row('a', 1, '第一条', { status: 'done', messages: [reply('改好了')] }), row('b', 2, '第二条')];
  assert.deepEqual(rebaseAnnotations(local, base, server), [
    row('a', 1, '第一条', { status: 'done', messages: [reply('改好了')] }),
    row('b', 2, '第二条改过'),
  ]);
});

test('owner 改的正是 agent 刚写状态的那条：正文用本地的，状态与回复用盘上的（服务端再按状态机回 open）', () => {
  const base = [row('a', 1, '第一条')];
  const local = [row('a', 1, '第一条改过')];
  const server = [row('a', 1, '第一条', { status: 'check', messages: [reply('看一下')] })];
  assert.deepEqual(rebaseAnnotations(local, base, server), [row('a', 1, '第一条改过', { status: 'check', messages: [reply('看一下')] })]);
});

test('owner 在这一边改了状态（关闭）：用本地的状态', () => {
  const base = [row('a', 1, '第一条')];
  const local = [row('a', 1, '第一条', { status: 'close' })];
  const server = [row('a', 1, '第一条', { status: 'done' })];
  assert.equal(rebaseAnnotations(local, base, server)[0].status, 'close');
});

test('增删：这一边删的不回来，别处新加的留下，别处删的不回来，这一边新建的接在最后', () => {
  const base = [row('a', 1, '删掉的'), row('b', 2, '别处删的')];
  const local = [row('b', 2, '别处删的'), row('new', 9, '这一边新建')];
  const server = [row('a', 1, '删掉的', { messages: [reply('回了')] }), row('c', 3, '别处新加')];
  assert.deepEqual(rebaseAnnotations(local, base, server).map((r) => r.id), ['c', 'new']);
});

test('只动了 lastRect：其余用盘上的，lastRect 用本地的；键的先后不同不算改过', () => {
  const base = [{ status: 'open', content: '一', id: 'a', n: 1 }];
  const local = [{ id: 'a', n: 1, content: '一', status: 'open', lastRect: { x: 1, y: 2, w: 3, h: 4 } }];
  const server = [{ id: 'a', n: 1, content: '一', status: 'done' }];
  assert.deepEqual(rebaseAnnotations(local, base, server), [{ id: 'a', n: 1, content: '一', status: 'done', lastRect: { x: 1, y: 2, w: 3, h: 4 } }]);
});

test('和服务端一起：旧底的保存 409，接到盘上那版再存，agent 的 done 与回复、owner 的改动都落盘', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-rebase-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const store = createAnnotationStore({ dataDir, now: () => new Date('2026-10-14T00:00:00.000Z') });
  const page = '@canvas';
  const first = store.save({ page, baseRevision: 0, annotations: [row('a', 0, '第一条'), row('b', 0, '第二条')] });
  const base = first.doc.annotations;
  assert.equal(store.appendMessage({ page, baseRevision: 1, id: 1, text: '改好了' }).status, 200);
  assert.equal(store.setStatus({ page, baseRevision: 2, id: 1, status: 'done' }).status, 200);

  const local = base.map((r) => (r.id === 'b' ? { ...r, content: '第二条改过' } : { ...r }));
  const stale = store.save({ page, baseRevision: 1, annotations: local });
  assert.equal(stale.status, 409);
  assert.equal(stale.error, 'revision_conflict');
  // 旧做法：整份本地快照按新 revision 重发 → 盘上 done、快照里 open，判非法转换。
  assert.equal(store.save({ page, baseRevision: stale.doc.revision, annotations: local }).error, 'illegal_transition');

  const saved = store.save({ page, baseRevision: stale.doc.revision, annotations: rebaseAnnotations(local, base, stale.doc.annotations) });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.doc.annotations.map((r) => [r.n, r.status, r.content, (r.messages || []).map((m) => m.text)]), [
    [1, 'done', '第一条', ['改好了']],
    [2, 'open', '第二条改过', []],
  ]);

  // owner 改的正是 agent 刚写成 check 的那条：按状态机回 open，回复还在。
  const base2 = saved.doc.annotations;
  assert.equal(store.setStatus({ page, baseRevision: saved.doc.revision, id: 2, status: 'check' }).status, 200);
  const local2 = base2.map((r) => (r.id === 'b' ? { ...r, content: '第二条又改' } : { ...r }));
  const stale2 = store.save({ page, baseRevision: saved.doc.revision, annotations: local2 });
  assert.equal(stale2.status, 409);
  const saved2 = store.save({ page, baseRevision: stale2.doc.revision, annotations: rebaseAnnotations(local2, base2, stale2.doc.annotations) });
  assert.equal(saved2.status, 200);
  assert.deepEqual(saved2.doc.annotations.map((r) => [r.n, r.status, r.content]), [[1, 'done', '第一条'], [2, 'open', '第二条又改']]);
});
