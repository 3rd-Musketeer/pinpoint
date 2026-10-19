// 视图调度：滚动、缩放、DOM 变动与尺寸变化合并进一帧，决定局部刷新还是整层
// 重绘。导出 bind_schedule、init_schedule、installViewScheduling、onViewChange、
// perfDrain。
import { frameInternalSelector } from '../../shared/frame-anchor.js';
import { isMarkBroken, markElementTargets, markHasLiveTarget, markOnActivePage, withLiveTargets } from './anchor.js';
import { mutationScope } from '../lib/mutation-scope.js';
import { renderAll, syncBubbleStructure, updateBubbleGeometry } from './bubbles.js';
import { geometryBatch, isUI } from './dom.js';
import { updateDraftGeometry } from './gesture.js';
import { syncCanvasPose, updateCanvasZoom, updateCountLabel, updateMarkGeometry } from './render-geometry.js';
import { canvasStage, drawableMark, prepareCanvasView, syncMarkStructure, visiblePageMarks } from './render.js';
import { notify, syncGhost } from './ui.js';
export function bind_schedule(c) { ctx = c; }
var ctx;

export function init_schedule() {
  ctx.viewRaf = 0;
  ctx.geometryDirty = false;
  ctx.zoomDirty = false;
  ctx.contentFullDirty = false;
  ctx.contentRoots = new Set();
  ctx.dirtyFrameRoots = new Set();
}

// 停驻（E2）时观察器断开、待刷新的根先记着，打开再补画。事件监听留着：
// 它们只把活记账进 contentRoots，不在停驻期间排 rAF。直接打开的画布不设这个钩子。
var viewParked = false;
var parkedObservers = [];
function noteParkedObserver(observer, reconnect) {
  parkedObservers.push({ observer: observer, reconnect: reconnect });
}
export function setViewParked(on) {
  viewParked = !!on;
  parkedObservers.forEach(function (entry) {
    if (viewParked) entry.observer.disconnect();
    else entry.reconnect();
  });
  if (!viewParked && (ctx.contentFullDirty || ctx.contentRoots.size || ctx.geometryDirty || ctx.zoomDirty)) {
    scheduleViewUpdate();
  }
}

export function installViewScheduling() {
  addEventListener('resize', onViewChange);
  // Nested frame scrollports (.ios-app, sheet body, …) do not bubble; capture
  // on document so mark geometry tracks phone scroll as well as #wbstage pan.
  document.addEventListener('scroll', onViewChange, { passive: true, capture: true });
  if (typeof MutationObserver !== 'undefined' && document.body) {
    var contentMutationObserver = new MutationObserver(function (records) {
      var dependencies;
      function selectorDependencies() {
        if (dependencies) return dependencies;
        dependencies = { relational: false, global: false };
        ctx.marks.forEach(function (m) {
          var selectors = markElementTargets(m).map(function (t) { return t.selector; });
          if (m.base) selectors.push(m.base.selector);
          if (m.move) selectors.push(m.move.to_selector);
          selectors.forEach(function (selector) {
            if (!selector) return;
            if (/:has\(|[+~]|\[style/.test(selector)) dependencies.relational = true;
            if (!frameInternalSelector(selector)) dependencies.global = true;
          });
        });
        return dependencies;
      }
      records.forEach(function (record) {
        if (!contentMutation(record)) return;
        // 失效范围一处判（mutation-scope.js）：属性变更不升级全局（K1 第三刀，
        // 2026-10-19 性能审计），样式表与结构变更仍按依赖升级。
        scheduleContentRender(mutationScope(record, selectorDependencies));
      });
    });
    contentMutationObserver.observe(document.documentElement, { attributes: true, attributeOldValue: true });
    contentMutationObserver.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
    contentMutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true
    });
    noteParkedObserver(contentMutationObserver, function () {
      contentMutationObserver.observe(document.documentElement, { attributes: true, attributeOldValue: true });
      contentMutationObserver.observe(document.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
      contentMutationObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true });
    });
  }

  ctx.observedFrames = new Map();
  ctx.frameResizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(function (entries) {
    entries.forEach(function (entry) {
      var old = ctx.observedFrames.get(entry.target);
      if (!old) return;
      var size = [entry.contentRect.width, entry.contentRect.height];
      ctx.observedFrames.set(entry.target, size);
      if (old.length && (Math.abs(old[0] - size[0]) > .1 || Math.abs(old[1] - size[1]) > .1)) {
        scheduleContentRender({ target: entry.target });
      }
    });
  });

  // Layout can also move after an image/font finishes, a CSS transition ends,
  // or a route changes without a useful DOM mutation. These are cheap fallback
  // signals and share the same rAF coalescing path.
  if (typeof ResizeObserver !== 'undefined' && document.body) {
    var contentResizeObserver = new ResizeObserver(scheduleContentRender);
    contentResizeObserver.observe(document.body);
    var observedStage = document.getElementById('wbstage');
    if (observedStage) contentResizeObserver.observe(observedStage);
    noteParkedObserver(contentResizeObserver, function () {
      contentResizeObserver.observe(document.body);
      var stage = document.getElementById('wbstage');
      if (stage) contentResizeObserver.observe(stage);
    });
  }
  document.addEventListener('load', function (event) {
    if (!annotationUiNode(event.target)) scheduleContentRender(event);
  }, true);
  // 只改绘制、不动几何的过渡不重排钉子：工作台帧 hover 的描边色 / 暗层透明度
  // 每次指针进帧都会跑完一轮，之前触发整层重建 —— 钉子被移出再插回 DOM，
  // hover 脉冲重放一次、按下中的点击丢失（2026-09-24 owner：“脉冲出现两次，
  // 第一次点击无效”）。其余过渡 / 动画按所在帧局部刷新。
  ctx.PAINT_ONLY_TRANSITION = /^(opacity|visibility|color|caret-color|fill|stroke|filter|backdrop-filter|box-shadow|text-shadow|text-decoration-color|background(-color|-image)?|outline(-color|-style|-width|-offset)?|border(-top|-right|-bottom|-left)?-color)$/;
  document.addEventListener('transitionend', function (event) {
    if (annotationUiNode(event.target) || ctx.PAINT_ONLY_TRANSITION.test(event.propertyName || '')) return;
    scheduleContentRender(event);
  }, true);
  document.addEventListener('animationend', function (event) {
    if (!annotationUiNode(event.target)) scheduleContentRender(event);
  }, true);
  addEventListener('hashchange', scheduleContentRender);
  addEventListener('popstate', scheduleContentRender);
}

// render.js 的 prepareCanvasView 在画布视图建立后调用：同步各帧的尺寸观察。
// 必须是模块级函数 —— 原来它在 IIFE 顶层，包进 install 里 render.js 就看不见了。
export function syncFrameResizeObservers(stage) {
  if (!ctx.frameResizeObserver) return;
  var current = new Set(stage.querySelectorAll('.wb-lib-item, .ios-stage, .wb-comp-stage, .wb-html-stage'));
  ctx.observedFrames.forEach(function (_, node) {
    if (!current.has(node)) { ctx.frameResizeObserver.unobserve(node); ctx.observedFrames.delete(node); }
  });
  current.forEach(function (node) {
    if (!ctx.observedFrames.has(node)) { ctx.observedFrames.set(node, []); ctx.frameResizeObserver.observe(node); }
  });
}

function refreshFrameContent(roots) {
  return withLiveTargets(function () {
    var affected = new Set();
    var changedState = false;
    ctx.marks.forEach(function (m) {
      if (!markOnActivePage(m)) return;
      var entry = ctx.markNodes[m.n];
      var touches = !entry || !entry.roots || !entry.roots.size;
      roots.forEach(function (root) {
        if (m.screenId === root.getAttribute('data-screen') || (entry && entry.roots.has(root))) touches = true;
      });
      if (touches) affected.add(m);
    });
    ctx.selectorCache.clear(); ctx.frameRoots = null;
    var visible = geometryBatch(function () {
      var list = [];
      affected.forEach(function (m) {
        var old = ctx.markFacts.get(m);
        ctx.markFacts.delete(m);
        var live = markHasLiveTarget(m), broken = isMarkBroken(m);
        if (!old || old.live !== live || old.broken !== broken) changedState = true;
        if (drawableMark(m)) list.push(m);
      });
      return list;
    });
    syncMarkStructure(visible, affected);
    prepareCanvasView(ctx.canvasView.stage, true);
    updateMarkGeometry(roots, true);
    if (changedState) {
      var pageMarks = geometryBatch(visiblePageMarks);
      syncBubbleStructure(pageMarks); updateCountLabel(pageMarks.length); notify();
    }
    updateBubbleGeometry(); updateDraftGeometry(); syncGhost();
  });
}
export function onViewChange(event) {
  var stage = canvasStage();
  if (!event || event.type !== 'scroll' || event.target !== stage) {
    var root = event && event.type === 'scroll' && event.target.closest && event.target.closest('.wb-screen');
    if (root && ctx.canvasView) ctx.dirtyFrameRoots.add(root);
    else ctx.geometryDirty = true;
  }
  scheduleViewUpdate();
}

// 标注层每帧同步工作的耗时账（canvas-diagnostics 的 viewport 采样里 drain 走）：
// 拖动卡顿时靠它区分“标注层自己慢”与“别处慢”。只存计数 / 毫秒，不含内容。
var viewPerfMax = 0;
export function perfDrain() {
  var out = viewPerfMax;
  viewPerfMax = 0;
  return out;
}

function scheduleViewUpdate() {
  if (viewParked) return;
  if (ctx.viewRaf) return;
  ctx.viewRaf = requestAnimationFrame(function () {
    ctx.viewRaf = 0;
    var perfStart = performance.now();
    if (ctx.structureDirty || ctx.contentFullDirty) { renderAll(); notify(); }
    else if (ctx.contentRoots.size && ctx.canvasView) {
      ctx.dirtyFrameRoots.forEach(function (root) { ctx.contentRoots.add(root); });
      refreshFrameContent(ctx.contentRoots);
    }
    else {
      if (!ctx.canvasView || ctx.geometryDirty) updateMarkGeometry();
      else if (ctx.dirtyFrameRoots.size) updateMarkGeometry(ctx.dirtyFrameRoots);
      else if (ctx.zoomDirty) updateCanvasZoom();
      else syncCanvasPose();
      updateBubbleGeometry();
      updateDraftGeometry();
      syncGhost();
    }
    if (ctx.activeComposer && ctx.activeComposer.syncLayout) ctx.activeComposer.syncLayout();
    ctx.geometryDirty = false; ctx.zoomDirty = false; ctx.contentFullDirty = false;
    ctx.contentRoots.clear(); ctx.dirtyFrameRoots.clear();
    var perfMs = performance.now() - perfStart;
    if (perfMs > viewPerfMax) viewPerfMax = perfMs;
  });
}

// Interactive HTML documents change views without navigating or resizing:
// tabs toggle `hidden`, dialogs change classes, and async renders replace
// children. Invalidate affected frames, with a full fallback for global changes. Ignore
// mutations made by the annotation UI itself or renderAll would observe its
// own overlay updates and loop forever.

function annotationUiNode(node) {
  var el = node && (node.nodeType === 1 ? node : node.parentElement);
  return !!(el && isUI(el));
}

function contentMutation(record) {
  if (annotationUiNode(record.target)) return false;
  if (record.target === document.documentElement && record.type === 'attributes') {
    if (record.attributeName === 'data-canvas-zoom') return false;
    if (record.attributeName === 'style') {
      var withoutViewport = function (value) { return String(value || '').split(';').filter(function (v) {
        return v.trim() && !/^\s*(--wb-board-zoom|--wb-strip-w)\s*:/.test(v);
      }).join(';'); };
      if (withoutViewport(record.oldValue) === withoutViewport(record.target.getAttribute('style'))) return false;
    }
  }
  if (record.target.id === 'wbstage' && record.type === 'attributes' && record.attributeName === 'style') {
    var withoutScrollPadding = function (value) { return String(value || '').split(';').filter(function (v) {
      return v.trim() && !/^\s*scroll-padding-bottom\s*:/.test(v);
    }).join(';'); };
    if (withoutScrollPadding(record.oldValue) === withoutScrollPadding(record.target.getAttribute('style'))) return false;
  }
  // Only the workbench-owned zoom wrap dimensions are viewport bookkeeping.
  if (ctx.canvasView && record.type === 'attributes' && record.attributeName === 'style' &&
      record.target.matches('.wb-zoom-wrap, .wb-library')) {
    var withoutSize = function (value) { return String(value || '').split(';').filter(function (v) {
      return v.trim() && !/^\s*(width|height|--wb-board-zoom)\s*:/.test(v);
    }).join(';'); };
    if (withoutSize(record.oldValue) === withoutSize(record.target.getAttribute('style'))) return false;
  }
  // Cursor/user-select changes are navigation feedback, not content layout.
  if (record.type === 'attributes' && record.attributeName === 'class' &&
      (record.target === document.body || record.target.id === 'wbstage')) {
    var withoutPan = function (value) {
      return String(value || '').split(/\s+/).filter(function (c) {
        return c && c !== 'wb-panning' && c !== 'wb-space-pan';
      }).sort().join(' ');
    };
    if (withoutPan(record.oldValue) === withoutPan(record.target.className)) return false;
  }
  if (record.type !== 'childList') return true;
  var changed = Array.prototype.slice.call(record.addedNodes || [])
    .concat(Array.prototype.slice.call(record.removedNodes || []));
  return changed.some(function (node) { return !annotationUiNode(node); });
}

function scheduleContentRender(event) {
  var target = event && event.target;
  if (target && target.nodeType !== 1) target = target.parentElement;
  var root = target && target.closest && target.closest('.wb-screen');
  if (ctx.canvasView && root) ctx.contentRoots.add(root);
  else ctx.contentFullDirty = true;
  scheduleViewUpdate();
}

