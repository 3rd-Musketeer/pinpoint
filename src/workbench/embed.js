// 嵌入版工作台（2026-10-15）：文章页的画布浮层里开的是一份 /workbench/?page=<页 id>&embed=overlay
// （site/README.md「画布浮层」）。这里只管它和文章页之间的两件事，其余行为与直接打开的画布相同：
// - Esc：工作台的弹层栈（layer-stack.js）没接住时，请文章页关浮层。forward 只在
//   嵌入版装：文章页收到 close 消息走它自己的关闭路径（地址、焦点、滚动位置一起复原）；
//   直接打开的画布没有父级要通知。画布选中不算一层：落点会选中那一节，第一下 Esc 就该回文章。
// - 当前节：画布当前所在的节（store.activeGroup，平移、大纲、定位都会改）报给文章页，浮层头和 #canvas= 跟着换；
//   页面浮层开着时报那一页所在的节（画布藏在下面，activeGroup 跟着藏起来的视口走，不算数）。
// 消息走 postMessage，目标 origin 固定为本 origin（文章页与工作台同源）；文章页按 event.source 认 iframe。
// 就绪（C1）也是消息：板落定时主动报 ready，装载失败报 board-error（stage.js），
// 入口脚本加载失败报 boot-error（index.html 的 onerror）—— 文章页不再轮询 iframe，
// 只按消息推进就绪状态机；消息带 ?gen= 的文档代次，重试换文档后旧消息作废。
// 左栏、“← 文章标题”在嵌入版里不出：样式挂在 html.wb-embed 上（index.html），React 组件读 EMBEDDED。
import { wbGet, useWorkbenchStore } from './app/store.js';
import { isEmbedded } from './lib/page-url.js';
import { isPageOverlayOpen } from './pages.js';
import { wbLayers } from './layer-stack.js';
import { reportEmbedPark } from './embed-park.js';

export var EMBEDDED = isEmbedded(location.search);
var EMBED_MESSAGE_SOURCE = 'pinpoint-workbench';

function post(message) {
  if (window.parent === window) return;
  try {
    // 就绪三条按 gen 核对归属（重试换文档后旧消息作废）；close / section 不看它，带上无害。
    window.parent.postMessage(Object.assign({ source: EMBED_MESSAGE_SOURCE, gen: docGen() }, message), location.origin);
  } catch (e) { /* 父页面已经走了 */ }
}

/** 嵌入工作台 → 文章页的单向通知（就绪状态机的非 store 事件：板装载失败）。
    只在嵌入版生效；直接打开的画布没有父级可通知。 */
export function notifyEmbed(message) {
  if (!EMBEDDED) return;
  post(message);
}

/** 文档代次：文章页每次（重试）换 src 时递增 ?gen=，这里原样回传 —— 重试后旧文档
    迟到的消息带着旧代次，文章页把它丢掉。代次是文档常量，由 index.html 在文档起点
    （任何 replaceState 之前）取一次存进 window.__wbGen；不能现读 location.search ——
    url-sync 镜像地址时会把 ?gen= 改写掉。 */
function docGen() {
  var g = Number(window.__wbGen);
  return Number.isFinite(g) && g > 0 ? g : 0;
}

// 板落定（几何批 + 预览脚本）时向文章页报 ready。触发点：activeBoard 换新（boot
// 首装、切页 / tab、HMR 重装都走它）。followSession 语义：等待期间会话被替换就接着
// 等新的；false（还没有会话 / 会话被取消 = 板装载失败）不发，那条路由 board-error。
// 同一会话只发一条；文章页重复收到也无害（状态机幂等）。
var announcedGeneration = -1;
var announcing = false;
function announceReady() {
  if (announcing || !window.workbench || typeof window.workbench.whenBoardSettled !== 'function') return;
  announcing = true;
  window.workbench.whenBoardSettled().then(function (boardOk) {
    if (!boardOk) return null;
    var gen = window.workbench.mountGeneration();
    if (gen === announcedGeneration) return null;
    return window.workbench.whenPreviewsSettled().then(function (ok) { return ok ? gen : null; });
  }).then(function (gen) {
    announcing = false;
    if (gen === null || gen === undefined) return;
    announcedGeneration = gen;
    post({ type: 'ready', pageId: wbGet().activePageId });
  }).catch(function () { announcing = false; });
}

/** 页面浮层里那一页所在的节（卡片在哪一节）。 */
function pageSectionOf(screenId) {
  if (!screenId) return '';
  var node = document.querySelector('[data-page-screen="' + String(screenId).replace(/["\\]/g, '') + '"]');
  var item = node && node.closest('.wb-lib-item');
  return item ? item.getAttribute('data-ann-section') || '' : '';
}

export function startEmbedBridge(whenBootSettled) {
  if (!EMBEDDED) return;
  document.documentElement.classList.add('wb-embed');
  var reportPark = reportEmbedPark(whenBootSettled, function (paused) {
    post({ type: 'parked', paused: paused });
  });
  // 停驻（E2）：文章页把浮层收进停驻容器时发 pause，打开时发 resume。
  // 回执不看代次（停驻是这一份文档的事）；保存与 outbox 不在暂停登记里，照常落盘。
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent || e.origin !== location.origin) return;
    var data = e.data;
    if (!data || data.source !== 'pinpoint-article' || (data.type !== 'pause' && data.type !== 'resume')) return;
    reportPark(data.type === 'pause');
  });
  // 预热的 pause 可能在这个监听挂上之前就到了（模块还在加载）：父页面的浮层关着、
  // 停着本帧（data-ov-held），就当它已经要求暂停，补一次。
  try {
    var held = window.parent.document.querySelector('dialog[data-pp-overlay][data-ov-held]:not([open]) iframe');
    if (held && held.contentWindow === window) {
      reportPark(true);
    }
  } catch (e) { /* 父页面不可读：不是嵌入 */ }
  // 弹层栈没接住的 Esc（栈里没有任何层接）：请文章页关浮层（C2）。与直接打开的画布
  // 相比只多这一步转发；页面浮层、标注层、菜单这些都在栈里，轮不到转发。
  // 在捕获段就转、不看 defaultPrevented：画布选中也吃 Esc（app/Dock.jsx），但它不是一层。
  wbLayers.setForward(function (e) {
    e.preventDefault();
    post({ type: 'close' });
  });
  // 当前节报给文章页。selector 化（C3）：算出的节没变就不进回调 —— 原来任何
  // store 变化都重算一遍再靠 lastSection 去重。页面浮层的开与关都写 activeEntryId
  // （pages.js openPageOverlay / closePageOverlay），selector 跟着翻转，不漏。
  var lastSection = '';
  useWorkbenchStore.subscribe(function (s) {
    return isPageOverlayOpen() ? pageSectionOf(s.activeEntryId) : s.activeGroup || '';
  }, function (section) {
    if (!section || section === lastSection) return;
    lastSection = section;
    post({ type: 'section', section: section });
  });
  // 板换新（boot 首装、切页 / tab、HMR 重装都写 activeBoard）才重新宣布就绪；
  // 会话被替换的衔接由 whenBoardSettled 的 followSession 语义自理。
  useWorkbenchStore.subscribe(function (s) { return s.activeBoard; }, function () { announceReady(); });
}
