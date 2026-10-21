// 撤销按稳定标注 id 找回目标：创建应答把临时 n 就地认成正式号（persist.js
// adoptServerNumbers 按 id 改同一对象的 n）之后，toast 撤销仍能恢复关闭前的
// 状态。红→绿：旧码的 toast 闭包捕获旧 n，认号后 markStatus 按 n 找不到目标。
// 走真实 closeAnnotation 与真实 showToast 的按钮回调入口；client 本地依赖换成
// 最小替身（registerHooks），shared 纯模块用真的；DOM 只够 showToast 用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const STUBS = {
  'anchor.js': `
    export function isMarkBroken() { return false; }
    export function markElementTargets() { return []; }`,
  'bubbles.js': `export function renderAll() {}`,
  'composer.js': `export function closeComposer() {}`,
  'marks.js': `
    export function annotationContent(m) { return (m && m.content) || ''; }
    export function contentToDisplay(t) { return t; }
    export function statusFilterKey() { return 'filter'; }`,
  'nav.js': `
    export function goToMark() {}
    export function marksForActivePage() { return []; }`,
  'persist.js': `export function persist() { globalThis.__sidebarTest.persisted++; }`,
  'ui.js': `
    export function annIcon() { return ''; }
    export function notify() {}
    export function toggleMode() {}`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.endsWith('/annotate/sidebar.js')) {
      const name = specifier.startsWith('./') ? specifier.slice(2) : specifier;
      if (STUBS[name]) return { url: 'stub:sidebar/' + name, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:sidebar/')) {
      return { format: 'module', source: STUBS[url.slice('stub:sidebar/'.length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// 够 showToast 用的最小元素：textContent 赋空串清子节点（与真实 DOM 一致），
// click 走 addEventListener 注册的回调。
class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attrs = {};
    this.hidden = false;
    this.id = '';
    this._text = '';
  }
  set textContent(v) { this._text = v; if (v === '') this.children = []; }
  get textContent() { return this._text; }
  setAttribute(k, v) { this.attrs[k] = v; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  click() { if (this.listeners.click) this.listeners.click(); }
}

globalThis.document = {
  body: new FakeEl('body'),
  createElement: (tag) => new FakeEl(tag),
};

const { bind_sidebar, init_sidebar, closeAnnotation } = await import('./sidebar.js');

function arm(marks) {
  globalThis.__sidebarTest = { persisted: 0 };
  const ctx = { marks, activeComposer: null };
  bind_sidebar(ctx);
  init_sidebar();
  return ctx;
}

/** toast 的撤销按钮（label 之后那个带 click 监听的孩子）；文案在第一个孩子身上。 */
const toastButton = (ctx) => ctx.toastEl.children.find((c) => c.listeners.click);
const toastText = (ctx) => ctx.toastEl.children[0].textContent;
const persisted = () => globalThis.__sidebarTest.persisted;

test('完成在临时号 n1、应答就地认号 n4 之后：撤销按同一 id 恢复 open 并 persist', () => {
  const m = { id: 'a1b2c3', n: 1, status: 'open', content: 'x' };
  const ctx = arm([m]);
  closeAnnotation(1);
  assert.equal(m.status, 'close');
  assert.equal(persisted(), 1);
  assert.equal(toastText(ctx), '已完成 #1');
  m.n = 4; // adoptServerNumbers：同一对象就地认号
  toastButton(ctx).click();
  assert.equal(m.status, 'open');
  assert.equal(m.n, 4);
  assert.equal(persisted(), 2);
  clearTimeout(ctx.toastTimer);
});

test('撤销恢复关闭前的原态：check 回 check，不是一律回 open', () => {
  const m = { id: 'd4e5f6', n: 2, status: 'check' };
  const ctx = arm([m]);
  closeAnnotation(2);
  assert.equal(m.status, 'close');
  toastButton(ctx).click();
  assert.equal(m.status, 'check');
  assert.equal(persisted(), 2);
  clearTimeout(ctx.toastTimer);
});

test('行被同 n 新 id 顶替或已删除（含切账本）：撤销不动任何同号行', () => {
  const m = { id: 'a1b2c3', n: 1, status: 'open' };
  const ctx = arm([m]);
  closeAnnotation(1);
  const other = { id: 'z9y8x7', n: 1, status: 'open' };
  ctx.marks = [other]; // 同号不同条：别处重写 / 换了账本
  toastButton(ctx).click();
  assert.equal(other.status, 'open');
  assert.equal(persisted(), 1);
  clearTimeout(ctx.toastTimer);

  const gone = { id: 'g1h2i3', n: 3, status: 'done' };
  const ctx2 = arm([gone]);
  closeAnnotation(3);
  ctx2.marks = []; // 行已删
  toastButton(ctx2).click();
  assert.equal(persisted(), 1); // 只有完成那一次 persist
  clearTimeout(ctx2.toastTimer);
});

test('缺 id 的旧行（未经 ensureAllMarkIds 的存量）保持原按 n 撤销', () => {
  const m = { n: 5, status: 'open' };
  const ctx = arm([m]);
  closeAnnotation(5);
  assert.equal(m.status, 'close');
  toastButton(ctx).click();
  assert.equal(m.status, 'open');
  assert.equal(persisted(), 2);
  clearTimeout(ctx.toastTimer);
});
