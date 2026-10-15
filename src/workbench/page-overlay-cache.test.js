import test from 'node:test';
import assert from 'node:assert/strict';
import { touchPageOverlayFrame } from './page-overlay-cache.js';

function fixture() {
  const frames = ['a', 'b', 'c'].map(id => {
    const state = { syncing: false, unsynced: false };
    const frame = {
      id, loaded: false, hidden: true, draft: false, state, unloaded: false,
      closest() { return this.hidden; },
      removeAttribute() { this.loaded = false; },
    };
    frame.contentWindow = { pinpoint: {
      getState: () => state,
      hasActiveDraft: () => frame.draft,
      cancelDraft: () => { frame.draft = false; state.syncing = true; },
    }, location: { replace: url => { assert.equal(url, 'about:blank'); frame.unloaded = true; } } };
    return frame;
  });
  const panel = { isConnected: true, querySelectorAll: () => frames.filter(f => f.loaded) };
  return { panel, frames, show(id) {
    frames.forEach(f => { f.hidden = f.id !== id; });
    const frame = frames.find(f => f.id === id);
    frame.loaded = true;
    touchPageOverlayFrame(panel, frame);
  }, ids: () => frames.filter(f => f.loaded).map(f => f.id) };
}

test('页面浮层保留最近两份文档，淘汰时导航到空白页', () => {
  const f = fixture();
  for (const id of ['a', 'b', 'c']) f.show(id);
  assert.deepEqual(f.ids(), ['b', 'c']);
  assert.equal(f.frames[0].unloaded, true);
});

test('最旧文档还在保存时等它保存；等待期间重新打开会更新 LRU', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.frames[0].state.syncing = true;
  for (const id of ['a', 'b', 'c']) f.show(id);
  assert.deepEqual(f.ids(), ['a', 'b', 'c']);
  t.mock.timers.tick(100);
  assert.equal(f.frames[0].unloaded, false);
  f.show('a');
  assert.deepEqual(f.ids(), ['a', 'c']);
  f.frames[0].state.syncing = false;
  t.mock.timers.tick(100);
  assert.equal(f.frames[0].unloaded, false);
});

test('淘汰先提交草稿，保存成功后才回收；保存失败或几何保存还在等都暂缓', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  f.frames[0].draft = true;
  for (const id of ['a', 'b', 'c']) f.show(id);
  assert.equal(f.frames[0].draft, false);
  assert.equal(f.frames[0].unloaded, false);
  f.frames[0].state.syncing = false;
  f.frames[0].state.syncError = true;
  t.mock.timers.tick(100);
  assert.equal(f.frames[0].unloaded, false);
  f.frames[0].state.syncError = false;
  f.frames[0].state.lastRectPending = true;
  t.mock.timers.tick(100);
  assert.equal(f.frames[0].unloaded, false);
  f.frames[0].state.lastRectPending = false;
  t.mock.timers.tick(100);
  assert.deepEqual(f.ids(), ['b', 'c']);
});
