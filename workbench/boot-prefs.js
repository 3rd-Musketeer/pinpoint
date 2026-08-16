// Workbench 启动偏好与视口簇 — 把 prefs（lib/prefs.js、lib/page-viewports.js 纯函数）
// 应用到 DOM/store 的编排层：侧栏宽度/折叠、ios 根属性、canvas zoom、每页视口的
// 保存与恢复、启动偏好应用。P1a 从 workbench.js 平移
// （goal-20260810-workbench-react-rebuild）：零行为变化。
import { wbGet, wbSet, activeBoardMode } from './app/store.js';
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

// 反向依赖注入：resolveBootPageId 依赖 pages.js 的 resolveActivePage，
// applyPageNames 属 pages.js；pages.js 会直接 import 本模块，本模块不能反向
// import（禁循环），由 stage.js 初始化时经 initBootPrefs(deps) 注入。
// （ann-bridge 簇的 annotateApi 走直接 import。）
var prefsDeps = {};

export function initBootPrefs(deps) {
  prefsDeps = deps || {};
}

var stage = document.getElementById('wbstage');
var splitEl = document.getElementById('wbsplit');
var sideEl = document.getElementById('wbside');
var annSplitEl = document.getElementById('wbannsplit');
var annSideEl = document.getElementById('wbann-side');
var wbRoot = document.getElementById('wbroot') || document.querySelector('.wb');

var SIDE_W_MIN = 200;
var SIDE_W_MAX = 480;
var SIDE_W_DEFAULT = 250;
// 左栏紧凑断点（2026-08-16b）：宽 < 230 时 Pages 壳标 pill 藏文字收纯图标块
// （样式在 index.html #wbside.compact），拖回 ≥230 自动恢复。镜像右栏 ANN_W_COMPACT。
var SIDE_W_COMPACT = 230;

export function applySideWidth(px) {
  var w = Math.round(Math.max(SIDE_W_MIN, Math.min(SIDE_W_MAX, px)));
  wbSet({ sideWidth: w });
  document.documentElement.style.setProperty('--wb-side-w', w + 'px');
  if (splitEl) splitEl.setAttribute('aria-valuenow', String(w));
  if (sideEl) sideEl.classList.toggle('compact', w < SIDE_W_COMPACT);
  return w;
}

/* 右栏（标注工作台）宽度（2026-08-16 V2 宽度适配，mock .wmock[data-v=v2]）：
   机制镜像左栏 applySideWidth —— clamp + CSS var + splitter aria-valuenow；
   另过 280 紧凑断点时给栏面打 compact 类（藏 cap / 文本单行 / 底栏 dropdown
   收文案，样式在 index.html #wbann-side.compact），拖回 ≥280 自动恢复。 */
export var ANN_W_MIN = 260;
export var ANN_W_MAX = 440;
export var ANN_W_DEFAULT = 308;
var ANN_W_COMPACT = 280;

export function applyAnnWidth(px) {
  var w = Math.round(Math.max(ANN_W_MIN, Math.min(ANN_W_MAX, px)));
  wbSet({ annPanelWidth: w });
  document.documentElement.style.setProperty('--wb-ann-w', w + 'px');
  if (annSplitEl) annSplitEl.setAttribute('aria-valuenow', String(w));
  if (annSideEl) annSideEl.classList.toggle('compact', w < ANN_W_COMPACT);
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

/* 右栏（标注工作台）整栏折叠（decisions 2026-08-14）：机制镜像左栏 ——
   root 类 wb-ann-collapsed 控宽度与画布右缘浮钮（#wbann-expand），偏好持久化同例。 */
export function setAnnPanelCollapsed(on, options) {
  options = options || {};
  var collapsed = !!on;
  wbSet({ annPanelCollapsed: collapsed });
  if (wbRoot) wbRoot.classList.toggle('wb-ann-collapsed', collapsed);
  if (annSplitEl) {
    annSplitEl.setAttribute(
      'aria-label',
      collapsed ? '展开标注面板（点击）或拖动调整宽度' : '调整标注面板宽度（拖动）· 双击复位默认宽度'
    );
    annSplitEl.title = collapsed ? '点击展开标注面板 · 拖动可调宽' : '拖动调整宽度 · 双击复位默认宽度';
  }
  if (options.save) savePrefs({ annPanelCollapsed: collapsed });
  if (options.refit !== false) {
    requestAnimationFrame(function () { refit(); });
  }
}

export function toggleAnnPanelCollapsed(options) {
  setAnnPanelCollapsed(!wbGet().annPanelCollapsed, options || { save: true });
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

// 画布背景三态（grid/dots/plain）—— 属性钉在 .wb-stage-wrap（纹理层），store 供 SettingsView 订阅
export var setStageBg = makePref('stageBg', {
  apply: function (val) {
    wbSet({ stageBg: val });
    var wrap = document.querySelector('.wb-stage-wrap');
    if (wrap) wrap.setAttribute('data-grid', val);
  }
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

/** One-time: drop the retired mode prefs (2026-08-16 阶段 2)—— 壳形态由 activePageId
    派生，activePageIdByMode / boardMode 两个 key 读弃。 */
function migrateLegacyBoardModePrefs() {
  var prefs = readPrefs();
  var stale = Object.prototype.hasOwnProperty.call(prefs, 'activePageIdByMode')
    || Object.prototype.hasOwnProperty.call(prefs, 'boardMode');
  if (!stale) return;
  var next = Object.assign({}, prefs);
  delete next.activePageIdByMode;
  delete next.boardMode;
  replacePrefs(next);
}

// 首访默认缩放（2026-08-16 TODO 小修，owner 体感拍板）：100% 下 iOS UI 显大
// 不舒适，默认 50%；存档视口（pageViewports）始终优先于默认值。
var DEFAULT_CANVAS_ZOOM = '0.5';

// 视口存档仍按 pageId 键（2026-08-16f 阶段 6：条目级后刻意不变 key —— 存量存档
// 不丢；doc 条目形态 1:1 铺满 stage，没有可存档的视口，写读两侧都用
// activeBoardMode() 守卫跳过）。
export function zoomForPage(pageId) {
  var vp = pageViewport(pageId);
  return boardZoom((vp && vp.canvasZoom) || DEFAULT_CANVAS_ZOOM);
}

export function snapshotPageViewport(pageId) {
  if (!pageId || !stage) return;
  // 文档条目形态不存档（zoom 恒 1、stage 不滚动）—— 否则会拿 doc 形态的
  // scroll 0 / zoom 1 覆盖掉画布条目刚存下的视口。
  if (activeBoardMode() === 'html') return;
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
  if (activeBoardMode() === 'html') return;   // 文档条目形态无画布视口可存
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

/** Zoom first, then layout, then scroll — scroll coords depend on zoomed board size.
    文档条目形态跳过（2026-08-16f 阶段 6）：阅读器 1:1 铺满 stage，无视口可恢复。 */
export function restorePageViewportAfterMount(pageId) {
  if (activeBoardMode() === 'html') return false;
  if (!pageViewport(pageId)) return false;
  restorePageViewport(pageId, { scroll: false });
  syncBoardZoomLayout();
  restorePageViewport(pageId, { zoom: false });
  return true;
}

/** Reserve layout space for transform-scaled board (transform alone does not shrink flow).
 *  On HTML pages the zoom-wrap is width:100% + transform:none (a fluid reader
 *  column, not a fixed canvas), so we must not pin an inline content-measured width —
 *  that would override the CSS and make the iframe overflow the stage into the gutter. */
function syncBoardZoomLayout() {
  var wrap = document.querySelector('#wb-board-panel .wb-zoom-wrap');
  var lib = wrap && wrap.querySelector('.wb-library');
  if (!wrap || !lib) return;
  if (activeBoardMode() === 'html') {
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
  migrateLegacyBoardModePrefs();

  if (options.side !== false) {
    applySideWidth(prefs.sideWidth || SIDE_W_DEFAULT);
    applyAnnWidth(prefs.annPanelWidth || ANN_W_DEFAULT);
    setSideCollapsed(!!prefs.sideCollapsed, { save: false, refit: false });
    setAnnPanelCollapsed(!!prefs.annPanelCollapsed, { save: false, refit: false });
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
  setStageBg(prefs.stageBg || 'grid');
  setCanvasZoom(zoomForPage(pageId), { save: false });

  if (options.shell !== false) {
    // 设置视图之外已无持久化壳层偏好（2026-08-15 侧栏重构：段开合 / 标注筛选退役）
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
