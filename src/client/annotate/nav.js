// 跳转与对外接口：Esc 逐级取消、goToMark 跨页定位并闪框、getState，以及挂到
// window.pinpoint 的 API。导出 bind_nav、init_nav、installPinpointApi、goToMark、
// openMark、marksForActivePage。
import { isClosed } from '../../shared/ann-status.js';
import { isMarkBroken, markAnchorRect, markHasLiveTarget, markOnActivePage, resolveAllLiveTargets, resolveMarkAnchor, resolveMarkTarget } from './anchor.js';
import { removeTempArrow } from './arrow.js';
import { renderAll, visibleBubbleAnchors } from './bubbles.js';
import { openComposer } from './composer-open.js';
import { annotationTargetRects, closeComposer, closeMention, removeTip } from './composer.js';
import { currentWorkbenchPageId, resolve, setNavigationActive } from './dom.js';
import { clearHover } from './gesture.js';
import { whenSettled } from './ledger.js';
import { annotationSection, contentToDisplay, frameSectionFor, markByN } from './marks.js';
import { requestSync } from './persist.js';
import { lastRectSpaceOk, lastRectViewRect } from './render-geometry.js';
import { canvasStage, focusBubble } from './render.js';
import { onViewChange, perfDrain } from './schedule.js';
import { closeAnnotation, reopenAnnotation, setStatusFilter, toggleSidebar } from './sidebar.js';
import { canClearInvalid, clearInvalid, doClear, hideGhost, notify, removeMark, setBubbleLayout, setRenderComments, setStatus, showGhostForEl, showGhostForRect, syncModeClass, toggleMode } from './ui.js';
export function bind_nav(c) { ctx = c; }
var ctx;

export function init_nav() {
  ctx.markNavigation = 0;
}

/** 标注层有东西要退就退一层并返回 true；没有返回 false，这一下 Esc 留给页面。 */
function takeEscape() {
  if (document.getElementById('ann-mention')) { closeMention(); return true; }
  var tools = document.querySelector('#ann-box #ann-tools-menu');
  if (tools && !tools.hidden) {
    tools.hidden = true;
    var plus = document.querySelector('#ann-box #ann-plus');
    if (plus) { plus.setAttribute('aria-expanded', 'false'); plus.focus(); }
    return true;
  }
  if (ctx.activeComposer || document.getElementById('ann-box')) { closeComposer(); return true; }
  if (ctx.arrowFrom || ctx.drag || ctx.lasso) {
    ctx.arrowFrom = null;
    ctx.drag = null;
    removeTip();
    removeTempArrow();
    if (ctx.lasso) { ctx.lasso.remove(); ctx.lasso = null; }
    clearHover();
    return true;
  }
  // 页面自己开着的弹出层（菜单、对话框、大纲浮层）比标注模式靠前：这一下 Esc 让它先关。
  if (document.querySelector(OPEN_LAYERS)) return false;
  if (ctx.mode) { toggleMode(); return true; }
  return false;
}
var OPEN_LAYERS = '[role="menu"], .wb-ann-more-menu, [role="listbox"], dialog[open], [role="dialog"][data-state="open"], #wboutline-pop, #wbann-pop';

export function installPinpointApi() {
  // Esc 逐级退：提及列表 → 输入框的工具菜单 → 标注框 → 进行中的箭头 / 框选 → （页面开着的菜单、对话框）→ 标注模式，之后才轮到页面自己。
  // 挂在 window 的捕获段，排在被评审页面的所有监听之前：标注层接住这一下就截断，
  // 原型自己注册的 Esc（关表单、关弹窗）不会跟着一起触发（owner 2026-10-19）。
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
    ctx.markNavigation++; // 还在等首帧的跳转也一起取消
    if (!takeEscape()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  window.pinpoint = {
    render: renderAll,
    perfDrain: perfDrain,
    viewportChanged: function () { ctx.zoomDirty = true; onViewChange({ type: 'scroll', target: canvasStage() }); },
    setMode: function (on) { if (!!on !== ctx.mode) toggleMode(); },
    setNavigationActive: setNavigationActive,
    toggle: toggleMode,
    setRenderComments: setRenderComments,
    setBubbleLayout: setBubbleLayout,
    visibleBubbleAnchors: visibleBubbleAnchors,
    clear: doClear,
    clearInvalid: clearInvalid,
    removeMark: removeMark,
    setFloatingToolbar: setFloatingToolbar,
    toggleSidebar: toggleSidebar,
    hasActiveDraft: function () { return !!ctx.activeComposer; },
    cancelDraft: function () {
      if (!ctx.activeComposer) return false;
      closeComposer();
      return true;
    },
    openMark: openMark,
    goToMark: goToMark,
    closeAnnotation: closeAnnotation,
    reopenAnnotation: reopenAnnotation,
    setStatusFilter: setStatusFilter,
    getState: getState,
    retrySync: requestSync,
    resolveMarkAnchor: resolveMarkAnchor,
    resolveMarkTarget: resolveMarkTarget,
    isMarkBroken: isMarkBroken,
    contentToDisplay: contentToDisplay,
    onUpdate: function (fn) { if (typeof fn === 'function') ctx.updateListeners.push(fn); },
    // 当前账本桶 id（画布实例 = 活动页；测试与调试用，只读）。
    get entry() { return ctx.ENTRY; },
    get marks() { return ctx.marks.slice(); },
    get annotations() { return ctx.marks.slice(); },
    get pageMarks() { return marksForActivePage(); }
  };
  syncModeClass();
}

// ESC：关 mention → 取消 composer 草稿 → 取消画箭头 → 退出标注模式（组字中不响应）

function setFloatingToolbar(show) {
  ctx.floatingToolbar = !!show;
  ctx.toolbar.style.display = ctx.floatingToolbar ? 'flex' : 'none';
  notify();
}

export function openMark(n) {
  var m = ctx.marks.find(function (k) { return k.n === n; });
  if (!m) return;
  if (ctx.activeComposer) {
    if (ctx.activeComposer.persistedN === n) return;
    closeComposer(); // 当前这条先存再换
  }
  var rect = markAnchorRect(m);
  openComposer(m, rect, false);
  if (!rect) setStatus('锚点失效', true);
}

// ann-flash 到期：composer 开着时收编为其常驻高亮（原位去 class，几何不变），否则隐藏。
function endFlash() {
  ctx.flashUntil = 0;
  if (!ctx.hoverGhost || ctx.hoverGhost.hidden) return;
  if (ctx.activeComposer) ctx.hoverGhost.classList.remove('ann-flash');
  else hideGhost();
}

// Escape must also cancel jumps still waiting for their initial animation frames.
// Capture runs before the list/composer can consume the dismissal event.

// Explicit annotation navigation centers the annotation's frame once (fallback: the target + popup pair). Typing only lays out the popup.
function focusAnnotationReview(m, stageEl, wb) {
  if (!stageEl || !wb || !wb.scrollTo) return false;
  var rects = annotationTargetRects(m);
  if (!rects.length) return false;
  openMark(m.n);
  if (!ctx.activeComposer || ctx.activeComposer.persistedN !== m.n) return false;
  var box = document.getElementById('ann-box');
  ctx.activeComposer.syncLayout();
  // 列表 / 卡片点进来以标注所在 frame 居中（owner 2026-09-30：以 frame 为中心更直觉，
  // 以标注为中心会把 frame 切成一半）。输入框由 syncLayout 在 frame 旁自动让位；
  // 没有 frame 可聚焦（无 screenId / 板里找不到）才退回下面以标注 + 输入框为一对居中。
  box.style.visibility = 'hidden'; // 两条路径都要等滚动落定：flashAndOpen 在 whenScrollSettled 之后恢复
  if (m.screenId && typeof wb.focusFrame === 'function') {
    var firstLive = resolveAllLiveTargets(m)[0];
    if (wb.focusFrame(frameSectionFor(m, firstLive && firstLive.el), m.screenId)) return true;
  }
  var sr = stageEl.getBoundingClientRect();
  var area = { left: sr.left + 24, right: sr.right - 24, top: sr.top + 24, bottom: sr.bottom - 24 };
  var strip = document.getElementById('wbstrip');
  if (strip && strip.getClientRects().length) area.bottom = Math.min(area.bottom, strip.getBoundingClientRect().top - 12);
  var tabbar = document.getElementById('wbtabbar');
  if (tabbar && tabbar.getClientRects().length) area.bottom = Math.min(area.bottom, tabbar.getBoundingClientRect().top - 12);
  var left = Math.min.apply(null, rects.map(function (r) { return r.left; }));
  var top = Math.min.apply(null, rects.map(function (r) { return r.top; }));
  var width = Math.max.apply(null, rects.map(function (r) { return r.right; })) - left;
  var height = Math.max.apply(null, rects.map(function (r) { return r.bottom; })) - top;
  var pairWidth = width, pairHeight = height;
  if (width + 12 + box.offsetWidth <= area.right - area.left && Math.max(height, box.offsetHeight) <= area.bottom - area.top) {
    pairWidth += 12 + box.offsetWidth;
    pairHeight = Math.max(height, box.offsetHeight);
    ctx.activeComposer.preferredSide = 'right';
  } else if (Math.max(width, box.offsetWidth) <= area.right - area.left && height + 12 + box.offsetHeight <= area.bottom - area.top) {
    pairWidth = Math.max(width, box.offsetWidth);
    pairHeight += 12 + box.offsetHeight;
    ctx.activeComposer.preferredSide = 'below';
  }
  // Oversized selections retain zoom and center the target; the regular popup fallback still applies.
  wb.scrollTo({
    left: stageEl.scrollLeft + left - (area.left + (area.right - area.left - pairWidth) / 2),
    top: stageEl.scrollTop + top - (area.top + (area.bottom - area.top - pairHeight) / 2)
  });
  return true;
}

function flashAndOpen(m, navigation) {
  var anchor = resolveMarkAnchor(m);
  var stageEl = document.getElementById('wbstage');
  var wb = window.workbench;
  var reviewFocused = focusAnnotationReview(m, stageEl, wb);
  var frameFocused = reviewFocused || !!(
    wb && m.screenId && typeof wb.focusFrame === 'function' &&
    wb.focusFrame(frameSectionFor(m, anchor.el), m.screenId)
  );
  if (!frameFocused && anchor.live && anchor.el && stageEl) {
    var er = anchor.el.getBoundingClientRect();
    var sr = stageEl.getBoundingClientRect();
    var target = {
      top: stageEl.scrollTop + er.top - sr.top - sr.height / 2 + er.height / 2,
      left: stageEl.scrollLeft + er.left - sr.left - sr.width / 2 + er.width / 2
    };
    if (wb && wb.scrollTo) wb.scrollTo(target);
    else stageEl.scrollTo(target);
  } else if (!frameFocused && anchor.live && anchor.el && anchor.el.scrollIntoView) {
    // 独立文档 / 注入页没有 #wbstage 舞台：直接滚动文档到锚点。
    anchor.el.scrollIntoView({ block: 'center', inline: 'nearest' });
  } else if (!frameFocused && !anchor.live && m.lastRect && lastRectSpaceOk(m.lastRect) && stageEl) {
    // 幽灵跳转（pp2）：锚点失效但有 lastRect —— 滚到它最后一次在的地方。
    var gr = lastRectViewRect(m.lastRect);
    var gsr = stageEl.getBoundingClientRect();
    var gtarget = {
      top: stageEl.scrollTop + gr[1] - gsr.top - gsr.height / 2 + gr[3] / 2,
      left: stageEl.scrollLeft + gr[0] - gsr.left - gsr.width / 2 + gr[2] / 2
    };
    if (wb && wb.scrollTo) wb.scrollTo(gtarget);
    else stageEl.scrollTo(gtarget);
  } else if (!frameFocused && !anchor.live && m.lastRect) {
    // lastRect 是文档绝对坐标：居中滚到幽灵处。
    var gy = m.lastRect.y + m.lastRect.h / 2 - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, gy) });
  }
  var settled = wb && wb.whenScrollSettled ? wb.whenScrollSettled() : Promise.resolve(true);
  return settled.then(function (completed) {
    if (ctx.activeComposer && ctx.activeComposer.persistedN === m.n) {
      ctx.activeComposer.syncLayout();
      var reviewBox = document.getElementById('ann-box');
      if (reviewBox) reviewBox.style.visibility = '';
    }
    if (!completed || navigation !== ctx.markNavigation) return false;
    renderAll();
    focusBubble(m.n);
    if (anchor.live && anchor.el) {
      ctx.flashUntil = Date.now() + 1500;
      showGhostForEl(anchor.el, 'ann-flash');
      setTimeout(endFlash, 1500);
    } else if (anchor.live && m.type === 'region' && anchor.rectDoc) {
      ctx.flashUntil = Date.now() + 1500;
      showGhostForRect(anchor.rectDoc, 'ann-flash', anchor.el);
      setTimeout(endFlash, 1500);
    }
    openMark(m.n);
    return true;
  });
}

// 页 tab（ADR 0041）：标注所在的帧在另一个 tab 里时，先把那个 tab 切出来 ——
// 不挂载就没有锚点可量，后面的居中 / 闪框都无从谈起。同 tab 或存量页立刻返回。
function revealMarkTab(wb, m) {
  if (!wb || !m.screenId || typeof wb.revealFrame !== 'function') return null;
  return wb.revealFrame(m.screenId) || null;
}

export function goToMark(n) {
  var navigation = ++ctx.markNavigation;
  var m = ctx.marks.find(function (k) { return k.n === n; });
  if (!m) return Promise.resolve();
  var p = Promise.resolve();
  var wb = window.workbench;
  if (wb) {
    var crossPage = m.pageId && typeof wb.setActivePage === 'function' && m.pageId !== currentWorkbenchPageId()
      // storage-unify：行上的 pageId 不承担归属（桶 = 页），rename 后旧行带着
      // 旧 id。目标页不在页清单里就别 setActivePage —— 那会把工作台切到
      // 「页面不存在」面板、把画布换到不存在的桶，然后误报未连接；行就在
      // 本页账本里，按本页行定位。
      && (typeof wb.hasPage !== 'function' || wb.hasPage(m.pageId));
    if (crossPage) {
      // 跨页跳转 = 换页（= 换桶）。定位必须等新页账本水合落定，
      // 再按新账本里的同一 #n 取行（行对象属于新账本）。
      p = Promise.resolve(wb.setActivePage(m.pageId, { scrollTop: false })).then(function () {
        return whenSettled();
      }).then(function () {
        return revealMarkTab(wb, m);
      }).then(function () {
        var sec = annotationSection(m);
        if (sec && typeof wb.switchPage === 'function') return wb.switchPage(sec, { scroll: false });
      });
    } else {
      p = Promise.resolve(revealMarkTab(wb, m)).then(function () {
        var sec = annotationSection(m);
        if (sec && typeof wb.switchPage === 'function') return wb.switchPage(sec, { scroll: false });
      });
    }
  }
  return Promise.resolve(p).then(function () {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (navigation !== ctx.markNavigation) { resolve(false); return; }
          var fresh = markByN(n) || m;
          resolve(flashAndOpen(fresh, navigation));
        });
      });
    });
  });
}

function getState() {
  var pageMarks = ctx.marks.filter(markOnActivePage);
  var invalidScopes = new Map();
  var broken = 0;
  var live = 0;
  var hidden = 0;
  pageMarks.forEach(function (m) {
    if (markHasLiveTarget(m)) live++;
    else if (isMarkBroken(m)) broken++;
    else hidden++;
  });
  var closed = pageMarks.filter(isClosed).length;
  return {
    mode: ctx.mode,
    connected: ctx.serverOnline,
    syncError: ctx.syncError,
    paused: ctx.paused,
    floating: ctx.floatingToolbar,
    sidebar: ctx.sidebarOpen,
    renderComments: ctx.renderComments,
    bubbleLayout: ctx.bubbleLayout,
    statusFilter: ctx.statusFilter,
    count: pageMarks.length,
    countLive: live,
    countBroken: broken,
    countClosed: closed,
    countPending: pageMarks.length - closed, // 右下角计数：等 owner 验收的（open / check / done）
    countInvalid: pageMarks.filter(function (mark) { return canClearInvalid(mark, invalidScopes); }).length,
    revision: ctx.revision,
    syncing: ctx.syncing,
    unsynced: ctx.mutationVersion > ctx.syncedMutationVersion, // 请求结束不等于改动已落盘
    outbox: Object.keys(ctx.ledgerOutbox).length, // 换账本交给 outbox、还没写完的旧账本快照
    lastRectPending: ctx.lastRectPersistTimer !== null, // 防抖里、到点才发的 lastRect 写（关页时不补发）
    countHidden: hidden,
    countVisible: live,
    countAll: ctx.marks.length,
    epoch: ctx.syncEpoch,          // 账本世代（换账本 +1）
    routing: ctx.ledgerSwitching   // 账本切换未落地（hydrate 在途）
  };
}

export function marksForActivePage() {
  return ctx.marks.filter(markOnActivePage);
}

// ---------- 对外 API（workbench 切 tab 时可主动调 render；也便于脚本化）----------

