// Workbench 标注桥簇 — annotate API 解析（父窗口 vs iframe 实例）、gutter 评论
// 气泡（文档条目形态 sidebar 布局）、文档标注绑定、连接状态指示、标注状态快照。
// P1a 从 workbench.js 平移；P1b 起标注面板 React 化（2026-09-04 起 = 弹出列表
// app/AnnPopover.jsx），
// 面板要读的状态由本模块汇成 annSnap 写进 store，不再有面板侧 DI。
// 2026-08-16f 阶段 6：「文档形态」判定从页级 mode 改为选中条目派生
// （store.activeBoardMode()）—— 混合板里选中 doc 屏条目时同一套 iframe 绑定
// 与 gutter 逻辑照常生效。
import { wbGet, wbSet } from './app/store.js';
import { annRowModel } from '../shared/ann-row.js';
import { bubbleInnerHtml } from '../shared/annotate-bubble.js';
import { GUTTER_BUBBLE_W, GUTTER_MARGIN, GUTTER_W, packGutter } from './lib/annotate-bubble-layout.js';

/* ---- annotate API resolver -------------------------------------------------
   文档条目的文档活在 iframe 里，它自己注入 annotate.js，于是页面上同时存在两个
   互不相通的标注实例：父窗口（侧栏按钮驱动）和 iframe（文档本体）。侧栏点「标注」
   只切到了父窗口那个，画不出框 —— 表现成「侧栏和右下角没对齐」。
   侧栏是唯一控制面，所以取用时按当前选中条目解析到正确的那个实例。 */
/* 舞台上此刻可见的那个文档 iframe（2026-09-05 起不看形态看可见性）：窗口视口下它
   1:1 铺满舞台，手机视口下它装在缩过的手机屏里，两种情况标注实例都是它自己的；
   画布条目态 doc 屏全部 data-doc-hidden，这里得 null → 回落父窗口实例。 */
function activeDocFrameEl() {
  var panel = document.getElementById('wb-board-panel');
  if (!panel) return null;
  return panel.querySelector('.wb-screen:not([data-doc-hidden]) .wb-doc-frame');
}

function activeDocWindow() {
  var frame = activeDocFrameEl();
  if (!frame) return null;
  try {
    var w = frame.contentWindow;
    return w && w.pinpoint ? w : null;     // 跨域时读 contentWindow 会抛
  } catch (e) {
    return null;
  }
}

export function annotateApi() {
  var docWin = activeDocWindow();
  return (docWin && docWin.pinpoint) || window.pinpoint;
}

/* ---- 标注状态快照（annSnap）------------------------------------------------
   React 标注列表（app/AnnPopover.jsx）只读 store 里的 annSnap：annotate 实例
   状态 + pageMarks 行模型在这里汇成一份纯数据，onUpdate 突发经 rAF 合并。
   行字段走共享 src/shared/ann-row.js（cap/preview/broken/tags）；grouping 键是
   workbench 本地语义。cap 选项钉住 workbench 措辞：region 行显示「框选」，
   不做 selector 摘录回退。 */
function markSummary(m, ann) {
  var body = (m && m.content) || '';
  if (body) {
    if (ann && typeof ann.contentToDisplay === 'function') return ann.contentToDisplay(body, m.targets || []);
    return body;
  }
  if (m.type === 'region') return '框选区域';
  if (m.text) return m.text.slice(0, 60);
  return m.selector || '';
}

var ANN_SNAP_OFF = { available: false, rows: [] };
var annRowCache = new Map();
var annRowOwner = null;

export function syncAnnSnap() {
  var ann = annotateApi();
  if (!ann || typeof ann.getState !== 'function') {
    annRowCache.clear(); annRowOwner = null;
    wbSet({ annSnap: ANN_SNAP_OFF });
    return;
  }
  var st = ann.getState();
  if (annRowOwner !== ann) { annRowOwner = ann; annRowCache.clear(); }
  var referenceVersion;
  var previousRows = annRowCache;
  annRowCache = new Map();
  var rows = (ann.pageMarks || []).slice().sort(function (a, b) { return a.n - b.n; }).map(function (m) {
    var broken = typeof ann.isMarkBroken === 'function' ? ann.isMarkBroken(m) : false;
    var signature = JSON.stringify(m) + '|' + broken;
    var rowReferenceVersion = null;
    if ((m.mentions && m.mentions.length) || /\[@a:/.test(m.content || m.comment || '')) {
      if (referenceVersion === undefined) referenceVersion = JSON.stringify((ann.marks || []).map(function (m) { return [m.id, m.n]; }));
      rowReferenceVersion = referenceVersion;
    }
    var cached = previousRows.get(m.n);
    if (cached && cached.signature === signature && cached.referenceVersion === rowReferenceVersion) { annRowCache.set(m.n, cached); return cached.row; }
    var row = annRowModel(m, {
      cap: { region: '框选', selectorMax: 0 },
      preview: markSummary(m, ann),
      broken: broken
    });
    row.key = (m.section || m.group || '_') + '|' + m.n;
    row.group = m.section || m.group || '_';
    row.groupLabel = m.sectionLabel || m.groupLabel || '未分组';
    // screenId 供左栏「内容」区 frame 树计数徽标与右栏按 frame 分组消费
    // （2026-08-15 侧栏重构；阶段 7 大纲收编为 frame 树）；
    // 引用号/屏名不落行模型 —— 渲染侧从 activeBoard 纯派生（lib/board-refs.js）。
    row.screenId = m.screenId || '';
    annRowCache.set(m.n, { signature: signature, referenceVersion: rowReferenceVersion, row: row });
    return row;
  });
  wbSet({
    annSnap: {
      available: true,
      mode: !!st.mode,
      paused: !!st.paused,
      floating: !!st.floating,
      renderComments: !!st.renderComments,
      bubbleLayout: st.bubbleLayout || 'inline',
      // 状态筛选 SSOT 在 annotate 实例（setStatusFilter 落 LS，按页保留）；
      // 实例切换（切页 / iframe 重载）后弹层从这里读回当前值。
      statusFilter: st.statusFilter || 'all',
      connected: !!st.connected,
      syncError: !!st.syncError,
      count: st.count || 0,
      countLive: st.countLive || 0,
      countBroken: st.countBroken || 0,
      countInvalid: st.countInvalid || 0,
      rows: rows
    }
  });
  // G=画布外 模式：按当前状态启停父级 gutter 渲染。
  syncGutterComments();
}

// onUpdate 突发（persist + SSE + scroll-spy）合并成一帧一次快照。
var annSnapRaf = 0;
export function scheduleAnnSnap() {
  if (annSnapRaf) return;
  annSnapRaf = requestAnimationFrame(function () {
    annSnapRaf = 0;
    syncAnnSnap();
  });
}

/* 父窗口的 annotate.js 异步加载；轮询到它出现后订阅一次并产出首份快照。
   iframe 实例的绑定见 watchDocAnnotate / bindDocAnnotate。 */
export function startAnnBridge() {
  if (!window.pinpoint) { setTimeout(startAnnBridge, 100); return; }
  if (typeof window.pinpoint.onUpdate === 'function') window.pinpoint.onUpdate(scheduleAnnSnap);
  scheduleAnnSnap();
}

/* ---------- Gutter 评论（sidebar）：气泡渲染在父级 workbench 右侧 gutter ----------
 * iframe 收窄腾出 gutter，文档按自己的响应式回流；气泡/连线在父级 overlay 里，
 * 锚点用 iframe.getBoundingClientRect() 跨 frame 映射。只在文档条目形态生效。
 * 布局算法 SSOT：src/workbench/lib/annotate-bubble-layout.js packGutter。 */
var gutterOverlay = null;
var gutterBubblesEl = null;
var gutterRaf = 0;

function gutterStageWrap() {
  return document.querySelector('.wb-stage-wrap');
}

function ensureGutterOverlay() {
  if (gutterOverlay) return;
  var wrap = gutterStageWrap();
  if (!wrap) return;
  gutterOverlay = document.createElement('div');
  gutterOverlay.id = 'wb-ann-gutter';
  gutterOverlay.setAttribute('data-ann-ui', '');
  gutterOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:var(--wb-z-panel);display:none;';
  var style = document.createElement('style');
  style.setAttribute('data-ann-ui', '');
  style.textContent = ''
    + '#wb-ann-gutter .ann-bubble{position:absolute;width:' + GUTTER_BUBBLE_W + 'px;background:#fff;'
    + 'border:0;border-radius:10px;box-shadow:0 4px 14px rgba(35,44,66,.10);'
    + 'font:13px/1.55 var(--sans,system-ui,sans-serif);color:#232C42;pointer-events:auto;cursor:pointer;}'
    + '#wb-ann-gutter .ann-bubble:hover{box-shadow:0 6px 18px rgba(35,44,66,.16);}'
    + '.wb-stage-wrap[data-ann-gutter="on"]{padding-right:' + GUTTER_W + 'px;}'
    + '.wb-stage-wrap[data-ann-gutter="on"] .wb-stage{overflow:auto;}';
  gutterBubblesEl = document.createElement('div');
  gutterBubblesEl.style.cssText = 'position:absolute;inset:0;';
  gutterOverlay.appendChild(style);
  gutterOverlay.appendChild(gutterBubblesEl);
  wrap.appendChild(gutterOverlay);
  // 委派点击：点气泡打开该标注（驱动 iframe 实例）。
  gutterBubblesEl.addEventListener('click', function (e) {
    var b = e.target.closest('.ann-bubble');
    if (!b) return;
    var n = b.getAttribute('data-n');
    var a = annotateApi();
    if (a && typeof a.openMark === 'function') a.openMark(n);
  });
}

function gutterActive() {
  var a = annotateApi();
  if (!a || typeof a.getState !== 'function') return false;
  var st = a.getState();
  return !!(st && st.renderComments && st.bubbleLayout === 'sidebar' && activeDocFrameEl());
}

function renderGutter() {
  var a = annotateApi();
  if (!a || typeof a.visibleBubbleAnchors !== 'function') return;
  var wrap = gutterStageWrap();
  var iframeEl = activeDocFrameEl();
  if (!wrap || !iframeEl) return;
  ensureGutterOverlay();
  var wrapRect = wrap.getBoundingClientRect();
  var ifRect = iframeEl.getBoundingClientRect();
  var dx = ifRect.left - wrapRect.left;
  var dy = ifRect.top - wrapRect.top;
  // 手机视口（2026-09-05）：iframe 随 .wb-phone-doc 的 transform: scale(k) 缩放
  // （pages.js syncPhoneDocScale），锚点 rect 是 iframe 自己的 CSS px，映射到父级前
  // 按「显示宽 / 布局宽」缩一次 —— 这个比就是 k；窗口视口下是 1。
  var k = iframeEl.offsetWidth ? ifRect.width / iframeEl.offsetWidth : 1;
  var anchors = a.visibleBubbleAnchors();
  while (gutterBubblesEl.firstChild) gutterBubblesEl.removeChild(gutterBubblesEl.firstChild);

  // Pass 1: build hidden bubbles + measure heights (packGutter is pure).
  var mapped = [];
  var heights = Object.create(null);
  var nodes = Object.create(null);
  anchors.forEach(function (an) {
    var node = document.createElement('div');
    node.className = 'ann-bubble';
    node.setAttribute('data-ann-ui', '');
    node.setAttribute('data-n', an.n);
    node.innerHTML = bubbleInnerHtml({ n: an.n, cap: an.cap, content: an.content });
    node.style.visibility = 'hidden';
    node.style.left = '0';
    node.style.top = '0';
    node.style.width = GUTTER_BUBBLE_W + 'px';
    gutterBubblesEl.appendChild(node);
    heights[an.n] = node.offsetHeight || 60;
    nodes[an.n] = node;
    mapped.push({
      n: an.n,
      rect: [dx + an.rect[0] * k, dy + an.rect[1] * k, an.rect[2] * k, an.rect[3] * k],
    });
  });

  // Pass 2: pack + position. bubbleLeft = wrap width - bubble - margin
  // (live gutter is inside the padded wrap; export uses docW + margin).
  // No connector lines — bubble numbers match pin badges.
  var wrapW = wrapRect.width;
  var bubbleLeft = wrapW - GUTTER_BUBBLE_W - GUTTER_MARGIN;
  var packed = packGutter(mapped, heights, { bubbleLeft: bubbleLeft, bubbleW: GUTTER_BUBBLE_W });
  packed.forEach(function (p) {
    var node = nodes[p.n];
    if (!node) return;
    node.style.visibility = '';
    node.style.left = p.left + 'px';
    node.style.top = p.top + 'px';
    node.style.width = p.width + 'px';
  });
}

function gutterTick() {
  gutterRaf = 0;
  if (!gutterActive()) { stopGutter(); return; }
  renderGutter();
  gutterRaf = requestAnimationFrame(gutterTick);
}

function startGutter() {
  ensureGutterOverlay();
  var wrap = gutterStageWrap();
  if (wrap) wrap.setAttribute('data-ann-gutter', 'on');
  if (gutterOverlay) gutterOverlay.style.display = '';
  if (!gutterRaf) gutterRaf = requestAnimationFrame(gutterTick);
}

export function stopGutter() {
  if (gutterRaf) { cancelAnimationFrame(gutterRaf); gutterRaf = 0; }
  var wrap = gutterStageWrap();
  if (wrap) wrap.removeAttribute('data-ann-gutter');
  if (gutterOverlay) gutterOverlay.style.display = 'none';
  if (gutterBubblesEl) while (gutterBubblesEl.firstChild) gutterBubblesEl.removeChild(gutterBubblesEl.firstChild);
}

/** 由侧栏更新路径与 board 切换调用：按当前状态启停 gutter。 */
export function syncGutterComments() {
  if (gutterActive()) startGutter();
  else stopGutter();
}

// 每个 iframe 实例只订阅一次，否则每次 loadBoard 都会叠一层监听
var docAnnotateSeen = typeof WeakSet === 'function' ? new WeakSet() : null;
function bindDocAnnotate() {
  var docWin = activeDocWindow();
  if (!docWin) return false;
  var ann = docWin.pinpoint;
  if (docAnnotateSeen && !docAnnotateSeen.has(ann)) {
    docAnnotateSeen.add(ann);
    if (typeof ann.onUpdate === 'function') ann.onUpdate(scheduleAnnSnap);
  }
  scheduleAnnSnap();
  return true;
}

/* iframe 里的 annotate.js 是文档自己异步注入的，board 挂载完时通常还没就绪。
   持续轮询（html 形态期间恒在）：出现后订阅一次，侧栏面板即刻反映文档的标注
   状态；iframe 重载（HMR / 手动 src 刷新）后客户端是新实例，ann !== bound
   触发重绑——旧实现绑一次就停，重载后订阅挂在死实例上，面板不再更新
   （2026-08-17 debugging 案例）。 */
var docAnnotateWatch = 0;
var docAnnotateBound = null;
export function watchDocAnnotate() {
  if (docAnnotateWatch) { clearInterval(docAnnotateWatch); docAnnotateWatch = 0; }
  docAnnotateBound = null;
  // 2026-09-05：判据从「html 形态」改成「画布上有可见的文档 iframe」—— 手机视口
  // 下形态是 ios，文档照样活在 iframe 里，绑定与快照一样要跟着它。
  if (!activeDocFrameEl()) return;
  docAnnotateWatch = setInterval(function () {
    if (!activeDocFrameEl()) {
      clearInterval(docAnnotateWatch);
      docAnnotateWatch = 0;
      docAnnotateBound = null;
      return;
    }
    var docWin = activeDocWindow();
    var ann = docWin && docWin.pinpoint;
    if (ann && ann !== docAnnotateBound) {
      bindDocAnnotate();
      docAnnotateBound = ann;
    }
  }, 250);
}

/* 连接状态指示（#wbconn）由 Sidebar 的 SideHead 从 annSnap.connected/syncError
   派生 —— 本模块不再有 DOM 写出点。 */
