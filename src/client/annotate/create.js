// 新建标注：点选生成元素标注、框选生成区域标注，算下一个 #n，然后打开
// 标注框。导出 bind_create、nextN、newElementMark、newRegionMark、regionContains。
import { pickContained } from '../lib/annotate-hit-test.js';
import { hasLayout, stampTargetMeta } from './anchor.js';
import { openComposer } from './composer-open.js';
import { annContentSurface, cssPath, docRect, excerpt, isUI, ppIdOf, resolve, screenIdOf, stampPage } from './dom.js';
import { newMarkId } from './marks.js';
export function bind_create(c) { ctx = c; }
var ctx;

// ---------- 新建标注 ----------
// nextN 只做保存应答回来前的临时显示：#n 的取号权在服务端（M1），应答回来
// 按 id 认领覆盖（adoptServerNumbers）。
export function nextN() { return ctx.marks.reduce(function (m, k) { return Math.max(m, k.n); }, 0) + 1; }

export function newElementMark(el) {
  var selector = cssPath(el);
  var text = excerpt(el);
  var ppId = ppIdOf(el);
  var m = stampPage({
    n: nextN(),
    id: newMarkId(),
    type: 'element',
    selector: selector,
    text: text,
    targets: [{ ref: 'i1', selector: selector, text: text, ppId: ppId || undefined, screenId: screenIdOf(el) || undefined }],
    rect: docRect(el),
    content: ''
  });
  stampTargetMeta(m, el);
  openComposer(m, docRect(el), true);
  if (ctx.hoverEl === el) ctx.hoverEl = null;
}

export function regionContains(rect) {
  var board = document.getElementById('wb-board-panel') || document.body;
  // Scope candidates to preview surfaces only — avoids walking the whole
  // workbench DOM (sidebar/nav/overlay) which made querySelectorAll('*') hot.
  var roots = Array.prototype.slice.call(board.querySelectorAll('.ios-screen, .wb-comp-stage'));
  if (!roots.length) roots = [board];
  var candidates = [];
  for (var ri = 0; ri < roots.length; ri++) {
    var walker = document.createTreeWalker(roots[ri], NodeFilter.SHOW_ELEMENT, null);
    while (walker.nextNode()) {
      var el = walker.currentNode;
      if (isUI(el) || !annContentSurface(el)) continue;
      if (!hasLayout(el)) continue;
      var r = docRect(el);
      candidates.push({
        rect: r,
        selector: cssPath(el),
        parentSelector: el.parentElement ? cssPath(el.parentElement) : undefined,
        text: excerpt(el)
      });
    }
  }
  return pickContained(candidates, rect);
}

export function newRegionMark(rect) {
  var contains = regionContains(rect);
  // 记录锚元素当时的坐标：重绘时按锚元素的位移平移原始框，保住用户画的框形状
  var base = null;
  for (var i = 0; i < contains.length; i++) {
    var el = resolve(contains[i].selector);
    if (el) { base = { selector: contains[i].selector, rect: docRect(el) }; break; }
  }
  var m = stampPage({
    n: nextN(),
    id: newMarkId(),
    type: 'region',
    rect: rect,
    contains: contains,
    base: base,
    content: ''
  });
  var anchorEl = base ? resolve(base.selector) : (contains[0] ? resolve(contains[0].selector) : null);
  stampTargetMeta(m, anchorEl);
  openComposer(m, rect, true);
}
