// Workbench 启动偏好与视口簇 — 把 prefs（lib/prefs.js、lib/page-viewports.js 纯函数）
// 应用到 DOM/store 的编排层：侧栏宽度/折叠、ios 根属性、canvas zoom、每页视口的
// 保存与恢复、启动偏好应用。P1a 从 workbench.js 平移
// （goal-20260810-workbench-react-rebuild）：零行为变化。
import { wbGet, wbSet } from './app/store.js';
import { readPrefs, savePrefs, replacePrefs } from './lib/prefs.js';
import { readPageViewports, pageViewport, savePageViewport } from './lib/page-viewports.js';
import { currentCanvasZoom } from './lib/canvas-zoom.js';
import { inputFromIosTime } from './lib/ios-time.js';
import {
  refreshBoardNavigationModel,
  scheduleMinimapUpdate,
  setMinimapOpen,
  updateMinimapAvailability,
  updateSectionNavigatorVisibility
} from './board-nav.js';
import { annotateApi } from './ann-bridge.js';

// 反向依赖注入：resolveBootPageId 依赖 pages.js 的 resolvePageForMode，
// applyPageNames 属 pages.js；pages.js 会直接 import 本模块，本模块不能反向
// import（禁循环），由 workbench.js 初始化时经 initBootPrefs(deps) 注入。
// （ann-bridge 簇的 annotateApi 走直接 import。）
var prefsDeps = {};

export function initBootPrefs(deps) {
  prefsDeps = deps || {};
}

var stage = document.getElementById('wbstage');
var splitEl = document.getElementById('wbsplit');
var wbRoot = document.getElementById('wbroot') || document.querySelector('.wb');

var SIDE_W_MIN = 200;
var SIDE_W_MAX = 480;
var SIDE_W_DEFAULT = 250;

export function applySideWidth(px) {
  var w = Math.round(Math.max(SIDE_W_MIN, Math.min(SIDE_W_MAX, px)));
  wbSet({ sideWidth: w });
  document.documentElement.style.setProperty('--wb-side-w', w + 'px');
  if (splitEl) splitEl.setAttribute('aria-valuenow', String(w));
  return w;
}

export function setSideCollapsed(on, options) {
  options = options || {};
  var collapsed = !!on;
  wbSet({ sideCollapsed: collapsed });
  if (wbRoot) wbRoot.classList.toggle('wb-side-collapsed', collapsed);
  if (splitEl) {
    splitEl.setAttribute(
      'aria-label',
      collapsed ? '展开侧栏（点击）或拖动调整宽度' : '调整侧栏宽度（拖动）· 双击收起'
    );
    splitEl.title = collapsed ? '点击展开侧栏 · 拖动可调宽' : '拖动调整宽度 · 双击收起/展开';
  }
  if (options.save) savePrefs({ sideCollapsed: collapsed });
  if (options.refit !== false) {
    requestAnimationFrame(function () { refit(); });
  }
}

export function toggleSideCollapsed(options) {
  setSideCollapsed(!wbGet().sideCollapsed, options || { save: true });
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

// 控件态由 SettingsView 订阅 store 派生（setter 的 apply 负责 wbSet），
// makePref 只剩 apply + 持久化 + 可选 refit。
function makePref(storeKey, opts) {
  return function set(val, options) {
    options = options || {};
    opts.apply(val);
    if (options.save) {
      savePrefs({ [storeKey]: val });
      if (opts.refit) refit();
    }
  };
}

export var setTheme = makePref('theme', {
  apply: function (val) {
    wbSet({ theme: val });
    applyIosRootValue('data-theme', val);
  },
  refit: true
});

export var setTextSize = makePref('textSize', {
  apply: function (val) {
    wbSet({ textSize: val });
    applyIosRootValue('data-text-size', val);
  },
  refit: true
});

export var setFrame = makePref('frame', {
  apply: function (val) {
    wbSet({ frame: val });
    applyIosRootValue('frame', val);
  },
  refit: true
});

export var setCanvasZoom = makePref('canvasZoom', {
  apply: function (val) {
    var z = boardZoom(val);
    document.documentElement.setAttribute('data-canvas-zoom', z);
    document.documentElement.style.setProperty('--wb-board-zoom', z);
    syncBoardZoomLayout();
    wbSet({ canvasZoom: z });
    var _a = annotateApi(); if (_a) _a.render();
    scheduleMinimapUpdate();
    updateMinimapAvailability();
    updateSectionNavigatorVisibility();
  }
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

export function snapshotPageViewport(pageId) {
  if (!pageId || !stage) return;
  clearTimeout(viewportSaveT);
  viewportSaveT = null;
  flushZoomSave();
  savePageViewport(pageId, Object.assign(stageScrollPatch(), {
    canvasZoom: String(currentCanvasZoom())
  }));
}

export function scheduleViewportScrollSave() {
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
export function restorePageViewportAfterMount(pageId) {
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

export function applyLockFont(val) {
  wbSet({ lockFont: val });
  document.documentElement.setAttribute('data-lock-font', val);
  if (window.iOSKit) window.iOSKit.refresh();
}

export function applyClock(mode, fixedIos) {
  wbSet({ clockMode: mode });
  document.documentElement.setAttribute('data-clock-mode', mode);
  if (mode === 'fixed') {
    var t = fixedIos || '9:41';
    wbSet({ clockFixed: t });
    document.documentElement.setAttribute('data-clock-fixed', t);
  } else {
    document.documentElement.removeAttribute('data-clock-fixed');
  }
  if (window.iOSKit) window.iOSKit.tick();
}

export function syncPanelPrefs(panel) {
  applyIosRoots(readPrefs(), panel);
}

export function applyBootPrefs(prefs, options) {
  options = options || {};
  prefs = prefs || readPrefs();
  var pageId = options.pageId || prefsDeps.resolveBootPageId(prefs);
  migrateLegacyCanvasZoom(pageId);

  if (options.side !== false) {
    applySideWidth(prefs.sideWidth || SIDE_W_DEFAULT);
    setSideCollapsed(!!prefs.sideCollapsed, { save: false, refit: false });
  }
  setMinimapOpen(false);

  applyIosRoots(prefs);
  wbSet({
    theme: prefs.theme || 'light',
    textSize: prefs.textSize || 'default',
    frame: prefs.frame || 'screen'
  });
  applyLockFont(prefs.lockFont || 'helvetica');
  applyClock(prefs.clockMode || 'system', prefs.clockFixed || '9:41');
  setCanvasZoom(zoomForPage(pageId), { save: false });

  if (options.shell !== false) {
    wbSet({ annFilter: prefs.annFilter || 'all' });
    if (prefs.sectionOpen) {
      wbSet({ sectionOpen: Object.assign({ pages: true, annotations: true }, prefs.sectionOpen) });
    }
    // annFilter 的按钮态由 AnnPanel 订阅 store 派生，这里不再手工同步 DOM
    prefsDeps.applyPageNames(prefs.pageNames);
  }

  if (options.refit) refit();
  return pageId;
}

export function refit() {
  if (window.iOSKit) window.iOSKit.fitAll();
  var _a = annotateApi(); if (_a) _a.render();
  refreshBoardNavigationModel();
  scheduleMinimapUpdate();
}
