
// 移动箭头：拖拽时的临时箭头，以及松手后落成一条 move 标注。
// 导出 bind_arrow、init_arrow、svgArrow、finishArrow、removeTempArrow 等。
import { openComposer } from './composer-open.js';
import { removeTip } from './composer.js';
import { annTarget, cssPath, docPointToView, docRect, excerpt, placeFixedRect, viewToOverlayPoint } from './dom.js';
import { setStatus, syncGhost } from './ui.js';
export function bind_arrow(c) { ctx = c; }
var ctx;

export function init_arrow() {
  ctx.tempArrow = null;
}

// ---------- 移动箭头 ----------
export function updateArrowGeometry(svg, from, to) {
  var x = Math.min(from[0], to[0]) - 12, y = Math.min(from[1], to[1]) - 12;
  placeFixedRect(svg, [x, y, Math.abs(from[0] - to[0]) + 24, Math.abs(from[1] - to[1]) + 24]);
  svg.lastElementChild.setAttribute('d', 'M ' + (from[0] - x) + ' ' + (from[1] - y) +
    ' L ' + (to[0] - x) + ' ' + (to[1] - y));
}

export function svgArrow(from, to, id) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('data-ann-ui', '');
  if (id) svg.dataset.arrow = id;
  svg.style.cssText = 'position:absolute;pointer-events:none;z-index:2;';
  var mk = 'annArrowHead' + (id || 'tmp');
  svg.innerHTML = '<defs><marker id="' + mk + '" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#f5a623"/></marker></defs>' +
    '<path stroke="#f5a623" stroke-width="2.5" fill="none" marker-end="url(#' + mk + ')"/>';
  updateArrowGeometry(svg, from, to);
  return svg;
}

export function drawTempArrow(from, to) {
  removeTempArrow();
  ctx.tempArrow = svgArrow(viewToOverlayPoint(docPointToView(from)), viewToOverlayPoint(docPointToView(to)));
  ctx.hoverLayer.appendChild(ctx.tempArrow);
}
export function removeTempArrow() { if (ctx.tempArrow) { ctx.tempArrow.remove(); ctx.tempArrow = null; } }

export function finishArrow(pt, e) {
  removeTip();
  var m = ctx.arrowFrom; ctx.arrowFrom = null;
  if (!m) return;
  var target = annTarget(document.elementFromPoint(e.clientX, e.clientY));
  var move = { to_point: [Math.round(pt[0]), Math.round(pt[1])] };
  if (target) {
    move.to_selector = cssPath(target);
    move.to_text = excerpt(target);
    var tr = docRect(target);
    move.to_rel = [Math.round((pt[0] - tr[0]) / tr[2] * 100) / 100, Math.round((pt[1] - tr[1]) / tr[3] * 100) / 100];
  }
  m.move = move;
  setStatus('');
  var anchorRect = m.rect;
  // 写标注期间保留刚拖出的箭头 + 原有的框选框/元素高亮（openComposer 会先清理旧草稿）
  var kA = ctx.tempArrow, kL = ctx.lasso, kP = ctx.pinned;
  ctx.tempArrow = null; ctx.lasso = null; ctx.pinned = null;
  openComposer(m, anchorRect, !ctx.marks.some(function (k) { return k.id === m.id; }), { discard: true });
  ctx.tempArrow = kA; ctx.lasso = kL; ctx.pinned = kP;
  var ta = document.querySelector('#ann-input');
  if (ta && m._draft) ta.value = m._draft;
  syncGhost();
}
