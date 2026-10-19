// 当前生效 zoom 的读取（DOM 桥）：--wb-board-zoom 写在 :root 上，值是 zoom 轴值。
// 缩放轴的范围、步进与换算等共享数学在 src/shared/canvas-gesture.js（与离线导出页
// 共用），这里只留工作台自己的 DOM 读取。
//
// 2026-08-17 基准重定标（owner 决定，decisions 08-17c）：视觉缩放 = zoom ×
// BASE_CANVAS_SCALE —— zoom 轴 1（HUD 100%）= owner 舒适默认（旧轴 50% 的
// 视觉大小）。两个消费点都必须乘 BASE：index.html 的 .wb-library transform、
// boot-prefs 的 syncBoardZoomLayout。
export function currentCanvasZoom() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wb-board-zoom')) || 1;
}
