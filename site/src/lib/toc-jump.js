// 窄屏目录入口（目录栏隐藏时，正文顶上的单行“目录 n / N 标题”）。
// 这里只放跳转落点的算法：点一节要让标题落在顶栏和这条入口的下面，不藏进去。

export const TOC_JUMP_GAP = 8;

/** 打开：opacity + 4px 位移，120 ms。减少动态效果时只淡入。 */
export const TOC_OPEN_MS = 120;
export const TOC_OPEN_Y = -4;
export const TOC_EASE = 'cubic-bezier(.2,.8,.2,1)';
export const TOC_REDUCED_MS = 80;

/**
 * 跳到一节时页面该滚到哪。sectionTop 是节的文档坐标，occupied 是此时粘住的顶栏
 * 加目录入口的高度。返回的 scrollY 让节标题落在这层下面 gap px。
 */
export function tocJumpScroll(sectionTop, occupied, gap = TOC_JUMP_GAP) {
  return Math.max(0, sectionTop - occupied - gap);
}
