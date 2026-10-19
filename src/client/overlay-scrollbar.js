// 隐藏式滚动条（docs/design.md“滚动条”，owner 2026-10-15）：pinpoint 自己的滚动容器平时不画滚动条、不占宽；
// 指针停在容器上或容器正在滚时，贴着容器内缘浮出一条 6px 圆角灰条，像 macOS 的浮层滚动条，可拖。
//
// 为什么用一条自己画的浮条，而不是 ::-webkit-scrollbar / scrollbar-color：原生滚动条只要被定制，
// Chrome 和 Safari 就画成占宽的经典滚动条，悬停时再显出来就得让内容挤一下；Chrome 121+ 设了
// scrollbar-width / scrollbar-color 又不认 ::-webkit-scrollbar。三家都能做到的只有“原生条全藏”
// （overlay-scrollbar.css：scrollbar-width:none + ::-webkit-scrollbar{display:none}），再由这里画浮条。
//
// 一份文档装一次（installOverlayScrollbars），整页共用一横一竖两根浮条（position:fixed，挂 body；
// 容器在打开的模态 <dialog> 里时挂进那个 dialog，否则被 top layer 盖住）。哪些容器算：
//   - 整页模式（文章站点、工作台：<html data-pp-scrollbars>）：文档里所有可滚的元素；
//   - scope 模式（注入到别人页面的标注客户端）：只认 scope 选择器里的元素，页面自己的滚动不碰。
// 文档根和带 data-pp-scrollbar="scroll" 的大面（工作台画布）悬停不出条（不然指针在页面上它就一直在），
// 只在滚动时、或指针贴到条所在的边上时出。
// 带 data-pp-scrollbar="off" 的子树是被评审的内容（工作台画布上的帧）：里面的容器不出条。
// 帧在画布里按缩放画，条按未缩放的尺寸算会又长又偏；真机上这些滚动本来也没有条。
//
// 同一主题的另一半：手机视口 iframe 文档的滚动条整体藏掉（hidePhoneDocScrollbar /
// startPhoneDocScrollbar，workbench 用）。那是「这条根本不该出现」，不是「换成浮条」，
// 所以不走 installOverlayScrollbars，是本模块的第二个出口。

var BAR = 6; // 条粗
var INSET = 2; // 离容器内缘
export var MIN_THUMB = 24; // 条最短
var EDGE = 14; // 文档根 / 大面：指针离边这么近时出条
var LINGER_MS = 900; // 停止滚动后条留多久

/**
 * 一根条在轨道上的位置（纯函数）：轨道是容器可见的一段（起点、长度），条长按可见比例、不短于 MIN_THUMB。
 * 不可滚时返回 null。
 */
export function thumbGeometry(scrollPos, scrollSize, clientSize, trackStart, trackLen) {
  var range = scrollSize - clientSize;
  if (!(range > 1) || !(trackLen > 0)) return null;
  var len = Math.max(Math.min(MIN_THUMB, trackLen), Math.round(trackLen * clientSize / scrollSize));
  var travel = trackLen - len;
  var pos = Math.min(Math.max(scrollPos / range, 0), 1);
  return { start: trackStart + Math.round(travel * pos), len: len, travel: travel, range: range };
}

var AXES = {
  y: { overflow: 'overflowY', pos: 'scrollTop', size: 'scrollHeight', client: 'clientHeight' },
  x: { overflow: 'overflowX', pos: 'scrollLeft', size: 'scrollWidth', client: 'clientWidth' },
};

export function installOverlayScrollbars(doc, opts) {
  doc = doc || document;
  var scope = (opts && opts.scope) || null;
  var win = doc.defaultView;
  var prev = doc.__ppOverlayScrollbars;
  // 一份文档只装一次。标注客户端（scope 模式）可能比工作台的整页安装先到：整页的那次把范围放宽。
  if (prev) { if (!scope) prev.widen(); return prev; }
  if (!win) return null;
  var root = doc.documentElement;

  var bars = {};
  var hoverEl = { x: null, y: null };
  var active = new Map(); // 正在滚的容器 → 截止时间
  var drag = null;
  var px = -1, py = -1;
  var frame = 0;

  function makeBar(axis) {
    var el = doc.createElement('div');
    el.className = 'pp-osb';
    el.setAttribute('data-pp-osb', axis);
    el.setAttribute('data-ann-ui', ''); // 标注客户端认它是自己的 UI：不命中、不算宿主内容
    el.setAttribute('aria-hidden', 'true');
    el.addEventListener('pointerdown', function (e) { startDrag(axis, e); });
    return { el: el, target: null, geo: null };
  }
  bars.y = makeBar('y');
  bars.x = makeBar('x');

  function isRoot(el) { return el === root || el === doc.body && doc.scrollingElement === doc.body; }
  function inScope(el) { return !scope || !!(el.closest && el.closest(scope)); }
  function reviewed(el) { return !!(el.closest && el.closest('[data-pp-scrollbar="off"]')); }
  function hoverless(el) { return isRoot(el) || el.getAttribute('data-pp-scrollbar') === 'scroll'; }

  function scrollable(el, axis) {
    var a = AXES[axis];
    if (el[a.size] - el[a.client] <= 1) return false;
    if (isRoot(el)) return true;
    var ov = win.getComputedStyle(el)[a.overflow];
    return ov === 'auto' || ov === 'scroll';
  }

  // 指针下面最内层可滚的容器（每个方向各找一个）；文档根与大面只在指针贴边时算。
  function scrollerAt(target, axis) {
    var off = target && target.nodeType === 1 ? target.closest('[data-pp-scrollbar="off"]') : null;
    for (var el = target; el && el.nodeType === 1; el = el.parentElement) {
      if (el === root || el === doc.body) break;
      if (el.hasAttribute('data-pp-osb')) return hoverEl[axis];
      if (off && off.contains(el)) continue;
      if (!inScope(el) || !scrollable(el, axis)) continue;
      if (hoverless(el) && !nearEdge(el, axis)) continue;
      return el;
    }
    if (!scope && scrollable(doc.scrollingElement || root, axis) && nearEdge(doc.scrollingElement || root, axis)) return doc.scrollingElement || root;
    return null;
  }

  function track(el, axis) {
    if (isRoot(el)) {
      return axis === 'y'
        ? { start: 0, len: root.clientHeight, cross: root.clientWidth - BAR - INSET }
        : { start: 0, len: root.clientWidth, cross: root.clientHeight - BAR - INSET };
    }
    var r = el.getBoundingClientRect();
    var top = r.top + el.clientTop, left = r.left + el.clientLeft;
    return axis === 'y'
      ? { start: top + INSET, len: el.clientHeight - INSET * 2, cross: left + el.clientWidth - BAR - INSET }
      : { start: left + INSET, len: el.clientWidth - INSET * 2, cross: top + el.clientHeight - BAR - INSET };
  }

  function nearEdge(el, axis) {
    if (px < 0) return false;
    var t = track(el, axis);
    var c = axis === 'y' ? px : py;
    var along = axis === 'y' ? py : px;
    return c >= t.cross - EDGE && c <= t.cross + BAR + INSET + 1 && along >= t.start && along <= t.start + t.len;
  }

  function wanted(axis) {
    if (drag && drag.axis === axis) return drag.el;
    var now = Date.now();
    var best = null;
    active.forEach(function (until, el) {
      if (until < now || !el.isConnected) { active.delete(el); return; }
      if (scrollable(el, axis) && (!best || best.contains(el))) best = el;
    });
    return hoverEl[axis] || best;
  }

  function place(axis) {
    var bar = bars[axis];
    var el = wanted(axis);
    var t = el && track(el, axis);
    var a = AXES[axis];
    var geo = t && thumbGeometry(el[a.pos], el[a.size], el[a.client], t.start, t.len);
    bar.target = geo ? el : null;
    bar.geo = geo;
    if (!geo) { bar.el.removeAttribute('data-on'); return; }
    var host = (!isRoot(el) && el.closest('dialog[open]')) || doc.body;
    if (bar.el.parentNode !== host) host.appendChild(bar.el);
    var s = bar.el.style;
    if (axis === 'y') { s.left = t.cross + 'px'; s.top = geo.start + 'px'; s.width = BAR + 'px'; s.height = geo.len + 'px'; }
    else { s.left = geo.start + 'px'; s.top = t.cross + 'px'; s.width = geo.len + 'px'; s.height = BAR + 'px'; }
    bar.el.setAttribute('data-on', '');
  }

  function update() {
    frame = 0;
    if (!doc.body) return;
    place('y');
    place('x');
    // 还有容器在“滚动后停留”里：到点再收。
    if (active.size && !frame) win.setTimeout(schedule, LINGER_MS / 3);
  }
  function schedule() { if (!frame) frame = win.requestAnimationFrame(update); }

  function onMove(e) {
    px = e.clientX; py = e.clientY;
    if (drag) return;
    var t = e.target;
    if (t && t.nodeType === 1 && t.hasAttribute('data-pp-osb')) return; // 指针在条上：保持
    hoverEl.y = scrollerAt(t, 'y');
    hoverEl.x = scrollerAt(t, 'x');
    schedule();
  }
  function onLeave(e) {
    if (e.relatedTarget || drag) return;
    px = py = -1;
    hoverEl.x = hoverEl.y = null;
    schedule();
  }
  function onScroll(e) {
    var el = e.target === doc ? (doc.scrollingElement || root) : e.target;
    if (!el || el.nodeType !== 1 || !inScope(el) || (scope && isRoot(el)) || reviewed(el)) return;
    active.set(el, Date.now() + LINGER_MS);
    schedule();
  }

  function startDrag(axis, e) {
    var bar = bars[axis];
    if (!bar.target || !bar.geo || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    var a = AXES[axis];
    drag = { axis: axis, el: bar.target, from: axis === 'y' ? e.clientY : e.clientX, pos: bar.target[a.pos], geo: bar.geo };
    bar.el.setAttribute('data-drag', '');
    try { bar.el.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件没有指针 */ }
    var move = function (ev) {
      var d = (axis === 'y' ? ev.clientY : ev.clientX) - drag.from;
      drag.el[a.pos] = drag.pos + (drag.geo.travel > 0 ? d * drag.geo.range / drag.geo.travel : 0);
      schedule();
    };
    var up = function () {
      bar.el.removeEventListener('pointermove', move);
      bar.el.removeEventListener('pointerup', up);
      bar.el.removeEventListener('pointercancel', up);
      bar.el.removeAttribute('data-drag');
      drag = null;
      schedule();
    };
    bar.el.addEventListener('pointermove', move);
    bar.el.addEventListener('pointerup', up);
    bar.el.addEventListener('pointercancel', up);
  }

  doc.addEventListener('pointermove', onMove, { capture: true, passive: true });
  doc.addEventListener('pointerover', onMove, { capture: true, passive: true });
  doc.addEventListener('pointerout', onLeave, { capture: true, passive: true });
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  win.addEventListener('resize', schedule, { passive: true });

  var api = { update: schedule, widen: function () { scope = null; }, bars: { x: bars.x.el, y: bars.y.el } };
  doc.__ppOverlayScrollbars = api;
  return api;
}

// ── 手机视口的文档根：整条藏掉 ────────────────────────────────────────────────
// 手机视口的文档不出根滚动条（owner 2026-10-15：“html 页面手机视图把滚动条去掉”）。
// 手机屏里的 iframe 是一块真手机屏：桌面浏览器给它的文档根画一条 15px 的常显竖条（经典滚动条），
// 手机上没有这条。iframe 每装一次文档，就往文档里放一条样式藏掉文档根的滚动条：滚轮、触控板照常滚。
// 只管文档根：scrollbar-width 不继承，页面里自己横滑的块（表格）的滚动条不受影响。
// 窗口视口的 iframe 不在 .wb-phone-doc 里，照旧。视口切换会重装板、换一个新 iframe，所以只认 load。
var PHONE_STYLE_ATTR = 'data-pp-phone-scrollbar';
var PHONE_HIDE_CSS =
  'html{scrollbar-width:none !important}' +
  'html::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important}';

function isPhoneDocFrame(el) {
  return !!(el && el.tagName === 'IFRAME' && (
    (el.classList.contains('wb-doc-frame') && el.closest('.wb-phone-doc')) ||
    (el.classList.contains('wb-html-card-frame') && el.closest('[data-card-viewport="phone"]'))
  ));
}

/** 往手机屏 iframe 的文档里放一次样式；跨域、还没有文档、已放过的跳过。 */
function hidePhoneDocScrollbar(frame) {
  if (!isPhoneDocFrame(frame)) return false;
  var doc = null;
  try { doc = frame.contentDocument; } catch (e) { return false; }
  if (!doc || !doc.documentElement || doc.querySelector('style[' + PHONE_STYLE_ATTR + ']')) return false;
  var style = doc.createElement('style');
  style.setAttribute(PHONE_STYLE_ATTR, '');
  style.textContent = PHONE_HIDE_CSS;
  (doc.head || doc.documentElement).appendChild(style);
  return true;
}

/** 工作台装配入口：stage 上捕 iframe 的 load（不冒泡），每装一次文档藏一次。 */
export function startPhoneDocScrollbar(stage) {
  if (!stage) return;
  stage.addEventListener('load', function (e) { hidePhoneDocScrollbar(e.target); }, true);
}
