// Workbench 页面/manifest 簇 — 页面集合与模式、manifest 加载、页面切换、
// doc 版本切换、显示名。设置视图已出壳（app/SettingsView.jsx，P1b cut4）。
// 共享状态经 app/store.js 的 wbGet()/wbSet() 读写；工具函数取自 lib/。
import { wbGet, wbSet } from './app/store.js';
import { queryClient } from './app/query-client.js';
import { readPrefs, savePrefs } from './lib/prefs.js';
import {
  COMPONENTS_ID,
  DOC_LIB_ID,
  LIB_ID,
  SYSTEM_PAGES,
  WEB_LIB_ID,
  modeForPage
} from './lib/page-url.js';
import { closestBoardSection } from './lib/board-navigation.js';
import { validatePageManifest } from './lib/preview-contracts.js';
import { currentBoardNavigationModel, updateSectionNavigatorActive } from './board-nav.js';
import { refit, setCanvasZoom, snapshotPageViewport } from './boot-prefs.js';
import { annotateApi, scheduleAnnSnap, stopGutter, watchDocAnnotate } from './ann-bridge.js';

// 反向依赖注入：loadBoard / mountManager 留在 workbench.js（壳持有装载编排），
// pages.js 不得 import workbench.js，由它在初始化时经 initPages(deps) 注入。
// （boot-prefs / ann-bridge 簇走直接 import；标注面板刷新 = scheduleAnnSnap。）
var pagesDeps = {};

export function initPages(deps) {
  pagesDeps = deps || {};
}

var stage = document.getElementById('wbstage');
var wbRoot = document.getElementById('wbroot') || document.querySelector('.wb');
var libraryScrollHandler;
var activeDocByPage = {};    // pageId → screenId，切页回来记得上次看的版本

// 段开合：class/aria 由 Sidebar 的 Section 组件从 store 派生，这里只写状态 + 持久化
export function setSectionOpen(name, open, options) {
  options = options || {};
  var sectionOpen = Object.assign({}, wbGet().sectionOpen);
  sectionOpen[name] = !!open;
  wbSet({ sectionOpen: sectionOpen });
  if (options.save !== false) savePrefs({ sectionOpen: wbGet().sectionOpen });
}

export function scrollToGroup(groupId, options) {
  options = options || {};
  wbSet({ activeGroup: groupId });
  updateSectionNavigatorActive(groupId);
  var el = document.getElementById('lib-' + groupId);
  if (el) el.scrollIntoView({ behavior: options.smooth === false ? 'auto' : 'smooth', block: 'start' });
  refit();
  scheduleAnnSnap();
}

export function switchPage(id, options) {
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
      scheduleAnnSnap();
    });
  }
  scrollToGroup(id, options);
  return Promise.resolve();
}

export function wireLibraryScrollSpy() {
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
        if (wbGet().annFilter === 'tab') scheduleAnnSnap();
      }
    });
  };
  stage.addEventListener('scroll', libraryScrollHandler, { passive: true });
}

/** 标注簇（还在 workbench.js）切到 tab 过滤时要重跑一次当前 spy handler。 */
export function getLibraryScrollHandler() {
  return libraryScrollHandler;
}

// ios = 手机原型（fragment + 机身 chrome）
// web = web app 画板（fragment，无机身）
// html = 完整独立 HTML 文档（汇报页一类），iframe 承载，见 shell "doc"
var BOARD_MODES = { ios: true, web: true, html: true };

export function normalizeBoardMode(mode) {
  return BOARD_MODES[mode] ? mode : 'ios';
}

export function pagesForMode(mode) {
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

export function resolvePageForMode(mode, preferredId) {
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
   同一页里的多个版本不并排摆，改从侧栏切。侧栏导航本身由 Sidebar 的
   DocVersions 组件渲染（读 activeBoard/activeDocId），这里只保留切换动作。 */
export function docScreensOfActiveBoard() {
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

export function setActiveDoc(screenId, options) {
  options = options || {};
  var panel = document.getElementById('wb-board-panel');
  if (!panel) return;
  var screens = docScreensOfActiveBoard();
  if (!screens.length) return;
  var ids = screens.map(function (sc) { return sc.id; });
  if (ids.indexOf(screenId) < 0) screenId = ids[0];
  var active = wbGet().activeBoard;
  if (active) activeDocByPage[active.pageId] = screenId;
  wbSet({ activeDocId: screenId });

  panel.querySelectorAll('.wb-screen[data-screen]').forEach(function (node) {
    var on = node.getAttribute('data-screen') === screenId;
    node.toggleAttribute('data-doc-hidden', !on);
    // section 容器只在它一个 screen 都不显示时才收起
    var item = node.closest('.wb-lib-item');
    if (item) {
      var anyVisible = !!item.querySelector('.wb-screen[data-screen]:not([data-doc-hidden])');
      item.toggleAttribute('data-doc-hidden', !anyVisible);
    }
  });
  if (options.scrollTop !== false && stage) stage.scrollTop = 0;
  watchDocAnnotate();   // 换了 iframe，重新绑定并刷新侧栏
}

/* board 装载/模式切换后调用：导航渲染由 DocVersions 组件从 store 派生，
   这里只负责把当前文档版本定下来（记住每页上次看的版本）。 */
export function syncDocVersions() {
  var screens = docScreensOfActiveBoard();
  if (wbGet().boardMode !== 'html' || !screens.length) return;
  var active = wbGet().activeBoard;
  var remembered = active ? activeDocByPage[active.pageId] : null;
  setActiveDoc(remembered || screens[0].id, { scrollTop: false });
}

// 按钮态由 Sidebar 的 BoardModeSwitch 从 store 派生；这里只留 wbRoot 的
// data-board-mode 属性（CSS 按模式分流靠它）。
export function syncBoardModeUi(mode) {
  mode = normalizeBoardMode(mode);
  if (wbRoot) wbRoot.setAttribute('data-board-mode', mode);
}

export function setBoardMode(mode, options) {
  options = options || {};
  mode = normalizeBoardMode(mode);
  var prevMode = wbGet().boardMode;
  if (prevMode !== mode && pagesDeps.mountManager.current && pagesDeps.mountManager.current.active && pagesDeps.mountManager.current.pageId === wbGet().activePageId) {
    snapshotPageViewport(wbGet().activePageId);
  }
  wbSet({ boardMode: mode });
  syncBoardModeUi(mode);
  if (mode !== 'html') stopGutter();   // 离开 HTML 板：父级 gutter 不再适用
  // 画布缩放对文档没有意义——报告必须按读者真实窗口尺寸渲染
  if (mode === 'html') setCanvasZoom('1', { save: false });
  var nextPageId = resolvePageForMode(mode, options.pageId);
  rememberActivePageForMode(mode, nextPageId);
  if (options.save !== false) savePrefs({ boardMode: mode });
  return setActivePage(nextPageId, { force: options.force === true, save: options.save !== false });
}

export function showPageManifestError(error) {
  wbSet({ pageManifestError: String(error && error.message ? error.message : error) });
}

/** Registry dir entries surface as workbench pages, served from /sites/<id>/.
    The default 'pinpoint' entry is the workbench itself — its pages are the
    _index pages, so it is not listed again. A dead annotate API must not break
    the workbench: previews-only then. */
function registrySitePages() {
  return queryClient.fetchQuery({
    queryKey: ['registry-sites'],
    queryFn: function () {
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
        });
    }
  }).catch(function () { return []; });
}

export function loadPageManifest() {
  // previews/_index.local.json (gitignored) overrides the tracked manifest, so
  // an instance can keep private pages without touching versioned files. Only
  // a missing local file falls back — a broken one must surface as an error.
  return queryClient.fetchQuery({
    queryKey: ['page-manifest'],
    queryFn: function () {
      return fetch('previews/_index.local.json')
        .then(function (response) {
          if (response.ok) return response.json();
          if (response.status !== 404) throw new Error(String(response.status));
          return fetch('previews/_index.json').then(function (tracked) {
            if (!tracked.ok) throw new Error(String(tracked.status));
            return tracked.json();
          });
        });
    }
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
        return manifest;
      });
    });
}

export function setActivePage(pageId, options) {
  options = options || {};
  var panel = document.getElementById('wb-board-panel');
  if (!panel) return Promise.resolve();
  var same = wbGet().activePageId === pageId;
  var _draftAnn = annotateApi();
  if (!same && _draftAnn && typeof _draftAnn.cancelDraft === 'function') {
    _draftAnn.cancelDraft();
  }
  if (!same && pagesDeps.mountManager.current && pagesDeps.mountManager.current.active && pagesDeps.mountManager.current.pageId === wbGet().activePageId) {
    snapshotPageViewport(wbGet().activePageId);
  }
  wbSet({ activePageId: pageId });
  var nextMode = modeForPage(wbGet().pageManifest, pageId);
  wbSet({ boardMode: nextMode });
  syncBoardModeUi(nextMode);
  if (options.save !== false) rememberActivePageForMode(wbGet().boardMode, pageId);
  if (same && !options.force) {
    // Re-clicking the active page must not fight per-page viewport memory.
    if (options.scrollTop === true) stage.scrollTo({ top: 0, behavior: 'smooth' });
    return Promise.resolve();
  }
  // Includes resolve to shared component files (page-independent); keep the
  // cache across page switches — only a component change busts it (see HMR).
  return pagesDeps.loadBoard(panel, pageId).then(function () {
    // Viewport restore happens in afterMount; do not reset to origin here.
  });
}

// 显隐全由 Sidebar 从 store 的 settingsOpen 派生（sideScroll/foot/settings 壳/gear 高亮）
export function showTabs() {
  wbSet({ settingsOpen: false });
}

export function showSettings() {
  wbSet({ settingsOpen: true });
}

// 页面显示名归 store（Sidebar 的 PageRow 订阅派生；system 页不参与改名）
export function applyPageNames(names) {
  wbSet({ pageNames: names && typeof names === 'object' ? names : {} });
}
