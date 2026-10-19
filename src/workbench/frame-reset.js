// 重置一帧（owner 2026-10-19：“表单一旦关上我就打不开了，导致 agent 画的交互原型和我看到的不一样”）：
// 把画布上的一帧放回刚挂载时的样子，别的帧、视口和缩放不动。入口是帧图注的“⋯”菜单里的“重置”。
// - 画在画布文档里的帧（iOS / 组件帧）：板挂上、预览脚本还没跑时，记下每帧图注以外的 HTML；
//   重置时先卸载这一帧的预览脚本，换回记下的 HTML，再重新跑它的预览脚本。
// - HTML 卡片（iframe 里的活页面）：重载那个 iframe。
// 标注不在帧的 DOM 里，重置不碰；标注客户端的 MutationObserver 会按新 DOM 重新定位钉子。
// 改动标记（owner 2026-10-19：“需要标注下，比如小红点，不然我都不知道哪些非原始状态”）：
// 交互模式下，帧里的输入改了值，或一次点击、按键之后帧的 DOM 变了，图注上就出一个红点；
// 点红点等于重置。只看交互带来的变化：状态栏时钟的走字、标注模式下的点击不算。
// 预览脚本怎么跑归 preview-mount.js：它在挂载时把会话和“对一块子树重跑预览脚本”的函数交进来，
// 这里不 import 它（它 import export-core，export-core import 这里）。
import { annotateApi, scheduleAnnSnap } from './ann-bridge.js';

var board = null; // { panel, session, remount, pristine: Map<帧 id, string> }
var wiredPanel = null;
var SETTLE_MS = 600; // 点击、按键之后这么久里帧的 DOM 变了，算这次交互改的
var IGNORED = '.wb-screen-cap, .wb-screen-dim, [data-ann-ui], .ios-sb-time, .ios-lock-clock';

function isCaption(el) {
  return el.classList && (el.classList.contains('wb-screen-cap') || el.classList.contains('wb-screen-dim'));
}

/** 板刚插进 DOM、预览脚本还没跑时调用：记下每帧图注与尺寸行以外的 HTML。 */
export function rememberBoard(panel, session, remount) {
  var pristine = new Map();
  panel.querySelectorAll('.wb-screen[data-screen]').forEach(function (screen) {
    if (screen.hasAttribute('data-html-card')) return;
    var html = '';
    Array.prototype.forEach.call(screen.children, function (child) {
      if (!isCaption(child)) html += child.outerHTML;
    });
    pristine.set(screen.getAttribute('data-screen'), html);
  });
  board = { panel: panel, session: session, remount: remount, pristine: pristine };
  wireDirty(panel);
  // 已经装好的卡片文档（load 早于这里）补挂一次。
  panel.querySelectorAll('.wb-screen[data-html-card] iframe').forEach(function (frame) {
    try { if (frame.contentDocument && frame.contentDocument.readyState === 'complete') wireCardFrame(frame); } catch (e) { /* 跨域 */ }
  });
}

// ---- 改动标记 ----

function annotating(win) {
  var api = win === window ? annotateApi() : win && win.pinpoint;
  return !!(api && typeof api.getState === 'function' && api.getState().mode);
}

function ignoredNode(node) {
  var el = node && node.nodeType === 1 ? node : node && node.parentElement;
  return !el || !!el.closest(IGNORED);
}

function markDirty(screen) {
  if (!screen || !screen.isConnected || screen.hasAttribute('data-frame-dirty')) return;
  screen.setAttribute('data-frame-dirty', '');
  var cap = screen.querySelector(':scope > .wb-screen-cap');
  if (!cap || cap.querySelector('[data-frame-dirty-dot]')) return;
  var dot = document.createElement('button');
  dot.type = 'button';
  dot.className = 'wb-cap-dirty';
  dot.setAttribute('data-frame-dirty-dot', '');
  dot.setAttribute('data-ann-ui', '');
  dot.setAttribute('aria-label', '这一帧被操作过，点击重置');
  dot.title = '这一帧被操作过，不是原始状态 · 点击重置';
  var title = cap.querySelector(':scope > .wb-cap-title');
  cap.insertBefore(dot, title ? title.nextSibling : null);
}

function clearDirty(screen) {
  if (!screen) return;
  screen.removeAttribute('data-frame-dirty');
  var dot = screen.querySelector(':scope > .wb-screen-cap > [data-frame-dirty-dot]');
  if (dot) dot.remove();
}

/** 一次点击或按键之后，在 observed（帧本身，或 HTML 卡片 iframe 的文档）上看 SETTLE_MS：DOM 变了就标红点。 */
function watchAfterInteraction(screen, observed) {
  if (screen.hasAttribute('data-frame-dirty') || screen.__ppDirtyWatch) return;
  var Observer = (observed.ownerDocument || observed).defaultView.MutationObserver;
  var mo = new Observer(function (records) {
    for (var i = 0; i < records.length; i++) {
      if (!ignoredNode(records[i].target)) { markDirty(screen); stop(); return; }
    }
  });
  function stop() { mo.disconnect(); clearTimeout(timer); screen.__ppDirtyWatch = null; }
  var timer = setTimeout(stop, SETTLE_MS);
  screen.__ppDirtyWatch = stop;
  mo.observe(observed, { subtree: true, childList: true, attributes: true, characterData: true });
}

function interactionHandler(screenOf, observedOf, win) {
  return function (e) {
    var screen = screenOf(e);
    if (!screen || ignoredNode(e.target) || annotating(win)) return;
    if (e.type === 'input' || e.type === 'change') { markDirty(screen); return; }
    watchAfterInteraction(screen, observedOf(screen));
  };
}

var INTERACTIONS = ['click', 'keydown', 'input', 'change', 'submit'];

function wireDirty(panel) {
  if (wiredPanel === panel) return;
  wiredPanel = panel;
  var onInline = interactionHandler(function (e) {
    var t = e.target;
    var screen = t && t.closest ? t.closest('.wb-screen[data-screen]') : null;
    return screen && !screen.hasAttribute('data-html-card') ? screen : null;
  }, function (screen) { return screen; }, window);
  INTERACTIONS.forEach(function (type) { panel.addEventListener(type, onInline, true); });
  // 红点就是重置钮。
  panel.addEventListener('click', function (e) {
    var dot = e.target.closest && e.target.closest('[data-frame-dirty-dot]');
    if (!dot) return;
    e.preventDefault();
    e.stopPropagation();
    var screen = dot.closest('.wb-screen[data-screen]');
    if (screen) resetFrame(screen.getAttribute('data-screen'));
  }, true);
  // HTML 卡片：iframe 里的事件冒不到画布，每次装好文档就在它的文档上挂同一套；重载回到原始状态。
  panel.addEventListener('load', function (e) { wireCardFrame(e.target); }, true);
}

function wireCardFrame(frame) {
  if (!frame || frame.tagName !== 'IFRAME') return;
  var screen = frame.closest('.wb-screen[data-html-card]');
  if (!screen) return;
  var doc;
  try { doc = frame.contentDocument; } catch (err) { return; }
  if (!doc || !doc.documentElement || doc.__ppDirtyWired) return;
  doc.__ppDirtyWired = true; // 每份文档挂一次；重载换了新文档，标记跟着没了
  clearDirty(screen);
  var onCard = interactionHandler(function () { return screen.isConnected ? screen : null; },
    function () { return doc.documentElement; }, frame.contentWindow);
  INTERACTIONS.forEach(function (type) { doc.addEventListener(type, onCard, true); });
}

function screenOf(screenId) {
  if (!board || !board.panel.isConnected) return null;
  var list = board.panel.querySelectorAll('.wb-screen[data-screen]');
  for (var i = 0; i < list.length; i++) {
    if (list[i].getAttribute('data-screen') === screenId) return list[i];
  }
  return null;
}

/** 换上一屏的新内容（S2/F2：preview:update 带屏清单的按屏重摆）。html 是
    screen-load.js screenContentHtml 的产物（机壳已套好）；初始 HTML 记录、改动
    标记、预览脚本的重挂与 resetFrame 同一套，只是内容用拉到的新 HTML 而不是
    装载时记下的 pristine。HTML 卡片（文章画布的活页面）没有内联内容可换：
    重载卡片与页面浮层里已装载的 iframe 即新内容。返回 Promise<boolean>：
    找不到这一帧、板已换掉时为 false。 */
export function refreshFrameContent(screenId, html) {
  return swapFrame(screenId, html, { remember: true });
}

/** 把一帧放回初始状态。返回 Promise<boolean>：找不到这一帧、板已换掉时为 false。 */
export function resetFrame(screenId) {
  if (!board || !board.pristine.has(screenId)) {
    var screen = screenOf(screenId);
    // HTML 卡片没有 pristine：重载 iframe 即回到原始状态，不走内联换内容。
    if (screen && screen.hasAttribute('data-html-card')) return swapFrame(screenId, '');
    return Promise.resolve(false);
  }
  return swapFrame(screenId, board.pristine.get(screenId));
}

/** 换一帧的内容（HMR 按屏重摆与重置共用）。remember 时把换上的 HTML 记成新的
    pristine（之后「重置」回到新内容，不是旧装载态）。换上的是 screenContentHtml 的原始产物
    （data-theme="light" + screen-only），画布偏好由 rememberBoard 收的 remount 在这一帧上补。 */
function swapFrame(screenId, html, opts) {
  var screen = screenOf(screenId);
  if (!screen || !board.session.active) return Promise.resolve(false);
  if (screen.hasAttribute('data-html-card')) {
    var reloaded = false;
    var frames = screen.querySelectorAll('iframe');
    Array.prototype.forEach.call(frames, function (frame) {
      if (!frame.getAttribute('src')) return;
      try { frame.contentWindow.location.reload(); } catch (e) { frame.src = frame.src; }
      reloaded = true;
    });
    // 页面浮层是同帧的另一份（“全页”打开的那块），装载过的也一起换新。
    var overlay = board.panel.querySelector('[data-page-screen="' + screenId + '"] iframe');
    if (overlay && overlay.getAttribute('src')) {
      try { overlay.contentWindow.location.reload(); } catch (e) { overlay.src = overlay.src; }
      reloaded = true;
    }
    return Promise.resolve(reloaded);
  }
  var session = board.session;
  if (screen.__ppDirtyWatch) screen.__ppDirtyWatch();
  session.disposeWithin(screen);
  Array.prototype.slice.call(screen.children).forEach(function (child) {
    if (!isCaption(child)) child.remove();
  });
  var tpl = document.createElement('template');
  tpl.innerHTML = html;
  var dim = screen.querySelector(':scope > .wb-screen-dim');
  screen.insertBefore(tpl.content, dim);
  if (opts && opts.remember) board.pristine.set(screenId, html);
  clearDirty(screen);
  return board.remount(screen).then(function () {
    var api = annotateApi();
    if (api) api.render();
    scheduleAnnSnap();
    return session.active;
  });
}
