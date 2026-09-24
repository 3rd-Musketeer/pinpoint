import { scrollStageTo, cancelStageScroll } from './scroll-motion.js';
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
  VIEWPORT_PHONE,
  normalizeViewport,
  phoneScaleFor,
  viewportForPage,
  withViewportPref
} from './lib/viewport.js';
import {
  modeForPage,
  pageEntry
} from './lib/page-url.js';
import { closestBoardSection } from './lib/board-navigation.js';
import { entryBoardMode, validatePageManifest } from './lib/preview-contracts.js';
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
  if (el && options.scroll !== false) {
    scrollStageTo(stage, { top: stage.scrollTop + el.getBoundingClientRect().top - stage.getBoundingClientRect().top }, options);
  }
  refit();
  scheduleAnnSnap();
}

export function switchPage(id, options) {
  options = options || {};
  showTabs();
  // Annotation API: section id within current board — or a top-level page id.
  // 认页面靠清单，不靠左栏有没有画出那一行 —— 2026-09-04 起模板页默认不显示，
  // 拿 DOM 当名单会让 `switchPage('doc-library')` 掉进 section 那条分支。
  if (pageEntry(wbGet().pageManifest, id)
      || document.querySelector('.wb-page[data-vpage="' + id + '"]')) {
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

// stage 形态（选中条目派生，lib/board-entries.js entryForm）：
// ios = 画布（手机原型 fragment + 机身 chrome）
// html = 文档（完整独立 HTML 文档，iframe 承载，见 shell "doc"；两种视口——窗口 1:1
//        铺满、手机缩成一块居中的屏——都是这个形态，data-viewport 再分）
// （2026-08-16 阶段 2：web「无机壳画板」连壳退役，残留 'web' 一律归一到 html；
// 2026-08-16f 阶段 6：形态从页级 mode 下沉到选中条目。）

/** Pages 单一列表（2026-08-16 阶段 2）：不再按模式过滤，返回全部页。 */
export function manifestPages() {
  var manifest = wbGet().pageManifest;
  if (!manifest || !manifest.pages) return [];
  return manifest.pages;
}

/* Component Library 系统页已随 pp2 退役（服务端组件板与 kit 组件目录一并删除）
   ——左栏不再前置系统行，Pages = manifest 页一份清单。 */

export function sidebarPages() {
  return manifestPages();
}

/** 登记表的分组层（folders / pageFolders / pageOrder）——左栏分组的唯一来源。 */
export function pageGrouping() {
  var manifest = wbGet().pageManifest;
  var grouping = manifest && manifest.grouping;
  return grouping || { folders: [], pageFolders: {}, pageOrder: {} };
}

function defaultPageId() {
  var pages = manifestPages();
  if (!pages.length) return '';
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
  pages.forEach(function (page) { ids[page.id] = true; });
  if (preferredId && ids[preferredId]) return preferredId;
  if (modeHint) {
    for (var i = 0; i < pages.length; i++) {
      if (modeForPage(wbGet().pageManifest, pages[i].id) === modeHint) return pages[i].id;
    }
  }
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
   回画布形态停掉父级 gutter。形态值域沿用 ios/html（html = 文档阅读器）。
   data-viewport（2026-09-05）跟着写：CSS 与 e2e 借它分辨文档形态的两种视口
   （窗口铺满 / 手机屏居中）—— 形态本身仍只有 ios / html 两个值。 */
function applyStageForm(form) {
  if (wbRoot) {
    wbRoot.setAttribute('data-page-mode', form);
    wbRoot.setAttribute('data-viewport', wbGet().viewport || 'window');
  }
  if (form === 'html') setCanvasZoom('1', { save: false });
  else stopGutter();
}

/* ---- 视口（2026-09-05，lib/viewport.js）：文档条目怎么被看 ----------------
   窗口 = 文档 1:1 铺满舞台；手机 = 同一份文档装进一块 402 × 874 的手机屏，整块屏
   缩到可用区高度的九成、在舞台里居中（不上画布：没有网格 / 缩放 / 平移 / 图注，
   owner 用过第一版后的裁决「在画布上容易乱跑」）。两种都是文档形态。
   页的偏好（prefs.viewportByPage），不进 registry、不进 URL。切换 = 重装当前板
   （screen-load 按视口决定 doc 屏套阅读器壳还是手机屏），选中条目由
   prefs.activeEntryIdByPage 记忆带回来。 */

/** 当前页的视口偏好（板装载前就要知道，所以按 pageId 读，不看 store）。 */
export function viewportOfPage(pageId) {
  return viewportForPage(readPrefs(), pageId);
}

/** 板装载入口（stage.js loadBoard）在构建 HTML 之前调：把页的视口灌进 store，
    activeBoardMode() / Strip / applyStageForm 随后读到的就是这一页的值。 */
export function applyPageViewport(pageId) {
  var viewport = viewportOfPage(pageId);
  wbSet({ viewport: viewport });
  return viewport;
}

/** 横条两段控件的动作：记偏好 → 重装当前板（两种视口都是文档形态，没有画布
    视口要存档）。 */
export function setActiveViewport(viewport) {
  viewport = normalizeViewport(viewport);
  var s = wbGet();
  var pageId = s.activePageId;
  var panel = document.getElementById('wb-board-panel');
  if (!pageId || !panel) return Promise.resolve();
  if (viewport === s.viewport) return Promise.resolve();
  savePrefs(withViewportPref(readPrefs(), pageId, viewport));
  wbSet({ viewport: viewport });
  return pagesDeps.loadBoard(panel, pageId);
}

/* 手机屏的缩放（2026-09-05）：iframe 的布局尺寸恒为 402 × 874（页面按真实手机排版），
   整块屏（.wb-phone-doc，机壳 有 = 438 × 910）用 transform: scale(k) 缩到可用区高度
   的九成 —— k 由 lib/viewport.js phoneScaleFor 纯算，这里只量尺寸、写 CSS 变量：
   .wb-screen--phone-doc 拿 --wb-phone-k 与屏的布局尺寸算自己的盒子（居中靠 flex），
   .wb-phone-doc 拿同一个 k 做 transform（index.html）。可用区 = 舞台减掉底部横条那
   一带；左栏浮在画布上，不减（与窗口视口同一条规则）。
   重算时机 = 舞台尺寸变（窗口 resize、gutter 开关改 padding）与屏的布局尺寸变
   （设置里切机壳 无 / 有），一个 ResizeObserver 同时盯这两个盒子；换板 / 换条目时
   setActiveEntry 在屏显隐定下来之后重挂（要盯的是此刻可见的那块屏，混合板上有
   几个 doc 屏就有几块）。ann-bridge 的 gutter 按「显示宽 / 布局宽」缩锚点，天然跟着。 */
var phoneScaleRo = null;

function phoneShellEl() {
  var panel = document.getElementById('wb-board-panel');
  return panel ? panel.querySelector('.wb-screen:not([data-doc-hidden]) .wb-phone-doc') : null;
}

function stripBandPx() {
  var css = getComputedStyle(document.documentElement);
  var gap = parseFloat(css.getPropertyValue('--wb-chrome-gap')) || 0;
  var strip = parseFloat(css.getPropertyValue('--wb-strip-h')) || 0;
  return gap * 2 + strip;
}

function writePhoneScale(shell) {
  var screen = shell.closest('.wb-screen');
  if (!screen || !stage) return;
  var w = shell.offsetWidth;
  var h = shell.offsetHeight;
  var k = phoneScaleFor(
    { width: stage.clientWidth, height: stage.clientHeight, stripBand: stripBandPx() },
    { width: w, height: h }
  );
  screen.style.setProperty('--wb-phone-k', String(k));
  screen.style.setProperty('--wb-phone-shell-w', w + 'px');
  screen.style.setProperty('--wb-phone-shell-h', h + 'px');
}

export function syncPhoneDocScale() {
  if (phoneScaleRo) { phoneScaleRo.disconnect(); phoneScaleRo = null; }
  var shell = wbGet().viewport === VIEWPORT_PHONE ? phoneShellEl() : null;
  if (!shell || !stage) return;
  writePhoneScale(shell);
  if (typeof ResizeObserver !== 'function') return;
  phoneScaleRo = new ResizeObserver(function () {
    if (!shell.isConnected) { syncPhoneDocScale(); return; }
    writePhoneScale(shell);
  });
  phoneScaleRo.observe(stage);
  phoneScaleRo.observe(shell);
}

/** 无条目可解析时的页级回落（空板 / 装载失败面板）：与阶段 2 的页级派生同义。 */
export function applyPageFormFallback(pageId) {
  applyStageForm(modeForPage(wbGet().pageManifest, pageId) === 'html' ? 'html' : 'ios');
  syncPhoneDocScale();
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
  cancelStageScroll();
  options = options || {};
  var panel = document.getElementById('wb-board-panel');
  var active = wbGet().activeBoard;
  if (!panel || !active || active.pageId !== wbGet().activePageId) return;
  var entries = boardEntries(active.board);
  if (!entries.length) return;
  var entry = resolveEntry(entries, entryId);
  var prev = resolveEntry(entries, wbGet().activeEntryId);
  // 离开画布形态前存档视口（文档形态期间不写存档，见 boot-prefs 的守卫）。
  if (prev && entry && prev.id !== entry.id && entryForm(prev) !== 'html') {
    snapshotPageViewport(active.pageId);
  }
  wbSet({ activeEntryId: entry.id });
  if (options.save !== false) saveEntryPref(active.pageId, entry.id);
  var form = entryForm(entry);
  applyStageForm(form);
  applyEntryVisibility(panel, active.board, entry);
  syncPhoneDocScale();
  if (form === 'html') {
    if (options.scrollTop !== false && stage) stage.scrollTop = 0;
  } else if (!restorePageViewportAfterMount(active.pageId)) {
    // 无存档视口的画布形态：回首访默认缩放（zoomForPage 兜底 0.5）。
    setCanvasZoom(zoomForPage(active.pageId), { save: false });
  }
  // 文档条目的标注实例活在 iframe 里，两种视口都要重新绑定并刷新侧栏。
  if (entry.kind === 'doc') watchDocAnnotate();
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

/** 分组层写完之后的当场生效（lib/folder-api.js 三条 PUT 的收尾）：应答就是重载
    后的完整 /registry 载荷，直接灌回 registry-sites 缓存再重建 manifest，左栏
    当场重排。HMR 的 registry:update 随后照样会到 —— 那条广播带 scope=grouping
    （审计 B2），stage.js 只重拉清单刷新左栏，不再重摆当前板。 */
export function refreshRegistry(payload) {
  if (payload) queryClient.setQueryData(['registry-sites'], registryToPages(payload));
  else queryClient.invalidateQueries({ queryKey: ['registry-sites'] });
  return loadPageManifest();
}

export function showPageManifestError(error) {
  wbSet({ pageManifestError: String(error && error.message ? error.message : error) });
}

/** 页面清单读取失败后的「重试」（2026-09-04，BACKLOG「空态与错误面板」）：
    失效清单与 registry 两条查询后重拉。与板失败面板的「重试」同一个语义 ——
    错误面板永远带一条回到可用状态的路，不要求用户刷新整页。 */
export function retryPageManifest() {
  wbSet({ pageManifestError: null });
  queryClient.invalidateQueries({ queryKey: ['page-manifest'] });
  queryClient.invalidateQueries({ queryKey: ['registry-sites'] });
  return loadPageManifest().catch(function (error) { showPageManifestError(error); });
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
        .then(registryToPages);
    }
  }).catch(function () {
    return { pages: [], attached: [], grouping: { folders: [], pageFolders: {}, pageOrder: {} } };
  });
}

/** GET /registry（也是三条 PUT 的应答）→ Pages 消费的形状。纯变换，无副作用。 */
function registryToPages(data) {
  var entries = (data && data.entries) || [];
  var attached = [];
  var pages = [];
  // 2026-09-04 分组层（ADR 0032）：条目自己的 folder / order 跟着页走，顶层三段
  // 整份透传 —— 模板页没有条目可以写字段，归属只能记在 pageFolders / pageOrder。
  var grouping = {
    folders: (data && data.folders) || [],
    pageFolders: (data && data.pageFolders) || {},
    pageOrder: (data && data.pageOrder) || {}
  };
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
      mode: entryBoardMode(entry),
      // 2026-08-16f 阶段 7：registry kind 透传到 manifest 页 ——
      // entriesOfActiveBoard 据此给 url 页的条目打 web 标记（「网页」tag）；
      // 也是横条类型标与页面行类型图标（画布 / 网页 / 文档）的来源。
      kind: entry.kind,
      addedAt: entry.addedAt || null,
      annotatedAt: entry.annotatedAt || null,
      // 2026-08-17g：内容 mtime（ms epoch，server 侧 content-mtime 算出；
      // url 条目无此字段 → null，排序沉底、行内不显示时间）。
      mtime: typeof entry.mtime === 'number' ? entry.mtime : null,
      folder: typeof entry.folder === 'string' ? entry.folder : null,
      order: Number.isFinite(entry.order) ? entry.order : null,
      site: true
    });
  });
  return { pages: pages, attached: attached, grouping: grouping, pageTimes: data.pageTimes || {} };
}

export function loadPageManifest() {
  // 页面清单 = tracked previews/_index.json（_index.local.json 覆盖机制已于 pp2
  // 切片 3 退役）。失败上抛，页面清单整体失败要响亮，不静默回落。
  return queryClient.fetchQuery({
    queryKey: ['page-manifest'],
    queryFn: function () {
      return fetch('previews/_index.json').then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
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
        manifest.pages = manifest.pages.map(page => ({ ...page, ...sitePages.pageTimes[page.id] }));
        manifest.pageTimes = sitePages.pageTimes;
        manifest.attached = sitePages.attached;
        manifest.grouping = sitePages.grouping;
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
  if (!same || options.force) cancelStageScroll();
  var _draftAnn = annotateApi();
  if (!same && _draftAnn && typeof _draftAnn.cancelDraft === 'function') {
    _draftAnn.cancelDraft();
  }
  if (!same && pagesDeps.mountManager.current && pagesDeps.mountManager.current.active && pagesDeps.mountManager.current.pageId === wbGet().activePageId) {
    snapshotPageViewport(wbGet().activePageId);
  }
  // missingPageId 在这里清空：换到任何一个真实页就离开了「页面不存在」状态，
  // url-sync 随之恢复写地址栏（stage.js showMissingPage 有理由）。
  wbSet({ activePageId: pageId, missingPageId: null, focusFrameKey: null, focusAnnN: null });
  if (options.save !== false) rememberActivePage(pageId);
  if (same && !options.force) {
    // Re-clicking the active page must not fight per-page viewport memory.
    if (options.scrollTop === true) scrollStageTo(stage, { top: 0 });
    return Promise.resolve();
  }
  // stage 形态随选中条目在装载后应用（loadBoard → syncEntries，2026-08-16f 阶段 6）——
  // 条目要 board 先到位才能解析，换页途中保留旧形态，避免裸闪。
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
