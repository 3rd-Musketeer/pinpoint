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
      statusFilter: st.statusFilter || 'pending',
      connected: !!st.connected,
      syncError: !!st.syncError,
      count: st.count || 0,
      countLive: st.countLive || 0,
      countBroken: st.countBroken || 0,
      countClosed: st.countClosed || 0,
      countPending: st.countPending || 0,
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
 * 布局算法 SSOT：src/workbench/lib/annotate-bubble-layout.js packGutter。
 * 渲染是事件驱动的（perf 审计 A4，2026-09-24）：没有常驻 rAF，重算一律经
 * scheduleGutterRender（rAF 合并）安排，触发源——
 *   · iframe 文档滚动 / 舞台内滚动：capture 监听（前者挂 iframe document，
 *     跨 frame 不冒泡；后者挂 stage-wrap，盖住 .wb-stage 平移）
 *   · iframe / 舞台尺寸变化：ResizeObserver（手机视口的缩放是 transform，
 *     RO 看不见，但它只随窗口 resize 变，舞台盒子同帧跟着变，仍被盖住）
 *   · iframe 文档里晚到的资源：document 上 load 的 capture 监听 + document.fonts
 *     的 loadingdone。图片 / 字体落定尺寸引起的布局位移既不改 iframe 元素的盒子
 *     （RO 看不见）、不是滚动、也不一定有 DOM mutation，只有资源自己的事件知道；
 *     load 不冒泡但能被 capture 到。旧实现的常驻 rAF 是每帧重算才「自然跟上」的，
 *     这类信号是事件化后唯一补不回来的盲区，专门挂这两条
 *   · 账本 / 筛选 / 布局 / 评论开关：annotate 实例 notify → 快照订阅
 *     （syncAnnSnap 收尾的 syncGutterComments）；iframe 内 DOM 变更走同一条
 *     —— client 的 MutationObserver 全量重渲染路径本身就会 notify
 *   · 备注展开 / 收起：gutter 气泡的点击委派
 * 渲染是增量的：气泡节点按 n 复用，内容没变只重排定位、不重建 innerHTML。
 * 监听登记全部在 stopGutter 解除，切页 / 关通道 / 条目卸载不留悬挂。 */
var gutterOverlay = null;
var gutterBubblesEl = null;
var gutterRaf = 0;
// 复用的气泡节点：String(n) → {node, html, left, top, height}。html 是
// bubbleInnerHtml 的产物，相同 = 内容没变，跳过重建与高度重测。
var gutterNodes = Object.create(null);
// agent 备注折叠头的展开态（本次页面内存，不落盘）：节点复用后展开态本可留在
// DOM 里，但内容重建（正文 / 筛选变更）会冲掉，仍挂模块级等重建时拼回去。
var gutterNotesOpen = Object.create(null);   // String(n) → true
// 事件监听登记：滚动挂文档（capture，任意深度的滚动容器都算），尺寸挂
// ResizeObserver。只在 gutter 开着时挂；stopGutter 全部解除。
var gutterScrollDoc = null;      // 挂了 scroll 监听的 iframe Document
var gutterWrapEl = null;         // 挂了 scroll 监听的舞台 wrap
var gutterResizeObs = null;
var gutterObservedFrame = null;  // RO 正在观察的 iframe 元素

// e2e 观测点（perf 审计 A4）：requests = 重算排程次数（断言监听不重复挂），
// renders = 实际渲染次数（断言页面静止时零渲染）。只供 e2e 用例读，生产代码
// 不读、行为也不依赖它。它只出现在 workbench 页面上：本模块不进注入端 bundle
// （/annotate.js 只内联 src/shared 与 src/client/lib，清单见
// src/server/annotate-api.js 的 INLINED_LIBS），/sites/ 注入页的 window 没有它。
window.__wbGutter = { requests: 0, renders: 0 };

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
    + '#wb-ann-gutter .ann-bubble{position:absolute;width:' + GUTTER_BUBBLE_W + 'px;background:var(--wb-surface,#fff);'
    + 'border:0;border-radius:10px;box-shadow:var(--wb-sh-2,0 4px 14px rgba(35,44,66,.10));'
    + 'font:13px/1.55 var(--sans,system-ui,sans-serif);color:var(--wb-fg,#232C42);pointer-events:auto;cursor:pointer;}'
    + '#wb-ann-gutter .ann-bubble:hover{box-shadow:var(--wb-sh-3,0 6px 18px rgba(35,44,66,.16));}'
    + '.wb-stage-wrap[data-ann-gutter="on"]{padding-right:' + GUTTER_W + 'px;}'
    + '.wb-stage-wrap[data-ann-gutter="on"] .wb-stage{overflow:auto;}';
  gutterBubblesEl = document.createElement('div');
  gutterBubblesEl.style.cssText = 'position:absolute;inset:0;';
  gutterOverlay.appendChild(style);
  gutterOverlay.appendChild(gutterBubblesEl);
  wrap.appendChild(gutterOverlay);
  // 委派点击：点气泡打开该标注（驱动 iframe 实例）；点备注折叠头 = 展开 / 收起，
  // 不打开标注（与画布卡同一条规矩：composer 只归卡身其余部分）。
  gutterBubblesEl.addEventListener('click', function (e) {
    var b = e.target.closest('.ann-bubble');
    if (!b) return;
    var n = b.getAttribute('data-n');
    if (e.target.closest('.ann-bubble-note-head')) {
      var key = String(n);
      if (gutterNotesOpen[key]) delete gutterNotesOpen[key];
      else gutterNotesOpen[key] = true;
      scheduleGutterRender();
      return;
    }
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
  window.__wbGutter.renders++;
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
  // bubbleLeft = wrap width - bubble - margin（live gutter is inside the padded
  // wrap; export uses docW + margin）。单列右贴边，一次渲染内 left 恒定。
  var bubbleLeft = wrapRect.width - GUTTER_BUBBLE_W - GUTTER_MARGIN;
  var anchors = a.visibleBubbleAnchors();
  // 展开备注的滚动位置只有内容重建会冲掉（复用的节点原生保留 scrollTop）：
  // 重建前把展开中的原文滚到哪记下来，重建后拼回去。
  var keptNoteScroll = Object.create(null);
  Array.prototype.forEach.call(gutterBubblesEl.querySelectorAll('.ann-bubble-note-body'), function (el) {
    var host = el.closest('.ann-bubble');
    if (host && el.scrollTop) keptNoteScroll[host.getAttribute('data-n')] = el.scrollTop;
  });

  // Pass 1: 复用 / 重建节点（只写不读）。html 没变的不碰 innerHTML、不重测高度
  // —— 定位更新（滚动 / 挪位）因此不付每个气泡一次回流的代价。
  var present = Object.create(null);
  var remeasure = [];
  var mapped = [];
  anchors.forEach(function (an) {
    present[an.n] = true;
    var noteOpen = !!gutterNotesOpen[String(an.n)];
    var html = bubbleInnerHtml(
      { n: an.n, cap: an.cap, content: an.content, note: an.note },
      { noteExpanded: noteOpen }
    );
    var entry = gutterNodes[an.n];
    if (!entry) {
      var node = document.createElement('div');
      node.className = 'ann-bubble';
      node.setAttribute('data-ann-ui', '');
      node.setAttribute('data-n', an.n);
      node.style.left = bubbleLeft + 'px';
      node.style.top = '0';
      gutterBubblesEl.appendChild(node);
      entry = gutterNodes[an.n] = { node: node, html: '', left: bubbleLeft, top: 0, height: 0 };
    }
    if (entry.left !== bubbleLeft) {
      entry.left = bubbleLeft;
      entry.node.style.left = bubbleLeft + 'px';
    }
    if (entry.html !== html) {
      entry.node.innerHTML = html;
      entry.html = html;
      if (noteOpen) {
        var noteBody = entry.node.querySelector('.ann-bubble-note-body');
        if (noteBody && keptNoteScroll[String(an.n)]) noteBody.scrollTop = keptNoteScroll[String(an.n)];
      }
      entry.height = 0;
      remeasure.push(entry);
    }
    mapped.push({
      n: an.n,
      rect: [dx + an.rect[0] * k, dy + an.rect[1] * k, an.rect[2] * k, an.rect[3] * k],
    });
  });
  // 不在场的（筛选切走 / 删除 / 滚出视口）节点摘掉。
  Object.keys(gutterNodes).forEach(function (n) {
    if (present[n]) return;
    gutterNodes[n].node.remove();
    delete gutterNodes[n];
  });
  // 重建过的才重测高度：写在读后，一批重建只付一次回流（packGutter is pure）。
  remeasure.forEach(function (entry) { entry.height = entry.node.offsetHeight || 60; });
  var heights = Object.create(null);
  anchors.forEach(function (an) { heights[an.n] = gutterNodes[an.n].height; });

  // Pass 2: pack + 定位。宽度固定（CSS 钉 240px），top 变了才写样式。
  var packed = packGutter(mapped, heights, { bubbleLeft: bubbleLeft, bubbleW: GUTTER_BUBBLE_W });
  packed.forEach(function (p) {
    var entry = gutterNodes[p.n];
    if (!entry || entry.top === p.top) return;
    entry.top = p.top;
    entry.node.style.top = p.top + 'px';
  });
}

function scheduleGutterRender() {
  window.__wbGutter.requests++;
  if (gutterRaf) return;
  gutterRaf = requestAnimationFrame(function () {
    gutterRaf = 0;
    if (!gutterActive()) { stopGutter(); return; }
    renderGutter();
  });
}

function onGutterSignal() { scheduleGutterRender(); }

/** iframe document 上的 gutter 事件面：滚动 + 晚到资源（load capture、字体
 *  loadingdone）。换 document 时整套挪挂，由 attachGutterListeners / detach
 *  共用，保证两条路径解得一样干净。 */
function detachDocListeners(doc) {
  doc.removeEventListener('scroll', onGutterSignal, true);
  doc.removeEventListener('load', onGutterSignal, true);
  if (doc.fonts) doc.fonts.removeEventListener('loadingdone', onGutterSignal);
}

/** gutter 开着期间的事件面：iframe 文档滚动与晚到资源（换 document 时挪挂，
 *  不叠层）、舞台滚动（capture 盖 .wb-stage 平移）、iframe 与舞台的尺寸变化。 */
function attachGutterListeners() {
  var iframeEl = activeDocFrameEl();
  if (!iframeEl) return;
  var doc = null;
  try { doc = iframeEl.contentDocument; } catch (e) { /* 跨域防御（本设计全同源，不会走到） */ }
  if (doc && gutterScrollDoc !== doc) {
    if (gutterScrollDoc) detachDocListeners(gutterScrollDoc);
    doc.addEventListener('scroll', onGutterSignal, { capture: true, passive: true });
    // load 不冒泡，capture 才接得到资源级 load（img / iframe…）；连 document
    // 自己的 load 也会从这里过，多排一次渲染，无妨。字体落定走 loadingdone
    // （旧引擎没有 document.fonts 就跳过）。渲染读矩形时强制同步布局，拿到的
    // 就是落定后的几何，不用再等一拍。
    doc.addEventListener('load', onGutterSignal, true);
    if (doc.fonts) doc.fonts.addEventListener('loadingdone', onGutterSignal);
    gutterScrollDoc = doc;
  }
  var wrap = gutterStageWrap();
  if (wrap && gutterWrapEl !== wrap) {
    if (gutterWrapEl) gutterWrapEl.removeEventListener('scroll', onGutterSignal, true);
    wrap.addEventListener('scroll', onGutterSignal, { capture: true, passive: true });
    gutterWrapEl = wrap;
  }
  if (typeof ResizeObserver !== 'function') return;
  if (!gutterResizeObs) {
    gutterResizeObs = new ResizeObserver(onGutterSignal);
    if (wrap) gutterResizeObs.observe(wrap);
  }
  if (gutterObservedFrame !== iframeEl) {
    if (gutterObservedFrame) gutterResizeObs.unobserve(gutterObservedFrame);
    gutterResizeObs.observe(iframeEl);
    gutterObservedFrame = iframeEl;
  }
}

function detachGutterListeners() {
  if (gutterScrollDoc) {
    detachDocListeners(gutterScrollDoc);
    gutterScrollDoc = null;
  }
  if (gutterWrapEl) {
    gutterWrapEl.removeEventListener('scroll', onGutterSignal, true);
    gutterWrapEl = null;
  }
  if (gutterResizeObs) { gutterResizeObs.disconnect(); gutterResizeObs = null; }
  gutterObservedFrame = null;
}

/* 启停的 DOM 写出必须幂等：syncGutterComments 挂在快照订阅上，每次快照都会
 * 走到。无脑 setAttribute / 置 display 会喂出一条自持循环 —— 同值属性变更被
 * 父级 annotate 实例的 MutationObserver 当内容变更 → renderAll + notify →
 * onUpdate → 快照 → startGutter → 又一次同值写……（旧实现的常驻循环里那条
 * 「无标注也满帧率空转」就是这么被喂起来的）。 */
function startGutter() {
  ensureGutterOverlay();
  var wrap = gutterStageWrap();
  if (wrap && wrap.getAttribute('data-ann-gutter') !== 'on') wrap.setAttribute('data-ann-gutter', 'on');
  if (gutterOverlay && gutterOverlay.style.display !== '') gutterOverlay.style.display = '';
  attachGutterListeners();
  scheduleGutterRender();
}

export function stopGutter() {
  if (gutterRaf) { cancelAnimationFrame(gutterRaf); gutterRaf = 0; }
  detachGutterListeners();
  var wrap = gutterStageWrap();
  if (wrap && wrap.hasAttribute('data-ann-gutter')) wrap.removeAttribute('data-ann-gutter');
  if (gutterOverlay && gutterOverlay.style.display !== 'none') gutterOverlay.style.display = 'none';
  gutterNodes = Object.create(null);
  if (gutterBubblesEl && gutterBubblesEl.firstChild) {
    while (gutterBubblesEl.firstChild) gutterBubblesEl.removeChild(gutterBubblesEl.firstChild);
  }
}

/** 由侧栏更新路径与 board 切换调用：按当前状态启停 gutter。快照每次更新都会
 *  走到这里 —— gutter 开着时它同时是账本 / 筛选 / 布局变化的渲染触发点。 */
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
  // gutter 开着时 iframe（重）载入 / 换条目，滚动监听要挪到新 document 上。
  if (gutterActive()) attachGutterListeners();
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
