// 钉子几何：测量锚点、投影到画布、跟随缩放平移，以及 lastRect 的防抖落盘。
// 导出 bind_render_geometry、init_render_geometry、updateMarkGeometry、
// syncCanvasPose、lastRectViewRect 等。
import { MARK_BOX_PAD_PX, badgePositionInBox, expandRect, intersectRects } from '../../shared/annotate-clip.js';
import { moveEndPoint, resolveMarkAnchor, resolveMarkSelector } from './anchor.js';
import { beginOverlayFrame, docPointToView, docRect, docToView, geometryBatch, hidePartNodes, overlayBadgeBox, placeFixedRect, showPartNodes, stageOrigin, viewPointInClips, viewRect, viewToOverlayRect, visibleViewRectDoc, visibleViewRectOf } from './dom.js';
import { persist } from './persist.js';
import { canvasPose, canvasStage, clearMarkArrow, placeArrow, prepareCanvasView, resetCanvasView } from './render.js';
import { onViewChange } from './schedule.js';
export function bind_render_geometry(c) { ctx = c; }
var ctx;

export function init_render_geometry() {
  ctx.lastRectPersistTimer = null;
}

function cacheMarkGeometry(geometry) {
  var pose = ctx.canvasView.pose;
  function point(p) { return [(p[0] - pose.x) / pose.zoom, (p[1] - pose.y) / pose.zoom]; }
  geometry.entry.model = {
    parts: geometry.parts.map(function (r) {
      if (!r) return null;
      var rect = expandRect(r, -MARK_BOX_PAD_PX);
      return point(rect).concat([rect[2] / pose.zoom, rect[3] / pose.zoom]);
    }),
    arrow: geometry.arrow ? { from: point(geometry.arrow.from), to: point(geometry.arrow.to) } : null
  };
  geometry.parts.forEach(function (part, i) { if (!part) hidePartNodes(geometry.entry.parts[i]); });
  geometry.entry.paintPose = null;
}

export function projectMark(entry) {
  var pose = ctx.canvasView.pose, model = entry.model;
  function point(p) { return [p[0] * pose.zoom + pose.x, p[1] * pose.zoom + pose.y]; }
  return { entry: entry, parts: model.parts.map(function (r) {
    return r ? expandRect(point(r).concat([r[2] * pose.zoom, r[3] * pose.zoom])) : null;
  }), arrow: model.arrow ? { from: point(model.arrow.from), to: point(model.arrow.to) } : null };
}

function markLocalRect(viewR) {
  if (!ctx.measuringCanvas) return viewToOverlayRect(viewR);
  var stage = ctx.canvasView.stage, o = stageOrigin(stage);
  return [viewR[0] - o[0] + stage.scrollLeft, viewR[1] - o[1] + stage.scrollTop, viewR[2], viewR[3]];
}

/** lastRect 的坐标系与记录端一致才可消费（§2b）：同一条标注会在画布与注入
    frame 两边先后被测量，后写的覆盖先写的 —— 不带 space 的话另一
    边只能拿错坐标画框。旧记录没有 space：按当前端解释（保持既有行为），
    下一次活锚点测量就会写成带 space 的新记录。 */
export function lastRectSpaceOk(lr) {
  if (!lr || !lr.space) return true;
  return lr.space === (ctx.canvasView ? 'canvas' : 'doc');
}

function recordLastRect(m, docR) {
  // lastRect = 最后一次锚点解析成功的几何：几何变了才更新（±1px 守卫见下），
  // 坐标约定见 lastRectFromDoc：画布端存板上内容坐标，注入页存窗口文档坐标，
  // 记录时用 space 标明是哪一把尺子。
  // 亚像素抖动不算「变」：zoom 进出往返后 pose 带浮点残差，同一元素重算
  // 会在取整边界上 ±1 跳 —— 差不足 1px 时保持原值，省掉无谓的落盘。
  if (!docR || !m) return;
  var prev = m.lastRect;
  // 守卫附带 space 相等：换了尺子的记录哪怕数字巧合相同也是实质变化，照写。
  if (prev && prev.space === (ctx.canvasView ? 'canvas' : 'doc')
      && Math.abs(prev.x - docR[0]) < 1 && Math.abs(prev.y - docR[1]) < 1 &&
      Math.abs(prev.w - docR[2]) < 1 && Math.abs(prev.h - docR[3]) < 1) return;
  m.lastRect = { x: Math.round(docR[0]), y: Math.round(docR[1]), w: Math.round(docR[2]), h: Math.round(docR[3]), space: ctx.canvasView ? 'canvas' : 'doc' };
  if (m.screenId) m.lastRect.screenId = m.screenId;
  // 变了就要落盘（review R4）：旧约定是「合并进下一次 persist」，但新标注
  // 创建后的首次 persist 常发生在几何管线跑过之前，此后也只在碰巧有别的
  // 写盘时才更新 —— 页面一关，重开后的幽灵框就是陈旧位置或根本不画。
  // debounce 到几何安定再写一次；epoch 捕获在 timer 里再校验，切账本后
  // 的迟到触发不把旧账本的 lastRect 写进新账本。
  if (ctx.lastRectPersistTimer) clearTimeout(ctx.lastRectPersistTimer);
  var epoch = ctx.syncEpoch;
  ctx.lastRectPersistTimer = setTimeout(function () {
    ctx.lastRectPersistTimer = null;
    if (epoch !== ctx.syncEpoch || ctx.ledgerSwitching) return;
    persist();
  }, 600);
}

/* lastRect 的坐标约定（记录与消费必须同一把尺子）：
 * 注入页没有舞台滚动，docRect（视口 + 窗口滚动）就是稳定的文档坐标；
 * 画布端的滚动发生在 #wbstage，docRect 会随 pan 漂移，必须换成板上内容
 * 坐标（= 几何缓存的模型坐标：pan 不变、zoom 无关），否则幽灵框消费时
 * 会把当前舞台滚动再算一遍，把框推出视口、组可见性跟着把它藏掉。 */
function lastRectFromDoc(doc) {
  if (!doc) return null;
  if (!ctx.canvasView) return doc;
  var pose = ctx.canvasView.pose, o = stageOrigin(ctx.canvasView.stage), zoom = pose.zoom || 1; // 与 canvasPose 同一把原点
  return [
    (doc[0] - scrollX + ctx.canvasView.stage.scrollLeft - o[0] - pose.x) / zoom,
    (doc[1] - scrollY + ctx.canvasView.stage.scrollTop - o[1] - pose.y) / zoom,
    doc[2] / zoom, doc[3] / zoom
  ];
}

/** lastRect → 当前视口矩形（幽灵框绘制与跳转共用；注入页 = 文档转视口）。 */
export function lastRectViewRect(lr) {
  if (!lr) return null;
  if (!ctx.canvasView) return docToView([lr.x, lr.y, lr.w, lr.h]);
  var pose = ctx.canvasView.pose, o = stageOrigin(ctx.canvasView.stage), zoom = pose.zoom || 1; // 与 canvasPose 同一把原点
  return [
    o[0] + lr.x * zoom + pose.x - ctx.canvasView.stage.scrollLeft,
    o[1] + lr.y * zoom + pose.y - ctx.canvasView.stage.scrollTop,
    lr.w * zoom, lr.h * zoom
  ];
}

function measureMark(entry) {
  var m = entry.m;
  var views = [], els = [];
  if (m.type === 'region') {
    var anchor = resolveMarkAnchor(m);
    els.push(anchor.el);
    views.push(anchor.live ? visibleViewRectDoc(anchor.rectDoc, anchor.el) : null);
    if (anchor.live) recordLastRect(m, lastRectFromDoc(anchor.rectDoc));
  } else {
    (entry.liveTargets || []).forEach(function (target) {
      els.push(target.el);
      views.push(visibleViewRectOf(target.el));
    });
    if (entry.liveTargets && entry.liveTargets.length) recordLastRect(m, lastRectFromDoc(docRect(entry.liveTargets[0].el)));
    // 幽灵框：没有活锚点但有 lastRect —— 在它最后一次的位置画虚线框；
    // 坐标系的尺子对不上（另一端写进的）不画，只留列表行的「锚点失效」。
    if (!views.length && m.lastRect && lastRectSpaceOk(m.lastRect) && (m.status || 'open') !== 'close') {
      views.push(lastRectViewRect(m.lastRect));
    }
  }
  var parts = views.map(function (r) { return r ? expandRect(markLocalRect(r)) : null; });
  var arrow = null;
  if (m.move && views[0]) {
    var endDoc = moveEndPoint(m);
    var endEl = m.move.to_selector ? resolveMarkSelector(m.move.to_selector, m.screenId || '') : els[0];
    if (endDoc && viewPointInClips(docPointToView(endDoc), endEl)) {
      var fromRect = m.type === 'region' ? parts[0] : markLocalRect(views[0]);
      var to = markLocalRect([endDoc[0] - scrollX, endDoc[1] - scrollY, 0, 0]);
      arrow = { from: [fromRect[0] + fromRect[2] / 2, fromRect[1] + fromRect[3] / 2], to: [to[0], to[1]] };
    }
  }
  return { entry: entry, parts: parts, arrow: arrow };
}

function paintMark(geometry) {
  var entry = geometry.entry;
  entry.parts.forEach(function (part, i) {
    var local = geometry.parts[i];
    if (!local) { hidePartNodes(part); return; }
    showPartNodes(part);
    placeFixedRect(part.frame, local);
    var pos = badgePositionInBox(local, overlayBadgeBox());
    part.badge.style.left = pos.left + 'px';
    part.badge.style.top = pos.top + 'px';
  });
  if (geometry.arrow) placeArrow(entry, geometry.arrow.from, geometry.arrow.to);
  else clearMarkArrow(entry);
}

function geometryBounds(updates) {
  var x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  function include(r) {
    if (!r) return;
    x = Math.min(x, r[0]); y = Math.min(y, r[1]);
    right = Math.max(right, r[0] + r[2]); bottom = Math.max(bottom, r[1] + r[3]);
  }
  updates.forEach(function (item) {
    item.parts.forEach(include);
    if (item.arrow) { include(item.arrow.from.concat([1, 1])); include(item.arrow.to.concat([1, 1])); }
  });
  return x === Infinity ? null : [x - 24, y - 24, right - x + 48, bottom - y + 48];
}

// #ann-marks lives inside #wbstage's scroll content, so native scrolling moves the HTML and
// the marks together. Only frame groups entering/leaving the (padded) viewport change visibility. No mark
// selectors, target rects or ancestor styles are read on this path.
export function syncCanvasPose() {
  if (!ctx.canvasView) return;
  var pose = ctx.canvasView.pose;
  var sx = ctx.canvasView.stage.scrollLeft, sy = ctx.canvasView.stage.scrollTop;
  // 画布由浏览器原生滚动，组的显隐只能在下一帧才追上；四周各多留半屏，边缘的框不会晚一帧才冒出来。
  var mx = ctx.canvasView.width / 2, my = ctx.canvasView.height / 2;
  var viewport = [(sx - pose.x - mx) / pose.zoom, (sy - pose.y - my) / pose.zoom,
    (ctx.canvasView.width + 2 * mx) / pose.zoom, (ctx.canvasView.height + 2 * my) / pose.zoom];
  ctx.canvasView.groups.forEach(function (group) {
    var visible = !!intersectRects(group.bounds, viewport);
    if (visible !== group.visible) { group.visible = visible; group.node.style.display = visible ? '' : 'none'; }
    if (!visible) return;
    group.entries.forEach(function (entry) {
      if (!entry.model || entry.paintPose === pose) return;
      paintMark(projectMark(entry)); entry.paintPose = pose;
    });
  });
}

function frameLayoutRect(root) {
  if (!root) return null;
  var el = root.matches('.wb-screen') ? root.querySelector('.ios-stage, .wb-comp-stage, .wb-html-stage, .wb-screen-err') : root;
  if (!el) return null;
  var pose = ctx.canvasView.pose, r = markLocalRect(viewRect(el));
  return [(r[0] - pose.x) / pose.zoom, (r[1] - pose.y) / pose.zoom, r[2] / pose.zoom, r[3] / pose.zoom];
}

export function updateMarkGeometry(dirtyRoots, layoutChanged, dirtyEntries) {
  var stage = canvasStage();
  if (ctx.canvasView && ctx.canvasView.stage !== stage) resetCanvasView();
  beginOverlayFrame();
  if (stage) prepareCanvasView(stage);
  var updates = [];
  ctx.measuringCanvas = !!ctx.canvasView;
  try {
    geometryBatch(function () {
      if (ctx.canvasView) {
        ctx.canvasView.pose = canvasPose(stage);
        var overlayRect = viewRect(ctx.overlay);
        ctx.canvasView.width = overlayRect[2]; ctx.canvasView.height = overlayRect[3];
        // Frame layout changes can move neighbours without changing their contents.
        ctx.canvasView.groups.forEach(function (group) {
          var old = group.box;
          var box = !dirtyRoots || layoutChanged ? frameLayoutRect(group.root) : old;
          group.box = box;
          var dx = old && box ? box[0] - old[0] : 0, dy = old && box ? box[1] - old[1] : 0;
          var resized = old && box && (Math.abs(old[2] - box[2]) > .1 || Math.abs(old[3] - box[3]) > .1);
          group.entries.forEach(function (entry) {
            var dirty = dirtyEntries ? dirtyEntries.has(entry) : (!dirtyRoots || !entry.model || !group.root || resized);
            if (!dirtyEntries && dirtyRoots && entry.roots) entry.roots.forEach(function (root) { if (dirtyRoots.has(root)) dirty = true; });
            if (!dirty && (dx || dy)) {
              if (entry.roots.size > 1) dirty = true;
              else {
                entry.model.parts.forEach(function (r) { if (r) { r[0] += dx; r[1] += dy; } });
                if (entry.model.arrow) { entry.model.arrow.from[0] += dx; entry.model.arrow.from[1] += dy;
                  entry.model.arrow.to[0] += dx; entry.model.arrow.to[1] += dy; }
              }
            }
            if (dirty) updates.push(measureMark(entry));
          });
        });
      } else updates = Object.keys(ctx.markNodes).map(function (key) { return measureMark(ctx.markNodes[key]); });
    });
  } finally { ctx.measuringCanvas = false; }
  if (ctx.canvasView) {
    updates.forEach(cacheMarkGeometry);
    ctx.canvasView.groups.forEach(function (group) {
      group.bounds = geometryBounds(group.entries.map(function (entry) { return entry.model; }).filter(Boolean));
    });
    syncCanvasPose();
  } else updates.forEach(paintMark);
}

export function updateCanvasZoom() {
  if (!ctx.canvasView) { onViewChange(); return; }
  beginOverlayFrame(); ctx.canvasView.pose = canvasPose(ctx.canvasView.stage);
  syncCanvasPose();
}

export function updateCountLabel(shown) {
  ctx.elCount.textContent = shown + ' 条' + (ctx.marks.length > shown ? ' · 共 ' + ctx.marks.length : '');
}

