// Canvas zoom 的数据工具：取值范围与当前生效 zoom 的读取。从 workbench.js 平移。
var ZOOM_MIN = 0.25;
var ZOOM_MAX = 2.5;

export function clampCanvasZoom(z) {
  z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  return Math.round(z * 100) / 100;
}

export function currentCanvasZoom() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wb-board-zoom')) || 1;
}

/** HUD 缩放读数：'1' → '100%'。纯函数，React 组件与命令式层共用。 */
export function formatZoomLabel(z) {
  var n = Math.round(parseFloat(z) * 100);
  if (!isFinite(n)) n = 100;
  return n + '%';
}
