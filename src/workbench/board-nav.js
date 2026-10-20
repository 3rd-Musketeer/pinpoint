import { scrollStageTo } from './scroll-motion.js';
// Workbench 板内几何、定位、回中与选中模型。
// P1a 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
// 共享状态经 app/store.js 的 wbGet()/wbSet() 读写；工具函数取自 lib/。
import { wbGet, wbSet } from './app/store.js';
import { boardShowsTabBar } from './lib/board-entries.js';
import { pageViewport, viewportKey } from './lib/page-viewports.js';
import { CHROME_GAP, FOCUS_INSET, centerScrollForPoint, focusScrollForRect } from '../shared/canvas-gesture.js';
import { registerEmbedPark } from './embed-park.js';
import {
  closestBoardSection,
  findBoardFrame,
  findBoardSection,
  measureBoardNavigation
} from './lib/board-navigation.js';

// 反向依赖注入已随 annFilter 退役（2026-08-15 侧栏重构）：跳转后不再需要
// 面板侧刷新回调。HUD 缩放按钮由 CanvasHud 组件直接调 boot-prefs 的
// zoomCanvasAt / setCanvasZoom，不走这里。

var stage = document.getElementById('wbstage');

/** Scroll so board content sits near the viewer top-left (not lost in the empty pad). */
export function frameBoardInView(panel, options) {
  options = options || {};
  if (!stage || !panel) return;
  var viewportPage = options.pageId || wbGet().activePageId;
  if (!options.force && pageViewport(viewportKey(viewportPage, wbGet().activeBoard))) return;
  var cs = getComputedStyle(panel);
  var padL = parseFloat(cs.paddingLeft) || 0;
  var padT = parseFloat(cs.paddingTop) || 0;
  var inset = 40;
  // 浮起的 chrome 也要减掉（2026-09-04）：少滚这么多 = 内容往右下让开左栏与
  // 横条，板的第一屏不会开在玻璃面板底下。
  var insets = chromeInsets();
  var left = Math.max(0, padL - inset - insets.left);
  var top = Math.max(0, padT - inset - insets.top);
  scrollStageTo(stage, { left, top }, { smooth: !!options.smooth });
}

var boardNavigationModel = null;

/** 刷新定位、回中与 scroll spy 共用的板几何。 */
export function refreshBoardNavigationModel(panel) {
  panel = panel || document.getElementById('wb-board-panel');
  boardNavigationModel = measureBoardNavigation(stage, panel);
  return boardNavigationModel;
}

export function currentBoardNavigationModel() {
  return boardNavigationModel || refreshBoardNavigationModel();
}

/** Union rect (stage-scroll coords) of all visible board sections. */
function boardContentBounds(panel) {
  var measured = panel ? refreshBoardNavigationModel(panel) : currentBoardNavigationModel();
  return measured && measured.bounds;
}

/** Recenter viewport on the midpoint of all content frames. */
export function recenterBoard() {
  var panel = document.getElementById('wb-board-panel');
  if (!stage || !panel) return;
  var bounds = boardContentBounds(panel);
  if (!bounds) {
    frameBoardInView(panel, { force: true, smooth: true });
    return;
  }
  var target = centerScrollForPoint(
    { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 },
    stageViewportMetrics()
  );
  scrollStageTo(stage, target);
}

/** 板装载失败时丢弃旧几何。 */
export function resetBoardNavOnLoadFailure() {
  boardNavigationModel = null;
}

/* chrome 占位（2026-09-04 外壳重设计）：画布满铺整个视口，左栏玻璃面板与底部
   横条压在它上面 —— 「人看得见的画布」= stage 视口减掉这两块。定位 / 回中 /
   首访聚焦全部经 stageViewportMetrics 拿到 insets，选中的 frame 因此永远不会
   落在 chrome 底下。量的是实际 bounding box（不是 token 常量）：面板折叠、
   拖宽、横条随内容变宽都自动跟上。 */
export function chromeInsets() {
  var out = { left: 0, right: 0, top: 0, bottom: 0 };
  if (!stage) return out;
  var stageRect = stage.getBoundingClientRect();
  var side = document.getElementById('wbside');
  if (side && !wbGet().sideCollapsed) {
    var sr = side.getBoundingClientRect();
    if (sr.width > 1) out.left = Math.max(0, sr.right - stageRect.left + CHROME_GAP);
  }
  var annPanel = document.getElementById('wbann-pop');
  if (annPanel) {
    var ar = annPanel.getBoundingClientRect();
    if (ar.width > 1) out.right = Math.max(0, stageRect.right - ar.left + CHROME_GAP);
  }
  // 上方：文章画布左上角的“← 文章标题”（app/ArticleBack.jsx）。只有它在顶上，所以上方留白就是它的下沿。
  var back = document.getElementById('wbback');
  if (back) {
    var br = back.getBoundingClientRect();
    if (br.height > 1) out.top = Math.max(0, br.bottom - stageRect.top + CHROME_GAP);
  }
  // 底部：横条，以及叠在它上面的 tab 切换条（页 tab，ADR 0041；只有 ≥ 2 个 tab 的页有）—— 取更高的那一条。
  // 不出条的页（文章画布、单 tab 页）只占横条那一带，大纲钮在横条里（2026-10-15）。
  ['wbstrip', 'wbtabbar'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var tr = el.getBoundingClientRect();
    if (tr.height > 1) out.bottom = Math.max(out.bottom, stageRect.bottom - tr.top + CHROME_GAP);
  });
  // 条是 React 画的，首访聚焦的 rAF 经常早于它提交。条该出（boardShowsTabBar）就按同一套 CSS 预留
  //（条高 --wb-tabbar-h，叠在横条上方 --wb-tabbar-gap），免得帧落在条底下。
  if (!document.getElementById('wbtabbar')) out.bottom += reservedTabBarLift();
  return out;
}

function reservedTabBarLift() {
  var active = wbGet().activeBoard;
  var full = active && (active.fullBoard || active.board);
  if (!full || !boardShowsTabBar(full)) return 0;
  var host = stage.closest('.wb') || stage;
  var cs = getComputedStyle(host);
  var tabH = parseFloat(cs.getPropertyValue('--wb-tabbar-h'));
  var gap = parseFloat(cs.getPropertyValue('--wb-tabbar-gap'));
  if (!(tabH > 1)) return 0;
  return (gap > 0 ? gap : 6) + tabH;
}

function stageViewportMetrics() {
  return {
    width: stage.clientWidth,
    height: stage.clientHeight,
    scrollWidth: stage.scrollWidth,
    scrollHeight: stage.scrollHeight,
    insets: chromeInsets()
  };
}

/** 聚焦：小目标居中，大目标按起始边对齐。 */
function focusStageOnRect(rect, options) {
  if (!stage || !rect) return;
  options = options || {};
  var target = focusScrollForRect(rect, stageViewportMetrics(), { inset: options.inset || FOCUS_INSET });
  scrollStageTo(stage, target, options);
}

function closestBoardGroup() {
  if (!stage) return null;
  var insets = chromeInsets();
  var section = closestBoardSection(
    currentBoardNavigationModel(),
    stage.scrollTop + insets.top + (stage.clientHeight - insets.top - insets.bottom) / 2
  );
  return section && section.id;
}

// 板装载那一帧量不出几何（还没排版）时，逐帧重量，最多这么多帧。
var BOARD_GEOMETRY_RETRY_FRAMES = 30;
var geometryRetryRaf = 0;

function boardGeometryReady(panel) {
  var model = refreshBoardNavigationModel(panel);
  return !!(model && model.bounds.width >= 8 && model.bounds.height >= 8);
}

/** 板挂载或帧重置后重量；首帧尚未排版时逐帧补量。 */
export function initializeBoardGeometry(panel) {
  if (geometryRetryRaf) cancelAnimationFrame(geometryRetryRaf);
  geometryRetryRaf = 0;
  if (!boardGeometryReady(panel)) retryUnmeasuredBoard(panel, BOARD_GEOMETRY_RETRY_FRAMES);
  var closest = closestBoardGroup();
  if (closest) wbSet({ activeGroup: closest });
}

/** 板里有 section 却量不出几何：下一帧再量，量到了（或板换掉、次数用完）就停。
 *  停驻（E2）时不逐帧重试：画布看不见，量出来的几何也不作数。打开时从剩下的
 *  帧数接着量，不把停驻的时间算进重试次数。 */
var geometryPaused = false;
var geometryFramesLeft = 0;
function retryUnmeasuredBoard(panel, framesLeft) {
  if (framesLeft <= 0 || !panel || !panel.isConnected || !panel.querySelector('.wb-lib-item')) return;
  geometryRetryRaf = requestAnimationFrame(function () {
    geometryRetryRaf = 0;
    // 停驻期间这一帧不重试，但帧数留着：恢复时从剩下的帧数接着量。
    if (geometryPaused) { geometryFramesLeft = framesLeft; return; }
    if (!boardGeometryReady(panel)) retryUnmeasuredBoard(panel, framesLeft - 1);
  });
}

registerEmbedPark({
  pause: function () {
    geometryPaused = true;
    if (geometryRetryRaf) { cancelAnimationFrame(geometryRetryRaf); geometryRetryRaf = 0; }
  },
  resume: function () {
    geometryPaused = false;
    var panel = document.getElementById('wb-board-panel');
    var left = geometryFramesLeft;
    geometryFramesLeft = 0;
    // 打开的这一帧先补量一次：停驻时量到的是空的，定位要等这次的结果。
    // 选中也补一次：停驻期间标注层的观察器断开，store 里的选中没写到 DOM 上。
    if (panel) { boardGeometryReady(panel); syncBoardSelection(); }
    if (panel && left > 0 && !boardGeometryReady(panel)) retryUnmeasuredBoard(panel, left);
  },
});

/** 量到的目标落位 + 选中态同步（section 与 frame 两条定位共用）。 */
function focusBoardTarget(rect, groupId, options) {
  wbSet({ activeGroup: groupId });
  focusStageOnRect(rect, options);
}

export function focusBoardSection(groupId, options) {
  var section = findBoardSection(refreshBoardNavigationModel(), groupId);
  if (!section || !stage) return false;
  focusBoardTarget(section, groupId, options);
  return true;
}

// 页 tab（ADR 0041）：目标帧不在当前 tab 的 DOM 里时，由 stage.js 经 setFrameRevealer 注入
// 的函数把活动 tab 切过去（pages.js revealFrame；board-nav 不能反向 import pages.js）。
// 返回 Promise<boolean>，已在当前 tab / 查不到时返回 false。
var frameRevealer = null;

export function setFrameRevealer(fn) {
  frameRevealer = fn;
}

/** 定位到某个帧。同 tab 里同步返回 boolean；帧在另一个 tab 时先切 tab、板重挂完再定位，返回 Promise<boolean>。 */
export function focusWorkbenchFrame(groupId, screenId, options) {
  var frame = findBoardFrame(refreshBoardNavigationModel(), groupId, screenId);
  if (!frame && frameRevealer) {
    var pending = frameRevealer(screenId);
    if (pending) {
      return pending.then(function (ok) {
        return ok ? focusWorkbenchFrame(groupId, screenId, options) : false;
      });
    }
  }
  if (!frame || !stage) return false;
  focusBoardTarget(frame, groupId, options);
  return true;
}

/* 首访落点（2026-08-16 TODO 小修，owner 拍板）：无存档视口时聚焦第一个有 frame
   的 section 的第一帧（instant 居中），取代旧的「滚到板原点」（frameBoardInView
   的 pad-inset 语义—— origin 左上角常常没有内容）。回访仍由 pageViewports
   恢复：preview-mount afterMount 仅在 restore 返回 false 时调本函数。 */
export function focusFirstBoardFrame() {
  var model = refreshBoardNavigationModel();
  var secs = (model && model.sections) || [];
  for (var i = 0; i < secs.length; i++) {
    var frames = secs[i].frames || [];
    if (frames.length) return focusWorkbenchFrame(secs[i].id, frames[0].screenId, { smooth: false });
  }
  return false;
}

/* 「内容」区 frame 树行点击的 focus 环反馈（decisions 2026-08-15c）：在 frame 机身上
   闪一圈 accent 环（~1.1s CSS 动画），与标注卡 goToMark 的锚点 ann-flash 分工 ——
   卡定位闪锚点，树定位闪整机。 */
export function flashBoardFrame(groupId, screenId) {
  var frame = findBoardFrame(refreshBoardNavigationModel(), groupId, screenId);
  var node = frame && frame.node;
  if (!node || !node.classList) return false;
  node.classList.remove('wb-frame-flash');
  void node.offsetWidth; // 重启动画（同 mock 的 ind pulse 复位手法）
  node.classList.add('wb-frame-flash');
  setTimeout(function () { node.classList.remove('wb-frame-flash'); }, 1200);
  return true;
}

/* 2026-08-17 选中模型（detail 面板）：frame/section 各有一个持久选中态（.wb-sel），
   与 focus 环 flash 分工 —— flash 是定位反馈，.wb-sel 是「右栏正在展示谁」。
   选中源 = store.focusFrameKey / focusSectionId（互斥）；这里拥有画布侧的
   class 同步，stage.js 在 store 订阅里调 syncBoardSelection。 */
export function selectBoardFrame(sectionId, screenId) {
  wbSet({ focusFrameKey: sectionId + '\0' + screenId, focusSectionId: null, focusAnnN: null });
}

export function selectBoardSection(sectionId) {
  wbSet({ focusSectionId: sectionId, focusFrameKey: null, focusAnnN: null });
}

export function clearBoardSelection() {
  wbSet({ focusFrameKey: null, focusSectionId: null, focusAnnN: null });
}

export function syncBoardSelection() {
  var panel = document.getElementById('wb-board-panel');
  if (!panel) return;
  var s = wbGet();
  var want = null;
  if (s.focusFrameKey) {
    var parts = s.focusFrameKey.split('\0');
    want = panel.querySelector(
      '.wb-lib-item[data-ann-section="' + CSS.escape(parts[0]) + '"] [data-screen="' + CSS.escape(parts[1]) + '"]'
    );
  } else if (s.focusSectionId) {
    want = panel.querySelector('.wb-lib-item[data-ann-section="' + CSS.escape(s.focusSectionId) + '"]');
  }
  // 只在选中真的变了时写 DOM。store 每次变（标注快照每次 notify 都换新对象）都会调到这里，
  // 同值的 remove + add 也是两条属性变更：标注客户端的 MutationObserver 收到后整板重渲染、再 notify，
  // 自己喂自己转不停，占满主线程（2026-10-19 性能审计 K1，Kimi；owner 在画布上打字卡）。
  panel.querySelectorAll('.wb-sel').forEach(function (node) { if (node !== want) node.classList.remove('wb-sel'); });
  if (want && !want.classList.contains('wb-sel')) want.classList.add('wb-sel');
}

// 视口尺寸改变后，scroll spy 与定位继续使用当前板的真实几何。
window.addEventListener('resize', function () { refreshBoardNavigationModel(); });
