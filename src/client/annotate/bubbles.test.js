// 画布实例的评论卡只在 hover / 定位时存在一张。这里装 bubbles.js 与 render.js
// 本体：兄弟模块换成替身，避免整份客户端在导入时去绑 DOM。断言看 #ann-bubbles
// 里的真实节点和正文，不看函数有没有被调用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const calls = { opened: [] };
globalThis.__bubbleTestCalls = calls;

const STUBS = {
  'bubbles.js': {
    'anchor.js': `
      export function isMarkBroken(m) { return !!m.broken; }
      export function markAnchorRect() { return [0, 0, 10, 10]; }
      export function markOnActivePage() { return true; }
      export function resolveMarkAnchor() { return { el: null, live: true }; }
      export function withLiveTargets(fn) { return fn(); }`,
    'dom.js': `
      export function beginOverlayFrame() {}
      export function clearAnchorCache() {}
      export function geometryBatch(fn) { return fn(); }
      export function viewToOverlayRect(r) { return r; }
      export function visibleViewRectDoc(r) { return r; }`,
    'gesture.js': `export function updateDraftGeometry() {}`,
    // 正文只取当前对象的 content：SSE 换掉 marks 里的对象后，卡读这份新正文。
    'marks.js': `
      export function bubbleMarkView(m) {
        return { n: m.n, cap: '', content: m.content || '', segments: null, replies: [] };
      }`,
    'nav.js': `
      const c = globalThis.__bubbleTestCalls;
      export function openMark(n) { c.opened.push(n); }`,
    'render-geometry.js': `
      export function projectMark() { return { parts: [[40, 40, 80, 24]] }; }
      export function updateCountLabel() {}
      export function updateMarkGeometry() {}`,
    'ui.js': `
      export function mountOverlay() {}
      export function syncGhost() {}`,
  },
  'render.js': {
    // 与 anchor.js 同一条：空 targets 即损坏；页与活目标在这组夹具里恒成立。
    'anchor.js': `
      export function isMarkBroken(m) { return !(m.targets && m.targets.length); }
      export function markElementTargets(m) { return m.targets || []; }
      export function markHasLiveTarget(m) { return !!(m.targets && m.targets.length); }
      export function markOnActivePage() { return true; }
      export function resolveAllLiveTargets() { return []; }
      export function resolveMarkSelector() { return null; }
      export function resolveMarkTarget() { return null; }`,
    'arrow.js': `
      export function svgArrow() { return { setAttribute() {} }; }
      export function updateArrowGeometry() {}`,
    'dom.js': `
      export function geometryBatch(fn) { return fn(); }
      export function stageOrigin() { return [0, 0]; }`,
    'nav.js': `
      const c = globalThis.__bubbleTestCalls;
      export function openMark(n) { c.opened.push(n); }`,
    'schedule.js': `export function syncFrameResizeObservers() {}`,
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    const file = parent.endsWith('/bubbles.js') ? 'bubbles.js' : parent.endsWith('/render.js') ? 'render.js' : '';
    if (file && specifier.startsWith('./') && STUBS[file][specifier.slice(2)]) {
      return { url: 'stub:' + file + '/' + specifier.slice(2), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:')) {
      const slash = url.indexOf('/', 5);
      return { format: 'module', source: STUBS[url.slice(5, slash)][url.slice(slash + 1)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

function el(tag) {
  const node = {
    tag, className: '', id: '', hidden: false, text: '', children: [], parentNode: null,
    attrs: Object.create(null), listeners: Object.create(null), style: {},
  };
  node.setAttribute = (name, value) => { node.attrs[name] = String(value); };
  node.getAttribute = name => (name in node.attrs ? node.attrs[name] : null);
  node.appendChild = child => {
    child.parentNode = node;
    node.children.push(child);
    return child;
  };
  node.removeChild = child => {
    const at = node.children.indexOf(child);
    if (at >= 0) node.children.splice(at, 1);
    child.parentNode = null;
    return child;
  };
  node.addEventListener = (type, fn) => { (node.listeners[type] || (node.listeners[type] = [])).push(fn); };
  node.classList = {
    toggle(name, on) {
      const parts = node.className.split(/\s+/).filter(Boolean);
      const has = parts.includes(name);
      if (on && !has) parts.push(name);
      if (!on && has) parts.splice(parts.indexOf(name), 1);
      node.className = parts.join(' ');
      return on;
    },
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return node.text; },
    set(value) { node.text = String(value); },
  });
  Object.defineProperty(node, 'offsetHeight', { get() { return node.hidden ? 0 : 36; } });
  node.closest = () => node;
  node.remove = () => { if (node.parentNode) node.parentNode.removeChild(node); };
  return node;
}

const bubblesLayer = el('div');
bubblesLayer.id = 'ann-bubbles';
const stage = { id: 'wbstage', scrollLeft: 0, scrollTop: 0 };
globalThis.document = {
  createElement: () => el('div'),
  getElementById: id => (id === 'wbstage' ? stage : null),
  querySelector: () => null,
  documentElement: { getAttribute: () => null },
};
globalThis.window = { workbench: { boardMode: () => (stage.mode || 'canvas') } };
const timers = new Map();
let timerSeq = 0;
globalThis.setTimeout = (fn) => { const id = ++timerSeq; timers.set(id, fn); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
function runTimer(id) {
  const fn = timers.get(id);
  timers.delete(id);
  fn();
}

const bubbles = await import('./bubbles.js');
const render = await import('./render.js');

function mark(n, content) {
  return { n, type: 'element', content, status: 'open', screenId: 's', selector: '.x', targets: [{ selector: '.x' }] };
}

function install(list, canvas) {
  calls.opened = [];
  bubblesLayer.children = [];
  stage.mode = canvas ? 'canvas' : 'html';
  const ctx = {
    marks: list,
    renderComments: true,
    bubbleLayout: 'inline',
    canvasView: canvas ? { stage, width: 800, height: 600 } : null,
    bubblesLayer,
    bubbleNodes: null,
    markNodes: Object.create(null),
    overlay: { isConnected: true, getBoundingClientRect: () => ({ width: 800, height: 600 }) },
    chromeLayer: { isConnected: true },
    statusFilter: 'pending',
    activeComposer: null,
  };
  bubbles.bind_bubbles(ctx);
  render.bind_render(ctx);
  bubbles.init_bubbles();
  render.init_render();
  return ctx;
}

function cards() {
  return bubblesLayer.children.filter(node => node.className.split(/\s+/).includes('ann-bubble'));
}

function bodyOf(node) {
  return node.innerHTML;
}

test('画布无 hover / 定位时不建评论卡，三张标注也是 0 个节点', () => {
  const ctx = install([mark(1, '甲'), mark(2, '乙'), mark(3, '丙')], true);
  bubbles.syncBubbleStructure(ctx.marks);
  assert.equal(cards().length, 0);
  assert.deepEqual(Object.keys(ctx.bubbleNodes), []);
});

test('hover 只留下当前一张，换一张时旧卡离开 DOM，正文是这一条的', () => {
  const ctx = install([mark(1, '甲的正文'), mark(2, '乙的正文')], true);
  render.showBubbleFor(1, 120);
  runTimer(ctx.bubbleEnterT);
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].getAttribute('data-n'), '1');
  assert.ok(cards()[0].className.includes('ann-bubble--show'));
  assert.match(bodyOf(cards()[0]), /甲的正文/);

  render.showBubbleFor(2, 120);
  runTimer(ctx.bubbleEnterT);
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].getAttribute('data-n'), '2');
  assert.match(bodyOf(cards()[0]), /乙的正文/);
  assert.equal(bodyOf(cards()[0]).includes('甲的正文'), false);
});

test('没有悬停时定位出那一张；悬停优先，3 秒后交还给仍悬停的钉子', () => {
  const ctx = install([mark(1, '甲'), mark(2, '乙')], true);
  render.focusBubble(2);
  const focus = Math.max(...timers.keys());
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].getAttribute('data-n'), '2');

  render.showBubbleFor(1, 120);
  runTimer(ctx.bubbleEnterT);
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].getAttribute('data-n'), '1');

  runTimer(focus);
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].getAttribute('data-n'), '1');
  assert.equal(ctx.bubbleFocusN, null);
});

test('离开 90ms 后卡被拆掉；指针先移到卡上则继续留着', () => {
  const ctx = install([mark(1, '甲'), mark(2, '乙')], true);
  render.showBubbleFor(1, 120);
  runTimer(ctx.bubbleEnterT);
  const card = cards()[0];
  render.hideBubbleSoon();
  const leave = ctx.bubbleLeaveT;
  card.listeners.mouseenter[0]();
  assert.equal(timers.has(leave), false);
  assert.equal(cards().length, 1);
  assert.equal(cards()[0], card);

  render.hideBubbleSoon();
  runTimer(ctx.bubbleLeaveT);
  assert.equal(cards().length, 0);
  assert.equal(ctx.bubbleShowN, null);
});

test('点卡打开这一条；SSE 换成新对象后卡读新正文', () => {
  const ctx = install([mark(4, '旧正文')], true);
  render.showBubbleFor(4, 120);
  runTimer(ctx.bubbleEnterT);
  cards()[0].listeners.click[0]({ target: cards()[0], stopPropagation() {} });
  assert.deepEqual(calls.opened, [4]);

  const fresh = mark(4, '新正文');
  ctx.marks = [fresh];
  bubbles.syncBubbleStructure(ctx.marks);
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].getAttribute('data-n'), '4');
  assert.match(bodyOf(cards()[0]), /新正文/);
  assert.equal(ctx.bubbleNodes[4].m, fresh);
});

test('删除、筛选掉、正在编辑的草稿，画布上都不再留卡', () => {
  const editing = mark(7, '正在改');
  const closed = mark(8, '已完成');
  closed.status = 'close';
  const ctx = install([mark(6, '还在'), editing, closed], true);

  render.showBubbleFor(7, 120);
  runTimer(ctx.bubbleEnterT);
  assert.equal(cards().length, 1);

  ctx.marks = ctx.marks.filter(item => item.n !== 7);
  bubbles.syncBubbleStructure(render.visiblePageMarks());
  assert.equal(cards().length, 0);

  render.showBubbleFor(8, 120);
  runTimer(ctx.bubbleEnterT);
  assert.equal(cards().length, 0, 'pending 筛选不给 close 建卡');

  ctx.marks.push(editing);
  ctx.activeComposer = { m: { type: 'element' }, persistedN: 7 };
  render.showBubbleFor(7, 120);
  runTimer(ctx.bubbleEnterT);
  assert.equal(cards().length, 0, '草稿让位，不给正在编辑的那条建卡');
  ctx.activeComposer = null;
});

test('没有画布的实例仍为每条未损坏标注建卡，损坏的不建', () => {
  const broken = mark(3, '坏了');
  broken.targets = [];
  const ctx = install([mark(1, '甲'), mark(2, '乙'), broken], false);
  bubbles.syncBubbleStructure(render.visiblePageMarks());
  const nums = cards().map(node => node.getAttribute('data-n')).sort();
  assert.deepEqual(nums, ['1', '2']);
  assert.equal(cards().every(node => node.parentNode === bubblesLayer), true);
});
