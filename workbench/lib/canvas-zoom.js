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
