// 嵌入版工作台（2026-10-15）：文章页的画布浮层里开的是一份 /workbench/?page=<页 id>&embed=overlay
// （site/README.md「画布浮层」）。这里只管它和文章页之间的两件事，其余行为与直接打开的画布相同：
// - Esc：这一下不归工作台自己的某一层（页面浮层、标注框、列表、大纲、菜单、对话框、导航器、标注模式），就请文章页关浮层；
//   画布选中不算一层：落点会选中那一节，第一下 Esc 就该回文章；
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
import { workbenchEscapeIsTaken } from './escape-layers.js';

export var EMBEDDED = isEmbedded(location.search);
export var EMBED_MESSAGE_SOURCE = 'pinpoint-workbench';

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

export function startEmbedBridge() {
  if (!EMBEDDED) return;
  document.documentElement.classList.add('wb-embed');
  var taken = false;
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') taken = isPageOverlayOpen() || workbenchEscapeIsTaken(document, e.target);
  }, true);
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
    // 不看 defaultPrevented：画布选中（落点选中的节、点选的帧）也吃 Esc（app/Dock.jsx），但它不是一层，
    // 浮层是从文章开的，Esc 就该回文章。真正的层由 workbenchEscapeIsTaken 统一判断。
    if (taken) return;
    e.preventDefault();
    post({ type: 'close' });
  });
  var lastSection = '';
  useWorkbenchStore.subscribe(function (s) {
    var section = isPageOverlayOpen() ? pageSectionOf(s.activeEntryId) : s.activeGroup || '';
    if (section && section !== lastSection) {
      lastSection = section;
      post({ type: 'section', section: section });
    }
    if (s.activeBoard) announceReady();
  });
}
