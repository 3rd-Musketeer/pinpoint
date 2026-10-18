// wiki 面板（文章顶栏的 wiki 按钮打开）的定位与动效参数。
// 几何是纯函数，便于单测；DOM 与动画在 client.js。
// 设计：桌面以按钮右下角为锚、间距 8、宽 320、高上限 min(60dvh, 480)，视口边缘至少留 12。
// 窄屏（面板按 calc(100vw - 24px) 排、比按钮还宽）改为贴左缘 12、顶在按钮下 8，不盖住顶栏。

export const WIKI_PANEL_GAP = 8;
export const WIKI_PANEL_MARGIN = 12;
export const WIKI_PANEL_WIDTH = 320;
export const WIKI_PANEL_MAX_H = 480;
export const WIKI_PANEL_MAX_VH = 0.6;

/** 打开：opacity 0→1、translateY(-6px)→0，140 ms。 */
export const WIKI_OPEN_MS = 140;
export const WIKI_OPEN_Y = -6;
/** 关闭走相反路径，100 ms。 */
export const WIKI_CLOSE_MS = 100;
export const WIKI_EASE = 'cubic-bezier(.2,.8,.2,1)';
/** 减少动态效果时只做 80 ms 淡入淡出，不位移。 */
export const WIKI_REDUCED_MS = 80;

/**
 * 面板落在哪。anchor 是按钮的视口矩形；panelW / panelH 是面板实际尺寸（窄屏是
 * calc(100vw - 24px)）；maxH 是这一屏的高度上限。返回视口坐标与实际可用高度。
 * 桌面右缘对齐按钮右缘、再往下 gap；窄屏（视口放不下面板加两侧留白）贴左缘 margin，
 * 不从按钮右下角向左长出视口。右边放不下就往左收，下面放不下就往上收，四边都至少留 margin。
 */
export function placeWikiPanel({ anchor, panelW, panelH, viewportW, viewportH, maxH, gap = WIKI_PANEL_GAP, margin = WIKI_PANEL_MARGIN, minTop = margin }) {
  const cap = Math.max(0, Math.min(maxH, viewportH - margin * 2));
  const height = Math.min(panelH, cap);
  // 窄屏面板（宽约 100vw - 24）比按钮宽，右缘对齐会探出视口左边，改为贴左缘。
  const narrow = panelW > anchor.width && panelW + margin > viewportW;
  let left = narrow ? margin : anchor.right - panelW;
  left = Math.max(margin, Math.min(left, viewportW - margin - panelW));
  // minTop 用来让出顶栏：窄屏按钮换行时，按钮下沿仍可能高于顶栏下沿。
  let top = Math.max(anchor.bottom + gap, minTop);
  if (top + height > viewportH - margin) top = anchor.top - gap - height;
  top = Math.max(margin, Math.min(top, viewportH - margin - height));
  return { left, top, width: panelW, maxHeight: cap };
}
