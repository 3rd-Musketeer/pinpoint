// 弹层栈（C2，由 site/src/lib/layers.js 提升）：站点与工作台共用，Esc 只问栈顶 ——
// 优先级最高（rank 最小）的一层，同级取最后压入的（后开在上）。工作台各层的先后次序见 LAYER_RANK。
// 契约（site/README.md「弹层与 Esc」）：处理了 Esc 的一方 preventDefault；别的监听
// 见 e.defaultPrevented 就不动。层可以「不在场」：close 返回 false 表示这一层此刻
// 没有要退的东西，栈继续问下一层 —— 标注客户端用它在栈里常驻适配层
// （草稿 / 页面自己的层 / 模式），状态变了不用同步压栈出栈。返回 undefined 算接住
// （React 的层都这样），返回 YIELD 表示这一下归页面自己。
// 跨文档（工作台在文章浮层里、卡片和页面浮层在画布里）「没接住的 Esc 交给外层」
// 由 attachLayerStack 的 forward 承担：同一个协议，外层文档的栈照同一套优先级处理。

import { isTypingTarget, isComposingKey } from './keys.js';

/** Esc 的先后次序（小的先关）。站点的层都用缺省 0（纯 LIFO）。 */
export var LAYER_RANK = {
  draft: 0,
  chrome: 1,
  annList: 1.2,
  hostPage: 1.5,
  mode: 2,
  canvasNav: 2.5,
  pageOverlay: 3,
};

/** close 返回它：这一下 Esc 归页面自己（页面的菜单、焦点所在的输入框），
    栈不处理、不 preventDefault、也不往外层转。 */
export var YIELD = 'yield';

export function createLayerStack() {
  const stack = [];
  const remove = (entry) => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
  const escapeObservers = [];
  return {
    /** 压入一层；返回释放函数（重复释放无害）。
        opts: { rank, respectTyping, sticky }。
        respectTyping：焦点在打字里时这一下归输入框，栈到此为止（不往下问，旧 Dock /
        大纲 / 页面浮层「输入框占着 Esc」的判断）。
        sticky：常驻适配层，不随「被关」出栈，靠 close 返回 true / false 表达
        「有东西可退 / 不在场」。 */
    push(name, close, opts) {
      opts = opts || {};
      // ?? 而不是 ||：review 指出 || 会把明确传入的 0 否掉。对 0 两者结果相同
      // （0 是假值，都落 0），差别在 null：?? 留下 null，排序时被当成 0。
      const entry = { name, close, rank: opts.rank ?? 0, respectTyping: !!opts.respectTyping, sticky: !!opts.sticky };
      stack.push(entry);
      let released = false;
      return () => { if (!released) { released = true; remove(entry); } };
    },
    top: () => (stack.length ? stack[stack.length - 1].name : ''),
    names: () => stack.map((e) => e.name),
    /** 关掉所有叫 name 的层（例如浮层打开时收起 popup）。 */
    dismiss(name) {
      for (const entry of stack.filter((e) => e.name === name)) { remove(entry); entry.close(); }
    },
    /** 每次 Esc 到达（未组字）先通知观察者，再逐层问。 */
    onEscape(fn) {
      escapeObservers.push(fn);
      return () => {
        const i = escapeObservers.indexOf(fn);
        if (i >= 0) escapeObservers.splice(i, 1);
      };
    },
    /** 按次序问各层。返回 true：关掉了一层并 preventDefault；YIELD：这一下归页面
        （不处理、不外转）；false：没有任何层接。观察者在逐层问之前收到每一次未组字的
        Esc（空栈也一样）—— 标注客户端借它取消还在等首帧的跳转。 */
    escape(e) {
      if (isComposingKey(e)) return false;
      for (const fn of escapeObservers.slice()) fn(e);
      if (!stack.length || e?.defaultPrevented) return false;
      const order = stack.map((entry, i) => i)
        .sort((a, b) => (stack[a].rank - stack[b].rank) || (b - a));
      for (const i of order) {
        const entry = stack[i];
        if (stack.indexOf(entry) < 0) continue;
        if (entry.respectTyping && isTypingTarget(e?.target)) return YIELD;
        const r = entry.close();
        if (r === false) continue;
        if (r === YIELD) return YIELD;
        // 接住了就出栈；sticky 层除外（常驻，不代表「有一个开着的弹层」）。
        if (!entry.sticky) remove(entry);
        e?.preventDefault?.();
        return true;
      }
      return false;
    },
  };
}

const STACK_KEY = '__pinpointLayerStack';

/** 给一个 window 装上弹层栈与捕获段的 Esc 监听（每个文档一份，幂等：已装过返回
    现成的 —— 注入的标注客户端和宿主各调一次，拿到同一份）。捕获段先于页面所有
    keydown 监听：接住了就截断，页面自己注册的 Esc（关表单、关弹窗）不会跟着触发
    （owner 2026-10-19）。没接住、焦点也不在打字里时交给 forward（setForward 装；
    缺省没有，独立打开的页面不往任何地方转）。 */
export function attachLayerStack(win) {
  if (win[STACK_KEY]) return win[STACK_KEY];
  const stack = createLayerStack();
  win[STACK_KEY] = stack;
  let forward = null;
  let forwardOpts = {};
  let pending = null;
  /** fn(e) 收没接住的 Esc。opts.afterPage：等页面自己的监听跑完（window 冒泡段）
      再转，页面截断了这一下就不转；opts.skipHandled：页面 preventDefault 过也不转。 */
  stack.setForward = (fn, opts) => { forward = fn; forwardOpts = opts || {}; };
  win.addEventListener('keydown', (e) => {
    pending = null;
    if (e.key !== 'Escape') return;
    const r = stack.escape(e);
    if (r === true) { e.stopImmediatePropagation(); return; }
    if (r === YIELD || !forward || isComposingKey(e) || isTypingTarget(e.target)) return;
    if (forwardOpts.afterPage) pending = e;
    else forward(e);
  }, true);
  win.addEventListener('keydown', (e) => {
    if (pending !== e) return;
    pending = null;
    if (forwardOpts.skipHandled && e.defaultPrevented) return;
    if (forward) forward(e);
  });
  return stack;
}

/** 没接住的 Esc 交给外层：在父级 window 上重放一次 Escape（父级捕获段的弹层栈
    照同一套次序处理）。同源才转（跨源读 parent 会抛）；顶层窗口没有父级。 */
export function forwardEscapeToParent(win) {
  if (!win || win.parent === win) return;
  let parent = null;
  try { parent = win.parent; if (!parent.document) return; } catch (e) { return; }
  parent.dispatchEvent(new parent.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

/** 给一份嵌入文档装上「没接住就重放给父级 window」。差别只在两个开关：
    afterPage 等页面自己的监听跑完再转；skipHandled 时页面 preventDefault 过也不转。
    嵌入工作台不走这里：它没接住时是 postMessage 请文章页关浮层，不是重放按键。 */
export function forwardUncaught(win, opts) {
  attachLayerStack(win).setForward(function () { forwardEscapeToParent(win); }, opts);
}
