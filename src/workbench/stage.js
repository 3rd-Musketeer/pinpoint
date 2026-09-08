import { startCanvasDiagnostics } from './canvas-diagnostics.js';
import { whenStageScrollSettled, scrollStageTo } from './scroll-motion.js';
// Workbench stage entry（P4 由 workbench.js 正名）— 舞台侧命令式入口与装配：
// board 加载编排（loadBoard/initBoard + 各簇 DI 布线）、window.workbench API、
// 舞台交互（splitter / space·中键 pan / ctrl+wheel zoom）、preview HMR（SSE →
// Query 失效 → 重载）、boot 偏好应用。React chrome 入口在 app/main.jsx。
import { BoardMountManager } from './lib/board-mount-session.js';
import {
  ContractError,
  validateBoard
} from './lib/preview-contracts.js';
import { wbGet, wbSet, activeBoardMode, useWorkbenchStore } from './app/store.js';
import { queryClient } from './app/query-client.js';
import { COMPONENTS_ID, LIB_ID, defaultShellForPage, pageBaseUrl, pageEntry, parseDeepLink } from './lib/page-url.js';
import {
  activeDocExportTarget,
  buildExportSnapshot,
  requestDocExport,
  requestExportImage
} from './export-core.js';
import { readPrefs, savePrefs } from './lib/prefs.js';
import { clampCanvasZoom, currentCanvasZoom } from './lib/canvas-zoom.js';
import {
  clearBoardSelection,
  focusWorkbenchFrame,
  isTypingTarget,
  resetBoardNavOnLoadFailure,
  selectBoardFrame,
  selectBoardSection,
  syncBoardSelection
} from './board-nav.js';
import { buildBoardHtml, fetchScreenHtml, loadFailHtml } from './screen-load.js';
import { withAttachedScreens } from './lib/board-entries.js';
import { afterMount, initPreviewMount } from './preview-mount.js';
import {
  annotateApi,
  startAnnBridge,
  watchDocAnnotate
} from './ann-bridge.js';
import {
  applyBootPrefs,
  applySideWidth,
  initBootPrefs,
  refit,
  scheduleViewportScrollSave,
  setCanvasZoom,
  setSideCollapsed,
  snapshotPageViewport,
  toggleSideCollapsed
} from './boot-prefs.js';
import {
  applyPageFormFallback,
  applyPageNames,
  applyPageViewport,
  initPages,
  loadPageManifest,
  resolveActivePage,
  retryPageManifest,
  setActiveEntry,
  setActivePage,
  showPageManifestError,
  switchPage,
  syncEntries,
  wireLibraryScrollSpy
} from './pages.js';
import { startDeepLinkSync } from './url-sync.js';

// activePageId / pageManifest / activeBoard / activeGroup / focusFrameKey /
// sideWidth / sideCollapsed 归 app/store.js（wbGet/wbSet 读写）
wbSet({ activePageId: LIB_ID });
var stage  = document.getElementById('wbstage');
var splitEl = document.getElementById('wbsplit');
var boardPanel;
var mountManager = new BoardMountManager();

/** `?page=` 指向的 id 有没有对应对象：内置的 Component Library，或清单里的一页。 */
function deepLinkPageExists(pageId) {
  return pageId === COMPONENTS_ID || !!pageEntry(wbGet().pageManifest, pageId);
}

function resolveBootPageId(prefs) {
  prefs = prefs || readPrefs();
  // URL 深链（P3）优先于 prefs：?page= 直达页面（stage 形态取页内选中条目，
  // ?entry= 在 initBoard 里于板装载后应用；只给 ?mode= 时回 prefs.activePageId，
  // 再回该形态第一页/默认页，URL 随后被 url-sync 重写为真实值）。
  // 2026-09-04：?page= 指向不存在的页不再静默回落 —— initBoard 查 deepLinkPageExists
  // 并停在「页面不存在」面板（showMissingPage），本函数只在没有 ?page= 时被用到。
  // ?entry= 仍是静默回落（板内条目由 setActiveEntry 解析成默认条目）。
  var link = parseDeepLink(location.search);
  if (link.pageId && deepLinkPageExists(link.pageId)) return link.pageId;
  return resolveActivePage(prefs.activePageId, link.mode);
}

/**
 * 深链失效面板（2026-09-04，BACKLOG「空态与错误面板」）：`?page=<id>` 指向的 id
 * 既不在 registry 也不在本地页面清单里时停在这里，而不是静默回落到默认页 ——
 * 静默回落会让「链接坏了」看起来像「链接对但内容变了」。地址栏原样保留
 * （store.missingPageId 让 url-sync 让开），坏的 id 一直在用户眼前。
 * 左栏照常渲染：清单已经到位，别的页都还能点。
 */
function showMissingPage(pageId) {
  mountManager.cancel();
  resetBoardNavOnLoadFailure();
  wbSet({ missingPageId: pageId, activePageId: pageId, activeBoard: null, activeEntryId: null });
  applyPageFormFallback(pageId);
  boardPanel.innerHTML = loadFailHtml({
    title: '页面不存在',
    source: '?page=' + pageId,
    reason: 'registry 与本地页面清单里都没有 ' + pageId + '。',
    retry: { kind: 'page', pageId: pageId }
  });
}

function boardUrl(pageId) {
  if (pageId === COMPONENTS_ID) return 'components/board.json';
  return pageBaseUrl(wbGet().pageManifest, pageId) + 'board.json';
}

// P2：board/screen 拉取由 TanStack Query 持有（app/query-client.js）。
// 过期保护不再是 generation 计数 —— 同页并发由 fetchQuery 按 key 天然去重，
// 跨页过期在 await 后检查 activePageId；mount 会话生命周期由 mountManager 自理。
async function loadBoard(panel, pageId) {
  try {
    var rawBoard = await queryClient.fetchQuery({
      queryKey: ['board', pageId],
      queryFn: function () {
        return fetch(boardUrl(pageId)).then(function (r) {
          if (!r.ok) throw r.status;
          return r.json();
        });
      }
    });
    if (wbGet().activePageId !== pageId) return null;
    var board = validateBoard(rawBoard, {
      pageId: pageId,
      allowComponentRefs: pageId === COMPONENTS_ID,
      defaultShell: defaultShellForPage(wbGet().pageManifest, pageId)
    });
    // 阶段 8：registry attach 条目（pinpoint add --page）合并成合成 doc 屏，
    // 下游（条目派生 / 屏显隐 / 导出 / 标注分桶）全部复用 doc 屏既有管线。
    board = withAttachedScreens(board, wbGet().pageManifest && wbGet().pageManifest.attached, pageId);
    var entries = [];
    var seen = {};
    (board.sections || []).forEach(function (sec) {
      (sec.screens || []).forEach(function (entry) {
        var sc = entry;
        if (!seen[sc.id]) { seen[sc.id] = true; entries.push(sc); }
      });
    });
    var rows = await Promise.all(entries.map(function (sc) {
      return fetchScreenHtml(pageId, sc).then(function (res) {
        return { id: sc.id, res: res };
      });
    }));
    if (wbGet().activePageId !== pageId) return null;
    var screenMap = {};
    rows.forEach(function (row) { screenMap[row.id] = row.res; });
    var session = mountManager.begin(pageId);
    // 视口（2026-09-05）：页的偏好在构建 HTML 之前灌进 store —— screen-load 按它
    // 决定 doc 屏套阅读器壳还是手机屏；形态不变（两种视口都是文档形态）。
    var viewport = applyPageViewport(pageId);
    panel.innerHTML = buildBoardHtml(pageId, board, screenMap, { viewport: viewport });
    wbSet({ activeBoard: { pageId: pageId, board: board } });
    syncEntries();
    watchDocAnnotate();
    return afterMount(panel, session);
  } catch (e) {
    if (wbGet().activePageId !== pageId) return null;
    mountManager.cancel();
    resetBoardNavOnLoadFailure();
    // 装载失败没有板就没有条目可解析 —— stage 形态退回页级兜底（阶段 2 同义）。
    applyPageFormFallback(pageId);
    panel.innerHTML = loadFailHtml({
      title: e instanceof ContractError ? '契约错误' : '加载失败',
      source: boardUrl(pageId),
      reason: String(e && e.message ? e.message : e),
      retry: { kind: 'board', pageId: pageId }
    });
  }
}

function initBoard() {
  boardPanel = document.createElement('section');
  boardPanel.id = 'wb-board-panel';
  boardPanel.className = 'wb-panel wb-library-panel';
  stage.appendChild(boardPanel);
  return loadPageManifest()
    .then(function () {
      // 深链失效（2026-09-04）：?page= 指向不存在的页 = 显式面板，不静默回落。
      var boot = parseDeepLink(location.search);
      if (boot.pageId && !deepLinkPageExists(boot.pageId)) {
        showMissingPage(boot.pageId);
        return null;
      }
      return setActivePage(resolveBootPageId(readPrefs()), { force: true, scrollTop: false, save: false });
    })
    // 条目级深链（2026-08-16f 阶段 6）：?entry= 在板装载后应用 —— 未知条目 id
    // 由 setActiveEntry 的选中解析落默认条目，随后 url-sync 把 URL 重写为真实值。
    .then(function () {
      if (wbGet().missingPageId) return;
      var link = parseDeepLink(location.search);
      if (link.entry) setActiveEntry(link.entry, { save: false });
    })
    .catch(function (error) {
      showPageManifestError(error);
      return setActivePage(COMPONENTS_ID, { force: true, scrollTop: false, save: false });
    })
    // 深链写入必须在 boot 页解析完成后才启动 —— 订阅活着时任何 wbSet 都会
    // 触发 replaceState，提前启动会在 resolveBootPageId 读之前覆盖掉深链参数。
    .then(function () { startDeepLinkSync(); });
}

initBootPrefs({
  resolveBootPageId: resolveBootPageId,
  applyPageNames: applyPageNames
});
initPages({
  loadBoard: loadBoard,
  mountManager: mountManager
});
initPreviewMount({
  wireLibraryScrollSpy: wireLibraryScrollSpy
});
initBoard();

window.workbench = {
  switchPage: switchPage,
  setActivePage: setActivePage,
  setActiveEntry: setActiveEntry,
  focusFrame: focusWorkbenchFrame,
  whenScrollSettled: whenStageScrollSettled,
  scrollTo: function (target, options) { return scrollStageTo(stage, target, options); },
  activePageId: function () { return wbGet().activePageId; },
  activeEntryId: function () { return wbGet().activeEntryId; },
  // 只读派生视图（2026-08-16f 阶段 6：形态由选中条目派生，不再是页级开关）
  boardMode: function () { return activeBoardMode(); },
  exportSnapshot: buildExportSnapshot,
  exportImage: requestExportImage,
  exportDoc: requestDocExport,
  activeDocExportTarget: activeDocExportTarget
};

window.workbench.diagnostics = startCanvasDiagnostics(stage, () => wbGet().activePageId);
if (import.meta.hot) import.meta.hot.dispose(() => window.workbench.diagnostics.stop());

startAnnBridge();

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
      savePrefs({ sideWidth: wbGet().sideWidth, sideCollapsed: false });
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
      if (wbGet().sideCollapsed) setSideCollapsed(false, { save: false, refit: false });
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
    startW = wbGet().sideCollapsed ? 0 : wbGet().sideWidth;
    document.body.classList.add('wb-resizing');
    splitEl.classList.add('on');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', endDrag);
  });

  splitEl.addEventListener('click', function (e) {
    if (suppressSplitClick || dragMoved) return;
    if (wbGet().sideCollapsed) {
      e.preventDefault();
      setSideCollapsed(false, { save: true });
    }
  });

  splitEl.addEventListener('dblclick', function (e) {
    e.preventDefault();
    // Expanded: double-click collapses. Collapsed: single click already expands.
    if (!wbGet().sideCollapsed) setSideCollapsed(true, { save: true });
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
      if (wbGet().sideCollapsed) return;
      applySideWidth(wbGet().sideWidth - step);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (wbGet().sideCollapsed) {
        setSideCollapsed(false, { save: false, refit: false });
      }
      applySideWidth(wbGet().sideWidth + step);
    } else return;
    savePrefs({ sideWidth: wbGet().sideWidth, sideCollapsed: false });
    refit();
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
  var moveRaf = 0;
  var nextScroll = null;

  function flushPanMove() {
    if (moveRaf) cancelAnimationFrame(moveRaf);
    moveRaf = 0;
    if (!nextScroll) return;
    stage.scrollLeft = nextScroll.left;
    stage.scrollTop = nextScroll.top;
    nextScroll = null;
  }

  function setNavigationActive(on) {
    var ann = annotateApi();
    if (ann && ann.setNavigationActive) ann.setNavigationActive(on);
  }

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

  function endPan(e) {
    if (!pan) return;
    flushPanMove();
    var moved = pan.moved;
    pan = null;
    stage.classList.remove('wb-panning');
    document.body.classList.remove('wb-panning');
    window.removeEventListener('mousemove', onPanMove, true);
    window.removeEventListener('mouseup', endPan, true);
    setNavigationActive(false);
    if (e && e.type === 'mouseup') { e.preventDefault(); e.stopPropagation(); }
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
    e.stopPropagation();
    nextScroll = { left: pan.sl - dx, top: pan.st - dy };
    if (!moveRaf) moveRaf = requestAnimationFrame(flushPanMove);
  }

  function startPan(e) {
    pan = {
      x: e.clientX,
      y: e.clientY,
      sl: stage.scrollLeft,
      st: stage.scrollTop,
      moved: false
    };
    setNavigationActive(true);
    syncSpaceCursor();
    window.addEventListener('mousemove', onPanMove, true);
    window.addEventListener('mouseup', endPan, true);
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
    endPan();
    spaceDown = false;
    syncSpaceCursor();
  });

  // Window capture runs before the annotation client's document capture listener.
  // Explicit navigation owns the complete gesture, without changing annotation mode.
  window.addEventListener('mousedown', function (e) {
    var explicit = e.button === 1 || (e.button === 0 && spaceDown);
    var overBadge = explicit && e.target.closest('.ann-badge');
    if (!stage.contains(e.target) && !overBadge) return;
    if (activeBoardMode() === 'html' || isTypingTarget(e.target)) return;
    if (e.target.closest('[data-ann-ui]') && !overBadge) return;
    if (!explicit && annotateBlocksPan()) return;

    // Middle button always pans.
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e);
      return;
    }
    if (e.button !== 0) return;

    // Space+drag pans anywhere (including inside frames).
    if (spaceDown) {
      e.preventDefault();
      e.stopPropagation();
      startPan(e);
      return;
    }

    // Without Space: only pan on empty board chrome, never steal frame interactions.
    if (e.target.closest('.ios-stage, .wb-comp-stage, .wb-screen-err, button, a')) return;
    startPan(e);
  }, true);

  // Avoid browser autoscroll / middle-click paste while middle-panning.
  stage.addEventListener('auxclick', function (e) {
    if (e.button === 1) e.preventDefault();
  });

  window.addEventListener('click', function (e) {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
  }, true);

  /* 失败面板的两个动作（2026-09-04，BACKLOG「空态与错误面板」）。面板是板内
     HTML，板每次装载整替换 innerHTML —— 所以监听挂 stage 做事件委托。capture
     相位先于 pan / 选中判定；面板的动作容器另带 data-ann-ui，标注模式也让开。
     「回到 Pages」= 换到 Component Library（内置页，恒可装载）+ 展开左栏；
     「重试」= 失效对应的 board / screen 查询后重装当前页。深链失效面板
     （retry kind = page，2026-09-04）另走一条：重拉页面清单再解析一次那个 id，
     出现了就直接打开它，还是没有就把面板留在原地。 */
  stage.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-err-home], [data-err-retry]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.hasAttribute('data-err-home')) {
      if (wbGet().sideCollapsed) setSideCollapsed(false, { save: true });
      var home = wbGet().activePageId === COMPONENTS_ID
        ? resolveActivePage(null)
        : COMPONENTS_ID;
      setActivePage(home, { force: true });
      return;
    }
    var pageId = btn.getAttribute('data-err-page') || wbGet().activePageId;
    if (btn.getAttribute('data-err-retry') === 'page') {
      retryPageManifest().then(function () {
        if (deepLinkPageExists(pageId)) setActivePage(pageId, { force: true });
        else showMissingPage(pageId);
      });
      return;
    }
    if (btn.getAttribute('data-err-retry') === 'screen') {
      queryClient.invalidateQueries({ queryKey: ['screen', pageId, btn.getAttribute('data-err-screen')] });
    } else {
      queryClient.invalidateQueries({ queryKey: ['board', pageId] });
    }
    if (boardPanel) loadBoard(boardPanel, pageId);
  }, true);

  /* 2026-08-17 选中模型（detail 面板）：画布点选 frame/section → 右栏展示其
     detail/note。规则：图注（cap/dim 行）= 选 frame；section 大标题 = 选 section；
     frame 内部 = 原型交互，不动选中；板空白 = 清选中。标注模式下让位给标注
     客户端（同 mousedown 的 annotateBlocksPan 豁免）；pan 后的残留 click 已被
     上面 capture 相位的 suppressClick 吃掉，到这里的都是真实点击。 */
  stage.addEventListener('click', function (e) {
    if (e.button !== 0) return;
    if (annotateBlocksPan()) return;
    if (e.target.closest('[data-ann-ui]')) return;
    var cap = e.target.closest('.wb-screen-cap, .wb-screen-dim');
    if (cap) {
      var screenEl = cap.closest('[data-screen]');
      var sectionEl = cap.closest('.wb-lib-item');
      if (screenEl && sectionEl) {
        selectBoardFrame(sectionEl.getAttribute('data-ann-section'), screenEl.getAttribute('data-screen'));
      }
      return;
    }
    var secCap = e.target.closest('.wb-lib-cap');
    if (secCap) {
      var item = secCap.closest('.wb-lib-item');
      var sectionId = item && item.getAttribute('data-ann-section');
      if (sectionId && sectionId !== '_empty') selectBoardSection(sectionId);
      return;
    }
    if (e.target.closest('.wb-screen')) return;
    // 板空白（面板留白 / 组间隙）= 清选中
    clearBoardSelection();
  });

  // store 选中态 → 画布 .wb-sel 高亮同步（板重载 innerHTML 替换后 activeBoard
  // 写入同样触发本订阅，class 自动重挂）。
  useWorkbenchStore.subscribe(function () { syncBoardSelection(); });
})();

if (import.meta.hot) {
  import.meta.hot.on('preview:update', function (data) {
    if (!boardPanel) return;
    var id = (data && data.id) || wbGet().activePageId;
    // SSE 是唯一失效源：页面变更失效自己的 board/screen；组件变更失效组件页
    // board/screen 与全部 include（screen 缓存的是未展开的原始片段，include
    // 失效后重装载重新展开即拿到新内容）。页面变更不动 include 缓存。
    if (id === COMPONENTS_ID || (data && data.alsoActive)) {
      queryClient.invalidateQueries({ queryKey: ['board', COMPONENTS_ID] });
      queryClient.invalidateQueries({ queryKey: ['screen', COMPONENTS_ID] });
      queryClient.invalidateQueries({ queryKey: ['include'] });
    } else {
      queryClient.invalidateQueries({ queryKey: ['board', id] });
      queryClient.invalidateQueries({ queryKey: ['screen', id] });
    }
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
  // POST /registry/reload（pinpoint add 后由 CLI 触发）：失效 registry-sites
  // 查询并重拉页面清单，新登记的 dir 条目不用手动刷新就出现在 Pages。
  // 阶段 8：attach 条目在板装载时合并进目标页 —— manifest 重拉后重摆当前板，
  // add/remove --page 条目即时反映到「内容」区（目标页不是当前页时，下次切页
  // 自然合并，无需全量重载）。
  import.meta.hot.on('registry:update', function () {
    queryClient.invalidateQueries({ queryKey: ['registry-sites'] });
    loadPageManifest().then(function () {
      if (!boardPanel || !wbGet().activePageId) return;
      snapshotPageViewport(wbGet().activePageId);
      loadBoard(boardPanel, wbGet().activePageId);
    });
  });
}

(function init() {
  var prefs = readPrefs();
  applyBootPrefs(prefs, { pageId: prefs.activePageId || LIB_ID, refit: false });
})();

if (stage) {
  stage.addEventListener('scroll', scheduleViewportScrollSave, { passive: true });
}
