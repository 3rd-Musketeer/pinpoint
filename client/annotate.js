/* pinpoint: Figma-style HTML annotate tool.
 * Browser annotation client. Served as /annotate.js by Vite annotate-api;
 * ios-kit.js injects it on localhost.
 * Anchors use CSS selectors; coords are secondary (scale-safe).
 * SSOT = ~/.pinpoint/<entry>/; localStorage is cache; SSE /events syncs browsers.
 * Modes: 标注 (click → box) | 交互 (demo; default). Text selection stays enabled in 交互.
 * Hierarchy: page → canvas → section → frame (screen + chrome). screenId = frame id.
 * Disk shape: annotations[] with content / section / sectionLabel / screenId / pageId.
 * Indicators: @page: @section: @frame: @a:; local target refs in content use [@t:iN].
 * Overlay mounts inside .wb-stage-wrap (not over the sidebar). */
(function () {
  'use strict';
  if (window.__pinpoint) return;
  window.__pinpoint = true;

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
  var LS_KEY = 'pinpoint:' + ENTRY + ':' + location.pathname;
  // 页面标识 = 文件名 + 全路径短哈希（SSOT: lib/annotate-page-key.js，内联）
  var PAGE = pageKeyFromPathname(location.pathname);
  var PAGE_KEY = annotationSlug(PAGE);
  // 当前账本对应的 pathname；SPA pushState 改 URL 不刷新页面，路由切换时上面三个 key 一起重算。
  var currentPathname = location.pathname;
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
  var composerPlacement = null; // session-local viewport position after handle drag
  var renderComments = false;  // "在画布渲染评论" toggle: show content bubbles beside anchors
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
    var pid = currentWorkbenchPageId();
    if (pid) m.pageId = pid;
    return m;
  }

  // 可选范围（与 board-navigation BOARD_FRAME_SELECTOR 对齐）：
  //   1) frame chrome（屏标题 / bezel / keys / screen-err / html stage 根）→ 整机 frame
  //   2) .ios-screen / .wb-comp-stage / .wb-html-surface 内部 → 叶子元素；Alt/⌥ 升到 frame
  //   3) 独立 HTML 文档 / HTML 板 iframe（无 #wb-board-panel）→ 整份 body 即 surface
  //   4) .wb-lib-item 且不在 frame 内 → section
  // 画布空白、侧栏等一律不可选
  var FRAME_SEL = '.ios-stage, .wb-comp-stage, .wb-html-stage, .wb-screen-err';

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

  function annHtmlSurface(el) {
    if (!el || !el.closest) return null;
    var marked = el.closest('.wb-html-surface');
    if (marked) return marked;
    // Plain docs (file://, HTML-board iframe) should not force authors to stamp
    // wb-html-surface on content — the whole document is the annotatable region.
    // Workbench board pages keep requiring an explicit surface so sidebar/chrome
    // stay unselectable.
    if (isPlainDocument() && document.body && (
      el === document.body || document.body.contains(el)
    )) {
      return document.body;
    }
    return null;
  }

  function annContentSurface(el) {
    return annScreen(el) || annComp(el) || annHtmlSurface(el);
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
    // Comp / HTML stages: only the stage root itself counts as chrome.
    if (frame.classList && (
      frame.classList.contains('wb-comp-stage') ||
      frame.classList.contains('wb-html-stage')
    )) {
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
    var r = el.getBoundingClientRect();
    return [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)];
  }

  function viewRect(el) {
    var r = el.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  }

  /** Overflow / screen ancestors that visually clip `el` (viewport rects). */
  function clipAncestorViewRects(el) {
    var clips = [];
    var node = el && el.parentElement;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var force = node.classList && (
        node.classList.contains('ios-screen') ||
        node.classList.contains('wb-comp-stage') ||
        node.classList.contains('wb-html-surface') ||
        node.classList.contains('wb-html-stage')
      );
      if (force) {
        clips.push(viewRect(node));
      } else {
        var st = getComputedStyle(node);
        if ((st.overflowX && st.overflowX !== 'visible') ||
            (st.overflowY && st.overflowY !== 'visible')) {
          clips.push(viewRect(node));
        }
      }
      node = node.parentElement;
    }
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
      var cap = el.querySelector('.wb-lib-cap');
      var label = (cap && (cap.innerText || cap.textContent)) ||
        el.getAttribute('data-ann-section-label') ||
        el.getAttribute('data-ann-group-label') ||
        el.getAttribute('data-ann-section') ||
        el.getAttribute('data-ann-group') || '';
      return String(label).replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    // frame shell: screen caption / data-screen, not the whole phone innerText
    if (isFrameNode(el)) {
      var screen = el.closest && el.closest('.wb-screen[data-screen]');
      var scap = screen && screen.querySelector('.wb-screen-cap');
      var flabel = (scap && (scap.innerText || scap.textContent)) ||
        (screen && screen.getAttribute('data-screen')) ||
        (el.classList && el.classList.contains('wb-screen-err') ? 'Error' : '') ||
        'Frame';
      return String(flabel).replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    var t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 120);
  }

  function resolve(sel) {
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  function sectionSelector(sectionId) {
    var id = String(sectionId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return '#wb-board-panel [data-ann-section="' + id + '"], #wb-board-panel [data-ann-group="' + id + '"]';
  }

  /** Annotation belongs to the active workbench page. */
  function markOnActivePage(m) {
    if (!m) return false;
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

  function resolveAllLiveTargets(m) {
    var out = [];
    markElementTargets(m).forEach(function (t) {
      var el = resolve(t.selector);
      if (el && !isHidden(el)) {
        out.push({ el: el, ref: t.ref, selector: t.selector, text: t.text, rectDoc: docRect(el) });
      }
    });
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
    renderAll();
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
    renderAll();
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
      path: decodeURIComponent(location.pathname),
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
    '[data-ann-ui]{font-family:-apple-system,"PingFang SC",sans-serif;box-sizing:border-box;}',
    '[data-ann-ui] *,[data-ann-ui] *::before,[data-ann-ui] *::after{box-sizing:border-box;}',
    '#ann-toolbar{position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;gap:8px;align-items:center;background:rgba(28,28,28,.92);border-radius:22px;padding:7px 12px;box-shadow:0 6px 20px rgba(0,0,0,.3);}',
    '#ann-toolbar button{border:none;cursor:pointer;font-size:12px;padding:5px 11px;border-radius:14px;background:rgba(255,255,255,.14);color:#fff;}',
    '#ann-toolbar button.on{background:#f5a623;color:#1a1a1a;font-weight:600;}',
    '#ann-toolbar button[hidden]{display:none;}',
    '#ann-toolbar button.ok{background:rgba(52,168,83,.35);color:#7ee2a0;}',
    '#ann-count{font-size:11px;color:rgba(255,255,255,.7);}',
    '#ann-status{font-size:10px;color:rgba(255,255,255,.45);}',
    '#ann-status.err{color:#ff9d9d;}',
    'html.ann-sidebar-open #ann-toolbar{right:304px;}',
    // 面板视觉向 workbench 侧边栏看齐：实色浅灰底、发丝分割线、灰阶 hover、
    // 6px 圆角 —— 与浮动工具条的深色毛玻璃是两套语言。--wb-* 自定义属性是
    // 共享行样式（lib/ann-list.css）的主题入参：这里钉死为 workbench 同款取值，
    // 宿主页面即便定义了同名变量也渗不进来。
    '#ann-sidebar{position:fixed;top:0;right:0;bottom:0;width:280px;z-index:2147483645;background:#f6f6f7;border-left:1px solid rgba(0,0,0,.07);box-shadow:-8px 0 24px rgba(0,0,0,.08);display:flex;flex-direction:column;--wb-fg:#1c1c1e;--wb-muted:#6b6b70;--wb-faint:#8e8e93;--wb-hover:rgba(0,0,0,.04);--wb-r:6px;--wb-dur:.2s;--wb-ease:cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar[hidden]{display:none;}',
    '#ann-sidebar .ann-sb-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 14px 10px;border-bottom:1px solid rgba(0,0,0,.07);}',
    '#ann-sidebar .ann-sb-title{flex:1;font-size:13px;font-weight:600;color:#1c1c1e;}',
    '#ann-sidebar .ann-sb-count{font-size:11px;color:#8e8e93;font-variant-numeric:tabular-nums;}',
    '#ann-sidebar .ann-sb-close{flex:none;width:26px;height:26px;padding:0;border:none;border-radius:6px;background:transparent;cursor:pointer;font:inherit;font-size:14px;line-height:26px;text-align:center;color:#8e8e93;transition:background .2s cubic-bezier(.25,0,0,1),color .2s cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar .ann-sb-close:hover{background:rgba(0,0,0,.05);color:#1c1c1e;}',
    // 「交互 | 标注」segmented：同 workbench 的 .wb-board-mode / .wb-ann-filter .ctl
    // 语言 —— 灰槽 + 白色凸起选中态；「标注」选中时沿用 workbench 标注开关的橙色强调。
    '#ann-sidebar .ann-sb-modes{flex:none;display:flex;gap:2px;margin:10px 12px 4px;padding:2px;border-radius:8px;background:rgba(0,0,0,.045);}',
    '#ann-sidebar .ann-sb-modes button{flex:1;border:0;border-radius:6px;cursor:pointer;background:transparent;color:#6b6b70;font:inherit;font-size:11.5px;font-weight:650;letter-spacing:.02em;padding:6px 8px;transition:background .2s cubic-bezier(.25,0,0,1),color .2s cubic-bezier(.25,0,0,1),box-shadow .2s cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar .ann-sb-modes button:hover{color:#1c1c1e;}',
    '#ann-sidebar .ann-sb-modes button.on{background:#fff;color:#1c1c1e;box-shadow:0 1px 2px rgba(0,0,0,.06),inset 0 0 0 1px rgba(0,0,0,.04);}',
    '#ann-sidebar .ann-sb-modes button.on[data-ann-mode="annotate"]{background:color-mix(in srgb,#f5a623 16%,#fff);color:#8a5a00;box-shadow:inset 0 0 0 1px color-mix(in srgb,#f5a623 35%,transparent);}',
    '#ann-sidebar .ann-sb-body{flex:1;overflow-y:auto;padding:6px 8px 8px;}',
    // 行/失效态/空态的共享视觉 = lib/ann-list.css，serve 时内联为 ANN_LIST_CSS
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
    '#ann-sidebar .ann-sb-acts button{width:24px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;cursor:pointer;font:inherit;font-size:12px;line-height:24px;text-align:center;color:#8e8e93;}',
    '#ann-sidebar .ann-sb-acts button:hover{background:rgba(0,0,0,.06);color:#1c1c1e;}',
    '#ann-sidebar .ann-sb-acts .ann-sb-del:hover{color:#c0392b;background:rgba(192,57,43,.1);}',
    'html.ann-mode-on #wbstage{cursor:crosshair;}',
    '#ann-overlay{position:absolute;inset:0;pointer-events:none;z-index:5;overflow:hidden;}',
    '#ann-overlay[data-ann-viewport]{position:fixed;}',
    '#ann-marks,#ann-hover-layer{position:absolute;inset:0;pointer-events:none;z-index:1;}',
    '#ann-chrome{position:absolute;inset:0;pointer-events:none;z-index:10;overflow:visible;}',
    '.ann-hover-ghost{position:absolute;box-sizing:border-box;border:2px solid #f5a623;border-radius:4px;background:rgba(245,166,35,.07);pointer-events:none;z-index:1;}',
    '.ann-hover-ghost[hidden]{display:none;}',
    '.ann-badge{position:absolute;width:22px;height:22px;border-radius:50%;background:#f5a623;color:#1a1a1a;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:auto;cursor:pointer;z-index:3;}',
    '.ann-target{position:absolute;box-sizing:border-box;border:2px solid rgba(245,166,35,.85);border-radius:4px;background:rgba(245,166,35,.05);pointer-events:none;z-index:1;}',
    '.ann-frame{position:absolute;box-sizing:border-box;border:2px dashed #f5a623;background:rgba(245,166,35,.06);border-radius:6px;pointer-events:none;z-index:1;}',
    '#ann-lasso{position:absolute;border:2px dashed #f5a623;background:rgba(245,166,35,.1);border-radius:4px;pointer-events:none;}',
    '#ann-tip{position:absolute;z-index:2;max-width:min(280px,calc(100% - 24px));background:rgba(28,28,28,.92);color:#fff;font-size:12px;line-height:1.4;padding:7px 12px;border-radius:10px;pointer-events:none;word-break:break-word;}',
    '#ann-box{position:absolute;z-index:5;left:24px;right:24px;bottom:72px;top:auto;width:auto;max-width:720px;max-height:min(62vh,560px);margin:0 auto;overflow:auto;background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.09);border-radius:18px;box-shadow:0 16px 44px rgba(0,0,0,.24);padding:12px;pointer-events:auto;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}',
    '#ann-box .head{display:flex;align-items:center;gap:8px;margin-bottom:8px;min-width:0;}',
    '#ann-box .t{flex:1;min-width:0;font-size:11px;color:#8a8a8a;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}',
    '#ann-box .t b{color:#6b6b70;font-weight:600;}',
    '#ann-box .t .n{color:#b97800;font-weight:650;}',
    '#ann-box .top{flex:none;display:flex;gap:4px;align-items:center;}',
    '#ann-box .top .x{width:24px;height:24px;padding:0;border-radius:50%;font-size:14px;line-height:24px;text-align:center;color:#888;}',
    '#ann-box .top .warn{padding:4px 8px;font-size:11px;}',
    '#ann-box textarea{display:block;width:100%;border:0;border-radius:10px;padding:9px 10px;font-size:14px;line-height:1.5;min-height:68px;max-height:180px;resize:vertical;outline:none;font-family:inherit;background:rgba(0,0,0,.025);}',
    '#ann-box .ann-target-bar{display:flex;align-items:flex-start;gap:8px;margin:0 0 8px;min-width:0;}',
    '#ann-box .ann-target-modes{display:flex;flex:none;gap:2px;padding:2px;border-radius:9px;background:rgba(0,0,0,.055);}',
    '#ann-box .ann-target-modes button{padding:4px 7px;border-radius:7px;font-size:10px;background:transparent;color:#777;}',
    '#ann-box .ann-target-modes button.on{background:#fff;color:#222;box-shadow:0 1px 3px rgba(0,0,0,.12);font-weight:600;}',
    '#ann-box .ann-target-pills{display:flex;flex:1;min-width:0;gap:5px;flex-wrap:wrap;align-items:center;}',
    '#ann-box .ann-target-pill{display:flex;align-items:center;gap:5px;max-width:230px;min-height:25px;padding:4px 6px 4px 8px;border:1px solid rgba(245,166,35,.32);border-radius:999px;background:rgba(245,166,35,.09);color:#5f4a20;font-size:11px;line-height:1.2;cursor:pointer;outline:none;}',
    '#ann-box .ann-target-pill:hover,#ann-box .ann-target-pill:focus-visible{border-color:rgba(245,166,35,.75);background:rgba(245,166,35,.17);}',
    '#ann-box .ann-target-pill.broken{border-color:rgba(192,57,43,.28);background:rgba(192,57,43,.07);color:#9b3b32;}',
    '#ann-box .ann-target-pill-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '#ann-box .ann-target-remove{position:relative;flex:none;width:17px;height:17px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;background:rgba(0,0,0,.08);color:#777;opacity:0;pointer-events:none;}',
    '#ann-box .ann-target-remove::after{content:"";position:absolute;inset:-4px;border-radius:50%;}',
    '#ann-box .ann-target-pill:hover .ann-target-remove,#ann-box .ann-target-pill:focus-within .ann-target-remove{opacity:1;pointer-events:auto;}',
    '.ann-target.ann-draft-target{border-color:#f5a623;background:rgba(245,166,35,.11);box-shadow:0 0 0 2px rgba(245,166,35,.13);}',
    '#ann-box .acts{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-top:10px;}',
    '#ann-box button{border:none;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.06);color:#555;white-space:nowrap;}',
    '#ann-box .ann-drag-handle{flex:none;width:24px;height:24px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:7px;background:transparent;color:#aaa;cursor:grab;touch-action:none;}',
    '#ann-box .ann-drag-handle:hover{background:rgba(0,0,0,.055);color:#666;}',
    '#ann-box .ann-drag-handle[data-dragging="true"]{cursor:grabbing;background:rgba(245,166,35,.12);color:#b97800;}',
    '#ann-box .ann-drag-handle svg{display:block;width:14px;height:14px;pointer-events:none;}',
    '#ann-box button.dark{background:#1a1a1a;color:#fff;font-weight:600;}',
    '#ann-box button.warn{color:#c0392b;background:rgba(192,57,43,.08);}',
    '#ann-box button:disabled{opacity:.4;cursor:not-allowed;}',
    '#ann-box #ann-copy-ind.ok{background:#e8f8ef;color:#1b7a3d;}',
    '#ann-box .hint{font-size:10px;color:#b5b3ae;margin-top:6px;}',
    '#ann-box .research-opt{margin-top:8px;font-size:12px;color:#555;line-height:1.4;}',
    '#ann-box .research-opt label{cursor:pointer;display:flex;align-items:center;gap:6px;min-width:0;}',
    '#ann-mention{position:absolute;z-index:6;min-width:200px;max-width:min(280px,calc(100% - 24px));max-height:180px;overflow:auto;background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);border:1px solid rgba(0,0,0,.08);padding:4px;pointer-events:auto;}',
    '#ann-mention .ann-men-item{display:flex;gap:8px;align-items:flex-start;width:100%;border:0;background:transparent;text-align:left;font:inherit;padding:7px 8px;border-radius:8px;cursor:pointer;color:#333;}',
    '#ann-mention .ann-men-item.on,#ann-mention .ann-men-item:hover{background:rgba(245,166,35,.14);}',
    '#ann-mention .ann-men-n{flex:none;font-size:11px;font-weight:700;color:#f5a623;min-width:1.5em;}',
    '#ann-mention .ann-men-body{flex:1;min-width:0;font-size:12px;line-height:1.35;color:#555;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}',
    '#ann-mention .ann-men-empty{padding:10px 8px;font-size:12px;color:#999;}',
    '#ann-imgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
    '#ann-imgs:empty{display:none;margin:0;}',
    '#ann-imgs .im{position:relative;width:56px;height:56px;border-radius:8px;overflow:hidden;border:1px solid rgba(0,0,0,.12);}',
    '#ann-imgs .im img{width:100%;height:100%;object-fit:cover;display:block;}',
    '#ann-imgs .im .x{position:absolute;top:1px;right:1px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:16px;text-align:center;cursor:pointer;}',
    '@keyframes annFlash{0%,100%{background:rgba(245,166,35,.07);box-shadow:none}15%,85%{background:rgba(245,166,35,.2);box-shadow:0 0 0 4px rgba(245,166,35,.22)}}',
    '.ann-hover-ghost.ann-flash{animation:annFlash 1.5s ease-out}',
    // a11y 基线：注入的每个控件都要有可见 focus 态；reduced-motion 下关掉全部过渡/动画。
    '[data-ann-ui] :is(button,a,input,textarea,select,[tabindex]):focus-visible{outline:2px solid rgba(183,120,0,.55);outline-offset:1px;}',
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
  bubblesLayer.style.display = 'none';
  // SPA 路由可能重建挂载点，switchLedger 复用这套逻辑重挂。
  function mountOverlay() {
    var stageWrap = document.querySelector('.wb-stage-wrap');
    if (stageWrap) {
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
    _originCache = null; // 挂载点/模式变了 origin 语义也变，缓存作废
  }
  mountOverlay();
  var hoverGhost = null;

  var toolbar = document.createElement('div');
  toolbar.id = 'ann-toolbar'; toolbar.setAttribute('data-ann-ui', '');
  toolbar.innerHTML = '<button id="ann-toggle">标注</button><button id="ann-comments" title="在画布渲染评论">评论</button><button id="ann-channel" title="评论布局：压字 / 留通道" hidden>压字</button><button id="ann-list" title="标注列表 (S)">列表</button><button id="ann-clear">清空标记</button><span id="ann-count">0 条</span><span id="ann-status"></span><button id="ann-hide">暂停</button>';
  toolbar.style.display = 'none';
  document.body.appendChild(toolbar);

  var btnToggle = toolbar.querySelector('#ann-toggle');
  var btnComments = toolbar.querySelector('#ann-comments');
  var btnChannel = toolbar.querySelector('#ann-channel');
  var btnList = toolbar.querySelector('#ann-list');
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
    syncModeClass();
  }

  function syncGhost() {
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
    if (!mode) { clearHover(); closeComposer(); }
    notify();
  }
  btnToggle.addEventListener('click', toggleMode);

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

  function doClear() {
    marks = marks.filter(function (k) { return !markOnActivePage(k); });
    closeComposer();
    persist();
    btnClear.className = 'ok'; btnClear.textContent = '已清空 ✓';
    setTimeout(function () { btnClear.className = ''; btnClear.textContent = '清空标记'; }, 2000);
  }

  function removeMark(n) {
    n = parseInt(n, 10);
    if (!isFinite(n)) return false;
    var before = marks.length;
    marks = marks.filter(function (k) { return k.n !== n; });
    if (marks.length === before) return false;
    var open = document.getElementById('ann-box');
    if (open) closeComposer();
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

  /** composer 停靠右缘：侧边栏打开时让出 sidebar 宽度，保持 composer 不被压。 */
  function composerDockedRight() {
    var dock = document.getElementById('wbcanvas-dock');
    var dockOpen = !!(dock && Array.prototype.some.call(dock.children, function (child) {
      return !child.hidden && child.getClientRects().length > 0;
    }));
    if (dockOpen && overlay.clientWidth > 520) return '270px';
    return sidebarOpen ? '304px' : '24px';
  }

  function sidebarRowModel() {
    // 行字段走共享模型（lib/ann-row.js，serve 时内联）；默认 cap 语义即
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
        if (act.getAttribute('data-ann-act') === 'edit') openMark(an);
        else if (act.getAttribute('data-ann-act') === 'del') removeMark(an); // 删除即生效，与 composer/工具条清空同款无确认
        return;
      }
      var row = e.target && e.target.closest ? e.target.closest('.wb-ann-item[data-ann-n]') : null;
      if (!row) return;
      goToMark(parseInt(row.getAttribute('data-ann-n'), 10));
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
      return r.n + '|' + r.cap + '|' + r.preview + '|' + r.broken;
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
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ann-sb-edit';
      edit.setAttribute('data-ann-act', 'edit');
      edit.setAttribute('data-ann-n', r.n);
      edit.title = '编辑';
      edit.setAttribute('aria-label', '编辑标注 ' + r.n);
      edit.innerHTML = annIcon('pencil');
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ann-sb-del';
      del.setAttribute('data-ann-act', 'del');
      del.setAttribute('data-ann-n', r.n);
      del.title = '删除';
      del.textContent = '×';
      acts.appendChild(edit);
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
      sidebar.hidden = true;
    }
    // 开着的 composer 保持停靠右缘（未被用户拖走时）
    var openBox = document.getElementById('ann-box');
    if (openBox && !composerPlacement) openBox.style.right = composerDockedRight();
    notify();
  }

  function toggleSidebar() { setSidebarOpen(!sidebarOpen); }

  // 浏览器扩展图标入口（主入口）：content script 收到 background 的 tab 消息后
  // 经共享 DOM CustomEvent 桥进主世界（内联 script 会被 CSP 拦，见 extension/
  // content.js 头注）。抑制规则不变：workbench 壳/被嵌入页 setSidebarOpen 自会
  // 让位，图标点击在那些页面上是 no-op。
  document.addEventListener('pinpoint:command', function (e) {
    var cmd = e.detail && e.detail.command;
    if (cmd === 'toggle-sidebar') toggleSidebar();
  });

  if (btnList) btnList.addEventListener('click', function () { toggleSidebar(); });
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
    var targetPill = e.target && e.target.closest ? e.target.closest('.ann-target-pill') : null;
    if (openComposer && targetPill) return;
    if (!mode || paused || drag || arrowFrom || openComposer) { clearHover(); return; }
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
  var draftNodes = [];   // active composer target frames [{ frame, selector }]

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
      marksLayer.appendChild(frame);
      var part = { frame: frame, selector: target.selector };
      draftNodes.push(part);
      placePartGeometry(part, el);
    });
  }

  function insertComposerIndicator(ref) {
    var composer = activeComposer;
    if (!composer || composer.targetMode !== 'inline') return;
    if (composer.composing) {
      if (composer.pendingInlineRefs.indexOf(ref) < 0) composer.pendingInlineRefs.push(ref);
      return;
    }
    var ta = composer.ta;
    var number = parseInt(String(ref).slice(1), 10);
    var token = '[indicator ' + number + '] ';
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
    var roots = Array.prototype.slice.call(board.querySelectorAll('.ios-screen, .wb-comp-stage, .wb-html-surface'));
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

  function openComposer(m, anchorRect, isNew) {
    closeComposer({ silentRender: true });
    m = normalizeAnnotation(JSON.parse(JSON.stringify(m)));
    ensureMarkId(m);
    var broken = !resolveMarkAnchor(m).live;
    var box = document.createElement('div');
    box.id = 'ann-box'; box.setAttribute('data-ann-ui', '');
    var label = m.type === 'region' ? '框选区域' : (m.text ? m.text.slice(0, 40) : m.selector);
    var secLabel = annotationSectionLabel(m);
    // Section self-target: title only once
    var flowSelf = !!(secLabel && label && label === secLabel);
    var gtag = secLabel
      ? ('<b>' + secLabel + '</b>' + (flowSelf ? '' : ' · '))
      : '';
    if (flowSelf) label = '';
    var moveInfo = m.move ? '<div class="t" style="-webkit-line-clamp:1;margin-bottom:8px">↗ 已画移动箭头 → ' + ((m.move.to_text || '').slice(0, 30) || '空白处') + '</div>' : '';
    var brokenInfo = broken
      ? '<div class="t" style="color:#c0392b;margin-bottom:8px">锚点失效 · 目标节点已不在当前稿中</div>'
      : '';
    var res = m.research || null;
    var changeOn = !!m.changeTo;
    var indPreview = indicatorForMark(m);
    box.innerHTML =
      '<div class="head">' +
      '<button type="button" class="ann-drag-handle" aria-label="拖动标注框" title="拖动标注框">' +
      '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="4" cy="3" r="1.25" fill="currentColor"/><circle cx="10" cy="3" r="1.25" fill="currentColor"/><circle cx="4" cy="7" r="1.25" fill="currentColor"/><circle cx="10" cy="7" r="1.25" fill="currentColor"/><circle cx="4" cy="11" r="1.25" fill="currentColor"/><circle cx="10" cy="11" r="1.25" fill="currentColor"/></svg></button>' +
      '<div class="t"><span class="n">#' + m.n + '</span> · ' + gtag + label + '</div>' +
      '<div class="top">' + (isNew ? '' : '<button type="button" id="ann-del" class="warn">删除</button>') +
      '<button type="button" id="ann-cancel" class="x">×</button></div></div>' +
      brokenInfo +
      moveInfo +
      (m.type === 'element'
        ? '<div class="ann-target-bar"><div class="ann-target-modes" role="group" aria-label="Target 引用方式">' +
          '<button type="button" id="ann-target-mode-reference">仅引用</button>' +
          '<button type="button" id="ann-target-mode-inline">插入到文本</button></div>' +
          '<div class="ann-target-pills" id="ann-target-pills"></div></div>'
        : '') +
      '<textarea placeholder="写标注…（回车保存，Shift+回车换行；@ 引用其他标注）"></textarea>' +
      '<div id="ann-imgs"></div>' +
      '<div class="acts">' +
      '<button type="button" id="ann-copy-ind" aria-label="复制 indicator" title="Copy indicator: ' + indPreview.replace(/"/g, '&quot;') + '">' + annIcon('link') + '</button>' +
      '<button type="button" id="ann-img" aria-label="添加图片" title="添加图片">' + annIcon('image') + '</button>' +
      '<button type="button" id="ann-change"' + (changeOn ? ' class="dark"' : '') + ' title="提示 agent：把文案改成标注内容">' + annIcon('pencil') + '<span>改文案</span></button>' +
      '<button type="button" id="ann-research"' + (res ? ' class="dark"' : '') + '>' + annIcon('search') + '<span>调研</span></button>' +
      '<button type="button" id="ann-move"' + (broken ? ' disabled title="锚点失效，无法画箭头"' : '') + '>' + annIcon('arrow-up-right') + '<span>移动</span></button>' +
      '<button type="button" id="ann-save" class="dark">保存</button></div>' +
      '<div id="ann-research-opt" class="research-opt" style="display:' + (res ? 'block' : 'none') + '">' +
      '<label><input type="checkbox" id="ann-research-existing"' + (res && res.existing_code ? ' checked' : '') + '>可能已有代码</label></div>';
    chromeLayer.appendChild(box);
    var ta = box.querySelector('textarea');
    ta.value = m._draft != null
      ? m._draft
      : contentToDisplay(annotationContent(m), markElementTargets(m));

    normalizeElementTargets(m);
    var stageEl = document.getElementById('wbstage');
    var composer = {
      ta: ta,
      m: m,
      isNew: !!isNew,
      persistedN: isNew ? null : m.n,
      targetMode: m._targetMode || (/\[@t:i[1-9][0-9]*\]/i.test(annotationContent(m)) ? 'inline' : 'reference'),
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

    function placeFloatingComposer(left, top, remember) {
      var pad = 12;
      var width = Math.min(composerMaxWidth, Math.max(0, overlay.clientWidth - pad * 2));
      var maxLeft = Math.max(pad, overlay.clientWidth - width - pad);
      var maxTop = Math.max(pad, overlay.clientHeight - box.offsetHeight - pad);
      var nextLeft = Math.max(pad, Math.min(left, maxLeft));
      var nextTop = Math.max(pad, Math.min(top, maxTop));
      box.style.left = nextLeft + 'px';
      box.style.right = 'auto';
      box.style.top = nextTop + 'px';
      box.style.bottom = 'auto';
      box.style.width = width + 'px';
      box.style.margin = '0';
      if (remember) composerPlacement = { left: nextLeft, top: nextTop };
      if (stageEl) stageEl.style.scrollPaddingBottom = composer.previousScrollPadding || '';
    }

    function syncComposerLayout() {
      if (activeComposer !== composer) return;
      if (composerPlacement) {
        placeFloatingComposer(composerPlacement.left, composerPlacement.top, true);
      } else {
        box.style.right = composerDockedRight();
        if (stageEl) stageEl.style.scrollPaddingBottom = (box.offsetHeight + 96) + 'px';
      }
    }

    var dragHandle = box.querySelector('.ann-drag-handle');
    var composerDrag = null;
    dragHandle.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      var br = box.getBoundingClientRect();
      var or = overlay.getBoundingClientRect();
      composerDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: br.left - or.left,
        top: br.top - or.top
      };
      dragHandle.setAttribute('data-dragging', 'true');
      dragHandle.setPointerCapture(event.pointerId);
    });
    dragHandle.addEventListener('pointermove', function (event) {
      if (!composerDrag || event.pointerId !== composerDrag.pointerId) return;
      event.preventDefault();
      placeFloatingComposer(
        composerDrag.left + event.clientX - composerDrag.startX,
        composerDrag.top + event.clientY - composerDrag.startY,
        true
      );
    });
    function finishComposerDrag(event) {
      if (!composerDrag || event.pointerId !== composerDrag.pointerId) return;
      composerDrag = null;
      dragHandle.removeAttribute('data-dragging');
      if (dragHandle.hasPointerCapture(event.pointerId)) dragHandle.releasePointerCapture(event.pointerId);
      ta.focus({ preventScroll: true });
    }
    dragHandle.addEventListener('pointerup', finishComposerDrag);
    dragHandle.addEventListener('pointercancel', finishComposerDrag);

    function focusComposerTarget(el) {
      if (!el || isHidden(el)) {
        setStatus('目标已失效，无法定位', true);
        return;
      }
      if (stageEl) {
        var er = el.getBoundingClientRect();
        var sr = stageEl.getBoundingClientRect();
        var br = box.getBoundingClientRect();
        var visibleBottom = Math.min(sr.bottom, br.top - 16);
        var visibleHeight = Math.max(80, visibleBottom - sr.top);
        stageEl.scrollTop += er.top - sr.top - (visibleHeight - er.height) / 2;
        stageEl.scrollLeft += er.left - sr.left - (stageEl.clientWidth - er.width) / 2;
      }
      showGhostForEl(el, 'ann-flash');
      setTimeout(function () {
        if (activeComposer === composer) hideGhost();
      }, 1500);
    }

    function setTargetMode(nextMode) {
      composer.targetMode = nextMode === 'inline' ? 'inline' : 'reference';
      var refBtn = box.querySelector('#ann-target-mode-reference');
      var inlineBtn = box.querySelector('#ann-target-mode-inline');
      if (refBtn) refBtn.classList.toggle('on', composer.targetMode === 'reference');
      if (inlineBtn) inlineBtn.classList.toggle('on', composer.targetMode === 'inline');
    }

    function renderTargetPills() {
      var wrap = box.querySelector('#ann-target-pills');
      if (!wrap) return;
      wrap.innerHTML = '';
      var targets = markElementTargets(m);
      targets.forEach(function (target) {
        var el = resolve(target.selector);
        var brokenTarget = !el || isHidden(el);
        var pill = document.createElement('div');
        pill.className = 'ann-target-pill' + (brokenTarget ? ' broken' : '');
        pill.setAttribute('data-target-ref', target.ref);
        pill.setAttribute('role', 'button');
        pill.setAttribute('tabindex', '0');
        pill.setAttribute('aria-label', '定位 indicator ' + String(target.ref).slice(1));
        var labelEl = document.createElement('span');
        labelEl.className = 'ann-target-pill-label';
        labelEl.textContent = (brokenTarget ? '⚠ ' : '') + 'indicator ' + String(target.ref).slice(1) + ' · ' + (target.text || '元素');
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'ann-target-remove';
        removeBtn.setAttribute('aria-label', '删除 indicator ' + String(target.ref).slice(1));
        removeBtn.textContent = '×';
        pill.appendChild(labelEl);
        pill.appendChild(removeBtn);
        pill.addEventListener('mousedown', function (event) { event.preventDefault(); });
        pill.addEventListener('mouseenter', function () {
          if (el && !isHidden(el)) showGhostForEl(el);
        });
        pill.addEventListener('mouseleave', function () { hideGhost(); });
        pill.addEventListener('click', function (event) {
          if (event.target.closest('.ann-target-remove')) return;
          focusComposerTarget(el);
        });
        pill.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            focusComposerTarget(el);
          }
        });
        removeBtn.addEventListener('mousedown', function (event) {
          event.preventDefault();
          event.stopPropagation();
        });
        removeBtn.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (targets.length === 1) {
            if (composer.isNew) closeComposer();
            else setStatus('至少保留一个目标；删除整条标注请用“删除”', true);
            return;
          }
          m.targets = targets.filter(function (item) { return item.ref !== target.ref; });
          ta.value = removeTargetContentRef(ta.value, target.ref);
          normalizeElementTargets(m);
          var firstEl = resolve(m.selector);
          if (firstEl) {
            m.rect = docRect(firstEl);
            stampTargetMeta(m, firstEl);
          }
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          renderTargetPills();
          renderComposerDraftVisuals();
        });
        wrap.appendChild(pill);
      });
      requestAnimationFrame(syncComposerLayout);
    }

    composer.renderTargets = renderTargetPills;
    var modeButtons = box.querySelectorAll('.ann-target-modes button');
    Array.prototype.forEach.call(modeButtons, function (button) {
      button.addEventListener('mousedown', function (event) { event.preventDefault(); });
    });
    var referenceModeBtn = box.querySelector('#ann-target-mode-reference');
    var inlineModeBtn = box.querySelector('#ann-target-mode-inline');
    if (referenceModeBtn) referenceModeBtn.addEventListener('click', function () { setTargetMode('reference'); });
    if (inlineModeBtn) inlineModeBtn.addEventListener('click', function () { setTargetMode('inline'); });
    setTargetMode(composer.targetMode);
    renderTargetPills();
    renderComposerDraftVisuals();

    ta.addEventListener('compositionstart', function () { composer.composing = true; });
    ta.addEventListener('compositionend', function () {
      composer.composing = false;
      var refs = composer.pendingInlineRefs.slice();
      composer.pendingInlineRefs = [];
      refs.forEach(insertComposerIndicator);
    });
    if (typeof ResizeObserver !== 'undefined') {
      composer.resizeObserver = new ResizeObserver(syncComposerLayout);
      composer.resizeObserver.observe(box);
      composer.resizeObserver.observe(overlay);
    }
    var canvasDock = document.getElementById('wbcanvas-dock');
    if (canvasDock && typeof MutationObserver !== 'undefined') {
      composer.dockObserver = new MutationObserver(syncComposerLayout);
      composer.dockObserver.observe(canvasDock, { subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
    }
    syncComposerLayout();
    ta.focus();

    var researchOn = !!res;
    var copyBtn = box.querySelector('#ann-copy-ind');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = indicatorForMark(m);
        if (!text) {
          setStatus('无可复制 indicator（先保存或补全 page）', true);
          return;
        }
        copyText(text).then(function () {
          copyBtn.classList.add('ok');
          copyBtn.title = 'Copied ' + text;
          setTimeout(function () {
            copyBtn.classList.remove('ok');
            copyBtn.title = 'Copy indicator: ' + text;
          }, 1200);
        }).catch(function () {
          setStatus('复制失败', true);
        });
      });
    }

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
    box.querySelector('#ann-img').addEventListener('click', function () {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
      inp.addEventListener('change', function () {
        Array.prototype.forEach.call(inp.files, addImageFile);
      });
      inp.click();
    });

    var btnRes = box.querySelector('#ann-research');
    btnRes.addEventListener('click', function () {
      researchOn = !researchOn;
      btnRes.className = researchOn ? 'dark' : '';
      box.querySelector('#ann-research-opt').style.display = researchOn ? 'block' : 'none';
      ta.focus();
    });
    var btnChange = box.querySelector('#ann-change');
    btnChange.addEventListener('click', function () {
      changeOn = !changeOn;
      btnChange.className = changeOn ? 'dark' : '';
      ta.focus();
    });

    function save() {
      closeMentionPicker();
      ensureMarkId(m);
      var stored = contentToStorage(ta.value.trim(), markElementTargets(m));
      m.content = stored;
      delete m.comment;
      var mentionIds = extractMentionIds(stored);
      if (mentionIds.length) m.mentions = mentionIds; else delete m.mentions;
      if (researchOn) {
        m.research = { existing_code: box.querySelector('#ann-research-existing').checked };
      } else {
        delete m.research;
      }
      if (changeOn) m.changeTo = true; else delete m.changeTo;
      if (images.length) m.images = images; else delete m.images;
      normalizeElementTargets(m);
      delete m._draft;
      delete m._targetMode;
      delete m._anchor;
      if (!m.content && !m.move && !m.research && !m.changeTo && !m.images) { closeComposer(); return; } // 空标注丢弃
      var idx = marks.findIndex(function (k) { return k.n === m.n; });
      if (idx < 0) marks.push(m); else marks[idx] = m;
      closeComposer(); persist();
    }
    ta.addEventListener('input', function () {
      syncMentionFromCaret();
    });
    ta.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return; // 输入法组字中：回车/ESC 都交给输入法
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
      m._targetMode = composer.targetMode;
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
  function svgArrow(from, to, id) {
    var minX = Math.min(from[0], to[0]) - 12, minY = Math.min(from[1], to[1]) - 12;
    var w = Math.abs(from[0] - to[0]) + 24, h = Math.abs(from[1] - to[1]) + 24;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-ann-ui', '');
    if (id) svg.dataset.arrow = id;
    svg.style.cssText = 'position:absolute;pointer-events:none;z-index:2;left:' + minX + 'px;top:' + minY + 'px;width:' + w + 'px;height:' + h + 'px;';
    var mk = 'annArrowHead' + (id || 'tmp');
    var x1 = from[0] - minX, y1 = from[1] - minY, x2 = to[0] - minX, y2 = to[1] - minY;
    svg.innerHTML = '<defs><marker id="' + mk + '" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#f5a623"/></marker></defs>' +
      '<path d="M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2 + '" stroke="#f5a623" stroke-width="2.5" fill="none" marker-end="url(#' + mk + ')"/>';
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
    var ta = document.querySelector('#ann-box textarea');
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
    if (m.base && m.base.selector) {
      el = resolve(m.base.selector);
    } else if (m.contains && m.contains.length) {
      for (var i = 0; i < m.contains.length; i++) {
        el = resolve(m.contains[i].selector);
        if (el) break;
      }
    }
    if (!el || isHidden(el)) return { live: false, el: null, rectDoc: null };
    // region: translate stored box by live base delta (same zoom session / layout shift)
    if (m.base && m.base.rect) {
      var now = docRect(el);
      var br = m.base.rect;
      var rr = m.rect || br;
      return {
        live: true,
        el: el,
        rectDoc: [
          rr[0] + now[0] - br[0],
          rr[1] + now[1] - br[1],
          rr[2],
          rr[3]
        ]
      };
    }
    return { live: true, el: el, rectDoc: docRect(el) };
  }

  function markHasLiveTarget(m) {
    if (!m) return false;
    if (m.type === 'element' && markElementTargets(m).length) {
      return resolveAllLiveTargets(m).length > 0;
    }
    return resolveMarkAnchor(m).live;
  }

  /** The selector still resolves, even if its current product view is hidden.
   *  A hidden tab / route is not a broken annotation: once the view returns,
   *  the same selector can become live again. The resolvability walk itself is
   *  the shared pure predicate from lib/ann-row.js (inlined at serve time). */
  function isMarkBroken(m) {
    return annMarkBroken(m, function (selector) { return !!resolve(selector); }, markElementTargets(m));
  }

  function markAnchorRect(m) {
    var a = resolveMarkAnchor(m);
    return a.live ? a.rectDoc : null;
  }

  function moveEndPoint(m) {
    var mv = m.move;
    if (!mv) return null;
    if (mv.to_selector) {
      var el = resolve(mv.to_selector);
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
      if (activeComposer && activeComposer.persistedN === m.n) return;
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

  function wireMarkBadge(badge, n) {
    badge.addEventListener('click', function (e) {
      e.stopPropagation();
      if (activeComposer) {
        if (activeComposer.persistedN !== n) setStatus('请先保存或取消当前标注', true);
        return;
      }
      openMark(n);
    });
  }

  function placeArrow(entry, from, to) {
    if (entry.arrow && entry.arrow.parentNode) entry.arrow.parentNode.removeChild(entry.arrow);
    entry.arrow = svgArrow(from, to, entry.m.n);
    marksLayer.appendChild(entry.arrow);
  }

  function syncMarkStructure(pageMarks) {
    var keep = Object.create(null);
    pageMarks.forEach(function (m) {
      keep[m.n] = true;
      var entry = markNodes[m.n];
      var frameClass = m.type === 'region' ? 'ann-frame' : 'ann-target';
      var wantParts = m.type === 'region' ? 1 : resolveAllLiveTargets(m).length;

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
      entry.liveTargets = m.type === 'region' ? null : resolveAllLiveTargets(m);

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

  function placeMoveArrow(entry, fromLocal, fromClipEl, endDoc) {
    if (!fromLocal || !endDoc) {
      clearMarkArrow(entry);
      return;
    }
    var endEl = null;
    if (entry.m.move && entry.m.move.to_selector) {
      endEl = resolve(entry.m.move.to_selector);
    }
    var endClipEl = endEl || fromClipEl;
    var endView = docPointToView(endDoc);
    if (!viewPointInClips(endView, endClipEl)) {
      clearMarkArrow(entry);
      return;
    }
    var from = [fromLocal[0] + fromLocal[2] / 2, fromLocal[1] + fromLocal[3] / 2];
    var to = viewToOverlayPoint(endView);
    placeArrow(entry, from, to);
  }

  function updateMarkGeometry() {
    beginOverlayFrame();
    Object.keys(markNodes).forEach(function (key) {
      var entry = markNodes[key];
      var m = entry.m;
      if (m.type === 'region') {
        var anchor = resolveMarkAnchor(m);
        if (!anchor.live || !anchor.rectDoc) {
          removeMarkNode(entry);
          delete markNodes[key];
          return;
        }
        var viewR = visibleViewRectDoc(anchor.rectDoc, anchor.el);
        var part = entry.parts[0];
        if (!viewR) {
          hidePartNodes(part);
          clearMarkArrow(entry);
          return;
        }
        var local = expandRect(viewToOverlayRect(viewR));
        if (part) {
          showPartNodes(part);
          placeFixedRect(part.frame, local);
          var rPos = badgePositionForRect(local);
          part.badge.style.left = rPos.left + 'px';
          part.badge.style.top = rPos.top + 'px';
        }
        if (m.move) {
          placeMoveArrow(entry, local, anchor.el, moveEndPoint(m));
        }
        return;
      }

      var lives = entry.liveTargets || resolveAllLiveTargets(m);
      if (!lives.length) {
        removeMarkNode(entry);
        delete markNodes[key];
        return;
      }
      if (entry.parts.length !== lives.length) {
        structureDirty = true;
        return;
      }
      for (var pi = 0; pi < lives.length; pi++) {
        placePartGeometry(entry.parts[pi], lives[pi].el);
      }
      if (m.move) {
        var firstView = visibleViewRectOf(lives[0].el);
        if (!firstView) {
          clearMarkArrow(entry);
          return;
        }
        placeMoveArrow(entry, viewToOverlayRect(firstView), lives[0].el, moveEndPoint(m));
      }
    });
    if (structureDirty) renderAll();
  }

  function updateCountLabel(shown) {
    elCount.textContent = shown + ' 条' + (marks.length > shown ? ' · 共 ' + marks.length : '');
  }

  // ---------- 评论气泡（"在画布渲染评论"开关）----------
  // 与 pin 同一套几何管线（resolveMarkAnchor → docToView → viewToOverlayRect），
  // 但独立于 标注/交互 模式：开关一开就在画布上把 content 渲染成气泡，
  // 序号与 pin 对应，半透明细线指向锚点。稀疏默认放右侧，密集时左右分流。
  var bubbleNodes = Object.create(null);   // n → { m, node, height }
  var BUBBLE_W = 240;
  var BUBBLE_GAP = 10;
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
        node.innerHTML = bubbleInnerHtml(bubbleMarkView(m));
        node.addEventListener('click', function (e) {
          if (e.target.closest('.ann-bubble')) { e.stopPropagation(); openMark(m.n); }
        });
        bubblesLayer.appendChild(node);
        entry = bubbleNodes[m.n] = { m: m, node: node, height: 0 };
      } else {
        entry.m = m;
        // content may have changed; refresh inner HTML + re-measure
        entry.node.innerHTML = bubbleInnerHtml(bubbleMarkView(m));
      }
      entry.height = entry.node.offsetHeight || 0;
    });
    Object.keys(bubbleNodes).forEach(function (n) {
      if (keep[n]) return;
      if (bubbleNodes[n].node.parentNode) bubbleNodes[n].node.parentNode.removeChild(bubbleNodes[n].node);
      delete bubbleNodes[n];
    });
  }

  /** Two-column greedy packer: sparse → right; when right crowds, spill left.
   *  No connector lines — bubble numbers match pin badges for correspondence. */
  function updateBubbleGeometry() {
    if (!renderComments) return;
    beginOverlayFrame();
    // sidebar 模式：iframe 内不画气泡（由父级 workbench 在右侧 gutter 渲染）。
    if (bubbleLayout === 'sidebar') {
      Object.keys(bubbleNodes).forEach(function (n) { bubbleNodes[n].node.hidden = true; });
      return;
    }
    var overlayRect = overlay.getBoundingClientRect();
    var overlayW = overlayRect.width;
    var overlayH = overlayRect.height;
    var bw = BUBBLE_W;
    // Candidates: marks whose anchor is in the viewport right now. Off-screen
    // anchors get no bubble (like Word's margin — you only see comments for the
    // text on screen); this keeps a 48-comment doc from stacking every bubble
    // into one viewport.
    var cands = [];
    Object.keys(bubbleNodes).forEach(function (n) {
      var entry = bubbleNodes[n];
      var anchorDoc = markAnchorRect(entry.m);
      if (!anchorDoc) { entry.node.hidden = true; return; }
      var anchorView = visibleViewRectDoc(anchorDoc, resolveMarkAnchor(entry.m).el);
      if (!anchorView) { entry.node.hidden = true; return; }
      var local = viewToOverlayRect(anchorView);
      // Skip anchors wholly outside the overlay viewport.
      if (local[1] + local[3] < 0 || local[1] > overlayH) { entry.node.hidden = true; return; }
      entry.node.hidden = false;
      cands.push({ entry: entry, anchor: local });
    });
    cands.sort(function (a, b) { return a.anchor[1] - b.anchor[1]; });

    var rightNext = BUBBLE_MARGIN;
    var leftNext = BUBBLE_MARGIN;
    var rightW = Math.min(bw, overlayW / 2 - BUBBLE_MARGIN);
    var leftW = rightW;
    cands.forEach(function (c) {
      var desired = Math.max(BUBBLE_MARGIN, c.anchor[1]);
      var rightTop = Math.max(desired, rightNext);
      var leftTop = Math.max(desired, leftNext);
      var side, top, left;
      if (rightTop <= leftTop) {
        side = 'right'; top = rightTop;
        left = overlayW - rightW - BUBBLE_MARGIN;
        rightNext = top + c.entry.height + BUBBLE_GAP;
      } else {
        side = 'left'; top = leftTop;
        left = BUBBLE_MARGIN;
        leftNext = top + c.entry.height + BUBBLE_GAP;
      }
      c.entry.node.style.left = left + 'px';
      c.entry.node.style.top = top + 'px';
      c.entry.node.style.width = (side === 'right' ? rightW : leftW) + 'px';
    });
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
      out.push({
        n: m.n,
        rect: [Math.round(local[0]), Math.round(local[1]), Math.round(local[2]), Math.round(local[3])],
        content: bubbleMarkView(m).content
      });
    });
    return out;
  }

  function renderAll() {
    var pageMarks = visiblePageMarks();
    syncMarkStructure(pageMarks);
    updateMarkGeometry();
    syncBubbleStructure(pageMarks);
    updateBubbleGeometry();
    updateDraftGeometry();
    updateCountLabel(pageMarks.length);
    syncGhost();
  }

  var viewRaf = 0;
  function onViewChange() {
    if (viewRaf) return;
    viewRaf = requestAnimationFrame(function () {
      viewRaf = 0;
      if (structureDirty) renderAll();
      else {
        updateMarkGeometry();
        updateBubbleGeometry();
        updateDraftGeometry();
        syncGhost();
      }
    });
  }

  addEventListener('resize', onViewChange);
  // Nested frame scrollports (.ios-app, sheet body, …) do not bubble; capture
  // on document so mark geometry tracks phone scroll as well as #wbstage pan.
  document.addEventListener('scroll', onViewChange, { passive: true, capture: true });

  // Interactive HTML documents change views without navigating or resizing:
  // tabs toggle `hidden`, dialogs change classes, and async renders replace
  // children. Treat those product-DOM changes as a structural redraw. Ignore
  // mutations made by the annotation UI itself or renderAll would observe its
  // own overlay updates and loop forever.
  var contentRenderRaf = 0;

  function annotationUiNode(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && isUI(el));
  }

  function contentMutation(record) {
    if (annotationUiNode(record.target)) return false;
    if (record.type !== 'childList') return true;
    var changed = Array.prototype.slice.call(record.addedNodes || [])
      .concat(Array.prototype.slice.call(record.removedNodes || []));
    return changed.some(function (node) { return !annotationUiNode(node); });
  }

  function scheduleContentRender() {
    if (contentRenderRaf) return;
    contentRenderRaf = requestAnimationFrame(function () {
      contentRenderRaf = 0;
      structureDirty = true;
      renderAll();
      notify();
    });
  }

  if (typeof MutationObserver !== 'undefined' && document.body) {
    var contentMutationObserver = new MutationObserver(function (records) {
      if (records.some(contentMutation)) scheduleContentRender();
    });
    contentMutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'hidden',
        'class',
        'style',
        'open',
        'aria-hidden',
        'aria-expanded',
        'aria-selected'
      ]
    });
  }

  // Layout can also move after an image/font finishes, a CSS transition ends,
  // or a route changes without a useful DOM mutation. These are cheap fallback
  // signals and share the same rAF coalescing path.
  if (typeof ResizeObserver !== 'undefined' && document.body) {
    var contentResizeObserver = new ResizeObserver(scheduleContentRender);
    contentResizeObserver.observe(document.body);
  }
  document.addEventListener('load', function (event) {
    if (!annotationUiNode(event.target)) scheduleContentRender();
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

  function flashAndOpen(m) {
    var anchor = resolveMarkAnchor(m);
    var stageEl = document.getElementById('wbstage');
    var wb = window.workbench;
    var frameFocused = !!(
      wb && m.screenId && typeof wb.focusFrame === 'function' &&
      wb.focusFrame(annotationSection(m), m.screenId, { smooth: false })
    );
    if (!frameFocused && anchor.live && anchor.el && stageEl) {
      var er = anchor.el.getBoundingClientRect();
      var sr = stageEl.getBoundingClientRect();
      stageEl.scrollTop += er.top - sr.top - sr.height / 2 + er.height / 2;
      stageEl.scrollLeft += er.left - sr.left - sr.width / 2 + er.width / 2;
    } else if (!frameFocused && anchor.live && anchor.el && anchor.el.scrollIntoView) {
      // 独立文档 / 注入页没有 #wbstage 舞台：直接滚动文档到锚点。
      anchor.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    renderAll();
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
  }

  function goToMark(n) {
    var m = marks.find(function (k) { return k.n === n; });
    if (!m) return Promise.resolve();
    var p = Promise.resolve();
    var wb = window.workbench;
    if (wb) {
      if (m.pageId && typeof wb.setActivePage === 'function' && m.pageId !== currentWorkbenchPageId()) {
        p = Promise.resolve(wb.setActivePage(m.pageId, { scrollTop: false })).then(function () {
          var sec = annotationSection(m);
          if (sec && typeof wb.switchPage === 'function') return wb.switchPage(sec, { smooth: false });
        });
      } else if (annotationSection(m) && typeof wb.switchPage === 'function') {
        p = wb.switchPage(annotationSection(m), { smooth: false });
      }
    }
    return Promise.resolve(p).then(function () {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { flashAndOpen(m); resolve(); });
        });
      });
    });
  }

  function getState() {
    var pageMarks = marks.filter(markOnActivePage);
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
    setMode: function (on) { if (!!on !== mode) toggleMode(); },
    toggle: toggleMode,
    setPaused: setPaused,
    setRenderComments: setRenderComments,
    setBubbleLayout: setBubbleLayout,
    visibleBubbleAnchors: visibleBubbleAnchors,
    clear: doClear,
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
  });
})();
