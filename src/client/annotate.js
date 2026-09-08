/* pinpoint: Figma-style HTML annotate tool.
 * Browser annotation client. Served as /annotate.js by Vite annotate-api;
 * ios-kit.js injects it on localhost.
 * Anchors use CSS selectors; coords are secondary (scale-safe).
 * SSOT = ~/.pinpoint/<entry>/; localStorage is cache; SSE /events syncs browsers.
 * Modes: 标注 (click → box) | 交互 (demo; default). Text selection stays enabled in 交互.
 * Hierarchy: page → canvas → section → frame (screen + chrome). screenId = frame id.
 * Disk shape: annotations[] with content / section / sectionLabel / screenId / pageId.
 * Indicators: @page: @section: @frame: @a:; local target refs in content use [@t:iN].
 * Overlay mounts inside .wb-stage-wrap (not over the sidebar).
 * 阶段 5：doc 页 data-pinpoint-frame 挂载点水合为活 frame iframe（/api/frame），
 * frame 内标注与画布同账本（注入 __pinpointFrame/__pinpointLedger），锚点按
 * frame 内路径归一（src/shared/frame-anchor.js），模式开关向 frame iframe 级联。 */
(function () {
  'use strict';
  if (window.__pinpoint) return;
  window.__pinpoint = true;
  // 启动就绪标记：扩展 content script 的自愈路径据此判断主世界 client 已装好
  // pinpoint:command 监听（见 extension/content.js）。IIFE 同步执行到底，标记
  // 打在最前面即可——任何后续的 DOM 事件派发都排在本脚本求值之后。
  // 抑制标记同理：workbench 壳/被嵌入页的标注控制面在壳上，content script 的
  // 点击反馈据此区分「壳页」与「client 过旧」（sidebarSuppressed 是函数声明，
  // 提升到 IIFE 顶部，此时可调）。
  if (document.documentElement) {
    document.documentElement.setAttribute('data-pinpoint-client', '1');
    if (sidebarSuppressed()) document.documentElement.setAttribute('data-pinpoint-sidebar', 'suppressed');
  }

  var SERVER = (function () {
    var src = document.currentScript && document.currentScript.src;
    if (src) { try { return new URL(src).origin; } catch (e) {} }
    return '';
  })();
  // Registry entry this page annotates under. Sources, in order: page-world
  // global (same-origin injectors), then the <html data-pinpoint-entry>
  // attribute — the browser extension (WP3) sets that one because a page with
  // a strict CSP blocks content-script-injected inline <script> nodes, while
  // the DOM stays shared across isolated/main worlds. Default: 'pinpoint'.
  var ENTRY = window.__pinpointEntry ||
    (document.documentElement && document.documentElement.getAttribute('data-pinpoint-entry')) ||
    'pinpoint';
  // 打回 DOM：/sites/ 等服务端注入路径走的是 window.__pinpointEntry（主世界
  // 全局，隔离世界读不到），扩展 content script 的 page-info 依赖 DOM 属性。
  if (document.documentElement) document.documentElement.setAttribute('data-pinpoint-entry', ENTRY);
  // ---------- 阶段 5：/api/frame 嵌入帧身份 ----------
  // frame 渲染端点注入 __pinpointFrame={pageId,screenId,section,sectionLabel} 与
  // __pinpointLedger（顶层 workbench 的 pathname）：本实例读写画布同一份账本，
  // 行带 pageId + screenId，锚点按 frame 内路径归一（src/shared/frame-anchor.js，内联）。
  // 文档正文标注仍走文档自己的账本 —— 两个命名空间共存不打架。
  var FRAME = (function () {
    var f = window.__pinpointFrame;
    if (!f || typeof f !== 'object' || !f.pageId || !f.screenId) return null;
    return {
      pageId: String(f.pageId),
      screenId: String(f.screenId),
      section: f.section ? String(f.section) : '',
      sectionLabel: f.sectionLabel ? String(f.sectionLabel) : ''
    };
  })();
  var LEDGER_PATHNAME =
    (typeof window.__pinpointLedger === 'string' && window.__pinpointLedger.charAt(0) === '/')
      ? window.__pinpointLedger
      : location.pathname;
  var LS_KEY = 'pinpoint:' + ENTRY + ':' + LEDGER_PATHNAME;
  // 页面标识 = 文件名 + 全路径短哈希（SSOT: src/shared/annotate-page-key.js，内联）
  var PAGE = pageKeyFromPathname(LEDGER_PATHNAME);
  var PAGE_KEY = annotationSlug(PAGE);
  // 当前账本对应的 pathname；SPA pushState 改 URL 不刷新页面，路由切换时上面三个 key 一起重算。
  // （frame 嵌入页不导航，账本恒定 —— 路由监听在 FRAME 模式下不安装。）
  var currentPathname = LEDGER_PATHNAME;
  var marks = [];      // in-memory annotations: {n, id, type, pageId?, section?, sectionLabel?, screenId?, selector?, content, …}
  var revision = 0;    // disk document revision (SSOT concurrency)
  var syncing = false;
  var mutationVersion = 0;
  var syncedMutationVersion = 0;
  var deferredRemoteDoc = null;
  var syncEpoch = 0;          // 账本世代：路由切换即 +1，在途 sync/hydrate 回调凭世代号丢弃
  var ledgerSwitching = false; // switchLedger 已清账、hydrate 未落地期间为 true
  var queuedPathname = null;   // 切换途中又来导航：coalesce 到最新 pathname
  var eventSource = null;
  var serverOnline = false;   // SSE OPEN liveness only (not hydrate/POST success)
  var syncError = false;      // last POST/save failed while SSE may still be open
  var mode = false;    // true = 标注; false = 交互 (default)
  var paused = false;  // hide pins / overlay without leaving Annotate intent
  var floatingToolbar = false;
  var sidebarOpen = false; // 标注面板（#ann-sidebar）；viewer 偏好，持久化到 LS
  var updateListeners = [];
  var hoverEl = null;
  var drag = null;
  var arrowFrom = null;
  var activeComposer = null;
  // 2026-09-04 评审板 H1 起默认开：评论卡是画布上的主体表达（钉子常显、卡在
  // hover 钉子时出），不再是一个要先去开的开关。「隐藏批注」这一档仍在，
  // 只是不再是默认。
  var renderComments = true;  // "在画布渲染评论" toggle: show content bubbles beside anchors
  // 评论布局：'inline'=气泡在 iframe overlay（窄窗口可能压正文） /
  //  'sidebar'=气泡在父级 workbench 右侧 gutter（iframe 收窄、文档自己响应式回流，不压不遮）。
  var bubbleLayout = 'inline';

  // Mention: UI shows @n; disk stores [@a:<id>] (legacy [@m:<id>] still read).
  var MENTION_STORE_RE = /\[@(?:a|m):([a-z0-9]+)\]/gi;
  var MENTION_DISPLAY_RE = /@(\d+)\b/g;

  function newMarkId() {
    var id = '';
    var alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    do {
      id = '';
      for (var i = 0; i < 6; i++) id += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    } while (marks.some(function (k) { return k.id === id; }));
    return id;
  }

  function ensureMarkId(m) {
    if (!m) return m;
    if (!m.id || typeof m.id !== 'string') m.id = newMarkId();
    return m;
  }

  function ensureAllMarkIds() {
    marks.forEach(ensureMarkId);
  }

  function markById(id) {
    if (!id) return null;
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].id === id) return marks[i];
    }
    return null;
  }

  function markByN(n) {
    n = parseInt(n, 10);
    if (!isFinite(n)) return null;
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].n === n) return marks[i];
    }
    return null;
  }

  /** Disk / agent form → textarea form (@order). */
  function contentToDisplay(text, targets) {
    return targetContentToDisplay(text, targets || []).replace(MENTION_STORE_RE, function (_, id) {
      var hit = markById(id);
      return hit ? ('@' + hit.n) : '@?';
    });
  }
  var commentToDisplay = contentToDisplay; // compat alias for workbench

  /** 统一构造给气泡渲染的 mark 视图：正文走 contentToDisplay（解析 @mention 与 target 引用）。
   * iframe 内 overlay 与父级 gutter 共用，避免两边显示不一致。 */
  function bubbleMarkView(m) {
    return {
      n: m.n,
      // 眉标 = 这条标注指着什么，与侧栏行的 cap 同一份口径（annRowCap）——
      // 2026-09-04 评审板 H1 起卡片头不再是琥珀序号 chip + 「评论」。
      cap: annRowCap(m),
      content: contentToDisplay(m.content != null ? m.content : '', m.targets || [])
    };
  }

  /** Textarea form → disk form ([@a:id]). */
  function contentToStorage(text, targets) {
    var withTargetRefs = targetContentToStorage(text, targets || []);
    return withTargetRefs.replace(MENTION_DISPLAY_RE, function (full, n) {
      var hit = markByN(n);
      return hit ? ('[@a:' + ensureMarkId(hit).id + ']') : full;
    });
  }

  function extractMentionIds(storedContent) {
    var ids = [];
    var seen = {};
    String(storedContent || '').replace(MENTION_STORE_RE, function (_, id) {
      if (!seen[id]) { seen[id] = true; ids.push(id); }
      return _;
    });
    return ids;
  }

  function annotationContent(m) {
    if (!m) return '';
    if (m.content != null) return m.content;
    return m.comment || '';
  }

  function annotationSection(m) {
    if (!m) return '';
    return m.section || m.group || '';
  }

  function annotationSectionLabel(m) {
    if (!m) return '';
    return m.sectionLabel || m.groupLabel || '';
  }

  // Indicator/normalize logic is inlined from lib/annotation-indicator.js at serve
  // time (SSOT, node-tested). These thin wrappers preserve annotate.js semantics.

  function docAnnotations(doc) {
    if (!doc) return null;
    if (Array.isArray(doc.annotations) || Array.isArray(doc.marks)) return annotationsFromDoc(doc);
    return null;
  }

  function indicatorForMark(m) {
    if (!m) return '';
    ensureMarkId(m);
    var persisted = marks.some(function (k) { return k.n === m.n; });
    return indicatorForAnnotation(m, currentWorkbenchPageId(), { persisted: persisted });
  }

  function copyText(text) {
    if (!text) return Promise.reject(new Error('empty'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('data-ann-ui', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        if (!document.execCommand('copy')) reject(new Error('copy failed'));
        else resolve();
      } catch (err) { reject(err); }
      ta.remove();
    });
  }

  // ---------- 工具 ----------
  function isUI(el) { return !!(el && el.closest && el.closest('[data-ann-ui]')); }

  function currentWorkbenchPageId() {
    try {
      if (window.workbench && typeof window.workbench.activePageId === 'function') {
        return window.workbench.activePageId() || '';
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  function stampPage(m) {
    var pid = currentWorkbenchPageId() || (FRAME ? FRAME.pageId : '');
    if (pid) m.pageId = pid;
    return m;
  }

  // 可选范围（与 board-navigation BOARD_FRAME_SELECTOR 对齐）：
  //   1) frame chrome（屏标题 / bezel / keys / screen-err 面板）→ 整机 frame
  //   2) .ios-screen / .wb-comp-stage 内部 → 叶子元素；Alt/⌥ 升到 frame
  //   3) 独立 HTML 文档 / HTML 板 iframe（无 #wb-board-panel）→ 整份 body 即 surface
  //   4) .wb-lib-item 且不在 frame 内 → section
  // 画布空白、侧栏等一律不可选
  var FRAME_SEL = '.ios-stage, .wb-comp-stage, .wb-screen-err';

  /** True when this annotate.js instance is the document itself (not the workbench shell). */
  function isPlainDocument() {
    return !document.getElementById('wb-board-panel');
  }

  function annScreen(el) {
    return el && el.closest && el.closest('.ios-screen');
  }

  function annComp(el) {
    return el && el.closest && el.closest('.wb-comp-stage');
  }

  // Plain docs (file://, HTML-board iframe) annotate their whole body — there is
  // no board chrome to keep unselectable. Workbench board pages have no such
  // surface: there the selectable regions are .ios-screen / .wb-comp-stage.
  // （2026-09-04：web 壳退役后的 .wb-html-surface 命中分支已删，见 BACKLOG。）
  function annDocumentSurface(el) {
    if (!el) return null;
    if (!isPlainDocument() || !document.body) return null;
    if (el === document.body || document.body.contains(el)) return document.body;
    return null;
  }

  function annContentSurface(el) {
    return annScreen(el) || annComp(el) || annDocumentSurface(el);
  }

  function annFlow(el) {
    return el && el.closest && el.closest('.wb-lib-item[data-ann-section], .wb-lib-item[data-ann-group]');
  }

  function annFrame(el) {
    return el && el.closest && el.closest(FRAME_SEL);
  }

  function isFrameNode(el) {
    return !!(el && el.matches && el.matches(FRAME_SEL));
  }

  /** Resolve canonical frame node; screen caption sits beside the stage. */
  function resolveFrame(el) {
    var frame = annFrame(el);
    if (frame) return frame;
    var screen = el && el.closest && el.closest('.wb-screen');
    if (!screen) return null;
    return screen.querySelector(FRAME_SEL) || null;
  }

  /** Screen caption, phone chrome outside .ios-screen, or load-error stage. */
  function isFrameChrome(el) {
    if (!el || !el.closest) return false;
    if (el.closest('.wb-screen-cap')) return true;
    if (el.matches && el.matches('.wb-screen-err')) return true;
    if (el.closest('.wb-screen-err')) return true;
    var frame = annFrame(el);
    if (!frame) return false;
    // Comp stage: only the stage root itself counts as chrome.
    if (frame.classList && frame.classList.contains('wb-comp-stage')) {
      return el === frame;
    }
    // Phone: device/bezel/keys/root/stage, but not anything inside .ios-screen.
    if (annScreen(el)) return false;
    return !!(el.closest('.ios-device, .ios-bezel, .ios-key, .ios-root, .ios-stage'));
  }

  /**
   * Resolve annotate hit. opts.promoteFrame (Alt/⌥) climbs content → frame.
   */
  function annTarget(el, opts) {
    opts = opts || {};
    if (!el || isUI(el) || el === document.body || el === document.documentElement) return null;

    if (isFrameChrome(el)) {
      return resolveFrame(el);
    }

    var surface = annContentSurface(el);
    if (surface) {
      if (opts.promoteFrame) {
        return resolveFrame(el) || surface;
      }
      return el;
    }

    // Section only when outside any frame (caption already handled above).
    if (annFrame(el)) return null;
    var flow = annFlow(el);
    return flow || null;
  }

  function annTargetAt(x, y, opts) {
    return annTarget(document.elementFromPoint(x, y), opts);
  }

  function classifyTarget(el) {
    if (!el) return 'annotation';
    if (el.classList && el.classList.contains('wb-lib-item')) return 'section';
    if (isFrameNode(el)) return 'frame';
    return 'annotation';
  }

  function screenIdOf(el) {
    var s = el && el.closest && el.closest('.wb-screen[data-screen]');
    return s ? (s.getAttribute('data-screen') || '') : '';
  }

  function sectionOf(el) {
    var g = el && el.closest && el.closest('[data-ann-section], [data-ann-group]');
    if (!g) return null;
    var id = g.getAttribute('data-ann-section') || g.getAttribute('data-ann-group') || '';
    var label = g.getAttribute('data-ann-section-label')
      || g.getAttribute('data-ann-group-label')
      || id;
    return { section: id, sectionLabel: label };
  }

  function cssPath(el) {
    if (!el || el === document.body || el.nodeType !== 1) return 'body';
    var parts = [];
    while (el && el !== document.body && el.nodeType === 1) {
      if (el.id) { parts.unshift('#' + el.id); break; }
      var tag = el.tagName.toLowerCase();
      var cls = (el.classList[0] && !/^ann-/.test(el.classList[0])) ? '.' + el.classList[0] : '';
      var i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) { if (sib.tagName === el.tagName) i++; }
      parts.unshift(tag + cls + ':nth-of-type(' + i + ')');
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  function docRect(el) {
    var r = viewRect(el);
    return [r[0] + scrollX, r[1] + scrollY, r[2], r[3]];
  }

  // A measurement batch reads layout once per element before painting any marks.
  var geometryCache = null;
  var canvasView = null;
  var measuringCanvas = false;
  var navigationActive = false;
  var selectorCache = new Map();
  var frameRoots = null;
  var markFacts = new WeakMap();
  function clearAnchorCache() {
    selectorCache.clear(); frameRoots = null; markFacts = new WeakMap();
  }
  function markFact(m) {
    var fact = markFacts.get(m);
    if (!fact) { fact = {}; markFacts.set(m, fact); }
    return fact;
  }

  function geometryBatch(fn) {
    if (geometryCache) return fn();
    geometryCache = { rects: new WeakMap(), styles: new WeakMap(), clips: new WeakMap() };
    try { return fn(); } finally { geometryCache = null; }
  }

  function geometryStyle(el) {
    if (!geometryCache) return getComputedStyle(el);
    if (!geometryCache.styles.has(el)) geometryCache.styles.set(el, getComputedStyle(el));
    return geometryCache.styles.get(el);
  }

  function setNavigationActive(on) {
    navigationActive = !!on;
    if (navigationActive) { clearHover(); hideGhost(); }
    else onViewChange();
  }

  function viewRect(el) {
    if (geometryCache && geometryCache.rects.has(el)) return geometryCache.rects.get(el);
    var r = el.getBoundingClientRect();
    var rect = measuringCanvas ? [r.left, r.top, r.width, r.height] : [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    if (geometryCache) geometryCache.rects.set(el, rect);
    return rect;
  }

  /** Overflow / screen ancestors that visually clip `el` (viewport rects). */
  function clipAncestorViewRects(el) {
    if (geometryCache && geometryCache.clips.has(el)) return geometryCache.clips.get(el);
    var clips = [];
    var node = el && el.parentElement;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      // The fixed overlay clips the viewport. Cached canvas geometry must retain
      // off-screen portions so translating it back into view never needs a remeasure.
      if (measuringCanvas && canvasView && node === canvasView.stage) break;
      var force = node.classList && (
        node.classList.contains('ios-screen') ||
        node.classList.contains('wb-comp-stage')
      );
      if (force) {
        clips.push(viewRect(node));
      } else {
        var st = geometryStyle(node);
        if ((st.overflowX && st.overflowX !== 'visible') ||
            (st.overflowY && st.overflowY !== 'visible')) {
          clips.push(viewRect(node));
        }
      }
      node = node.parentElement;
    }
    if (geometryCache) geometryCache.clips.set(el, clips);
    return clips;
  }

  /** Target's viewport rect intersected with clip ancestors; null if scrolled out. */
  function visibleViewRectOf(el) {
    if (!el) return null;
    var clipped = clipByRects(viewRect(el), clipAncestorViewRects(el));
    return isVisibleEnough(clipped) ? clipped : null;
  }

  /** Doc-space rect → clipped viewport rect using `clipEl`'s ancestors. */
  function visibleViewRectDoc(rectDoc, clipEl) {
    if (!rectDoc) return null;
    var clipped = clipByRects(docToView(rectDoc), clipEl ? clipAncestorViewRects(clipEl) : []);
    return isVisibleEnough(clipped) ? clipped : null;
  }

  function viewPointInClips(viewP, clipEl) {
    if (!viewP) return false;
    var clips = clipEl ? clipAncestorViewRects(clipEl) : [];
    for (var i = 0; i < clips.length; i++) {
      var c = clips[i];
      if (viewP[0] < c[0] || viewP[1] < c[1] ||
          viewP[0] >= c[0] + c[2] || viewP[1] >= c[1] + c[3]) {
        return false;
      }
    }
    return true;
  }

  function hidePartNodes(part) {
    if (!part) return;
    if (part.frame) part.frame.style.display = 'none';
    if (part.badge) part.badge.style.display = 'none';
  }

  function showPartNodes(part) {
    if (!part) return;
    if (part.frame) part.frame.style.display = '';
    if (part.badge) part.badge.style.display = '';
  }

  function placeFixedRect(node, r) {
    node.style.left = r[0] + 'px';
    node.style.top = r[1] + 'px';
    node.style.width = r[2] + 'px';
    node.style.height = r[3] + 'px';
  }

  function docPointToView(p) { return [p[0] - scrollX, p[1] - scrollY]; }
  function docToView(r) { return [r[0] - scrollX, r[1] - scrollY, r[2], r[3]]; }

  // Overlay is stage-scoped (absolute inside .wb-stage-wrap); convert viewport → overlay-local.
  var _originCache = null;
  function overlayOrigin() {
    if (_originCache) return _originCache;
    var r = overlay.getBoundingClientRect();
    _originCache = [Math.round(r.left), Math.round(r.top)];
    return _originCache;
  }
  function beginOverlayFrame() { _originCache = null; }
  function viewToOverlayRect(r) {
    var o = overlayOrigin();
    return [r[0] - o[0], r[1] - o[1], r[2], r[3]];
  }
  function viewToOverlayPoint(p) {
    var o = overlayOrigin();
    return [p[0] - o[0], p[1] - o[1]];
  }
  function placeOverlayRect(node, viewR) {
    beginOverlayFrame();
    placeFixedRect(node, viewToOverlayRect(viewR));
  }

  function excerpt(el) {
    // section container: use section title, avoid stuffing the whole screen into text
    if (el && el.classList && el.classList.contains('wb-lib-item')) {
      // 图注带 mono 引用号（2026-08-15）：label 属性与标题同值且不含引用号，优先读它
      var cap = el.querySelector('.wb-lib-cap');
      var label = el.getAttribute('data-ann-section-label') ||
        el.getAttribute('data-ann-group-label') ||
        (cap && (cap.innerText || cap.textContent)) ||
        el.getAttribute('data-ann-section') ||
        el.getAttribute('data-ann-group') || '';
      return String(label).replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    // frame shell: screen caption / data-screen, not the whole phone innerText
    if (isFrameNode(el)) {
      var screen = el.closest && el.closest('.wb-screen[data-screen]');
      var scap = screen && screen.querySelector('.wb-screen-cap');
      // 图注两行结构（2026-08-15）：屏名在 .wb-cap-title，mono 引用号不进标注文案
      var scapTitle = scap && scap.querySelector('.wb-cap-title');
      var flabel = (scapTitle && (scapTitle.innerText || scapTitle.textContent)) ||
        (scap && (scap.innerText || scap.textContent)) ||
        (screen && screen.getAttribute('data-screen')) ||
        (el.classList && el.classList.contains('wb-screen-err') ? 'Error' : '') ||
        'Frame';
      return String(flabel).replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    var t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 120);
  }

  function resolve(sel) {
    if (selectorCache.has(sel)) {
      var cached = selectorCache.get(sel);
      if (!cached || cached.isConnected) return cached;
    }
    var el = null;
    try { el = document.querySelector(sel); } catch (e) { /* Invalid selector is an unresolved anchor. */ }
    selectorCache.set(sel, el);
    return el;
  }

  // ---------- frame 内锚点归一（阶段 5 透传）----------
  // frameInternalSelector / FRAME_STAGE_SELECTOR 由 src/shared/frame-anchor.js 内联提供。
  // 行带 screenId 且 selector 含 stage 段 → 只在该 frame 的 stage 根里解析：
  // 画布（.wb-screen[data-screen] 下的 stage）与 /api/frame 嵌入页（文档唯一
  // stage）两端同构互解；frame 换序/跨 section 移动后锚点自愈。派生不出 frame
  // 内路径的 selector（id 短路等）维持全局解析 —— 存量语义逐字节不变。
  function scopedStageRoot(screenId) {
    if (FRAME) return document.querySelector(FRAME_STAGE_SELECTOR);
    if (!screenId) return null;
    var panel = document.getElementById('wb-board-panel');
    if (!panel) return null;
    if (!frameRoots) {
      frameRoots = new Map();
      panel.querySelectorAll('.wb-screen[data-screen]').forEach(function (screen) {
        frameRoots.set(screen.getAttribute('data-screen'), screen.querySelector(FRAME_STAGE_SELECTOR));
      });
    }
    return frameRoots.get(screenId) || null;
  }

  function resolveMarkSelector(selector, screenId) {
    if (!selector) return null;
    var rel = frameInternalSelector(selector);
    if (rel && (FRAME || screenId)) {
      var sid = FRAME ? FRAME.screenId : screenId;
      var key = sid + '\n' + selector;
      if (!selectorCache.has(key)) selectorCache.set(key, queryFrameScope(scopedStageRoot(sid), rel));
      return selectorCache.get(key);
    }
    return resolve(selector);
  }

  function sectionSelector(sectionId) {
    var id = String(sectionId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return '#wb-board-panel [data-ann-section="' + id + '"], #wb-board-panel [data-ann-group="' + id + '"]';
  }

  /** Annotation belongs to the active workbench page. */
  function markOnActivePage(m) {
    if (!m) return false;
    // /api/frame 嵌入帧：本实例只承载「某一个 frame」的标注 —— 同账本里其它
    // page/screen 的行既不渲染也不计数（行的读写仍整账本报文，绝不丢行）。
    if (FRAME) return m.pageId === FRAME.pageId && m.screenId === FRAME.screenId;
    // 独立 HTML 文档（没有 workbench 画布）：下面的判据全是「这个标注落在当前
    // 画布的哪个页/哪个 frame 里」，在这里一条都不成立，结果是所有标注都被判为
    // 不属于本页 —— 计数恒为 0、侧栏列表恒空，尽管标注确实存在并已落盘。
    // 这类文档的页面身份由磁盘 page key（按路径分文件）保证，不需要再过滤。
    if (!document.getElementById('wb-board-panel')) return true;
    var pid = currentWorkbenchPageId();
    if (m.pageId) return !pid || m.pageId === pid;
    var sec = annotationSection(m);
    if (sec) {
      try {
        return !!document.querySelector(sectionSelector(sec));
      } catch (e) { return false; }
    }
    if (m.type === 'element') {
      var targets = markElementTargets(m);
      for (var ti = 0; ti < targets.length; ti++) {
        var tel = resolve(targets[ti].selector);
        if (tel && tel.closest && tel.closest('#wb-board-panel')) return true;
      }
      return false;
    }
    var el = m.base ? resolve(m.base.selector) : null;
    return !!(el && el.closest && el.closest('#wb-board-panel'));
  }

  // ---------- section / frame stamping ----------
  function stampTargetMeta(m, el) {
    var s = sectionOf(el);
    if (s) {
      m.section = s.section;
      m.sectionLabel = s.sectionLabel;
    }
    var sid = screenIdOf(el);
    if (sid) m.screenId = sid;
    // /api/frame 嵌入帧：DOM 近亲查不到（或结构漂移）时用注入身份兜底，
    // 保证行恒带画布侧的 pageId/section/screenId 三件套。
    if (FRAME) {
      if (!m.screenId) m.screenId = FRAME.screenId;
      if (!annotationSection(m) && FRAME.section) {
        m.section = FRAME.section;
        m.sectionLabel = FRAME.sectionLabel || FRAME.section;
      }
    }
    m.indicatorKind = classifyTarget(el);
    return m;
  }

  /** True when `el` has a rendered box an annotation can anchor to.
   *  offsetParent is an HTML-box-model concept: SVG / MathML / foreignObject
   *  nodes leave it undefined, so a visible <text>/<path> read as "no layout"
   *  under the old probe and falsely showed 锚点失效. Keep offsetParent as the
   *  fast path (so nothing previously live becomes broken) and fall back to
   *  geometry for non-HTML namespaces and any element with a rendered rect.
   *  This is the single "has layout" probe — isHidden and regionContains share
   *  it so the lasso and the anchor-brokenness check can't drift apart. */
  function hasLayout(el) {
    if (!el || el === document.body) return true;
    if (el.offsetParent) return true;
    if (getComputedStyle(el).position === 'fixed') return true;
    if (el.getClientRects && el.getClientRects().length) return true;
    return false;
  }

  // display:none / 无 layout → 没有 rendered box（fixed 除外）；SVG 等非 HTML 盒
  // 模型节点走 getClientRects 兜底，否则可见的 <text> 会被误判隐藏。
  function isHidden(el) {
    return !hasLayout(el);
  }

  // ---------- multi-anchor element marks ----------
  function markElementTargets(m) {
    if (!m || m.type !== 'element') return [];
    return normalizeTargetRefs(m.targets, m.selector, m.text);
  }

  var liveTargetBatch = null;
  function withLiveTargets(fn) {
    if (liveTargetBatch) return fn();
    liveTargetBatch = new Map();
    try { return fn(); } finally { liveTargetBatch = null; }
  }

  function resolveAllLiveTargets(m) {
    if (liveTargetBatch && liveTargetBatch.has(m)) return liveTargetBatch.get(m);
    var out = [];
    markElementTargets(m).forEach(function (t) {
      var el = resolveMarkSelector(t.selector, m.screenId || '');
      if (el && !isHidden(el)) {
        out.push({ el: el, ref: t.ref, selector: t.selector, text: t.text, rectDoc: docRect(el) });
      }
    });
    if (liveTargetBatch) liveTargetBatch.set(m, out);
    return out;
  }

  function normalizeElementTargets(m) {
    if (!m || m.type !== 'element') return m;
    var targets = markElementTargets(m);
    if (targets.length) {
      m.targets = targets;
      m.selector = targets[0].selector;
      m.text = targets[0].text || '';
    }
    return m;
  }

  // ---------- 持久化（磁盘 SSOT；LS 仅缓存）----------
  function readLocalMarks() {
    try {
      var value = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      return Array.isArray(value) ? value.map(normalizeAnnotation) : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocalCache() {
    try {
      if (marks.length) localStorage.setItem(LS_KEY, JSON.stringify(marks));
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* quota */ }
  }

  function applyRemoteDoc(doc, statusMsg) {
    var list = docAnnotations(doc);
    if (!list) return;
    var rev = Number(doc.revision);
    if (!Number.isFinite(rev)) rev = 0;
    if (rev < revision && marks.length) return;
    marks = list.map(function (item) { return normalizeAnnotation(Object.assign({}, item)); });
    ensureAllMarkIds();
    revision = rev;
    syncedMutationVersion = mutationVersion;
    writeLocalCache();
    structureDirty = true;
    renderLedgerChange();
    notify();
    if (statusMsg) {
      setStatus(statusMsg);
      setTimeout(function () { setStatus(''); }, 2000);
    }
  }

  function persist() {
    mutationVersion++;
    writeLocalCache();
    requestSync();
    structureDirty = true;
    renderLedgerChange();
    notify();
  }

  function deferRemoteDoc(doc) {
    var rev = Number(doc && doc.revision);
    if (!Number.isFinite(rev)) return;
    if (!deferredRemoteDoc || rev > Number(deferredRemoteDoc.revision)) deferredRemoteDoc = doc;
  }

  function settleDeferredRemote(sentVersion) {
    if (!deferredRemoteDoc) return false;
    var doc = deferredRemoteDoc;
    deferredRemoteDoc = null;
    var rev = Number(doc.revision);
    if (!Number.isFinite(rev) || rev <= revision) return false;
    if (mutationVersion > sentVersion) {
      revision = rev;
      return true;
    }
    applyRemoteDoc(doc, '已从其他窗口更新');
    return false;
  }

  function requestSync() {
    if (!SERVER || syncing || mutationVersion <= syncedMutationVersion) return;
    syncing = true;
    var sentVersion = mutationVersion;
    var sentEpoch = syncEpoch; // 路由切换后本响应作废（数据属于旧 pathname 的账本）
    var body = {
      page: PAGE,
      entry: ENTRY,
      path: decodeURIComponent(LEDGER_PATHNAME),
      updated_at: new Date().toISOString(),
      baseRevision: revision,
      annotations: marks.slice()
    };
    fetch(SERVER + '/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, status: r.status, data: data };
        });
      })
      .then(function (res) {
        if (sentEpoch !== syncEpoch) return; // 陈旧响应：不得碰 syncing 或新账本状态
        syncing = false;
        if (res.ok) {
          if (res.data && Number.isFinite(Number(res.data.revision))) {
            revision = Number(res.data.revision);
          }
          syncedMutationVersion = Math.max(syncedMutationVersion, sentVersion);
          var shouldRetry = settleDeferredRemote(sentVersion);
          if (syncError) { syncError = false; notify(); }
          setStatus('已同步');
          setTimeout(function () { setStatus(''); }, 1500);
          if (shouldRetry || mutationVersion > syncedMutationVersion) requestSync();
          return;
        }
        if (res.status === 409 && res.data) {
          deferredRemoteDoc = null;
          if (mutationVersion > sentVersion) {
            revision = Number(res.data.revision) || 0;
            requestSync();
          } else {
            applyRemoteDoc(res.data, '已从其他窗口更新');
          }
          return;
        }
        setStatus('同步失败', true);
      })
      .catch(function () {
        if (sentEpoch !== syncEpoch) return; // 同上：切账本后的失败回调一并丢弃
        syncing = false;
        // POST failed — SSE may still be open, so don't flip connected.
        if (!syncError) { syncError = true; notify(); }
        setStatus('同步失败', true);
      });
  }

  function hydrateFromDisk() {
    if (!SERVER) {
      marks = readLocalMarks();
      revision = 0;
      setServerOnline(false);
      return Promise.resolve(false);
    }
    var hydrateEpoch = syncEpoch; // 路由切换后本份 hydrate 作废
    return fetch(SERVER + '/annotations/' + encodeURIComponent(PAGE) + '?entry=' + encodeURIComponent(ENTRY))
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(function (doc) {
        if (hydrateEpoch !== syncEpoch) return false; // 已切账本，整份响应作废
        var diskMarks = docAnnotations(doc) || [];
        var diskRev = Number(doc && doc.revision);
        if (!Number.isFinite(diskRev)) diskRev = diskMarks.length ? 1 : 0;
        if (diskMarks.length || diskRev > 0) {
          marks = diskMarks.map(function (item) { return normalizeAnnotation(Object.assign({}, item)); });
          ensureAllMarkIds();
          revision = diskRev;
          writeLocalCache();
          return true;
        }
        // Empty disk: seed from LS cache only into memory (do not POST empty overwrite).
        marks = readLocalMarks();
        ensureAllMarkIds();
        revision = 0;
        if (marks.length) {
          // Push cache up once so disk becomes SSOT for other browsers.
          mutationVersion++;
          requestSync();
        }
        return true;
      })
      .catch(function () {
        if (hydrateEpoch !== syncEpoch) return false; // 已切账本，失败回调同样作废
        marks = readLocalMarks();
        revision = 0;
        setServerOnline(false);
        setStatus('未连接服务', true);
        return false;
      });
  }

  function setServerOnline(on) {
    on = !!on;
    if (serverOnline === on) return;
    serverOnline = on;
    notify();
  }

  function connectEvents() {
    if (!SERVER || typeof EventSource === 'undefined') return;
    if (eventSource) {
      try { eventSource.close(); } catch (e) { /* */ }
      eventSource = null;
    }
    try {
      eventSource = new EventSource(SERVER + '/events');
    } catch (e) {
      setServerOnline(false);
      return;
    }
    eventSource.onopen = function () { setServerOnline(true); };
    eventSource.onerror = function () {
      // Browser auto-reconnects while CONNECTING; only mark offline when closed or reconnecting.
      if (!eventSource || eventSource.readyState !== EventSource.OPEN) setServerOnline(false);
    };
    eventSource.addEventListener('annotations', function (ev) {
      var doc;
      try { doc = JSON.parse(ev.data); } catch (err) { return; }
      if (!doc) return;
      // Payloads without entry predate bucketing; they belong to 'pinpoint'.
      if ((doc.entry || 'pinpoint') !== ENTRY) return;
      if (doc.page !== PAGE && doc.page !== PAGE_KEY) return;
      var rev = Number(doc.revision);
      if (!Number.isFinite(rev) || rev <= revision) return;
      if (syncing || mutationVersion > syncedMutationVersion) {
        deferRemoteDoc(doc);
        return;
      }
      applyRemoteDoc(doc, '已从其他窗口更新');
    });
  }

  function closeEvents() {
    if (!eventSource) return;
    try { eventSource.close(); } catch (e) { /* */ }
    eventSource = null;
    setServerOnline(false);
  }

  window.addEventListener('pagehide', closeEvents);
  window.addEventListener('pageshow', function (event) {
    if (event.persisted && !eventSource) connectEvents();
  });

  // ---------- UI 骨架 ----------
  // Lucide 风格内联图标（24 viewBox、stroke currentColor）。注入包保持单文件
  // 自包含，composer/侧栏用的几个图标以 path data 放这里，不引 workbench-icons.js。
  var ANN_ICONS = {
    trash: '<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>'
  };
  function annIcon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ANN_ICONS[name] + '</svg>';
  }
  var style = document.createElement('style');
  style.textContent = [
    // V4（goal-20260811-workbench-visual-rebuild）：--wb-* 钉值从 #ann-sidebar 提升到
    // [data-ann-ui] 基规则 —— 工具条/composer/气泡/mention/侧栏消费同一套 token（命名与值
    // 跟随 workbench/wb-tokens.css）；钉在注入 UI 根上，宿主页面的同名变量渗不进来。
    // #ann-sidebar 规则上的钉值保留原样：共享行样式入参 + 三向守卫锚点（与本规则同值）。
    '[data-ann-ui]{font-family:var(--wb-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif);box-sizing:border-box;--wb-surface:#fff;--wb-side:#f6f6f7;--wb-fg:#1c2024;--wb-muted:#6b6b70;--wb-faint:#8d8d8d;--wb-line:rgba(0,0,0,.07);--wb-hover:rgba(0,0,0,.04);--wb-fill:rgba(0,0,0,.055);--wb-accent:#5b7fa6;--wb-danger:#b84230;--wb-ok:#1d7144;--wb-ok-soft:#edf8f1;--wb-r-1:4px;--wb-r-2:6px;--wb-r-3:8px;--wb-r-4:12px;--wb-w-medium:500;--wb-w-semibold:600;--wb-w-bold:700;--wb-sh-1:0 1px 2px rgba(0,0,0,.06),0 0 0 0.5px rgba(0,0,0,.04);--wb-sh-2:0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.1);--wb-sh-3:0 1px 2px rgba(0,0,0,.06),0 14px 38px rgba(0,0,0,.16);--wb-font:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif;--wb-font-mono:ui-monospace,SFMono-Regular,Menlo,"PingFang SC",monospace;--wb-dur:.2s;--wb-ease:cubic-bezier(.25,0,0,1);}',
    '[data-ann-ui] *,[data-ann-ui] *::before,[data-ann-ui] *::after{box-sizing:border-box;}',
    /* 悬浮工具条与标注面板：2026-09-04 外壳重设计（ADR 0031）「注入端 #ann-sidebar
       换同一档玻璃，两端材质一致」。F2 磨砂的配方在这里是字面量，不是 token ——
       client 是注进任意页面的单文件，读不到 workbench 的 --wb-*（同一个理由让
       [data-ann-ui] 上钉了一整套 --wb-* 值），所以玻璃这四个数也钉在规则里：
       白 88% + blur 20 saturate 1.2 + 圆角 14 + sh-3 + 0.5px 上缘内高光。
       改这四个数要连 src/workbench/wb-tokens.css 的 --wb-glass / --wb-glass-blur /
       --wb-r-glass / --wb-sh-3 一起改，双端材质不许分家。 */
    '#ann-sidebar,#ann-toolbar{background:rgba(255,255,255,.88);-webkit-backdrop-filter:blur(20px) saturate(1.2);backdrop-filter:blur(20px) saturate(1.2);border-radius:14px;box-shadow:inset 0 .5px 0 rgba(255,255,255,.6),0 1px 2px rgba(0,0,0,.06),0 14px 38px rgba(0,0,0,.16);}',
    '#ann-toolbar{position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;gap:8px;align-items:center;padding:7px 12px;}',
    '#ann-toolbar button{border:none;cursor:pointer;font-size:12px;font-weight:var(--wb-w-medium,500);height:28px;padding:0 10px;border-radius:var(--wb-r-2,6px);background:transparent;color:var(--wb-muted,#6b6b70);transition:background var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1)),color var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1)),box-shadow var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1));}',
    '#ann-toolbar button:hover{background:var(--wb-hover,rgba(0,0,0,.04));color:var(--wb-fg,#1c2024);}',
    '#ann-toolbar button.on{background:color-mix(in srgb,#f5a623 16%,#fff);color:#8a5a00;font-weight:var(--wb-w-semibold,600);box-shadow:inset 0 0 0 1px color-mix(in srgb,#f5a623 35%,transparent);}',
    '#ann-toolbar button[hidden]{display:none;}',
    '#ann-toolbar button.ok{background:var(--wb-ok-soft,#edf8f1);color:var(--wb-ok,#1d7144);}',
    '#ann-count{font-size:11px;color:var(--wb-muted,#6b6b70);}',
    '#ann-status{font-size:10px;color:var(--wb-faint,#8d8d8d);}',
    '#ann-status.err{color:var(--wb-danger,#b84230);}',
    'html.ann-sidebar-open #ann-toolbar{right:304px;}',
    // 标注面板：材质走上面与工具条共用的玻璃规则。它从贴边满高的实色面改成浮在
    // 页面上的玻璃板 —— 四缘留 12px，overflow:hidden 让滚动区不冒出圆角。
    // 宽度 280 不变，工具条让位的 304 = 12 + 280 + 12。
    // 本规则上的 --wb-* 钉值是共享行样式（src/shared/ann-list.css）的主题入参 + 三向守卫锚点，
    // 与 [data-ann-ui] 基规则的钉值同值；宿主页面即便定义了同名变量也渗不进来。
    '#ann-sidebar{position:fixed;top:12px;right:12px;bottom:12px;width:280px;z-index:2147483645;overflow:hidden;display:flex;flex-direction:column;--wb-fg:#1c2024;--wb-muted:#6b6b70;--wb-faint:#8d8d8d;--wb-hover:rgba(0,0,0,.04);--wb-danger:#b84230;--wb-r-2:6px;--wb-r-3:8px;--wb-w-medium:500;--wb-w-semibold:600;--wb-w-bold:700;--wb-sh-1:0 1px 2px rgba(0,0,0,.06),0 0 0 0.5px rgba(0,0,0,.04);--wb-font-mono:ui-monospace,SFMono-Regular,Menlo,"PingFang SC",monospace;--wb-dur:.2s;--wb-ease:cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar[hidden]{display:none;}',
    '#ann-sidebar .ann-sb-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 14px 10px;}',
    '#ann-sidebar .ann-sb-title{flex:1;font-size:13px;font-weight:var(--wb-w-semibold);color:var(--wb-fg);}',
    '#ann-sidebar .ann-sb-count{font-size:11px;color:var(--wb-faint);font-variant-numeric:tabular-nums;}',
    '#ann-sidebar .ann-sb-close{flex:none;width:26px;height:26px;padding:0;border:none;border-radius:var(--wb-r-2);background:transparent;cursor:pointer;font:inherit;font-size:14px;line-height:26px;text-align:center;color:var(--wb-faint);transition:background .2s cubic-bezier(.25,0,0,1),color .2s cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar .ann-sb-close:hover{background:var(--wb-hover,rgba(0,0,0,.04));color:var(--wb-fg);}',
    // 「交互 | 标注」segmented：同 workbench 的 .wb-board-mode / .wb-ann-filter .ctl
    // 语言 —— 灰槽 + 白色凸起选中态；「标注」选中时沿用 workbench 标注开关的橙色强调。
    '#ann-sidebar .ann-sb-modes{flex:none;display:flex;gap:2px;margin:10px 12px 4px;padding:2px;border-radius:var(--wb-r-3);background:var(--wb-fill,rgba(0,0,0,.055));}',
    '#ann-sidebar .ann-sb-modes button{flex:1;border:0;border-radius:var(--wb-r-2);cursor:pointer;background:transparent;color:var(--wb-muted);font:inherit;font-size:11.5px;font-weight:var(--wb-w-semibold);letter-spacing:.02em;padding:6px 8px;transition:background .2s cubic-bezier(.25,0,0,1),color .2s cubic-bezier(.25,0,0,1),box-shadow .2s cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar .ann-sb-modes button:hover{color:var(--wb-fg);}',
    '#ann-sidebar .ann-sb-modes button.on{background:var(--wb-surface,#fff);color:var(--wb-fg);box-shadow:var(--wb-sh-1);}',
    '#ann-sidebar .ann-sb-modes button.on[data-ann-mode="annotate"]{background:color-mix(in srgb,#f5a623 16%,#fff);color:#8a5a00;box-shadow:inset 0 0 0 1px color-mix(in srgb,#f5a623 35%,transparent);}',
    '#ann-sidebar .ann-sb-body{flex:1;overflow-y:auto;padding:6px 8px 8px;}',
    // 行/失效态/空态的共享视觉 = src/shared/ann-list.css，serve 时内联为 ANN_LIST_CSS
    // （workbench 侧栏 link 同一份；行类名统一为 .wb-ann-*）。
    ANN_LIST_CSS,
    // 以下为 client 侧结构增量，与 workbench 侧有意不同、不进共享层：行 flex 壳、
    // min-width 序号徽标、失效徽标描边色、broken-tag 对齐、空态盒边距/边框、操作列。
    '#ann-sidebar .wb-ann-empty{margin:6px 4px;border:1px dashed rgba(0,0,0,.12);}',
    '#ann-sidebar .wb-ann-empty-title{margin:0 0 6px;}',
    '#ann-sidebar .wb-ann-item{display:flex;gap:2px;align-items:stretch;}',
    '#ann-sidebar .wb-ann-num{min-width:18px;padding:0 5px;}',
    '#ann-sidebar .wb-ann-item--broken .wb-ann-num{box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);}',
    '#ann-sidebar .wb-ann-broken-tag{align-self:flex-start;}',
    '#ann-sidebar .ann-sb-acts{flex:none;display:flex;flex-direction:column;gap:2px;padding:4px 4px 4px 0;opacity:0;pointer-events:none;}',
    '#ann-sidebar .wb-ann-item:hover .ann-sb-acts,#ann-sidebar .wb-ann-item:focus-within .ann-sb-acts{opacity:1;pointer-events:auto;}',
    '#ann-sidebar .ann-sb-acts button{min-width:32px;height:24px;padding:0;border:none;border-radius:var(--wb-r-2);background:transparent;cursor:pointer;font:inherit;font-size:12px;line-height:24px;text-align:center;color:var(--wb-faint);}',
    '#ann-sidebar .ann-sb-acts button:hover{background:var(--wb-hover,rgba(0,0,0,.04));color:var(--wb-fg);}',
    '#ann-sidebar .ann-sb-acts .ann-sb-del:hover{color:var(--wb-danger);background:color-mix(in srgb,var(--wb-danger) 10%,transparent);}',
    'html.ann-mode-on #wbstage{cursor:crosshair;}',
    '#ann-overlay{position:absolute;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;margin:0;padding:0;border:0;width:auto;height:auto;background:transparent;color:inherit;}#ann-overlay::backdrop{background:transparent;pointer-events:none}',
    '#ann-overlay[data-ann-viewport]{position:fixed;}',
    '.ann-result-target{position:absolute;border:2px solid #438bea;border-radius:4px;background:rgba(67,139,234,.06);pointer-events:none;box-sizing:border-box}.ann-result-target button{position:absolute;right:-10px;top:-12px;border:2px solid white;border-radius:999px;background:#438bea;color:white;min-width:23px;height:23px;font:600 12px system-ui;pointer-events:auto;cursor:pointer}',
    '#ann-marks,#ann-hover-layer{position:absolute;inset:0;pointer-events:none;z-index:1;}',
    '.ann-mark-group{position:absolute;inset:0;pointer-events:none;}',
    '.wb-stage-wrap #ann-bubbles .ann-bubble:not(.ann-bubble--show){display:none;}',
    '#ann-chrome{position:absolute;inset:0;pointer-events:none;z-index:10;overflow:visible;}',
    // 锚点框/套索/序号徽章：琥珀是标注功能色（双端同值），只把圆角/阴影收进 token 阶梯。
    '.ann-hover-ghost{position:absolute;box-sizing:border-box;border:2px solid #f5a623;border-radius:var(--wb-r-1,4px);background:rgba(245,166,35,.07);pointer-events:none;z-index:1;}',
    '.ann-hover-ghost[hidden]{display:none;}',
    /* 序号钉（2026-09-04 评审板 H 批注 1：「不够明显，需要跟下面的画面有高对比」）：
       22px accent 实心圆 + 白字 + 2px 白描边 + 投影 —— 白环把钉子从任何底色里
       切出来（深色屏、彩色卡片、白纸都成立），所以它可以常显不打折。
       琥珀仍是「正在圈选」的功能色（hover ghost / target / lasso 不变），
       accent 只给已经落下的这一枚。 */
    '.ann-badge{position:absolute;width:22px;height:22px;border-radius:50%;background:var(--wb-accent,#5b7fa6);color:#fff;font-size:11px;font-weight:var(--wb-w-semibold,600);font-family:var(--wb-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff,0 1px 3px rgba(0,0,0,.35);pointer-events:auto;cursor:pointer;z-index:3;transition:box-shadow .12s ease;}',
    '.ann-badge.ann-badge--on{box-shadow:0 0 0 2px #fff,0 0 0 5px color-mix(in srgb,var(--wb-accent,#5b7fa6) 32%,transparent),0 1px 3px rgba(0,0,0,.35);}',
    /* 评论卡只在 hover 钉子（或该条被定位）时出（批注 1 的后半句「hover 时显示，
       不然有点挡视野」）。这里只切可见性，不动 [hidden] —— [hidden] 归「锚点在
       视口外」那条既有规矩，两个语义不许合并。 */
    '#ann-bubbles .ann-bubble{opacity:0;pointer-events:none;transform:translateY(2px);transition:opacity .12s ease,transform .12s ease;}',
    '#ann-bubbles .ann-bubble.ann-bubble--show{opacity:1;pointer-events:auto;transform:none;}',
    /* owner 批注 2：弹出的标注列表不能盖住被定位的气泡 —— 有钉子点亮 / 有卡在显示 /
       定位闪烁时，整个 overlay 升到列表（#wbdock，z-index 7）之上；平时留在它下面，
       列表照常盖住画布。底部横条（z-index 10）永远在最上层，不受这条影响。 */
    '#ann-overlay:has(.ann-badge--on),#ann-overlay:has(.ann-bubble--show),#ann-overlay:has(.ann-flash){z-index:9;}',
    '.ann-target{position:absolute;box-sizing:border-box;border:2px solid rgba(245,166,35,.85);border-radius:var(--wb-r-1,4px);background:rgba(245,166,35,.05);pointer-events:none;z-index:1;}',
    '.ann-frame{position:absolute;box-sizing:border-box;border:2px dashed #f5a623;background:rgba(245,166,35,.06);border-radius:var(--wb-r-2,6px);pointer-events:none;z-index:1;}',
    '#ann-lasso{position:absolute;border:2px dashed #f5a623;background:rgba(245,166,35,.1);border-radius:var(--wb-r-1,4px);pointer-events:none;}',
    // 悬停提示：反色气泡，与 vendored tooltip（bg-foreground/text-background）同语言。
    '#ann-tip{position:absolute;z-index:2;max-width:min(280px,calc(100% - 24px));background:var(--wb-fg,#1c2024);color:var(--wb-surface,#fff);font-size:12px;line-height:1.4;padding:7px 12px;border-radius:var(--wb-r-2,6px);pointer-events:none;word-break:break-word;}',
    // composer：V4 收编浮层白面语言（白面 + 发丝 + sh-3 + r-4），摘掉 backdrop blur 与重阴影。
    '#ann-box{position:absolute;z-index:5;left:24px;right:24px;bottom:72px;top:auto;width:auto;max-width:460px;max-height:calc(100vh - 24px);margin:0 auto;overflow:auto;background:var(--wb-surface,#fff);border:1px solid rgba(0,0,0,.08);border-radius:26px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:20px;pointer-events:auto;}',
    '[data-ann-ui],[data-ann-ui] *{scrollbar-width:none}[data-ann-ui]::-webkit-scrollbar,[data-ann-ui] *::-webkit-scrollbar{display:none}',
    '#ann-input{display:block;min-height:24px;max-height:min(240px,calc(100vh - 150px));overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;outline:none;line-height:24px;font-size:15px;padding:0;margin-top:0;border:0;border-radius:0;background:transparent;box-shadow:none}',
    '#ann-box #ann-input:hover,#ann-box #ann-input:focus{background:transparent;box-shadow:none;outline:none}',
    '#ann-input:empty:before{content:attr(data-placeholder);color:var(--wb-muted,#888);pointer-events:none}',
    '#ann-input .ann-inline-target{display:inline-flex;vertical-align:baseline;align-items:center;max-width:120px;border-radius:6px;padding:0 6px;background:rgba(0,0,0,.045);color:#555;line-height:22px;font-size:12px;white-space:nowrap}',
    '#ann-input .ann-inline-target>span{overflow:hidden;text-overflow:ellipsis}#ann-input .ann-inline-remove{background:none;padding:0 0 0 4px;opacity:0}#ann-input .ann-inline-target:hover .ann-inline-remove,#ann-input .ann-inline-target:focus-within .ann-inline-remove{opacity:1}',
    '#ann-box .acts{justify-content:space-between;align-items:center}#ann-box .ann-tools{position:relative;display:flex;align-items:center;gap:6px}#ann-box #ann-plus{font-size:22px;padding:0;width:30px;height:30px;background:transparent}',
    '#ann-tools-menu{position:absolute;bottom:36px;left:0;background:var(--wb-surface,#fff);box-shadow:var(--wb-sh-3);border-radius:10px;padding:4px;min-width:140px;z-index:6}#ann-tools-menu:not([hidden]){display:flex;flex-direction:column}#ann-tools-menu button{display:flex;gap:8px;align-items:center;background:transparent;text-align:left}',
    '#ann-mode-pills{display:flex;gap:4px}#ann-box .ann-mode-pill{border-radius:999px;font-size:11px}#ann-box .ann-mode-pill span{opacity:0;margin-left:5px}#ann-box .ann-mode-pill:hover span,#ann-box .ann-mode-pill:focus-visible span{opacity:1}',
    '#ann-box #ann-save{border-radius:999px;height:36px;font-size:14px;font-weight:500;padding:0 17px;background:#111;color:#fff}#ann-box #ann-save:hover{background:#292929}#ann-imgs{margin-top:0;margin-bottom:12px}#ann-imgs:empty{display:none}',
    '#ann-box .t{font-size:11px;color:var(--wb-faint,#8d8d8d);line-height:1.45;margin-right:32px}',
    '#ann-box #ann-cancel{border:1px solid rgba(0,0,0,.1);border-radius:999px;height:36px;padding:0 15px;font-size:14px;background:transparent}#ann-box #ann-del{display:grid;place-items:center;width:32px;height:36px;padding:0;color:#555;background:transparent}#ann-box #ann-del:hover{color:var(--wb-danger,#b84230);background:rgba(0,0,0,.04)}#ann-box #ann-del svg{width:18px;height:18px}',
    '#ann-box .ann-submit-actions{display:flex;align-items:center;gap:8px}',
    '.ann-target.ann-draft-target{border-color:#f5a623;background:rgba(245,166,35,.11);box-shadow:0 0 0 2px rgba(245,166,35,.13);}',
    '#ann-box .acts{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;margin-top:28px;}',
    '#ann-box button{border:none;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:var(--wb-r-2,6px);background:var(--wb-hover,rgba(0,0,0,.04));color:var(--wb-fg,#1c2024);white-space:nowrap;transition:background var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1)),color var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1));}',
    '#ann-box button:hover{background:var(--wb-fill,rgba(0,0,0,.055));}',
    '#ann-box button.dark{background:var(--wb-accent,#5b7fa6);color:var(--wb-surface,#fff);font-weight:var(--wb-w-semibold,600);}',
    '#ann-box button.dark:hover{background:color-mix(in srgb,var(--wb-accent,#5b7fa6) 90%,transparent);}',
    '#ann-box button.warn{color:var(--wb-danger,#b84230);background:transparent;}',
    '#ann-box button.warn:hover{background:color-mix(in srgb,var(--wb-danger,#b84230) 10%,transparent);color:var(--wb-danger,#b84230);}',
    '#ann-box button:disabled{opacity:.4;cursor:not-allowed;}',
    '#ann-box button:disabled:hover{background:var(--wb-hover,rgba(0,0,0,.04));}',
    '#ann-box .hint{font-size:10px;color:var(--wb-faint,#8d8d8d);margin-top:6px;}',
    '#ann-mention{position:absolute;z-index:6;min-width:200px;max-width:min(280px,calc(100% - 24px));max-height:180px;overflow:auto;background:var(--wb-surface,#fff);border-radius:var(--wb-r-4,12px);box-shadow:var(--wb-sh-3,0 1px 2px rgba(0,0,0,.06),0 14px 38px rgba(0,0,0,.16));border:0;padding:4px;pointer-events:auto;}',
    '#ann-mention .ann-men-item{display:flex;gap:8px;align-items:flex-start;width:100%;border:0;background:transparent;text-align:left;font:inherit;padding:7px 8px;border-radius:var(--wb-r-3,8px);cursor:pointer;color:var(--wb-fg,#1c2024);}',
    '#ann-mention .ann-men-item.on,#ann-mention .ann-men-item:hover{background:var(--wb-hover,rgba(0,0,0,.04));}',
    '#ann-mention .ann-men-n{flex:none;font-size:11px;font-weight:var(--wb-w-bold,700);color:#f5a623;min-width:1.5em;}',
    '#ann-mention .ann-men-body{flex:1;min-width:0;font-size:12px;line-height:1.35;color:var(--wb-muted,#6b6b70);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}',
    '#ann-mention .ann-men-empty{padding:10px 8px;font-size:12px;color:var(--wb-faint,#8d8d8d);}',
    '#ann-imgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
    '#ann-imgs:empty{display:none;margin:0;}',
    '#ann-imgs .im{position:relative;width:56px;height:56px;border-radius:var(--wb-r-3,8px);overflow:hidden;border:0;}',
    '#ann-imgs .im img{width:100%;height:100%;object-fit:cover;display:block;}',
    '#ann-imgs .im .x{position:absolute;top:1px;right:1px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:16px;text-align:center;cursor:pointer;}',
    '@keyframes annFlash{0%,100%{background:rgba(245,166,35,.07);box-shadow:none}15%,85%{background:rgba(245,166,35,.2);box-shadow:0 0 0 4px rgba(245,166,35,.22)}}',
    '.ann-hover-ghost.ann-flash{animation:annFlash 1.5s ease-out}',
    // a11y 基线：注入的每个控件都要有可见 focus 态；reduced-motion 下关掉全部过渡/动画。
    // focus 环与 workbench 全局 catch-all 同式（accent color-mix，V4 起双端一致）。
    '[data-ann-ui] :is(button,a,input,textarea,select,[tabindex]):focus-visible{outline:2px solid color-mix(in srgb,var(--wb-accent,#5b7fa6) 55%,transparent);outline-offset:1px;}',
    '@media (prefers-reduced-motion: reduce){[data-ann-ui],[data-ann-ui] *,[data-ann-ui] *::before,[data-ann-ui] *::after{transition:none !important;animation:none !important;}}',
    // mention 空态不渲染盒子 Chrome —— 带边框阴影的空态看起来像坏掉的输入框。
    '#ann-mention:has(.ann-men-empty){min-width:0;border:0;box-shadow:none;background:transparent;}',
    '#ann-mention .ann-men-empty{padding:6px 8px;}',
    // composer / 侧栏动作钮里的线性图标（lucide 风格内联 SVG，替代 emoji）。
    '#ann-box button svg{display:inline-block;width:13px;height:13px;vertical-align:-2px;}',
    '#ann-box .acts button{display:inline-flex;align-items:center;gap:5px;}',
    '#ann-sidebar .ann-sb-acts button svg{display:block;width:12px;height:12px;margin:auto;}',
    bubbleCss()
  ].join('\n');
  document.head.appendChild(style);

  var overlay = document.createElement('div');
  overlay.id = 'ann-overlay'; overlay.setAttribute('data-ann-ui', '');
  var marksLayer = document.createElement('div');
  marksLayer.id = 'ann-marks';
  var bubblesLayer = document.createElement('div');
  bubblesLayer.id = 'ann-bubbles';
  bubblesLayer.setAttribute('data-ann-ui', '');
  var hoverLayer = document.createElement('div');
  hoverLayer.id = 'ann-hover-layer';
  var chromeLayer = document.createElement('div');
  chromeLayer.id = 'ann-chrome';
  overlay.appendChild(marksLayer);
  overlay.appendChild(bubblesLayer);
  overlay.appendChild(hoverLayer);
  overlay.appendChild(chromeLayer);
  bubblesLayer.style.display = renderComments ? '' : 'none';
  // SPA 路由可能重建挂载点，switchLedger 复用这套逻辑重挂。
  function mountOverlay(modal) {
    var stageWrap = document.querySelector('.wb-stage-wrap');
    if (modal && modal.matches('dialog:modal')) {
      // Native modal dialogs make nodes outside their subtree inert, even when
      // those nodes are painted in the top layer. Keep the composer inside it.
      overlay.setAttribute('data-ann-viewport', '');
      modal.appendChild(overlay);
    } else if (stageWrap) {
      overlay.removeAttribute('data-ann-viewport');
      stageWrap.appendChild(overlay);
    } else {
      // 没有 workbench 舞台时（独立 HTML 文档、HTML 板 iframe 里的汇报页），overlay
      // 只能挂 body。此时 position:absolute + inset:0 的包含块是初始包含块——overlay
      // 锚在文档原点、尺寸只有一屏、还带 overflow:hidden，于是一往下滚，命中框和
      // 标注框全被裁掉，表现成「标注模式点了没反应」。贴视口即可，origin 恒为 (0,0)。
      overlay.setAttribute('data-ann-viewport', '');
      document.body.appendChild(overlay);
    }
    if (typeof overlay.showPopover === 'function') {
      overlay.setAttribute('popover', 'manual');
      if (!overlay.matches(':popover-open')) overlay.showPopover();
    }
    _originCache = null; // 挂载点/模式变了 origin 语义也变，缓存作废
  }
  mountOverlay();
  document.addEventListener('close', function (event) {
    if (event.target === overlay.parentElement) { mountOverlay(); renderAll(); }
  }, true);
  var hoverGhost = null;

  var toolbar = document.createElement('div');
  toolbar.id = 'ann-toolbar'; toolbar.setAttribute('data-ann-ui', '');
  toolbar.innerHTML = '<button id="ann-toggle">标注</button><button id="ann-comments" title="在画布渲染评论">评论</button><button id="ann-channel" title="评论布局：压字 / 留通道" hidden>压字</button><button id="ann-list" title="标注列表 (S)">列表</button><button id="ann-workbench" title="在新标签页打开 workbench">打开 workbench</button><button id="ann-clear">清空标记</button><span id="ann-count">0 条</span><span id="ann-status"></span><button id="ann-hide">暂停</button>';
  toolbar.style.display = 'none';
  document.body.appendChild(toolbar);

  var btnToggle = toolbar.querySelector('#ann-toggle');
  var btnComments = toolbar.querySelector('#ann-comments');
  var btnChannel = toolbar.querySelector('#ann-channel');
  var btnList = toolbar.querySelector('#ann-list');
  // 回 workbench 的路（2026-09-04，BACKLOG「空态与错误面板」）：/sites/ 页面与
  // 扩展注入页都是从 workbench 之外进来的，之前只能靠记住 URL 走回去。
  // 服务 origin 取自脚本自己的 src（SERVER），拿不到时回落当前 origin。
  var btnWorkbench = toolbar.querySelector('#ann-workbench');
  var btnHide = toolbar.querySelector('#ann-hide');
  var btnClear = toolbar.querySelector('#ann-clear');
  var elCount = toolbar.querySelector('#ann-count');
  var elStatus = toolbar.querySelector('#ann-status');

  function setStatus(msg, err) {
    elStatus.textContent = msg; elStatus.className = err ? 'err' : '';
  }

  function syncModeClass() {
    document.documentElement.classList.toggle('ann-mode-on', mode && !paused);
  }

  var flashUntil = 0; // goToMark 闪烁框的保护窗口（syncGhost 在此期间不收 ghost）

  function ensureHoverGhost() {
    if (!hoverGhost) {
      hoverGhost = document.createElement('div');
      hoverGhost.className = 'ann-hover-ghost';
      hoverGhost.setAttribute('data-ann-ui', '');
      hoverGhost.hidden = true;
      hoverLayer.appendChild(hoverGhost);
    }
    return hoverGhost;
  }

  function showGhostForEl(el, extraClass) {
    if (!el) { hideGhost(); return; }
    var viewR = visibleViewRectOf(el);
    if (!viewR) { hideGhost(); return; }
    var g = ensureHoverGhost();
    g.className = 'ann-hover-ghost' + (extraClass ? ' ' + extraClass : '');
    placeOverlayRect(g, viewR);
    g.hidden = false;
  }

  function hideGhost() {
    if (hoverGhost) {
      hoverGhost.hidden = true;
      hoverGhost.classList.remove('ann-flash');
    }
  }

  function showGhostForRect(r, extraClass, clipEl) {
    var viewR = visibleViewRectDoc(r, clipEl || null);
    if (!viewR) { hideGhost(); return; }
    var g = ensureHoverGhost();
    g.className = 'ann-hover-ghost' + (extraClass ? ' ' + extraClass : '');
    placeOverlayRect(g, viewR);
    g.hidden = false;
  }
  function ghostTarget() {
    if (pinned) return pinned;
    return hoverEl;
  }

  function syncToolbarUi() {
    btnToggle.className = mode ? 'on' : '';
    btnToggle.textContent = mode ? '标注' : '交互';
    btnToggle.title = mode ? '标注模式 (A → 交互)' : '交互模式 (A → 标注)';
    btnHide.className = paused ? 'on' : '';
    btnComments.className = renderComments ? 'on' : '';
    btnComments.textContent = renderComments ? '评论✓' : '评论';
    btnComments.title = renderComments ? '在画布渲染评论（点击关闭）' : '在画布渲染评论';
    if (btnChannel) {
      btnChannel.hidden = !renderComments;
      var layoutLabel = bubbleLayout === 'sidebar' ? 'sidebar' : 'inline';
      btnChannel.className = bubbleLayout === 'sidebar' ? 'on' : '';
      btnChannel.textContent = layoutLabel;
      btnChannel.title = '评论布局：' + layoutLabel + '（点击切换 inline ↔ sidebar）';
    }
    if (btnList) {
      btnList.className = sidebarOpen ? 'on' : '';
      btnList.hidden = sidebarSuppressed();
    }
    // workbench 壳页 / 被嵌入的 frame 上不出这个钮 —— 那里已经在 workbench 里
    if (btnWorkbench) btnWorkbench.hidden = sidebarSuppressed();
    syncModeClass();
  }

  function syncGhost() {
    if (navigationActive) { hideGhost(); return; }
    // ann-flash 展示期间（goToMark 跳转）滚动/几何重算不得收掉闪烁框，
    // 否则跳转一闪即逝；显式 hideGhost（暂停、切账本等）不受影响。
    if (Date.now() < flashUntil) return;
    var el = ghostTarget();
    if (el) showGhostForEl(el);
    else hideGhost();
  }

  function notify() {
    syncToolbarUi();
    updateListeners.forEach(function (fn) {
      try { fn(); } catch (e) { if (console && console.error) console.error('[annotate] listener', e); }
    });
  }

  function toggleMode() {
    mode = !mode;
    // 模式标记：扩展 content script 的 page-info 应答把它捎给侧边栏面板。
    document.documentElement.setAttribute('data-pinpoint-mode', mode ? 'annotate' : 'interact');
    if (!mode) { clearHover(); closeComposer(); }
    propagateModeToFrames();
    notify();
  }
  btnToggle.addEventListener('click', toggleMode);

  // 文档里的标注/交互开关对嵌入 frame 同样生效（阶段 5）：doc 实例切换时把
  // 模式推进每个 mention 水合出的 frame iframe（同源直调；frame 内 annotate
  // 实例各自独立）。frame 实例启动时也会反向领养父级当前模式（见 boot）。
  function propagateModeToFrames() {
    var frames = document.querySelectorAll('iframe[data-pinpoint-frame-iframe]');
    for (var i = 0; i < frames.length; i++) {
      try {
        var w = frames[i].contentWindow;
        if (w && w.pinpoint && typeof w.pinpoint.setMode === 'function') w.pinpoint.setMode(mode);
      } catch (e) { /* 跨域防御（本设计全同源，不会走到） */ }
    }
  }

  function setRenderComments(on) {
    on = !!on;
    if (renderComments === on) return;
    renderComments = on;
    bubblesLayer.style.display = on ? '' : 'none';
    if (on) renderAll();
    else { clearBubbles(); }
    notify();
  }
  btnComments.addEventListener('click', function () { setRenderComments(!renderComments); });

  /** 评论布局二态切换：inline(iframe overlay) ↔ sidebar(父级 gutter)。
   *  sidebar 模式下 iframe 内不画气泡（由父级 workbench 在右侧 gutter 渲染）。 */
  function setBubbleLayout(layout) {
    if (layout !== 'inline' && layout !== 'sidebar') layout = 'inline';
    if (bubbleLayout === layout) return;
    bubbleLayout = layout;
    if (renderComments) renderAll();
    notify();
  }
  if (btnChannel) btnChannel.addEventListener('click', function () {
    setBubbleLayout(bubbleLayout === 'inline' ? 'sidebar' : 'inline');
  });

  // 快捷键 A：切换标注模式（输入框内打字/组字中不触发）
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'a' && e.key !== 'A') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleMode();
  });

  // 快捷键 S：开合标注面板（次要入口，主入口是扩展图标；守卫同 A；看列表是只读行为，标注/交互模式都可用）
  document.addEventListener('keydown', function (e) {
    if (e.key !== 's' && e.key !== 'S') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleSidebar();
  });

  function setPaused(on) {
    on = !!on;
    if (paused === on) return;
    paused = on;
    overlay.style.display = paused ? 'none' : '';
    if (paused) { clearHover(); closeComposer(); drag = null; }
    else { renderAll(); }
    notify();
  }

  btnHide.addEventListener('click', function () { setPaused(!paused); });

  function resultTargets(mark) {
    return ((mark.result && mark.result.operations) || []).flatMap(function (operation) { return operation.targets || []; });
  }

  function resultScope(screenId) {
    if (FRAME) return FRAME.screenId === screenId || !screenId ? document : null;
    if (!screenId) return document.getElementById('wb-board-panel') || document;
    return document.querySelector('.wb-screen[data-screen="' + CSS.escape(screenId) + '"]');
  }

  function findResultTarget(target) {
    var scope = resultScope(target.screenId);
    if (!scope) return null;
    try {
      var matches = scope.querySelectorAll(target.selector);
      return matches.length === 1 && !isUI(matches[0]) ? matches[0] : null;
    } catch (_) { return null; }
  }

  var resultWriting = false;
  async function recordResults(id, operations, options) {
    options = options || {};
    if (options.baseRevision !== revision) throw new Error('revision_conflict: refresh annotations before reporting results');
    if (syncing || ledgerSwitching || resultWriting || activeComposer || mutationVersion !== syncedMutationVersion) throw new Error('annotation_busy: finish the current edit first');
    var mark = marks.find(function (item) { return item.id === id; });
    if (!mark || !markOnActivePage(mark)) throw new Error('annotation_not_on_current_page');
    if (!Array.isArray(operations) || !operations.length) throw new Error('operations_required');
    var normalized = operations.map(function (operation) {
      if (!operation || ['add', 'modify', 'move', 'delete'].indexOf(operation.action) < 0) throw new Error('invalid_operation');
      if (operation.action === 'delete') {
        if (operation.targets && operation.targets.length) throw new Error('deleted_operation_has_no_result_target');
        return { action: 'delete', targets: [] };
      }
      if (!Array.isArray(operation.targets) || !operation.targets.length) throw new Error('result_target_required');
      return { action: operation.action, targets: operation.targets.map(function (target) {
        if (!target || typeof target.selector !== 'string' || !target.selector.trim()) throw new Error('selector_required');
        if (target.pageId && target.pageId !== mark.pageId) throw new Error('result_page_mismatch');
        var candidate = { selector: target.selector, screenId: target.screenId || mark.screenId || '' };
        var el = findResultTarget(candidate);
        if (!el) throw new Error('result_target_must_exist_and_be_unique');
        candidate.text = excerpt(el);
        return candidate;
      }) };
    });
    var next = marks.map(function (item) { return item.id === id ? Object.assign({}, item, { result: { operations: normalized, updatedAt: new Date().toISOString() } }) : item; });
    var epoch = syncEpoch;
    resultWriting = true;
    try {
      var response = await fetch(SERVER + '/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: PAGE, entry: ENTRY, path: decodeURIComponent(LEDGER_PATHNAME), baseRevision: options.baseRevision, annotations: next }) });
      var doc = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'revision_conflict' : 'result_save_failed');
      if (epoch === syncEpoch) applyRemoteDoc(doc, '结果已同步');
      return { id: id, revision: doc.revision, result: next.find(function (item) { return item.id === id; }).result };
    } finally { resultWriting = false; }
  }

  // Missing DOM is conclusive only inside a loaded scope. Hidden elements are
  // still present and must never be cleared merely because they cannot paint.
  function canClearInvalid(mark, scopes) {
    function loadedScope(screenId) {
      if (scopes && scopes.has(screenId)) return scopes.get(screenId);
      var scope = resultScope(screenId);
      var loading = '.wb-screen-loading,.wb-screen-err,[data-loading="true"],[aria-busy="true"]';
      var loaded = scope && !(scope.matches && scope.matches(loading)) && !scope.querySelector(loading) ? scope : null;
      if (scopes) scopes.set(screenId, loaded);
      return loaded;
    }
    if (!markOnActivePage(mark) || ledgerSwitching || document.readyState !== 'complete') return false;
    if (mark.result && mark.result.operations.some(function (op) { return op.action === 'delete'; })) return false;
    if (!loadedScope(mark.screenId || '')) return false;
    var selectors = mark.type === 'element' ? markElementTargets(mark).map(function (target) { return target.selector; }) : [mark.base && mark.base.selector].concat((mark.contains || []).map(function (target) { return target.selector; })).filter(Boolean);
    if (!selectors.length) return false;
    if (selectors.some(function (selector) { return !!resolveMarkSelector(selector, mark.screenId || ''); })) return false;
    return resultTargets(mark).every(function (target) { return !!loadedScope(target.screenId) && !findResultTarget(target); });
  }

  function clearInvalid() {
    if (resultWriting || activeComposer) return false;
    clearAnchorCache();
    var scopes = new Map();
    var invalid = marks.filter(function (mark) { return canClearInvalid(mark, scopes); });
    if (!invalid.length) return 0;
    var ids = new Set(invalid.map(function (mark) { return mark.id; }));
    marks = marks.filter(function (mark) { return !ids.has(mark.id); });
    persist();
    return invalid.length;
  }

  var resultNodes = new Map();
  var resultMarks = [];
  var resultGeometry = [];
  var resultPose = null;
  var resultLayer = null;
  function renderResultIndicators(refresh) {
    if (refresh) resultMarks = marksForActivePage().filter(function (mark) { return resultTargets(mark).length; });
    if (!resultMarks.length && !resultNodes.size) return;
    if (!overlay) return;
    if (!resultLayer) {
      resultLayer = document.createElement('div');
      resultLayer.setAttribute('data-ann-ui', '');
      resultLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none';
      hoverLayer.appendChild(resultLayer);
    }
    // Canvas targets are measured only when content/layout changes. Pure pan
    // translates one layer; zoom projects cached canvas coordinates, like marks.
    if (refresh || !canvasView) {
      beginOverlayFrame();
      measuringCanvas = !!canvasView;
      try {
        resultGeometry = geometryBatch(function () {
          var geometry = [];
          resultMarks.forEach(function (mark) {
            resultTargets(mark).forEach(function (target, index) {
              var el = findResultTarget(target);
              var rect = el && !isHidden(el) ? visibleViewRectOf(el) : null;
              if (!rect) return;
              rect = markLocalRect(rect);
              if (canvasView) {
                var pose = canvasView.pose;
                rect = [(rect[0] - pose.x) / pose.zoom, (rect[1] - pose.y) / pose.zoom, rect[2] / pose.zoom, rect[3] / pose.zoom];
              }
              geometry.push({ key: mark.id + ':' + index, mark: mark, rect: rect });
            });
          });
          return geometry;
        });
      } finally { measuringCanvas = false; }
      resultPose = null;
    }
    var pose = canvasView && canvasView.pose;
    if (!pose || resultPose !== pose) {
      var present = new Set();
      resultGeometry.forEach(function (item) {
        present.add(item.key);
        var node = resultNodes.get(item.key);
        if (!node) {
          node = document.createElement('div'); node.className = 'ann-result-target'; node.dataset.resultAnnotation = item.mark.id;
          node.setAttribute('data-ann-ui', '');
          var badge = document.createElement('button'); badge.type = 'button'; badge.textContent = item.mark.n;
          badge.setAttribute('aria-label', '查看标注 ' + item.mark.n + ' 的执行结果');
          badge.addEventListener('click', function () { openMark(item.mark.n); });
          node.appendChild(badge); resultLayer.appendChild(node); resultNodes.set(item.key, node);
        }
        var r = item.rect;
        placeFixedRect(node, pose ? [r[0] * pose.zoom + pose.x, r[1] * pose.zoom + pose.y, r[2] * pose.zoom, r[3] * pose.zoom] : r);
      });
      resultNodes.forEach(function (node, key) { if (!present.has(key)) { node.remove(); resultNodes.delete(key); } });
      resultPose = pose;
    }
    resultLayer.style.transform = canvasView ? 'translate3d(' + (-canvasView.stage.scrollLeft) + 'px,' + (-canvasView.stage.scrollTop) + 'px,0)' : '';
  }

  function doClear() {
    if (resultWriting) return false;
    marks = marks.filter(function (k) { return !markOnActivePage(k); });
    closeComposer({ silentRender: true });
    persist();
    btnClear.className = 'ok'; btnClear.textContent = '已清空 ✓';
    setTimeout(function () { btnClear.className = ''; btnClear.textContent = '清空标记'; }, 2000);
  }

  function removeMark(n) {
    if (resultWriting) return false;
    n = parseInt(n, 10);
    if (!isFinite(n)) return false;
    var before = marks.length;
    marks = marks.filter(function (k) { return k.n !== n; });
    if (marks.length === before) return false;
    var open = document.getElementById('ann-box');
    if (open) closeComposer({ silentRender: true });
    persist();
    return true;
  }

  btnClear.addEventListener('click', doClear);

  // ---------- 标注面板（#ann-sidebar）----------
  // 没有 workbench 的页面（/sites/ 注入、扩展注入、SPA）的标注控制面：顶部
  // 「交互 | 标注」segmented 切 mode，下面当前账本按 n 列出，点击跳转
  // （goToMark），hover 出编辑/删除。主入口 = 浏览器工具栏扩展图标（见下方
  // pinpoint:command 监听），次要入口 = 工具条「列表」按钮、S 键。抑制规则与
  // 浮动工具条同款「单一控制面」：workbench 壳有自己的标注列表；doc iframe
  // 由父级出控制面。
  var SIDEBAR_LS_KEY = 'pinpoint:' + ENTRY + ':sidebar-open';
  var sidebar = null;
  var sidebarBody = null;
  var sidebarCount = null;
  var sidebarSegInteract = null;
  var sidebarSegAnnotate = null;
  var sidebarSig = '';

  function sidebarSuppressed() {
    if (window.workbench) return true;                       // workbench 壳：列表在左栏
    if (window.top !== window.self) return true;             // 被嵌入（workbench doc iframe 等）
    return false;
  }

  function sidebarRowModel() {
    // 行字段走共享模型（src/shared/ann-row.js，serve 时内联）；默认 cap 语义即
    // client 现状：框选显示「框选区域」，无 text 时回退 selector 末段摘录。
    return marksForActivePage().slice().sort(function (a, b) { return a.n - b.n; }).map(function (m) {
      return annRowModel(m, {
        preview: annRowPreview(contentToDisplay(annotationContent(m), markElementTargets(m))),
        broken: isMarkBroken(m)
      });
    });
  }

  function ensureSidebar() {
    if (sidebar) return sidebar;
    sidebar = document.createElement('div');
    sidebar.id = 'ann-sidebar'; sidebar.setAttribute('data-ann-ui', '');
    sidebar.hidden = true;
    // 骨架是静态字符串（无注入面）；所有动态内容仍走 textContent 构建。
    sidebar.innerHTML =
      '<div class="ann-sb-head">' +
      '<span class="ann-sb-title">标注</span>' +
      '<span class="ann-sb-count"></span>' +
      '<button type="button" class="ann-sb-close" title="关闭 (S)">×</button>' +
      '</div>' +
      '<div class="ann-sb-modes" role="group" aria-label="模式切换">' +
      '<button type="button" data-ann-mode="interact" aria-pressed="true">交互</button>' +
      '<button type="button" data-ann-mode="annotate" aria-pressed="false">标注</button>' +
      '</div>' +
      '<div class="ann-sb-body"></div>';
    document.body.appendChild(sidebar);
    sidebar.querySelector('.ann-sb-close').addEventListener('click', function () { setSidebarOpen(false); });
    sidebarBody = sidebar.querySelector('.ann-sb-body');
    sidebarCount = sidebar.querySelector('.ann-sb-count');
    sidebarSegInteract = sidebar.querySelector('[data-ann-mode="interact"]');
    sidebarSegAnnotate = sidebar.querySelector('[data-ann-mode="annotate"]');
    // segmented 是 setMode 的纯鼠标入口（同 pinpoint.setMode 语义）。
    sidebarSegInteract.addEventListener('click', function () { if (mode) toggleMode(); });
    sidebarSegAnnotate.addEventListener('click', function () { if (!mode) toggleMode(); });
    sidebarBody.addEventListener('click', function (e) {
      var act = e.target && e.target.closest ? e.target.closest('[data-ann-act]') : null;
      if (act) {
        e.preventDefault();
        e.stopPropagation();
        var an = parseInt(act.getAttribute('data-ann-n'), 10);
        if (act.getAttribute('data-ann-act') === 'del') {
          if (act.dataset.confirm === 'true') removeMark(an);
          else { act.dataset.confirm = 'true'; act.textContent = '确认'; act.setAttribute('aria-label', '确认删除标注 ' + an); }
        }
        return;
      }
      var row = e.target && e.target.closest ? e.target.closest('.wb-ann-item[data-ann-n]') : null;
      if (!row) return;
      goToMark(parseInt(row.getAttribute('data-ann-n'), 10)).then(function (completed) { if (completed !== false) setSidebarOpen(false); });
    });
    return sidebar;
  }

  function renderSidebar() {
    if (!sidebar) return;
    if (sidebarSuppressed()) { sidebar.hidden = true; return; }
    if (sidebar.hidden) return;
    // segmented 每次 notify 都同步（sig 只挡列表重建，不挡模式反映）。
    sidebarSegInteract.classList.toggle('on', !mode);
    sidebarSegInteract.setAttribute('aria-pressed', String(!mode));
    sidebarSegAnnotate.classList.toggle('on', !!mode);
    sidebarSegAnnotate.setAttribute('aria-pressed', String(!!mode));
    var rows = sidebarRowModel();
    // sig 比对（同 workbench 列表）：marks 没变的 notify（模式切换等）不重建 DOM。
    var sig = rows.map(function (r) {
      return r.n + '|' + r.cap + '|' + r.preview + '|' + r.broken + '|' + r.tags;
    }).join('~');
    sidebarCount.textContent = rows.length ? '(' + rows.length + ')' : '';
    if (sig === sidebarSig) return;
    sidebarSig = sig;
    sidebarBody.textContent = '';
    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'wb-ann-empty';
      var emptyTitle = document.createElement('p');
      emptyTitle.className = 'wb-ann-empty-title';
      emptyTitle.textContent = '暂无标注';
      var emptyHint = document.createElement('p');
      emptyHint.className = 'wb-ann-empty-hint';
      emptyHint.textContent = '点上方「标注」进入标注模式，再点选页面元素添加标注';
      empty.appendChild(emptyTitle);
      empty.appendChild(emptyHint);
      sidebarBody.appendChild(empty);
      return;
    }
    rows.forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'wb-ann-item' + (r.broken ? ' wb-ann-item--broken' : '');
      item.setAttribute('data-ann-n', r.n);
      var main = document.createElement('button');
      main.type = 'button';
      main.className = 'wb-ann-item-main';
      var num = document.createElement('span');
      num.className = 'wb-ann-num';
      num.textContent = r.n;
      var body = document.createElement('span');
      body.className = 'wb-ann-body';
      var cap = document.createElement('span');
      cap.className = 'wb-ann-cap';
      cap.textContent = r.cap;
      body.appendChild(cap);
      if (r.preview) {
        var text = document.createElement('span');
        text.className = 'wb-ann-text';
        text.textContent = r.preview;
        body.appendChild(text);
      }
      if (r.broken) {
        var tag = document.createElement('span');
        tag.className = 'wb-ann-broken-tag';
        tag.textContent = '锚点失效';
        body.appendChild(tag);
      }
      main.appendChild(num);
      main.appendChild(body);
      var acts = document.createElement('span');
      acts.className = 'ann-sb-acts';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ann-sb-del';
      del.setAttribute('data-ann-act', 'del');
      del.setAttribute('data-ann-n', r.n);
      del.title = '删除';
      function resetDelete() { delete del.dataset.confirm; del.innerHTML = annIcon('trash'); del.setAttribute('aria-label', '删除标注 ' + r.n); }
      resetDelete();
      del.addEventListener('blur', resetDelete);
      acts.appendChild(del);
      item.appendChild(main);
      item.appendChild(acts);
      sidebarBody.appendChild(item);
    });
  }

  function setSidebarOpen(on) {
    on = !!on;
    if (on && sidebarSuppressed()) return; // 让位控制面；不动 viewer 偏好
    if (sidebarOpen === on) return;
    sidebarOpen = on;
    try { localStorage.setItem(SIDEBAR_LS_KEY, on ? '1' : ''); } catch (e) { /* quota */ }
    document.documentElement.classList.toggle('ann-sidebar-open', on);
    if (on) {
      ensureSidebar();
      sidebar.hidden = false;
      renderSidebar();
    } else if (sidebar) {
      sidebar.hidden = true; sidebarSig = '';
    }
    if (activeComposer && activeComposer.syncLayout) activeComposer.syncLayout();
    notify();
  }

  function toggleSidebar() { setSidebarOpen(!sidebarOpen); }

  // 扩展命令通道（content script 经共享 DOM CustomEvent 桥进主世界，内联
  // script 会被 CSP 拦，见 extension/content.js 头注）：
  //   toggle-sidebar —— 页面内 #ann-sidebar 开合（S 键/「列表」按钮之外的桥入口）
  //   jump/edit/del  —— Chrome Side Panel 面板远程驱动（跳转/编辑/删除）
  //   mode {on}      —— 面板的「交互 | 标注」分段开关
  // 抑制规则不变：workbench 壳/被嵌入页 setSidebarOpen 自会让位。
  document.addEventListener('pinpoint:command', function (e) {
    var d = e.detail || {};
    var cmd = d.command;
    if (cmd === 'toggle-sidebar') toggleSidebar();
    else if (cmd === 'jump') goToMark(d.n);
    else if (cmd === 'edit') openMark(d.n);
    else if (cmd === 'del') removeMark(d.n);
    else if (cmd === 'mode') { if (!!d.on !== !!mode) toggleMode(); }
  });
  // 初始模式标记（后续变化由 toggleMode 里更新）。
  document.documentElement.setAttribute('data-pinpoint-mode', mode ? 'annotate' : 'interact');

  if (btnList) btnList.addEventListener('click', function () { toggleSidebar(); });
  if (btnWorkbench) btnWorkbench.addEventListener('click', function () {
    window.open((SERVER || location.origin) + '/index.html', '_blank', 'noopener');
  });
  updateListeners.push(renderSidebar);
  (function () {
    var want = false;
    try { want = localStorage.getItem(SIDEBAR_LS_KEY) === '1'; } catch (e) { /* */ }
    if (want) setSidebarOpen(true);
  })();

  // ---------- 悬停高亮（挂在 stage-wrap overlay，不盖侧栏）----------
  function clearHover() {
    hoverEl = null;
    // ann-flash 展示窗口内不动 ghost：跳转后的鼠标经过不得掐灭闪烁反馈。
    if (!pinned && Date.now() >= flashUntil) hideGhost();
  }
  var hoverSuppress = null; // 拖拽松手后 2s 内、鼠标没走远时不再出 hover 框
  document.addEventListener('mousemove', function (e) {
    var openComposer = document.getElementById('ann-box');
    if (!mode || paused || navigationActive || drag || arrowFrom || openComposer) { clearHover(); return; }
    if (hoverSuppress) {
      if (Date.now() < hoverSuppress.until && Math.hypot(e.pageX - hoverSuppress.x, e.pageY - hoverSuppress.y) < 120) {
        clearHover(); return;
      }
      hoverSuppress = null;
    }
    var el = annTargetAt(e.clientX, e.clientY, { promoteFrame: !!e.altKey });
    if (!el) { clearHover(); return; }
    if (el !== hoverEl) { hoverEl = el; syncGhost(); }
  }, true);

  // ---------- 点选 / 框选 / 箭头 ----------
  var lasso = null;
  var draftNodes = [];   // active composer targets [{ frame, badge, selector }]

  function clearDraftNodes() {
    draftNodes.forEach(function (p) {
      if (p.frame && p.frame.parentNode) p.frame.parentNode.removeChild(p.frame);
      if (p.badge && p.badge.parentNode) p.badge.parentNode.removeChild(p.badge);
    });
    draftNodes = [];
  }

  function placePartGeometry(part, el) {
    if (!part || !el) return;
    var viewR = visibleViewRectOf(el);
    if (!viewR) {
      hidePartNodes(part);
      return;
    }
    showPartNodes(part);
    var local = expandRect(viewToOverlayRect(viewR));
    placeFixedRect(part.frame, local);
    if (part.badge) {
      var pos = badgePositionForRect(local);
      part.badge.style.left = pos.left + 'px';
      part.badge.style.top = pos.top + 'px';
    }
  }

  function updateDraftGeometry() {
    if (!draftNodes.length) return;
    beginOverlayFrame();
    draftNodes.forEach(function (p) {
      var el = resolve(p.selector);
      if (!el || isHidden(el)) return;
      placePartGeometry(p, el);
    });
  }

  function renderComposerDraftVisuals() {
    clearDraftNodes();
    if (!activeComposer || activeComposer.m.type !== 'element') return;
    beginOverlayFrame();
    markElementTargets(activeComposer.m).forEach(function (target) {
      var el = resolve(target.selector);
      if (!el || isHidden(el)) return;
      var frame = document.createElement('div');
      frame.className = 'ann-target ann-draft-target';
      frame.setAttribute('data-ann-ui', '');
      hoverLayer.appendChild(frame);
      // Editing replaces the persisted target visuals; keep its number on the draft too.
      var badge = document.createElement('div');
      badge.className = 'ann-badge';
      badge.textContent = activeComposer.m.n;
      badge.style.pointerEvents = 'none';
      hoverLayer.appendChild(badge);
      var part = { frame: frame, badge: badge, selector: target.selector };
      draftNodes.push(part);
      placePartGeometry(part, el);
    });
  }

  function insertComposerIndicator(ref) {
    var composer = activeComposer;
    if (!composer) return;
    if (composer.composing) {
      if (composer.pendingInlineRefs.indexOf(ref) < 0) composer.pendingInlineRefs.push(ref);
      return;
    }
    var ta = composer.ta;
    var token = targetContentToDisplay('[@t:' + ref + ']', markElementTargets(composer.m)) + ' ';
    var start = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
    var end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : start;
    ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
    var caret = start + token.length;
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function addTargetToComposer(el) {
    if (!activeComposer || activeComposer.m.type !== 'element' || !el) return false;
    var sel = cssPath(el);
    var targets = markElementTargets(activeComposer.m);
    if (targets.some(function (target) { return target.selector === sel; })) return true;
    var ref = 'i' + activeComposer.nextTargetNumber++;
    targets.push({ ref: ref, selector: sel, text: excerpt(el) });
    activeComposer.m.targets = targets;
    normalizeElementTargets(activeComposer.m);
    insertComposerIndicator(ref);
    activeComposer.renderTargets();
    renderComposerDraftVisuals();
    clearHover();
    return true;
  }

  document.addEventListener('mousedown', function (e) {
    if (!mode || paused || e.button !== 0 || isUI(e.target)) return;
    // 点在滚动条区域不拦截，保住原生滚动条拖拽
    if (e.clientX >= document.documentElement.clientWidth || e.clientY >= document.documentElement.clientHeight) return;
    var target = annTargetAt(e.clientX, e.clientY, { promoteFrame: !!e.altKey });
    if (!target) return;
    e.preventDefault(); e.stopPropagation();
    drag = {
      x0: e.pageX,
      y0: e.pageY,
      moved: false,
      arrow: !!arrowFrom,
      altKey: !!e.altKey,
      composer: !!(activeComposer && activeComposer.m.type === 'element')
    };
  }, true);

  document.addEventListener('mousemove', function (e) {
    if (!drag) return;
    var dx = e.pageX - drag.x0, dy = e.pageY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > 6) {
      drag.moved = true;
      if (!drag.arrow && !drag.composer) {
        lasso = document.createElement('div');
        lasso.id = 'ann-lasso'; lasso.setAttribute('data-ann-ui', '');
        chromeLayer.appendChild(lasso);
      }
    }
    if (drag.moved && !drag.arrow && lasso) {
      var x = Math.min(drag.x0, e.pageX) - scrollX;
      var y = Math.min(drag.y0, e.pageY) - scrollY;
      placeOverlayRect(lasso, [x, y, Math.abs(dx), Math.abs(dy)]);
    }
    if (drag.arrow) drawTempArrow(arrowFrom._anchor, [e.pageX, e.pageY]);
  }, true);

  document.addEventListener('mouseup', function (e) {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.arrow) { finishArrow([e.pageX, e.pageY], e); return; }
    if (d.composer) {
      if (!d.moved) {
        var composerTarget = annTargetAt(e.clientX, e.clientY, { promoteFrame: !!(e.altKey || d.altKey) });
        if (composerTarget) addTargetToComposer(composerTarget);
      }
      return;
    }
    if (d.moved) hoverSuppress = { x: e.pageX, y: e.pageY, until: Date.now() + 2000 };
    if (d.moved && lasso) {
      var o = overlayOrigin();
      var vx = (parseInt(lasso.style.left, 10) || 0) + o[0];
      var vy = (parseInt(lasso.style.top, 10) || 0) + o[1];
      var vw = parseInt(lasso.style.width, 10) || 0;
      var vh = parseInt(lasso.style.height, 10) || 0;
      var rect = [vx + scrollX, vy + scrollY, vw, vh];
      if (rect[2] > 10 && rect[3] > 10) {
        // 写标注期间保留框选虚线框，closeComposer 时清掉（openComposer 开头会先关闭旧草稿）
        var keep = lasso; lasso = null;
        newRegionMark(rect);
        lasso = keep;
      } else {
        lasso.remove(); lasso = null;
      }
    } else {
      // Re-resolve at mouseup so Alt promote matches the release modifier, not a stale hoverEl.
      var promote = !!(e.altKey || d.altKey);
      var target = annTargetAt(e.clientX, e.clientY, { promoteFrame: promote }) || hoverEl;
      if (!target) return;
      newElementMark(target);
    }
  }, true);

  // 标注模式下拦截页面自身的点击（防误触链接）
  document.addEventListener('click', function (e) {
    if (mode && !paused && annTarget(e.target, { promoteFrame: !!e.altKey })) {
      e.preventDefault(); e.stopPropagation();
    }
  }, true);

  // ---------- 新建标注 ----------
  function nextN() { return marks.reduce(function (m, k) { return Math.max(m, k.n); }, 0) + 1; }

  function newElementMark(el) {
    var selector = cssPath(el);
    var text = excerpt(el);
    var m = stampPage({
      n: nextN(),
      id: newMarkId(),
      type: 'element',
      selector: selector,
      text: text,
      targets: [{ ref: 'i1', selector: selector, text: text }],
      rect: docRect(el),
      content: ''
    });
    stampTargetMeta(m, el);
    openComposer(m, docRect(el), true);
    if (hoverEl === el) hoverEl = null;
  }

  function regionContains(rect) {
    var board = document.getElementById('wb-board-panel') || document.body;
    // Scope candidates to preview surfaces only — avoids walking the whole
    // workbench DOM (sidebar/nav/overlay) which made querySelectorAll('*') hot.
    var roots = Array.prototype.slice.call(board.querySelectorAll('.ios-screen, .wb-comp-stage'));
    if (!roots.length) roots = [board];
    var candidates = [];
    for (var ri = 0; ri < roots.length; ri++) {
      var walker = document.createTreeWalker(roots[ri], NodeFilter.SHOW_ELEMENT, null);
      while (walker.nextNode()) {
        var el = walker.currentNode;
        if (isUI(el) || !annContentSurface(el)) continue;
        if (!hasLayout(el)) continue;
        var r = docRect(el);
        candidates.push({
          rect: r,
          selector: cssPath(el),
          parentSelector: el.parentElement ? cssPath(el.parentElement) : undefined,
          text: excerpt(el)
        });
      }
    }
    return pickContained(candidates, rect);
  }

  function newRegionMark(rect) {
    var contains = regionContains(rect);
    // 记录锚元素当时的坐标：重绘时按锚元素的位移平移原始框，保住用户画的框形状
    var base = null;
    for (var i = 0; i < contains.length; i++) {
      var el = resolve(contains[i].selector);
      if (el) { base = { selector: contains[i].selector, rect: docRect(el) }; break; }
    }
    var m = stampPage({
      n: nextN(),
      id: newMarkId(),
      type: 'region',
      rect: rect,
      contains: contains,
      base: base,
      content: ''
    });
    var anchorEl = base ? resolve(base.selector) : (contains[0] ? resolve(contains[0].selector) : null);
    stampTargetMeta(m, anchorEl);
    openComposer(m, rect, true);
  }

  // ---------- 标注框 ----------
  var tipEl = null;

  function placeChromeFixed(el, left, top, width, height) {
    var pad = 8;
    var w = width != null ? width : (el.offsetWidth || 320);
    var h = height != null ? height : (el.offsetHeight || 200);
    var bounds = overlay.getBoundingClientRect();
    var maxL = Math.max(pad, bounds.width - w - pad);
    var maxT = Math.max(pad, bounds.height - h - pad);
    var o = overlayOrigin();
    var localL = left - o[0];
    var localT = top - o[1];
    el.style.left = Math.max(pad, Math.min(localL, maxL)) + 'px';
    el.style.top = Math.max(pad, Math.min(localT, maxT)) + 'px';
  }

  function showTip(text, anchorRect) {
    removeTip();
    tipEl = document.createElement('div');
    tipEl.id = 'ann-tip';
    tipEl.setAttribute('data-ann-ui', '');
    tipEl.textContent = text;
    chromeLayer.appendChild(tipEl);
    var vr = docToView(anchorRect);
    placeChromeFixed(tipEl, vr[0], vr[1] - 36);
  }
  function removeTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }

  var pinned = null; // 标注期间保持高亮的被点元素
  function closeMention() {
    var el = document.getElementById('ann-mention');
    if (el) el.remove();
  }

  function closeComposer(opts) {
    opts = opts || {};
    closeMention();
    if (activeComposer) {
      if (activeComposer.resizeObserver) activeComposer.resizeObserver.disconnect();
      if (activeComposer.dockObserver) activeComposer.dockObserver.disconnect();
      if (activeComposer.stage) activeComposer.stage.style.scrollPaddingBottom = activeComposer.previousScrollPadding || '';
    }
    activeComposer = null;
    var b = document.getElementById('ann-box'); if (b) b.remove();
    removeTempArrow(); removeTip(); arrowFrom = null;
    if (pinned) { pinned = null; hideGhost(); }
    if (lasso) { lasso.remove(); lasso = null; }
    clearDraftNodes();
    hoverSuppress = null; // 标注框一关，悬停高亮立即恢复
    structureDirty = true;
    if (!opts.silentRender) requestAnimationFrame(renderAll);
  }

  // DOM-backed input keeps the persisted text-token format; pills are atomic
  // editing nodes, never selectors reconstructed from their display labels.
  function richAnnotationInput(el, mark) {
    var savedSelection = [0, 0];
    function text(node) {
      if (node.nodeType === 3) return node.data;
      if (node.nodeType !== 1 && node.nodeType !== 11) return '';
      if (node.dataset && node.dataset.token) return node.dataset.token;
      if (node.nodeName === 'BR') return '\n';
      var out = '';
      Array.prototype.forEach.call(node.childNodes, function (child, i) {
        if (i && /^(DIV|P)$/.test(child.nodeName) && !out.endsWith('\n')) out += '\n';
        out += text(child);
      });
      return out;
    }
    function offsets() {
      var selection = window.getSelection();
      if (!selection || !selection.rangeCount || !el.contains(selection.anchorNode) || !el.contains(selection.focusNode)) return savedSelection;
      var range = selection.getRangeAt(0);
      var prefix = range.cloneRange(); prefix.selectNodeContents(el); prefix.setEnd(range.startContainer, range.startOffset);
      var suffix = range.cloneRange(); suffix.selectNodeContents(el); suffix.setEnd(range.endContainer, range.endOffset);
      savedSelection = [text(prefix.cloneContents()).length, text(suffix.cloneContents()).length];
      return savedSelection;
    }
    function render(value) {
      el.replaceChildren();
      var regex = /\[indicator ([1-9][0-9]*)\]/g, offset = 0, hit;
      while ((hit = regex.exec(value))) {
        el.appendChild(document.createTextNode(value.slice(offset, hit.index)));
        var ref = 'i' + hit[1];
        var target = markElementTargets(mark).find(function (t) { return t.ref === ref; });
        if (!target) el.appendChild(document.createTextNode(hit[0]));
        else {
          var pill = document.createElement('span');
          pill.className = 'ann-inline-target'; pill.contentEditable = 'false';
          pill.dataset.token = hit[0]; pill.dataset.targetRef = ref;
          pill.title = target.text || '元素';
          var label = document.createElement('span'); label.textContent = target.text || '元素';
          var remove = document.createElement('button'); remove.type = 'button';
          remove.className = 'ann-inline-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', '移除目标 ' + hit[1]);
          pill.appendChild(label); pill.appendChild(remove); el.appendChild(pill);
        }
        offset = regex.lastIndex;
      }
      el.appendChild(document.createTextNode(value.slice(offset)));
    }
    function setSelection(start, end) {
      function point(position) {
        var remaining = position, answer;
        function walk(node) {
          if (answer) return;
          if (node.nodeType === 3) {
            if (remaining <= node.length) answer = [node, remaining]; else remaining -= node.length;
          } else if (node.dataset && node.dataset.token) {
            var index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
            if (remaining <= node.dataset.token.length) answer = [node.parentNode, index + (remaining ? 1 : 0)];
            else remaining -= node.dataset.token.length;
          } else Array.prototype.forEach.call(node.childNodes, walk);
        }
        walk(el); return answer || [el, el.childNodes.length];
      }
      var a = point(start), b = point(end), range = document.createRange();
      range.setStart(a[0], a[1]); range.setEnd(b[0], b[1]);
      var selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      savedSelection = [start, end];
    }
    Object.defineProperties(el, {
      value: { get: function () { return text(el); }, set: function (value) { render(String(value)); } },
      selectionStart: { get: function () { return offsets()[0]; } },
      selectionEnd: { get: function () { return offsets()[1]; } }
    });
    el.setSelectionRange = setSelection;
    el.addEventListener('keyup', offsets); el.addEventListener('mouseup', offsets); el.addEventListener('blur', offsets);
    el.addEventListener('mousedown', function (event) { if (event.target.closest('.ann-inline-remove')) event.preventDefault(); });
    el.addEventListener('click', function (event) {
      var remove = event.target.closest('.ann-inline-remove'); if (!remove) return;
      remove.closest('.ann-inline-target').remove(); el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    el.addEventListener('paste', function (event) {
      if (!event.clipboardData || Array.prototype.some.call(event.clipboardData.items, function (item) { return item.type.indexOf('image/') === 0; })) return;
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    });
    return el;
  }

  function openComposer(m, anchorRect, isNew) {
    closeComposer({ silentRender: true });
    m = normalizeAnnotation(JSON.parse(JSON.stringify(m)));
    ensureMarkId(m);
    var selectedAnchor = resolveMarkAnchor(m);
    var broken = !selectedAnchor.live;
    var modal = selectedAnchor.el && selectedAnchor.el.closest('dialog:modal');
    if (modal && overlay.parentElement !== modal) mountOverlay(modal);
    else if (!modal && overlay.parentElement.matches('dialog')) mountOverlay();
    var box = document.createElement('div');
    box.id = 'ann-box'; box.setAttribute('data-ann-ui', '');
    var recordedDeletion = m.result && m.result.operations.some(function (op) { return op.action === 'delete'; });
    var brokenInfo = broken && !recordedDeletion
      ? '<div class="t" style="color:var(--wb-danger,#b84230);margin-bottom:8px">锚点失效 · 目标节点已不在当前稿中</div>'
      : '';
    var res = m.research || null;
    var changeOn = !!m.changeTo;
    box.innerHTML =
      (m.result ? '<div class="t" data-result-summary>' + annResultSummary(m) + '</div>' : '') +
      brokenInfo +
      '<div id="ann-imgs"></div>' +
      '<div id="ann-input" contenteditable="true" role="textbox" aria-label="写标注" aria-multiline="true" data-placeholder="写标注…"></div>' +
      '<div class="acts"><div class="ann-tools">' +
      '<button type="button" id="ann-plus" aria-label="标注操作" aria-expanded="false">+</button>' +
      '<div id="ann-mode-pills"></div>' +
      '<div id="ann-tools-menu" hidden>' +
      '<button type="button" id="ann-change">' + annIcon('pencil') + '<span>改文案</span></button>' +
      '<button type="button" id="ann-move"' + (broken ? ' disabled' : '') + '>' + annIcon('arrow-up-right') + '<span>移动</span></button></div></div>' +
      '<div class="ann-submit-actions">' + (isNew ? '' : '<button type="button" id="ann-del" aria-label="删除标注" title="删除标注">' + annIcon('trash') + '</button>') +
      '<button type="button" id="ann-cancel" aria-label="关闭标注">取消</button>' +
      '<button type="button" id="ann-save" class="dark" aria-label="发送标注">保存</button></div></div>';
    chromeLayer.appendChild(box);
    if (typeof overlay.showPopover === 'function') {
      overlay.hidePopover(); overlay.showPopover();
    }
    var ta = richAnnotationInput(box.querySelector('#ann-input'), m);
    var initialText = m._draft != null ? m._draft : contentToDisplay(annotationContent(m), markElementTargets(m));
    var missingRefs = markElementTargets(m).filter(function (target) { return initialText.indexOf(targetContentToDisplay('[@t:' + target.ref + ']', [target])) < 0; });
    ta.value = missingRefs.map(function (target) { return targetContentToDisplay('[@t:' + target.ref + ']', [target]) + ' '; }).join('') + initialText;
    ta.setSelectionRange(ta.value.length, ta.value.length);

    normalizeElementTargets(m);
    var stageEl = document.getElementById('wbstage');
    var composer = {
      ta: ta,
      m: m,
      isNew: !!isNew,
      persistedN: isNew ? null : m.n,
      nextTargetNumber: parseInt(nextTargetRef(markElementTargets(m)).slice(1), 10),
      composing: false,
      pendingInlineRefs: [],
      stage: stageEl,
      previousScrollPadding: stageEl ? stageEl.style.scrollPaddingBottom : '',
      resizeObserver: null,
      dockObserver: null,
      renderTargets: function () {}
    };
    activeComposer = composer;
    composer.save = save; // SPA 切账本收尾用：把打开中的草稿存回旧账本
    var composerMaxWidth = parseFloat(getComputedStyle(box).maxWidth) || box.offsetWidth;

    // Use the selected DOM geometry, including every visible selected target.
    // When none of the adjacent positions fits, dock without moving the canvas.
    function syncComposerLayout() {
      if (activeComposer !== composer || !box.isConnected) return;
      beginOverlayFrame();
      var bounds = overlay.getBoundingClientRect();
      var pad = 12, gap = 12;
      var width = Math.min(composerMaxWidth, Math.max(0, bounds.width - pad * 2));
      box.style.width = width + 'px';
      box.style.maxHeight = Math.max(80, bounds.height - pad * 2) + 'px';
      var height = box.offsetHeight;
      var rects = m.type === 'element' ? resolveAllLiveTargets(m).map(function (target) {
        return target.el.getBoundingClientRect();
      }) : [];
      resultTargets(m).forEach(function (target) { var el = findResultTarget(target); if (el && !isHidden(el)) rects.push(el.getBoundingClientRect()); });
      if (m.type === 'region') {
        var anchor = resolveMarkAnchor(m);
        if (anchor.live && anchor.rectDoc) {
          var r = docToView(anchor.rectDoc);
          rects.push({left:r[0],top:r[1],right:r[0]+r[2],bottom:r[1]+r[3]});
        }
      }
      rects = rects.filter(function (r) { return r.right > bounds.left && r.left < bounds.right && r.bottom > bounds.top && r.top < bounds.bottom; });
      var candidates = [];
      if (rects.length) {
        var left = Math.min.apply(null, rects.map(function (r) { return r.left; })) - bounds.left;
        var right = Math.max.apply(null, rects.map(function (r) { return r.right; })) - bounds.left;
        var top = Math.min.apply(null, rects.map(function (r) { return r.top; })) - bounds.top;
        var bottom = Math.max.apply(null, rects.map(function (r) { return r.bottom; })) - bounds.top;
        var y = Math.max(pad, Math.min(top, bounds.height - height - pad));
        var x = Math.max(pad, Math.min(left, bounds.width - width - pad));
        candidates = [[right + gap, y], [left - gap - width, y], [x, bottom + gap], [x, top - gap - height]];
      }
      var chrome = Array.from(document.querySelectorAll('#wbside, #wbstrip, #wbdock > *, #wbcanvas-dock > *, #ann-sidebar')).filter(function (el) { return el && el.getClientRects().length; }).map(function (el) { return el.getBoundingClientRect(); });
      var position = candidates.find(function (p) {
        if (p[0] < pad || p[1] < pad || p[0] + width > bounds.width - pad || p[1] + height > bounds.height - pad) return false;
        return !chrome.some(function (r) { return p[0] + bounds.left < r.right && p[0] + width + bounds.left > r.left && p[1] + bounds.top < r.bottom && p[1] + height + bounds.top > r.top; });
      });
      box.dataset.placement = position ? 'anchor' : 'dock';
      if (!position) {
        var strip = document.getElementById('wbstrip');
        var bottomSpace = strip && strip.getClientRects().length ? Math.max(pad, bounds.bottom - strip.getBoundingClientRect().top + gap) : pad;
        position = [(bounds.width - width) / 2, Math.max(pad, bounds.height - height - bottomSpace)];
      }
      box.style.left = position[0] + 'px';
      box.style.top = position[1] + 'px';
      box.style.right = 'auto'; box.style.bottom = 'auto'; box.style.margin = '0';
    }
    composer.syncLayout = syncComposerLayout;

    composer.renderTargets = function () { syncComposerLayout(); };
    function syncTargetReferences() {
      var refs = Array.from(ta.querySelectorAll('[data-target-ref]')).map(function (node) { return node.dataset.targetRef; });
      var targets = markElementTargets(m);
      if (!refs.length && targets.length) {
        // A mark always needs one anchor; make the retained anchor visible.
        ta.value = targetContentToDisplay('[@t:' + targets[0].ref + ']', targets) + ' ' + ta.value;
        ta.setSelectionRange(ta.value.length, ta.value.length);
        refs = [targets[0].ref];
      }
      m.targets = targets.filter(function (target) { return refs.indexOf(target.ref) >= 0; });
      normalizeElementTargets(m);
      renderComposerDraftVisuals();
    }
    renderComposerDraftVisuals();

    ta.addEventListener('compositionstart', function () { composer.composing = true; });
    ta.addEventListener('compositionend', function () {
      composer.composing = false;
      var refs = composer.pendingInlineRefs.slice();
      composer.pendingInlineRefs = [];
      refs.forEach(insertComposerIndicator);
      syncTargetReferences();
      syncComposerLayout();
    });
    if (typeof ResizeObserver !== 'undefined') {
      composer.resizeObserver = new ResizeObserver(syncComposerLayout);
      composer.resizeObserver.observe(box);
      composer.resizeObserver.observe(overlay);
    }
    // 让位的三个来源都要盯：画布 dock 的开合、右下浮层槽的换住客、左栏的
    // 折叠与拖宽（宽度变化 ResizeObserver 才看得见，属性观察看不见）。
    // 浮层槽里 React 每次提交（hover 态、行高亮）都会触发观察；一帧内合并成一次量测。
    var dockSyncRaf = 0;
    function syncComposerLayoutSoon() {
      if (dockSyncRaf) return;
      dockSyncRaf = requestAnimationFrame(function () { dockSyncRaf = 0; syncComposerLayout(); });
    }
    if (typeof MutationObserver !== 'undefined') {
      composer.dockObserver = new MutationObserver(syncComposerLayoutSoon);
      ['wbcanvas-dock', 'wbdock'].forEach(function (id) {
        var node = document.getElementById(id);
        if (node) {
          composer.dockObserver.observe(node, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ['hidden', 'class', 'style']
          });
        }
      });
    }
    if (composer.resizeObserver) {
      var sideEl = document.getElementById('wbside');
      if (sideEl) composer.resizeObserver.observe(sideEl);
    }
    syncComposerLayout();
    ta.focus({ preventScroll: true });

    var researchOn = !!res;
    // ---- @ mention picker (UI @n → disk [@a:id]) ----
    var mentionItems = [];
    var mentionIndex = 0;
    var mentionRange = null; // { start, end }

    function mentionCandidates(query) {
      var q = String(query || '').toLowerCase();
      return marks.filter(function (k) {
        if (k.n === m.n) return false;
        ensureMarkId(k);
        if (!q) return true;
        var hay = String(k.n) + ' ' + contentToDisplay(annotationContent(k), markElementTargets(k)) + ' ' + (k.text || '') + ' ' + annotationSectionLabel(k);
        return hay.toLowerCase().indexOf(q) >= 0;
      }).slice(0, 12);
    }

    function mentionPreview(k) {
      var body = contentToDisplay(annotationContent(k), markElementTargets(k)).trim();
      if (!body) body = (k.text || '').trim() || (k.type === 'region' ? '框选区域' : '元素');
      return body.slice(0, 80);
    }

    function closeMentionPicker() {
      closeMention();
      mentionItems = [];
      mentionRange = null;
    }

    function renderMentionPicker() {
      closeMention();
      if (!mentionItems.length) {
        var empty = document.createElement('div');
        empty.id = 'ann-mention';
        empty.setAttribute('data-ann-ui', '');
        empty.innerHTML = '<div class="ann-men-empty">没有可引用的标注</div>';
        chromeLayer.appendChild(empty);
        var er = ta.getBoundingClientRect();
        placeChromeFixed(empty, er.left, er.bottom + 4);
        return;
      }
      var pop = document.createElement('div');
      pop.id = 'ann-mention';
      pop.setAttribute('data-ann-ui', '');
      pop.innerHTML = mentionItems.map(function (k, i) {
        return '<button type="button" class="ann-men-item' + (i === mentionIndex ? ' on' : '') + '" data-men-i="' + i + '">' +
          '<span class="ann-men-n">@' + k.n + '</span>' +
          '<span class="ann-men-body"></span></button>';
      }).join('');
      chromeLayer.appendChild(pop);
      var bodies = pop.querySelectorAll('.ann-men-body');
      for (var bi = 0; bi < bodies.length; bi++) {
        bodies[bi].textContent = mentionPreview(mentionItems[bi]);
      }
      pop.addEventListener('mousedown', function (e) {
        var btn = e.target.closest('[data-men-i]');
        if (!btn) return;
        e.preventDefault();
        mentionIndex = parseInt(btn.getAttribute('data-men-i'), 10) || 0;
        pickMention();
      });
      var pr = ta.getBoundingClientRect();
      placeChromeFixed(pop, pr.left, pr.bottom + 4);
      var on = pop.querySelector('.ann-men-item.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }

    function getMentionContext() {
      var pos = ta.selectionStart;
      var before = ta.value.slice(0, pos);
      var hit = before.match(/(^|[\s\n])@([^\s@]*)$/);
      if (!hit) return null;
      var query = hit[2];
      var start = pos - query.length - 1;
      return { start: start, end: pos, query: query };
    }

    function syncMentionFromCaret() {
      var ctx = getMentionContext();
      if (!ctx) {
        closeMentionPicker();
        return;
      }
      mentionRange = { start: ctx.start, end: ctx.end };
      mentionItems = mentionCandidates(ctx.query);
      if (mentionIndex >= mentionItems.length) mentionIndex = Math.max(0, mentionItems.length - 1);
      renderMentionPicker();
    }

    function pickMention() {
      if (!mentionRange || !mentionItems.length) {
        closeMentionPicker();
        return;
      }
      var hit = mentionItems[mentionIndex];
      if (!hit) return;
      ensureMarkId(hit);
      var insert = '@' + hit.n;
      var before = ta.value.slice(0, mentionRange.start);
      var after = ta.value.slice(mentionRange.end);
      var needsSpace = after.length === 0 || !/^\s/.test(after);
      ta.value = before + insert + (needsSpace ? ' ' : '') + after;
      var caret = before.length + insert.length + (needsSpace ? 1 : 0);
      ta.setSelectionRange(caret, caret);
      closeMentionPicker();
      ta.focus();
    }

    function mentionMove(delta) {
      if (!mentionItems.length) return;
      mentionIndex = (mentionIndex + delta + mentionItems.length) % mentionItems.length;
      renderMentionPicker();
    }

    // ---- 参考截图：粘贴或选文件，立即上传到本机服务，JSON 里存绝对路径供 Claude 读 ----
    var images = (m.images || []).slice();
    var imgWrap = box.querySelector('#ann-imgs');
    function renderImgs() {
      imgWrap.innerHTML = '';
      images.forEach(function (im, i) {
        var d = document.createElement('div');
        d.className = 'im'; d.setAttribute('data-ann-ui', '');
        d.innerHTML = '<img src="' + SERVER + '/images/' + encodeURIComponent(im.file) + '?entry=' + encodeURIComponent(ENTRY) + '"><span class="x">×</span>';
        d.querySelector('.x').addEventListener('click', function () { images.splice(i, 1); renderImgs(); });
        imgWrap.appendChild(d);
      });
    }
    renderImgs();
    function addImageFile(file) {
      var rd = new FileReader();
      rd.onload = function () {
        setStatus('上传截图…');
        fetch(SERVER + '/image', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: PAGE, entry: ENTRY, data: rd.result })
        }).then(function (r) { return r.json(); })
          .then(function (j) { images.push({ file: j.file, path: j.path }); renderImgs(); setStatus(''); })
          .catch(function () { setStatus('截图上传失败', true); });
      };
      rd.readAsDataURL(file);
    }
    ta.addEventListener('paste', function (e) {
      var items = (e.clipboardData || {}).items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) { e.preventDefault(); addImageFile(items[i].getAsFile()); }
      }
    });
    var plus = box.querySelector('#ann-plus');
    var toolsMenu = box.querySelector('#ann-tools-menu');
    function closeTools() { toolsMenu.hidden = true; plus.setAttribute('aria-expanded', 'false'); }
    plus.addEventListener('click', function () { toolsMenu.hidden = !toolsMenu.hidden; plus.setAttribute('aria-expanded', String(!toolsMenu.hidden)); });
    box.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !toolsMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeTools(); plus.focus(); } });
    function renderModes() {
      var wrap = box.querySelector('#ann-mode-pills'); wrap.replaceChildren();
      [['change', '改文案', changeOn], ['move', '移动', !!m.move]].forEach(function (item) {
        if (!item[2]) return;
        var pill = document.createElement('button'); pill.type = 'button'; pill.className = 'ann-mode-pill';
        pill.textContent = item[1]; pill.setAttribute('aria-label', '取消' + item[1]);
        var cross = document.createElement('span'); cross.textContent = '×'; pill.appendChild(cross);
        pill.addEventListener('click', function () { if (item[0] === 'change') changeOn = false; else { delete m.move; removeTempArrow(); } renderModes(); });
        wrap.appendChild(pill);
      });
    }
    box.querySelector('#ann-change').addEventListener('click', function () {
      changeOn = true; closeTools(); renderModes(); ta.focus({ preventScroll: true });
    });
    renderModes();

    function save() {
      if (resultWriting) { setStatus('正在保存执行结果，请稍后发送', true); return; }
      closeMentionPicker();
      ensureMarkId(m);
      var stored = contentToStorage(ta.value.trim(), markElementTargets(m));
      m.content = stored;
      delete m.comment;
      var mentionIds = extractMentionIds(stored);
      if (mentionIds.length) m.mentions = mentionIds; else delete m.mentions;
      if (researchOn) {
        m.research = res;
      } else {
        delete m.research;
      }
      if (changeOn) m.changeTo = true; else delete m.changeTo;
      if (images.length) m.images = images; else delete m.images;
      normalizeElementTargets(m);
      delete m._draft;
      delete m._targetMode;
      delete m._anchor;
      if (!m.content.replace(/\[@t:i[1-9][0-9]*\]/g, '').trim() && !m.move && !m.research && !m.changeTo && !m.images) { closeComposer(); return; } // 空标注丢弃
      var idx = marks.findIndex(function (k) { return k.n === m.n; });
      if (idx < 0) marks.push(m); else {
        if (marks[idx].result) m.result = marks[idx].result;
        marks[idx] = m;
      }
      closeComposer({ silentRender: true }); persist();
    }
    ta.addEventListener('input', function () {
      if (!composer.composing) syncTargetReferences();
      syncComposerLayout();
      syncMentionFromCaret();
    });
    ta.addEventListener('keydown', function (e) {
      if (composer.composing || e.isComposing || e.keyCode === 229) return; // 输入法组字中：回车/ESC 都交给输入法
      var mentionOpen = !!document.getElementById('ann-mention');
      if (mentionOpen) {
        if (e.key === 'ArrowDown') { e.preventDefault(); mentionMove(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); mentionMove(-1); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pickMention(); return; }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeMentionPicker();
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      // Escape (no mention): document listener closes box
    });
    box.querySelector('#ann-save').addEventListener('click', save);
    box.querySelector('#ann-cancel').addEventListener('click', function () { closeComposer(); });
    var del = box.querySelector('#ann-del');
    if (del) del.addEventListener('click', function () {
      removeMark(m.n);
    });
    box.querySelector('#ann-move').addEventListener('click', function () {
      if (isMarkBroken(m) || !anchorRect) {
        setStatus('锚点失效，无法画箭头', true);
        return;
      }
      closeMentionPicker();
      m._draft = ta.value; // 暂存已输入文字（展示态 @n）
      if (changeOn) m.changeTo = true; else delete m.changeTo;
      if (images.length) m.images = images; else delete m.images;
      m._anchor = [anchorRect[0] + anchorRect[2] / 2, anchorRect[1] + anchorRect[3] / 2];
      arrowFrom = m;
      box.remove(); // 隐藏标注框，拖完箭头再弹回
      showTip('从被标处拖一根箭头到目标位置', anchorRect);
    });

    if (anchorRect) {
      // goToMark 闪烁窗口内：保留 ann-flash，不让常驻高亮同步覆盖掉闪烁动画；
      // 闪烁到期由 endFlash 收编为常驻高亮。
      var flashCls = Date.now() < flashUntil ? 'ann-flash' : null;
      if (m.type === 'region') {
        var regionEl = resolveMarkAnchor(m).el;
        showGhostForRect(anchorRect, flashCls, regionEl);
      } else {
        var markEl = resolve(m.selector);
        if (markEl) showGhostForEl(markEl, flashCls);
      }
    }
  }

  // ---------- 移动箭头 ----------
  var tempArrow = null;
  function updateArrowGeometry(svg, from, to) {
    var x = Math.min(from[0], to[0]) - 12, y = Math.min(from[1], to[1]) - 12;
    placeFixedRect(svg, [x, y, Math.abs(from[0] - to[0]) + 24, Math.abs(from[1] - to[1]) + 24]);
    svg.lastElementChild.setAttribute('d', 'M ' + (from[0] - x) + ' ' + (from[1] - y) +
      ' L ' + (to[0] - x) + ' ' + (to[1] - y));
  }

  function svgArrow(from, to, id) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-ann-ui', '');
    if (id) svg.dataset.arrow = id;
    svg.style.cssText = 'position:absolute;pointer-events:none;z-index:2;';
    var mk = 'annArrowHead' + (id || 'tmp');
    svg.innerHTML = '<defs><marker id="' + mk + '" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#f5a623"/></marker></defs>' +
      '<path stroke="#f5a623" stroke-width="2.5" fill="none" marker-end="url(#' + mk + ')"/>';
    updateArrowGeometry(svg, from, to);
    return svg;
  }

  function drawTempArrow(from, to) {
    removeTempArrow();
    tempArrow = svgArrow(viewToOverlayPoint(docPointToView(from)), viewToOverlayPoint(docPointToView(to)));
    hoverLayer.appendChild(tempArrow);
  }
  function removeTempArrow() { if (tempArrow) { tempArrow.remove(); tempArrow = null; } }

  function finishArrow(pt, e) {
    removeTip();
    var m = arrowFrom; arrowFrom = null;
    if (!m) return;
    var target = annTarget(document.elementFromPoint(e.clientX, e.clientY));
    var move = { to_point: [Math.round(pt[0]), Math.round(pt[1])] };
    if (target) {
      move.to_selector = cssPath(target);
      move.to_text = excerpt(target);
      var tr = docRect(target);
      move.to_rel = [Math.round((pt[0] - tr[0]) / tr[2] * 100) / 100, Math.round((pt[1] - tr[1]) / tr[3] * 100) / 100];
    }
    m.move = move;
    setStatus('');
    var anchorRect = m.rect;
    // 写标注期间保留刚拖出的箭头 + 原有的框选框/元素高亮（openComposer 会先清理旧草稿）
    var kA = tempArrow, kL = lasso, kP = pinned;
    tempArrow = null; lasso = null; pinned = null;
    openComposer(m, anchorRect, !marks.some(function (k) { return k.n === m.n; }));
    tempArrow = kA; lasso = kL; pinned = kP;
    var ta = document.querySelector('#ann-input');
    if (ta && m._draft) ta.value = m._draft;
    syncGhost();
  }

  // ---------- 锚点解析（live vs broken；禁止用陈旧 rect 画框）----------
  function resolveMarkAnchor(m) {
    if (!m) return { live: false, el: null, rectDoc: null };
    if (m.type === 'element') {
      var lives = resolveAllLiveTargets(m);
      if (!lives.length) return { live: false, el: null, rectDoc: null };
      return { live: true, el: lives[0].el, rectDoc: lives[0].rectDoc };
    }
    var el = null;
    var mSid = m.screenId || '';
    if (m.base && m.base.selector) {
      el = resolveMarkSelector(m.base.selector, mSid);
    } else if (m.contains && m.contains.length) {
      for (var i = 0; i < m.contains.length; i++) {
        el = resolveMarkSelector(m.contains[i].selector, mSid);
        if (el) break;
      }
    }
    if (!el || isHidden(el)) return { live: false, el: null, rectDoc: null };
    // region: translate stored box by live base delta (same zoom session / layout shift)
    if (m.base && m.base.rect) {
      var now = docRect(el);
      var br = m.base.rect;
      var rr = m.rect || br;
      // 双向透传把 region 带到另一份文档（画布 zoom ≠ 嵌入页 1:1）：平移之外按
      // 锚元素的尺寸比缩放，比例 1 时与旧行为逐值相同。
      var sx = br[2] > 0 ? now[2] / br[2] : 1;
      var sy = br[3] > 0 ? now[3] / br[3] : 1;
      return {
        live: true,
        el: el,
        rectDoc: [
          Math.round(now[0] + (rr[0] - br[0]) * sx),
          Math.round(now[1] + (rr[1] - br[1]) * sy),
          Math.round(rr[2] * sx),
          Math.round(rr[3] * sy)
        ]
      };
    }
    return { live: true, el: el, rectDoc: docRect(el) };
  }

  function markHasLiveTarget(m) {
    if (!m) return false;
    var fact = markFact(m);
    if (fact.live != null) return fact.live;
    fact.live = computeMarkLive(m);
    return fact.live;
  }

  function computeMarkLive(m) {
    if (m.type === 'element' && markElementTargets(m).length) {
      return resolveAllLiveTargets(m).length > 0;
    }
    return resolveMarkAnchor(m).live;
  }

  /** The selector still resolves, even if its current product view is hidden.
   *  A hidden tab / route is not a broken annotation: once the view returns,
   *  the same selector can become live again. The resolvability walk itself is
   *  the shared pure predicate from src/shared/ann-row.js (inlined at serve time). */
  function isMarkBroken(m) {
    var sid = (m && m.screenId) || '';
    var fact = markFact(m);
    if (fact.broken == null) fact.broken = annMarkBroken(m, function (selector) { return !!resolveMarkSelector(selector, sid); }, markElementTargets(m));
    return fact.broken;
  }

  function markAnchorRect(m) {
    var a = resolveMarkAnchor(m);
    return a.live ? a.rectDoc : null;
  }

  function moveEndPoint(m) {
    var mv = m.move;
    if (!mv) return null;
    if (mv.to_selector) {
      var el = resolveMarkSelector(mv.to_selector, m.screenId || '');
      if (el && !isHidden(el)) {
        var r = docRect(el);
        var rel = mv.to_rel || [0.5, 0.5];
        return [r[0] + r[2] * rel[0], r[1] + r[3] * rel[1]];
      }
      return null; // end anchor broken — do not paint from stale to_point
    }
    return mv.to_point || null;
  }

  function markAnchorViewRect(m) {
    var r = markAnchorRect(m);
    return r ? docToView(r) : null;
  }

  var markNodes = Object.create(null); // n -> { m, parts: [{ frame, badge }], arrow, liveTargets? }
  var structureDirty = true;

  function markAnchorEl(m) {
    return resolveMarkAnchor(m).el;
  }

  /** Live marks on the active page that should be drawn on the canvas. */
  function visiblePageMarks() {
    var out = [];
    marks.forEach(function (m) {
      if (activeComposer && activeComposer.m.type === 'element' && activeComposer.persistedN === m.n) return;
      if (!markOnActivePage(m)) return;
      if (!markHasLiveTarget(m)) return;
      out.push(m);
    });
    return out;
  }

  function removePartNodes(part) {
    if (!part) return;
    if (part.frame && part.frame.parentNode) part.frame.parentNode.removeChild(part.frame);
    if (part.badge && part.badge.parentNode) part.badge.parentNode.removeChild(part.badge);
  }

  function removeMarkNode(entry) {
    if (!entry) return;
    if (entry.parts) entry.parts.forEach(removePartNodes);
    else removePartNodes(entry);
    if (entry.arrow && entry.arrow.parentNode) entry.arrow.parentNode.removeChild(entry.arrow);
  }

  /* 评论卡的显示源（2026-09-04 评审板 H）：hover 钉子（120ms 延迟，扫过不闪）
     或该条刚被定位。离开钉子给 90ms 宽限，指针可以移到卡上继续读。 */
  var bubbleShowN = null;
  var bubbleFocusN = null;
  var bubbleEnterT = 0;
  var bubbleLeaveT = 0;

  function syncBubbleVisibility() {
    var on = bubbleShowN != null ? bubbleShowN : bubbleFocusN;
    Object.keys(bubbleNodes).forEach(function (n) {
      bubbleNodes[n].node.classList.toggle('ann-bubble--show', String(on) === String(n));
    });
    Object.keys(markNodes).forEach(function (n) {
      (markNodes[n].parts || []).forEach(function (part) {
        if (part.badge) part.badge.classList.toggle('ann-badge--on', String(on) === String(n));
      });
    });
    if (canvasView) updateCanvasBubble();
  }

  function showBubbleFor(n, delay) {
    clearTimeout(bubbleLeaveT);
    clearTimeout(bubbleEnterT);
    bubbleEnterT = setTimeout(function () {
      bubbleShowN = n;
      syncBubbleVisibility();
    }, delay || 0);
  }

  function hideBubbleSoon() {
    clearTimeout(bubbleEnterT);
    clearTimeout(bubbleLeaveT);
    bubbleLeaveT = setTimeout(function () {
      bubbleShowN = null;
      syncBubbleVisibility();
    }, 90);
  }

  /** 定位反馈：那一条的钉子点亮、卡跟着出，3s 后交还给 hover。 */
  function focusBubble(n) {
    bubbleFocusN = n;
    syncBubbleVisibility();
    setTimeout(function () {
      if (bubbleFocusN !== n) return;
      bubbleFocusN = null;
      syncBubbleVisibility();
    }, 3000);
  }

  function wireMarkBadge(badge, n) {
    badge.addEventListener('click', function (e) {
      e.stopPropagation();
      if (activeComposer) {
        if (activeComposer.persistedN !== n) setStatus('请先保存或取消当前标注', true);
        return;
      }
      openMark(n);
    });
    badge.addEventListener('mouseenter', function () { showBubbleFor(n, 120); });
    badge.addEventListener('mouseleave', hideBubbleSoon);
  }

  function placeArrow(entry, from, to) {
    if (!entry.arrow) {
      entry.arrow = svgArrow(from, to, entry.m.n);
      (entry.group ? entry.group.node : marksLayer).appendChild(entry.arrow);
      return;
    }
    updateArrowGeometry(entry.arrow, from, to);
  }

  function syncMarkStructure(pageMarks, affected) {
    if (!affected) resetCanvasView();
    var targets = geometryBatch(function () {
      return pageMarks.map(function (m) { return m.type === 'region' ? null : resolveAllLiveTargets(m); });
    });
    var keep = Object.create(null);
    if (affected) Object.keys(markNodes).forEach(function (key) {
      if (!affected.has(markNodes[key].m)) keep[key] = true;
    });
    pageMarks.forEach(function (m, index) {
      keep[m.n] = true;
      var entry = markNodes[m.n];
      var frameClass = m.type === 'region' ? 'ann-frame' : 'ann-target';
      var wantParts = m.type === 'region' ? 1 : targets[index].length;

      if (!entry) {
        entry = { m: m, parts: [], arrow: null };
        markNodes[m.n] = entry;
      } else {
        entry.m = m;
      }

      while (entry.parts.length > wantParts) {
        removePartNodes(entry.parts.pop());
      }
      while (entry.parts.length < wantParts) {
        var frame = document.createElement('div');
        frame.className = frameClass;
        var badge = document.createElement('div');
        badge.className = 'ann-badge';
        badge.textContent = m.n;
        wireMarkBadge(badge, m.n);
        marksLayer.appendChild(frame);
        marksLayer.appendChild(badge);
        entry.parts.push({ frame: frame, badge: badge });
      }

      entry.parts.forEach(function (part) {
        if (part.frame.className !== frameClass) part.frame.className = frameClass;
        if (part.badge.textContent !== String(m.n)) part.badge.textContent = m.n;
      });
      entry.signature = markGeometryKey(m);
      entry.liveTargets = targets[index];
      entry.model = null;

      if (!m.move && entry.arrow) {
        if (entry.arrow.parentNode) entry.arrow.parentNode.removeChild(entry.arrow);
        entry.arrow = null;
      }
    });
    Object.keys(markNodes).forEach(function (key) {
      if (keep[key]) return;
      removeMarkNode(markNodes[key]);
      delete markNodes[key];
    });
    structureDirty = false;
  }

  function clearMarkArrow(entry) {
    if (entry.arrow && entry.arrow.parentNode) entry.arrow.parentNode.removeChild(entry.arrow);
    entry.arrow = null;
  }

  function resetCanvasView() {
    if (!canvasView) return;
    canvasView.groups.forEach(function (group) {
      while (group.node.firstChild) marksLayer.appendChild(group.node.firstChild);
      group.node.remove();
      group.entries.forEach(function (entry) { entry.group = null; });
    });
    marksLayer.style.transform = '';
    canvasView = null;
  }

  function canvasStage() {
    var stage = document.getElementById('wbstage');
    return stage && window.workbench && window.workbench.boardMode() !== 'html' ? stage : null;
  }

  function canvasPose(stage) {
    var wrap = document.querySelector('#wb-board-panel .wb-zoom-wrap');
    var r = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
    var o = overlayOrigin();
    return { x: r.left - o[0] + stage.scrollLeft, y: r.top - o[1] + stage.scrollTop,
      zoom: Number(document.documentElement.getAttribute('data-canvas-zoom')) || 1 };
  }

  function entryRoots(entry) {
    var roots = new Set();
    function add(el) { var root = el && el.closest('.wb-screen, .wb-lib-item'); if (root) roots.add(root); }
    if (entry.m.type === 'element') markElementTargets(entry.m).forEach(function (t) {
      add(resolveMarkSelector(t.selector, entry.m.screenId || ''));
    });
    else if (entry.m.base) add(resolveMarkSelector(entry.m.base.selector, entry.m.screenId || ''));
    else (entry.m.contains || []).forEach(function (t) { add(resolveMarkSelector(t.selector, entry.m.screenId || '')); });
    if (entry.m.move && entry.m.move.to_selector) add(resolveMarkSelector(entry.m.move.to_selector, entry.m.screenId || ''));
    return roots;
  }

  function prepareCanvasView(stage, rebuild) {
    if (canvasView && !rebuild) return;
    var groups = new Map();
    if (canvasView) canvasView.groups.forEach(function (g) { g.entries = []; groups.set(g.root, g); });
    else canvasView = { stage: stage, groups: [], width: 0, height: 0, pose: canvasPose(stage) };
    Object.keys(markNodes).forEach(function (key) {
      var entry = markNodes[key];
      if (!entry.model) entry.roots = entryRoots(entry);
      var root = entry.roots.values().next().value || null;
      var group = groups.get(root);
      if (!group) {
        var node = document.createElement('div');
        node.className = 'ann-mark-group'; marksLayer.appendChild(node);
        group = { node: node, root: root, entries: [], bounds: null, visible: true };
        groups.set(root, group);
      }
      entry.group = group; group.entries.push(entry);
      entry.parts.forEach(function (part) {
        if (part.frame.parentNode !== group.node) group.node.appendChild(part.frame);
        if (part.badge.parentNode !== group.node) group.node.appendChild(part.badge);
      });
      if (entry.arrow && entry.arrow.parentNode !== group.node) group.node.appendChild(entry.arrow);
    });
    syncFrameResizeObservers(stage);
    canvasView.groups = Array.from(groups.values()).filter(function (g) {
      if (g.entries.length) return true;
      g.node.remove(); return false;
    });
  }

  function cacheMarkGeometry(geometry) {
    var pose = canvasView.pose;
    function point(p) { return [(p[0] - pose.x) / pose.zoom, (p[1] - pose.y) / pose.zoom]; }
    geometry.entry.model = {
      parts: geometry.parts.map(function (r) {
        if (!r) return null;
        var rect = expandRect(r, -MARK_BOX_PAD_PX);
        return point(rect).concat([rect[2] / pose.zoom, rect[3] / pose.zoom]);
      }),
      arrow: geometry.arrow ? { from: point(geometry.arrow.from), to: point(geometry.arrow.to) } : null
    };
    geometry.parts.forEach(function (part, i) { if (!part) hidePartNodes(geometry.entry.parts[i]); });
    geometry.entry.paintPose = null;
  }

  function projectMark(entry) {
    var pose = canvasView.pose, model = entry.model;
    function point(p) { return [p[0] * pose.zoom + pose.x, p[1] * pose.zoom + pose.y]; }
    return { entry: entry, parts: model.parts.map(function (r) {
      return r ? expandRect(point(r).concat([r[2] * pose.zoom, r[3] * pose.zoom])) : null;
    }), arrow: model.arrow ? { from: point(model.arrow.from), to: point(model.arrow.to) } : null };
  }

  function markLocalRect(viewR) {
    var r = viewToOverlayRect(viewR);
    if (measuringCanvas) { r[0] += canvasView.stage.scrollLeft; r[1] += canvasView.stage.scrollTop; }
    return r;
  }

  function measureMark(entry) {
    var m = entry.m;
    var views = [], els = [];
    if (m.type === 'region') {
      var anchor = resolveMarkAnchor(m);
      els.push(anchor.el);
      views.push(anchor.live ? visibleViewRectDoc(anchor.rectDoc, anchor.el) : null);
    } else {
      (entry.liveTargets || []).forEach(function (target) {
        els.push(target.el);
        views.push(visibleViewRectOf(target.el));
      });
    }
    var parts = views.map(function (r) { return r ? expandRect(markLocalRect(r)) : null; });
    var arrow = null;
    if (m.move && views[0]) {
      var endDoc = moveEndPoint(m);
      var endEl = m.move.to_selector ? resolveMarkSelector(m.move.to_selector, m.screenId || '') : els[0];
      if (endDoc && viewPointInClips(docPointToView(endDoc), endEl)) {
        var fromRect = m.type === 'region' ? parts[0] : markLocalRect(views[0]);
        var to = markLocalRect([endDoc[0] - scrollX, endDoc[1] - scrollY, 0, 0]);
        arrow = { from: [fromRect[0] + fromRect[2] / 2, fromRect[1] + fromRect[3] / 2], to: [to[0], to[1]] };
      }
    }
    return { entry: entry, parts: parts, arrow: arrow };
  }

  function paintMark(geometry) {
    var entry = geometry.entry;
    entry.parts.forEach(function (part, i) {
      var local = geometry.parts[i];
      if (!local) { hidePartNodes(part); return; }
      showPartNodes(part);
      placeFixedRect(part.frame, local);
      var pos = badgePositionForRect(local);
      part.badge.style.left = pos.left + 'px';
      part.badge.style.top = pos.top + 'px';
    });
    if (geometry.arrow) placeArrow(entry, geometry.arrow.from, geometry.arrow.to);
    else clearMarkArrow(entry);
  }

  function geometryBounds(updates) {
    var x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    function include(r) {
      if (!r) return;
      x = Math.min(x, r[0]); y = Math.min(y, r[1]);
      right = Math.max(right, r[0] + r[2]); bottom = Math.max(bottom, r[1] + r[3]);
    }
    updates.forEach(function (item) {
      item.parts.forEach(include);
      if (item.arrow) { include(item.arrow.from.concat([1, 1])); include(item.arrow.to.concat([1, 1])); }
    });
    return x === Infinity ? null : [x - 24, y - 24, right - x + 48, bottom - y + 48];
  }

  // Native scrolling moves the HTML; one transform moves its annotation layer.
  // Only frame groups entering/leaving the viewport change visibility. No mark
  // selectors, target rects or ancestor styles are read on this path.
  function syncCanvasPose() {
    if (!canvasView) return;
    var pose = canvasView.pose;
    var sx = canvasView.stage.scrollLeft, sy = canvasView.stage.scrollTop;
    var viewport = [(sx - pose.x) / pose.zoom, (sy - pose.y) / pose.zoom,
      canvasView.width / pose.zoom, canvasView.height / pose.zoom];
    canvasView.groups.forEach(function (group) {
      var visible = !!intersectRects(group.bounds, viewport);
      if (visible !== group.visible) { group.visible = visible; group.node.style.display = visible ? '' : 'none'; }
      if (!visible) return;
      group.entries.forEach(function (entry) {
        if (!entry.model || entry.paintPose === pose) return;
        paintMark(projectMark(entry)); entry.paintPose = pose;
      });
    });
    marksLayer.style.transform = 'translate3d(' + (-sx) + 'px,' + (-sy) + 'px,0)';
  }

  function frameLayoutRect(root) {
    if (!root) return null;
    var el = root.matches('.wb-screen') ? root.querySelector('.ios-stage, .wb-comp-stage, .wb-html-stage, .wb-screen-err') : root;
    if (!el) return null;
    var pose = canvasView.pose, r = markLocalRect(viewRect(el));
    return [(r[0] - pose.x) / pose.zoom, (r[1] - pose.y) / pose.zoom, r[2] / pose.zoom, r[3] / pose.zoom];
  }

  function updateMarkGeometry(dirtyRoots, layoutChanged, dirtyEntries) {
    var stage = canvasStage();
    if (canvasView && canvasView.stage !== stage) resetCanvasView();
    beginOverlayFrame();
    if (stage) prepareCanvasView(stage);
    var updates = [];
    measuringCanvas = !!canvasView;
    try {
      geometryBatch(function () {
        if (canvasView) {
          canvasView.pose = canvasPose(stage);
          var overlayRect = viewRect(overlay);
          canvasView.width = overlayRect[2]; canvasView.height = overlayRect[3];
          // Frame layout changes can move neighbours without changing their contents.
          canvasView.groups.forEach(function (group) {
            var old = group.box;
            var box = !dirtyRoots || layoutChanged ? frameLayoutRect(group.root) : old;
            group.box = box;
            var dx = old && box ? box[0] - old[0] : 0, dy = old && box ? box[1] - old[1] : 0;
            var resized = old && box && (Math.abs(old[2] - box[2]) > .1 || Math.abs(old[3] - box[3]) > .1);
            group.entries.forEach(function (entry) {
              var dirty = dirtyEntries ? dirtyEntries.has(entry) : (!dirtyRoots || !entry.model || !group.root || resized);
              if (!dirtyEntries && dirtyRoots && entry.roots) entry.roots.forEach(function (root) { if (dirtyRoots.has(root)) dirty = true; });
              if (!dirty && (dx || dy)) {
                if (entry.roots.size > 1) dirty = true;
                else {
                  entry.model.parts.forEach(function (r) { if (r) { r[0] += dx; r[1] += dy; } });
                  if (entry.model.arrow) { entry.model.arrow.from[0] += dx; entry.model.arrow.from[1] += dy;
                    entry.model.arrow.to[0] += dx; entry.model.arrow.to[1] += dy; }
                }
              }
              if (dirty) updates.push(measureMark(entry));
            });
          });
        } else updates = Object.keys(markNodes).map(function (key) { return measureMark(markNodes[key]); });
      });
    } finally { measuringCanvas = false; }
    if (canvasView) {
      updates.forEach(cacheMarkGeometry);
      canvasView.groups.forEach(function (group) {
        group.bounds = geometryBounds(group.entries.map(function (entry) { return entry.model; }).filter(Boolean));
      });
      syncCanvasPose();
    } else updates.forEach(paintMark);
  }

  function updateCanvasZoom() {
    if (!canvasView) { onViewChange(); return; }
    beginOverlayFrame(); canvasView.pose = canvasPose(canvasView.stage);
    syncCanvasPose();
  }

  function updateCountLabel(shown) {
    elCount.textContent = shown + ' 条' + (marks.length > shown ? ' · 共 ' + marks.length : '');
  }

  // ---------- 评论气泡（"在画布渲染评论"开关）----------
  // 与 pin 同一套几何管线（resolveMarkAnchor → docToView → viewToOverlayRect），
  // 但独立于 标注/交互 模式：开关一开就在画布上把 content 渲染成气泡，
  // 序号与 pin 对应，半透明细线指向锚点。稀疏默认放右侧，密集时左右分流。
  var bubbleNodes = Object.create(null);   // n → { m, node, height }
  var BUBBLE_W = 186;   // 2026-09-04 评审板 H1 的评论卡宽度
  var BUBBLE_MARGIN = 12;

  function clearBubbles() {
    Object.keys(bubbleNodes).forEach(function (n) {
      var node = bubbleNodes[n].node;
      if (node.parentNode) node.parentNode.removeChild(node);
      delete bubbleNodes[n];
    });
  }

  function syncBubbleStructure(pageMarks) {
    if (!renderComments) { clearBubbles(); return; }
    var keep = Object.create(null);
    pageMarks.forEach(function (m) {
      if (isMarkBroken(m)) return;            // 无锚点 → 无法定位气泡
      keep[m.n] = true;
      var entry = bubbleNodes[m.n];
      if (!entry) {
        var node = document.createElement('div');
        node.className = 'ann-bubble';
        node.setAttribute('data-ann-ui', '');
        node.setAttribute('data-n', m.n);
        var html = bubbleInnerHtml(bubbleMarkView(m));
        node.innerHTML = html;
        node.addEventListener('click', function (e) {
          if (e.target.closest('.ann-bubble')) { e.stopPropagation(); openMark(m.n); }
        });
        // 指针从钉子挪到卡上 = 继续读，不收
        node.addEventListener('mouseenter', function () { showBubbleFor(m.n, 0); });
        node.addEventListener('mouseleave', hideBubbleSoon);
        bubblesLayer.appendChild(node);
        entry = bubbleNodes[m.n] = { m: m, node: node, height: 0, html: html };
      } else {
        entry.m = m;
        var nextHtml = bubbleInnerHtml(bubbleMarkView(m));
        if (entry.html !== nextHtml) {
          entry.node.innerHTML = nextHtml;
          entry.html = nextHtml;
          entry.height = 0;
        }
      }
    });
    // DOM writes above are complete before any height reads. Canvas comments
    // are measured only when hovered/focused, never once per hidden comment.
    if (!canvasStage()) Object.keys(bubbleNodes).forEach(function (n) {
      bubbleNodes[n].height = bubbleNodes[n].node.offsetHeight || 0;
    });
    Object.keys(bubbleNodes).forEach(function (n) {
      if (keep[n]) return;
      if (bubbleNodes[n].node.parentNode) bubbleNodes[n].node.parentNode.removeChild(bubbleNodes[n].node);
      delete bubbleNodes[n];
    });
  }

  function updateCanvasBubble() {
    var n = bubbleShowN != null ? bubbleShowN : bubbleFocusN;
    var bubble = bubbleNodes[n];
    if (!bubble) return;
    var mark = markNodes[n];
    var r = mark && mark.model ? projectMark(mark).parts[0] : null;
    if (!r || bubbleLayout === 'sidebar') { bubble.node.hidden = true; return; }
    var local = expandRect(r, -MARK_BOX_PAD_PX);
    local[0] -= canvasView.stage.scrollLeft; local[1] -= canvasView.stage.scrollTop;
    local = intersectRects(local, [0, 0, canvasView.width, canvasView.height]);
    if (!isVisibleEnough(local)) { bubble.node.hidden = true; return; }
    bubble.node.hidden = false;
    var bw = Math.min(BUBBLE_W, Math.max(160, canvasView.width - BUBBLE_MARGIN * 2));
    if (!bubble.height || bubble.width !== bw) {
      bubble.node.style.width = bw + 'px';
      bubble.width = bw;
      bubble.height = bubble.node.offsetHeight;
    }
    var left = local[0] + local[2] + 13;
    if (left + bw > canvasView.width - BUBBLE_MARGIN) left = local[0] - bw - 13;
    left = Math.max(BUBBLE_MARGIN, Math.min(left, canvasView.width - bw - BUBBLE_MARGIN));
    var top = Math.max(BUBBLE_MARGIN, Math.min(local[1] - 6, canvasView.height - bubble.height - BUBBLE_MARGIN));
    bubble.node.style.left = Math.round(left) + 'px';
    bubble.node.style.top = Math.round(top) + 'px';
  }

  /** Two-column greedy packer: sparse → right; when right crowds, spill left.
   *  No connector lines — bubble numbers match pin badges for correspondence. */
  function updateBubbleGeometry() {
    if (!renderComments) return;
    if (canvasView) { updateCanvasBubble(); return; }
    beginOverlayFrame();
    // sidebar 模式：iframe 内不画气泡（由父级 workbench 在右侧 gutter 渲染）。
    if (bubbleLayout === 'sidebar') {
      Object.keys(bubbleNodes).forEach(function (n) { bubbleNodes[n].node.hidden = true; });
      return;
    }
    var overlayRect = overlay.getBoundingClientRect();
    var overlayW = overlayRect.width;
    var overlayH = overlayRect.height;
    var bw = Math.min(BUBBLE_W, Math.max(160, overlayW - BUBBLE_MARGIN * 2));
    // 候选 = 锚点此刻在视口里的那些。锚点在视口外的不给卡（跟 Word 的页边批注
    // 同一条规矩：只看得见屏幕上这段文字的评论）。
    Object.keys(bubbleNodes).forEach(function (n) {
      var entry = bubbleNodes[n];
      var anchorDoc = markAnchorRect(entry.m);
      if (!anchorDoc) { entry.node.hidden = true; return; }
      var anchorView = visibleViewRectDoc(anchorDoc, resolveMarkAnchor(entry.m).el);
      if (!anchorView) { entry.node.hidden = true; return; }
      var local = viewToOverlayRect(anchorView);
      if (local[1] + local[3] < 0 || local[1] > overlayH) { entry.node.hidden = true; return; }
      entry.node.hidden = false;
      /* 2026-09-04 评审板 H1：一次只出一张卡（hover 的那一枚钉子），所以不再
         两列打包 —— 卡就摆在钉子右边；右边放不下就翻到左边。钉子在锚点框的
         右上角（badgePositionForRect，22px），卡与它留 13px 气口。 */
      // 高度用 renderBubbles 量好的缓存值：每帧对每张卡读 offsetHeight 会在上一张
      // 刚写完 left/top 后强制一次布局，滚动时 M 张卡就是 M 次布局。
      var h = entry.height || 0;
      var left = local[0] + local[2] + 13;
      if (left + bw > overlayW - BUBBLE_MARGIN) left = local[0] - bw - 13;
      left = Math.max(BUBBLE_MARGIN, Math.min(left, overlayW - bw - BUBBLE_MARGIN));
      var top = Math.max(BUBBLE_MARGIN, Math.min(local[1] - 6, overlayH - h - BUBBLE_MARGIN));
      entry.node.style.left = Math.round(left) + 'px';
      entry.node.style.top = Math.round(top) + 'px';
      entry.node.style.width = Math.round(bw) + 'px';
    });
    syncBubbleVisibility();
  }

  /** 给父级 workbench 用（gutter 模式）：返回当前视口内可见锚点的 rect（iframe 视口坐标）
   *  + 文本，供父级映射到自己的坐标系后在右侧 gutter 渲染气泡。rect 原点为 iframe 视口
   *  左上，与 overlay（position:fixed; inset:0）一致。 */
  function visibleBubbleAnchors() {
    if (!renderComments || bubbleLayout !== 'sidebar') return [];
    beginOverlayFrame();
    var overlayH = overlay.getBoundingClientRect().height;
    var out = [];
    visiblePageMarks().forEach(function (m) {
      if (isMarkBroken(m)) return;
      var anchorDoc = markAnchorRect(m);
      if (!anchorDoc) return;
      var anchorView = visibleViewRectDoc(anchorDoc, resolveMarkAnchor(m).el);
      if (!anchorView) return;
      var local = viewToOverlayRect(anchorView);
      if (local[1] + local[3] < 0 || local[1] > overlayH) return;
      var view = bubbleMarkView(m);
      out.push({
        n: m.n,
        rect: [Math.round(local[0]), Math.round(local[1]), Math.round(local[2]), Math.round(local[3])],
        cap: view.cap,
        content: view.content
      });
    });
    return out;
  }

  function markGeometryKey(m) {
    return JSON.stringify([m.type, m.pageId, m.screenId, m.section, m.group,
      m.selector, m.targets, m.rect, m.base, m.contains, m.move]);
  }

  // Ledger replacements can change one comment without invalidating every DOM anchor.
  function renderLedgerChange() {
    if (!canvasView) { renderAll(); return; }
    return withLiveTargets(function () {
      var affected = new Set(), present = new Set();
      selectorCache.clear(); frameRoots = null;
      var pageMarks = geometryBatch(function () {
        return marks.filter(function (m) {
          if (!markOnActivePage(m)) return false;
          present.add(String(m.n));
          var entry = markNodes[m.n];
          if (entry && entry.signature === markGeometryKey(m)) {
            var fact = markFacts.get(entry.m);
            if (fact) markFacts.set(m, fact);
            entry.m = m;
          } else {
            if (entry) entry.m = m;
            markFacts.delete(m); affected.add(m);
          }
          return markHasLiveTarget(m) && !(activeComposer && activeComposer.m.type === 'element' && activeComposer.persistedN === m.n);
        });
      });
      Object.keys(markNodes).forEach(function (key) {
        if (!present.has(key)) affected.add(markNodes[key].m);
      });
      if (affected.size) {
        syncMarkStructure(pageMarks.filter(function (m) { return affected.has(m); }), affected);
        prepareCanvasView(canvasView.stage, true);
        var entries = new Set();
        affected.forEach(function (m) { if (markNodes[m.n]) entries.add(markNodes[m.n]); });
        updateMarkGeometry(new Set(), false, entries);
      }
      structureDirty = false;
      syncBubbleStructure(pageMarks); updateBubbleGeometry(); updateDraftGeometry();
      updateCountLabel(pageMarks.length); syncGhost(); renderResultIndicators(true);
    });
  }

  function renderAll() {
    if (!overlay.isConnected) mountOverlay();
    return withLiveTargets(function () {
      clearAnchorCache();
      if (!canvasStage() && frameResizeObserver) { frameResizeObserver.disconnect(); observedFrames.clear(); }
      var pageMarks = geometryBatch(visiblePageMarks);
      syncMarkStructure(pageMarks);
      updateMarkGeometry();
      syncBubbleStructure(pageMarks);
      updateBubbleGeometry();
      updateDraftGeometry();
      updateCountLabel(pageMarks.length);
      syncGhost(); renderResultIndicators(true);
    });
  }

  var viewRaf = 0;
  var geometryDirty = false;
  var zoomDirty = false;
  var contentFullDirty = false;
  var contentRoots = new Set();
  var dirtyFrameRoots = new Set();

  function refreshFrameContent(roots) {
    return withLiveTargets(function () {
      var affected = new Set();
      var changedState = false;
      marks.forEach(function (m) {
        if (!markOnActivePage(m)) return;
        var entry = markNodes[m.n];
        var touches = !entry || !entry.roots || !entry.roots.size;
        roots.forEach(function (root) {
          if (m.screenId === root.getAttribute('data-screen') || (entry && entry.roots.has(root))) touches = true;
        });
        if (touches) affected.add(m);
      });
      selectorCache.clear(); frameRoots = null;
      var visible = geometryBatch(function () {
        var list = [];
        affected.forEach(function (m) {
          var old = markFacts.get(m);
          markFacts.delete(m);
          var live = markHasLiveTarget(m), broken = isMarkBroken(m);
          if (!old || old.live !== live || old.broken !== broken) changedState = true;
          if (live && !(activeComposer && activeComposer.m.type === 'element' && activeComposer.persistedN === m.n)) list.push(m);
        });
        return list;
      });
      syncMarkStructure(visible, affected);
      prepareCanvasView(canvasView.stage, true);
      updateMarkGeometry(roots, true);
      if (changedState) {
        var pageMarks = geometryBatch(visiblePageMarks);
        syncBubbleStructure(pageMarks); updateCountLabel(pageMarks.length); notify();
      }
      updateBubbleGeometry(); updateDraftGeometry(); syncGhost();
    });
  }
  function onViewChange(event) {
    var stage = canvasStage();
    if (!event || event.type !== 'scroll' || event.target !== stage) {
      var root = event && event.type === 'scroll' && event.target.closest && event.target.closest('.wb-screen');
      if (root && canvasView) dirtyFrameRoots.add(root);
      else geometryDirty = true;
    }
    scheduleViewUpdate();
  }

  function scheduleViewUpdate() {
    if (viewRaf) return;
    viewRaf = requestAnimationFrame(function () {
      viewRaf = 0;
      if (structureDirty || contentFullDirty) { renderAll(); notify(); }
      else if (contentRoots.size && canvasView) {
        dirtyFrameRoots.forEach(function (root) { contentRoots.add(root); });
        refreshFrameContent(contentRoots);
      }
      else {
        if (!canvasView || geometryDirty) updateMarkGeometry();
        else if (dirtyFrameRoots.size) updateMarkGeometry(dirtyFrameRoots);
        else if (zoomDirty) updateCanvasZoom();
        else syncCanvasPose();
        updateBubbleGeometry();
        updateDraftGeometry();
        syncGhost();
      }
      renderResultIndicators(geometryDirty || contentRoots.size > 0 || dirtyFrameRoots.size > 0);
      if (activeComposer && activeComposer.syncLayout) activeComposer.syncLayout();
      geometryDirty = false; zoomDirty = false; contentFullDirty = false;
      contentRoots.clear(); dirtyFrameRoots.clear();
    });
  }

  addEventListener('resize', onViewChange);
  // Nested frame scrollports (.ios-app, sheet body, …) do not bubble; capture
  // on document so mark geometry tracks phone scroll as well as #wbstage pan.
  document.addEventListener('scroll', onViewChange, { passive: true, capture: true });

  // Interactive HTML documents change views without navigating or resizing:
  // tabs toggle `hidden`, dialogs change classes, and async renders replace
  // children. Invalidate affected frames, with a full fallback for global changes. Ignore
  // mutations made by the annotation UI itself or renderAll would observe its
  // own overlay updates and loop forever.

  function annotationUiNode(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && isUI(el));
  }

  function contentMutation(record) {
    if (annotationUiNode(record.target)) return false;
    if (record.target === document.documentElement && record.type === 'attributes') {
      if (record.attributeName === 'data-canvas-zoom' || record.attributeName === 'data-pinpoint-mode') return false;
      if (record.attributeName === 'style') {
        var withoutViewport = function (value) { return String(value || '').split(';').filter(function (v) {
          return v.trim() && !/^\s*(--wb-board-zoom|--wb-strip-w)\s*:/.test(v);
        }).join(';'); };
        if (withoutViewport(record.oldValue) === withoutViewport(record.target.getAttribute('style'))) return false;
      }
    }
    if (record.target.id === 'wbstage' && record.type === 'attributes' && record.attributeName === 'style') {
      var withoutScrollPadding = function (value) { return String(value || '').split(';').filter(function (v) {
        return v.trim() && !/^\s*scroll-padding-bottom\s*:/.test(v);
      }).join(';'); };
      if (withoutScrollPadding(record.oldValue) === withoutScrollPadding(record.target.getAttribute('style'))) return false;
    }
    // Only the workbench-owned zoom wrap dimensions are viewport bookkeeping.
    if (canvasView && record.type === 'attributes' && record.attributeName === 'style' &&
        record.target.matches('.wb-zoom-wrap, .wb-library')) {
      var withoutSize = function (value) { return String(value || '').split(';').filter(function (v) {
        return v.trim() && !/^\s*(width|height|--wb-board-zoom)\s*:/.test(v);
      }).join(';'); };
      if (withoutSize(record.oldValue) === withoutSize(record.target.getAttribute('style'))) return false;
    }
    // Cursor/user-select changes are navigation feedback, not content layout.
    if (record.type === 'attributes' && record.attributeName === 'class' &&
        (record.target === document.body || record.target.id === 'wbstage')) {
      var withoutPan = function (value) {
        return String(value || '').split(/\s+/).filter(function (c) {
          return c && c !== 'wb-panning' && c !== 'wb-space-pan';
        }).sort().join(' ');
      };
      if (withoutPan(record.oldValue) === withoutPan(record.target.className)) return false;
    }
    if (record.type !== 'childList') return true;
    var changed = Array.prototype.slice.call(record.addedNodes || [])
      .concat(Array.prototype.slice.call(record.removedNodes || []));
    return changed.some(function (node) { return !annotationUiNode(node); });
  }

  function scheduleContentRender(event) {
    var target = event && event.target;
    if (target && target.nodeType !== 1) target = target.parentElement;
    var root = target && target.closest && target.closest('.wb-screen');
    if (canvasView && root) contentRoots.add(root);
    else contentFullDirty = true;
    scheduleViewUpdate();
  }

  if (typeof MutationObserver !== 'undefined' && document.body) {
    var contentMutationObserver = new MutationObserver(function (records) {
      var dependencies;
      function selectorDependencies() {
        if (dependencies) return dependencies;
        dependencies = { relational: false, global: false };
        marks.forEach(function (m) {
          var selectors = markElementTargets(m).map(function (t) { return t.selector; });
          resultTargets(m).forEach(function (target) { selectors.push(target.selector); });
          if (m.base) selectors.push(m.base.selector);
          if (m.move) selectors.push(m.move.to_selector);
          selectors.forEach(function (selector) {
            if (!selector) return;
            if (/:has\(|[+~]|\[style/.test(selector)) dependencies.relational = true;
            if (!frameInternalSelector(selector)) dependencies.global = true;
          });
        });
        return dependencies;
      }
      records.forEach(function (record) {
        if (!contentMutation(record)) return;
        // Stylesheets and relational/global selector dependencies can reach other frames.
        var node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        var broad = node && node.closest('style, link');
        if (!broad) {
          var deps = selectorDependencies();
          broad = deps.relational || (record.type !== 'characterData' && record.attributeName !== 'style' && deps.global);
        }
        scheduleContentRender(broad ? null : record);
      });
    });
    contentMutationObserver.observe(document.documentElement, { attributes: true, attributeOldValue: true });
    contentMutationObserver.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
    contentMutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true
    });
  }

  var observedFrames = new Map();
  var frameResizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(function (entries) {
    entries.forEach(function (entry) {
      var old = observedFrames.get(entry.target);
      if (!old) return;
      var size = [entry.contentRect.width, entry.contentRect.height];
      observedFrames.set(entry.target, size);
      if (old.length && (Math.abs(old[0] - size[0]) > .1 || Math.abs(old[1] - size[1]) > .1)) {
        scheduleContentRender({ target: entry.target });
      }
    });
  });
  function syncFrameResizeObservers(stage) {
    if (!frameResizeObserver) return;
    var current = new Set(stage.querySelectorAll('.wb-lib-item, .ios-stage, .wb-comp-stage, .wb-html-stage'));
    observedFrames.forEach(function (_, node) {
      if (!current.has(node)) { frameResizeObserver.unobserve(node); observedFrames.delete(node); }
    });
    current.forEach(function (node) {
      if (!observedFrames.has(node)) { observedFrames.set(node, []); frameResizeObserver.observe(node); }
    });
  }

  // Layout can also move after an image/font finishes, a CSS transition ends,
  // or a route changes without a useful DOM mutation. These are cheap fallback
  // signals and share the same rAF coalescing path.
  if (typeof ResizeObserver !== 'undefined' && document.body) {
    var contentResizeObserver = new ResizeObserver(scheduleContentRender);
    contentResizeObserver.observe(document.body);
    var observedStage = document.getElementById('wbstage');
    if (observedStage) contentResizeObserver.observe(observedStage);
  }
  document.addEventListener('load', function (event) {
    if (!annotationUiNode(event.target)) scheduleContentRender(event);
  }, true);
  document.addEventListener('transitionend', function (event) {
    if (!annotationUiNode(event.target)) scheduleContentRender();
  }, true);
  document.addEventListener('animationend', function (event) {
    if (!annotationUiNode(event.target)) scheduleContentRender();
  }, true);
  addEventListener('hashchange', scheduleContentRender);
  addEventListener('popstate', scheduleContentRender);

  // ESC：关 mention → 取消 composer 草稿 → 取消画箭头 → 退出标注模式（组字中不响应）
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
    if (document.getElementById('ann-mention')) {
      e.preventDefault();
      closeMention();
      return;
    }
    if (activeComposer || document.getElementById('ann-box')) {
      e.preventDefault();
      closeComposer();
      return;
    }
    if (arrowFrom || drag || lasso) {
      e.preventDefault();
      arrowFrom = null;
      drag = null;
      removeTip();
      removeTempArrow();
      if (lasso) { lasso.remove(); lasso = null; }
      clearHover();
      return;
    }
    if (mode) {
      e.preventDefault();
      toggleMode();
    }
  });

  function setFloatingToolbar(show) {
    floatingToolbar = !!show;
    toolbar.style.display = floatingToolbar ? 'flex' : 'none';
    notify();
  }

  function openMark(n) {
    var m = marks.find(function (k) { return k.n === n; });
    if (!m) return;
    if (activeComposer) {
      if (activeComposer.persistedN !== n) setStatus('请先保存或取消当前标注', true);
      return;
    }
    var rect = markAnchorRect(m);
    openComposer(m, rect, false);
    if (!rect) setStatus('锚点失效', true);
  }

  // ann-flash 到期：composer 开着时收编为其常驻高亮（原位去 class，几何不变），否则隐藏。
  function endFlash() {
    flashUntil = 0;
    if (!hoverGhost || hoverGhost.hidden) return;
    if (activeComposer) hoverGhost.classList.remove('ann-flash');
    else hideGhost();
  }

  var markNavigation = 0;
  // Escape must also cancel jumps still waiting for their initial animation frames.
  // Capture runs before the list/composer can consume the dismissal event.
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) markNavigation++;
  }, true);

  function flashAndOpen(m, navigation) {
    var anchor = resolveMarkAnchor(m);
    var stageEl = document.getElementById('wbstage');
    var wb = window.workbench;
    var frameFocused = !!(
      wb && m.screenId && typeof wb.focusFrame === 'function' &&
      wb.focusFrame(annotationSection(m), m.screenId)
    );
    if (!frameFocused && anchor.live && anchor.el && stageEl) {
      var er = anchor.el.getBoundingClientRect();
      var sr = stageEl.getBoundingClientRect();
      var target = {
        top: stageEl.scrollTop + er.top - sr.top - sr.height / 2 + er.height / 2,
        left: stageEl.scrollLeft + er.left - sr.left - sr.width / 2 + er.width / 2
      };
      if (wb && wb.scrollTo) wb.scrollTo(target);
      else stageEl.scrollTo(target);
    } else if (!frameFocused && anchor.live && anchor.el && anchor.el.scrollIntoView) {
      // 独立文档 / 注入页没有 #wbstage 舞台：直接滚动文档到锚点。
      anchor.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    var settled = wb && wb.whenScrollSettled ? wb.whenScrollSettled() : Promise.resolve(true);
    return settled.then(function (completed) {
      if (!completed || navigation !== markNavigation) return false;
      renderAll();
      focusBubble(m.n);
      if (anchor.live && anchor.el) {
        flashUntil = Date.now() + 1500;
        showGhostForEl(anchor.el, 'ann-flash');
        setTimeout(endFlash, 1500);
      } else if (anchor.live && m.type === 'region' && anchor.rectDoc) {
        flashUntil = Date.now() + 1500;
        showGhostForRect(anchor.rectDoc, 'ann-flash', anchor.el);
        setTimeout(endFlash, 1500);
      }
      openMark(m.n);
      return true;
    });
  }

  function goToMark(n) {
    var navigation = ++markNavigation;
    var m = marks.find(function (k) { return k.n === n; });
    if (!m) return Promise.resolve();
    var p = Promise.resolve();
    var wb = window.workbench;
    if (wb) {
      if (m.pageId && typeof wb.setActivePage === 'function' && m.pageId !== currentWorkbenchPageId()) {
        p = Promise.resolve(wb.setActivePage(m.pageId, { scrollTop: false })).then(function () {
          var sec = annotationSection(m);
          if (sec && typeof wb.switchPage === 'function') return wb.switchPage(sec, { scroll: false });
        });
      } else if (annotationSection(m) && typeof wb.switchPage === 'function') {
        p = wb.switchPage(annotationSection(m), { scroll: false });
      }
    }
    return Promise.resolve(p).then(function () {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (navigation !== markNavigation) { resolve(false); return; }
            resolve(flashAndOpen(m, navigation));
          });
        });
      });
    });
  }

  function getState() {
    var pageMarks = marks.filter(markOnActivePage);
    var invalidScopes = new Map();
    var broken = 0;
    var live = 0;
    var hidden = 0;
    pageMarks.forEach(function (m) {
      if (markHasLiveTarget(m)) live++;
      else if (isMarkBroken(m)) broken++;
      else hidden++;
    });
    return {
      mode: mode,
      connected: serverOnline,
      syncError: syncError,
      paused: paused,
      floating: floatingToolbar,
      sidebar: sidebarOpen,
      renderComments: renderComments,
      bubbleLayout: bubbleLayout,
      count: pageMarks.length,
      countLive: live,
      countBroken: broken,
      countInvalid: pageMarks.filter(function (mark) { return canClearInvalid(mark, invalidScopes); }).length,
      revision: revision,
      syncing: syncing || resultWriting,
      countHidden: hidden,
      countVisible: live,
      countAll: marks.length,
      epoch: syncEpoch,          // SPA 账本世代（路由切换 +1）
      routing: ledgerSwitching   // 账本切换未落地（hydrate 在途）
    };
  }

  function marksForActivePage() {
    return marks.filter(markOnActivePage);
  }

  // ---------- 对外 API（workbench 切 tab 时可主动调 render；也便于脚本化）----------
  window.pinpoint = {
    render: renderAll,
    viewportChanged: function () { zoomDirty = true; onViewChange({ type: 'scroll', target: canvasStage() }); },
    setMode: function (on) { if (!!on !== mode) toggleMode(); },
    setNavigationActive: setNavigationActive,
    toggle: toggleMode,
    setPaused: setPaused,
    setRenderComments: setRenderComments,
    setBubbleLayout: setBubbleLayout,
    visibleBubbleAnchors: visibleBubbleAnchors,
    clear: doClear,
    clearInvalid: clearInvalid,
    canClearInvalid: canClearInvalid,
    recordResults: recordResults,
    removeMark: removeMark,
    setFloatingToolbar: setFloatingToolbar,
    setSidebar: setSidebarOpen,
    toggleSidebar: toggleSidebar,
    hasActiveDraft: function () { return !!activeComposer; },
    cancelDraft: function () {
      if (!activeComposer) return false;
      closeComposer();
      return true;
    },
    openMark: openMark,
    goToMark: goToMark,
    hydrateFrames: hydrateMentionFrames,
    getState: getState,
    markOnActivePage: markOnActivePage,
    resolveMarkAnchor: resolveMarkAnchor,
    isMarkBroken: isMarkBroken,
    commentToDisplay: contentToDisplay,
    contentToDisplay: contentToDisplay,
    indicatorForMark: indicatorForMark,
    onUpdate: function (fn) { if (typeof fn === 'function') updateListeners.push(fn); },
    get marks() { return marks.slice(); },
    get annotations() { return marks.slice(); },
    get pageMarks() { return marksForActivePage(); }
  };

  // Deprecated alias: external doc pages still call iOSAnnotate.* from their
  // tail scripts (pre-rename); keep it pointing at the live API until they migrate.
  window.iOSAnnotate = window.pinpoint;

  syncModeClass();

  // ---------- SPA 路由账本切换 ----------
  // SPA 用 pushState/replaceState 改 URL 不刷新页面，本脚本只跑过一次；pathname 一变，
  // 标注必须改记到新 pathname 的账本（PAGE/PAGE_KEY/LS_KEY 重算），否则静默记到旧页面名下。
  // hash-only 变化不触发：key 公式只含 pathname（已接受的边界）。

  function finishSessionForLedgerSwitch() {
    // 打开中的草稿：有实质内容先走现有 save() 存回旧账本（save → persist → POST 带
    // 旧 PAGE，服务端落旧账本）；空草稿丢弃。这一切都必须发生在重算 key 之前。
    if (activeComposer) {
      var draft = activeComposer.ta ? activeComposer.ta.value.trim() : '';
      if (draft && typeof activeComposer.save === 'function') activeComposer.save();
      else closeComposer({ silentRender: true });
    }
    // 参照 setPaused(true) 的打包收掉剩余会话态（closeComposer 已覆盖大部分）。
    drag = null;
    if (arrowFrom) { arrowFrom = null; removeTempArrow(); removeTip(); }
    if (pinned) pinned = null;
    if (lasso) { lasso.remove(); lasso = null; }
    hoverEl = null;
    hoverSuppress = null;
    hideGhost();
  }

  function onRouteChange(newPathname) {
    if (!newPathname || newPathname === currentPathname) return;
    // 一次 switchLedger 未完成时再变：coalesce 到最新 pathname。
    if (ledgerSwitching) { queuedPathname = newPathname; return; }
    switchLedger(newPathname);
  }

  function switchLedger(newPathname) {
    ledgerSwitching = true;
    // 1. 会话态收尾（草稿存回旧账本）
    finishSessionForLedgerSwitch();
    // 2. epoch 护栏：在途 sync/hydrate 响应全部作废；deferred 属于旧账本
    syncEpoch++;
    deferredRemoteDoc = null;
    syncing = false; // 旧响应已被 epoch 拦下不会污染；放行新账本立即 persist
    // 3. 同一帧清掉旧账本渲染——hydrate 是异步的，绝不能让旧 selector 在新 DOM 上短暂命中
    marks = [];
    structureDirty = true;
    renderAll();
    // 4. 重算账本（闭包 var 重赋值即全局生效）
    currentPathname = newPathname;
    PAGE = pageKeyFromPathname(newPathname);
    PAGE_KEY = annotationSlug(PAGE);
    LS_KEY = 'pinpoint:' + ENTRY + ':' + newPathname;
    revision = 0;
    mutationVersion = 0;
    syncedMutationVersion = 0;
    syncError = false;
    // 5. SPA 路由可能重建挂载点：掉出文档则按原逻辑重挂（data-ann-viewport 两种
    //    模式的定位差异与 _originCache 失效由 mountOverlay 处理）
    if (!overlay.isConnected) mountOverlay();
    if (!toolbar.isConnected) document.body.appendChild(toolbar);
    if (sidebar && !sidebar.isConnected) document.body.appendChild(sidebar);
    // 6. hydrate 新账本
    hydrateFromDisk().then(function () {
      structureDirty = true;
      renderAll();
      notify();
      ledgerSwitching = false;
      if (queuedPathname && queuedPathname !== currentPathname) {
        var next = queuedPathname;
        queuedPathname = null;
        onRouteChange(next);
      }
    });
  }

  // 层 1：路由信号。首选 Navigation API（只关心 same-document 导航，比较新旧
  // pathname）；没有 window.navigation 时降级为 patch pushState/replaceState
  // （调原实现后再检查）+ popstate。与已有的 popstate → scheduleContentRender
  // 监听共存——popstate 现在多一个账本切换语义。
  // /api/frame 嵌入帧不导航（账本恒定 = 注入的 __pinpointLedger），不装路由监听。
  if (!FRAME) {
    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
      window.navigation.addEventListener('navigate', function (event) {
        try {
          var dest = event && event.destination;
          // 跨文档导航会真刷新、脚本随之重跑，无需切账本
          if (!dest || dest.sameDocument === false || !dest.url) return;
          var nextPathname = new URL(dest.url, location.href).pathname;
          if (nextPathname !== currentPathname) onRouteChange(nextPathname);
        } catch (e) { /* ignore */ }
      });
    } else {
      ['pushState', 'replaceState'].forEach(function (method) {
        var orig = history[method];
        if (typeof orig !== 'function') return;
        history[method] = function () {
          var out = orig.apply(this, arguments);
          try {
            if (location.pathname !== currentPathname) onRouteChange(location.pathname);
          } catch (e) { /* ignore */ }
          return out;
        };
      });
      addEventListener('popstate', function () {
        if (location.pathname !== currentPathname) onRouteChange(location.pathname);
      });
    }
  }

  // ---------- 阶段 5：doc mention 活 frame 水合 ----------
  // doc 页正文里的 <div data-pinpoint-frame="<pageId>/<screenId>"></div> 挂载点
  // 水合为活 frame（iframe → /api/frame 渲染端点；frame 内是完整自包含文档：
  // fragment + 机壳 + ios-kit + annotate 注入 —— 样式隔离白得，标注实例独立）。
  // 已含子节点的挂载点跳过：那是导出烤图（<img>）或已水合的重复扫描。
  var MENTION_VALUE_RE = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._/-]+)$/;

  function embedLedgerPathname() {
    // frame 标注必须与画布同账本：顶层是 workbench 时用顶层的真实 pathname
    // （/ 与 /index.html 两个拼法历史上都开着各自的账本）；否则回落规范入口。
    try {
      var top = window.top;
      if (top && top !== window && top.document && top.document.getElementById('wb-board-panel')) {
        var p = top.location.pathname;
        if (typeof p === 'string' && p.charAt(0) === '/') return p;
      }
    } catch (e) { /* 跨域顶层：按 standalone 处理 */ }
    return '/index.html';
  }

  function autosizeMentionFrame(iframe) {
    function measure() {
      try {
        var doc = iframe.contentDocument;
        if (!doc || !doc.documentElement) return;
        var h = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
        if (h > 0) iframe.style.height = Math.ceil(h) + 'px';
      } catch (e) { /* 同源防御 */ }
    }
    iframe.addEventListener('load', function () {
      measure();
      setTimeout(measure, 300);   // 字体/侧car 脚本落定
      setTimeout(measure, 1200);
    });
  }

  function hydrateMentionFrames(root) {
    if (FRAME) return; // frame 嵌入页自身不再向下水合（mention 是 doc 特性）
    var scope = root && root.querySelectorAll ? root : document;
    var mounts = scope.querySelectorAll('[data-pinpoint-frame]');
    if (!mounts.length) return;
    var ledger = embedLedgerPathname();
    for (var i = 0; i < mounts.length; i++) {
      (function (mount) {
        if (mount.getAttribute('data-pinpoint-hydrated') === '1') return;
        if (mount.firstElementChild) return;
        var m = String(mount.getAttribute('data-pinpoint-frame') || '').trim().match(MENTION_VALUE_RE);
        if (!m) {
          mount.setAttribute('data-pinpoint-frame-error', 'bad-ref');
          return;
        }
        var iframe = document.createElement('iframe');
        iframe.setAttribute('data-pinpoint-frame-iframe', '');
        iframe.setAttribute('title', '@frame:' + m[1] + '/' + m[2]);
        iframe.setAttribute('scrolling', 'no');
        iframe.src = '/api/frame?page=' + encodeURIComponent(m[1]) +
          '&screen=' + encodeURIComponent(m[2]) +
          '&ledger=' + encodeURIComponent(ledger);
        iframe.style.cssText = 'width:100%;border:0;display:block;background:transparent;overflow:hidden';
        autosizeMentionFrame(iframe);
        mount.appendChild(iframe);
        mount.setAttribute('data-pinpoint-hydrated', '1');
      })(mounts[i]);
    }
  }

  function bootMentionHydration() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { hydrateMentionFrames(document); });
    } else {
      hydrateMentionFrames(document);
    }
  }

  // /api/frame 嵌入帧启动时领养父级（doc 页）当前模式；父级异步注入尚未就绪时
  // 有界重试（父级之后的切换由 propagateModeToFrames 推进来）。
  function adoptParentMode() {
    if (!FRAME) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var done = false;
      try {
        var p = window.parent;
        if (p && p !== window && p.pinpoint && typeof p.pinpoint.getState === 'function') {
          var st = p.pinpoint.getState();
          if (st && !!st.mode !== mode) toggleMode();
          done = true;
        }
      } catch (e) { done = true; /* 跨域父级：放弃领养，保持交互 */ }
      if (done || tries > 40) clearInterval(timer);
    }, 100);
  }

  // ---------- 启动：磁盘 hydrate → 渲染 → SSE ----------
  hydrateFromDisk().then(function (online) {
    renderAll();
    notify();
    if (online) {
      // connected is set by SSE onopen, not by hydrate success.
      setStatus('已连接');
      setTimeout(function () { setStatus(''); }, 2000);
      connectEvents();
    } else {
      setServerOnline(false);
    }
    bootMentionHydration();
    adoptParentMode();
  });
})();
