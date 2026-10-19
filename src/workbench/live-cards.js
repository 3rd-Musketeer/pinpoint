// 文章画布上活的 HTML 卡片（2026-10-15，owner：“预览的时候是交互模式，不然在画布上看到并排 html 的时候没法比对
// （无法滑动交互）”）。卡片是一个固定尺寸的浏览器窗口，里面是正常加载、带标注客户端的页面；这里管三件事：
// 1. 懒加载：卡片 iframe 只写 data-src，进了舞台视野（四周各留半个舞台）才装；装着的超过上限时卸视野外最久没看的
//    （规则是纯函数 lib/live-cards.js planLiveCards）。iframe 带 data-pp-parent-events：里面的标注客户端借工作台的
//    SSE 连接（server-events.js），不各开一条。
// 2. 手势回到画布：滚轮在卡片上滚的是页面（浏览器默认，和 iOS 帧里的滚动容器一样）；捏合 / ctrl·⌘ + 滚轮、
//    空格（按住拖画布）与中键按下在卡片的 window 里拦截，转给工作台，画布照常缩放、平移。
// 3. 标注模式同步：横条“标注”驱动的是画布的标注客户端（window.pinpoint），它让开卡片（data-ann-ui）；卡片里那一页
//    自己的客户端跟着进出标注模式，在卡片里直接标，标注进那一页的账本。卡片里按 A / Esc 切了模式，画布跟着切。
import { frameReadyToUnload } from './frame-save.js';
import { isComposingKey, isTypingTarget } from '../shared/keys.js';
import { forwardUncaught } from '../shared/layers.js';
import { isAnnotateReadyMessage } from './lib/annotate-ready.js';
import { MAX_LIVE_CARDS, cardPointToParent, planLiveCards } from './lib/live-cards.js';

var FRAME_SELECTOR = 'iframe.wb-html-card-frame';
var state = { panel: null, observer: null, cards: new Map() };   // frame → { visible, live, loading, seenAt, timer }
var wiredDocs = typeof WeakSet === 'function' ? new WeakSet() : null;
var cardApis = new Map();                                          // frame → 卡片里的 pinpoint
var cardApiWaiters = new Map();                                    // frame → [resolve(api|null)]
var parentSubscribed = false;
var parentMode = false;
var LOAD_TIMEOUT_MS = 4000;
var pumpRaf = 0;

function schedulePump() {
  if (pumpRaf) return;
  pumpRaf = requestAnimationFrame(function () { pumpRaf = 0; pump(); });
}

function stageEl() { return document.getElementById('wbstage'); }

/** 板装好后调（stage.js loadBoard）：换板就重来一遍，不是文章画布的板也调（清掉上一块板的登记）。 */
export function syncLiveCards(panel) {
  if (state.observer) state.observer.disconnect();
  state.cards.forEach(function (c) { clearTimeout(c.timer); });
  state = { panel: panel || null, observer: null, cards: new Map() };
  cardApis.clear();
  // 换板后旧 frame 引用全部失效：等绑定的一方以 null 放手，不挂在死帧上。
  flushAllCardWaiters(null);
  if (!panel) return;
  var frames = panel.querySelectorAll(FRAME_SELECTOR);
  if (!frames.length) return;
  frames.forEach(function (frame) {
    frame.setAttribute('data-pp-parent-events', '');
    state.cards.set(frame, { visible: false, live: false, loading: false, seenAt: 0, timer: 0 });
  });
  var root = stageEl();
  if (typeof IntersectionObserver !== 'function') {
    state.cards.forEach(function (c) { c.visible = true; });
    pump();
    return;
  }
  state.observer = new IntersectionObserver(function (entries) {
    var now = performance.now();
    entries.forEach(function (entry) {
      var c = state.cards.get(entry.target.querySelector(FRAME_SELECTOR));
      if (!c) return;
      c.visible = entry.isIntersecting;
      if (c.visible) c.seenAt = now;
    });
    pump();
  }, { root: root, rootMargin: '50%' });
  // 观察卡片的框（.wb-html-card），不是 iframe：没装的 iframe 也有尺寸，但框是卡片在画布上占的地方。
  frames.forEach(function (frame) { state.observer.observe(frame.closest('.wb-html-card') || frame); });
}

function pump() {
  var list = [];
  var byId = new Map();
  var i = 0;
  state.cards.forEach(function (c, frame) {
    var id = String(i++);
    byId.set(id, frame);
    list.push({ id: id, visible: c.visible, live: c.live, loading: c.loading, seenAt: c.seenAt });
  });
  var plan = planLiveCards(list, { maxLive: MAX_LIVE_CARDS });
  plan.unload.forEach(function (id) { unloadFrame(byId.get(id)); });
  plan.load.forEach(function (id) { loadFrame(byId.get(id)); });
}

function loadFrame(frame) {
  var c = state.cards.get(frame);
  if (!c || c.live || c.loading) return;
  c.loading = true;
  frame.setAttribute('data-live', 'loading');
  // load 不来（页面挂着长请求）也别把队列堵死：到点当它装好了。
  c.timer = setTimeout(function () { finishLoad(frame); }, LOAD_TIMEOUT_MS);
  frame.setAttribute('src', frame.getAttribute('data-src'));
}

function finishLoad(frame) {
  var c = state.cards.get(frame);
  if (!c || !c.loading) return;
  clearTimeout(c.timer);
  c.loading = false;
  c.live = true;
  frame.setAttribute('data-live', 'on');
  pump();
}

function unloadFrame(frame) {
  var c = state.cards.get(frame);
  if (!c || !frameReadyToUnload(frame)) return;
  clearTimeout(c.timer);
  c.loading = false;
  c.live = false;
  cardApis.delete(frame);
  flushCardWaiters(frame, null);
  frame.removeAttribute('data-live');
  frame.removeAttribute('src');
  // 只删属性 iframe 不导航，旧文档留在里面接着跑：换成空白页才真的卸掉。
  try { frame.contentWindow.location.replace('about:blank'); } catch (e) { /* 已经不在 */ }
}

/* ---- 卡片 window 上的桥 ----------------------------------------------------------- */

function forwardWheel(frame, e) {
  if (!e.ctrlKey && !e.metaKey) return;
  // 捏合 / ctrl·⌘ + 滚轮：不让页面自己缩放，交给画布（stage.js 的 wheel 监听按这一点缩放）。
  e.preventDefault();
  var rect = frame.getBoundingClientRect();
  var p = cardPointToParent(rect, frame.clientWidth, e.clientX, e.clientY);
  frame.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true,
    deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode,
    ctrlKey: e.ctrlKey, metaKey: e.metaKey,
    clientX: p.x, clientY: p.y
  }));
}

function forwardSpace(e) {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (isTypingTarget(e.target) || isComposingKey(e)) return;
  if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey)) return;
  // 同 iOS 帧：空格归画布（按住拖平移），不翻页面。工作台的空格监听挂在 document 捕获段。
  e.preventDefault();
  document.dispatchEvent(new KeyboardEvent(e.type, { key: ' ', code: 'Space', repeat: e.repeat, bubbles: true, cancelable: true }));
}

// 中键从按下到松开都归工作台。取消 pointerdown 会抑制兼容 mouse 事件，
// 而 iframe 仍可能持有后续 pointer 事件，所以显式捕获并转发整段手势。
function wireMiddlePan(frame, win) {
  var pointer = null;
  function forward(type, e) {
    var p = cardPointToParent(frame.getBoundingClientRect(), frame.clientWidth, e.clientX, e.clientY);
    frame.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 1, buttons: e.buttons,
      clientX: p.x, clientY: p.y
    }));
  }
  win.addEventListener('pointerdown', function (e) {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pointer = e.pointerId;
    e.target.setPointerCapture(pointer);
    forward('mousedown', e);
  }, true);
  win.addEventListener('pointermove', function (e) {
    if (e.pointerId !== pointer) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    forward('mousemove', e);
  }, true);
  function end(e) {
    if (e.pointerId !== pointer) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pointer = null;
    forward('mouseup', e);
  }
  win.addEventListener('pointerup', end, true);
  win.addEventListener('pointercancel', end, true);
  win.addEventListener('auxclick', function (e) {
    if (e.button === 1) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

// 活卡片里的 Esc：卡片文档装好后就地装弹层栈（C2，幂等：卡片自己注入的标注客户端
// 拿到同一份），草稿 / 模式在卡片栈里逐层退。都没接住时等卡片页面自己的监听跑完：
// 页面没处理（没 preventDefault）就交回工作台 window，工作台的栈照同一套次序处理
// （嵌入版可据此回文章）。
function wireCardLayers(win) {
  forwardUncaught(win, { afterPage: true, skipHandled: true });
}

function wireCardWindow(frame) {
  if (!state.cards.has(frame) || !frame.getAttribute('src')) return;
  var win = null;
  var doc = null;
  try { win = frame.contentWindow; doc = win && win.document; } catch (e) { return; }
  if (!win || !doc || doc.URL === 'about:blank') return;
  if (wiredDocs) {
    if (wiredDocs.has(doc)) return;
    wiredDocs.add(doc);
  }
  wireMiddlePan(frame, win);
  win.addEventListener('wheel', function (e) { forwardWheel(frame, e); }, { capture: true, passive: false });
  win.addEventListener('keydown', forwardSpace, true);
  win.addEventListener('keyup', forwardSpace, true);
  wireCardLayers(win);
  bindCardAnnotate(frame, win);
}

/* ---- 标注模式同步 ------------------------------------------------------------------ */

function parentApi() {
  var api = window.pinpoint;
  return api && typeof api.getState === 'function' && typeof api.setMode === 'function' ? api : null;
}

function cardApiAlive(frame, api) {
  try { return frame.isConnected && frame.contentWindow && frame.contentWindow.pinpoint === api; } catch (e) { return false; }
}

function setCardMode(frame, api, on) {
  if (!cardApiAlive(frame, api)) { cardApis.delete(frame); return; }
  try { if (!!api.getState().mode !== on) api.setMode(on); } catch (e) { cardApis.delete(frame); }
}

function ensureParentSubscription() {
  if (parentSubscribed) return;
  var parent = parentApi();
  if (!parent || typeof parent.onUpdate !== 'function') return;
  parentSubscribed = true;
  parentMode = !!parent.getState().mode;
  parent.onUpdate(function () {
    var on = !!parent.getState().mode;
    if (on === parentMode) return;
    parentMode = on;
    cardApis.forEach(function (api, frame) { setCardMode(frame, api, on); });
  });
}

// 页面里的标注客户端是 ios-kit 动态注入的（async），卡片 load 时可能还没到。
// 注入完成时实例向父级发就绪消息（lib/annotate-ready.js，startLiveCards 的 message
// 监听把它带回到这里）；load 时已经在了就直接绑 —— 两条路汇进同一函数，不再
// 100ms×40 短轮询（C1）。绑定动作等实例 whenReady（账本落定）之后。
function bindCardAnnotate(frame, win) {
  var api = null;
  try { api = win.pinpoint; } catch (e) { return; }
  if (!api || typeof api.whenReady !== 'function') return;   // 还没注入；等它的就绪消息
  if (!state.cards.has(frame) || cardApis.get(frame) === api) return;
  api.whenReady().then(function () {
    // 落定时帧已卸载 / 实例又被换掉（重载）：新实例由它自己的就绪消息再来一遍。
    if (!state.cards.has(frame) || !cardApiAlive(frame, api) || cardApis.get(frame) === api) return;
    ensureParentSubscription();
    cardApis.set(frame, api);
    flushCardWaiters(frame, api);
    schedulePump();
    var parent = parentApi();
    setCardMode(frame, api, !!(parent && parent.getState().mode));
    if (typeof api.onUpdate === 'function') {
      api.onUpdate(function () {
        if (cardApis.get(frame) !== api) return;
        schedulePump();
        var p = parentApi();
        if (!p) return;
        var on = !!api.getState().mode;
        if (on !== !!p.getState().mode) p.setMode(on);
      });
    }
  });
}

/** 已加载的 HTML 活卡片的标注客户端；未装好时返回 null，供文章浮层等待水合。 */
export function liveCardAnnotateApi(screenId) {
  for (var frame of state.cards.keys()) {
    if (frame.closest('[data-screen]').getAttribute('data-screen') === screenId) {
      var api = cardApis.get(frame);
      return api && cardApiAlive(frame, api) ? api : null;
    }
  }
  return null;
}

function frameOfScreen(screenId) {
  for (var frame of state.cards.keys()) {
    var holder = frame.closest('[data-screen]');
    if (holder && holder.getAttribute('data-screen') === screenId) return frame;
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
  var api = liveCardAnnotateApi(screenId);
  if (api) return Promise.resolve(api);
  var frame = frameOfScreen(screenId);
  if (!frame) return Promise.resolve(null);
  return new Promise(function (resolve) {
    var list = cardApiWaiters.get(frame);
    if (!list) { list = []; cardApiWaiters.set(frame, list); }
    list.push(resolve);
  });
}

export function startLiveCards(stage) {
  if (!stage) return;
  // iframe 的 load 不冒泡，在捕获段接。
  stage.addEventListener('load', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IFRAME' || !t.classList.contains('wb-html-card-frame')) return;
    if (!t.getAttribute('src')) return;
    finishLoad(t);
    wireCardWindow(t);
  }, true);
  // 卡片里的 annotate 实例就绪时向父级发消息（lib/annotate-ready.js）：按 frame 认领，
  // 回到 bindCardAnnotate 完成绑定。消息排队投递，这条监听挂得晚也收得到。
  window.addEventListener('message', function (e) {
    if (!isAnnotateReadyMessage(e.data)) return;
    state.cards.forEach(function (c, frame) {
      var win = null;
      try { win = frame.contentWindow; } catch (err) { return; }
      if (win === e.source) bindCardAnnotate(frame, win);
    });
  });
}
