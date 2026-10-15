// 文章画布的页面浮层（2026-10-15 一篇文章一张画布）：画布上一个 HTML 帧是一张卡片，双击打开
// 这一页的完整页面（pages.js openPageOverlay：这一帧的文档条目），Esc 或左上角“← 画布”关掉，
// 回到双击前的画布位置。这里只管手势与按键：
// - 单击卡片选中这一帧（同点图注），双击打开；卡片带 data-ann-ui，画布标注客户端让开它，
//   所以标注模式下双击照样打开（标注在浮层里做）。
// - Esc：这一下不归某一层（标注框、提及、画箭头、标注模式、标注列表、大纲、菜单、对话框）就关浮层。
//   焦点常在页面的 iframe 里，按键到不了工作台：iframe 的文档装好后在它的 window 上挂同一对监听。
//   “归不归某一层”在捕获段判：那一层在冒泡段关掉自己后就看不出来了（embed.js 同一个做法）。
//   文章页的单帧预览里（embed.js setEmbedSolo）这一下 Esc 关的是整个预览，回文章。
import { wbGet } from './app/store.js';
import { annotateApi } from './ann-bridge.js';
import { closePageOverlay, isPageOverlayOpen, openPageOverlay } from './pages.js';
import { selectBoardFrame } from './board-nav.js';
import { embedSolo, requestEmbedClose } from './embed.js';

var CARD_SELECTOR = '.wb-screen[data-html-card]';

/** 卡片 → { sectionId, screenId }；不是卡片返回 null。 */
export function htmlCardOf(target) {
  var card = target && target.closest ? target.closest(CARD_SELECTOR) : null;
  if (!card) return null;
  var section = card.closest('.wb-lib-item');
  return {
    screenId: card.getAttribute('data-screen') || '',
    sectionId: section ? section.getAttribute('data-ann-section') || '' : ''
  };
}

/** 这一下 Esc 归不归浮层上的某一层（doc = 按键所在的文档：工作台或页面的 iframe）。 */
function escapeIsTaken(doc) {
  var s = wbGet();
  if (s.annListOpen || s.sectionNavOpen || s.minimapOpen) return true;
  if (document.getElementById('wboutline-pop') || document.querySelector('[role="menu"], dialog[open]')) return true;
  if (doc && doc !== document && (doc.getElementById('ann-mention') || doc.getElementById('ann-box') || doc.getElementById('ann-lasso'))) return true;
  var api = annotateApi();
  if (api && typeof api.hasActiveDraft === 'function' && api.hasActiveDraft()) return true;
  if (api && typeof api.getState === 'function' && api.getState().mode) return true;
  return false;
}

function isTypingTarget(t) {
  return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}

/** 在一个 window 上挂 Esc 的一对监听（捕获段判、冒泡段关）。 */
function wireEscape(win) {
  var taken = false;
  win.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') taken = !isPageOverlayOpen() || escapeIsTaken(win.document) || isTypingTarget(e.target);
  }, true);
  win.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
    if (taken || !isPageOverlayOpen()) return;
    e.preventDefault();
    // 文章页的单帧预览（embed.js setEmbedSolo）：页面浮层就是预览本身，关它 = 回文章，不露出画布。
    if (embedSolo()) requestEmbedClose();
    else closePageOverlay();
  });
}

var wiredFrames = typeof WeakSet === 'function' ? new WeakSet() : null;

/** 页面浮层的 iframe 每装一次文档就挂一次（换文档时旧 window 上的监听跟着没了）。按 document 认：
    iframe 的 contentWindow 是同一个 WindowProxy，导航前后不变（没给 src 时那份 about:blank 也会触发 load）。 */
function wireFrameEscape(frame) {
  var win = null;
  var doc = null;
  try { win = frame.contentWindow; doc = win && win.document; } catch (e) { return; }
  if (!win || !doc || (wiredFrames && wiredFrames.has(doc))) return;
  if (wiredFrames) wiredFrames.add(doc);
  wireEscape(win);
}

export function startPageOverlay(stage) {
  if (!stage) return;
  stage.addEventListener('click', function (e) {
    if (e.button !== 0) return;
    var hit = htmlCardOf(e.target);
    if (!hit || !hit.screenId || !hit.sectionId) return;
    var api = annotateApi();
    if (api && typeof api.getState === 'function' && api.getState().mode) return;
    selectBoardFrame(hit.sectionId, hit.screenId);
  });
  stage.addEventListener('dblclick', function (e) {
    if (e.button !== 0) return;
    var hit = htmlCardOf(e.target);
    if (!hit || !hit.screenId) return;
    e.preventDefault();
    openPageOverlay(hit.screenId);
  });
  wireEscape(window);
  // 浮层的 iframe 是按需装的（data-src → src），load 冒不上来，在捕获段接。
  stage.addEventListener('load', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IFRAME' && t.classList.contains('wb-doc-frame') && t.closest('[data-page-screen]')) wireFrameEscape(t);
  }, true);
}
