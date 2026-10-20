/**
 * 画布手势与定位的共享数学：zoom 轴、围绕指针缩放的不动点、焦点落点、可用区、
 * 适配缩放，以及手势常量（ctrl+wheel 步进、拖动判定阈值、空格/中键的显式手势
 * 判定）。工作台（stage.js、boot-prefs.js、board-nav.js、lib/board-navigation.js）
 * 与离线导出页（src/client/share-runtime.js，构建成经典脚本内联）共用这一份 ——
 * 改画布手感只改这里，不再靠「语义对齐 stage.js」的注释维持两边一致。
 *
 * 纯函数、不碰 DOM：本文件在 /annotate.js 的打包名单口径内，也被离线导出内联。
 */

/** 视觉缩放 = zoom 轴值 × BASE（decisions 08-17c 基准重定标：轴值 1 = 舒适默认）。 */
export var BASE_CANVAS_SCALE = 0.5;
/** zoom 轴范围 0.5–5（× BASE 后视觉范围仍是 0.25–2.5）。 */
export var ZOOM_MIN = 0.5;
export var ZOOM_MAX = 5;
/** ctrl / ⌘ + 滚轮一步的缩放比：deltaY > 0 缩小，否则放大。 */
export var ZOOM_STEP_OUT = 0.92;
export var ZOOM_STEP_IN = 1.08;
/** 焦点落点与适配缩放里给内容留的边距（board 单位）。 */
export var FOCUS_INSET = 24;
/** 可用区里浮动 chrome 与内容之间的间隙（chromeInsets 加在占位边上的那 12px）。 */
export var CHROME_GAP = 12;
/** 拖动判定阈值（px²）：位移平方过了它才算平移（4px），原地按下不算。 */
export var PAN_DRAG_THRESHOLD_SQ = 16;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** zoom 轴值夹进 0.5–5 并保留两位小数；非数值（坏偏好串之类）读作 1。 */
export function clampZoom(z) {
  z = clamp(Number(z) || 1, ZOOM_MIN, ZOOM_MAX);
  return Math.round(z * 100) / 100;
}

/** HUD 缩放读数：1 → '100%'，0.85 → '85%'，坏值回落 100%。 */
export function formatZoomLabel(z) {
  var n = Math.round(Number(z) * 100);
  if (!isFinite(n)) n = 100;
  return n + '%';
}

/** 可用区 = 视口减掉四边 chrome 占位；至少留 1px，chrome 比视口还宽时不出负数。
    insets 缺省全 0：注入端（无 chrome）与既有单测行为不变。 */
export function usableViewport(viewport) {
  var insets = viewport.insets || {};
  var left = insets.left || 0;
  var right = insets.right || 0;
  var top = insets.top || 0;
  var bottom = insets.bottom || 0;
  return {
    left: left,
    top: top,
    width: Math.max(1, viewport.width - left - right),
    height: Math.max(1, viewport.height - top - bottom),
  };
}

function focusAxis(start, size, viewportSize, inset) {
  if (size + inset * 2 <= viewportSize) return start + size / 2 - viewportSize / 2;
  return start - inset;
}

/** 焦点落点：放得下就居中，放不下就让起点贴可用区左上；结果换回 scroll 坐标并
    夹进滚动范围。insets 的占位在算完后再减掉（可用区起点不算进内容坐标）。 */
export function focusScrollForRect(rect, viewport, options) {
  var inset = options && options.inset != null ? options.inset : FOCUS_INSET;
  var maxLeft = Math.max(0, viewport.scrollWidth - viewport.width);
  var maxTop = Math.max(0, viewport.scrollHeight - viewport.height);
  var usable = usableViewport(viewport);
  return {
    left: clamp(focusAxis(rect.left, rect.width, usable.width, inset) - usable.left, 0, maxLeft),
    top: clamp(focusAxis(rect.top, rect.height, usable.height, inset) - usable.top, 0, maxTop),
  };
}

/** 把一点居中进可用区，夹进滚动范围（回中与离线帧定位用）。 */
export function centerScrollForPoint(point, viewport) {
  var usable = usableViewport(viewport);
  return {
    left: clamp(point.x - usable.width / 2 - usable.left, 0, Math.max(0, viewport.scrollWidth - viewport.width)),
    top: clamp(point.y - usable.height / 2 - usable.top, 0, Math.max(0, viewport.scrollHeight - viewport.height)),
  };
}

/** 让一块 layoutWidth（transform 前的布局宽，board 单位）在 availableWidth 里放下
    的 zoom 轴值：放得下就 maxZoom（缺省 1），放不下就缩，最低 ZOOM_MIN。 */
export function fitZoomForWidth(layoutWidth, availableWidth, options) {
  var inset = options && options.inset != null ? options.inset : FOCUS_INSET;
  var maxZoom = options && options.maxZoom != null ? options.maxZoom : 1;
  var room = availableWidth - inset * 2;
  if (!(layoutWidth > 0) || !(room > 0)) return clampZoom(maxZoom);
  return clampZoom(Math.min(maxZoom, room / (layoutWidth * BASE_CANVAS_SCALE)));
}

/** 缩放不动点的 scroll 回写：缩放后指针底下那个画布点要留在指针底下。
    scroll = 当前 scroll 坐标，mouse = 指针相对 stage 视口原点的偏移，origin =
    缩放元素（.wb-zoom-wrap）左上角的 scroll 坐标，ratio = next / old。
    boot-prefs.zoomCanvasAt 与 share-runtime 的 zoomAround 共用这条公式。 */
export function scrollAfterZoom(scroll, mouse, origin, ratio) {
  return origin + (scroll + mouse - origin) * ratio - mouse;
}

/** 显式导航手势 = 中键拖，或空格按住时的左键拖；无修饰的拖动不在此列（只在空白
    画布上平移，不抢机身 / 按钮 / 链接）。两处 DOM 壳（stage.js、share-runtime）判定共用。 */
export function isExplicitPanGesture(button, spaceDown) {
  return button === 1 || (button === 0 && !!spaceDown);
}
