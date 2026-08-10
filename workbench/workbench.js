// Workbench shell — pages, board loader, settings, preview hot-reload (Vite dev).
import { annRowModel } from '../lib/ann-row.js';
import { BoardMountManager } from './lib/board-mount-session.js';
import {
  ContractError,
  validateBoard
} from './lib/preview-contracts.js';
import { wbGet, wbSet } from './app/store.js';
import { escHtml } from './lib/esc-html.js';
import { COMPONENTS_ID, LIB_ID, defaultShellForPage, pageBaseUrl } from './lib/page-url.js';
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
  resetBoardNavOnLoadFailure,
  wireCanvasHud
} from './board-nav.js';
import { buildBoardHtml, clearIncludeCache, fetchScreenHtml, loadFailHtml } from './screen-load.js';
import { afterMount, initPreviewMount } from './preview-mount.js';
import { wireFrameNoteEditors } from './frame-notes.js';
import {
  annotateApi,
  initAnnBridge,
  syncConnStatus,
  syncGutterComments,
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
  setTheme,
  snapshotPageViewport,
  toggleSideCollapsed
} from './boot-prefs.js';
import {
  applyPageNames,
  applySectionOpen,
  ensurePageCopyButtons,
  getLibraryScrollHandler,
  initPages,
  loadPageManifest,
  loadSettings,
  normalizeBoardMode,
  renderDocVersions,
  renderPageManifest,
  resolvePageForMode,
  setActivePage,
  setBoardMode,
  setSectionOpen,
  showPageManifestError,
  showSettings,
  showTabs,
  switchPage,
  wireLibraryScrollSpy,
  wirePref,
  wireSections
} from './pages.js';

// activePageId / boardMode / pageManifest / activeBoard / activeGroup / sectionOpen / annFilter / sideWidth / sideCollapsed 归 app/store.js（wbGet/wbSet 读写）
wbSet({ activePageId: LIB_ID });
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
var annListSig = '';          // last rendered list signature (skip rebuilds when unchanged)
var annPanelRaf = 0;          // rAF debounce token for refreshAnnPanel
var boardPanel;
var boardLoadGen = 0;
var mountManager = new BoardMountManager();

function resolveBootPageId(prefs) {
  prefs = prefs || readPrefs();
  wbSet({ boardMode: normalizeBoardMode(prefs.boardMode) });
  var manifest = wbGet().pageManifest;
  if (manifest) renderPageManifest(manifest);
  return resolvePageForMode(wbGet().boardMode, prefs.activePageId);
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
  if (allMarks.length && !wbGet().sectionOpen.annotations) {
    setSectionOpen('annotations', true, { save: false });
  }
  if (annCountEl) {
    annCountEl.textContent = allMarks.length ? '(' + allMarks.length + ')' : '';
  }
  var marks = allMarks;
  if (wbGet().annFilter === 'tab') {
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
  var sig = wbGet().annFilter + '|' + wbGet().activeGroup + '|' + rows.map(function (r) {
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
      wbSet({ annFilter: b.getAttribute('data-ann-filter') });
      annFilterBox.querySelectorAll('button').forEach(function (x) {
        x.classList.toggle('on', x === b);
      });
      savePrefs({ annFilter: wbGet().annFilter });
      var spy = getLibraryScrollHandler();
      if (wbGet().annFilter === 'tab' && spy) spy();
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

initAnnBridge({
  scheduleAnnPanel: scheduleAnnPanel
});
initBootPrefs({
  resolveBootPageId: resolveBootPageId,
  applyPageNames: applyPageNames,
  applySectionOpen: applySectionOpen
});
initPages({
  loadBoard: loadBoard,
  mountManager: mountManager,
  refreshAnnPanel: refreshAnnPanel
});
initPreviewMount({
  wireLibraryScrollSpy: wireLibraryScrollSpy,
  refreshAnnPanel: refreshAnnPanel
});
wireSections();
initBoard();
wireCanvasHud({
  setCanvasZoom: setCanvasZoom,
  onSectionJump: function () { if (wbGet().annFilter === 'tab') refreshAnnPanel(); }
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
