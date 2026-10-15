// 嵌入版工作台（2026-10-15）：文章页的画布浮层里开的是一份 /workbench/?page=<页 id>&embed=overlay
// （site/README.md「画布浮层」）。这里只管它和文章页之间的两件事，其余行为与直接打开的画布相同：
// - Esc：这一下不归工作台自己的某一层（页面浮层、标注框、列表、大纲、菜单、对话框、导航器、标注模式），就请文章页关浮层；
//   画布选中不算一层：落点会选中那一节，第一下 Esc 就该回文章；
// - 当前节：画布当前所在的节（store.activeGroup，平移、大纲、定位都会改）报给文章页，浮层头和 #canvas= 跟着换；
//   页面浮层开着时报那一页所在的节（画布藏在下面，activeGroup 跟着藏起来的视口走，不算数）。
// 消息走 postMessage，目标 origin 固定为本 origin（文章页与工作台同源）；文章页按 event.source 认 iframe。
// 左栏、“← 文章标题”在嵌入版里不出：样式挂在 html.wb-embed 上（index.html），React 组件读 EMBEDDED。
// 单帧预览（2026-10-15，文章页点卡片里的某一帧，#canvas=…&frame=…&view=frame）：文章页调 workbench.setSolo，
// 画布只留这一帧——HTML 帧直接开它的页面浮层，iOS / 组件帧把缩放调到装下这一帧、别的帧和节藏起来；
// 节导航、大纲、地图、“← 画布”不出（html[data-wb-solo]，index.html）。预览里关页面浮层就是关预览（回文章）。
import { useWorkbenchStore, wbGet, wbSet } from './app/store.js';
import { isEmbedded } from './lib/page-url.js';
import { closePageOverlay, isPageOverlayOpen, openPageOverlay } from './pages.js';
import { setCanvasZoom } from './boot-prefs.js';
import { currentCanvasZoom } from './lib/canvas-zoom.js';
import { focusWorkbenchFrame, frameFitZoom } from './board-nav.js';

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

/** 请文章页关浮层（Esc 没被哪一层接住、单帧预览里关页面）。 */
export function requestEmbedClose() {
  post({ type: 'close' });
}

// ---- 单帧预览 ----
var solo = null;   // { section, screen, kind: 'page' | 'frame' }
var soloStyle = null;
var zoomBeforeSolo = null;   // 进预览前画布的缩放：收起预览时还回去（放大装下一帧的缩放不该带进整张画布）

export function embedSolo() { return solo; }

function cssId(v) { return String(v).replace(/["\\]/g, '\\$&'); }

function soloCss(section, screen) {
  var frame = '#wb-board-panel .wb-lib-item[data-ann-section="' + cssId(section) + '"] .wb-screen[data-screen="' + cssId(screen) + '"]';
  var marks = '#ann-marks [data-ann-screen="' + cssId(screen) + '"], #ann-bubbles [data-ann-screen="' + cssId(screen) + '"]';
  return frame + ', ' + marks + ' { visibility: visible; }';
}

/** 单帧预览开 / 关。section + screen → 'page'（HTML 帧，开了页面浮层）| 'frame'（装下这一帧）| false（没这一帧）；
    section 为空 → 收起预览，回整张画布（不动当前位置，由调用方定位）。 */
export function setEmbedSolo(section, screen) {
  if (!section || !screen) {
    solo = null;
    wbSet({ embedSolo: null });
    document.documentElement.removeAttribute('data-wb-solo');
    if (soloStyle) soloStyle.textContent = '';
    if (zoomBeforeSolo != null && String(currentCanvasZoom()) !== zoomBeforeSolo) setCanvasZoom(zoomBeforeSolo, { save: false });
    zoomBeforeSolo = null;
    return true;
  }
  var panel = document.getElementById('wb-board-panel');
  var node = panel && panel.querySelector('.wb-lib-item[data-ann-section="' + cssId(section) + '"] .wb-screen[data-screen="' + cssId(screen) + '"]');
  if (!node) return false;
  var kind = node.hasAttribute('data-html-card') ? 'page' : 'frame';
  if (!solo && zoomBeforeSolo == null) zoomBeforeSolo = String(currentCanvasZoom());
  if (kind === 'page') {
    solo = { section: section, screen: screen, kind: kind };
    wbSet({ embedSolo: kind });
    document.documentElement.setAttribute('data-wb-solo', kind);
    if (!openPageOverlay(screen)) { setEmbedSolo(''); return false; }
    return kind;
  }
  if (isPageOverlayOpen()) closePageOverlay();
  solo = { section: section, screen: screen, kind: kind };
  if (!soloStyle) {
    soloStyle = document.createElement('style');
    soloStyle.id = 'wb-solo-style';
    document.head.appendChild(soloStyle);
  }
  soloStyle.textContent = soloCss(section, screen);
  wbSet({ embedSolo: kind });
  document.documentElement.setAttribute('data-wb-solo', kind);
  var zoom = frameFitZoom(section, screen);
  if (zoom) setCanvasZoom(String(zoom), { save: false });
  focusWorkbenchFrame(section, screen, { smooth: false });
  return kind;
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
