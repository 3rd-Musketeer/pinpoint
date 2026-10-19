// 标注表面（C3，r2 D1 找实例合一）：画布上同时最多有三份 annotate 实例在跑 ——
// 父窗口实例（画布条目的驱动，侧栏按钮与 A 键）、可见文档 iframe 里的实例（文档
// 条目选中时接管）、HTML 活卡片 iframe 里的实例（各页自己的账本）。「此刻谁在管」
// 的判定原来三处各写各的（ann-bridge 的 annotateApi / parkParentAnnotate / A 键
// 驱动、live-cards 的 cardApis 登记），实例间的模式同步也只有卡片做了双向；收进
// 这里一处做。就绪等待用 C1 的 whenReady() 与就绪消息（lib/annotate-ready.js）。

import { isComposingKey, isTypingTarget } from '../shared/keys.js';

/* ---- 可见文档实例：文档条目选中时它接管 -----------------------------------
   文档条目的文档活在 iframe 里，它自己注入 annotate.js，于是页面上同时存在两个
   互不相通的实例：父窗口（侧栏按钮驱动）和 iframe（文档本体）。侧栏点「标注」
   只切到了父窗口那个，画不出框 —— 表现成「侧栏和右下角没对齐」。
   侧栏是唯一控制面，所以取用时按当前选中条目解析到正确的那个实例。 */
/* 舞台上此刻可见的那个文档 iframe（2026-09-05 起不看形态看可见性）：窗口视口下它
   1:1 铺满舞台，手机视口下它装在缩过的手机屏里，两种情况标注实例都是它自己的；
   画布条目态 doc 屏全部 data-doc-hidden，这里得 null → 回落父窗口实例。 */
export function activeDocFrameEl() {
  var panel = document.getElementById('wb-board-panel');
  if (!panel) return null;
  return panel.querySelector('.wb-screen:not([data-doc-hidden]) .wb-doc-frame');
}

/** 可见文档帧里的 annotate 实例所在的 window；没有可见文档帧或实例未注入（跨域
 *  读 contentWindow 会抛）时为 null。文档实例的绑定方（ann-bridge bindIfNewDoc）
 *  直接消费它；画布操作该驱动谁看 resolveActiveAnnotate。 */
export function activeDocWindow() {
  return docWindowOf(activeDocFrameEl());
}

function docWindowOf(frame) {
  if (!frame) return null;
  try {
    var w = frame.contentWindow;
    return w && w.pinpoint ? w : null;     // 跨域时读 contentWindow 会抛
  } catch (e) {
    return null;
  }
}

/** 此刻「谁在管」的一次解析（一次 DOM 查询，消费方共用）：
 *  - api：画布标注操作该驱动的实例 —— 可见文档实例优先，缺省父窗口实例；
 *  - parent：父窗口实例（可能没有）；
 *  - docWin / docFrame：接管的文档实例与它的 iframe（没有可见文档帧时为 null，
 *    跨域读 contentWindow 抛错时 docWin 也为 null）。 */
export function resolveActiveAnnotate() {
  var docFrame = activeDocFrameEl();
  var docWin = docWindowOf(docFrame);
  var parent = window.pinpoint || null;
  var api = (docWin && docWin.pinpoint) || parent;
  return { api: api || null, parent: parent, docWin: docWin, docFrame: docFrame };
}

export function annotateApi() {
  return resolveActiveAnnotate().api;
}

/* 文档条目选中时，父窗口实例必须停在交互态（2026-10-14 owner：「我在手机视图下标注，
   出来的是整个页面」）。它还在标注态时（画布页上开的标注没关就切过来，或焦点在工作台
   上按了 A），窗口视口里 iframe 盖满舞台、它碰不到任何东西；手机视口里舞台露在手机屏
   四周，它的命中落到 .wb-lib-item（整节 = 整个舞台的框）或 .ios-screen 里的 iframe
   元素（整份文档），标出来的就是整页。横条按钮读的是 iframe 实例，看不出父实例开着。
   所以：快照每次同步都把父实例拨回交互态；A 键在文档条目上改驱动 iframe 实例，与横条
   「标注」按钮驱动同一个。 */
export function parkParentAnnotate() {
  var resolved = resolveActiveAnnotate();
  var parent = resolved.parent;
  if (!parent || typeof parent.getState !== 'function' || typeof parent.setMode !== 'function') return;
  if (!resolved.docFrame) return;
  if (parent.getState().mode) parent.setMode(false);
}

// window 捕获阶段先于父实例挂在 document 上的 A 键监听（src/client/annotate.js）。
export function routeAnnotateKey(e) {
  if (e.key !== 'a' && e.key !== 'A') return;
  if (e.metaKey || e.ctrlKey || e.altKey || isComposingKey(e)) return;
  var resolved = resolveActiveAnnotate();
  if (isTypingTarget(e.target) || !resolved.docFrame) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (resolved.docWin && typeof resolved.docWin.pinpoint.toggle === 'function') resolved.docWin.pinpoint.toggle();
}

/* ---- 卡片实例：登记、解析与模式同步 ---------------------------------------
   文章画布上的 HTML 活卡片各自带一个标注客户端，标注进那一页自己的账本；
   cardAnnotateApi 按 screenId 解析，whenCardAnnotateReady 等绑定完成（C1：
   帧卸载 / 换板以 null 放手）。模式一处同步：父实例切标注态铺到所有卡片，
   卡片里切了（按 A / Esc）回报父实例；父实例的在文档条目上的拨回见
   parkParentAnnotate —— 三份实例谁也不拖着谁进标注态。 */

// 画布上的卡片 frame（live-cards syncLiveCards 换板重登记）与其中活着的实例。
var cardFrames = [];
var cardApis = new Map();
var cardApiWaiters = new Map();                                    // frame → [resolve(api|null)]

/** 父窗口实例，且状态读写可用（卡片同步只对它做）。 */
export function parentAnnotateApi() {
  var api = window.pinpoint;
  return api && typeof api.getState === 'function' && typeof api.setMode === 'function' ? api : null;
}

function cardApiAlive(frame, api) {
  try { return frame.isConnected && frame.contentWindow && frame.contentWindow.pinpoint === api; } catch (e) { return false; }
}

/** 换板重登记：旧 frame 引用全部失效，等绑定的一方以 null 放手，不挂在死帧上。 */
export function forgetAllCardAnnotates() {
  cardFrames = [];
  cardApis.clear();
  flushAllCardWaiters(null);
}

export function registerCardFrames(frames) {
  cardFrames = [];
  frames.forEach(function (frame) { cardFrames.push(frame); });
}

/** 卸载一张卡片：实例登记清掉，等待方以 null 放手。 */
export function forgetCardAnnotate(frame) {
  cardApis.delete(frame);
  flushCardWaiters(frame, null);
}

export function cardAnnotateOf(frame) {
  return cardApis.get(frame) || null;
}

export function cardAnnotateAlive(frame, api) {
  return cardApiAlive(frame, api);
}

function setCardMode(frame, api, on) {
  if (!cardApiAlive(frame, api)) { cardApis.delete(frame); return; }
  try { if (!!api.getState().mode !== on) api.setMode(on); } catch (e) { cardApis.delete(frame); }
}

// 父实例的模式变化铺到所有卡片；订阅只挂一次。
var parentModeSubscribed = false;
var parentMode = false;
function ensureParentModeSync() {
  if (parentModeSubscribed) return;
  var parent = parentAnnotateApi();
  if (!parent || typeof parent.onUpdate !== 'function') return;
  parentModeSubscribed = true;
  parentMode = !!parent.getState().mode;
  parent.onUpdate(function () {
    var on = !!parent.getState().mode;
    if (on === parentMode) return;
    parentMode = on;
    cardApis.forEach(function (api, frame) { setCardMode(frame, api, on); });
  });
}

/** 卡片实例绑定完成（live-cards 在实例 whenReady 之后调）：登记、放行等待方、
 *  与父实例对齐模式并挂双向跟随。onNotify 由卡片管理侧注入（标注活动也是卡片
 *  装载计划的输入，现在是 schedulePump）。 */
export function cardAnnotateBound(frame, api, onNotify) {
  ensureParentModeSync();
  cardApis.set(frame, api);
  flushCardWaiters(frame, api);
  if (onNotify) onNotify();
  var parent = parentAnnotateApi();
  setCardMode(frame, api, !!(parent && parent.getState().mode));
  if (typeof api.onUpdate === 'function') {
    api.onUpdate(function () {
      if (cardApis.get(frame) !== api) return;
      if (onNotify) onNotify();
      var p = parentAnnotateApi();
      if (!p) return;
      var on = !!api.getState().mode;
      if (on !== !!p.getState().mode) p.setMode(on);
    });
  }
}

/** 已加载的 HTML 活卡片的标注客户端；未装好时返回 null，供文章浮层等待水合。 */
export function cardAnnotateApi(screenId) {
  for (var i = 0; i < cardFrames.length; i++) {
    var frame = cardFrames[i];
    var holder = frame.closest('[data-screen]');
    if (!holder || holder.getAttribute('data-screen') !== screenId) continue;
    var api = cardApis.get(frame);
    return api && cardApiAlive(frame, api) ? api : null;
  }
  return null;
}

function frameOfScreen(screenId) {
  for (var i = 0; i < cardFrames.length; i++) {
    var holder = cardFrames[i].closest('[data-screen]');
    if (holder && holder.getAttribute('data-screen') === screenId) return cardFrames[i];
  }
  return null;
}

function flushCardWaiters(frame, value) {
  var list = cardApiWaiters.get(frame);
  if (!list) return;
  cardApiWaiters.delete(frame);
  for (var i = 0; i < list.length; i++) list[i](value);
}

function flushAllCardWaiters(value) {
  cardApiWaiters.forEach(function (list) {
    for (var i = 0; i < list.length; i++) list[i](value);
  });
  cardApiWaiters.clear();
}

/** 等某屏活卡片的标注客户端绑定完成（C1：文章浮层定位 HTML 帧上的钉子前等它，
    workbench.whenCardAnnotateReady）。帧卸载 / 换板以 null 放手，不无限挂起。 */
export function whenCardAnnotateReady(screenId) {
  var api = cardAnnotateApi(screenId);
  if (api) return Promise.resolve(api);
  var frame = frameOfScreen(screenId);
  if (!frame) return Promise.resolve(null);
  return new Promise(function (resolve) {
    var list = cardApiWaiters.get(frame);
    if (!list) { list = []; cardApiWaiters.set(frame, list); }
    list.push(resolve);
  });
}
