import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isComposingKey, isTypingTarget } from './keys.js';

/** closest 的最小替身：按选择器表回答，模仿元素祖先链。 */
function fakeEl(selectors, props) {
  return Object.assign({ closest(sel) { return selectors[sel] || null; } }, props);
}

test('isTypingTarget：input / textarea / select / 可编辑祖先都算打字', () => {
  // 元素自己是 contenteditable 时 closest 命中它自己。
  const selfEditable = fakeEl({ '[contenteditable]': null }, { isContentEditable: true });
  selfEditable.closest = function (sel) { return sel === '[contenteditable]' ? this : null; };
  const plain = fakeEl({});
  assert.equal(isTypingTarget(fakeEl({ 'input, textarea, select': {} })), true);
  assert.equal(isTypingTarget(fakeEl({ '[contenteditable]': fakeEl({}, { isContentEditable: true }) })), true);
  assert.equal(isTypingTarget(selfEditable), true);
  assert.equal(isTypingTarget(plain), false);
  assert.equal(isTypingTarget(null), false);
  // select 也算打字（与旧 stage 判「非打字」的差异统一成「打字中」）。
  assert.equal(isTypingTarget(fakeEl({ 'input, textarea, select': {}, '[contenteditable]': null })), true);
  // contenteditable=false 的祖先不算。
  assert.equal(isTypingTarget(fakeEl({ '[contenteditable]': fakeEl({}, { isContentEditable: false }) })), false);
});

test('isComposingKey：isComposing 或 keyCode 229（Safari 组字收尾）', () => {
  assert.equal(isComposingKey({ isComposing: true, keyCode: 13 }), true);
  assert.equal(isComposingKey({ isComposing: false, keyCode: 229 }), true);
  assert.equal(isComposingKey({ isComposing: false, keyCode: 27 }), false);
});
