// 钉子结构：哪些标注该画、徽章与箭头节点的增删、气泡显隐，以及画布坐标系。
// 导出 bind_render、init_render、drawableMark、syncMarkStructure、canvasStage、
// focusBubble、visiblePageMarks 等。
import { annStatusOf, filterIncludesStatus } from '../../shared/ann-status.js';
import { isMarkBroken, markElementTargets, markHasLiveTarget, markOnActivePage, resolveAllLiveTargets, resolveMarkSelector, resolveMarkTarget } from './anchor.js';
import { svgArrow, updateArrowGeometry } from './arrow.js';
import { markGeometryKey, placeDocBubble, updateCanvasBubble } from './bubbles.js';
import { syncFrameResizeObservers } from './schedule.js';
import { geometryBatch, stageOrigin } from './dom.js';
import { openMark } from './nav.js';
export function bind_render(c) { ctx = c; }
var ctx;

export function init_render() {
  ctx.bubbleShowN = null;
  ctx.bubbleFocusN = null;
  ctx.bubbleEnterT = 0;
  ctx.bubbleLeaveT = 0;
}

/** 状态筛选筛掉哪些钉子：pending = 不画 closed；closed = 只画灰钉。 */
function filterDrawsStatus(m) {
  return filterIncludesStatus(ctx.statusFilter, m && m.status);
}

/** Live marks on the active page that should be drawn on the canvas.
    pp2：close 不画（除非筛选选中 closed）；锚点失效但有 lastRect 的画幽灵框；
    正在编辑的草稿行（live target 分支）让位给 composer 的草稿视觉。 */
export function drawableMark(m) {
  if (!filterDrawsStatus(m)) return false;
  if (markHasLiveTarget(m)) {
    return !(ctx.activeComposer && ctx.activeComposer.m.type === 'element' && ctx.activeComposer.persistedN === m.n);
  }
  return !!(m.lastRect && isMarkBroken(m));
}

export function visiblePageMarks() {
  var out = [];
  ctx.marks.forEach(function (m) {
    if (ctx.activeComposer && ctx.activeComposer.m.type === 'element' && ctx.activeComposer.persistedN === m.n) return;
    if (!markOnActivePage(m)) return;
    if (!drawableMark(m)) return;
    out.push(m);
  });
  return out;
}

function removePartNodes(part) {
  if (!part) return;
  if (part.frame && part.frame.parentNode) part.frame.parentNode.removeChild(part.frame);
  if (part.badge && part.badge.parentNode) part.badge.parentNode.removeChild(part.badge);
}

function removeMarkNode(entry) {
  if (!entry) return;
  if (entry.parts) entry.parts.forEach(removePartNodes);
  else removePartNodes(entry);
  if (entry.arrow && entry.arrow.parentNode) entry.arrow.parentNode.removeChild(entry.arrow);
}

/* 评论卡的显示源（2026-09-04 评审板 H）：hover 钉子（120ms 延迟，扫过不闪）
   或该条刚被定位。离开钉子给 90ms 宽限，指针可以移到卡上继续读。 */

export function toggleBubbleClasses() {
  var on = ctx.bubbleShowN != null ? ctx.bubbleShowN : ctx.bubbleFocusN;
  Object.keys(ctx.bubbleNodes).forEach(function (n) {
    ctx.bubbleNodes[n].node.classList.toggle('ann-bubble--show', String(on) === String(n));
  });
  Object.keys(ctx.markNodes).forEach(function (n) {
    (ctx.markNodes[n].parts || []).forEach(function (part) {
      if (part.badge) part.badge.classList.toggle('ann-badge--on', String(on) === String(n));
    });
  });
}

export function syncBubbleVisibility() {
  toggleBubbleClasses();
  if (ctx.canvasView) updateCanvasBubble();
  else placeDocBubble(); // 非画布：新点亮的卡此刻才算位置（C4 起只摆点亮的那张）
}

export function showBubbleFor(n, delay) {
  clearTimeout(ctx.bubbleLeaveT);
  clearTimeout(ctx.bubbleEnterT);
  ctx.bubbleEnterT = setTimeout(function () {
    ctx.bubbleShowN = n;
    syncBubbleVisibility();
  }, delay || 0);
}

export function hideBubbleSoon() {
  clearTimeout(ctx.bubbleEnterT);
  clearTimeout(ctx.bubbleLeaveT);
  ctx.bubbleLeaveT = setTimeout(function () {
    ctx.bubbleShowN = null;
    syncBubbleVisibility();
  }, 90);
}

/** 定位反馈：那一条的钉子点亮、卡跟着出，3s 后交还给 hover。 */
export function focusBubble(n) {
  ctx.bubbleFocusN = n;
  syncBubbleVisibility();
  setTimeout(function () {
    if (ctx.bubbleFocusN !== n) return;
    ctx.bubbleFocusN = null;
    syncBubbleVisibility();
  }, 3000);
}

function wireMarkBadge(badge, n) {
  // 按下就打开（owner 2026-10-19：“点击已有的标注的小圆圈，无法直接弹出标注框，必须点击 hover 显示的标注气泡”）。
  // 等 click 不稳：悬浮卡在按下后 120 ms 浮出，主线程排队时按下和抬起之间它会挪到指针下面，
  // 按下在钉子、抬起在卡上，浏览器就不派 click，两边都不开。
  var pressedAt = 0;
  badge.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pressedAt = Date.now();
    openMark(n);
  });
  badge.addEventListener('click', function (e) {
    e.stopPropagation();
    if (Date.now() - pressedAt < 1000) return; // 按下时已经开过
    openMark(n);
  });
  badge.addEventListener('mouseenter', function () { showBubbleFor(n, 120); });
  badge.addEventListener('mouseleave', hideBubbleSoon);
}

export function placeArrow(entry, from, to) {
  if (!entry.arrow) {
    entry.arrow = svgArrow(from, to, entry.m.n);
    (entry.group ? entry.group.node : ctx.marksLayer).appendChild(entry.arrow);
    return;
  }
  updateArrowGeometry(entry.arrow, from, to);
}

function statusBadgeClass(m) {
  var st = annStatusOf(m);
  return st === 'open' ? '' : ' ann-badge--' + st;
}

export function syncMarkStructure(pageMarks, affected) {
  if (!affected) resetCanvasView();
  var targets = geometryBatch(function () {
    return pageMarks.map(function (m) { return m.type === 'region' ? null : resolveAllLiveTargets(m); });
  });
  var keep = Object.create(null);
  if (affected) Object.keys(ctx.markNodes).forEach(function (key) {
    if (!affected.has(ctx.markNodes[key].m)) keep[key] = true;
  });
  pageMarks.forEach(function (m, index) {
    keep[m.n] = true;
    var entry = ctx.markNodes[m.n];
    // 幽灵：锚点失效但有 lastRect 时也在画布上留一格（虚线框 + 序号钉）。
    var ghost = m.type !== 'region' && !targets[index].length && !!m.lastRect;
    var frameClass = m.type === 'region' ? 'ann-frame' : (ghost ? 'ann-ghost-rect' : 'ann-target');
    var wantParts = m.type === 'region' ? 1 : (targets[index].length || (ghost ? 1 : 0));

    if (!entry) {
      entry = { m: m, parts: [], arrow: null };
      ctx.markNodes[m.n] = entry;
    } else {
      entry.m = m;
    }

    while (entry.parts.length > wantParts) {
      removePartNodes(entry.parts.pop());
    }
    while (entry.parts.length < wantParts) {
      var frame = document.createElement('div');
      frame.className = frameClass;
      var badge = document.createElement('div');
      badge.className = 'ann-badge' + statusBadgeClass(m);
      badge.textContent = m.n;
      wireMarkBadge(badge, m.n);
      ctx.marksLayer.appendChild(frame);
      ctx.marksLayer.appendChild(badge);
      entry.parts.push({ frame: frame, badge: badge });
    }

    entry.parts.forEach(function (part) {
      if (part.frame.className !== frameClass) part.frame.className = frameClass;
      if (part.badge.textContent !== String(m.n)) part.badge.textContent = m.n;
      var wantBadge = 'ann-badge' + statusBadgeClass(m);
      if (part.badge.className !== wantBadge) part.badge.className = wantBadge;

    });
    entry.signature = markGeometryKey(m);
    entry.liveTargets = targets[index];
    entry.model = null;

    if (!m.move && entry.arrow) {
      if (entry.arrow.parentNode) entry.arrow.parentNode.removeChild(entry.arrow);
      entry.arrow = null;
    }
  });
  Object.keys(ctx.markNodes).forEach(function (key) {
    if (keep[key]) return;
    removeMarkNode(ctx.markNodes[key]);
    delete ctx.markNodes[key];
  });
  ctx.structureDirty = false;
}

export function clearMarkArrow(entry) {
  if (entry.arrow && entry.arrow.parentNode) entry.arrow.parentNode.removeChild(entry.arrow);
  entry.arrow = null;
}

export function resetCanvasView() {
  if (!ctx.canvasView) return;
  ctx.canvasView.groups.forEach(function (group) {
    while (group.node.firstChild) ctx.marksLayer.appendChild(group.node.firstChild);
    group.node.remove();
    group.entries.forEach(function (entry) { entry.group = null; });
  });
  if (ctx.marksLayer.parentNode !== ctx.overlay) ctx.overlay.insertBefore(ctx.marksLayer, ctx.overlay.firstChild);
  ctx.canvasView = null;
}

export function canvasStage() {
  var stage = document.getElementById('wbstage');
  return stage && window.workbench && window.workbench.boardMode() !== 'html' ? stage : null;
}

export function canvasPose(stage) {
  var wrap = document.querySelector('#wb-board-panel .wb-zoom-wrap');
  var r = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
  var o = stageOrigin(stage);
  return { x: r.left - o[0] + stage.scrollLeft, y: r.top - o[1] + stage.scrollTop,
    zoom: Number(document.documentElement.getAttribute('data-canvas-zoom')) || 1 };
}

function entryRoots(entry) {
  var roots = new Set();
  function add(el) { var root = el && el.closest('.wb-screen, .wb-lib-item'); if (root) roots.add(root); }
  if (entry.m.type === 'element') markElementTargets(entry.m).forEach(function (t) {
    add(resolveMarkTarget(t, entry.m.screenId));
  });
  else if (entry.m.base) add(resolveMarkSelector(entry.m.base.selector, entry.m.screenId || ''));
  else (entry.m.contains || []).forEach(function (t) { add(resolveMarkSelector(t.selector, entry.m.screenId || '')); });
  if (entry.m.move && entry.m.move.to_selector) add(resolveMarkSelector(entry.m.move.to_selector, entry.m.screenId || ''));
  return roots;
}

export function prepareCanvasView(stage, rebuild) {
  if (ctx.canvasView && !rebuild) return;
  var groups = new Map();
  if (ctx.canvasView) ctx.canvasView.groups.forEach(function (g) { g.entries = []; groups.set(g.root, g); });
  else {
    if (ctx.marksLayer.parentNode !== stage) stage.appendChild(ctx.marksLayer);
    ctx.canvasView = { stage: stage, groups: [], width: 0, height: 0, pose: canvasPose(stage) };
  }
  Object.keys(ctx.markNodes).forEach(function (key) {
    var entry = ctx.markNodes[key];
    if (!entry.model) entry.roots = entryRoots(entry);
    var root = entry.roots.values().next().value || null;
    var group = groups.get(root);
    if (!group) {
      var node = document.createElement('div');
      node.className = 'ann-mark-group'; node.setAttribute('data-ann-ui', ''); ctx.marksLayer.appendChild(node);
      group = { node: node, root: root, entries: [], bounds: null, visible: true };
      groups.set(root, group);
    }
    entry.group = group; group.entries.push(entry);
    entry.parts.forEach(function (part) {
      if (part.frame.parentNode !== group.node) group.node.appendChild(part.frame);
      if (part.badge.parentNode !== group.node) group.node.appendChild(part.badge);
    });
    if (entry.arrow && entry.arrow.parentNode !== group.node) group.node.appendChild(entry.arrow);
  });
  syncFrameResizeObservers(stage);
  ctx.canvasView.groups = Array.from(groups.values()).filter(function (g) {
    if (g.entries.length) return true;
    g.node.remove(); return false;
  });
}

