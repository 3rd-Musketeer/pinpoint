// 评论气泡：在画布上把标注正文画成卡片，稀疏放右侧、密集时左右分流，
// 以及整层重绘入口 renderAll。导出 bind_bubbles、init_bubbles、renderAll、
// updateBubbleGeometry、renderLedgerChange 等。
import { bubbleInnerHtml } from '../../shared/annotate-bubble.js';
import { annStatusOf } from '../../shared/ann-status.js';
import { MARK_BOX_PAD_PX, expandRect, intersectRects, isVisibleEnough } from '../../shared/annotate-clip.js';
import { isMarkBroken, markAnchorRect, markOnActivePage, resolveMarkAnchor, withLiveTargets } from './anchor.js';
import { beginOverlayFrame, clearAnchorCache, geometryBatch, overlayOrigin, stageOrigin, viewToOverlayRect, visibleViewRectDoc } from './dom.js';
import { computePosition, offset, shift, virtualRect } from './floating.js';
import { updateDraftGeometry } from './gesture.js';
import { bubbleMarkView } from './marks.js';
import { openMark } from './nav.js';
import { projectMark, updateCountLabel, updateMarkGeometry } from './render-geometry.js';
import { canvasStage, drawableMark, hideBubbleSoon, prepareCanvasView, showBubbleFor, toggleBubbleClasses, syncMarkStructure, visiblePageMarks } from './render.js';
import { mountOverlay, syncGhost } from './ui.js';
export function bind_bubbles(c) { ctx = c; }
var ctx;

export function init_bubbles() {
  ctx.bubbleNodes = Object.create(null);   // n → { m, node, height }
  ctx.BUBBLE_W = 186;   // 2026-09-04 评审板 H1 的评论卡宽度
  ctx.BUBBLE_MARGIN = 12;
}

// ---------- 评论气泡（"在画布渲染评论"开关）----------
// 与 pin 同一套几何管线（resolveMarkAnchor → docToView → viewToOverlayRect），
// 但独立于 标注/交互 模式：开关一开就在画布上把 content 渲染成气泡，
// 序号与 pin 对应，半透明细线指向锚点。稀疏默认放右侧，密集时左右分流。

export function clearBubbles() {
  Object.keys(ctx.bubbleNodes).forEach(function (n) {
    var node = ctx.bubbleNodes[n].node;
    if (node.parentNode) node.parentNode.removeChild(node);
    delete ctx.bubbleNodes[n];
  });
}

export function syncBubbleStructure(pageMarks) {
  if (!ctx.renderComments) { clearBubbles(); return; }
  var keep = Object.create(null);
  pageMarks.forEach(function (m) {
    if (isMarkBroken(m)) return;            // 无锚点 → 无法定位气泡
    keep[m.n] = true;
    var entry = ctx.bubbleNodes[m.n];
    if (!entry) {
      var node = document.createElement('div');
      node.className = 'ann-bubble';
      node.setAttribute('data-ann-ui', '');
      node.setAttribute('data-n', m.n);
      var html = bubbleInnerHtml(bubbleMarkView(m));
      node.innerHTML = html;
      node.addEventListener('click', function (e) {
        if (e.target.closest('.ann-bubble')) { e.stopPropagation(); openMark(m.n); }
      });
      // 指针从钉子挪到卡上 = 继续读，不收
      node.addEventListener('mouseenter', function () { showBubbleFor(m.n, 0); });
      node.addEventListener('mouseleave', hideBubbleSoon);
      ctx.bubblesLayer.appendChild(node);
      entry = ctx.bubbleNodes[m.n] = { m: m, node: node, height: 0, html: html };
    } else {
      entry.m = m;
      var nextHtml = bubbleInnerHtml(bubbleMarkView(m));
      if (entry.html !== nextHtml) {
        entry.node.innerHTML = nextHtml;
        entry.html = nextHtml;
        entry.height = 0;
      }
    }
  });
  // DOM writes above are complete before any height reads. Canvas comments
  // are measured only when hovered/focused, never once per hidden comment.
  if (!canvasStage()) Object.keys(ctx.bubbleNodes).forEach(function (n) {
    ctx.bubbleNodes[n].height = ctx.bubbleNodes[n].node.offsetHeight || 0;
  });
  Object.keys(ctx.bubbleNodes).forEach(function (n) {
    if (keep[n]) return;
    if (ctx.bubbleNodes[n].node.parentNode) ctx.bubbleNodes[n].node.parentNode.removeChild(ctx.bubbleNodes[n].node);
    delete ctx.bubbleNodes[n];
  });
}

/* 评论卡的放置（画布与注入页同一套，2026-10-19 C4 起由 @floating-ui/dom 承载）：
   钉在锚点框右侧 13px、顶对齐再上抬 6px；右边放不下翻左边；两轴都向 overlay
   收 12px 边距。旧的「钉右翻左 + clamp」四行 = right-start + offset(13, -6)
   + shift(crossAxis)，翻左用 shift 的位移回读判定：crossAxis 把放不下的 x
   往左夹（shift.x < 0）就是该翻（与旧条件 `left+bw > W-margin` 同义；卡宽
   上限 W-2*margin，不存在两边都放不下的情形）。不用 flip middleware：
   注入端按字节计费，flip 一族 helpers 不进包。
   写样式相对气泡的 offsetParent（#ann-overlay），与旧写法的坐标系一致；
   viewR 参数是视口矩形（computePosition 的参照坐标系）。 */
function placeBubble(entry, viewR) {
  var seq = entry.placeSeq = (entry.placeSeq || 0) + 1;
  function opts(placement) {
    return {
      placement: placement,
      middleware: [
        offset({ mainAxis: 13, crossAxis: -6 }),
        shift({ boundary: ctx.overlay, padding: ctx.BUBBLE_MARGIN, crossAxis: true })
      ]
    };
  }
  function write(result) {
    if (entry.placeSeq !== seq || entry.node.hidden || !entry.node.isConnected) return;
    entry.node.style.left = Math.round(result.x) + 'px';
    entry.node.style.top = Math.round(result.y) + 'px';
  }
  computePosition(virtualRect(viewR), entry.node, opts('right-start')).then(function (result) {
    if (entry.placeSeq !== seq || entry.node.hidden || !entry.node.isConnected) return;
    var moved = result.middlewareData.shift;
    if (!moved || moved.x >= 0) { write(result); return; }
    computePosition(virtualRect(viewR), entry.node, opts('left-start')).then(write);
  });
}

export function updateCanvasBubble() {
  var n = ctx.bubbleShowN != null ? ctx.bubbleShowN : ctx.bubbleFocusN;
  var bubble = ctx.bubbleNodes[n];
  if (!bubble) return;
  var mark = ctx.markNodes[n];
  var r = mark && mark.model ? projectMark(mark).parts[0] : null;
  if (!r || ctx.bubbleLayout === 'sidebar') { bubble.node.hidden = true; return; }
  var local = expandRect(r, -MARK_BOX_PAD_PX);
  local[0] -= ctx.canvasView.stage.scrollLeft; local[1] -= ctx.canvasView.stage.scrollTop;
  local = intersectRects(local, [0, 0, ctx.canvasView.width, ctx.canvasView.height]);
  if (!isVisibleEnough(local)) { bubble.node.hidden = true; return; }
  bubble.node.hidden = false;
  var bw = Math.min(ctx.BUBBLE_W, Math.max(160, ctx.canvasView.width - ctx.BUBBLE_MARGIN * 2));
  if (!bubble.height || bubble.width !== bw) {
    bubble.node.style.width = bw + 'px';
    bubble.width = bw;
    bubble.height = bubble.node.offsetHeight;
  }
  // local 是 stage 原点坐标系；参照换到视口坐标再交给库。
  var o = stageOrigin(ctx.canvasView.stage);
  placeBubble(bubble, [local[0] + o[0], local[1] + o[1], local[2], local[3]]);
}

/** 注入页里点亮的那张卡：hover / 定位换卡发生在几何帧之外，点亮当下就要摆好。
    其余卡 opacity:0 不可见，不给位置（旧实现对每张视口内的卡逐帧写 left/top/width）。 */
export function placeDocBubble() {
  if (!ctx.renderComments || ctx.canvasView || ctx.bubbleLayout === 'sidebar') return;
  var n = ctx.bubbleShowN != null ? ctx.bubbleShowN : ctx.bubbleFocusN;
  var entry = n != null ? ctx.bubbleNodes[n] : null;
  if (!entry || entry.node.hidden) return;
  beginOverlayFrame();
  var anchorDoc = markAnchorRect(entry.m);
  if (!anchorDoc) return;
  var anchorView = visibleViewRectDoc(anchorDoc, resolveMarkAnchor(entry.m).el);
  if (!anchorView) return;
  var local = viewToOverlayRect(anchorView);
  var overlayW = ctx.overlay.getBoundingClientRect().width;
  var bw = Math.min(ctx.BUBBLE_W, Math.max(160, overlayW - ctx.BUBBLE_MARGIN * 2));
  if (entry.width !== bw) {
    entry.node.style.width = Math.round(bw) + 'px';
    entry.width = bw;
  }
  var o = overlayOrigin();
  placeBubble(entry, [local[0] + o[0], local[1] + o[1], local[2], local[3]]);
}

/** 几何帧入口：画布走 updateCanvasBubble；注入页逐卡收 hidden（锚点出视口即藏，
 *  跟 Word 的页边批注同一条规矩），位置只算点亮的那张（placeDocBubble）。 */
export function updateBubbleGeometry() {
  if (!ctx.renderComments) return;
  if (ctx.canvasView) { updateCanvasBubble(); return; }
  beginOverlayFrame();
  // sidebar 模式：iframe 内不画气泡（由父级 workbench 在右侧 gutter 渲染）。
  if (ctx.bubbleLayout === 'sidebar') {
    Object.keys(ctx.bubbleNodes).forEach(function (n) { ctx.bubbleNodes[n].node.hidden = true; });
    return;
  }
  var overlayH = ctx.overlay.getBoundingClientRect().height;
  Object.keys(ctx.bubbleNodes).forEach(function (n) {
    var entry = ctx.bubbleNodes[n];
    var anchorDoc = markAnchorRect(entry.m);
    if (!anchorDoc) { entry.node.hidden = true; return; }
    var anchorView = visibleViewRectDoc(anchorDoc, resolveMarkAnchor(entry.m).el);
    if (!anchorView) { entry.node.hidden = true; return; }
    var local = viewToOverlayRect(anchorView);
    if (local[1] + local[3] < 0 || local[1] > overlayH) { entry.node.hidden = true; return; }
    entry.node.hidden = false;
  });
  placeDocBubble();
  toggleBubbleClasses();
}

/** 给父级 workbench 用（gutter 模式）：返回当前视口内可见锚点的 rect（iframe 视口坐标）
 *  + 文本，供父级映射到自己的坐标系后在右侧 gutter 渲染气泡。rect 原点为 iframe 视口
 *  左上，与 ctx.overlay（position:fixed; inset:0）一致。 */
export function visibleBubbleAnchors() {
  if (!ctx.renderComments || ctx.bubbleLayout !== 'sidebar') return [];
  beginOverlayFrame();
  var overlayH = ctx.overlay.getBoundingClientRect().height;
  var out = [];
  visiblePageMarks().forEach(function (m) {
    if (isMarkBroken(m)) return;
    var anchorDoc = markAnchorRect(m);
    if (!anchorDoc) return;
    var anchorView = visibleViewRectDoc(anchorDoc, resolveMarkAnchor(m).el);
    if (!anchorView) return;
    var local = viewToOverlayRect(anchorView);
    if (local[1] + local[3] < 0 || local[1] > overlayH) return;
    var view = bubbleMarkView(m);
    out.push({
      n: m.n,
      rect: [Math.round(local[0]), Math.round(local[1]), Math.round(local[2]), Math.round(local[3])],
      cap: view.cap,
      content: view.content,
      // 阅读态分段：父级 gutter 卡和画布悬浮卡画同一套目标文字 pill。
      segments: view.segments
    });
  });
  return out;
}

// 钉子结构签名：几何字段之外还要带状态 —— 状态决定钉子颜色，也决定当前筛选下画不画
// （pending 不画 close）。只比几何时，列表里点“完成”几何没变，钉子不重画，
// 颜色和去留都停在原态，刷新才对（2026-09-28 owner 报）。
export function markGeometryKey(m) {
  return JSON.stringify([m.type, m.pageId, m.screenId, m.section, m.group,
    m.selector, m.targets, m.rect, m.base, m.contains, m.move, annStatusOf(m)]);
}

// Ledger replacements can change one comment without invalidating every DOM anchor.
export function renderLedgerChange() {
  if (!ctx.canvasView) { renderAll(); return; }
  return withLiveTargets(function () {
    var affected = new Set(), present = new Set();
    ctx.selectorCache.clear(); ctx.frameRoots = null;
    var pageMarks = geometryBatch(function () {
      return ctx.marks.filter(function (m) {
        if (!markOnActivePage(m)) return false;
        present.add(String(m.n));
        var entry = ctx.markNodes[m.n];
        if (entry && entry.signature === markGeometryKey(m)) {
          var fact = ctx.markFacts.get(entry.m);
          if (fact) ctx.markFacts.set(m, fact);
          entry.m = m;
        } else {
          if (entry) entry.m = m;
          ctx.markFacts.delete(m); affected.add(m);
        }
        return drawableMark(m);
      });
    });
    Object.keys(ctx.markNodes).forEach(function (key) {
      if (!present.has(key)) affected.add(ctx.markNodes[key].m);
    });
    if (affected.size) {
      syncMarkStructure(pageMarks.filter(function (m) { return affected.has(m); }), affected);
      prepareCanvasView(ctx.canvasView.stage, true);
      var entries = new Set();
      affected.forEach(function (m) { if (ctx.markNodes[m.n]) entries.add(ctx.markNodes[m.n]); });
      updateMarkGeometry(new Set(), false, entries);
    }
    ctx.structureDirty = false;
    syncBubbleStructure(pageMarks); updateBubbleGeometry(); updateDraftGeometry();
    updateCountLabel(pageMarks.length); syncGhost();
  });
}

export function renderAll() {
  if (!ctx.overlay.isConnected || !ctx.chromeLayer.isConnected) mountOverlay();
  return withLiveTargets(function () {
    clearAnchorCache();
    if (!canvasStage() && ctx.frameResizeObserver) { ctx.frameResizeObserver.disconnect(); ctx.observedFrames.clear(); }
    var pageMarks = geometryBatch(visiblePageMarks);
    syncMarkStructure(pageMarks);
    updateMarkGeometry();
    syncBubbleStructure(pageMarks);
    updateBubbleGeometry();
    updateDraftGeometry();
    updateCountLabel(pageMarks.length);
    syncGhost();
  });
}
