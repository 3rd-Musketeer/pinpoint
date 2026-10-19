import assert from 'node:assert/strict';
import test from 'node:test';

import { BoardMountManager, BoardMountSession } from './board-mount-session.js';

test('starting a new mount settles and disposes the previous session', async () => {
  const manager = new BoardMountManager();
  const disposed = [];
  const first = manager.begin('library');
  first.trackDisposer(() => disposed.push('first'));
  const deferred = first.defer(() => disposed.push('late'), 1000);

  const second = manager.begin('other-page');

  assert.equal(await deferred, false);
  assert.deepEqual(disposed, ['first']);
  assert.equal(first.active, false);
  assert.equal(second.active, true);
});

test('a disposer returned after cancellation runs immediately', () => {
  const manager = new BoardMountManager();
  const disposed = [];
  const session = manager.begin('library');
  manager.begin('other-page');

  session.trackDisposer(() => disposed.push('stale'));

  assert.deepEqual(disposed, ['stale']);
});

test('cancelling an in-progress async mount settles without waiting for it', async () => {
  const manager = new BoardMountManager();
  const session = manager.begin('library');
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const deferred = session.defer(() => blocked);
  await new Promise((resolve) => setImmediate(resolve));

  manager.begin('other-page');

  assert.equal(await deferred, false);
  release();
});

test('a disposer for a detached root runs immediately', () => {
  const manager = new BoardMountManager();
  const disposed = [];
  const session = manager.begin('library');

  session.trackDisposer(() => disposed.push('detached'), { isConnected: false });

  assert.deepEqual(disposed, ['detached']);
});

test('previewsSettled：自己落定之前被替换的会话落 false，不会一直挂着', async () => {
  const manager = new BoardMountManager();
  const first = manager.begin('library');
  manager.begin('library');
  assert.equal(await first.previewsSettled, false);
  assert.equal(await first.boardSettled, false);
});

test('previewsSettled 与 boardSettled 各落各的：几何先好、脚本后好', async () => {
  const manager = new BoardMountManager();
  const session = manager.begin('library');
  session.settleBoard(true);
  assert.equal(await session.boardSettled, true);
  let previews = null;
  session.previewsSettled.then((ok) => { previews = ok; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(previews, null, '脚本还在挂时不落定');
  session.settlePreviews(true);
  assert.equal(await session.previewsSettled, true);
});

test('disposeWithin 只卸载这块子树里挂的脚本，别的留到会话取消', () => {
  const session = new BoardMountSession(1, 'p');
  const inside = { isConnected: true };
  const outside = { isConnected: true };
  const scope = { contains: (el) => el === inside };
  const calls = [];
  session.trackDisposer(() => calls.push('inside'), inside);
  session.trackDisposer(() => calls.push('outside'), outside);
  session.disposeWithin(scope);
  assert.deepEqual(calls, ['inside']);
  session.cancel();
  assert.deepEqual(calls, ['inside', 'outside']);
});
