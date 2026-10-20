// K1 第三刀（2026-10-19 性能审计）：schedule.js 的 MutationObserver 收到标注层外
// 节点的 class 变更时，只失效所在帧，不升级成 renderAll —— 哪怕账本里的标注全是
// 全局选择器。工作台哪天又写回同值 class（f2d7639 之前的选中高亮），也喂不出
// 「renderAll → notify → 快照 → 同值写」的自持循环。
//
// 直接装 schedule.js 本体：它的兄弟模块（bubbles / render / ui …）要 DOM 与 CSS，
// 这里用 module.registerHooks 换成计数替身；frame-anchor 与 mutation-scope 是纯函数，
// 用真的。DOM 只给 schedule.js 读到的那几个面。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const calls = {};
globalThis.__scheduleTestCalls = calls;

const STUBS = {
  'anchor.js': `
    const c = globalThis.__scheduleTestCalls;
    export function markElementTargets(m) { return m.targets || []; }
    export function isMarkBroken() { return false; }
    export function markHasLiveTarget() { return true; }
    export function markOnActivePage() { return true; }
    export function withLiveTargets() { c.refreshFrameContent = (c.refreshFrameContent || 0) + 1; }`,
  'bubbles.js': `
    const c = globalThis.__scheduleTestCalls;
    export function renderAll() { c.renderAll = (c.renderAll || 0) + 1; }
    export function syncBubbleStructure() {}
    export function updateBubbleGeometry() {}`,
  'dom.js': `
    export function geometryBatch(fn) { return fn(); }
    export function isUI() { return false; }`,
  'gesture.js': `export function updateDraftGeometry() {}`,
  'render-geometry.js': `
    export function syncCanvasPose() {}
    export function updateCanvasZoom() {}
    export function updateCountLabel() {}
    export function updateMarkGeometry() {}`,
  'render.js': `
    export function canvasStage() { return null; }
    export function drawableMark() { return true; }
    export function prepareCanvasView() {}
    export function syncMarkStructure() {}
    export function visiblePageMarks() { return []; }`,
  'ui.js': `
    export function notify() {}
    export function syncGhost() {}`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.endsWith('/annotate/schedule.js') && specifier.startsWith('./')) {
      const name = specifier.slice(2);
      if (STUBS[name]) return { url: 'stub:annotate/' + name, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:annotate/')) {
      return { format: 'module', source: STUBS[url.slice('stub:annotate/'.length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// schedule.js 读到的 DOM 面：观察器、rAF 队列、三个根节点。
let observerCallback = null;
const rafQueue = [];
const noop = () => {};
globalThis.MutationObserver = class {
  constructor(callback) { observerCallback = callback; }
  observe() {}
};
globalThis.requestAnimationFrame = callback => { rafQueue.push(callback); return rafQueue.length; };
globalThis.addEventListener = noop;
globalThis.document = {
  documentElement: { nodeType: 1 },
  head: { nodeType: 1 },
  body: { nodeType: 1 },
  addEventListener: noop,
};

function flushFrames() {
  while (rafQueue.length) rafQueue.shift()();
}

// 帧根 .wb-screen 与它上面的选中高亮节点（syncBoardSelection 写 wb-sel 的那个）。
const frameRoot = { nodeType: 1, getAttribute: () => 'screen-a' };
function frameNode() {
  return {
    nodeType: 1,
    id: '',
    className: 'wb-screen wb-sel',
    closest: selector => (selector === '.wb-screen' ? frameRoot : null),
    matches: () => false,
  };
}

const schedule = await import('./schedule.js');

function install(marks) {
  const ctx = { marks, canvasView: { stage: {} }, structureDirty: false, markNodes: {}, markFacts: new Map(), selectorCache: new Map() };
  schedule.bind_schedule(ctx);
  schedule.init_schedule();
  schedule.installViewScheduling();
  return ctx;
}

// 全局选择器：没有 stage 段（.ios-stage 等），不是 frame-internal —— 旧实现见到
// 它就把任何属性变更升级成整层失效。
const GLOBAL_MARKS = [
  { n: 1, targets: [{ selector: 'body > div.wb-zoom-wrap > section#lib-a > div.wb-sec-body > div.wb-screen > div.ios-app' }] },
];

test('标注层外节点上反复改 class（每帧同值 remove + add 共 30 帧）不触发 renderAll，只局部刷新所在帧', () => {
  install(GLOBAL_MARKS);
  calls.renderAll = 0;
  calls.refreshFrameContent = 0;
  const node = frameNode();
  for (let frame = 0; frame < 30; frame++) {
    observerCallback([
      { type: 'attributes', attributeName: 'class', oldValue: 'wb-screen wb-sel', target: node },
      { type: 'attributes', attributeName: 'class', oldValue: 'wb-screen', target: node },
    ]);
    flushFrames();
  }
  assert.equal(calls.renderAll, 0, '60 条同值属性变更记录不升级成整层重绘');
  assert.equal(calls.refreshFrameContent, 30, '每帧一次所在帧的局部刷新');
});

test('对照：同一账本下结构变更仍升级成 renderAll（计数器看得见整层重绘）', () => {
  install(GLOBAL_MARKS);
  calls.renderAll = 0;
  observerCallback([{ type: 'childList', target: frameNode(), addedNodes: [{ nodeType: 1 }], removedNodes: [] }]);
  flushFrames();
  assert.equal(calls.renderAll, 1);
});

// 拖左栏每帧只改 :root 的 --wb-side-w（boot-prefs applySideWidth）。过滤只放过
// --wb-board-zoom / --wb-strip-w 时，这条 style 变更被当成内容变更，每帧 renderAll
// （2026-09-24 性能审计：300 条标注 7.4 ms/帧）。左栏宽度不改帧内容。
// 过滤认的是 document.documentElement 这一个节点（拖宽写在 :root 上）。
function htmlRoot(style) {
  const root = document.documentElement;
  root.id = '';
  root.className = '';
  root.closest = () => null;
  root.matches = () => false;
  root.getAttribute = name => (name === 'style' ? style : null);
  return root;
}

test('拖左栏只改 --wb-side-w（30 帧）不触发 renderAll，也不局部刷新', () => {
  install(GLOBAL_MARKS);
  calls.renderAll = 0;
  calls.refreshFrameContent = 0;
  const before = '--wb-side-w: 250px; --wb-board-zoom: 1;';
  for (let frame = 0; frame < 30; frame++) {
    const after = `--wb-side-w: ${260 + frame}px; --wb-board-zoom: 1;`;
    observerCallback([
      { type: 'attributes', attributeName: 'style', oldValue: before, target: htmlRoot(after) },
    ]);
    flushFrames();
  }
  assert.equal(calls.renderAll, 0, '30 帧左栏宽度变更不整层重绘');
  assert.equal(calls.refreshFrameContent, 0, '左栏宽度不落在任何帧上');
});

test('对照：同一根上改一个非视口变量仍整层重绘', () => {
  install(GLOBAL_MARKS);
  calls.renderAll = 0;
  const before = '--wb-side-w: 250px; --wb-accent: red;';
  const after = '--wb-side-w: 260px; --wb-accent: blue;';
  observerCallback([
    { type: 'attributes', attributeName: 'style', oldValue: before, target: htmlRoot(after) },
  ]);
  flushFrames();
  assert.equal(calls.renderAll, 1);
});

// 机壳时钟（ios-kit 每分钟改 .ios-sb-time 的 textContent）：一条把文字节点换掉的
// childList。账本有全局选择器时旧实现把它升级成整层重绘，97 帧的板静息时每分钟
// 一次 renderAll（2026-10-20 K1 静息门偶挂的 rects 70 / renders 1 就是它）。
test('机壳时钟走一格（状态栏换文字节点）既不整层重绘，也不局部刷新', () => {
  install(GLOBAL_MARKS);
  calls.renderAll = 0;
  calls.refreshFrameContent = 0;
  const clock = {
    nodeType: 1,
    id: '',
    className: 'ios-sb-time',
    closest: selector => (selector.includes('.ios-sb-time') ? clock : selector === '.wb-screen' ? frameRoot : null),
    matches: () => false,
  };
  observerCallback([{ type: 'childList', target: clock, addedNodes: [{ nodeType: 3 }], removedNodes: [{ nodeType: 3 }] }]);
  flushFrames();
  assert.equal(calls.renderAll, 0);
  assert.equal(calls.refreshFrameContent, 0);
});
