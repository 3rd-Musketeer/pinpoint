// Canvas zoom 的数据工具：取值范围与当前生效 zoom 的读取。从 workbench.js 平移。
//
// 2026-08-17 基准重定标（owner 决定，decisions 08-17c）：视觉缩放 = zoom ×
// BASE_CANVAS_SCALE —— zoom 轴 1（HUD 100%）= owner 舒适默认（旧轴 50% 的
// 视觉大小）。--wb-board-zoom 存的是 zoom 轴值；两个消费点都必须乘 BASE：
// index.html 的 .wb-library transform、boot-prefs 的 syncBoardZoomLayout。
// zoom 轴范围 0.5–5（× BASE 后视觉范围仍是 0.25–2.5，与旧轴相同）。
export var BASE_CANVAS_SCALE = 0.5;
var ZOOM_MIN = 0.5;
var ZOOM_MAX = 5;

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
