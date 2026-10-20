import assert from 'node:assert/strict';
import test from 'node:test';
import { scrollStageTo, whenStageScrollSettled } from './scroll-motion.js';

test('即时定位的就绪信号包括 content-visibility 交还的两帧尾部', async () => {
  const originals = { requestAnimationFrame: globalThis.requestAnimationFrame, matchMedia: globalThis.matchMedia };
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  globalThis.matchMedia = () => ({ matches: true });
  const stage = {
    scrollLeft: 0, scrollTop: 0, scrollWidth: 1000, scrollHeight: 1000, clientWidth: 100, clientHeight: 100,
    querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    scrollTo({ left, top }) { this.scrollLeft = left; this.scrollTop = top; },
  };
  try {
    await scrollStageTo(stage, { left: 20, top: 30 }, { smooth: false });
    let settled = false;
    const done = whenStageScrollSettled().then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    frames.shift()();
    await Promise.resolve();
    assert.equal(settled, false);
    frames.shift()();
    await done;
    assert.equal(settled, true);
    assert.deepEqual([stage.scrollLeft, stage.scrollTop], [20, 30]);
  } finally {
    Object.assign(globalThis, originals);
  }
});
