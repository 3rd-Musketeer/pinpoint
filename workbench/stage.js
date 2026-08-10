// Workbench stage entry（P4 由 workbench.js 正名）— 舞台侧命令式入口与装配：
// board 加载编排（loadBoard/initBoard + 各簇 DI 布线）、window.workbench API、
// 舞台交互（splitter / space·中键 pan / ctrl+wheel zoom）、preview HMR（SSE →
// Query 失效 → 重载）、boot 偏好应用。React chrome 入口在 app/main.jsx。
import { BoardMountManager } from './lib/board-mount-session.js';
import {
  ContractError,
  validateBoard
} from './lib/preview-contracts.js';
import { wbGet, wbSet } from './app/store.js';
import { queryClient } from './app/query-client.js';
import { COMPONENTS_ID, LIB_ID, defaultShellForPage, modeForPage, pageBaseUrl, pageEntry, parseDeepLink } from './lib/page-url.js';
import {
  activeDocExportTarget,
  buildExportSnapshot,
  requestDocExport,
  requestExportImage
} from './export-core.js';
import { readPrefs, savePrefs } from './lib/prefs.js';
import { clampCanvasZoom, currentCanvasZoom } from './lib/canvas-zoom.js';
import {
  focusWorkbenchFrame,
  isTypingTarget,
  resetBoardNavOnLoadFailure
} from './board-nav.js';
import { buildBoardHtml, fetchScreenHtml, loadFailHtml } from './screen-load.js';
import { afterMount, initPreviewMount } from './preview-mount.js';
import { wireFrameNoteEditors } from './frame-notes.js';
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
  applyPageNames,
  initPages,
  loadPageManifest,
  normalizeBoardMode,
  resolvePageForMode,
  setActivePage,
  setBoardMode,
  showPageManifestError,
  switchPage,
  syncDocVersions,
  wireLibraryScrollSpy
} from './pages.js';
import { startDeepLinkSync } from './url-sync.js';

// activePageId / boardMode / pageManifest / activeBoard / activeGroup / sectionOpen / annFilter / sideWidth / sideCollapsed 归 app/store.js（wbGet/wbSet 读写）
wbSet({ activePageId: LIB_ID });
var stage  = document.getElementById('wbstage');
var splitEl = document.getElementById('wbsplit');
var sideExpandBtn = document.getElementById('wbside-expand');
var boardPanel;
var mountManager = new BoardMountManager();

function resolveBootPageId(prefs) {
  prefs = prefs || readPrefs();
  // URL 深链（P3）优先于 prefs：?page= 直达页面（boardMode 取页面自己的 mode，
  // 与 ?mode= 冲突时以页面为准，URL 随后被 url-sync 重写为真实值）；只给 ?mode=
  // 在该模式内按 prefs/记忆/默认解析；参数缺失或 pageId 不存在才回 prefs。
  var link = parseDeepLink(location.search);
  if (link.pageId && (link.pageId === COMPONENTS_ID || pageEntry(wbGet().pageManifest, link.pageId))) {
    wbSet({ boardMode: modeForPage(wbGet().pageManifest, link.pageId) });
    return link.pageId;
  }
  wbSet({ boardMode: link.mode || normalizeBoardMode(prefs.boardMode) });
  return resolvePageForMode(wbGet().boardMode, prefs.activePageId);
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
    panel.innerHTML = buildBoardHtml(pageId, board, screenMap);
    wbSet({ activeBoard: { pageId: pageId, board: board } });
    syncDocVersions();
    watchDocAnnotate();
    return afterMount(panel, session);
  } catch (e) {
    if (wbGet().activePageId !== pageId) return null;
    mountManager.cancel();
    resetBoardNavOnLoadFailure();
    var label = e instanceof ContractError ? '契约错误' : '加载失败';
    panel.innerHTML = loadFailHtml(
      label + ' · ' + boardUrl(pageId) + ' · ' + String(e && e.message ? e.message : e)
    );
  }
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
  setBoardMode: setBoardMode,
  focusFrame: focusWorkbenchFrame,
  activePageId: function () { return wbGet().activePageId; },
  boardMode: function () { return wbGet().boardMode; },
  exportSnapshot: buildExportSnapshot,
  exportImage: requestExportImage,
  exportDoc: requestDocExport,
  activeDocExportTarget: activeDocExportTarget
};

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
      // note 存在 board.json 里 —— 页面变更一并失效该页的 frame-note 缓存
      queryClient.invalidateQueries({ queryKey: ['frame-note', id] });
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
}

(function init() {
  var prefs = readPrefs();
  applyBootPrefs(prefs, { pageId: prefs.activePageId || LIB_ID, refit: false });
})();

if (stage) {
  stage.addEventListener('scroll', scheduleViewportScrollSave, { passive: true });
}
