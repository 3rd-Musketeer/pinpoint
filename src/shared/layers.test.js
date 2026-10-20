import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attachLayerStack, createLayerStack, LAYER_RANK, YIELD } from './layers.js';

function escKey(overrides) {
  return Object.assign({ key: 'Escape', isComposing: false, keyCode: 69, defaultPrevented: false, prevented: false, preventDefault() { this.prevented = true; this.defaultPrevented = true; } }, overrides);
}

test('同级层后开在上：Esc 逐层关，只关一层并 preventDefault', () => {
  const stack = createLayerStack();
  const closed = [];
  const releaseB = stack.push('b', () => closed.push('b'));
  stack.push('a', () => closed.push('a'));
  assert.equal(stack.top(), 'a');
  assert.deepEqual(stack.names(), ['b', 'a']);
  const e = escKey();
  assert.equal(stack.escape(e), true);
  assert.deepEqual(closed, ['a']);
  assert.equal(e.defaultPrevented, true);
  assert.equal(stack.escape(escKey()), true);
  assert.deepEqual(closed, ['a', 'b']);
  assert.equal(stack.escape(escKey()), false);
  releaseB();
});

test('rank 小的先关，同级取最后压入', () => {
  const stack = createLayerStack();
  const closed = [];
  stack.push('chrome', () => closed.push('chrome'), { rank: 1 });
  stack.push('mode', () => closed.push('mode'), { rank: 2 });
  stack.push('draft', () => closed.push('draft'), { rank: 0 });
  assert.equal(stack.escape(escKey()), true);
  assert.deepEqual(closed, ['draft']);
  assert.equal(stack.escape(escKey()), true);
  assert.deepEqual(closed, ['draft', 'chrome']);
  assert.equal(stack.escape(escKey()), true);
  assert.deepEqual(closed, ['draft', 'chrome', 'mode']);
});

test('close 返回 false 表示不在场，栈继续问下一层（适配层语义）', () => {
  const stack = createLayerStack();
  const closed = [];
  stack.push('adapter-draft', () => false, { rank: 0 });
  stack.push('menu', () => closed.push('menu'), { rank: 1 });
  assert.equal(stack.escape(escKey()), true);
  assert.deepEqual(closed, ['menu']);
});

test('close 返回 undefined 算接住：出栈并 preventDefault，不再问下一层', () => {
  const stack = createLayerStack();
  const closed = [];
  stack.push('menu', () => { closed.push('menu'); }, { rank: 1 });
  stack.push('list', () => { closed.push('list'); }, { rank: 2 });
  const e = escKey();
  assert.equal(stack.escape(e), true);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(closed, ['menu']);
  assert.deepEqual(stack.names(), ['list']);
});

test('明确传 rank 0 与缺省同级，后开的先关', () => {
  const stack = createLayerStack();
  const closed = [];
  // 0 是假值：|| 和 ?? 都落 0，和缺省同级。后开的先关，证明 0 没有被排到别的级。
  stack.push('zero', () => closed.push('zero'), { rank: 0 });
  stack.push('plain', () => closed.push('plain'));
  assert.equal(stack.escape(escKey()), true);
  assert.deepEqual(closed, ['plain']);
});

test('sticky 适配层接住 Esc 后仍在栈里，下一次 Esc 照常工作', () => {
  const stack = createLayerStack();
  let draftOpen = true;
  const steps = [];
  stack.push('adapter-draft', () => (draftOpen ? (steps.push('draft'), draftOpen = false, true) : false), { rank: 0, sticky: true });
  assert.equal(stack.escape(escKey()), true);
  assert.deepEqual(stack.names(), ['adapter-draft']);
  assert.equal(stack.escape(escKey()), false); // 不在场了，往下没人接
  assert.equal(stack.top(), 'adapter-draft');
});

const typingTarget = { closest(sel) { return sel === 'input, textarea, select' ? {} : null; } };

test('respectTyping 的层：焦点在打字里时这一下归输入框，栈到此为止', () => {
  const stack = createLayerStack();
  const closed = [];
  stack.push('mode', () => closed.push('mode'), { rank: 2 });
  stack.push('list', () => closed.push('list'), { rank: 1, respectTyping: true });
  stack.push('menu', () => closed.push('menu'), { rank: 1 });
  // 后开的菜单不让位：先关它。
  assert.equal(stack.escape(escKey({ target: typingTarget })), true);
  assert.deepEqual(closed, ['menu']);
  // 轮到列表：打字中 → 不关列表，也不往下关模式（旧 Dock「输入框占着 Esc」）。
  const e = escKey({ target: typingTarget });
  assert.equal(stack.escape(e), YIELD);
  assert.equal(e.defaultPrevented, false);
  assert.deepEqual(closed, ['menu']);
  assert.equal(stack.escape(escKey({ target: {} })), true);
  assert.deepEqual(closed, ['menu', 'list']);
});

test('close 返回 YIELD：这一下归页面，不处理也不 preventDefault，下层不问', () => {
  const stack = createLayerStack();
  const closed = [];
  let hostMenu = true;
  stack.push('host', () => (hostMenu ? YIELD : false), { rank: LAYER_RANK.hostPage, sticky: true });
  stack.push('mode', () => { closed.push('mode'); return true; }, { rank: LAYER_RANK.mode, sticky: true });
  const e = escKey();
  assert.equal(stack.escape(e), YIELD);
  assert.equal(e.defaultPrevented, false);
  assert.deepEqual(closed, []);
  hostMenu = false;
  assert.equal(stack.escape(escKey()), true);
  assert.deepEqual(closed, ['mode']);
});

test('LAYER_RANK：草稿 → 菜单与对话框 → 标注列表 → 页面自己的层 → 标注模式 → 页面浮层', () => {
  const order = ['draft', 'chrome', 'annList', 'hostPage', 'mode', 'pageOverlay'];
  assert.deepEqual(Object.keys(LAYER_RANK).sort((a, b) => LAYER_RANK[a] - LAYER_RANK[b]), order);
});

test('已 preventDefault 的 Esc 不接（正文评论客户端见 defaultPrevented 就不动）', () => {
  const stack = createLayerStack();
  const closed = [];
  stack.push('a', () => closed.push('a'));
  assert.equal(stack.escape(escKey({ defaultPrevented: true, prevented: true })), false);
  assert.deepEqual(closed, []);
});

test('组字中的 Esc 不接', () => {
  const stack = createLayerStack();
  const closed = [];
  stack.push('a', () => closed.push('a'));
  assert.equal(stack.escape(escKey({ isComposing: true })), false);
  assert.equal(stack.escape(escKey({ keyCode: 229 })), false);
  assert.deepEqual(closed, []);
});

test('dismiss 关掉同名各层；释放函数可重复调用', () => {
  const stack = createLayerStack();
  const closed = [];
  const release = stack.push('popup', () => closed.push('popup-1'));
  release();
  release();
  stack.push('popup', () => closed.push('popup-2'));
  stack.push('overlay', () => closed.push('overlay'));
  stack.dismiss('popup');
  assert.deepEqual(closed, ['popup-2']);
  assert.deepEqual(stack.names(), ['overlay']);
});

test('onEscape 每次 Esc 到达先通知（含没接住的），可退订', () => {
  const stack = createLayerStack();
  let seen = 0;
  const off = stack.onEscape(() => { seen++; });
  stack.escape(escKey());
  stack.escape(escKey()); // 空栈也通知
  assert.equal(seen, 2);
  off();
  stack.escape(escKey());
  assert.equal(seen, 2);
});

/** 最小的 window 替身：按捕获 → 冒泡顺序跑 keydown 监听，页面自己的监听夹在中间。 */
function fakeWin(pageListener) {
  const capture = [];
  const bubble = [];
  const win = {
    addEventListener(type, fn, useCapture) { if (type === 'keydown') (useCapture ? capture : bubble).push(fn); },
    press(overrides) {
      const e = escKey(Object.assign({ stopped: false, stopImmediatePropagation() { this.stopped = true; } }, overrides));
      for (const fn of capture) { fn(e); if (e.stopped) return e; }
      if (pageListener) pageListener(e);
      for (const fn of bubble) { fn(e); if (e.stopped) return e; }
      return e;
    },
  };
  return win;
}

test('attachLayerStack：同一 window 幂等；接住的 Esc 截断，页面自己的监听收不到', () => {
  let pageSaw = 0;
  const win = fakeWin(() => { pageSaw++; });
  const stack = attachLayerStack(win);
  assert.equal(attachLayerStack(win), stack);
  const closed = [];
  stack.push('menu', () => closed.push('menu'));
  const e = win.press();
  assert.equal(e.stopped, true);
  assert.deepEqual(closed, ['menu']);
  assert.equal(pageSaw, 0);
});

test('attachLayerStack：没接住的 Esc 缺省不外转；捕获段转发不看 defaultPrevented', () => {
  const win = fakeWin((e) => e.preventDefault());
  const stack = attachLayerStack(win);
  win.press(); // 没有 forward：什么都不发生
  const sent = [];
  stack.setForward((e) => sent.push(e.key));
  win.press();
  assert.deepEqual(sent, ['Escape']);
  win.press({ target: typingTarget }); // 焦点在输入框里：留给输入框
  win.press({ isComposing: true });
  assert.deepEqual(sent, ['Escape']);
});

test('attachLayerStack：afterPage 等页面的监听跑完再转，skipHandled 时页面处理过就不转', () => {
  let handled = false;
  const win = fakeWin((e) => { if (handled) e.preventDefault(); });
  const stack = attachLayerStack(win);
  const sent = [];
  stack.setForward(() => sent.push('fwd'), { afterPage: true, skipHandled: true });
  win.press();
  assert.deepEqual(sent, ['fwd']);
  handled = true;
  win.press();
  assert.deepEqual(sent, ['fwd']);
  // YIELD（页面自己的菜单开着）：不转。
  handled = false;
  stack.push('host', () => YIELD, { sticky: true });
  win.press();
  assert.deepEqual(sent, ['fwd']);
});
