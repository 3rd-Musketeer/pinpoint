// 手机视口的文档不出根滚动条（owner 2026-10-15：“html 页面手机视图把滚动条去掉”）。
// 手机屏里的 iframe 是一块真手机屏：桌面浏览器给它的文档根画一条 15px 的常显竖条（经典滚动条），
// 手机上没有这条。iframe 每装一次文档，就往文档里放一条样式藏掉文档根的滚动条：滚轮、触控板照常滚。
// 只管文档根：scrollbar-width 不继承，页面里自己横滑的块（表格）的滚动条不受影响。
// 窗口视口的 iframe 不在 .wb-phone-doc 里，照旧。视口切换会重装板、换一个新 iframe，所以只认 load。
var STYLE_ATTR = 'data-pp-phone-scrollbar';
var CSS =
  'html{scrollbar-width:none !important}' +
  'html::-webkit-scrollbar{display:none !important;width:0 !important;height:0 !important}';

function isPhoneDocFrame(el) {
  return !!(el && el.tagName === 'IFRAME' && el.classList.contains('wb-doc-frame') && el.closest('.wb-phone-doc'));
}

/** 往手机屏 iframe 的文档里放一次样式；跨域、还没有文档、已放过的跳过。 */
export function hidePhoneDocScrollbar(frame) {
  if (!isPhoneDocFrame(frame)) return false;
  var doc = null;
  try { doc = frame.contentDocument; } catch (e) { return false; }
  if (!doc || !doc.documentElement || doc.querySelector('style[' + STYLE_ATTR + ']')) return false;
  var style = doc.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
  return true;
}

export function startPhoneDocScrollbar(stage) {
  if (!stage) return;
  // iframe 的 load 不冒泡，在捕获段接（page-overlay.js 同一个做法）。
  stage.addEventListener('load', function (e) { hidePhoneDocScrollbar(e.target); }, true);
}
