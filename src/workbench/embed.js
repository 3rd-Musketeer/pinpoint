// 嵌入版工作台（2026-10-15）：文章页的画布浮层里开的是一份 /workbench/?page=<页 id>&embed=overlay
// （site/README.md「画布浮层」）。这里只管它和文章页之间的两件事，其余行为与直接打开的画布相同：
// - Esc：这一下不归工作台自己的某一层（页面浮层、标注框、列表、大纲、菜单、对话框、导航器、标注模式），就请文章页关浮层；
//   画布选中不算一层：落点会选中那一节，第一下 Esc 就该回文章；
// - 当前节：画布当前所在的节（store.activeGroup，平移、大纲、定位都会改）报给文章页，浮层头和 #canvas= 跟着换；
//   页面浮层开着时报那一页所在的节（画布藏在下面，activeGroup 跟着藏起来的视口走，不算数）。
// 消息走 postMessage，目标 origin 固定为本 origin（文章页与工作台同源）；文章页按 event.source 认 iframe。
// 左栏、“← 文章标题”在嵌入版里不出：样式挂在 html.wb-embed 上（index.html），React 组件读 EMBEDDED。
import { useWorkbenchStore, wbGet } from './app/store.js';
import { isEmbedded } from './lib/page-url.js';
import { isPageOverlayOpen } from './pages.js';

export var EMBEDDED = isEmbedded(location.search);
export var EMBED_MESSAGE_SOURCE = 'pinpoint-workbench';

function post(message) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage(Object.assign({ source: EMBED_MESSAGE_SOURCE }, message), location.origin);
  } catch (e) { /* 父页面已经走了 */ }
}

/** 这一下 Esc 归工作台里的某一层：按下时（捕获段）判，免得那一层在冒泡段关掉自己后这里读不到。 */
function escapeIsTaken() {
  // 文章画布的页面浮层开着：这一下 Esc 关它、回画布（page-overlay.js），不回文章。
  if (isPageOverlayOpen()) return true;
  var s = wbGet();
  if (s.sectionNavOpen || s.minimapOpen || s.annListOpen) return true;
  if (document.getElementById('wboutline-pop') || document.querySelector('[role="menu"], dialog[open]')) return true;
  var api = window.pinpoint;
  if (api && typeof api.hasActiveDraft === 'function' && api.hasActiveDraft()) return true;
  if (api && typeof api.getState === 'function' && api.getState().mode) return true;
  return false;
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
    if (e.key === 'Escape') taken = escapeIsTaken();
  }, true);
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
    // 不看 defaultPrevented：画布选中（落点选中的节、点选的帧）也吃 Esc（app/Dock.jsx），但它不是一层，
    // 浮层是从文章开的，Esc 就该回文章。真正的层在 escapeIsTaken 里一个个认。
    if (taken) return;
    e.preventDefault();
    post({ type: 'close' });
  });
  var lastSection = '';
  useWorkbenchStore.subscribe(function (s) {
    var section = isPageOverlayOpen() ? pageSectionOf(s.activeEntryId) : s.activeGroup || '';
    if (!section || section === lastSection) return;
    lastSection = section;
    post({ type: 'section', section: section });
  });
}
