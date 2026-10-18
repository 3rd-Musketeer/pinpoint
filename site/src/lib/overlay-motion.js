// 画布浮层的转场参数（site/README.md「画布浮层」）。只放纯函数，好单测。

/** 进入：opacity 0→1、scale .985→1，140ms。退出走相反路径，100ms。 */
export const OV_OPEN_MS = 140;
export const OV_CLOSE_MS = 100;
export const OV_SCALE = 0.985;
export const OV_EASE = 'cubic-bezier(.2,.8,.2,1)';
/** 减少动态效果：只淡入淡出，没有缩放。 */
export const OV_REDUCED_MS = 80;

/**
 * 面板的 transform-origin。入口在视口上三分之一取顶、下三分之一取底，其余取中。
 * anchorY 是入口中心相对视口的纵坐标。
 */
export function overlayOrigin(anchorY, viewportH) {
  const y = anchorY / viewportH;
  if (y < 1 / 3) return 'center top';
  if (y > 2 / 3) return 'center bottom';
  return 'center center';
}
