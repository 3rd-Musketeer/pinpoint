// Workbench 页面/manifest 簇 — 页面集合、manifest 加载、页面切换、
// 条目切换（stage 页内形态）、显示名。设置视图已出壳（app/SettingsView.jsx，P1b cut4）。
// 共享状态经 app/store.js 的 wbGet()/wbSet() 读写；工具函数取自 lib/。
// 2026-08-16 阶段 2：模式 Seg 退役 —— Pages 变单一列表，不再有「按模式切页集」的概念。
// 2026-08-16f 阶段 6（产物与草稿模型）：stage 形态不再由 page.mode 派生 —— 一个 Page
// 一份 board.json，条目 = （有 app/lock 屏则有一个画布条目）+ 每个 doc 屏一个文档
// 条目（lib/board-entries.js）；选中条目（store.activeEntryId）派生 stage 形态
// （画布 / 文档阅读器）、屏显隐、缩放与视口存档。条目记忆持久化在
// prefs.activeEntryIdByPage（reload 后保持；activeDocId 从未落过 prefs，无迁移面）。
import { wbGet, wbSet } from './app/store.js';
import { queryClient } from './app/query-client.js';
import { readPrefs, savePrefs } from './lib/prefs.js';
import {
  boardEntries,
  defaultEntryId,
  entryForm,
  resolveEntry,
  withEntryWeb
} from './lib/board-entries.js';
import {
  COMPONENTS_ID,
  LIB_ID,
  SYSTEM_PAGES,
  modeForPage,
  pageEntry
} from './lib/page-url.js';
import { closestBoardSection } from './lib/board-navigation.js';
import { validatePageManifest } from './lib/preview-contracts.js';
import { currentBoardNavigationModel, updateSectionNavigatorActive } from './board-nav.js';
import {
  refit,
  restorePageViewportAfterMount,
  setCanvasZoom,
  snapshotPageViewport,
  zoomForPage
} from './boot-prefs.js';
import { annotateApi, scheduleAnnSnap, stopGutter, watchDocAnnotate } from './ann-bridge.js';

// 反向依赖注入：loadBoard / mountManager 留在 stage.js（舞台入口持有装载编排），
// pages.js 不得 import stage.js，由它在初始化时经 initPages(deps) 注入。
// （boot-prefs / ann-bridge 簇走直接 import；标注面板刷新 = scheduleAnnSnap。）
var pagesDeps = {};

export function initPages(deps) {
  pagesDeps = deps || {};
}

var stage = document.getElementById('wbstage');
var wbRoot = document.getElementById('wbroot') || document.querySelector('.wb');
var libraryScrollHandler;

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
      }
    });
  };
  stage.addEventListener('scroll', libraryScrollHandler, { passive: true });
}

// stage 形态（条目的属性，lib/board-entries.js entryForm 派生）：
// ios = 画布（手机原型 fragment + 机身 chrome）
// html = 文档阅读器（完整独立 HTML 文档，iframe 承载，见 shell "doc"）
// （2026-08-16 阶段 2：web「无机壳画板」连壳退役，残留 'web' 一律归一到 html；
// 2026-08-16f 阶段 6：形态从页级 mode 下沉到选中条目。）

/** Pages 单一列表（2026-08-16 阶段 2）：不再按模式过滤，返回全部页。 */
export function manifestPages() {
  var manifest = wbGet().pageManifest;
  if (!manifest || !manifest.pages) return [];
  return manifest.pages;
}

function defaultPageId() {
  var pages = manifestPages();
  if (!pages.length) return LIB_ID;
  var manifest = wbGet().pageManifest;
  if (manifest && manifest.defaultPage) {
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].id === manifest.defaultPage) return pages[i].id;
    }
  }
  return pages[0].id;
}

function rememberActivePage(pageId) {
  if (!pageId) return;
  savePrefs({ activePageId: pageId });
}

/** 解析目标页：偏好页存在即用；否则深链 mode 提示（web 已被 parseDeepLink 归一
    html）落到该形态第一页；再回落默认页。按模式的记忆已随 Seg 退役（单一
    activePageId 记忆，boot-prefs 一次性丢弃老 activePageIdByMode/boardMode prefs）。 */
export function resolveActivePage(preferredId, modeHint) {
  var pages = manifestPages();
  var ids = {};
  ids[COMPONENTS_ID] = true;
  pages.forEach(function (page) { ids[page.id] = true; });
  if (preferredId && ids[preferredId]) return preferredId;
  if (modeHint) {
    for (var i = 0; i < pages.length; i++) {
      if (modeForPage(wbGet().pageManifest, pages[i].id) === modeHint) return pages[i].id;
    }
  }
  if (ids[LIB_ID]) return LIB_ID;
  return defaultPageId();
}

/* ---- 条目（2026-08-16f 阶段 6）：一个 board 的可选单元 --------------------
   条目 = （有 app/lock 屏则有一个画布条目）+ 每个 doc 屏一个文档条目
   （lib/board-entries.js）。stage 形态（画布 / 文档阅读器）、屏显隐、缩放与
   视口存档全部从选中条目派生；侧栏的「内容」区由 Sidebar 的 Contents 组件渲染
   （读 activeBoard/activeEntryId；阶段 7 的产物/草稿分组 + frame 树），这里只
   保留切换动作与装载后的条目解析。 */

/** 当前页的条目数组（板未装载 / 换页途中 → []）。Sidebar 消费。
    阶段 7：registry 条目的 kind 经 manifest page（registrySitePages 透传
    page.kind）在这里落到条目上 —— url 页的 doc 条目带 web 标记（「网页」tag）。 */
export function entriesOfActiveBoard() {
  var s = wbGet();
  var active = s.activeBoard;
  if (!active || active.pageId !== s.activePageId) return [];
  var page = pageEntry(s.pageManifest, active.pageId);
  return withEntryWeb(boardEntries(active.board), page && page.kind);
}

function entryPrefs() {
  var raw = readPrefs().activeEntryIdByPage;
  return raw && typeof raw === 'object' ? raw : {};
}

function entryPrefFor(pageId) {
  return entryPrefs()[pageId] || null;
}

function saveEntryPref(pageId, entryId) {
  var all = Object.assign({}, entryPrefs());
  all[pageId] = entryId;
  savePrefs({ activeEntryIdByPage: all });
}

/* stage 形态应用到 DOM/缩放：data-page-mode 是 stage 阅读器态的 CSS 钩
   （index.html）；文档形态锁死缩放（报告必须按读者真实窗口尺寸渲染），
   回画布形态停掉父级 gutter。形态值域沿用 ios/html（html = 文档阅读器）。 */
function applyStageForm(form) {
  if (wbRoot) wbRoot.setAttribute('data-page-mode', form);
  if (form === 'html') setCanvasZoom('1', { save: false });
  else stopGutter();
}

/** 无条目可解析时的页级回落（空板 / 装载失败面板）：与阶段 2 的页级派生同义。 */
export function applyPageFormFallback(pageId) {
  applyStageForm(modeForPage(wbGet().pageManifest, pageId) === 'html' ? 'html' : 'ios');
}

/* 屏显隐 = 条目选择唯一驱动：画布条目 → doc 屏全部收起；文档条目 → 只留该屏。
   data-doc-hidden 的 display:none 规则是全局的（index.html），section 容器在它
   一个 screen 都不显示时收起。 */
function applyEntryVisibility(panel, board, entry) {
  var shellById = {};
  (board.sections || []).forEach(function (sec) {
    (sec.screens || []).forEach(function (sc) { shellById[sc.id] = sc.shell; });
  });
  panel.querySelectorAll('.wb-screen[data-screen]').forEach(function (node) {
    var screenId = node.getAttribute('data-screen');
    var on = entry.kind === 'canvas'
      ? shellById[screenId] !== 'doc'
      : screenId === entry.id;
    node.toggleAttribute('data-doc-hidden', !on);
    var item = node.closest('.wb-lib-item');
    if (item) {
      var anyVisible = !!item.querySelector('.wb-screen[data-screen]:not([data-doc-hidden])');
      item.toggleAttribute('data-doc-hidden', !anyVisible);
    }
  });
}

export function setActiveEntry(entryId, options) {
  options = options || {};
  var panel = document.getElementById('wb-board-panel');
  var active = wbGet().activeBoard;
  if (!panel || !active || active.pageId !== wbGet().activePageId) return;
  var entries = boardEntries(active.board);
  if (!entries.length) return;
  var entry = resolveEntry(entries, entryId);
  var prev = resolveEntry(entries, wbGet().activeEntryId);
  // 离开画布条目前存档视口（文档形态期间不写存档，见 boot-prefs 的守卫）。
  if (prev && entry && prev.id !== entry.id && prev.kind === 'canvas') {
    snapshotPageViewport(active.pageId);
  }
  wbSet({ activeEntryId: entry.id });
  if (options.save !== false) saveEntryPref(active.pageId, entry.id);
  applyStageForm(entryForm(entry));
  applyEntryVisibility(panel, active.board, entry);
  if (entry.kind === 'doc') {
    if (options.scrollTop !== false && stage) stage.scrollTop = 0;
    watchDocAnnotate();   // 换了 iframe，重新绑定并刷新侧栏
  } else if (!restorePageViewportAfterMount(active.pageId)) {
    // 无存档视口的画布条目：回首访默认缩放（zoomForPage 兜底 0.5）。
    setCanvasZoom(zoomForPage(active.pageId), { save: false });
  }
  scheduleAnnSnap();
}

/* board 装载/页面切换后调用：条目行渲染由 Sidebar 的 Contents 组件从 store 派生，
   这里负责把当前条目定下来 —— prefs.activeEntryIdByPage 记忆优先，非法/缺失落默认
   条目（画布优先）。 */
export function syncEntries() {
  var active = wbGet().activeBoard;
  if (!active || active.pageId !== wbGet().activePageId) return;
  var entries = boardEntries(active.board);
  if (!entries.length) {
    wbSet({ activeEntryId: null });
    applyPageFormFallback(active.pageId);
    return;
  }
  setActiveEntry(entryPrefFor(active.pageId) || defaultEntryId(entries), { scrollTop: false, save: false });
}

export function showPageManifestError(error) {
  wbSet({ pageManifestError: String(error && error.message ? error.message : error) });
}

/** Registry entries surface as workbench pages, served from /sites/<id>/.
    The default 'pinpoint' entry is the workbench itself — its pages are the
    _index pages, so it is not listed again. A dead annotate API must not break
    the workbench: previews-only then. Entries without their own board.json are
    still readable: the service synthesizes a doc board (lib/synth-board.js).
    阶段 4：url 条目也进 Pages（恒 doc 壳）—— 经同源代理嵌进阅读器，
    与扩展注入并存（两条路径共用同一个 entry 标注桶）。
    阶段 8：带 page 字段的条目（pinpoint add --page）不进 Pages —— 它归属
    既有 Page 的「内容」区，这里分流入 attached 列表（stage.js loadBoard 经
    withAttachedScreens 合并成目标页的合成 doc 屏）。返回 { pages, attached }。 */
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
          var attached = [];
          var pages = [];
          entries.forEach(function (entry) {
            if (!entry || (entry.kind !== 'dir' && entry.kind !== 'file' && entry.kind !== 'url') || entry.id === 'pinpoint') return;
            if (entry.page) { attached.push(entry); return; }
            pages.push({
              id: entry.id,
              title: entry.title || entry.id,
              // 2026-08-16 阶段 2：dir 条目默认 doc 壳（文档阅读器）；
              // 只有显式 board:'ios' 上机壳，残留 'web'/缺省/未知一律落 html。
              // file 条目（阶段 3）恒 doc 壳：单个完整 HTML 文档只有阅读器语义。
              // url 条目（阶段 4）恒 doc 壳：活应用经代理嵌进文档阅读器。
              mode: entry.kind === 'dir' ? (entry.board === 'ios' ? 'ios' : 'html') : 'html',
              // 2026-08-16f 阶段 7：registry kind 透传到 manifest 页 ——
              // entriesOfActiveBoard 据此给 url 页的条目打 web 标记（「网页」tag）。
              kind: entry.kind,
              // 2026-08-17g：内容 mtime（ms epoch，server 侧 content-mtime 算出；
              // url 条目无此字段 → null，排序沉底、行内不显示时间）。
              mtime: typeof entry.mtime === 'number' ? entry.mtime : null,
              site: true
            });
          });
          return { pages: pages, attached: attached };
        });
    }
  }).catch(function () { return { pages: [], attached: [] }; });
}

export function loadPageManifest() {
  // previews/_index.local.json (gitignored) overrides the tracked manifest, so
  // an instance can keep private pages without touching versioned files. Only
  // a missing local file falls back — a broken one must surface as an error.
  // 「缺失」的判定含 dev server 的 SPA fallback：不存在路径会被喂成
  // index.html（200 + text/html），2026-08-17e 实例搬迁后该文件常态不存在，
  // 必须把「200 但不是 JSON」同样按缺失回落，否则页面清单整体加载失败。
  return queryClient.fetchQuery({
    queryKey: ['page-manifest'],
    queryFn: function () {
      return fetch('previews/_index.local.json')
        .then(function (response) {
          var type = response.headers.get('content-type') || '';
          if (response.ok && type.indexOf('json') >= 0) return response.json();
          if (!response.ok && response.status !== 404) throw new Error(String(response.status));
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
        sitePages.pages.forEach(function (page) {
          if (known[page.id]) return; // a previews page with the same id wins
          manifest.pages.push(page);
        });
        // 阶段 8：attach 条目（registry 带 page 字段）随 manifest 走——
        // stage.js loadBoard 经 withAttachedScreens 把归属本页的条目合并成
        // 合成 doc 屏；目标页不存在时条目自然悬空（不合并、不出行、不报错）。
        manifest.attached = sitePages.attached;
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
  wbSet({ activePageId: pageId, focusFrameKey: null, focusAnnN: null });
  if (options.save !== false) rememberActivePage(pageId);
  if (same && !options.force) {
    // Re-clicking the active page must not fight per-page viewport memory.
    if (options.scrollTop === true) stage.scrollTo({ top: 0, behavior: 'smooth' });
    return Promise.resolve();
  }
  // stage 形态随选中条目在装载后应用（loadBoard → syncEntries，2026-08-16f 阶段 6）——
  // 条目要 board 先到位才能解析，换页途中保留旧形态，避免裸闪。
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
