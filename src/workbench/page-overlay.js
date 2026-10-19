// 文章画布的页面浮层（2026-10-15 一篇文章一张画布）：画布上一个 HTML 帧是一张活的卡片（live-cards.js），
// 图注行的“全页”钮打开这一页的完整页面（pages.js openPageOverlay：这一帧的文档条目），Esc 或左上角“← 画布”关掉，
// 回到打开前的位置。这里只管入口与浮层 iframe 的弹层栈：
// - “全页”（[data-html-card-open]）：交互、标注两种模式下都开。卡片里面是页面自己的交互，双击留给页面
//   （owner 2026-10-15 要在画布上直接滚动、点按比对），所以入口不再是双击卡片。钮带 data-ann-ui，画布标注客户端让开它。
// - Esc：浮层本体是工作台弹层栈里的一层（pages.js 的 syncPageOverlayLayer，rank 在标注模式之后）。
//   焦点常在页面的 iframe 里，按键到不了工作台：iframe 的文档装好后就地装上弹层栈
//   （src/shared/layers.js attachLayerStack，幂等），没接住的 Esc 由栈转给工作台 window，
//   由浮层这一层关掉 —— 与活卡片同一套跨文档协议（C2）。
import { forwardUncaught } from '../shared/layers.js';
import { openPageOverlay } from './pages.js';

var CARD_SELECTOR = '.wb-screen[data-html-card]';

/** 卡片 → { sectionId, screenId }；不是卡片返回 null。 */
function htmlCardOf(target) {
  var card = target && target.closest ? target.closest(CARD_SELECTOR) : null;
  if (!card) return null;
  var section = card.closest('.wb-lib-item');
  return {
    screenId: card.getAttribute('data-screen') || '',
    sectionId: section ? section.getAttribute('data-ann-section') || '' : ''
  };
}

var wiredFrames = typeof WeakSet === 'function' ? new WeakSet() : null;

/** 页面浮层的 iframe 每装一次文档就装一次栈（换文档时旧 window 上的监听跟着没了）。按 document 认：
    iframe 的 contentWindow 是同一个 WindowProxy，导航前后不变（没给 src 时那份 about:blank 也会触发 load）。 */
function wireFrameLayers(frame) {
  var win = null;
  var doc = null;
  try { win = frame.contentWindow; doc = win && win.document; } catch (e) { return; }
  if (!win || !doc || (wiredFrames && wiredFrames.has(doc))) return;
  if (wiredFrames) wiredFrames.add(doc);
  // 注入的标注客户端也调 attachLayerStack：幂等，拿到的是同一份。没接住的 Esc 在页面
  // 自己的监听之后交回工作台 window（旧做法同样在冒泡段关浮层，不看 defaultPrevented）。
  forwardUncaught(win, { afterPage: true });
}

export function startPageOverlay(stage) {
  if (!stage) return;
  stage.addEventListener('click', function (e) {
    if (e.button !== 0) return;
    var btn = e.target.closest && e.target.closest('[data-html-card-open]');
    if (!btn) return;
    var hit = htmlCardOf(btn);
    if (!hit || !hit.screenId) return;
    e.preventDefault();
    e.stopPropagation();
    openPageOverlay(hit.screenId);
  }, true);
  // 浮层的 iframe 是按需装的（data-src → src），load 冒不上来，在捕获段接。
  stage.addEventListener('load', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IFRAME' && t.classList.contains('wb-doc-frame') && t.closest('[data-page-screen]')) wireFrameLayers(t);
  }, true);
}
