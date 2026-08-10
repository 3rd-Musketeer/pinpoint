// Workbench 页面/manifest/设置簇 — 页面集合与模式、manifest 加载、页面切换、
// doc 版本切换、侧栏壳、设置视图。P1a 从 workbench.js 平移
// （goal-20260810-workbench-react-rebuild）：零行为变化。
// 共享状态经 app/store.js 的 wbGet()/wbSet() 读写；工具函数取自 lib/。
import { wbGet, wbSet } from './app/store.js';
import { readPrefs, savePrefs } from './lib/prefs.js';
import { iosTimeFromInput } from './lib/ios-time.js';
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
import { openDocExportDialog } from './export-core.js';
import { loadFailHtml } from './screen-load.js';
import {
  applyClock,
  applyLockFont,
  refit,
  restorePrefs,
  setCanvasZoom,
  setFrame,
  setTextSize,
  snapshotPageViewport
} from './boot-prefs.js';
import { annotateApi, stopGutter, watchDocAnnotate } from './ann-bridge.js';

// 反向依赖注入：loadBoard / mountManager / refreshAnnPanel 还留在 workbench.js
// （后续轮次才拆），pages.js 不得 import workbench.js，由它在初始化时经
// initPages(deps) 注入。（boot-prefs / ann-bridge 簇走直接 import。）
var pagesDeps = {};

export function initPages(deps) {
  pagesDeps = deps || {};
}

var pagesNav = document.getElementById('wbpages');
var boardModeBox = document.getElementById('wbboard-mode');
var stage = document.getElementById('wbstage');
var sideScroll = document.getElementById('wbside-scroll');
var footEl = document.getElementById('wbfoot');
var settingsEl = document.getElementById('wbsettings');
var gearBtn = document.getElementById('wbgear');
var wbRoot = document.getElementById('wbroot') || document.querySelector('.wb');
var libraryScrollHandler;
var activeDocByPage = {};    // pageId → screenId，切页回来记得上次看的版本

export function setSectionOpen(name, open, options) {
  options = options || {};
  wbGet().sectionOpen[name] = !!open;
  var sec = document.querySelector('[data-section="' + name + '"]');
  if (sec) {
    sec.classList.toggle('open', wbGet().sectionOpen[name]);
    var head = sec.querySelector('.wb-section-head');
    if (head) head.setAttribute('aria-expanded', String(wbGet().sectionOpen[name]));
  }
  if (options.save !== false) savePrefs({ sectionOpen: wbGet().sectionOpen });
}

export function applySectionOpen() {
  Object.keys(wbGet().sectionOpen).forEach(function (name) {
    setSectionOpen(name, wbGet().sectionOpen[name], { save: false });
  });
}

export function wireSections() {
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

export function scrollToGroup(groupId, options) {
  options = options || {};
  wbSet({ activeGroup: groupId });
  updateSectionNavigatorActive(groupId);
  var el = document.getElementById('lib-' + groupId);
  if (el) el.scrollIntoView({ behavior: options.smooth === false ? 'auto' : 'smooth', block: 'start' });
  refit();
  pagesDeps.refreshAnnPanel();
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
      pagesDeps.refreshAnnPanel();
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
        if (wbGet().annFilter === 'tab') pagesDeps.refreshAnnPanel();
      }
    });
  };
  stage.addEventListener('scroll', libraryScrollHandler, { passive: true });
}

/** 标注簇（还在 workbench.js）切到 tab 过滤时要重跑一次当前 spy handler。 */
export function getLibraryScrollHandler() {
  return libraryScrollHandler;
}

export function syncPagesNav(pageId) {
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

export function ensurePageCopyButtons() {
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

// ios = 手机原型（fragment + 机身 chrome）
// web = web app 画板（fragment，无机身）
// html = 完整独立 HTML 文档（汇报页一类），iframe 承载，见 shell "doc"
var BOARD_MODES = { ios: true, web: true, html: true };

export function normalizeBoardMode(mode) {
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
  var panel = document.getElementById('wb-board-panel');
  if (!panel) return;
  var screens = docScreensOfActiveBoard();
  if (!screens.length) return;
  var ids = screens.map(function (sc) { return sc.id; });
  if (ids.indexOf(screenId) < 0) screenId = ids[0];
  var active = wbGet().activeBoard;
  if (active) activeDocByPage[active.pageId] = screenId;

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
  if (docVersionsNav) {
    docVersionsNav.querySelectorAll('[data-doc-screen]').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-doc-screen') === screenId);
    });
  }
  if (options.scrollTop !== false && stage) stage.scrollTop = 0;
  watchDocAnnotate();   // 换了 iframe，重新绑定并刷新侧栏
}

export function renderDocVersions() {
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

export function syncBoardModeUi(mode) {
  mode = normalizeBoardMode(mode);
  if (!boardModeBox) return;
  boardModeBox.querySelectorAll('[data-board-mode]').forEach(function (btn) {
    var on = btn.getAttribute('data-board-mode') === mode;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if (wbRoot) wbRoot.setAttribute('data-board-mode', mode);
}

export function renderPageManifest(manifest) {
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
  if (docVersionsNav && mode !== 'html') { docVersionsNav.hidden = true; docVersionsNav.innerHTML = ''; }
  var manifest = wbGet().pageManifest;
  if (manifest) renderPageManifest(manifest);
  var nextPageId = resolvePageForMode(mode, options.pageId);
  rememberActivePageForMode(mode, nextPageId);
  if (options.save !== false) savePrefs({ boardMode: mode });
  return setActivePage(nextPageId, { force: options.force === true, save: options.save !== false });
}

export function showPageManifestError(error) {
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

export function loadPageManifest() {
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
  return pagesDeps.loadBoard(panel, pageId).then(function () {
    // Viewport restore happens in afterMount; do not reset to origin here.
  });
}

export function showTabs() {
  settingsEl.hidden = true;
  if (sideScroll) sideScroll.hidden = false;
  if (footEl) footEl.hidden = false;
  gearBtn.classList.remove('on');
}

export function showSettings() {
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

export function wirePref(root, id, attr, setter) {
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
export function loadSettings() {
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

export function applyPageNames(names) {
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
