// Workbench shell — pages, board loader, settings, preview hot-reload (Vite dev).
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
import { ContractError, validateBoard, validatePageManifest } from './lib/preview-contracts.js';

var LIB_ID = 'library';
var COMPONENTS_ID = 'components';
var SYSTEM_PAGES = { components: true };
var activePageId = LIB_ID;
var pagesNav = document.getElementById('wbpages');
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
var boardNavigationModel = null;
var boardLoadGen = 0;
var mountManager = new BoardMountManager();
var pageManifest = null;

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
    if (window.iOSAnnotate) window.iOSAnnotate.render();
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
  try {
    if (prefs.activePageId && document.querySelector('.wb-page[data-vpage="' + prefs.activePageId + '"]')) {
      return prefs.activePageId;
    }
  } catch (e) { /* ignore */ }
  if (pageManifest && pageManifest.defaultPage) return pageManifest.defaultPage;
  return document.querySelector('.wb-page[data-vpage="' + LIB_ID + '"]') ? LIB_ID : COMPONENTS_ID;
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

/** Reserve layout space for transform-scaled board (transform alone does not shrink flow). */
function syncBoardZoomLayout() {
  var wrap = document.querySelector('#wb-board-panel .wb-zoom-wrap');
  var lib = wrap && wrap.querySelector('.wb-library');
  if (!wrap || !lib) return;
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
  if (window.iOSAnnotate) window.iOSAnnotate.render();
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

function scrollToGroup(groupId) {
  activeGroup = groupId;
  updateSectionNavigatorActive(groupId);
  var el = document.getElementById('lib-' + groupId);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  refit();
  refreshAnnPanel();
}

function switchPage(id) {
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
  scrollToGroup(id);
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

function markSummary(m) {
  var body = (m && (m.content != null ? m.content : m.comment)) || '';
  if (body) {
    var ann = window.iOSAnnotate;
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

function syncConnStatus() {
  var el = document.getElementById('wbconn');
  if (!el) return;
  var ann = window.iOSAnnotate;
  var st = ann && typeof ann.getState === 'function' ? ann.getState() : null;
  var on = !!(st && st.connected);
  var syncErr = !!(st && st.syncError);
  var label = el.querySelector('.wb-conn-label');
  el.setAttribute('data-state', on ? 'online' : 'offline');
  if (label) label.textContent = on ? '已连接' : '未连接';
  el.title = on
    ? (syncErr ? '已连接 · 上次同步失败' : '标注服务已连接')
    : '标注服务未连接（npm run dev / 端口 5199）';
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
  var ann = window.iOSAnnotate;
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
        '<button type="button" class="wb-ann-item-main" data-ann-n="' + r.n + '">' +
        '<span class="wb-ann-num">' + r.n + '</span>' +
        '<span class="wb-ann-body">' +
        '<span class="wb-ann-cap">' + escHtml(r.type === 'region' ? '框选' : r.text || '元素') + '</span>' +
        '<span class="wb-ann-text">' + escHtml(r.summary) + '</span>' +
        (r.broken ? '<span class="wb-ann-broken-tag">锚点失效</span>' : '') +
        (r.tags ? '<span class="wb-ann-tags">' + r.tags + '</span>' : '') +
        '</span></button>' +
        '<button type="button" class="wb-ann-del" data-ann-del="' + r.n + '" aria-label="删除标注 ' + r.n + '" title="删除">×</button>' +
        '</div>';
    }).join('');
    return head + body;
  }).join('');
}

function wireAnnotatePanel() {
  var ann = window.iOSAnnotate;
  if (!ann || wireAnnotatePanel.done || typeof ann.getState !== 'function') return;
  var btnToggle = document.getElementById('wbann-toggle');
  var btnPause = document.getElementById('wbann-pause');
  var btnClear = document.getElementById('wbann-clear');
  var btnPin = document.getElementById('wbann-pin');
  if (!btnToggle || !btnPause || !btnClear || !btnPin) return;
  wireAnnotatePanel.done = true;
  ann.onUpdate(scheduleAnnPanel);
  syncConnStatus();
  btnToggle.addEventListener('click', function () { ann.toggle(); });
  btnPause.addEventListener('click', function () {
    ann.setPaused(!ann.getState().paused);
  });
  btnClear.addEventListener('click', function () { ann.clear(); });
  btnPin.addEventListener('click', function () {
    ann.setFloatingToolbar(!ann.getState().floating);
  });
  annList.addEventListener('click', function (e) {
    var del = e.target.closest('[data-ann-del]');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      var dn = parseInt(del.getAttribute('data-ann-del'), 10);
      if (ann.removeMark) ann.removeMark(dn);
      return;
    }
    var row = e.target.closest('[data-ann-n]');
    if (!row) return;
    var n = parseInt(row.getAttribute('data-ann-n'), 10);
    ann.goToMark(n).then(function () {
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
      var hadViewport = restorePageViewportAfterMount(session.pageId);
      if (window.iOSKit) window.iOSKit.refresh(panel);
      return runPreviewScripts(panel, session.pageId, session).then(function () {
        if (!session.isUsable(panel)) return;
        // Coalesce the post-script DOM batch into one frame so layout
        // reads/writes (navigator positions, frame-in-view, ann panel) batch.
        requestAnimationFrame(function () {
          if (!session.isUsable(panel)) return;
          if (window.iOSAnnotate) window.iOSAnnotate.render();
          rebuildSectionNavigator(panel);
          wireLibraryScrollSpy();
          if (!hadViewport) frameBoardInView(panel, { pageId: session.pageId });
          refreshAnnPanel();
          scheduleMinimapUpdate();
        });
      });
  }, 0);
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
  var frame = findBoardFrame(refreshBoardNavigationModel(), groupId, screenId);
  if (!frame || !stage) return;
  activeGroup = groupId;
  updateSectionNavigatorActive(groupId);
  if (annFilter === 'tab') refreshAnnPanel();
  focusStageOnRect(frame);
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
      var textM = attrs.match(/\bdata-text=(["'])([\s\S]*?)\1/);
      var text = textM ? textM[2] : null;
      var fetched = includeCache[ref];
      if (!fetched || !fetched.ok) {
        return '<div class="wb-screen-err">include 失败 · ' + escHtml(ref) + '</div>';
      }
      var frag = fetched.html.trim();
      if (text != null) {
        frag = frag.replace(
          /(data-ios-slot=["']text["'][^>]*>)([\s\S]*?)(<\/)/,
          function (_, a, _old, c) { return a + text + c; }
        );
      }
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
  return fetch(url)
    .then(function (r) {
      if (!r.ok) throw r.status;
      return r.text();
    })
    .then(function (raw) {
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
        inner = isCompLib ? wrapCompStage(fetched.html) : wrapPhoneShell(fetched.html, sc.shell);
      } else {
        inner = screenErrorHtml(pageId, sc.id, fetched ? fetched.err : 'missing');
      }
      var titled = !!sc.title;
      var screenCls = isCompLib ? 'wb-screen wb-screen--comp' : 'wb-screen';
      return '<div class="' + screenCls + '" data-screen="' + escHtml(sc.id) + '">' +
        (titled ? '<div class="wb-screen-cap">' + escHtml(sc.title) + '</div>' : '') +
        inner +
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
        allowComponentRefs: pageId === COMPONENTS_ID
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

function renderPageManifest(manifest) {
  if (!pagesNav) return;
  pagesNav.querySelectorAll('.wb-page-row:not([data-page-system="1"]), .wb-page:not([data-page-system="1"]), .wb-page-error').forEach(function (node) {
    node.remove();
  });
  manifest.pages.forEach(function (page) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'wb-page';
    button.setAttribute('data-vpage', page.id);
    button.setAttribute('data-page-default', page.title);
    button.textContent = page.title;
    pagesNav.appendChild(button);
  });
  ensurePageCopyButtons();
  applyPageNames(readPrefs().pageNames);
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
  if (!same && window.iOSAnnotate && typeof window.iOSAnnotate.cancelDraft === 'function') {
    window.iOSAnnotate.cancelDraft();
  }
  if (!same && mountManager.current && mountManager.current.active && mountManager.current.pageId === activePageId) {
    snapshotPageViewport(activePageId);
  }
  activePageId = pageId;
  syncPagesNav(pageId);
  if (options.save !== false) savePrefs({ activePageId: pageId });
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

window.workbench = { switchPage: switchPage, setActivePage: setActivePage, activePageId: function () { return activePageId; } };
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
      if (window.iOSAnnotate) window.iOSAnnotate.render();
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
    var ann = window.iOSAnnotate;
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
    if (e.target.closest('.ios-stage, .wb-comp-stage, .wb-screen-err, button, a')) return;
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
