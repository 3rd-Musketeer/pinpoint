// 命中与几何：哪些元素可选（annTarget）、cssPath / ppId、视口与 overlay
// 坐标换算，以及一次测量批次的缓存。导出 bind_dom、init_dom 和这些查询函数。
import { clipByRects, isVisibleEnough } from '../../shared/annotate-clip.js';

import { clearHover } from './gesture.js';
import { onViewChange } from './schedule.js';
import { hideGhost } from './ui.js';
export function bind_dom(c) { ctx = c; }
var ctx;

export function init_dom() {
  ctx.FRAME_SEL = '.ios-stage, .wb-comp-stage, .wb-screen-err';
  ctx.geometryCache = null;
  ctx.canvasView = null;
  ctx.measuringCanvas = false;
  ctx.navigationActive = false;
  ctx.selectorCache = new Map();
  ctx.frameRoots = null;
  ctx.markFacts = new WeakMap();
  ctx._originCache = null;
  ctx._overlayBoxCache = null;
  ctx._stageOriginCache = null;
}

// ---------- 工具 ----------
export function isUI(el) { return !!(el && el.closest && el.closest('[data-ann-ui]')); }

export function currentWorkbenchPageId() {
  try {
    if (window.workbench && typeof window.workbench.activePageId === 'function') {
      return window.workbench.activePageId() || '';
    }
  } catch (e) { /* ignore */ }
  return '';
}

export function stampPage(m) {
  var pid = currentWorkbenchPageId() || (ctx.FRAME ? ctx.FRAME.pageId : '');
  if (pid) m.pageId = pid;
  return m;
}

// 可选范围（与 board-navigation BOARD_FRAME_SELECTOR 对齐）：
//   1) frame chrome（屏标题 / bezel / keys / screen-err 面板）→ 整机 frame
//   2) .ios-screen / .wb-comp-stage 内部 → 叶子元素；Alt/⌥ 升到 frame
//   3) 独立 HTML 文档 / HTML 板 iframe（无 #wb-board-panel）→ 整份 body 即 surface
//   4) .wb-lib-item 且不在 frame 内 → section
// 画布空白、侧栏等一律不可选

/** True when this annotate.js instance is the document itself (not the workbench shell). */
function isPlainDocument() {
  return !document.getElementById('wb-board-panel');
}

function annScreen(el) {
  return el && el.closest && el.closest('.ios-screen');
}

function annComp(el) {
  return el && el.closest && el.closest('.wb-comp-stage');
}

// Plain docs (file://, HTML-board iframe) annotate their whole body — there is
// no board chrome to keep unselectable. Workbench board pages have no such
// surface: there the selectable regions are .ios-screen / .wb-comp-stage.
// （2026-09-04：web 壳退役后的 .wb-html-surface 命中分支已删，见 BACKLOG。）
function annDocumentSurface(el) {
  if (!el) return null;
  if (!isPlainDocument() || !document.body) return null;
  if (el === document.body || document.body.contains(el)) return document.body;
  return null;
}

export function annContentSurface(el) {
  return annScreen(el) || annComp(el) || annDocumentSurface(el);
}

function annFlow(el) {
  return el && el.closest && el.closest('.wb-lib-item[data-ann-section], .wb-lib-item[data-ann-group]');
}

function annFrame(el) {
  return el && el.closest && el.closest(ctx.FRAME_SEL);
}

function isFrameNode(el) {
  return !!(el && el.matches && el.matches(ctx.FRAME_SEL));
}

/** Resolve canonical frame node; screen caption sits beside the stage. */
function resolveFrame(el) {
  var frame = annFrame(el);
  if (frame) return frame;
  var screen = el && el.closest && el.closest('.wb-screen');
  if (!screen) return null;
  return screen.querySelector(ctx.FRAME_SEL) || null;
}

/** Screen caption, phone chrome outside .ios-screen, or load-error stage. */
function isFrameChrome(el) {
  if (!el || !el.closest) return false;
  if (el.closest('.wb-screen-cap')) return true;
  if (el.matches && el.matches('.wb-screen-err')) return true;
  if (el.closest('.wb-screen-err')) return true;
  var frame = annFrame(el);
  if (!frame) return false;
  // Comp stage: only the stage root itself counts as chrome.
  if (frame.classList && frame.classList.contains('wb-comp-stage')) {
    return el === frame;
  }
  // Phone: device/bezel/keys/root/stage, but not anything inside .ios-screen.
  if (annScreen(el)) return false;
  return !!(el.closest('.ios-device, .ios-bezel, .ios-key, .ios-root, .ios-stage'));
}

/**
 * Resolve annotate hit. opts.promoteFrame (Alt/⌥) climbs content → frame.
 */
export function annTarget(el, opts) {
  opts = opts || {};
  if (!el || isUI(el) || el === document.body || el === document.documentElement) return null;

  if (isFrameChrome(el)) {
    return resolveFrame(el);
  }

  var surface = annContentSurface(el);
  if (surface) {
    if (opts.promoteFrame) {
      return resolveFrame(el) || surface;
    }
    return el;
  }

  // Section only when outside any frame (caption already handled above).
  if (annFrame(el)) return null;
  var flow = annFlow(el);
  return flow || null;
}

export function annTargetAt(x, y, opts) {
  return annTarget(document.elementFromPoint(x, y), opts);
}

export function classifyTarget(el) {
  if (!el) return 'annotation';
  if (el.classList && el.classList.contains('wb-lib-item')) return 'section';
  if (isFrameNode(el)) return 'frame';
  return 'annotation';
}

export function screenIdOf(el) {
  var s = el && el.closest && el.closest('.wb-screen[data-screen]');
  return s ? (s.getAttribute('data-screen') || '') : '';
}

export function sectionOf(el) {
  var g = el && el.closest && el.closest('[data-ann-section], [data-ann-group]');
  if (!g) return null;
  var id = g.getAttribute('data-ann-section') || g.getAttribute('data-ann-group') || '';
  var label = g.getAttribute('data-ann-section-label')
    || g.getAttribute('data-ann-group-label')
    || id;
  return { section: id, sectionLabel: label };
}

export function cssPath(el) {
  if (!el || el === document.body || el.nodeType !== 1) return 'body';
  var parts = [];
  while (el && el !== document.body && el.nodeType === 1) {
    if (el.id) { parts.unshift('#' + el.id); break; }
    var tag = el.tagName.toLowerCase();
    var cls = (el.classList[0] && !/^ann-/.test(el.classList[0])) ? '.' + el.classList[0] : '';
    var i = 1, sib = el;
    while ((sib = sib.previousElementSibling)) { if (sib.tagName === el.tagName) i++; }
    parts.unshift(tag + cls + ':nth-of-type(' + i + ')');
    el = el.parentElement;
  }
  return parts.join(' > ');
}

// 决定 #15：编译页的宿主元素都带 data-pp-id（文件:行@n，源码在锚就在）。
// 取目标时存它进 target.ppId；cssPath + 文本照存作兜底。命中元素自己没有
// （机壳 wrapper 等）就取最近带标祖先 —— 锚到组件根等价于锚到它内部的
// wrapper。工作台 chrome 不打这个属性，closest 爬不出 frame 之外。
export function ppIdOf(el) {
  if (!el || !el.closest) return '';
  var hit = el.closest('[data-pp-id]');
  return hit ? (hit.getAttribute('data-pp-id') || '') : '';
}

export function docRect(el) {
  var r = viewRect(el);
  return [r[0] + scrollX, r[1] + scrollY, r[2], r[3]];
}

// A measurement batch reads layout once per element before painting any marks.
export function clearAnchorCache() {
  ctx.selectorCache.clear(); ctx.frameRoots = null; ctx.markFacts = new WeakMap();
}
export function markFact(m) {
  var fact = ctx.markFacts.get(m);
  if (!fact) { fact = {}; ctx.markFacts.set(m, fact); }
  return fact;
}

export function geometryBatch(fn) {
  if (ctx.geometryCache) return fn();
  ctx.geometryCache = { rects: new WeakMap(), styles: new WeakMap(), clips: new WeakMap() };
  try { return fn(); } finally { ctx.geometryCache = null; }
}

function geometryStyle(el) {
  if (!ctx.geometryCache) return getComputedStyle(el);
  if (!ctx.geometryCache.styles.has(el)) ctx.geometryCache.styles.set(el, getComputedStyle(el));
  return ctx.geometryCache.styles.get(el);
}

export function setNavigationActive(on) {
  ctx.navigationActive = !!on;
  if (ctx.navigationActive) { clearHover(); hideGhost(); }
  else onViewChange();
}

export function viewRect(el) {
  if (ctx.geometryCache && ctx.geometryCache.rects.has(el)) return ctx.geometryCache.rects.get(el);
  var r = el.getBoundingClientRect();
  var rect = ctx.measuringCanvas ? [r.left, r.top, r.width, r.height] : [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  if (ctx.geometryCache) ctx.geometryCache.rects.set(el, rect);
  return rect;
}

/** Overflow / screen ancestors that visually clip `el` (viewport rects). */
function clipAncestorViewRects(el) {
  if (ctx.geometryCache && ctx.geometryCache.clips.has(el)) return ctx.geometryCache.clips.get(el);
  var clips = [];
  var node = el && el.parentElement;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    // The fixed overlay clips the viewport. Cached canvas geometry must retain
    // off-screen portions so translating it back into view never needs a remeasure.
    if (ctx.measuringCanvas && ctx.canvasView && node === ctx.canvasView.stage) break;
    var force = node.classList && (
      node.classList.contains('ios-screen') ||
      node.classList.contains('wb-comp-stage')
    );
    if (force) {
      clips.push(viewRect(node));
    } else {
      var st = geometryStyle(node);
      if ((st.overflowX && st.overflowX !== 'visible') ||
          (st.overflowY && st.overflowY !== 'visible')) {
        clips.push(viewRect(node));
      }
    }
    node = node.parentElement;
  }
  if (ctx.geometryCache) ctx.geometryCache.clips.set(el, clips);
  return clips;
}

/** Target's viewport rect intersected with clip ancestors; null if scrolled out. */
export function visibleViewRectOf(el) {
  if (!el) return null;
  var clipped = clipByRects(viewRect(el), clipAncestorViewRects(el));
  return isVisibleEnough(clipped) ? clipped : null;
}

/** Doc-space rect → clipped viewport rect using `clipEl`'s ancestors. */
export function visibleViewRectDoc(rectDoc, clipEl) {
  if (!rectDoc) return null;
  var clipped = clipByRects(docToView(rectDoc), clipEl ? clipAncestorViewRects(clipEl) : []);
  return isVisibleEnough(clipped) ? clipped : null;
}

export function viewPointInClips(viewP, clipEl) {
  if (!viewP) return false;
  var clips = clipEl ? clipAncestorViewRects(clipEl) : [];
  for (var i = 0; i < clips.length; i++) {
    var c = clips[i];
    if (viewP[0] < c[0] || viewP[1] < c[1] ||
        viewP[0] >= c[0] + c[2] || viewP[1] >= c[1] + c[3]) {
      return false;
    }
  }
  return true;
}

export function hidePartNodes(part) {
  if (!part) return;
  if (part.frame) part.frame.style.display = 'none';
  if (part.badge) part.badge.style.display = 'none';
}

export function showPartNodes(part) {
  if (!part) return;
  if (part.frame) part.frame.style.display = '';
  if (part.badge) part.badge.style.display = '';
}

export function placeFixedRect(node, r) {
  node.style.left = r[0] + 'px';
  node.style.top = r[1] + 'px';
  node.style.width = r[2] + 'px';
  node.style.height = r[3] + 'px';
}

export function docPointToView(p) { return [p[0] - scrollX, p[1] - scrollY]; }
export function docToView(r) { return [r[0] - scrollX, r[1] - scrollY, r[2], r[3]]; }

// Overlay is stage-scoped (absolute inside .wb-stage-wrap); convert viewport → overlay-local.
export function overlayOrigin() {
  if (ctx._originCache) return ctx._originCache;
  var r = ctx.overlay.getBoundingClientRect();
  ctx._originCache = [Math.round(r.left), Math.round(r.top)];
  return ctx._originCache;
}
export function beginOverlayFrame() { ctx._originCache = null; ctx._stageOriginCache = null; ctx._overlayBoxCache = null; }
/* 钉子能露出来的那块（overlay-local）：#ann-overlay 自己 overflow:hidden，注入页里它贴视口
   （不含根滚动条），工作台里它铺满 .wb-stage-wrap。钉子按它收边（badgePositionInBox）。
   画布模式的钉子挂在 #wbstage 的滚动内容里、跟着帧平移，不收边：传 null。 */
export function overlayBadgeBox() {
  if (ctx.canvasView) return null;
  if (!ctx._overlayBoxCache) ctx._overlayBoxCache = [0, 0, ctx.overlay.clientWidth, ctx.overlay.clientHeight];
  return ctx._overlayBoxCache;
}
// 画布模式的标注坐标系原点 = #wbstage 的 padding box 左上（#ann-marks 挂在它的滚动内容里，随内容平移）。
export function stageOrigin(stage) {
  if (ctx._stageOriginCache) return ctx._stageOriginCache;
  var r = stage.getBoundingClientRect();
  ctx._stageOriginCache = [Math.round(r.left + stage.clientLeft), Math.round(r.top + stage.clientTop)];
  return ctx._stageOriginCache;
}
export function viewToOverlayRect(r) {
  var o = overlayOrigin();
  return [r[0] - o[0], r[1] - o[1], r[2], r[3]];
}
export function viewToOverlayPoint(p) {
  var o = overlayOrigin();
  return [p[0] - o[0], p[1] - o[1]];
}
export function placeOverlayRect(node, viewR) {
  beginOverlayFrame();
  placeFixedRect(node, viewToOverlayRect(viewR));
}

export function excerpt(el) {
  // section container: use section title, avoid stuffing the whole screen into text
  if (el && el.classList && el.classList.contains('wb-lib-item')) {
    // 图注带 mono 引用号（2026-08-15）：label 属性与标题同值且不含引用号，优先读它
    var cap = el.querySelector('.wb-lib-cap');
    var label = el.getAttribute('data-ann-section-label') ||
      el.getAttribute('data-ann-group-label') ||
      (cap && (cap.innerText || cap.textContent)) ||
      el.getAttribute('data-ann-section') ||
      el.getAttribute('data-ann-group') || '';
    return String(label).replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  // frame shell: screen caption / data-screen, not the whole phone innerText
  if (isFrameNode(el)) {
    var screen = el.closest && el.closest('.wb-screen[data-screen]');
    var scap = screen && screen.querySelector('.wb-screen-cap');
    // 图注两行结构（2026-08-15）：屏名在 .wb-cap-title，mono 引用号不进标注文案
    var scapTitle = scap && scap.querySelector('.wb-cap-title');
    var flabel = (scapTitle && (scapTitle.innerText || scapTitle.textContent)) ||
      (scap && (scap.innerText || scap.textContent)) ||
      (screen && screen.getAttribute('data-screen')) ||
      (el.classList && el.classList.contains('wb-screen-err') ? 'Error' : '') ||
      'Frame';
    return String(flabel).replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  var t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return t.slice(0, 120);
}

export function resolve(sel) {
  if (ctx.selectorCache.has(sel)) {
    var cached = ctx.selectorCache.get(sel);
    if (!cached || cached.isConnected) return cached;
  }
  var el = null;
  try { el = document.querySelector(sel); } catch (e) { /* Invalid selector is an unresolved anchor. */ }
  ctx.selectorCache.set(sel, el);
  return el;
}
