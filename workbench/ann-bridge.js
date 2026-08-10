// Workbench 标注桥簇 — annotate API 解析（父窗口 vs iframe 实例）、gutter 评论
// 气泡（HTML 板 sidebar 布局）、文档标注绑定、连接状态指示。
// P1a 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
import { wbGet } from './app/store.js';
import { bubbleInnerHtml } from '../lib/annotate-bubble.js';
import { GUTTER_BUBBLE_W, GUTTER_MARGIN, GUTTER_W, packGutter } from './lib/annotate-bubble-layout.js';

// 反向依赖注入：scheduleAnnPanel 属标注面板簇（P1b 直接 React 化，不经历中间形态，
// 留在 workbench.js），ann-bridge 不得 import workbench.js，由它初始化时注入。
var bridgeDeps = {};

export function initAnnBridge(deps) {
  bridgeDeps = deps || {};
}

/* ---- annotate API resolver -------------------------------------------------
   HTML 板的文档活在 iframe 里，它自己注入 annotate.js，于是页面上同时存在两个
   互不相通的标注实例：父窗口（侧栏按钮驱动）和 iframe（文档本体）。侧栏点「标注」
   只切到了父窗口那个，画不出框 —— 表现成「侧栏和右下角没对齐」。
   侧栏是唯一控制面，所以取用时按当前板解析到正确的那个实例。 */
function activeDocWindow() {
  var panel = document.getElementById('wb-board-panel');
  if (wbGet().boardMode !== 'html' || !panel) return null;
  var frame = panel.querySelector('.wb-screen:not([data-doc-hidden]) .wb-doc-frame');
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

/* ---------- Gutter 评论（sidebar）：气泡渲染在父级 workbench 右侧 gutter ----------
 * iframe 收窄腾出 gutter，文档按自己的响应式回流；气泡/连线在父级 overlay 里，
 * 锚点用 iframe.getBoundingClientRect() 跨 frame 映射。只在 HTML 板生效。
 * 布局算法 SSOT：lib/annotate-bubble-layout.js packGutter。 */
var gutterOverlay = null;
var gutterBubblesEl = null;
var gutterRaf = 0;

function gutterStageWrap() {
  return document.querySelector('.wb-stage-wrap');
}
function gutterIframeEl() {
  var panel = document.getElementById('wb-board-panel');
  if (wbGet().boardMode !== 'html' || !panel) return null;
  return panel.querySelector('.wb-screen:not([data-doc-hidden]) .wb-doc-frame');
}

function ensureGutterOverlay() {
  if (gutterOverlay) return;
  var wrap = gutterStageWrap();
  if (!wrap) return;
  gutterOverlay = document.createElement('div');
  gutterOverlay.id = 'wb-ann-gutter';
  gutterOverlay.setAttribute('data-ann-ui', '');
  gutterOverlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;display:none;';
  var style = document.createElement('style');
  style.setAttribute('data-ann-ui', '');
  style.textContent = ''
    + '#wb-ann-gutter .ann-bubble{position:absolute;width:' + GUTTER_BUBBLE_W + 'px;background:#fff;'
    + 'border:1px solid rgba(35,44,66,.14);border-radius:10px;box-shadow:0 4px 14px rgba(35,44,66,.10);'
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
  return !!(st && st.renderComments && st.bubbleLayout === 'sidebar' && wbGet().boardMode === 'html');
}

function renderGutter() {
  var a = annotateApi();
  if (!a || typeof a.visibleBubbleAnchors !== 'function') return;
  var wrap = gutterStageWrap();
  var iframeEl = gutterIframeEl();
  if (!wrap || !iframeEl) return;
  ensureGutterOverlay();
  var wrapRect = wrap.getBoundingClientRect();
  var ifRect = iframeEl.getBoundingClientRect();
  var dx = ifRect.left - wrapRect.left;
  var dy = ifRect.top - wrapRect.top;
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
    node.innerHTML = bubbleInnerHtml({ n: an.n, content: an.content });
    node.style.visibility = 'hidden';
    node.style.left = '0';
    node.style.top = '0';
    node.style.width = GUTTER_BUBBLE_W + 'px';
    gutterBubblesEl.appendChild(node);
    heights[an.n] = node.offsetHeight || 60;
    nodes[an.n] = node;
    mapped.push({
      n: an.n,
      rect: [dx + an.rect[0], dy + an.rect[1], an.rect[2], an.rect[3]],
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
    if (typeof ann.onUpdate === 'function') ann.onUpdate(bridgeDeps.scheduleAnnPanel);
  }
  bridgeDeps.scheduleAnnPanel();
  return true;
}

/* iframe 里的 annotate.js 是文档自己异步注入的，board 挂载完时通常还没就绪。
   轮询到它出现为止（上限 ~4s），出现后订阅一次，侧栏面板即刻反映文档的标注状态。 */
var docAnnotateWatch = 0;
export function watchDocAnnotate() {
  if (docAnnotateWatch) { clearInterval(docAnnotateWatch); docAnnotateWatch = 0; }
  if (wbGet().boardMode !== 'html') return;
  var tries = 0;
  docAnnotateWatch = setInterval(function () {
    if (bindDocAnnotate() || ++tries > 40) {
      clearInterval(docAnnotateWatch);
      docAnnotateWatch = 0;
    }
  }, 100);
}

export function syncConnStatus() {
  var el = document.getElementById('wbconn');
  if (!el) return;
  var ann = annotateApi();
  var st = ann && typeof ann.getState === 'function' ? ann.getState() : null;
  var on = !!(st && st.connected);
  var syncErr = !!(st && st.syncError);
  var label = el.querySelector('.wb-conn-label');
  el.setAttribute('data-state', on ? 'online' : 'offline');
  if (label) label.textContent = on ? '已连接' : '未连接';
  el.title = on
    ? (syncErr ? '已连接 · 上次同步失败' : '标注服务已连接')
    : '标注服务未连接（请运行 npm run dev）';
}
