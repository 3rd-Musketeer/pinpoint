// Workbench shell — pages, board loader, settings, preview hot-reload (Vite dev).
import { bubbleInnerHtml } from './lib/annotate-bubble.js';
import { GUTTER_BUBBLE_W, GUTTER_MARGIN, GUTTER_W, packGutter } from './lib/annotate-bubble-layout.js';
import { BoardMountManager } from './lib/board-mount-session.js';
import {
  centerScrollForPoint,
  closestBoardSection,
  findBoardFrame,
  findBoardSection,
  focusScrollForRect,
  hitTestBoardNavigation,
  measureBoardNavigation
} from './lib/board-navigation.js';
import {
  ContractError,
  validateBoard,
  validatePageManifest,
  validateScreenFragment
} from './lib/preview-contracts.js';
import { applyIncludeSlots } from './lib/include-slots.js';

var LIB_ID = 'library';
var WEB_LIB_ID = 'web-library';
var DOC_LIB_ID = 'doc-library';
var COMPONENTS_ID = 'components';
var SYSTEM_PAGES = { components: true };
// ios = 手机原型（fragment + 机身 chrome）
// web = web app 画板（fragment，无机身）
// html = 完整独立 HTML 文档（汇报页一类），iframe 承载，见 shell "doc"
var BOARD_MODES = { ios: true, web: true, html: true };
var activePageId = LIB_ID;
var boardMode = 'ios';
var pageManifest = null;
var pagesNav = document.getElementById('wbpages');
var boardModeBox = document.getElementById('wbboard-mode');
var stage  = document.getElementById('wbstage');
var sideScroll = document.getElementById('wbside-scroll');
var footEl = document.getElementById('wbfoot');
var settingsEl = document.getElementById('wbsettings');
var gearBtn = document.getElementById('wbgear');
var themeBox = document.getElementById('wbtheme');
var splitEl = document.getElementById('wbsplit');
var wbRoot = document.getElementById('wbroot') || document.querySelector('.wb');
var sideToggleBtn = document.getElementById('wbside-toggle');
var sideExpandBtn = document.getElementById('wbside-expand');
var annList = document.getElementById('wbann-list');
var annStatus = document.getElementById('wbann-status');
var annCountEl = document.getElementById('wbann-count');
var annFilterBox = document.getElementById('wbann-filter');
var activeGroup = 'lock';
var sectionOpen = { pages: true, annotations: true };
var annFilter = 'all';
var annListSig = '';          // last rendered list signature (skip rebuilds when unchanged)
var annPanelRaf = 0;          // rAF debounce token for refreshAnnPanel
var LS_KEY = 'ios-preview-wb';
var SIDE_W_MIN = 200;
var SIDE_W_MAX = 480;
var SIDE_W_DEFAULT = 250;
var ZOOM_MIN = 0.25;
var ZOOM_MAX = 2.5;
var sideW = SIDE_W_DEFAULT;
var sideCollapsed = false;
var prefsCache;
var libraryScrollHandler;
var includeCache = {};
var boardPanel;
var activeBoard = null;      // { pageId, board } — HTML 板的版本切换器要读它
var activeDocByPage = {};    // pageId → screenId，切页回来记得上次看的版本
var boardNavigationModel = null;
var boardLoadGen = 0;
var mountManager = new BoardMountManager();

function readPrefs() {
  if (!prefsCache) {
    try { prefsCache = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { prefsCache = {}; }
  }
  return prefsCache;
}

function savePrefs(patch) {
  prefsCache = Object.assign({}, readPrefs(), patch);
  localStorage.setItem(LS_KEY, JSON.stringify(prefsCache));
  return prefsCache;
}

function syncSegOn(box, attr, val, sel) {
  if (!box) return;
  box.querySelectorAll(sel || 'button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-' + attr) === val);
  });
}

function applySideWidth(px) {
  sideW = Math.round(Math.max(SIDE_W_MIN, Math.min(SIDE_W_MAX, px)));
  document.documentElement.style.setProperty('--wb-side-w', sideW + 'px');
  if (splitEl) splitEl.setAttribute('aria-valuenow', String(sideW));
  return sideW;
}

function setSideCollapsed(on, options) {
  options = options || {};
  sideCollapsed = !!on;
  if (wbRoot) wbRoot.classList.toggle('wb-side-collapsed', sideCollapsed);
  if (sideToggleBtn) {
    sideToggleBtn.setAttribute('aria-expanded', sideCollapsed ? 'false' : 'true');
    sideToggleBtn.setAttribute('aria-label', sideCollapsed ? '展开侧栏' : '收起侧栏');
    sideToggleBtn.title = sideCollapsed ? '展开侧栏' : '收起侧栏';
  }
  if (splitEl) {
    splitEl.setAttribute(
      'aria-label',
      sideCollapsed ? '展开侧栏（点击）或拖动调整宽度' : '调整侧栏宽度（拖动）· 双击收起'
    );
    splitEl.title = sideCollapsed ? '点击展开侧栏 · 拖动可调宽' : '拖动调整宽度 · 双击收起/展开';
  }
  if (options.save) savePrefs({ sideCollapsed: sideCollapsed });
  if (options.refit !== false) {
    requestAnimationFrame(function () { refit(); });
  }
}

function toggleSideCollapsed(options) {
  setSideCollapsed(!sideCollapsed, options || { save: true });
}

function iosTimeFromInput(val) {
  if (!val) return '9:41';
  var p = val.split(':');
  return parseInt(p[0], 10) + ':' + p[1];
}

function inputFromIosTime(t) {
  var p = (t || '9:41').split(':');
  var h = parseInt(p[0], 10);
  var m = p[1] || '00';
  return (h < 10 ? '0' : '') + h + ':' + m;
}

function applyIosRoots(p, root) {
  var scope = root || document;
  scope.querySelectorAll('.ios-root').forEach(function (r) {
    r.setAttribute('data-theme', p.theme || 'light');
    r.setAttribute('data-text-size', p.textSize || 'default');
    r.classList.toggle('screen-only', (p.frame || 'screen') === 'screen');
  });
}

function applyIosRootValue(attribute, value, root) {
  (root || document).querySelectorAll('.ios-root').forEach(function (iosRoot) {
    if (attribute === 'frame') iosRoot.classList.toggle('screen-only', value === 'screen');
    else iosRoot.setAttribute(attribute, value);
  });
}

function makePref(storeKey, opts) {
  return function set(val, options) {
    options = options || {};
    opts.apply(val);
    var box = typeof opts.ui === 'function' ? opts.ui() : opts.ui;
    if (box && opts.attr) syncSegOn(box, opts.attr, val, opts.btnSel);
    if (options.save) {
      savePrefs({ [storeKey]: val });
      if (opts.refit) refit();
    }
  };
}

var setTheme = makePref('theme', {
  apply: function (val) { applyIosRootValue('data-theme', val); },
  ui: function () { return themeBox; },
  attr: 'theme',
  refit: true
});

var setTextSize = makePref('textSize', {
  apply: function (val) { applyIosRootValue('data-text-size', val); },
  ui: function () { return settingsEl.querySelector('#textsize'); },
  attr: 'text-size',
  refit: true
});

var setFrame = makePref('frame', {
  apply: function (val) { applyIosRootValue('frame', val); },
  ui: function () { return settingsEl.querySelector('#frame'); },
  attr: 'frame',
  refit: true
});

var setCanvasZoom = makePref('canvasZoom', {
  apply: function (val) {
    var z = boardZoom(val);
    document.documentElement.setAttribute('data-canvas-zoom', z);
    document.documentElement.style.setProperty('--wb-board-zoom', z);
    syncBoardZoomLayout();
    syncZoomHud(z);
    var _a = annotateApi(); if (_a) _a.render();
    scheduleMinimapUpdate();
    updateMinimapAvailability();
    updateSectionNavigatorVisibility();
  },
  ui: function () { return settingsEl.querySelector('#zoom'); },
  attr: 'canvas-zoom'
  // Zoom persists only via pageViewports (wrapper); makePref must not write global canvasZoom.
});

var _setCanvasZoom = setCanvasZoom;
var zoomSaveT;
var pendingZoomSave = null;
setCanvasZoom = function (val, options) {
  options = options || {};
  // Visual update always; persist is debounced so wheel/pinch does not thrash localStorage.
  // Never pass save:true into makePref — global canvasZoom key is retired.
  _setCanvasZoom(val, { save: false });
  if (options.save) scheduleZoomSave(val);
};

function scheduleZoomSave(val) {
  pendingZoomSave = boardZoom(val);
  clearTimeout(zoomSaveT);
  zoomSaveT = setTimeout(flushZoomSave, 200);
}

function flushZoomSave() {
  clearTimeout(zoomSaveT);
  zoomSaveT = null;
  var z = pendingZoomSave;
  pendingZoomSave = null;
  if (z == null) return;
  savePageViewport(activePageId, { canvasZoom: z });
}

var viewportSaveT;
var restoringViewport = false;

function clampCanvasZoom(z) {
  z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  return Math.round(z * 100) / 100;
}

function stageScrollPatch() {
  return { scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop };
}

function readPageViewports() {
  var raw = readPrefs().pageViewports;
  return raw && typeof raw === 'object' ? raw : {};
}

function pageViewport(pageId) {
  var all = readPageViewports();
  return all[pageId] || null;
}

function savePageViewport(pageId, patch) {
  if (!pageId) return;
  var all = Object.assign({}, readPageViewports());
  all[pageId] = Object.assign({}, all[pageId] || {}, patch);
  savePrefs({ pageViewports: all });
}

function resolveBootPageId(prefs) {
  prefs = prefs || readPrefs();
  boardMode = normalizeBoardMode(prefs.boardMode);
  if (pageManifest) renderPageManifest(pageManifest);
  return resolvePageForMode(boardMode, prefs.activePageId);
}

/** One-time: seed pageViewports[pageId].canvasZoom from legacy prefs.canvasZoom, then drop the global key. */
function migrateLegacyCanvasZoom(pageId) {
  var prefs = readPrefs();
  if (!Object.prototype.hasOwnProperty.call(prefs, 'canvasZoom')) return;
  var legacy = boardZoom(prefs.canvasZoom);
  var all = Object.assign({}, readPageViewports());
  var cur = all[pageId] || {};
  if (cur.canvasZoom == null) {
    all[pageId] = Object.assign({}, cur, { canvasZoom: legacy });
  }
  var next = Object.assign({}, prefs, { pageViewports: all });
  delete next.canvasZoom;
  prefsCache = next;
  localStorage.setItem(LS_KEY, JSON.stringify(prefsCache));
}

function zoomForPage(pageId) {
  var vp = pageViewport(pageId);
  return boardZoom((vp && vp.canvasZoom) || '1');
}

function snapshotPageViewport(pageId) {
  if (!pageId || !stage) return;
  clearTimeout(viewportSaveT);
  viewportSaveT = null;
  flushZoomSave();
  savePageViewport(pageId, Object.assign(stageScrollPatch(), {
    canvasZoom: String(currentCanvasZoom())
  }));
}

function scheduleViewportScrollSave() {
  if (restoringViewport || !stage) return;
  scheduleMinimapUpdate();
  clearTimeout(viewportSaveT);
  viewportSaveT = setTimeout(function () {
    if (restoringViewport) return;
    savePageViewport(activePageId, stageScrollPatch());
  }, 300);
}

function restorePageViewport(pageId, options) {
  options = options || {};
  if (!stage) return false;
  var vp = pageViewport(pageId);
  if (!vp) return false;
  restoringViewport = true;
  if (vp.canvasZoom != null && options.zoom !== false) {
    _setCanvasZoom(boardZoom(vp.canvasZoom), { save: false });
  }
  if (options.scroll !== false) {
    var left = vp.scrollLeft != null ? vp.scrollLeft : 0;
    var top = vp.scrollTop != null ? vp.scrollTop : 0;
    stage.scrollLeft = left;
    stage.scrollTop = top;
  }
  requestAnimationFrame(function () {
    restoringViewport = false;
  });
  return true;
}

/** Zoom first, then layout, then scroll — scroll coords depend on zoomed board size. */
function restorePageViewportAfterMount(pageId) {
  if (!pageViewport(pageId)) return false;
  restorePageViewport(pageId, { scroll: false });
  syncBoardZoomLayout();
  restorePageViewport(pageId, { zoom: false });
  return true;
}

/** Reserve layout space for transform-scaled board (transform alone does not shrink flow).
 *  In HTML board mode the zoom-wrap is width:100% + transform:none (a fluid reader
 *  column, not a fixed canvas), so we must not pin an inline content-measured width —
 *  that would override the CSS and make the iframe overflow the stage into the gutter. */
function syncBoardZoomLayout() {
  var wrap = document.querySelector('#wb-board-panel .wb-zoom-wrap');
  var lib = wrap && wrap.querySelector('.wb-library');
  if (!wrap || !lib) return;
  if (boardMode === 'html') {
    wrap.style.width = '';
    wrap.style.height = '';
    return;
  }
  var z = currentCanvasZoom();
  var w = lib.offsetWidth;
  var h = lib.offsetHeight;
  wrap.style.width = Math.ceil(w * z) + 'px';
  wrap.style.height = Math.ceil(h * z) + 'px';
}

/** Board is a fixed canvas; viewer resize must not reflow phones. Prefer numeric zoom. */
function boardZoom(val) {
  if (!val || val === 'fit') return '1';
  return String(val);
}

function formatZoomLabel(z) {
  var n = Math.round(parseFloat(z) * 100);
  if (!isFinite(n)) n = 100;
  return n + '%';
}

function syncZoomHud(z) {
  var label = document.getElementById('wbzoom-label');
  if (label) label.textContent = formatZoomLabel(z || currentCanvasZoom());
}

function applyLockFont(val) {
  document.documentElement.setAttribute('data-lock-font', val);
  syncSegOn(settingsEl.querySelector('#lockfont'), 'lock-font', val, '.wb-font-opt');
  if (window.iOSKit) window.iOSKit.refresh();
}

function applyClock(mode, fixedIos) {
  document.documentElement.setAttribute('data-clock-mode', mode);
  var row = settingsEl.querySelector('#clockfixed-row');
  var input = settingsEl.querySelector('#clockfixed');
  if (mode === 'fixed') {
    var t = fixedIos || '9:41';
    document.documentElement.setAttribute('data-clock-fixed', t);
    if (input) input.value = inputFromIosTime(t);
    if (row) row.hidden = false;
  } else {
    document.documentElement.removeAttribute('data-clock-fixed');
    if (row) row.hidden = true;
  }
  syncSegOn(settingsEl.querySelector('#clockmode'), 'clock-mode', mode);
  if (window.iOSKit) window.iOSKit.tick();
}

function syncPanelPrefs(panel) {
  applyIosRoots(readPrefs(), panel);
}

function applyBootPrefs(prefs, options) {
  options = options || {};
  prefs = prefs || readPrefs();
  var pageId = options.pageId || resolveBootPageId(prefs);
  migrateLegacyCanvasZoom(pageId);

  if (options.side !== false) {
    applySideWidth(prefs.sideWidth || SIDE_W_DEFAULT);
    setSideCollapsed(!!prefs.sideCollapsed, { save: false, refit: false });
  }
  setMinimapOpen(false);

  applyIosRoots(prefs);
  syncSegOn(themeBox, 'theme', prefs.theme || 'light');
  applyLockFont(prefs.lockFont || 'helvetica');
  applyClock(prefs.clockMode || 'system', prefs.clockFixed || '9:41');
  setCanvasZoom(zoomForPage(pageId), { save: false });

  if (options.shell !== false) {
    annFilter = prefs.annFilter || 'all';
    if (prefs.sectionOpen) {
      sectionOpen = Object.assign({ pages: true, annotations: true }, prefs.sectionOpen);
    }
    if (annFilterBox) {
      annFilterBox.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-ann-filter') === annFilter);
      });
    }
    applyPageNames(prefs.pageNames);
    applySectionOpen();
  }

  if (options.syncSettingsUi) {
    syncSegOn(themeBox, 'theme', prefs.theme || 'light');
    syncSegOn(settingsEl.querySelector('#textsize'), 'text-size', prefs.textSize || 'default');
    syncSegOn(settingsEl.querySelector('#frame'), 'frame', prefs.frame || 'screen');
    syncSegOn(settingsEl.querySelector('#zoom'), 'canvas-zoom', zoomForPage(activePageId));
  }

  if (options.refit) refit();
  return pageId;
}

function restorePrefs() {
  applyBootPrefs(readPrefs(), {
    pageId: activePageId,
    side: false,
    shell: false,
    syncSettingsUi: true,
    refit: true
  });
}

function currentCanvasZoom() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wb-board-zoom')) || 1;
}

function refit() {
  if (window.iOSKit) window.iOSKit.fitAll();
  var _a = annotateApi(); if (_a) _a.render();
  refreshBoardNavigationModel();
  scheduleMinimapUpdate();
}

function setSectionOpen(name, open, options) {
  options = options || {};
  sectionOpen[name] = !!open;
  var sec = document.querySelector('[data-section="' + name + '"]');
  if (sec) {
    sec.classList.toggle('open', sectionOpen[name]);
    var head = sec.querySelector('.wb-section-head');
    if (head) head.setAttribute('aria-expanded', String(sectionOpen[name]));
  }
  if (options.save !== false) savePrefs({ sectionOpen: sectionOpen });
}

function applySectionOpen() {
  Object.keys(sectionOpen).forEach(function (name) {
    setSectionOpen(name, sectionOpen[name], { save: false });
  });
}

function wireSections() {
  document.querySelectorAll('.wb-section-head').forEach(function (btn) {
    if (btn.getAttribute('data-wired')) return;
    btn.setAttribute('data-wired', '1');
    btn.addEventListener('click', function () {
      var sec = btn.closest('[data-section]');
      if (!sec) return;
      setSectionOpen(sec.getAttribute('data-section'), !sec.classList.contains('open'));
    });
  });
}

function scrollToGroup(groupId, options) {
  options = options || {};
  activeGroup = groupId;
  updateSectionNavigatorActive(groupId);
  var el = document.getElementById('lib-' + groupId);
  if (el) el.scrollIntoView({ behavior: options.smooth === false ? 'auto' : 'smooth', block: 'start' });
  refit();
  refreshAnnPanel();
}

function switchPage(id, options) {
  options = options || {};
  showTabs();
  // Annotation API: section id within current board — or a top-level page id
  if (SYSTEM_PAGES[id] || id === LIB_ID || document.querySelector('.wb-page[data-vpage="' + id + '"]')) {
    return setActivePage(id).then(function () {
      var first = document.querySelector('#wb-board-panel .wb-lib-item[data-ann-section], #wb-board-panel .wb-lib-item[data-ann-group]');
      if (first) {
        activeGroup = first.getAttribute('data-ann-section')
          || first.getAttribute('data-ann-group')
          || activeGroup;
      }
      refreshAnnPanel();
    });
  }
  scrollToGroup(id, options);
  return Promise.resolve();
}

function wireLibraryScrollSpy() {
  if (libraryScrollHandler) stage.removeEventListener('scroll', libraryScrollHandler);
  var model = currentBoardNavigationModel();
  if (!model || !model.sections.length) return;
  var spyRaf = 0;
  libraryScrollHandler = function () {
    if (spyRaf) return;
    spyRaf = requestAnimationFrame(function () {
      spyRaf = 0;
      var closest = closestBoardSection(
        currentBoardNavigationModel(),
        stage.scrollTop + stage.clientHeight / 2
      );
      var best = closest && closest.id;
      if (best && best !== activeGroup) {
        activeGroup = best;
        updateSectionNavigatorActive(best);
        if (annFilter === 'tab') refreshAnnPanel();
      }
    });
  };
  stage.addEventListener('scroll', libraryScrollHandler, { passive: true });
}

/* ---- annotate API resolver -------------------------------------------------
   HTML 板的文档活在 iframe 里，它自己注入 annotate.js，于是页面上同时存在两个
   互不相通的标注实例：父窗口（侧栏按钮驱动）和 iframe（文档本体）。侧栏点「标注」
   只切到了父窗口那个，画不出框 —— 表现成「侧栏和右下角没对齐」。
   侧栏是唯一控制面，所以取用时按当前板解析到正确的那个实例。 */
function activeDocWindow() {
  if (boardMode !== 'html' || !boardPanel) return null;
  var frame = boardPanel.querySelector('.wb-screen:not([data-doc-hidden]) .wb-doc-frame');
  if (!frame) return null;
  try {
    var w = frame.contentWindow;
    return w && w.iOSAnnotate ? w : null;     // 跨域时读 contentWindow 会抛
  } catch (e) {
    return null;
  }
}

function annotateApi() {
  var docWin = activeDocWindow();
  return (docWin && docWin.iOSAnnotate) || window.iOSAnnotate;
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
  if (boardMode !== 'html' || !boardPanel) return null;
  return boardPanel.querySelector('.wb-screen:not([data-doc-hidden]) .wb-doc-frame');
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
  return !!(st && st.renderComments && st.bubbleLayout === 'sidebar' && boardMode === 'html');
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

function stopGutter() {
  if (gutterRaf) { cancelAnimationFrame(gutterRaf); gutterRaf = 0; }
  var wrap = gutterStageWrap();
  if (wrap) wrap.removeAttribute('data-ann-gutter');
  if (gutterOverlay) gutterOverlay.style.display = 'none';
  if (gutterBubblesEl) while (gutterBubblesEl.firstChild) gutterBubblesEl.removeChild(gutterBubblesEl.firstChild);
}

/** 由侧栏更新路径与 board 切换调用：按当前状态启停 gutter。 */
function syncGutterComments() {
  if (gutterActive()) startGutter();
  else stopGutter();
}

// 每个 iframe 实例只订阅一次，否则每次 loadBoard 都会叠一层监听
var docAnnotateSeen = typeof WeakSet === 'function' ? new WeakSet() : null;
function bindDocAnnotate() {
  var docWin = activeDocWindow();
  if (!docWin) return false;
  var ann = docWin.iOSAnnotate;
  if (docAnnotateSeen && !docAnnotateSeen.has(ann)) {
    docAnnotateSeen.add(ann);
    if (typeof ann.onUpdate === 'function') ann.onUpdate(scheduleAnnPanel);
  }
  scheduleAnnPanel();
  return true;
}

/* iframe 里的 annotate.js 是文档自己异步注入的，board 挂载完时通常还没就绪。
   轮询到它出现为止（上限 ~4s），出现后订阅一次，侧栏面板即刻反映文档的标注状态。 */
var docAnnotateWatch = 0;
function watchDocAnnotate() {
  if (docAnnotateWatch) { clearInterval(docAnnotateWatch); docAnnotateWatch = 0; }
  if (boardMode !== 'html') return;
  var tries = 0;
  docAnnotateWatch = setInterval(function () {
    if (bindDocAnnotate() || ++tries > 40) {
      clearInterval(docAnnotateWatch);
      docAnnotateWatch = 0;
    }
  }, 100);
}

function markSummary(m) {
  var body = (m && (m.content != null ? m.content : m.comment)) || '';
  if (body) {
    var ann = annotateApi();
    if (ann && typeof ann.contentToDisplay === 'function') return ann.contentToDisplay(body, m.targets || []);
    if (ann && typeof ann.commentToDisplay === 'function') return ann.commentToDisplay(body);
    return body;
  }
  if (m.type === 'region') return '框选区域';
  if (m.text) return m.text.slice(0, 60);
  return m.selector || '';
}

function markTags(m) {
  var tags = [];
  if (m.changeTo) tags.push('✎');
  if (m.move) tags.push('↗');
  if (m.images && m.images.length) tags.push('🖼');
  if (m.research) tags.push('🔍');
  if (m.mentions && m.mentions.length) tags.push('@');
  return tags.join(' ');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function frameNoteApiUrl(pageId, screenId) {
  return '/api/frame-notes/' + encodeURIComponent(pageId) + '/' + encodeURIComponent(screenId);
}

function frameNoteError(response, data) {
  var error = new Error((data && data.message) || ('Frame Note 请求失败 · ' + response.status));
  error.status = response.status;
  error.data = data || {};
  return error;
}

function readFrameNoteResponse(response) {
  return response.json().catch(function () { return {}; }).then(function (data) {
    if (!response.ok) throw frameNoteError(response, data);
    return data;
  });
}

function setFrameNoteStatus(noteEl, message, isError) {
  var status = noteEl.querySelector('[data-frame-note-status]');
  if (!status) return;
  status.textContent = message || '';
  status.classList.toggle('is-error', !!isError);
}

function setFrameNoteBusy(noteEl, busy) {
  noteEl.querySelectorAll('button, textarea').forEach(function (control) {
    control.disabled = !!busy;
  });
}

function closeFrameNoteEditor(noteEl) {
  var view = noteEl.querySelector('[data-frame-note-view]');
  var editor = noteEl.querySelector('[data-frame-note-editor]');
  if (view) view.hidden = false;
  if (editor) editor.hidden = true;
  noteEl.classList.remove('is-editing');
  setFrameNoteBusy(noteEl, false);
  setFrameNoteStatus(noteEl, '', false);
  refit();
}

function openFrameNoteEditor(noteEl) {
  var screen = noteEl.closest('[data-screen]');
  var screenId = screen && screen.getAttribute('data-screen');
  if (!screenId || activePageId === COMPONENTS_ID) return;
  var edit = noteEl.querySelector('[data-frame-note-action="edit"]');
  if (edit) edit.disabled = true;
  noteEl.classList.add('is-loading');

  fetch(frameNoteApiUrl(activePageId, screenId))
    .then(readFrameNoteResponse)
    .then(function (data) {
      if (!noteEl.isConnected) return;
      noteEl.dataset.frameNoteRevision = data.revision;
      var input = noteEl.querySelector('[data-frame-note-input]');
      var view = noteEl.querySelector('[data-frame-note-view]');
      var editor = noteEl.querySelector('[data-frame-note-editor]');
      if (input) input.value = data.note || '';
      if (view) view.hidden = true;
      if (editor) editor.hidden = false;
      noteEl.classList.add('is-editing');
      setFrameNoteStatus(noteEl, '⌘/Ctrl + Enter 保存', false);
      if (input) {
        input.focus();
        input.setSelectionRange(0, 0);
        input.scrollTop = 0;
      }
      refit();
    })
    .catch(function (error) {
      if (!noteEl.isConnected) return;
      if (edit) {
        edit.textContent = '重试';
        edit.title = error.message;
      }
    })
    .finally(function () {
      if (!noteEl.isConnected) return;
      noteEl.classList.remove('is-loading');
      if (edit) edit.disabled = false;
    });
}

function saveFrameNote(noteEl) {
  var screen = noteEl.closest('[data-screen]');
  var screenId = screen && screen.getAttribute('data-screen');
  var input = noteEl.querySelector('[data-frame-note-input]');
  var revision = noteEl.dataset.frameNoteRevision;
  if (!screenId || !input || !revision || activePageId === COMPONENTS_ID) return;

  setFrameNoteBusy(noteEl, true);
  setFrameNoteStatus(noteEl, '正在保存…', false);
  fetch(frameNoteApiUrl(activePageId, screenId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: input.value, baseRevision: revision })
  })
    .then(readFrameNoteResponse)
    .then(function (data) {
      if (!noteEl.isConnected) return;
      noteEl.dataset.frameNoteRevision = data.revision;
      var text = noteEl.querySelector('[data-frame-note-text]');
      var edit = noteEl.querySelector('[data-frame-note-action="edit"]');
      if (text) {
        text.textContent = data.note || '添加这一步的场景、交互或能力说明。';
        text.classList.toggle('wb-frame-note-placeholder', !data.note);
      }
      if (edit) {
        edit.textContent = data.note ? '编辑' : '＋ Frame Note';
        edit.title = '';
      }
      noteEl.classList.toggle('is-empty', !data.note);
      closeFrameNoteEditor(noteEl);
    })
    .catch(function (error) {
      if (!noteEl.isConnected) return;
      var message = error.status === 409
        ? 'board.json 已被修改；请保留当前文字，取消后重新打开再保存。'
        : error.message;
      setFrameNoteBusy(noteEl, false);
      setFrameNoteStatus(noteEl, message, true);
    });
}

function wireFrameNoteEditors(panel) {
  if (!panel || panel.dataset.frameNotesWired === '1') return;
  panel.dataset.frameNotesWired = '1';
  panel.addEventListener('click', function (event) {
    var action = event.target.closest('[data-frame-note-action]');
    if (!action || !panel.contains(action)) return;
    event.preventDefault();
    event.stopPropagation();
    var noteEl = action.closest('[data-frame-note]');
    if (!noteEl) return;
    var kind = action.getAttribute('data-frame-note-action');
    if (kind === 'edit') openFrameNoteEditor(noteEl);
    else if (kind === 'cancel') closeFrameNoteEditor(noteEl);
    else if (kind === 'save') saveFrameNote(noteEl);
  });
  panel.addEventListener('keydown', function (event) {
    var input = event.target.closest('[data-frame-note-input]');
    if (!input || !panel.contains(input)) return;
    var noteEl = input.closest('[data-frame-note]');
    if (!noteEl) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFrameNoteEditor(noteEl);
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveFrameNote(noteEl);
    }
  });
}

function syncConnStatus() {
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

// Debounce annotate panel refreshes so a burst of notify() calls (persist + SSE
// + scroll-spy) coalesces into one rAF rebuild.
function scheduleAnnPanel() {
  if (annPanelRaf) return;
  annPanelRaf = requestAnimationFrame(function () {
    annPanelRaf = 0;
    refreshAnnPanel();
  });
}

function refreshAnnPanel() {
  var ann = annotateApi();
  if (!ann || typeof ann.getState !== 'function') return;
  syncConnStatus();
  var st = ann.getState();
  var btnToggle = document.getElementById('wbann-toggle');
  var btnPause = document.getElementById('wbann-pause');
  var btnPin = document.getElementById('wbann-pin');
  if (btnToggle) {
    btnToggle.classList.toggle('on', st.mode);
    var label = btnToggle.querySelector('.wb-tool-label');
    if (label) label.textContent = st.mode ? '标注' : '交互';
    btnToggle.title = st.mode ? '标注模式 (A → 交互)' : '交互模式 (A → 标注)';
  }
  if (btnPause) btnPause.classList.toggle('on', st.paused);
  if (btnPin) btnPin.classList.toggle('on', st.floating);
  var btnComments = document.getElementById('wbann-comments');
  if (btnComments) {
    btnComments.classList.toggle('on', !!st.renderComments);
    var cLabel = btnComments.querySelector('.wb-tool-label');
    if (cLabel) cLabel.textContent = st.renderComments ? '评论✓' : '评论';
  }
  var btnChannel = document.getElementById('wbann-channel');
  if (btnChannel) {
    btnChannel.hidden = !st.renderComments;
    var lay = st.bubbleLayout || 'inline';
    btnChannel.classList.toggle('on', lay === 'sidebar');
    var chLabel = btnChannel.querySelector('.wb-tool-label');
    if (chLabel) chLabel.textContent = lay === 'sidebar' ? 'sidebar' : 'inline';
  }
  // G=画布外 模式：按当前状态启停父级 gutter 渲染。
  syncGutterComments();
  if (annStatus) {
    if (!st.count) {
      annStatus.textContent = '';
    } else {
      var parts = [];
      parts.push(st.countLive + ' 条可见');
      if (st.countBroken) parts.push(st.countBroken + ' 锚点失效');
      parts.push('共 ' + st.count + ' 条');
      annStatus.textContent = parts.join(' · ');
    }
  }
  if (!annList) return;
  var allMarks = (ann.pageMarks || []).slice().sort(function (a, b) { return a.n - b.n; });
  if (allMarks.length && !sectionOpen.annotations) {
    setSectionOpen('annotations', true, { save: false });
  }
  if (annCountEl) {
    annCountEl.textContent = allMarks.length ? '(' + allMarks.length + ')' : '';
  }
  var marks = allMarks;
  if (annFilter === 'tab') {
    marks = marks.filter(function (m) {
      var sec = m.section || m.group;
      return !sec || sec === activeGroup;
    });
  }
  // Build a row model + signature; skip the innerHTML rebuild when the list
  // hasn't changed (mode toggle / scroll-spy fire notify without touching marks).
  var rows = marks.map(function (m) {
    var broken = typeof ann.isMarkBroken === 'function' ? ann.isMarkBroken(m) : false;
    return {
      n: m.n,
      key: (m.section || m.group || '_') + '|' + m.n,
      group: m.section || m.group || '_',
      groupLabel: m.sectionLabel || m.groupLabel || '未分组',
      type: m.type,
      text: (m.text || '').slice(0, 40),
      summary: markSummary(m),
      broken: broken,
      tags: markTags(m)
    };
  });
  var sig = annFilter + '|' + activeGroup + '|' + rows.map(function (r) {
    return r.key + ':' + r.type + ':' + r.text + ':' + r.summary + ':' + r.broken + ':' + r.tags;
  }).join('~');
  if (sig === annListSig && annList.querySelector('[data-ann-n]')) {
    // List unchanged; buttons/counts above already reflect current state.
    return;
  }
  annListSig = sig;
  if (!rows.length) {
    annList.innerHTML =
      '<div class="wb-ann-empty">' +
      '<i data-wb-icon="empty-ann" data-wb-icon-size="22" class="wb-ann-empty-ico"></i>' +
      '<p class="wb-ann-empty-title">暂无标注</p>' +
      '<p class="wb-ann-empty-hint">切换到「标注」后，在画布上点选或框选元素</p>' +
      '</div>';
    if (window.mountWorkbenchIcons) window.mountWorkbenchIcons(annList);
    return;
  }
  var groups = [];
  var groupMap = {};
  rows.forEach(function (r) {
    if (!groupMap[r.group]) {
      groupMap[r.group] = { label: r.groupLabel, items: [] };
      groups.push(groupMap[r.group]);
    }
    groupMap[r.group].items.push(r);
  });
  annList.innerHTML = groups.map(function (g) {
    var head = g.label !== '未分组' ? '<div class="wb-ann-group">' + escHtml(g.label) + '</div>' : '';
    var body = g.items.map(function (r) {
      var rowCls = 'wb-ann-item' + (r.broken ? ' wb-ann-item--broken' : '');
      return '<div class="' + rowCls + '" data-ann-n="' + r.n + '">' +
        '<div class="wb-ann-item-row">' +
        '<button type="button" class="wb-ann-item-main" data-ann-n="' + r.n + '">' +
        '<span class="wb-ann-num">' + r.n + '</span>' +
        '<span class="wb-ann-body">' +
        '<span class="wb-ann-cap">' + escHtml(r.type === 'region' ? '框选' : r.text || '元素') + '</span>' +
        '<span class="wb-ann-text">' + escHtml(r.summary) + '</span>' +
        (r.broken ? '<span class="wb-ann-broken-tag">锚点失效</span>' : '') +
        (r.tags ? '<span class="wb-ann-tags">' + r.tags + '</span>' : '') +
        '</span></button>' +
        '<button type="button" class="wb-ann-del" data-ann-del="' + r.n + '" aria-label="删除标注 ' + r.n + '" title="删除">×</button>' +
        '</div></div>';
    }).join('');
    return head + body;
  }).join('');
}

function wireAnnotatePanel() {
  var ann = annotateApi();
  if (!ann || wireAnnotatePanel.done || typeof ann.getState !== 'function') return;
  var btnToggle = document.getElementById('wbann-toggle');
  var btnPause = document.getElementById('wbann-pause');
  var btnClear = document.getElementById('wbann-clear');
  var btnPin = document.getElementById('wbann-pin');
  var btnComments = document.getElementById('wbann-comments');
  var btnChannel = document.getElementById('wbann-channel');
  if (!btnToggle || !btnPause || !btnClear || !btnPin) return;
  wireAnnotatePanel.done = true;
  ann.onUpdate(scheduleAnnPanel);
  syncConnStatus();
  // 每次点击重新解析：HTML 板下要驱动的是 iframe 里那个实例，不能闭包捕获
  btnToggle.addEventListener('click', function () { annotateApi().toggle(); });
  btnPause.addEventListener('click', function () {
    var a = annotateApi();
    a.setPaused(!a.getState().paused);
  });
  btnClear.addEventListener('click', function () { annotateApi().clear(); });
  btnPin.addEventListener('click', function () {
    var a = annotateApi();
    a.setFloatingToolbar(!a.getState().floating);
  });
  if (btnComments) btnComments.addEventListener('click', function () {
    var a = annotateApi();
    if (typeof a.setRenderComments === 'function') a.setRenderComments(!a.getState().renderComments);
  });
  if (btnChannel) btnChannel.addEventListener('click', function () {
    var a = annotateApi();
    if (typeof a.setBubbleLayout !== 'function') return;
    var cur = a.getState().bubbleLayout || 'inline';
    a.setBubbleLayout(cur === 'inline' ? 'sidebar' : 'inline');
  });
  annList.addEventListener('click', function (e) {
    var del = e.target.closest('[data-ann-del]');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      var dn = parseInt(del.getAttribute('data-ann-del'), 10);
      var aDel = annotateApi();
      if (aDel.removeMark) aDel.removeMark(dn);
      return;
    }
    var row = e.target.closest('.wb-ann-item-main[data-ann-n]');
    if (!row) return;
    var n = parseInt(row.getAttribute('data-ann-n'), 10);
    annotateApi().goToMark(n).then(function () {
      var item = annList.querySelector('.wb-ann-item[data-ann-n="' + n + '"]');
      if (item) item.scrollIntoView({ block: 'nearest' });
    });
  });
  if (annFilterBox) {
    annFilterBox.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ann-filter]');
      if (!b) return;
      annFilter = b.getAttribute('data-ann-filter');
      annFilterBox.querySelectorAll('button').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      savePrefs({ annFilter: annFilter });
      if (annFilter === 'tab' && libraryScrollHandler) libraryScrollHandler();
      refreshAnnPanel();
    });
  }

  refreshAnnPanel();
}

function pollAnnotate() {
  if (window.iOSAnnotate) wireAnnotatePanel();
  else setTimeout(pollAnnotate, 100);
}

/**
 * Interactive frames (A+B) — screen HTML is mounted via innerHTML, so <script>
 * never runs by itself. Framework only mounts; product logic stays in the screen.
 *
 * A — inline in the same HTML:
 *   <script data-preview-script>… uses `root`; may return unmount …</script>
 *   <script type="module" data-preview-script>
 *     export default function mount(root) { return unmount; }
 *   </script>
 *
 * B — sidecar next to the screen (preferred when logic grows):
 *   previews/<page>/<screenId>.js  →  export default function mount(root) {…}
 *   Opt in with data-preview-mount on .ios-app / .ios-lockscreen, or
 *   <script type="module" data-preview-script src="./screenId.js"></script>
 *
 * root = nearest .ios-app / .ios-lockscreen (override: data-preview-root="css").
 * Do not put product gestures in ios-kit.js.
 */
function screenRootFrom(el) {
  if (!el) return null;
  if (el.classList && (el.classList.contains('ios-app') || el.classList.contains('ios-lockscreen'))) {
    return el;
  }
  var near = el.closest ? el.closest('.ios-app, .ios-lockscreen') : null;
  if (near) return near;
  var screen = el.closest ? el.closest('.wb-screen') : null;
  if (!screen) return null;
  return screen.querySelector('.ios-app, .ios-lockscreen') || screen;
}

function resolvePreviewRoot(scriptEl) {
  var screen = scriptEl.closest('.wb-screen');
  var sel = scriptEl.getAttribute('data-preview-root');
  if (sel) {
    var scoped = (screen || document).querySelector(sel);
    if (scoped) return scoped;
  }
  var prev = scriptEl.previousElementSibling;
  if (prev && (prev.classList.contains('ios-app') || prev.classList.contains('ios-lockscreen'))) {
    return prev;
  }
  return screenRootFrom(scriptEl);
}

function previewScriptLabel(el) {
  var screen = el && el.closest && el.closest('[data-screen]');
  return (screen && screen.getAttribute('data-screen')) || 'preview';
}

function cacheBust(url, generation) {
  var sep = url.indexOf('?') >= 0 ? '&' : '?';
  return url + sep + 'mount=' + generation;
}

function resolveSidecarUrl(pageId, screenId, src) {
  // dynamic import() rejects bare specifiers — sidecar URLs must start with '/'
  if (src) {
    if (/^(https?:|\/|blob:)/.test(src)) return src;
    src = String(src).replace(/^\.\//, '');
    return '/previews/' + pageId + '/' + src;
  }
  return '/previews/' + pageId + '/' + screenId + '.js';
}

function invokeMountModule(mod, root, label, session) {
  if (!mod || !session.isUsable(root)) return;
  var mount = typeof mod.default === 'function' ? mod.default
    : (typeof mod.mount === 'function' ? mod.mount : null);
  if (!mount) {
    console.warn('[preview-script] ' + label + ': module has no default/mount export');
    return;
  }
  var ret = mount(root);
  if (ret && typeof ret.then === 'function') {
    return ret.then(function (v) { session.trackDisposer(v, root); });
  }
  session.trackDisposer(ret, root);
  if (typeof mod.unmount === 'function') {
    session.trackDisposer(function () { mod.unmount(root); }, root);
  }
}

function importPreviewModule(url, root, label, session) {
  return import(/* @vite-ignore */ cacheBust(url, session.generation))
    .then(function (mod) { return invokeMountModule(mod, root, label, session); })
    .catch(function (err) {
      console.error('[preview-script] ' + label + ' ← ' + url, err);
    });
}

function runOnePreviewScript(el, pageId, session) {
  if (!el || el.dataset.previewBound === '1' || !session.isUsable(el)) return Promise.resolve();
  el.dataset.previewBound = '1';
  var root = resolvePreviewRoot(el);
  if (!root) return Promise.resolve();
  var label = previewScriptLabel(el);
  var srcAttr = el.getAttribute('src') || el.getAttribute('data-preview-src');
  var body = (el.textContent || '').trim();
  var isModule = (el.getAttribute('type') || '').toLowerCase() === 'module';

  if (srcAttr) {
    var screen = el.closest('[data-screen]');
    var screenId = (screen && screen.getAttribute('data-screen')) || label;
    return importPreviewModule(resolveSidecarUrl(pageId, screenId, srcAttr), root, label, session);
  }

  if (!body) return Promise.resolve();

  if (isModule) {
    var blob = new Blob(
      [body + '\n//# sourceURL=preview-script/' + label + '.js'],
      { type: 'text/javascript' }
    );
    var blobUrl = URL.createObjectURL(blob);
    return import(/* @vite-ignore */ blobUrl)
      .then(function (mod) {
        URL.revokeObjectURL(blobUrl);
        return invokeMountModule(mod, root, label, session);
      })
      .catch(function (err) {
        URL.revokeObjectURL(blobUrl);
        console.error('[preview-script] ' + label, err);
      });
  }

  try {
    var fn = new Function('root', body + '\n//# sourceURL=preview-script/' + label + '.js');
    if (session.isUsable(root)) session.trackDisposer(fn(root), root);
  } catch (err) {
    console.error('[preview-script] ' + label, err);
  }
  return Promise.resolve();
}

/** B: roots marked data-preview-mount load previews/<page>/<screenId>.js */
function runSidecarMounts(scope, pageId, session) {
  if (!scope || pageId === COMPONENTS_ID || !session.active) return Promise.resolve();
  var roots = scope.querySelectorAll('[data-preview-mount]');
  var jobs = [];
  for (var i = 0; i < roots.length; i++) {
    (function (root) {
      if (root.dataset.previewBound === '1') return;
      root.dataset.previewBound = '1';
      var screen = root.closest('[data-screen]');
      var screenId = screen && screen.getAttribute('data-screen');
      if (!screenId) return;
      var url = resolveSidecarUrl(pageId, screenId, null);
      jobs.push(importPreviewModule(url, root, screenId, session));
    })(roots[i]);
  }
  return Promise.all(jobs);
}

function runPreviewScripts(scope, pageId, session) {
  if (!scope || !session.active) return Promise.resolve();
  var list = scope.querySelectorAll('script[data-preview-script]');
  var jobs = [];
  for (var i = 0; i < list.length; i++) {
    jobs.push(runOnePreviewScript(list[i], pageId, session));
  }
  jobs.push(runSidecarMounts(scope, pageId, session));
  return Promise.all(jobs);
}

function afterMount(panel, session) {
  return session.defer(function () {
      if (!session.isUsable(panel)) return;
      // Board phones keep intrinsic size; zoom is on .wb-library, not per-stage fit.
      panel.querySelectorAll('.ios-stage[data-fit]').forEach(function (s) {
        s.removeAttribute('data-fit');
        var device = s.querySelector('.ios-device');
        if (device) device.style.setProperty('--ios-scale', '1');
      });
      syncPanelPrefs(panel);
      wireExportControls(panel);
      var hadViewport = restorePageViewportAfterMount(session.pageId);
      if (window.iOSKit) window.iOSKit.refresh(panel);
      return runPreviewScripts(panel, session.pageId, session).then(function () {
        if (!session.isUsable(panel)) return;
        // Coalesce the post-script DOM batch into one frame so layout
        // reads/writes (navigator positions, frame-in-view, ann panel) batch.
        requestAnimationFrame(function () {
          if (!session.isUsable(panel)) return;
          var _a = annotateApi(); if (_a) _a.render();
          rebuildSectionNavigator(panel);
          wireLibraryScrollSpy();
          if (!hadViewport) frameBoardInView(panel, { pageId: session.pageId });
          refreshAnnPanel();
          scheduleMinimapUpdate();
        });
      });
  }, 0);
}

var EXPORT_TOKEN_NAMES = [
  '--wb-phone-w', '--wb-phone-h', '--wb-cap-section', '--wb-cap-screen', '--wb-cap-note', '--wb-cap-gap',
  '--wb-fg', '--wb-muted', '--wb-faint', '--wb-side', '--wb-line', '--wb-hover', '--wb-accent'
];
var exportDialog = null;
var exportTarget = null;
var openFrameMenu = null;
var frameMenuListenersWired = false;

function syncExportDomState(source, clone) {
  var sources = [source].concat(Array.prototype.slice.call(source.querySelectorAll('*')));
  var clones = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
  sources.forEach(function (node, index) {
    var copy = clones[index];
    if (!copy) return;
    if (node instanceof HTMLInputElement) {
      copy.value = node.value;
      copy.setAttribute('value', node.value);
      if (node.checked) copy.setAttribute('checked', '');
      else copy.removeAttribute('checked');
    } else if (node instanceof HTMLTextAreaElement) {
      copy.value = node.value;
      copy.textContent = node.value;
    } else if (node instanceof HTMLSelectElement) {
      Array.prototype.forEach.call(copy.options, function (option, optionIndex) {
        option.selected = node.options[optionIndex] && node.options[optionIndex].selected;
      });
    } else if (node instanceof HTMLDetailsElement) {
      copy.open = node.open;
    } else if (node instanceof HTMLCanvasElement) {
      try {
        var image = document.createElement('img');
        image.src = node.toDataURL('image/png');
        image.width = node.width;
        image.height = node.height;
        image.style.cssText = node.style.cssText;
        image.className = copy.className;
        copy.replaceWith(image);
      } catch (e) { /* a tainted canvas remains blank instead of breaking export */ }
    }
    if (node.scrollTop || node.scrollLeft) {
      copy.setAttribute('data-export-scroll-top', String(node.scrollTop));
      copy.setAttribute('data-export-scroll-left', String(node.scrollLeft));
    }
  });
}

function cleanExportClone(clone, includeNotes) {
  clone.querySelectorAll('script,style[data-export-ui],[data-export-ui],.wb-frame-note-edit,.wb-frame-note-editor').forEach(function (node) {
    node.remove();
  });
  if (!includeNotes) {
    clone.querySelectorAll('[data-frame-note]').forEach(function (node) { node.remove(); });
  } else {
    clone.querySelectorAll('[data-frame-note-view]').forEach(function (node) { node.hidden = false; });
  }
  clone.removeAttribute('data-export-ui');
  clone.querySelectorAll('.has-frame-menu').forEach(function (node) { node.classList.remove('has-frame-menu'); });
  return clone;
}

function exportTokens() {
  var library = document.querySelector('#wb-board-panel .wb-library');
  if (!library) return {};
  var computed = getComputedStyle(library);
  var tokens = {};
  EXPORT_TOKEN_NAMES.forEach(function (name) {
    var value = computed.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  });
  return tokens;
}

function resolveExportTarget(options) {
  options = options || {};
  if (options.target instanceof Element) return options.target;
  var panel = document.getElementById('wb-board-panel');
  if (!panel) return null;
  if (options.kind === 'section') {
    return panel.querySelector('.wb-lib-item[data-ann-section="' + CSS.escape(options.sectionId || '') + '"]');
  }
  return panel.querySelector('[data-screen="' + CSS.escape(options.screenId || '') + '"]');
}

function buildExportSnapshot(options) {
  options = options || {};
  var kind = options.kind === 'section' ? 'section' : 'frame';
  var target = resolveExportTarget(options);
  if (!target) throw new Error('找不到要导出的 ' + (kind === 'frame' ? 'Frame' : 'Section'));
  var section = kind === 'section' ? target : target.closest('.wb-lib-item');
  var screen = kind === 'frame' ? target.closest('[data-screen]') : null;
  var includeNotes = options.includeNotes === true;
  var source;
  source = target;
  if (!source) throw new Error('目标没有可导出的视觉内容');
  var clone = source.cloneNode(true);
  syncExportDomState(source, clone);
  cleanExportClone(clone, includeNotes);
  if (kind === 'frame' && !includeNotes) {
    clone.querySelectorAll('.wb-screen-cap').forEach(function (node) { node.remove(); });
  }
  if (kind === 'section' && !includeNotes) {
    clone.querySelectorAll('.wb-sec-row').forEach(function (node) { node.classList.add('wb-export-clean-row'); });
  }
  var format = options.format === 'png' ? 'png' : 'webp';
  var background = options.background || 'canvas';
  if (background === 'transparent') format = 'png';
  return {
    kind: kind,
    pageId: activePageId,
    sectionId: section.getAttribute('data-ann-section') || section.getAttribute('data-ann-group'),
    screenId: screen ? screen.getAttribute('data-screen') : '',
    format: format,
    scale: Number(options.scale) === 1 ? 1 : 2,
    background: background,
    includeNotes: includeNotes,
    tokens: exportTokens(),
    html: clone.outerHTML
  };
}

function exportFileName(request) {
  var ids = [request.pageId, request.sectionId];
  if (request.kind === 'frame') ids.push(request.screenId);
  return ids.join('__').replace(/\//g, '-') + '@' + request.scale + 'x.' + request.format;
}

function requestExportImage(options) {
  var request = buildExportSnapshot(options);
  return fetch('/api/export-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  }).then(function (response) {
    if (!response.ok) return response.json().catch(function () { return {}; }).then(function (body) {
      throw new Error(body.message || ('导出失败 · ' + response.status));
    });
    return response.blob().then(function (blob) {
      return {
        blob: blob,
        filename: exportFileName(request),
        width: Number(response.headers.get('X-Export-Width')) || 0,
        height: Number(response.headers.get('X-Export-Height')) || 0,
        request: request
      };
    });
  });
}

function downloadExportResult(result) {
  var url = URL.createObjectURL(result.blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

function filenameFromContentDisposition(header, fallback) {
  if (!header) return fallback;
  var star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1]); } catch (e) { /* keep fallback */ }
  }
  var plain = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
  return plain ? plain[1].trim() : fallback;
}

function activeDocExportTarget() {
  if (boardMode !== 'html' || !boardPanel || !activeBoard) return null;
  var screenNode = boardPanel.querySelector('.wb-screen:not([data-doc-hidden])[data-screen]');
  if (!screenNode) return null;
  var screenId = screenNode.getAttribute('data-screen');
  var title = screenId;
  var src = null;
  (activeBoard.board.sections || []).forEach(function (sec) {
    (sec.screens || []).forEach(function (sc) {
      if (sc.id !== screenId) return;
      title = sc.title || sc.id;
      src = sc.src || ('previews/' + activeBoard.pageId + '/' + sc.id + '.html');
    });
  });
  if (!src) {
    var frame = screenNode.querySelector('.wb-doc-frame');
    var attr = frame && frame.getAttribute('src');
    if (attr) src = attr;
  }
  if (!src) return null;
  if (/^https?:\/\//i.test(src)) {
    try { src = new URL(src, location.href).pathname; } catch (e) { return null; }
  }
  src = String(src).replace(/^\/+/, '');
  if (src.indexOf('previews/') !== 0) return null;
  return {
    pageId: activeBoard.pageId,
    screenId: screenId,
    title: title,
    src: src
  };
}

var docExportDialog = null;
var docTokenCache = {};
var docTokenRequestSeq = 0;

function requestDocTokenEstimate(src, mode, comments) {
  var key = mode + '\0' + (comments ? '1' : '0') + '\0' + src;
  if (docTokenCache[key]) return Promise.resolve(docTokenCache[key]);
  var body = { src: src, mode: mode, comments: !!comments };
  if (mode === 'image') {
    body.scale = 2;
    body.viewportWidth = comments ? 1184 : 920;
  }
  return fetch('/api/export-doc-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (response) {
    if (!response.ok) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(body.message || ('token 估算失败 · ' + response.status));
      });
    }
    return response.json();
  }).then(function (estimate) {
    docTokenCache[key] = estimate;
    return estimate;
  });
}

function renderDocTokenEstimate(estimate) {
  var row = docExportDialog && docExportDialog.querySelector('[data-export-tokens]');
  if (!row) return;
  if (!estimate || !estimate.providers) {
    row.hidden = true;
    row.innerHTML = '';
    row.removeAttribute('title');
    return;
  }
  row.hidden = false;
  var sizeLine = estimate.mode === 'image' && estimate.width && estimate.height
    ? estimate.width + '×' + estimate.height + 'px\n'
    : '';
  row.title = sizeLine + estimate.providers.map(function (p) {
    return p.label + ' ' + p.tokens.toLocaleString('en-US') + ' · ' + p.detail;
  }).join('\n');
  row.innerHTML = estimate.providers.map(function (p) {
    return '<span class="wb-export-token"><span class="wb-export-token-label">' + escHtml(p.label) +
      '</span><span class="wb-export-token-n">~' + escHtml(p.display) + '</span></span>';
  }).join('');
}

function refreshDocExportTokens() {
  if (!docExportDialog) return;
  var form = docExportDialog.querySelector('form');
  var target = docExportDialog._target;
  var mode = new FormData(form).get('mode') || 'html-full';
  var comments = !!(form.querySelector('[name="comments"]') && form.querySelector('[name="comments"]').checked);
  var tokensEl = docExportDialog.querySelector('[data-export-tokens]');
  if (!tokensEl) return;
  if (!target) {
    renderDocTokenEstimate(null);
    return;
  }
  var seq = ++docTokenRequestSeq;
  tokensEl.hidden = false;
  tokensEl.title = '';
  tokensEl.innerHTML = '<span class="wb-export-token-pending">' +
    (mode === 'image' ? '测量版面并估算视觉 tokens…' : '估算 tokens…') +
    '</span>';
  requestDocTokenEstimate(target.src, mode, comments).then(function (estimate) {
    if (seq !== docTokenRequestSeq) return;
    renderDocTokenEstimate(estimate);
  }).catch(function () {
    if (seq !== docTokenRequestSeq) return;
    tokensEl.hidden = false;
    tokensEl.title = '';
    tokensEl.innerHTML = '<span class="wb-export-token-pending">token 估算失败</span>';
  });
}

function ensureDocExportDialog() {
  if (docExportDialog) return docExportDialog;
  docExportDialog = document.createElement('dialog');
  docExportDialog.className = 'wb-export-dialog';
  docExportDialog.setAttribute('data-ann-ui', '');
  docExportDialog.setAttribute('data-export-ui', '');
  docExportDialog.innerHTML = '<form class="wb-export-form" method="dialog">' +
    '<div class="wb-export-head"><div class="wb-export-head-copy"><h2>导出文档</h2><p class="wb-export-target" data-export-target-label></p></div><button class="wb-export-close" value="cancel" aria-label="关闭">×</button></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">格式</span><div class="wb-export-options wb-export-options--stack">' +
      '<label class="wb-export-option"><input type="radio" name="mode" value="html-full" checked><span><span class="wb-export-option-copy"><strong>HTML 完整</strong><small>源文件，含样式 · 适合本地打开 / 外发</small></span></span></label>' +
      '<label class="wb-export-option"><input type="radio" name="mode" value="html-no-css"><span><span class="wb-export-option-copy"><strong>去除 CSS 的 HTML</strong><small>结构与正文保留 · 适合喂给 AI</small></span></span></label>' +
      '<label class="wb-export-option"><input type="radio" name="mode" value="image"><span><span class="wb-export-option-copy"><strong>长图</strong><small>整页 PNG · 920 宽 · 2×</small></span></span></label>' +
    '</div></div>' +
    '<div class="wb-export-field"><label class="wb-export-check"><input type="checkbox" name="comments" value="1"><span>含评论（标注框 + 序号 + 侧栏气泡）</span></label></div>' +
    '<div class="wb-export-status" data-export-status>HTML 完整 · 源文件下载</div>' +
    '<div class="wb-export-tokens" data-export-tokens hidden></div>' +
    '<div class="wb-export-actions"><button type="button" class="wb-export-action primary" data-export-download>下载</button></div>' +
    '</form>';
  document.body.appendChild(docExportDialog);
  var form = docExportDialog.querySelector('form');
  function status(text, isError) {
    var el = docExportDialog.querySelector('[data-export-status]');
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
  }
  function commentsOn() {
    var el = form.querySelector('[name="comments"]');
    return !!(el && el.checked);
  }
  function modeHint(mode) {
    var withComments = commentsOn();
    if (mode === 'html-no-css') {
      return withComments
        ? '去除 CSS 的 HTML · 文末追加评论列表 · 适合喂给 AI'
        : '去除 CSS 的 HTML · 适合喂给 AI';
    }
    if (mode === 'image') {
      return withComments
        ? '长图 · PNG · 1184×2（920 正文 + 264 侧栏气泡）· 含标注框、序号、评论气泡 · 下方为视觉 token'
        : '长图 · PNG · 920×2 · 不含评论 · 下方为视觉 token';
    }
    return withComments
      ? 'HTML 完整 · 打开时按锚点重定位标注框 + 评论气泡 · 可本地打开'
      : 'HTML 完整 · 源文件下载';
  }
  form.addEventListener('change', function () {
    var mode = new FormData(form).get('mode');
    status(modeHint(mode));
    refreshDocExportTokens();
  });
  docExportDialog.querySelector('[data-export-download]').addEventListener('click', function () {
    var target = docExportDialog._target;
    if (!target) { status('当前没有可导出的文档', true); return; }
    var mode = new FormData(form).get('mode') || 'html-full';
    var comments = commentsOn();
    var button = docExportDialog.querySelector('[data-export-download]');
    button.disabled = true;
    status(mode === 'image'
      ? (comments ? '正在生成含评论的长图…' : '正在生成高保真长图…')
      : (comments ? '正在烘焙评论并准备下载…' : '正在准备下载…'));
    requestDocExport(Object.assign({}, target, { mode: mode, comments: comments }))
      .then(function (result) {
        downloadExportResult(result);
        var commentNote = result.commentsBaked != null
          ? ' · ' + result.commentsBaked + ' 条评论'
            + (result.commentsBroken ? '（跳过 ' + result.commentsBroken + ' 条失效锚点）' : '')
          : '';
        if (result.width && result.height) {
          status(result.width + ' × ' + result.height + ' · ' + (result.blob.size / 1024).toFixed(0) + ' KB · 已下载' + commentNote);
        } else {
          status('已下载' + commentNote);
        }
      })
      .catch(function (err) {
        status(String(err && err.message || err), true);
      })
      .then(function () { button.disabled = false; });
  });
  return docExportDialog;
}

function requestDocExport(options) {
  options = options || {};
  var comments = !!options.comments;
  var request = {
    mode: options.mode || 'html-full',
    pageId: options.pageId,
    screenId: options.screenId,
    src: options.src,
    comments: comments,
    format: 'png',
    scale: 2,
    viewportWidth: comments ? 1184 : 920
  };
  return fetch('/api/export-doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  }).then(function (response) {
    if (!response.ok) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(body.message || ('导出失败 · ' + response.status));
      });
    }
    var fallback = request.pageId + '__' + request.screenId
      + (request.mode === 'html-no-css'
        ? (comments ? '.comments.no-css.html' : '.no-css.html')
        : request.mode === 'image'
          ? (comments ? '@2x.comments.png' : '@2x.png')
          : (comments ? '.comments.html' : '.html'));
    return response.blob().then(function (blob) {
      return {
        blob: blob,
        filename: filenameFromContentDisposition(response.headers.get('Content-Disposition'), fallback),
        width: Number(response.headers.get('X-Export-Width')) || 0,
        height: Number(response.headers.get('X-Export-Height')) || 0,
        commentsBaked: response.headers.has('X-Export-Comments')
          ? Number(response.headers.get('X-Export-Comments'))
          : null,
        commentsBroken: response.headers.has('X-Export-Comments-Broken')
          ? Number(response.headers.get('X-Export-Comments-Broken'))
          : null,
        request: request
      };
    });
  });
}

function openDocExportDialog() {
  var target = activeDocExportTarget();
  if (!target) return;
  var dialog = ensureDocExportDialog();
  dialog._target = target;
  dialog.querySelector('[data-export-target-label]').textContent =
    target.pageId + ' / ' + target.title;
  dialog.querySelector('[data-export-status]').textContent = 'HTML 完整 · 源文件下载';
  dialog.querySelector('[data-export-status]').classList.remove('is-error');
  var full = dialog.querySelector('[name="mode"][value="html-full"]');
  if (full) full.checked = true;
  var comments = dialog.querySelector('[name="comments"]');
  if (comments) comments.checked = false;
  dialog.showModal();
  refreshDocExportTokens();
  // Prefetch the AI-friendly variant so switching modes feels instant.
  requestDocTokenEstimate(target.src, 'html-no-css', false).catch(function () {});
}

function ensureExportDialog() {
  if (exportDialog) return exportDialog;
  exportDialog = document.createElement('dialog');
  exportDialog.className = 'wb-export-dialog';
  exportDialog.setAttribute('data-ann-ui', '');
  exportDialog.setAttribute('data-export-ui', '');
  exportDialog.innerHTML = '<form class="wb-export-form" method="dialog">' +
    '<div class="wb-export-head"><div class="wb-export-head-copy"><h2>导出图片</h2><p class="wb-export-target" data-export-target-label></p></div><button class="wb-export-close" value="cancel" aria-label="关闭">×</button></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">预设</span><div class="wb-export-options">' +
      '<label class="wb-export-option"><input type="radio" name="notes" value="clean" checked><span>干净画面</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="notes" value="notes"><span>带说明</span></label>' +
    '</div></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">格式</span><div class="wb-export-options">' +
      '<label class="wb-export-option"><input type="radio" name="format" value="webp" checked><span>WebP</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="format" value="png"><span>PNG</span></label>' +
    '</div></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">清晰度</span><div class="wb-export-options">' +
      '<label class="wb-export-option"><input type="radio" name="scale" value="1"><span>1×</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="scale" value="2" checked><span>2×</span></label>' +
    '</div></div>' +
    '<div class="wb-export-field"><span class="wb-export-label">背景</span><div class="wb-export-options">' +
      '<label class="wb-export-option"><input type="radio" name="background" value="canvas" checked><span>Canvas</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="background" value="white"><span>白色</span></label>' +
      '<label class="wb-export-option"><input type="radio" name="background" value="transparent"><span>透明</span></label>' +
    '</div></div>' +
    '<div class="wb-export-status" data-export-status>WebP · 2× · 干净背景</div>' +
    '<div class="wb-export-actions"><button type="button" class="wb-export-action" data-export-copy>复制 PNG</button><button type="button" class="wb-export-action primary" data-export-download>下载图片</button></div>' +
    '</form>';
  document.body.appendChild(exportDialog);
  var form = exportDialog.querySelector('form');
  function panelOptions(overrides) {
    var data = new FormData(form);
    return Object.assign({
      kind: exportTarget.kind,
      target: exportTarget.target,
      includeNotes: data.get('notes') === 'notes',
      format: data.get('format'),
      scale: Number(data.get('scale')),
      background: data.get('background')
    }, overrides || {});
  }
  function status(text, isError) {
    var el = exportDialog.querySelector('[data-export-status]');
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
  }
  function busy(value) {
    exportDialog.querySelectorAll('.wb-export-action').forEach(function (button) { button.disabled = value; });
  }
  form.addEventListener('change', function (event) {
    if (event.target.name === 'background' && event.target.value === 'transparent') {
      form.querySelector('[name="format"][value="png"]').checked = true;
    }
    if (event.target.name === 'format' && event.target.value === 'webp') {
      var transparent = form.querySelector('[name="background"][value="transparent"]');
      if (transparent.checked) form.querySelector('[name="background"][value="canvas"]').checked = true;
    }
    var data = new FormData(form);
    status((data.get('format') || '').toUpperCase() + ' · ' + data.get('scale') + '× · ' + (data.get('notes') === 'notes' ? '带说明' : '干净画面'));
  });
  exportDialog.querySelector('[data-export-download]').addEventListener('click', function () {
    busy(true); status('正在生成高保真图片…');
    requestExportImage(panelOptions()).then(function (result) {
      downloadExportResult(result);
      status(result.width + ' × ' + result.height + ' · ' + (result.blob.size / 1024).toFixed(0) + ' KB · 已下载');
    }).catch(function (error) { status(error.message, true); }).finally(function () { busy(false); });
  });
  exportDialog.querySelector('[data-export-copy]').addEventListener('click', function () {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') { status('当前浏览器不支持复制图片，请使用下载。', true); return; }
    busy(true); status('正在生成剪贴板 PNG…');
    requestExportImage(panelOptions({ format: 'png' })).then(function (result) {
      return navigator.clipboard.write([new ClipboardItem({ 'image/png': result.blob })]).then(function () {
        status(result.width + ' × ' + result.height + ' · 已复制 PNG');
      });
    }).catch(function (error) { status(error.message, true); }).finally(function () { busy(false); });
  });
  return exportDialog;
}

function openExportDialog(kind, target) {
  var dialog = ensureExportDialog();
  exportTarget = { kind: kind, target: target };
  var section = target.closest('.wb-lib-item');
  var screen = kind === 'frame' ? target.closest('[data-screen]') : null;
  var label = activePageId + ' / ' + (section.getAttribute('data-ann-section-label') || section.getAttribute('data-ann-section'));
  if (screen) label += ' / ' + screen.getAttribute('data-screen');
  dialog.querySelector('[data-export-target-label]').textContent = label;
  var notesOption = dialog.querySelector('[name="notes"][value="notes"]');
  notesOption.disabled = kind === 'frame' && !target.querySelector('[data-frame-note]');
  if (notesOption.disabled) dialog.querySelector('[name="notes"][value="clean"]').checked = true;
  dialog.showModal();
}

function closeFrameMenu() {
  if (!openFrameMenu) return;
  openFrameMenu.menu.hidden = true;
  openFrameMenu.trigger.setAttribute('aria-expanded', 'false');
  openFrameMenu = null;
}

function copyFrameIndicator(screen, button) {
  var text = '@frame:' + activePageId + '/' + screen.getAttribute('data-screen');
  var done = function () {
    var label = button.querySelector('[data-frame-menu-label]');
    if (label) label.textContent = '已复制 ' + text;
    setTimeout(function () { if (label) label.textContent = '复制 @frame'; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () {});
  }
}

function wireFrameMenuGlobalListeners() {
  if (frameMenuListenersWired) return;
  frameMenuListenersWired = true;
  document.addEventListener('click', function (event) {
    if (openFrameMenu && !event.target.closest('.wb-frame-menu-shell')) closeFrameMenu();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeFrameMenu();
  });
}

function wireExportControls(panel) {
  if (!panel) return;
  closeFrameMenu();
  wireFrameMenuGlobalListeners();
  panel.querySelectorAll('.wb-lib-item').forEach(function (section) {
    if (!section.querySelector(':scope > .wb-export-section-trigger')) {
      var sectionButton = document.createElement('button');
      sectionButton.type = 'button';
      sectionButton.className = 'wb-export-trigger wb-export-section-trigger';
      sectionButton.setAttribute('data-export-ui', '');
      sectionButton.setAttribute('aria-label', '导出 Section');
      sectionButton.title = '导出 Section 图片';
      sectionButton.innerHTML = '<span data-wb-icon="export-image" data-wb-icon-size="16"></span>';
      sectionButton.addEventListener('click', function () { openExportDialog('section', section); });
      section.appendChild(sectionButton);
    }
  });
  panel.querySelectorAll('[data-screen]').forEach(function (screen) {
    var caption = screen.querySelector(':scope > .wb-screen-cap');
    if (!caption || caption.querySelector(':scope > .wb-frame-menu-shell')) return;
    caption.classList.add('has-frame-menu');
    var shell = document.createElement('span');
    shell.className = 'wb-frame-menu-shell';
    shell.setAttribute('data-export-ui', '');
    shell.setAttribute('data-ann-ui', '');
    shell.innerHTML = '<button type="button" class="wb-frame-menu-trigger" aria-label="Frame 菜单" aria-haspopup="menu" aria-expanded="false" title="Frame 菜单">⋯</button>' +
      '<span class="wb-frame-menu" role="menu" hidden>' +
        '<button type="button" class="wb-frame-menu-item" role="menuitem" data-frame-export><span data-wb-icon="export-image" data-wb-icon-size="15"></span><span>导出图片…</span></button>' +
        '<button type="button" class="wb-frame-menu-item" role="menuitem" data-frame-copy><span aria-hidden="true" style="width:15px;text-align:center;color:var(--wb-muted)">@</span><span data-frame-menu-label>复制 @frame</span></button>' +
      '</span>';
    var trigger = shell.querySelector('.wb-frame-menu-trigger');
    var menu = shell.querySelector('.wb-frame-menu');
    trigger.addEventListener('click', function (event) {
      event.stopPropagation();
      var shouldOpen = menu.hidden;
      closeFrameMenu();
      if (!shouldOpen) return;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      openFrameMenu = { trigger: trigger, menu: menu };
    });
    shell.querySelector('[data-frame-export]').addEventListener('click', function (event) {
      event.stopPropagation();
      closeFrameMenu();
      openExportDialog('frame', screen);
    });
    shell.querySelector('[data-frame-copy]').addEventListener('click', function (event) {
      event.stopPropagation();
      copyFrameIndicator(screen, event.currentTarget);
    });
    caption.appendChild(shell);
  });
  if (window.mountWorkbenchIcons) window.mountWorkbenchIcons(panel);
}

/** Scroll so board content sits near the viewer top-left (not lost in the empty pad). */
function frameBoardInView(panel, options) {
  options = options || {};
  if (!stage || !panel) return;
  if (!options.force && pageViewport(options.pageId || activePageId)) return;
  var cs = getComputedStyle(panel);
  var padL = parseFloat(cs.paddingLeft) || 0;
  var padT = parseFloat(cs.paddingTop) || 0;
  var inset = 40;
  var left = Math.max(0, padL - inset);
  var top = Math.max(0, padT - inset);
  if (options.smooth) {
    stage.scrollTo({ left: left, top: top, behavior: 'smooth' });
  } else {
    stage.scrollLeft = left;
    stage.scrollTop = top;
  }
}

/** Refresh the single Canvas → Section → Frame geometry source used by both navigators. */
function refreshBoardNavigationModel(panel) {
  panel = panel || document.getElementById('wb-board-panel');
  boardNavigationModel = measureBoardNavigation(stage, panel);
  return boardNavigationModel;
}

function currentBoardNavigationModel() {
  return boardNavigationModel || refreshBoardNavigationModel();
}

/** Union rect (stage-scroll coords) of all visible board sections. */
function boardContentBounds(panel) {
  var measured = panel ? refreshBoardNavigationModel(panel) : currentBoardNavigationModel();
  return measured && measured.bounds;
}

/** Recenter viewport on the midpoint of all content frames. */
function recenterBoard() {
  var panel = document.getElementById('wb-board-panel');
  if (!stage || !panel) return;
  var bounds = boardContentBounds(panel);
  if (!bounds) {
    frameBoardInView(panel, { force: true, smooth: true });
    return;
  }
  var left = Math.max(0, bounds.left + bounds.width / 2 - stage.clientWidth / 2);
  var top = Math.max(0, bounds.top + bounds.height / 2 - stage.clientHeight / 2);
  stage.scrollTo({ left: left, top: top, behavior: 'smooth' });
}

var minimapWrap = document.getElementById('wbminimap-wrap');
var minimapEl = document.getElementById('wbminimap');
var minimapCanvas = document.getElementById('wbminimap-canvas');
var minimapToggleBtn = document.getElementById('wbminimap-toggle');
var minimapRaf = 0;
var minimapLayout = null; // { bounds, scale, ox, oy, cw, ch, sections, frames }
var minimapOpen = false;

var MINIMAP_COLORS = [
  { section: 'rgba(0,122,255,.14)', active: 'rgba(0,122,255,.24)', stroke: 'rgba(0,122,255,.55)', frame: 'rgba(0,82,204,.72)' },
  { section: 'rgba(52,199,89,.14)', active: 'rgba(52,199,89,.24)', stroke: 'rgba(35,150,67,.55)', frame: 'rgba(30,125,56,.72)' },
  { section: 'rgba(255,149,0,.15)', active: 'rgba(255,149,0,.25)', stroke: 'rgba(210,112,0,.56)', frame: 'rgba(184,92,0,.74)' },
  { section: 'rgba(175,82,222,.14)', active: 'rgba(175,82,222,.24)', stroke: 'rgba(134,52,173,.55)', frame: 'rgba(111,43,145,.72)' },
  { section: 'rgba(90,200,250,.16)', active: 'rgba(90,200,250,.27)', stroke: 'rgba(41,151,203,.58)', frame: 'rgba(31,123,167,.74)' },
  { section: 'rgba(255,45,85,.13)', active: 'rgba(255,45,85,.23)', stroke: 'rgba(208,30,65,.54)', frame: 'rgba(176,25,55,.72)' }
];

var sectionNavWrap = document.getElementById('wbsection-nav-wrap');
var sectionNavToggleBtn = document.getElementById('wbsection-nav-toggle');
var sectionNavEl = document.getElementById('wbsection-nav');
var sectionNavList = document.getElementById('wbsection-nav-list');
var sectionNavPosition = document.getElementById('wbsection-nav-position');
var sectionNavStatus = document.getElementById('wbsection-nav-status');
var sectionNavOpen = false;
var sectionNavItems = [];

function setMinimapOpen(on) {
  minimapOpen = !!on && !!minimapWrap && !minimapWrap.hidden;
  if (minimapEl) minimapEl.hidden = !minimapOpen;
  if (minimapToggleBtn) {
    minimapToggleBtn.classList.toggle('on', minimapOpen);
    minimapToggleBtn.setAttribute('aria-expanded', minimapOpen ? 'true' : 'false');
    minimapToggleBtn.setAttribute('aria-label', minimapOpen ? '关闭缩略图导航' : '打开缩略图导航');
    minimapToggleBtn.title = minimapOpen ? '关闭缩略图导航' : '打开缩略图导航';
  }
  if (minimapOpen) {
    scheduleMinimapUpdate();
  }
}

function updateMinimapAvailability(panel) {
  if (!minimapWrap) return null;
  panel = panel || document.getElementById('wb-board-panel');
  var measured = panel ? refreshBoardNavigationModel(panel) : null;
  var available = !!(measured && measured.bounds.width >= 8 && measured.bounds.height >= 8);
  minimapWrap.hidden = !available;
  if (!available) {
    minimapLayout = null;
    setMinimapOpen(false);
  }
  return available ? measured : null;
}

function scheduleMinimapUpdate() {
  if (minimapRaf || !minimapOpen) return;
  minimapRaf = requestAnimationFrame(function () {
    minimapRaf = 0;
    updateMinimap();
  });
}

function updateMinimap() {
  if (!minimapWrap || !minimapEl || !minimapCanvas || !stage || !minimapOpen) return;
  var panel = document.getElementById('wb-board-panel');
  var measured = updateMinimapAvailability(panel);
  var bounds = measured && measured.bounds;
  if (!bounds) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var cssW = minimapCanvas.clientWidth;
  var cssH = minimapCanvas.clientHeight;
  if (cssW < 8 || cssH < 8) return;
  var cw = Math.round(cssW * dpr);
  var ch = Math.round(cssH * dpr);
  if (minimapCanvas.width !== cw || minimapCanvas.height !== ch) {
    minimapCanvas.width = cw;
    minimapCanvas.height = ch;
  }
  var pad = 6 * dpr;
  var scale = Math.min((cw - pad * 2) / bounds.width, (ch - pad * 2) / bounds.height);
  var ox = (cw - bounds.width * scale) / 2;
  var oy = (ch - bounds.height * scale) / 2;
  minimapLayout = {
    bounds: bounds,
    scale: scale,
    ox: ox,
    oy: oy,
    cw: cw,
    ch: ch,
    dpr: dpr,
    sections: measured.sections,
    frames: measured.frames
  };

  var ctx = minimapCanvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  // Canvas layer
  ctx.fillStyle = 'rgba(15,23,42,.045)';
  ctx.fillRect(0, 0, cw, ch);

  // Section layer
  var sectionRects = measured.sections || [];
  minimapEl.setAttribute('data-minimap-section-count', String(sectionRects.length));
  minimapEl.setAttribute('data-minimap-frame-count', String(measured.frames.length));
  for (var s = 0; s < sectionRects.length; s++) {
    var section = sectionRects[s];
    var sectionColor = MINIMAP_COLORS[section.colorIndex % MINIMAP_COLORS.length];
    var sx = ox + (section.left - bounds.left) * scale;
    var sy = oy + (section.top - bounds.top) * scale;
    var sw = Math.max(4 * dpr, section.width * scale);
    var sh = Math.max(4 * dpr, section.height * scale);
    var sr = Math.min(5 * dpr, sw / 4, sh / 4);
    ctx.fillStyle = section.id === activeGroup ? sectionColor.active : sectionColor.section;
    ctx.strokeStyle = sectionColor.stroke;
    ctx.lineWidth = section.id === activeGroup ? Math.max(1.5 * dpr, 2) : Math.max(.75 * dpr, 1);
    roundRect(ctx, sx, sy, sw, sh, sr);
    ctx.fill();
    ctx.stroke();
  }

  // Frame layer
  var frameRects = measured.frames;
  for (var i = 0; i < frameRects.length; i++) {
    var frame = frameRects[i];
    var frameColor = MINIMAP_COLORS[frame.colorIndex % MINIMAP_COLORS.length];
    var x = ox + (frame.left - bounds.left) * scale;
    var y = oy + (frame.top - bounds.top) * scale;
    var w = Math.max(2 * dpr, frame.width * scale);
    var h = Math.max(2 * dpr, frame.height * scale);
    var rr = Math.min(4 * dpr, w / 4, h / 4);
    ctx.fillStyle = frameColor.frame;
    roundRect(ctx, x, y, w, h, rr);
    ctx.fill();
  }

  // Viewport window
  var vx = ox + (stage.scrollLeft - bounds.left) * scale;
  var vy = oy + (stage.scrollTop - bounds.top) * scale;
  var vw = stage.clientWidth * scale;
  var vh = stage.clientHeight * scale;
  ctx.strokeStyle = 'rgba(0,122,255,.9)';
  ctx.lineWidth = Math.max(1.5 * dpr, 2);
  ctx.fillStyle = 'rgba(0,122,255,.12)';
  roundRect(ctx, vx, vy, vw, vh, 3 * dpr);
  ctx.fill();
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function stageViewportMetrics() {
  return {
    width: stage.clientWidth,
    height: stage.clientHeight,
    scrollWidth: stage.scrollWidth,
    scrollHeight: stage.scrollHeight
  };
}

/** Shared focus behavior for both navigators: center fitting targets, leading-align large ones. */
function focusStageOnRect(rect, options) {
  if (!stage || !rect) return;
  options = options || {};
  var target = focusScrollForRect(rect, stageViewportMetrics(), { inset: options.inset || 24 });
  stage.scrollTo({
    left: target.left,
    top: target.top,
    behavior: options.smooth === false ? 'auto' : 'smooth'
  });
}

function centerStageOnPoint(x, y, options) {
  if (!stage) return;
  options = options || {};
  var target = centerScrollForPoint({ x: x, y: y }, stageViewportMetrics());
  stage.scrollTo({
    left: target.left,
    top: target.top,
    behavior: options.smooth === false ? 'auto' : 'smooth'
  });
}

function minimapJump(clientX, clientY) {
  if (!minimapLayout || !stage || !minimapCanvas) return;
  var rect = minimapCanvas.getBoundingClientRect();
  var mx = ((clientX - rect.left) / rect.width) * minimapLayout.cw;
  var my = ((clientY - rect.top) / rect.height) * minimapLayout.ch;
  var b = minimapLayout.bounds;
  var cx = b.left + (mx - minimapLayout.ox) / minimapLayout.scale;
  var cy = b.top + (my - minimapLayout.oy) / minimapLayout.scale;
  var hit = hitTestBoardNavigation(minimapLayout, cx, cy, { framePadding: 48 });
  if (hit.kind === 'frame' || hit.kind === 'section') {
    focusStageOnRect(hit.target);
    return;
  }
  centerStageOnPoint(cx, cy);
}

function wireMinimap() {
  if (!minimapWrap || !minimapEl || !minimapCanvas) return;
  minimapEl.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    minimapJump(e.clientX, e.clientY);
  });
  if (minimapToggleBtn) {
    minimapToggleBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setMinimapOpen(!minimapOpen);
    });
  }
  window.addEventListener('resize', function () {
    updateMinimapAvailability();
    scheduleMinimapUpdate();
  });
}

function setSectionNavigatorOpen(on) {
  sectionNavOpen = !!on && !!sectionNavWrap && !sectionNavWrap.hidden;
  if (sectionNavEl) sectionNavEl.hidden = !sectionNavOpen;
  if (sectionNavToggleBtn) {
    sectionNavToggleBtn.classList.toggle('on', sectionNavOpen);
    sectionNavToggleBtn.setAttribute('aria-expanded', sectionNavOpen ? 'true' : 'false');
    sectionNavToggleBtn.title = sectionNavOpen ? '关闭 Section Navigator' : '打开 Section Navigator';
  }
  updateSectionNavigatorActive(activeGroup);
}

function collectSectionNavigatorItems(model) {
  if (!model) return [];
  return model.sections.map(function (section) {
    return {
      id: section.id,
      title: section.title,
      screens: section.frames.filter(function (frame) { return !!frame.screenId; }).map(function (frame) {
        return {
          id: frame.screenId,
          title: frame.title
        };
      })
    };
  }).filter(function (item) { return item.id && item.id !== '_empty'; });
}

function closestSectionNavigatorGroup() {
  if (!stage) return null;
  var section = closestBoardSection(
    currentBoardNavigationModel(),
    stage.scrollTop + stage.clientHeight / 2
  );
  return section && section.id;
}

function sectionNavigatorShouldShow(panel) {
  if (!stage || !panel || !sectionNavItems.length) return false;
  if (sectionNavItems.length > 1) return true;
  var bounds = boardContentBounds(panel);
  if (!bounds) return false;
  return bounds.width > stage.clientWidth + 24 || bounds.height > stage.clientHeight + 24;
}

function updateSectionNavigatorVisibility() {
  if (!sectionNavWrap) return;
  var panel = document.getElementById('wb-board-panel');
  var visible = sectionNavigatorShouldShow(panel);
  sectionNavWrap.hidden = !visible;
  if (!visible) setSectionNavigatorOpen(false);
}

function updateSectionNavigatorActive(groupId) {
  if (!sectionNavList || !sectionNavItems.length) return;
  var index = sectionNavItems.findIndex(function (item) { return item.id === groupId; });
  if (index < 0) index = 0;
  var current = sectionNavItems[index];
  [].slice.call(sectionNavList.querySelectorAll('.wb-section-nav-item')).forEach(function (item) {
    var on = item.getAttribute('data-nav-group') === current.id;
    item.classList.toggle('on', on);
    var button = item.querySelector('.wb-section-nav-section');
    if (button) {
      if (on) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    }
  });
  var position = String(index + 1) + ' / ' + String(sectionNavItems.length);
  if (sectionNavPosition) sectionNavPosition.textContent = position;
  if (sectionNavStatus) sectionNavStatus.textContent = position;
  if (sectionNavToggleBtn) {
    sectionNavToggleBtn.setAttribute(
      'aria-label',
      (sectionNavOpen ? '关闭' : '打开') + ' Section Navigator，当前 ' + current.title + '，' + position
    );
  }
}

function rebuildSectionNavigator(panel) {
  if (!sectionNavList || !sectionNavWrap) return;
  var model = updateMinimapAvailability(panel);
  sectionNavItems = collectSectionNavigatorItems(model);
  sectionNavList.innerHTML = '';

  sectionNavItems.forEach(function (entry) {
    var item = document.createElement('div');
    item.className = 'wb-section-nav-item';
    item.setAttribute('data-nav-group', entry.id);

    var sectionButton = document.createElement('button');
    sectionButton.type = 'button';
    sectionButton.className = 'wb-section-nav-section';
    sectionButton.setAttribute('data-nav-group', entry.id);
    sectionButton.title = entry.title;
    var label = document.createElement('span');
    label.className = 'wb-section-nav-label';
    label.textContent = entry.title;
    sectionButton.appendChild(label);
    item.appendChild(sectionButton);

    var screens = document.createElement('div');
    screens.className = 'wb-section-nav-screens';
    entry.screens.forEach(function (screen) {
      var screenButton = document.createElement('button');
      screenButton.type = 'button';
      screenButton.className = 'wb-section-nav-screen';
      screenButton.setAttribute('data-nav-group', entry.id);
      screenButton.setAttribute('data-nav-screen', screen.id);
      screenButton.setAttribute('aria-label', '定位到 ' + entry.title + ' · ' + screen.title);
      screenButton.title = screen.title;
      screens.appendChild(screenButton);
    });
    item.appendChild(screens);
    sectionNavList.appendChild(item);
  });

  updateSectionNavigatorVisibility();
  var closest = closestSectionNavigatorGroup() || sectionNavItems[0] && sectionNavItems[0].id;
  if (closest) activeGroup = closest;
  updateSectionNavigatorActive(activeGroup);
  setSectionNavigatorOpen(sectionNavOpen);
  setMinimapOpen(minimapOpen);
}

function jumpSectionNavigatorToGroup(groupId) {
  var section = findBoardSection(refreshBoardNavigationModel(), groupId);
  if (!section || !stage) return;
  activeGroup = groupId;
  updateSectionNavigatorActive(groupId);
  if (annFilter === 'tab') refreshAnnPanel();
  focusStageOnRect(section);
}

function jumpSectionNavigatorToScreen(groupId, screenId) {
  focusWorkbenchFrame(groupId, screenId);
}

function focusWorkbenchFrame(groupId, screenId, options) {
  var frame = findBoardFrame(refreshBoardNavigationModel(), groupId, screenId);
  if (!frame || !stage) return false;
  activeGroup = groupId;
  updateSectionNavigatorActive(groupId);
  if (annFilter === 'tab') refreshAnnPanel();
  focusStageOnRect(frame, options);
  return true;
}

/** True when keyboard shortcuts should yield to text entry. */
function isTypingTarget(el) {
  if (!el || !el.closest) return false;
  if (el.closest('input, textarea, select')) return true;
  var ce = el.closest('[contenteditable]');
  return !!(ce && ce.isContentEditable);
}

function wireSectionNavigator() {
  if (!sectionNavWrap || !sectionNavToggleBtn || !sectionNavList) return;
  sectionNavToggleBtn.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    setSectionNavigatorOpen(!sectionNavOpen);
  });
  sectionNavList.addEventListener('click', function (event) {
    var screenButton = event.target.closest('[data-nav-screen]');
    if (screenButton) {
      jumpSectionNavigatorToScreen(
        screenButton.getAttribute('data-nav-group'),
        screenButton.getAttribute('data-nav-screen')
      );
      return;
    }
    var sectionButton = event.target.closest('.wb-section-nav-section[data-nav-group]');
    if (sectionButton) jumpSectionNavigatorToGroup(sectionButton.getAttribute('data-nav-group'));
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && (sectionNavOpen || minimapOpen)) {
      var focusTarget = sectionNavOpen ? sectionNavToggleBtn : minimapToggleBtn;
      setSectionNavigatorOpen(false);
      setMinimapOpen(false);
      if (focusTarget) focusTarget.focus();
      return;
    }
    if (event.key.toLowerCase() !== 'm' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    setSectionNavigatorOpen(!sectionNavOpen);
  });
  window.addEventListener('resize', updateSectionNavigatorVisibility);
}

function nudgeCanvasZoom(factor) {
  var z = clampCanvasZoom(currentCanvasZoom() * factor);
  setCanvasZoom(String(z), { save: true });
}

function wireCanvasHud() {
  var out = document.getElementById('wbzoom-out');
  var inn = document.getElementById('wbzoom-in');
  var label = document.getElementById('wbzoom-label');
  var home = document.getElementById('wbrecenter');
  if (out) out.addEventListener('click', function () { nudgeCanvasZoom(1 / 1.1); });
  if (inn) inn.addEventListener('click', function () { nudgeCanvasZoom(1.1); });
  if (label) label.addEventListener('click', function () { setCanvasZoom('1', { save: true }); });
  if (home) home.addEventListener('click', recenterBoard);
  wireMinimap();
  wireSectionNavigator();
  syncZoomHud();
}

function loadFailHtml(msg) {
  return '<div class="wb-screen-err">' + escHtml(msg) + '</div>';
}

function screenErrorHtml(pageId, screenId, err) {
  return loadFailHtml('加载 ' + pageId + '/' + screenId + ' 失败 · ' + err);
}

function parseIncludeRef(ref) {
  var m = String(ref || '').trim().match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  return m ? { component: m[1], variant: m[2] } : null;
}

function fetchIncludeHtml(ref) {
  var parsed = parseIncludeRef(ref);
  if (!parsed) return Promise.resolve({ ok: false, err: 'bad ref' });
  if (includeCache[ref]) return Promise.resolve(includeCache[ref]);
  return fetch('components/' + parsed.component + '/' + parsed.variant + '.html')
    .then(function (r) {
      if (!r.ok) throw r.status;
      return r.text();
    })
    .then(function (html) {
      includeCache[ref] = { ok: true, html: html };
      return includeCache[ref];
    })
    .catch(function (e) {
      return { ok: false, err: e };
    });
}

/** Expand <div data-ios-include="comp/variant" data-text="…"> placeholders. */
function resolveIncludes(html) {
  var re = /<([a-zA-Z0-9]+)([^>]*?)\bdata-ios-include=(["'])([^"']+)\3([^>]*)>(?:\s*<\/\1>)?/gi;
  var refs = [];
  var m;
  while ((m = re.exec(html))) {
    if (refs.indexOf(m[4]) < 0) refs.push(m[4]);
  }
  if (!refs.length) return Promise.resolve(html);
  return Promise.all(refs.map(fetchIncludeHtml)).then(function () {
    return html.replace(re, function (full, tag, pre, q, ref, post) {
      var attrs = (pre || '') + (post || '');
      var fetched = includeCache[ref];
      if (!fetched || !fetched.ok) {
        return '<div class="wb-screen-err">include 失败 · ' + escHtml(ref) + '</div>';
      }
      var frag = fetched.html.trim();
      frag = applyIncludeSlots(frag, attrs);
      // Mark include root for annotate → component source routing
      if (/^<([a-zA-Z0-9]+)/.test(frag)) {
        frag = frag.replace(/^<([a-zA-Z0-9]+)/, '<$1 data-ios-from="' + ref + '"');
      }
      return frag;
    });
  });
}

function wrapFragmentForLibrary(html) {
  var t = (html || '').trim();
  if (!t) return '<div class="ios-app"><div class="ios-page"></div></div>';
  if (/\bios-app\b/.test(t) || /\bios-lockscreen\b/.test(t)) return t;
  return '<div class="ios-app" style="display:flex;flex-direction:column">' +
    '<div class="ios-page" style="flex:1;display:flex;flex-direction:column;gap:10px;justify-content:center">' +
    t +
    '</div></div>';
}

function docFrameHtml(url, title) {
  return '<iframe class="wb-doc-frame" src="' + escHtml(url) + '"' +
    ' title="' + escHtml(title || url) + '" loading="lazy"></iframe>';
}

function fetchScreenHtml(pageId, screen) {
  var sc = typeof screen === 'string' ? { id: screen } : screen;
  var url;
  if (sc.src) {
    url = sc.src;
  } else if (pageId === COMPONENTS_ID && String(sc.id).indexOf('/') >= 0) {
    url = 'components/' + sc.id + '.html';
  } else {
    url = 'previews/' + pageId + '/' + sc.id + '.html';
  }
  // doc shell 承载的是完整独立文档（有 <!doctype>/<head>/自己的 <style>），
  // 不能当 fragment 内联——它的 body 规则会失效、style 会漏进 workbench。
  // 交给 iframe，文档保持原样；标注由文档自己注入的 annotate.js 负责。
  if ((sc.shell || defaultShellForPage(pageId)) === 'doc') {
    return Promise.resolve({ ok: true, html: docFrameHtml(url, sc.title || sc.id) });
  }
  return fetch(url)
    .then(function (r) {
      if (!r.ok) throw r.status;
      return r.text();
    })
    .then(function (raw) {
      if (pageId !== COMPONENTS_ID) {
        raw = validateScreenFragment(raw, 'screen(' + pageId + '/' + sc.id + ')', {
          shell: sc.shell || defaultShellForPage(pageId)
        });
      }
      return resolveIncludes(raw).then(function (html) {
        if (pageId === COMPONENTS_ID) html = wrapFragmentForLibrary(html);
        return { ok: true, html: html };
      });
    })
    .catch(function (e) { return { ok: false, err: e }; });
}

/** True if the fragment already includes phone chrome (legacy full-shell files). */
function looksPhoneWrapped(html) {
  return /\bios-stage\b/.test(html) || /\bios-device\b/.test(html);
}

/**
 * Wrap screen body in shared phone chrome.
 * Agent writes only in-screen content; loader owns stage/device/bezel/statusbar/home.
 * shell: "app" (default) | "lock"
 */
function wrapPhoneShell(bodyHtml, shell) {
  if (looksPhoneWrapped(bodyHtml)) return bodyHtml;
  var screenClass = shell === 'lock' ? 'ios-screen ios-lock' : 'ios-screen';
  return (
    '<div class="ios-stage">' +
      '<div class="ios-root screen-only" data-device="iphone-16-pro" data-theme="light">' +
        '<div class="ios-device">' +
          '<span class="ios-key act"></span><span class="ios-key vup"></span>' +
          '<span class="ios-key vdn"></span><span class="ios-key pwr"></span>' +
          '<div class="ios-bezel"><div class="' + screenClass + '">' +
            '<div class="ios-island"></div>' +
            '<div class="ios-statusbar"><span class="ios-sb-time"></span><span class="ios-sb-icons"></span></div>' +
            bodyHtml +
            '<div class="ios-home"></div>' +
          '</div></div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

/** Component Library: light board, no phone chrome. Still uses .ios-root for tokens/theme. */
function wrapCompStage(bodyHtml) {
  if (looksPhoneWrapped(bodyHtml)) return bodyHtml;
  return (
    '<div class="wb-comp-stage">' +
      '<div class="ios-root" data-theme="light">' +
        bodyHtml +
      '</div>' +
    '</div>'
  );
}

/** Web board: desktop/report artboard without phone chrome. */
function wrapHtmlShell(bodyHtml) {
  if (/\bwb-html-stage\b/.test(bodyHtml)) return bodyHtml;
  return (
    '<div class="wb-html-stage" data-ann-frame>' +
      '<div class="wb-html-surface" data-ann-surface data-preview-mount>' +
        bodyHtml +
      '</div>' +
    '</div>'
  );
}

/** HTML board: a standalone document artboard (iframe inside). */
function wrapDocShell(bodyHtml) {
  if (/\bwb-doc-stage\b/.test(bodyHtml)) return bodyHtml;
  return (
    '<div class="wb-doc-stage" data-ann-frame>' +
      '<div class="wb-doc-surface" data-preview-mount>' +
        bodyHtml +
      '</div>' +
    '</div>'
  );
}

function wrapScreenShell(pageId, bodyHtml, shell) {
  if (pageId === COMPONENTS_ID) return wrapCompStage(bodyHtml);
  if (shell === 'doc' || modeForPage(pageId) === 'html') return wrapDocShell(bodyHtml);
  if (shell === 'web' || modeForPage(pageId) === 'web') return wrapHtmlShell(bodyHtml);
  return wrapPhoneShell(bodyHtml, shell);
}

function screenClassForShell(pageId, shell) {
  if (pageId === COMPONENTS_ID) return 'wb-screen wb-screen--comp';
  if (shell === 'doc' || modeForPage(pageId) === 'html') return 'wb-screen wb-screen--doc';
  if (shell === 'web' || modeForPage(pageId) === 'web') return 'wb-screen wb-screen--web';
  return 'wb-screen';
}

function buildBoardHtml(pageId, board, screenMap) {
  var isCompLib = pageId === COMPONENTS_ID;
  var sections = board.sections || [];
  if (!sections.length || (sections.length === 1 && sections[0].id === '_empty')) {
    var emptyTitle = isCompLib ? '暂无组件' : '暂无屏幕';
    var emptyHelp = isCompLib
      ? '在 components/ 下添加 meta.json + variant HTML，刷新后会出现在此页。'
      : '在这个页面的 board.json sections[] 中添加 screen。';
    return '<div class="wb-zoom-wrap"><div class="wb-library">' +
      '<article class="wb-lib-item" id="lib-_empty" data-ann-section="_empty" data-ann-section-label="' + emptyTitle + '" data-ann-group="_empty" data-ann-group-label="' + emptyTitle + '">' +
      '<h2 class="wb-lib-cap">' + emptyTitle + '</h2>' +
      '<p class="wb-muted" style="color:var(--wb-muted);font-size:13px;max-width:420px">' + emptyHelp + '</p>' +
      '</article></div></div>';
  }
  var parts = sections.map(function (sec) {
    var layout = sec.layout === 'row' ? 'row' : 'column';
    var screens = sec.screens || [];
    var body = screens.map(function (sc) {
      var key = sc.id;
      var fetched = screenMap[key];
      var inner;
      if (fetched && fetched.ok) {
        inner = wrapScreenShell(pageId, fetched.html, sc.shell);
      } else {
        inner = screenErrorHtml(pageId, sc.id, fetched ? fetched.err : 'missing');
      }
      var screenCls = screenClassForShell(pageId, sc.shell);
      var note = sc.note || '';
      var noteHtml = '';
      if (!isCompLib) {
        noteHtml = '<div class="wb-frame-note' + (note ? '' : ' is-empty') + '" data-frame-note data-ann-ui>' +
          '<div class="wb-frame-note-view" data-frame-note-view>' +
            '<div class="wb-frame-note-text' + (note ? '' : ' wb-frame-note-placeholder') + '" data-frame-note-text>' +
              escHtml(note || '添加这一步的场景、交互或能力说明。') +
            '</div>' +
            '<button type="button" class="wb-frame-note-edit" data-frame-note-action="edit">' + (note ? '编辑' : '＋ Frame Note') + '</button>' +
          '</div>' +
          '<div class="wb-frame-note-editor" data-frame-note-editor hidden>' +
            '<textarea class="wb-frame-note-input" data-frame-note-input maxlength="12000" aria-label="Frame Note"></textarea>' +
            '<div class="wb-frame-note-footer">' +
              '<span class="wb-frame-note-status" data-frame-note-status></span>' +
              '<button type="button" class="wb-frame-note-action" data-frame-note-action="cancel">取消</button>' +
              '<button type="button" class="wb-frame-note-action" data-frame-note-action="save">保存</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }
      return '<div class="' + screenCls + '" data-screen="' + escHtml(sc.id) + '">' +
        '<div class="wb-screen-cap' + (sc.title ? '' : ' wb-screen-cap--empty') + '">' + escHtml(sc.title || '') + '</div>' +
        inner +
        noteHtml +
        '</div>';
    }).join('');
    return '<article class="wb-lib-item" id="lib-' + escHtml(sec.id) + '"' +
      ' data-ann-section="' + escHtml(sec.id) + '"' +
      ' data-ann-section-label="' + escHtml(sec.title || sec.id) + '"' +
      ' data-ann-group="' + escHtml(sec.id) + '"' +
      ' data-ann-group-label="' + escHtml(sec.title || sec.id) + '">' +
      '<h2 class="wb-lib-cap">' + escHtml(sec.title || sec.id) + '</h2>' +
      '<div class="wb-sec-body wb-sec-' + layout + '">' + body + '</div>' +
      '</article>';
  });
  return '<div class="wb-zoom-wrap"><div class="wb-library">' + parts.join('') + '</div></div>';
}

function boardUrl(pageId) {
  if (pageId === COMPONENTS_ID) return 'components/board.json';
  return 'previews/' + pageId + '/board.json';
}

function loadBoard(panel, pageId) {
  var gen = ++boardLoadGen;
  return fetch(boardUrl(pageId))
    .then(function (r) {
      if (!r.ok) throw r.status;
      return r.json();
    })
    .then(function (board) {
      if (gen !== boardLoadGen) return null;
      board = validateBoard(board, {
        pageId: pageId,
        allowComponentRefs: pageId === COMPONENTS_ID,
        defaultShell: defaultShellForPage(pageId)
      });
      var entries = [];
      var seen = {};
      (board.sections || []).forEach(function (sec) {
        (sec.screens || []).forEach(function (entry) {
          var sc = entry;
          if (!seen[sc.id]) { seen[sc.id] = true; entries.push(sc); }
        });
      });
      return Promise.all(entries.map(function (sc) {
        return fetchScreenHtml(pageId, sc).then(function (res) {
          return { id: sc.id, res: res };
        });
      })).then(function (rows) {
        if (gen !== boardLoadGen) return null;
        var screenMap = {};
        rows.forEach(function (row) { screenMap[row.id] = row.res; });
        var session = mountManager.begin(pageId);
        panel.innerHTML = buildBoardHtml(pageId, board, screenMap);
        activeBoard = { pageId: pageId, board: board };
        renderDocVersions();
        watchDocAnnotate();
        return afterMount(panel, session);
      });
    })
    .catch(function (e) {
      if (gen !== boardLoadGen) return null;
      mountManager.cancel();
      boardNavigationModel = null;
      setSectionNavigatorOpen(false);
      setMinimapOpen(false);
      if (sectionNavWrap) sectionNavWrap.hidden = true;
      if (minimapWrap) minimapWrap.hidden = true;
      var label = e instanceof ContractError ? '契约错误' : '加载失败';
      panel.innerHTML = loadFailHtml(
        label + ' · ' + boardUrl(pageId) + ' · ' + String(e && e.message ? e.message : e)
      );
    });
}

function syncPagesNav(pageId) {
  if (!pagesNav) return;
  pagesNav.querySelectorAll('.wb-page').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-vpage') === pageId);
  });
}

function copyPageIndicator(pageId, btn) {
  var text = '@page:' + String(pageId || '').trim();
  if (!pageId) return;
  var done = function () {
    if (!btn) return;
    btn.classList.add('ok');
    btn.title = 'Copied ' + text;
    setTimeout(function () {
      btn.classList.remove('ok');
      btn.title = 'Copy ' + text;
    }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { /* ignore */ });
    return;
  }
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (document.execCommand('copy')) done();
  } catch (e) { /* ignore */ }
  ta.remove();
}

function ensurePageCopyButtons() {
  if (!pagesNav) return;
  pagesNav.querySelectorAll('.wb-page[data-vpage]').forEach(function (b) {
    if (b.parentElement && b.parentElement.classList.contains('wb-page-row')) return;
    var id = b.getAttribute('data-vpage');
    if (!id) return;
    var row = document.createElement('div');
    row.className = 'wb-page-row';
    if (b.getAttribute('data-page-system') === '1') row.setAttribute('data-page-system', '1');
    b.parentNode.insertBefore(row, b);
    row.appendChild(b);
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'wb-page-copy';
    copy.setAttribute('data-copy-page', id);
    copy.setAttribute('aria-label', 'Copy @page:' + id);
    copy.title = 'Copy @page:' + id;
    copy.textContent = '🔗';
    copy.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      copyPageIndicator(id, copy);
    });
    row.appendChild(copy);
  });
}

function normalizeBoardMode(mode) {
  return BOARD_MODES[mode] ? mode : 'ios';
}

function modeForPage(pageId) {
  if (pageId === COMPONENTS_ID) return 'ios';
  if (!pageManifest || !pageManifest.pages) return 'ios';
  for (var i = 0; i < pageManifest.pages.length; i++) {
    if (pageManifest.pages[i].id === pageId) return pageManifest.pages[i].mode || 'ios';
  }
  return 'ios';
}

function defaultShellForPage(pageId) {
  var mode = modeForPage(pageId);
  if (mode === 'web') return 'web';
  if (mode === 'html') return 'doc';
  return 'app';
}

function pagesForMode(mode) {
  mode = normalizeBoardMode(mode);
  if (!pageManifest || !pageManifest.pages) return [];
  return pageManifest.pages.filter(function (page) {
    return (page.mode || 'ios') === mode;
  });
}

function defaultPageForMode(mode) {
  mode = normalizeBoardMode(mode);
  var pages = pagesForMode(mode);
  if (!pages.length) {
    if (mode === 'web') return WEB_LIB_ID;
    if (mode === 'html') return DOC_LIB_ID;
    return LIB_ID;
  }
  if (pageManifest && pageManifest.defaultPage) {
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].id === pageManifest.defaultPage) return pages[i].id;
    }
  }
  return pages[0].id;
}

function readActivePageByMode() {
  var raw = readPrefs().activePageIdByMode;
  return raw && typeof raw === 'object' ? raw : {};
}

function rememberActivePageForMode(mode, pageId) {
  mode = normalizeBoardMode(mode);
  if (!pageId) return;
  var map = Object.assign({}, readActivePageByMode());
  map[mode] = pageId;
  savePrefs({ activePageIdByMode: map, activePageId: pageId, boardMode: mode });
}

function resolvePageForMode(mode, preferredId) {
  mode = normalizeBoardMode(mode);
  var pages = pagesForMode(mode);
  var ids = {};
  pages.forEach(function (page) { ids[page.id] = true; });
  if (mode === 'ios') ids[COMPONENTS_ID] = true;
  if (preferredId && ids[preferredId]) return preferredId;
  var remembered = readActivePageByMode()[mode];
  if (remembered && ids[remembered]) return remembered;
  if (mode === 'ios' && ids[LIB_ID]) return LIB_ID;
  return defaultPageForMode(mode);
}

/* ---- HTML board: one document, full viewport, sidebar switches versions ----
   汇报页要在读者真实的窗口尺寸下读，所以不画布化：文档 1:1 铺满 stage，
   同一页里的多个版本不并排摆，改从侧栏切。 */
var docVersionsNav = document.getElementById('wbdoc-versions');

function docScreensOfActiveBoard() {
  if (!activeBoard || modeForPage(activeBoard.pageId) !== 'html') return [];
  var out = [];
  (activeBoard.board.sections || []).forEach(function (sec) {
    (sec.screens || []).forEach(function (sc) {
      out.push({ id: sc.id, title: sc.title || sc.id, section: sec.title || sec.id });
    });
  });
  return out;
}

function setActiveDoc(screenId, options) {
  options = options || {};
  if (!boardPanel) return;
  var screens = docScreensOfActiveBoard();
  if (!screens.length) return;
  var ids = screens.map(function (sc) { return sc.id; });
  if (ids.indexOf(screenId) < 0) screenId = ids[0];
  if (activeBoard) activeDocByPage[activeBoard.pageId] = screenId;

  boardPanel.querySelectorAll('.wb-screen[data-screen]').forEach(function (node) {
    var on = node.getAttribute('data-screen') === screenId;
    node.toggleAttribute('data-doc-hidden', !on);
    // section 容器只在它一个 screen 都不显示时才收起
    var item = node.closest('.wb-lib-item');
    if (item) {
      var anyVisible = !!item.querySelector('.wb-screen[data-screen]:not([data-doc-hidden])');
      item.toggleAttribute('data-doc-hidden', !anyVisible);
    }
  });
  if (docVersionsNav) {
    docVersionsNav.querySelectorAll('[data-doc-screen]').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-doc-screen') === screenId);
    });
  }
  if (options.scrollTop !== false && stage) stage.scrollTop = 0;
  watchDocAnnotate();   // 换了 iframe，重新绑定并刷新侧栏
}

function renderDocVersions() {
  if (!docVersionsNav) return;
  var screens = docScreensOfActiveBoard();
  docVersionsNav.innerHTML = '';
  if (boardMode !== 'html' || !screens.length) {
    docVersionsNav.hidden = true;
    return;
  }
  docVersionsNav.hidden = false;
  var head = document.createElement('div');
  head.className = 'wb-doc-ver-head';
  var headLabel = document.createElement('span');
  headLabel.textContent = screens.length > 1 ? 'Versions' : 'Document';
  head.appendChild(headLabel);
  var exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'wb-doc-export';
  exportBtn.setAttribute('data-doc-export', '');
  exportBtn.title = '导出当前文档';
  exportBtn.textContent = '导出';
  head.appendChild(exportBtn);
  docVersionsNav.appendChild(head);
  var lastSection = null;
  screens.forEach(function (sc) {
    if (screens.length > 1 && sc.section && sc.section !== lastSection) {
      lastSection = sc.section;
      var cap = document.createElement('div');
      cap.className = 'wb-doc-ver-sec';
      cap.textContent = sc.section;
      docVersionsNav.appendChild(cap);
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wb-doc-ver';
    btn.setAttribute('data-doc-screen', sc.id);
    btn.textContent = sc.title;
    docVersionsNav.appendChild(btn);
  });
  var remembered = activeBoard ? activeDocByPage[activeBoard.pageId] : null;
  setActiveDoc(remembered || screens[0].id, { scrollTop: false });
}

if (docVersionsNav) {
  docVersionsNav.addEventListener('click', function (e) {
    if (e.target.closest('[data-doc-export]')) {
      openDocExportDialog();
      return;
    }
    var btn = e.target.closest('[data-doc-screen]');
    if (btn) setActiveDoc(btn.getAttribute('data-doc-screen'));
  });
}

function syncBoardModeUi(mode) {
  mode = normalizeBoardMode(mode);
  if (!boardModeBox) return;
  boardModeBox.querySelectorAll('[data-board-mode]').forEach(function (btn) {
    var on = btn.getAttribute('data-board-mode') === mode;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if (wbRoot) wbRoot.setAttribute('data-board-mode', mode);
}

function renderPageManifest(manifest) {
  if (!pagesNav) return;
  pageManifest = manifest;
  pagesNav.querySelectorAll('.wb-page-row, .wb-page, .wb-page-error').forEach(function (node) {
    node.remove();
  });
  if (boardMode === 'ios') {
    var components = document.createElement('button');
    components.type = 'button';
    components.className = 'wb-page';
    components.setAttribute('data-vpage', COMPONENTS_ID);
    components.setAttribute('data-page-system', '1');
    components.setAttribute('data-page-default', 'Component Library');
    components.textContent = 'Component Library';
    pagesNav.appendChild(components);
  }
  pagesForMode(boardMode).forEach(function (page) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-page';
    button.setAttribute('data-vpage', page.id);
    button.setAttribute('data-page-default', page.title);
    button.setAttribute('data-page-mode', page.mode || 'ios');
    button.textContent = page.title;
    pagesNav.appendChild(button);
  });
  ensurePageCopyButtons();
  applyPageNames(readPrefs().pageNames);
  syncBoardModeUi(boardMode);
  syncPagesNav(activePageId);
}

function setBoardMode(mode, options) {
  options = options || {};
  mode = normalizeBoardMode(mode);
  var prevMode = boardMode;
  if (prevMode !== mode && mountManager.current && mountManager.current.active && mountManager.current.pageId === activePageId) {
    snapshotPageViewport(activePageId);
  }
  boardMode = mode;
  syncBoardModeUi(mode);
  if (mode !== 'html') stopGutter();   // 离开 HTML 板：父级 gutter 不再适用
  // 画布缩放对文档没有意义——报告必须按读者真实窗口尺寸渲染
  if (mode === 'html') setCanvasZoom('1', { save: false });
  if (docVersionsNav && mode !== 'html') { docVersionsNav.hidden = true; docVersionsNav.innerHTML = ''; }
  if (pageManifest) renderPageManifest(pageManifest);
  var nextPageId = resolvePageForMode(mode, options.pageId);
  rememberActivePageForMode(mode, nextPageId);
  if (options.save !== false) savePrefs({ boardMode: mode });
  return setActivePage(nextPageId, { force: options.force === true, save: options.save !== false });
}

function showPageManifestError(error) {
  if (!pagesNav) return;
  var message = document.createElement('p');
  message.className = 'wb-page-error';
  message.style.cssText = 'margin:6px 10px;color:var(--wb-danger,#c0392b);font-size:12px;line-height:1.35';
  message.textContent = '页面清单错误 · ' + String(error && error.message ? error.message : error);
  pagesNav.appendChild(message);
}

function loadPageManifest() {
  // previews/_index.local.json (gitignored) overrides the tracked manifest, so
  // an instance can keep private pages without touching versioned files. Only
  // a missing local file falls back — a broken one must surface as an error.
  return fetch('previews/_index.local.json')
    .then(function (response) {
      if (response.ok) return response.json();
      if (response.status !== 404) throw new Error(String(response.status));
      return fetch('previews/_index.json').then(function (tracked) {
        if (!tracked.ok) throw new Error(String(tracked.status));
        return tracked.json();
      });
    })
    .then(function (raw) {
      pageManifest = validatePageManifest(raw);
      renderPageManifest(pageManifest);
      return pageManifest;
    });
}

function setActivePage(pageId, options) {
  options = options || {};
  if (!boardPanel) return Promise.resolve();
  var same = activePageId === pageId;
  var _draftAnn = annotateApi();
  if (!same && _draftAnn && typeof _draftAnn.cancelDraft === 'function') {
    _draftAnn.cancelDraft();
  }
  if (!same && mountManager.current && mountManager.current.active && mountManager.current.pageId === activePageId) {
    snapshotPageViewport(activePageId);
  }
  activePageId = pageId;
  var nextMode = modeForPage(pageId);
  if (nextMode !== boardMode) {
    boardMode = nextMode;
    if (pageManifest) renderPageManifest(pageManifest);
  } else {
    boardMode = nextMode;
    syncBoardModeUi(boardMode);
    syncPagesNav(pageId);
  }
  if (options.save !== false) rememberActivePageForMode(boardMode, pageId);
  if (same && !options.force) {
    // Re-clicking the active page must not fight per-page viewport memory.
    if (options.scrollTop === true) stage.scrollTo({ top: 0, behavior: 'smooth' });
    return Promise.resolve();
  }
  // Includes resolve to shared component files (page-independent); keep the
  // cache across page switches — only a component change busts it (see HMR).
  return loadBoard(boardPanel, pageId).then(function () {
    // Viewport restore happens in afterMount; do not reset to origin here.
  });
}

function showTabs() {
  settingsEl.hidden = true;
  if (sideScroll) sideScroll.hidden = false;
  if (footEl) footEl.hidden = false;
  gearBtn.classList.remove('on');
}

function showSettings() {
  if (sideScroll) sideScroll.hidden = true;
  if (footEl) footEl.hidden = true;
  settingsEl.hidden = false;
  gearBtn.classList.add('on');
}

function wireCtl(root, id, attr, onPick) {
  var box = (root || document).querySelector('#' + id);
  if (!box || box.getAttribute('data-wired')) return;
  box.setAttribute('data-wired', '1');
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    onPick(b.getAttribute('data-' + attr), b, box);
  });
}

function wirePref(root, id, attr, setter) {
  wireCtl(root, id, attr, function (val) { setter(val, { save: true }); });
}

function wireSettings() {
  wirePref(settingsEl, 'textsize', 'text-size', setTextSize);
  wirePref(settingsEl, 'frame', 'frame', setFrame);
  wirePref(settingsEl, 'zoom', 'canvas-zoom', setCanvasZoom);
  wireCtl(settingsEl, 'lockfont', 'lock-font', function (val) {
    applyLockFont(val);
    savePrefs({ lockFont: val });
  });
  wireCtl(settingsEl, 'clockmode', 'clock-mode', function (mode) {
    var fixed = iosTimeFromInput(settingsEl.querySelector('#clockfixed').value);
    applyClock(mode, fixed);
    savePrefs({ clockMode: mode, clockFixed: fixed });
  });

  var clockfixed = settingsEl.querySelector('#clockfixed');
  if (clockfixed && !clockfixed.getAttribute('data-wired')) {
    clockfixed.setAttribute('data-wired', '1');
    clockfixed.addEventListener('change', function () {
      var fixed = iosTimeFromInput(clockfixed.value);
      applyClock('fixed', fixed);
      savePrefs({ clockMode: 'fixed', clockFixed: fixed });
    });
  }
}

var settingsReady;
function loadSettings() {
  if (settingsReady) return settingsReady;
  settingsReady = fetch('workbench/settings.html')
    .then(function (r) { if (!r.ok) throw r.status; return r.text(); })
    .then(function (html) {
      settingsEl.innerHTML = html;
      wireSettings();
      restorePrefs();
    })
    .catch(function (e) {
      settingsEl.innerHTML = loadFailHtml('加载设置失败 · ' + e);
    });
  return settingsReady;
}

function initBoard() {
  boardPanel = document.createElement('section');
  boardPanel.id = 'wb-board-panel';
  boardPanel.className = 'wb-panel wb-library-panel';
  stage.appendChild(boardPanel);
  wireFrameNoteEditors(boardPanel);
  return loadPageManifest()
    .then(function () {
      return setActivePage(resolveBootPageId(readPrefs()), { force: true, scrollTop: false, save: false });
    })
    .catch(function (error) {
      showPageManifestError(error);
      ensurePageCopyButtons();
      return setActivePage(COMPONENTS_ID, { force: true, scrollTop: false, save: false });
    });
}

if (pagesNav) {
  pagesNav.addEventListener('click', function (e) {
    var b = e.target.closest('.wb-page');
    if (!b || b.classList.contains('renaming')) return;
    showTabs();
    var id = b.getAttribute('data-vpage');
    if (!id) return;
    setActivePage(id);
  });

  pagesNav.addEventListener('dblclick', function (e) {
    var b = e.target.closest('.wb-page');
    if (!b || b.classList.contains('renaming')) return;
    if (b.getAttribute('data-page-system') === '1') return;
    e.preventDefault();
    startPageRename(b);
  });
}

function applyPageNames(names) {
  if (!pagesNav || !names) return;
  pagesNav.querySelectorAll('.wb-page[data-vpage]').forEach(function (b) {
    if (b.getAttribute('data-page-system') === '1') return;
    var id = b.getAttribute('data-vpage');
    var name = names[id];
    if (typeof name === 'string' && name.trim()) b.textContent = name.trim();
  });
}

function startPageRename(btn) {
  if (!btn || btn.classList.contains('renaming')) return;
  if (btn.getAttribute('data-page-system') === '1') return;
  var id = btn.getAttribute('data-vpage');
  var prev = btn.textContent.trim();
  var fallback = btn.getAttribute('data-page-default') || prev;
  btn.classList.add('renaming');
  btn.innerHTML = '';
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'wb-page-rename';
  input.value = prev;
  input.setAttribute('aria-label', '重命名页面');
  btn.appendChild(input);

  var done = false;
  function finish(commit) {
    if (done) return;
    done = true;
    var next = input.value.trim();
    if (!commit || !next) next = prev || fallback;
    btn.classList.remove('renaming');
    btn.textContent = next;
    if (id) {
      var names = Object.assign({}, readPrefs().pageNames || {});
      if (next === fallback) delete names[id];
      else names[id] = next;
      savePrefs({ pageNames: names });
    }
  }

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', function () { finish(true); });
  input.focus();
  input.select();
}

wireSections();
initBoard();
wireCanvasHud();

window.workbench = {
  switchPage: switchPage,
  setActivePage: setActivePage,
  setBoardMode: setBoardMode,
  focusFrame: focusWorkbenchFrame,
  activePageId: function () { return activePageId; },
  boardMode: function () { return boardMode; },
  exportSnapshot: buildExportSnapshot,
  exportImage: requestExportImage,
  exportDoc: requestDocExport,
  activeDocExportTarget: activeDocExportTarget
};

if (boardModeBox) {
  boardModeBox.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-board-mode]');
    if (!btn || !boardModeBox.contains(btn)) return;
    var mode = btn.getAttribute('data-board-mode');
    if (!mode || mode === boardMode) return;
    setBoardMode(mode);
  });
}
pollAnnotate();

gearBtn.addEventListener('click', function () {
  loadSettings().then(showSettings);
});

wirePref(document, 'wbtheme', 'theme', setTheme);

settingsEl.addEventListener('click', function (e) {
  if (e.target.closest('[data-wb-back]')) showTabs();
});

if (splitEl) {
  var dragging = false;
  var startX = 0;
  var startW = 0;
  var splitRaf = 0;
  var dragMoved = false;
  var suppressSplitClick = false;

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('wb-resizing');
    splitEl.classList.remove('on');
    if (dragMoved) {
      savePrefs({ sideWidth: sideW, sideCollapsed: false });
      suppressSplitClick = true;
      setTimeout(function () { suppressSplitClick = false; }, 0);
    }
    refit();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', endDrag);
  }

  function onMove(e) {
    if (!dragging) return;
    var dx = e.clientX - startX;
    if (!dragMoved && Math.abs(dx) < 3) return;
    if (!dragMoved) {
      dragMoved = true;
      if (sideCollapsed) setSideCollapsed(false, { save: false, refit: false });
    }
    applySideWidth(startW + dx);
    if (splitRaf) return;
    splitRaf = requestAnimationFrame(function () {
      splitRaf = 0;
      var _a = annotateApi(); if (_a) _a.render();
    });
  }

  splitEl.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    dragMoved = false;
    startX = e.clientX;
    startW = sideCollapsed ? 0 : sideW;
    document.body.classList.add('wb-resizing');
    splitEl.classList.add('on');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', endDrag);
  });

  splitEl.addEventListener('click', function (e) {
    if (suppressSplitClick || dragMoved) return;
    if (sideCollapsed) {
      e.preventDefault();
      setSideCollapsed(false, { save: true });
    }
  });

  splitEl.addEventListener('dblclick', function (e) {
    e.preventDefault();
    // Expanded: double-click collapses. Collapsed: single click already expands.
    if (!sideCollapsed) setSideCollapsed(true, { save: true });
  });

  splitEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSideCollapsed({ save: true });
      return;
    }
    var step = e.shiftKey ? 40 : 16;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (sideCollapsed) return;
      applySideWidth(sideW - step);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (sideCollapsed) {
        setSideCollapsed(false, { save: false, refit: false });
      }
      applySideWidth(sideW + step);
    } else return;
    savePrefs({ sideWidth: sideW, sideCollapsed: false });
    refit();
  });
}

if (sideToggleBtn) {
  sideToggleBtn.addEventListener('click', function () {
    toggleSideCollapsed({ save: true });
  });
}
if (sideExpandBtn) {
  sideExpandBtn.addEventListener('click', function () {
    setSideCollapsed(false, { save: true });
  });
}

stage.addEventListener('wheel', function (e) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  var oldZ = currentCanvasZoom();
  var next = clampCanvasZoom(oldZ * (e.deltaY > 0 ? 0.92 : 1.08));
  if (next === oldZ) return;
  // Scale is on .wb-library (origin 0 0); board pad around it does not scale.
  // Anchor scroll to the wrap's top-left in scroll space, not the stage origin.
  var rect = stage.getBoundingClientRect();
  var mx = e.clientX - rect.left;
  var my = e.clientY - rect.top;
  var wrap = document.querySelector('#wb-board-panel .wb-zoom-wrap');
  var originX = 0;
  var originY = 0;
  if (wrap) {
    var wr = wrap.getBoundingClientRect();
    originX = stage.scrollLeft + (wr.left - rect.left);
    originY = stage.scrollTop + (wr.top - rect.top);
  }
  var localX = stage.scrollLeft + mx - originX;
  var localY = stage.scrollTop + my - originY;
  var ratio = next / oldZ;
  setCanvasZoom(String(next), { save: true });
  stage.scrollLeft = originX + localX * ratio - mx;
  stage.scrollTop = originY + localY * ratio - my;
}, { passive: false });

(function wireStagePan() {
  var pan = null;
  var suppressClick = false;
  var spaceDown = false;

  function annotateBlocksPan() {
    var ann = annotateApi();
    if (!ann || typeof ann.getState !== 'function') return false;
    var st = ann.getState();
    return !!(st.mode && !st.paused);
  }

  function syncSpaceCursor() {
    // Keep grab cursor through the pre-move threshold; drop once panning starts.
    stage.classList.toggle('wb-space-pan', spaceDown && !(pan && pan.moved));
  }

  function endPan() {
    if (!pan) return;
    var moved = pan.moved;
    pan = null;
    stage.classList.remove('wb-panning');
    document.body.classList.remove('wb-panning');
    document.removeEventListener('mousemove', onPanMove);
    document.removeEventListener('mouseup', endPan);
    syncSpaceCursor();
    if (moved) {
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
    }
  }

  function onPanMove(e) {
    if (!pan) return;
    var dx = e.clientX - pan.x;
    var dy = e.clientY - pan.y;
    if (!pan.moved && (dx * dx + dy * dy) < 16) return;
    if (!pan.moved) {
      pan.moved = true;
      stage.classList.add('wb-panning');
      document.body.classList.add('wb-panning');
      syncSpaceCursor();
    }
    e.preventDefault();
    stage.scrollLeft = pan.sl - dx;
    stage.scrollTop = pan.st - dy;
  }

  function startPan(e) {
    pan = {
      x: e.clientX,
      y: e.clientY,
      sl: stage.scrollLeft,
      st: stage.scrollTop,
      moved: false
    };
    syncSpaceCursor();
    document.addEventListener('mousemove', onPanMove);
    document.addEventListener('mouseup', endPan);
  }

  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    // Block Space page-scroll on every keydown, including key-repeat while held for pan.
    e.preventDefault();
    if (e.repeat) return;
    spaceDown = true;
    syncSpaceCursor();
  }, true);

  document.addEventListener('keyup', function (e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    // Always clear pan-arming; only skip preventDefault when typing.
    if (!isTypingTarget(e.target)) e.preventDefault();
    spaceDown = false;
    syncSpaceCursor();
  }, true);

  window.addEventListener('blur', function () {
    spaceDown = false;
    syncSpaceCursor();
  });

  stage.addEventListener('mousedown', function (e) {
    if (annotateBlocksPan()) return;
    if (e.target.closest('[data-ann-ui]') || isTypingTarget(e.target)) return;

    // Middle button always pans.
    if (e.button === 1) {
      e.preventDefault();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;

    // Space+drag pans anywhere (including inside frames).
    if (spaceDown) {
      e.preventDefault();
      startPan(e);
      return;
    }

    // Without Space: only pan on empty board chrome, never steal frame interactions.
    if (e.target.closest('.ios-stage, .wb-comp-stage, .wb-html-stage, .wb-screen-err, button, a')) return;
    startPan(e);
  });

  // Avoid browser autoscroll / middle-click paste while middle-panning.
  stage.addEventListener('auxclick', function (e) {
    if (e.button === 1) e.preventDefault();
  });

  stage.addEventListener('click', function (e) {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
  }, true);
})();

if (import.meta.hot) {
  import.meta.hot.on('preview:update', function (data) {
    if (!boardPanel) return;
    var id = (data && data.id) || activePageId;
    // Includes reference shared component files; only a component change can
    // stale them. A page-screen-only change keeps the include cache warm.
    var componentChange = id === COMPONENTS_ID || (data && data.alsoActive);
    if (componentChange) includeCache = {};
    if (id === activePageId) {
      snapshotPageViewport(activePageId);
      loadBoard(boardPanel, activePageId);
      return;
    }
    // Component change while viewing a flow — reload active page so includes refresh
    if (data && data.alsoActive && activePageId !== COMPONENTS_ID) {
      snapshotPageViewport(activePageId);
      loadBoard(boardPanel, activePageId);
    }
  });
}

(function init() {
  var prefs = readPrefs();
  applyBootPrefs(prefs, { pageId: prefs.activePageId || LIB_ID, refit: false });
})();

if (stage) {
  stage.addEventListener('scroll', scheduleViewportScrollSave, { passive: true });
}
