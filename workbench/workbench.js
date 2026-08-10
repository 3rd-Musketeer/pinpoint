// Workbench shell — pages, board loader, settings, preview hot-reload (Vite dev).
import { bubbleInnerHtml } from '../lib/annotate-bubble.js';
import { annRowModel } from '../lib/ann-row.js';
import { GUTTER_BUBBLE_W, GUTTER_MARGIN, GUTTER_W, packGutter } from './lib/annotate-bubble-layout.js';
import { BoardMountManager } from './lib/board-mount-session.js';
import { closestBoardSection } from './lib/board-navigation.js';
import {
  ContractError,
  validateBoard,
  validatePageManifest
} from './lib/preview-contracts.js';
import { wbGet, wbSet } from './app/store.js';
import { escHtml } from './lib/esc-html.js';
import { COMPONENTS_ID, defaultShellForPage, modeForPage, pageBaseUrl } from './lib/page-url.js';
import {
  activeDocExportTarget,
  buildExportSnapshot,
  openDocExportDialog,
  requestDocExport,
  requestExportImage
} from './export-core.js';
import { readPrefs, savePrefs, replacePrefs } from './lib/prefs.js';
import { readPageViewports, pageViewport, savePageViewport } from './lib/page-viewports.js';
import { clampCanvasZoom, currentCanvasZoom } from './lib/canvas-zoom.js';
import {
  currentBoardNavigationModel,
  focusWorkbenchFrame,
  isTypingTarget,
  refreshBoardNavigationModel,
  resetBoardNavOnLoadFailure,
  scheduleMinimapUpdate,
  setMinimapOpen,
  syncZoomHud,
  updateMinimapAvailability,
  updateSectionNavigatorActive,
  updateSectionNavigatorVisibility,
  wireCanvasHud
} from './board-nav.js';
import { buildBoardHtml, clearIncludeCache, fetchScreenHtml, loadFailHtml } from './screen-load.js';
import { afterMount, initPreviewMount } from './preview-mount.js';

var LIB_ID = 'library';
var WEB_LIB_ID = 'web-library';
var DOC_LIB_ID = 'doc-library';
var SYSTEM_PAGES = { components: true };
// ios = 手机原型（fragment + 机身 chrome）
// web = web app 画板（fragment，无机身）
// html = 完整独立 HTML 文档（汇报页一类），iframe 承载，见 shell "doc"
var BOARD_MODES = { ios: true, web: true, html: true };
// activePageId / boardMode / pageManifest / activeBoard / activeGroup 归 app/store.js（wbGet/wbSet 读写）
wbSet({ activePageId: LIB_ID });
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
var sectionOpen = { pages: true, annotations: true };
var annFilter = 'all';
var annListSig = '';          // last rendered list signature (skip rebuilds when unchanged)
var annPanelRaf = 0;          // rAF debounce token for refreshAnnPanel
var SIDE_W_MIN = 200;
var SIDE_W_MAX = 480;
var SIDE_W_DEFAULT = 250;
var sideW = SIDE_W_DEFAULT;
var sideCollapsed = false;
var libraryScrollHandler;
var boardPanel;
var activeDocByPage = {};    // pageId → screenId，切页回来记得上次看的版本
var boardLoadGen = 0;
var mountManager = new BoardMountManager();

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
  savePageViewport(wbGet().activePageId, { canvasZoom: z });
}

var viewportSaveT;
var restoringViewport = false;

function stageScrollPatch() {
  return { scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop };
}

function resolveBootPageId(prefs) {
  prefs = prefs || readPrefs();
  wbSet({ boardMode: normalizeBoardMode(prefs.boardMode) });
  var manifest = wbGet().pageManifest;
  if (manifest) renderPageManifest(manifest);
  return resolvePageForMode(wbGet().boardMode, prefs.activePageId);
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
  replacePrefs(next);
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
    savePageViewport(wbGet().activePageId, stageScrollPatch());
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
  if (wbGet().boardMode === 'html') {
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
    syncSegOn(settingsEl.querySelector('#zoom'), 'canvas-zoom', zoomForPage(wbGet().activePageId));
  }

  if (options.refit) refit();
  return pageId;
}

function restorePrefs() {
  applyBootPrefs(readPrefs(), {
    pageId: wbGet().activePageId,
    side: false,
    shell: false,
    syncSettingsUi: true,
    refit: true
  });
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
  wbSet({ activeGroup: groupId });
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
        wbSet({ activeGroup: first.getAttribute('data-ann-section')
          || first.getAttribute('data-ann-group')
          || wbGet().activeGroup });
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
      if (best && best !== wbGet().activeGroup) {
        wbSet({ activeGroup: best });
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
  if (wbGet().boardMode !== 'html' || !boardPanel) return null;
  var frame = boardPanel.querySelector('.wb-screen:not([data-doc-hidden]) .wb-doc-frame');
  if (!frame) return null;
  try {
    var w = frame.contentWindow;
    return w && w.pinpoint ? w : null;     // 跨域时读 contentWindow 会抛
  } catch (e) {
    return null;
  }
}

function annotateApi() {
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
  if (wbGet().boardMode !== 'html' || !boardPanel) return null;
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
  var ann = docWin.pinpoint;
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
  if (wbGet().boardMode !== 'html') return;
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
  if (!screenId || wbGet().activePageId === COMPONENTS_ID) return;
  var edit = noteEl.querySelector('[data-frame-note-action="edit"]');
  if (edit) edit.disabled = true;
  noteEl.classList.add('is-loading');

  fetch(frameNoteApiUrl(wbGet().activePageId, screenId))
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
  if (!screenId || !input || !revision || wbGet().activePageId === COMPONENTS_ID) return;

  setFrameNoteBusy(noteEl, true);
  setFrameNoteStatus(noteEl, '正在保存…', false);
  fetch(frameNoteApiUrl(wbGet().activePageId, screenId), {
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
  var btnInteract = document.getElementById('wbann-interact');
  var btnPause = document.getElementById('wbann-pause');
  var btnPin = document.getElementById('wbann-pin');
  if (btnToggle) {
    btnToggle.classList.toggle('on', st.mode);
    btnToggle.title = st.mode ? '标注模式 (A → 交互)' : '标注模式 (A)';
    btnToggle.setAttribute('aria-pressed', st.mode ? 'true' : 'false');
  }
  if (btnInteract) {
    btnInteract.classList.toggle('on', !st.mode);
    btnInteract.setAttribute('aria-pressed', st.mode ? 'false' : 'true');
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
      return !sec || sec === wbGet().activeGroup;
    });
  }
  // Build a row model + signature; skip the innerHTML rebuild when the list
  // hasn't changed (mode toggle / scroll-spy fire notify without touching marks).
  // Row fields come from the shared lib/ann-row.js model (cap/preview/broken/
  // tags); grouping keys stay workbench-local. Cap options pin the workbench
  // wording: region rows show 「框选」, no selector excerpt fallback.
  var rows = marks.map(function (m) {
    var broken = typeof ann.isMarkBroken === 'function' ? ann.isMarkBroken(m) : false;
    var row = annRowModel(m, {
      cap: { region: '框选', selectorMax: 0 },
      preview: markSummary(m),
      broken: broken
    });
    row.key = (m.section || m.group || '_') + '|' + m.n;
    row.group = m.section || m.group || '_';
    row.groupLabel = m.sectionLabel || m.groupLabel || '未分组';
    return row;
  });
  var sig = annFilter + '|' + wbGet().activeGroup + '|' + rows.map(function (r) {
    return r.key + ':' + r.cap + ':' + r.preview + ':' + r.broken + ':' + r.tags;
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
        '<span class="wb-ann-cap">' + escHtml(r.cap) + '</span>' +
        '<span class="wb-ann-text">' + escHtml(r.preview) + '</span>' +
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
  var btnInteract = document.getElementById('wbann-interact');
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
  if (btnInteract) btnInteract.addEventListener('click', function () {
    var a = annotateApi();
    if (a.getState().mode) a.toggle();
  });
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
  if (window.pinpoint) wireAnnotatePanel();
  else setTimeout(pollAnnotate, 100);
}

function boardUrl(pageId) {
  if (pageId === COMPONENTS_ID) return 'components/board.json';
  return pageBaseUrl(wbGet().pageManifest, pageId) + 'board.json';
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
        defaultShell: defaultShellForPage(wbGet().pageManifest, pageId)
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
        wbSet({ activeBoard: { pageId: pageId, board: board } });
        renderDocVersions();
        watchDocAnnotate();
        return afterMount(panel, session);
      });
    })
    .catch(function (e) {
      if (gen !== boardLoadGen) return null;
      mountManager.cancel();
      resetBoardNavOnLoadFailure();
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
    copy.innerHTML = '<i data-wb-icon="link" data-wb-icon-size="12" class="wb-ico"></i>';
    if (window.mountWorkbenchIcons) window.mountWorkbenchIcons(copy);
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

function pagesForMode(mode) {
  mode = normalizeBoardMode(mode);
  var manifest = wbGet().pageManifest;
  if (!manifest || !manifest.pages) return [];
  return manifest.pages.filter(function (page) {
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
  var manifest = wbGet().pageManifest;
  if (manifest && manifest.defaultPage) {
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].id === manifest.defaultPage) return pages[i].id;
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
  var active = wbGet().activeBoard;
  if (!active || modeForPage(wbGet().pageManifest, active.pageId) !== 'html') return [];
  var out = [];
  (active.board.sections || []).forEach(function (sec) {
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
  var active = wbGet().activeBoard;
  if (active) activeDocByPage[active.pageId] = screenId;

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
  if (wbGet().boardMode !== 'html' || !screens.length) {
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
  var active = wbGet().activeBoard;
  var remembered = active ? activeDocByPage[active.pageId] : null;
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
  wbSet({ pageManifest: manifest });
  pagesNav.querySelectorAll('.wb-page-row, .wb-page, .wb-page-error').forEach(function (node) {
    node.remove();
  });
  if (wbGet().boardMode === 'ios') {
    var components = document.createElement('button');
    components.type = 'button';
    components.className = 'wb-page';
    components.setAttribute('data-vpage', COMPONENTS_ID);
    components.setAttribute('data-page-system', '1');
    components.setAttribute('data-page-default', 'Component Library');
    components.textContent = 'Component Library';
    pagesNav.appendChild(components);
  }
  pagesForMode(wbGet().boardMode).forEach(function (page) {
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
  syncBoardModeUi(wbGet().boardMode);
  syncPagesNav(wbGet().activePageId);
}

function setBoardMode(mode, options) {
  options = options || {};
  mode = normalizeBoardMode(mode);
  var prevMode = wbGet().boardMode;
  if (prevMode !== mode && mountManager.current && mountManager.current.active && mountManager.current.pageId === wbGet().activePageId) {
    snapshotPageViewport(wbGet().activePageId);
  }
  wbSet({ boardMode: mode });
  syncBoardModeUi(mode);
  if (mode !== 'html') stopGutter();   // 离开 HTML 板：父级 gutter 不再适用
  // 画布缩放对文档没有意义——报告必须按读者真实窗口尺寸渲染
  if (mode === 'html') setCanvasZoom('1', { save: false });
  if (docVersionsNav && mode !== 'html') { docVersionsNav.hidden = true; docVersionsNav.innerHTML = ''; }
  var manifest = wbGet().pageManifest;
  if (manifest) renderPageManifest(manifest);
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
  message.textContent = '页面清单读取失败：board.json 缺失或返回的不是 JSON。请检查对应 previews 目录后刷新。';
  message.title = String(error && error.message ? error.message : error);
  pagesNav.appendChild(message);
}

/** Registry dir entries surface as workbench pages, served from /sites/<id>/.
    The default 'pinpoint' entry is the workbench itself — its pages are the
    _index pages, so it is not listed again. A dead annotate API must not break
    the workbench: previews-only then. */
function registrySitePages() {
  return fetch('/registry')
    .then(function (r) {
      if (!r.ok) throw r.status;
      return r.json();
    })
    .then(function (data) {
      var entries = (data && data.entries) || [];
      return entries
        .filter(function (entry) { return entry && entry.kind === 'dir' && entry.id !== 'pinpoint'; })
        .map(function (entry) {
          return {
            id: entry.id,
            title: entry.title || entry.id,
            mode: BOARD_MODES[entry.board] ? entry.board : 'web',
            site: true
          };
        });
    })
    .catch(function () { return []; });
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
      var manifest = validatePageManifest(raw);
      return registrySitePages().then(function (sitePages) {
        var known = {};
        manifest.pages.forEach(function (page) { known[page.id] = true; });
        sitePages.forEach(function (page) {
          if (known[page.id]) return; // a previews page with the same id wins
          manifest.pages.push(page);
        });
        wbSet({ pageManifest: manifest });
        renderPageManifest(manifest);
        return manifest;
      });
    });
}

function setActivePage(pageId, options) {
  options = options || {};
  if (!boardPanel) return Promise.resolve();
  var same = wbGet().activePageId === pageId;
  var _draftAnn = annotateApi();
  if (!same && _draftAnn && typeof _draftAnn.cancelDraft === 'function') {
    _draftAnn.cancelDraft();
  }
  if (!same && mountManager.current && mountManager.current.active && mountManager.current.pageId === wbGet().activePageId) {
    snapshotPageViewport(wbGet().activePageId);
  }
  wbSet({ activePageId: pageId });
  var nextMode = modeForPage(wbGet().pageManifest, pageId);
  if (nextMode !== wbGet().boardMode) {
    wbSet({ boardMode: nextMode });
    var manifest = wbGet().pageManifest;
    if (manifest) renderPageManifest(manifest);
  } else {
    wbSet({ boardMode: nextMode });
    syncBoardModeUi(wbGet().boardMode);
    syncPagesNav(pageId);
  }
  if (options.save !== false) rememberActivePageForMode(wbGet().boardMode, pageId);
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

initPreviewMount({
  syncPanelPrefs: syncPanelPrefs,
  restorePageViewportAfterMount: restorePageViewportAfterMount,
  annotateApi: annotateApi,
  wireLibraryScrollSpy: wireLibraryScrollSpy,
  refreshAnnPanel: refreshAnnPanel
});
wireSections();
initBoard();
wireCanvasHud({
  setCanvasZoom: setCanvasZoom,
  onSectionJump: function () { if (annFilter === 'tab') refreshAnnPanel(); }
});

window.workbench = {
  switchPage: switchPage,
  setActivePage: setActivePage,
  setBoardMode: setBoardMode,
  focusFrame: focusWorkbenchFrame,
  activePageId: function () { return wbGet().activePageId; },
  boardMode: function () { return wbGet().boardMode; },
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
    if (!mode || mode === wbGet().boardMode) return;
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
    var id = (data && data.id) || wbGet().activePageId;
    // Includes reference shared component files; only a component change can
    // stale them. A page-screen-only change keeps the include cache warm.
    var componentChange = id === COMPONENTS_ID || (data && data.alsoActive);
    if (componentChange) clearIncludeCache();
    if (id === wbGet().activePageId) {
      snapshotPageViewport(wbGet().activePageId);
      loadBoard(boardPanel, wbGet().activePageId);
      return;
    }
    // Component change while viewing a flow — reload active page so includes refresh
    if (data && data.alsoActive && wbGet().activePageId !== COMPONENTS_ID) {
      snapshotPageViewport(wbGet().activePageId);
      loadBoard(boardPanel, wbGet().activePageId);
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
