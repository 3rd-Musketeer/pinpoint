import assert from 'node:assert/strict';
import test from 'node:test';

import { BoardMountManager } from './board-mount-session.js';

test('starting a new mount settles and disposes the previous session', async () => {
  const manager = new BoardMountManager();
  const disposed = [];
  const first = manager.begin('library');
  first.trackDisposer(() => disposed.push('first'));
  const deferred = first.defer(() => disposed.push('late'), 1000);

  const second = manager.begin('time-insight');

  assert.equal(await deferred, false);
  assert.deepEqual(disposed, ['first']);
  assert.equal(first.active, false);
  assert.equal(second.active, true);
});

test('a disposer returned after cancellation runs immediately', () => {
  const manager = new BoardMountManager();
  const disposed = [];
  const session = manager.begin('library');
  manager.begin('time-insight');

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

  manager.begin('time-insight');

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
