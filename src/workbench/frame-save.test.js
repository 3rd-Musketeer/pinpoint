import test from 'node:test';
import assert from 'node:assert/strict';
import { frameReadyToUnload } from './frame-save.js';

const frame = state => ({ contentWindow: { pinpoint: { getState: () => state, hasActiveDraft: () => false } } });

test('没有在途请求或错误也不能代表落盘，只有明确没有未同步修改才允许卸载', () => {
  assert.equal(frameReadyToUnload(frame({ syncing: false, syncError: false, unsynced: true })), false);
  assert.equal(frameReadyToUnload(frame({ syncing: false, syncError: false })), false);
  assert.equal(frameReadyToUnload(frame({ syncing: false, syncError: false, unsynced: false })), true);
});

test('无未同步修改也要等水合、在途请求、outbox 和几何缓存保存完成', () => {
  for (const key of ['routing', 'syncing', 'outbox', 'lastRectPending', 'syncError']) {
    assert.equal(frameReadyToUnload(frame({ unsynced: false, [key]: true })), false, key);
  }
  assert.equal(frameReadyToUnload({ contentWindow: {} }), false);
  assert.equal(frameReadyToUnload({ get contentWindow() { throw new Error('inaccessible'); } }), false);
});

test('回收先提交草稿，再读最新保存状态，草稿没落盘时保留实例', () => {
  let draft = true;
  const state = { unsynced: false };
  const f = frame(state);
  f.contentWindow.pinpoint.hasActiveDraft = () => draft;
  f.contentWindow.pinpoint.cancelDraft = () => { draft = false; state.unsynced = true; };
  assert.equal(frameReadyToUnload(f), false);
  assert.equal(draft, false);
  state.unsynced = false;
  assert.equal(frameReadyToUnload(f), true);
});
