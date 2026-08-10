// Workbench 画布导航簇 — 板内定位、minimap、Section Navigator、缩放 HUD。
// P1a 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
// 共享状态经 app/store.js 的 wbGet()/wbSet() 读写；工具函数取自 lib/。
import { wbGet, wbSet } from './app/store.js';
import { currentCanvasZoom } from './lib/canvas-zoom.js';
import { pageViewport } from './lib/page-viewports.js';
import {
  centerScrollForPoint,
  closestBoardSection,
  findBoardFrame,
  findBoardSection,
  focusScrollForRect,
  hitTestBoardNavigation,
  measureBoardNavigation
} from './lib/board-navigation.js';

// 反向依赖注入：跳转后的标注快照刷新由 main.jsx 在 wireCanvasHud(deps) 注入
// （ann-bridge 的 scheduleAnnSnap；board-nav 不 import app/ 组件）。
// HUD 缩放按钮由 CanvasHud 组件直接调 boot-prefs 的 setCanvasZoom，不走这里。
var sectionJumpListener = null; // active group 跳转后：annFilter === 'tab' 时 scheduleAnnSnap()

var stage = document.getElementById('wbstage');

/** Scroll so board content sits near the viewer top-left (not lost in the empty pad). */
export function frameBoardInView(panel, options) {
  options = options || {};
  if (!stage || !panel) return;
  if (!options.force && pageViewport(options.pageId || wbGet().activePageId)) return;
  var cs = getComputedStyle(panel);
  var padL = parseFloat(cs.paddingLeft) || 0;
  var padT = parseFloat(cs.paddingTop) || 0;
  var inset = 40;
  var left = Math.max(0, padL - inset);
  var top = Math.max(0, padT - inset);
  if (options.smooth) {
    stage.scrollTo({ left: left, top: top, behavior: 'smooth' });
  } else {
    stage.scrollLeft = left;
    stage.scrollTop = top;
  }
}

var boardNavigationModel = null;

/** Refresh the single Canvas → Section → Frame geometry source used by both navigators. */
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
  var left = Math.max(0, bounds.left + bounds.width / 2 - stage.clientWidth / 2);
  var top = Math.max(0, bounds.top + bounds.height / 2 - stage.clientHeight / 2);
  stage.scrollTo({ left: left, top: top, behavior: 'smooth' });
}

/** Board load failure: drop stale nav geometry and hide both navigators. */
export function resetBoardNavOnLoadFailure() {
  boardNavigationModel = null;
  wbSet({ sectionNavVisible: false, minimapAvailable: false });
  setSectionNavigatorOpen(false);
  setMinimapOpen(false);
}

// HUD/dock DOM 句柄 —— 元素由 React（app/CanvasHud.jsx）渲染，模块加载时还不
// 存在，一律在 wireCanvasHud（main.jsx 于挂载后调用）里赋值；之前的调用经各
// 函数的 null 守卫安全空转。
var minimapWrap;
var minimapEl;
var minimapCanvas;
var minimapToggleBtn;
var minimapRaf = 0;
var minimapLayout = null; // { bounds, scale, ox, oy, cw, ch, sections, frames }

var MINIMAP_COLORS = [
  { section: 'rgba(0,122,255,.14)', active: 'rgba(0,122,255,.24)', stroke: 'rgba(0,122,255,.55)', frame: 'rgba(0,82,204,.72)' },
  { section: 'rgba(52,199,89,.14)', active: 'rgba(52,199,89,.24)', stroke: 'rgba(35,150,67,.55)', frame: 'rgba(30,125,56,.72)' },
  { section: 'rgba(255,149,0,.15)', active: 'rgba(255,149,0,.25)', stroke: 'rgba(210,112,0,.56)', frame: 'rgba(184,92,0,.74)' },
  { section: 'rgba(175,82,222,.14)', active: 'rgba(175,82,222,.24)', stroke: 'rgba(134,52,173,.55)', frame: 'rgba(111,43,145,.72)' },
  { section: 'rgba(90,200,250,.16)', active: 'rgba(90,200,250,.27)', stroke: 'rgba(41,151,203,.58)', frame: 'rgba(31,123,167,.74)' },
  { section: 'rgba(255,45,85,.13)', active: 'rgba(255,45,85,.23)', stroke: 'rgba(208,30,65,.54)', frame: 'rgba(176,25,55,.72)' }
];

var sectionNavWrap;
var sectionNavToggleBtn;
var sectionNavEl;
var sectionNavList;
var sectionNavItems = [];

// open/visible 状态归 store（minimapOpen/minimapAvailable/sectionNavOpen/
// sectionNavVisible），React 组件订阅派生 hidden/on/aria；本模块只写 store。
export function setMinimapOpen(on) {
  var open = !!on && wbGet().minimapAvailable;
  wbSet({ minimapOpen: open });
  if (open) scheduleMinimapUpdate();
}

export function updateMinimapAvailability(panel) {
  panel = panel || document.getElementById('wb-board-panel');
  var measured = panel ? refreshBoardNavigationModel(panel) : null;
  var available = !!(measured && measured.bounds.width >= 8 && measured.bounds.height >= 8);
  wbSet({ minimapAvailable: available });
  if (!available) {
    minimapLayout = null;
    setMinimapOpen(false);
  }
  return available ? measured : null;
}

export function scheduleMinimapUpdate() {
  if (minimapRaf || !wbGet().minimapOpen) return;
  minimapRaf = requestAnimationFrame(function () {
    minimapRaf = 0;
    updateMinimap();
  });
}

function updateMinimap() {
  if (!minimapWrap || !minimapEl || !minimapCanvas || !stage || !wbGet().minimapOpen) return;
  var panel = document.getElementById('wb-board-panel');
  var measured = updateMinimapAvailability(panel);
  var bounds = measured && measured.bounds;
  if (!bounds) return;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var cssW = minimapCanvas.clientWidth;
  var cssH = minimapCanvas.clientHeight;
  if (cssW < 8 || cssH < 8) return;
  var cw = Math.round(cssW * dpr);
  var ch = Math.round(cssH * dpr);
  if (minimapCanvas.width !== cw || minimapCanvas.height !== ch) {
    minimapCanvas.width = cw;
    minimapCanvas.height = ch;
  }
  var pad = 6 * dpr;
  var scale = Math.min((cw - pad * 2) / bounds.width, (ch - pad * 2) / bounds.height);
  var ox = (cw - bounds.width * scale) / 2;
  var oy = (ch - bounds.height * scale) / 2;
  minimapLayout = {
    bounds: bounds,
    scale: scale,
    ox: ox,
    oy: oy,
    cw: cw,
    ch: ch,
    dpr: dpr,
    sections: measured.sections,
    frames: measured.frames
  };

  var ctx = minimapCanvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);
  // Canvas layer
  ctx.fillStyle = 'rgba(15,23,42,.045)';
  ctx.fillRect(0, 0, cw, ch);

  // Section layer
  var sectionRects = measured.sections || [];
  minimapEl.setAttribute('data-minimap-section-count', String(sectionRects.length));
  minimapEl.setAttribute('data-minimap-frame-count', String(measured.frames.length));
  for (var s = 0; s < sectionRects.length; s++) {
    var section = sectionRects[s];
    var sectionColor = MINIMAP_COLORS[section.colorIndex % MINIMAP_COLORS.length];
    var sx = ox + (section.left - bounds.left) * scale;
    var sy = oy + (section.top - bounds.top) * scale;
    var sw = Math.max(4 * dpr, section.width * scale);
    var sh = Math.max(4 * dpr, section.height * scale);
    var sr = Math.min(5 * dpr, sw / 4, sh / 4);
    ctx.fillStyle = section.id === wbGet().activeGroup ? sectionColor.active : sectionColor.section;
    ctx.strokeStyle = sectionColor.stroke;
    ctx.lineWidth = section.id === wbGet().activeGroup ? Math.max(1.5 * dpr, 2) : Math.max(.75 * dpr, 1);
    roundRect(ctx, sx, sy, sw, sh, sr);
    ctx.fill();
    ctx.stroke();
  }

  // Frame layer
  var frameRects = measured.frames;
  for (var i = 0; i < frameRects.length; i++) {
    var frame = frameRects[i];
    var frameColor = MINIMAP_COLORS[frame.colorIndex % MINIMAP_COLORS.length];
    var x = ox + (frame.left - bounds.left) * scale;
    var y = oy + (frame.top - bounds.top) * scale;
    var w = Math.max(2 * dpr, frame.width * scale);
    var h = Math.max(2 * dpr, frame.height * scale);
    var rr = Math.min(4 * dpr, w / 4, h / 4);
    ctx.fillStyle = frameColor.frame;
    roundRect(ctx, x, y, w, h, rr);
    ctx.fill();
  }

  // Viewport window
  var vx = ox + (stage.scrollLeft - bounds.left) * scale;
  var vy = oy + (stage.scrollTop - bounds.top) * scale;
  var vw = stage.clientWidth * scale;
  var vh = stage.clientHeight * scale;
  ctx.strokeStyle = 'rgba(0,122,255,.9)';
  ctx.lineWidth = Math.max(1.5 * dpr, 2);
  ctx.fillStyle = 'rgba(0,122,255,.12)';
  roundRect(ctx, vx, vy, vw, vh, 3 * dpr);
  ctx.fill();
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function stageViewportMetrics() {
  return {
    width: stage.clientWidth,
    height: stage.clientHeight,
    scrollWidth: stage.scrollWidth,
    scrollHeight: stage.scrollHeight
  };
}

/** Shared focus behavior for both navigators: center fitting targets, leading-align large ones. */
function focusStageOnRect(rect, options) {
  if (!stage || !rect) return;
  options = options || {};
  var target = focusScrollForRect(rect, stageViewportMetrics(), { inset: options.inset || 24 });
  stage.scrollTo({
    left: target.left,
    top: target.top,
    behavior: options.smooth === false ? 'auto' : 'smooth'
  });
}

function centerStageOnPoint(x, y, options) {
  if (!stage) return;
  options = options || {};
  var target = centerScrollForPoint({ x: x, y: y }, stageViewportMetrics());
  stage.scrollTo({
    left: target.left,
    top: target.top,
    behavior: options.smooth === false ? 'auto' : 'smooth'
  });
}

function minimapJump(clientX, clientY) {
  if (!minimapLayout || !stage || !minimapCanvas) return;
  var rect = minimapCanvas.getBoundingClientRect();
  var mx = ((clientX - rect.left) / rect.width) * minimapLayout.cw;
  var my = ((clientY - rect.top) / rect.height) * minimapLayout.ch;
  var b = minimapLayout.bounds;
  var cx = b.left + (mx - minimapLayout.ox) / minimapLayout.scale;
  var cy = b.top + (my - minimapLayout.oy) / minimapLayout.scale;
  var hit = hitTestBoardNavigation(minimapLayout, cx, cy, { framePadding: 48 });
  if (hit.kind === 'frame' || hit.kind === 'section') {
    focusStageOnRect(hit.target);
    return;
  }
  centerStageOnPoint(cx, cy);
}

export function wireMinimap() {
  if (!minimapWrap || !minimapEl || !minimapCanvas) return;
  minimapEl.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    minimapJump(e.clientX, e.clientY);
  });
  window.addEventListener('resize', function () {
    updateMinimapAvailability();
    scheduleMinimapUpdate();
  });
}

export function setSectionNavigatorOpen(on) {
  wbSet({ sectionNavOpen: !!on && wbGet().sectionNavVisible });
  updateSectionNavigatorActive(wbGet().activeGroup);
}

function collectSectionNavigatorItems(model) {
  if (!model) return [];
  return model.sections.map(function (section) {
    return {
      id: section.id,
      title: section.title,
      screens: section.frames.filter(function (frame) { return !!frame.screenId; }).map(function (frame) {
        return {
          id: frame.screenId,
          title: frame.title
        };
      })
    };
  }).filter(function (item) { return item.id && item.id !== '_empty'; });
}

function closestSectionNavigatorGroup() {
  if (!stage) return null;
  var section = closestBoardSection(
    currentBoardNavigationModel(),
    stage.scrollTop + stage.clientHeight / 2
  );
  return section && section.id;
}

function sectionNavigatorShouldShow(panel) {
  if (!stage || !panel || !sectionNavItems.length) return false;
  if (sectionNavItems.length > 1) return true;
  var bounds = boardContentBounds(panel);
  if (!bounds) return false;
  return bounds.width > stage.clientWidth + 24 || bounds.height > stage.clientHeight + 24;
}

export function updateSectionNavigatorVisibility() {
  var panel = document.getElementById('wb-board-panel');
  var visible = sectionNavigatorShouldShow(panel);
  wbSet({ sectionNavVisible: visible });
  if (!visible) setSectionNavigatorOpen(false);
}

export function updateSectionNavigatorActive(groupId) {
  if (!sectionNavItems.length) return;
  var index = sectionNavItems.findIndex(function (item) { return item.id === groupId; });
  if (index < 0) index = 0;
  var current = sectionNavItems[index];
  if (sectionNavList) {
    [].slice.call(sectionNavList.querySelectorAll('.wb-section-nav-item')).forEach(function (item) {
      var on = item.getAttribute('data-nav-group') === current.id;
      item.classList.toggle('on', on);
      var button = item.querySelector('.wb-section-nav-section');
      if (button) {
        if (on) button.setAttribute('aria-current', 'location');
        else button.removeAttribute('aria-current');
      }
    });
  }
  wbSet({
    sectionNavPosition: String(index + 1) + ' / ' + String(sectionNavItems.length),
    sectionNavCurrent: current.title
  });
}

export function rebuildSectionNavigator(panel) {
  if (!sectionNavList || !sectionNavWrap) return;
  var model = updateMinimapAvailability(panel);
  sectionNavItems = collectSectionNavigatorItems(model);
  sectionNavList.innerHTML = '';

  sectionNavItems.forEach(function (entry) {
    var item = document.createElement('div');
    item.className = 'wb-section-nav-item';
    item.setAttribute('data-nav-group', entry.id);

    var sectionButton = document.createElement('button');
    sectionButton.type = 'button';
    sectionButton.className = 'wb-section-nav-section';
    sectionButton.setAttribute('data-nav-group', entry.id);
    sectionButton.title = entry.title;
    var label = document.createElement('span');
    label.className = 'wb-section-nav-label';
    label.textContent = entry.title;
    sectionButton.appendChild(label);
    item.appendChild(sectionButton);

    var screens = document.createElement('div');
    screens.className = 'wb-section-nav-screens';
    entry.screens.forEach(function (screen) {
      var screenButton = document.createElement('button');
      screenButton.type = 'button';
      screenButton.className = 'wb-section-nav-screen';
      screenButton.setAttribute('data-nav-group', entry.id);
      screenButton.setAttribute('data-nav-screen', screen.id);
      screenButton.setAttribute('aria-label', '定位到 ' + entry.title + ' · ' + screen.title);
      screenButton.title = screen.title;
      screens.appendChild(screenButton);
    });
    item.appendChild(screens);
    sectionNavList.appendChild(item);
  });

  updateSectionNavigatorVisibility();
  var closest = closestSectionNavigatorGroup() || sectionNavItems[0] && sectionNavItems[0].id;
  if (closest) wbSet({ activeGroup: closest });
  updateSectionNavigatorActive(wbGet().activeGroup);
  setSectionNavigatorOpen(wbGet().sectionNavOpen);
  setMinimapOpen(wbGet().minimapOpen);
}

function jumpSectionNavigatorToGroup(groupId) {
  var section = findBoardSection(refreshBoardNavigationModel(), groupId);
  if (!section || !stage) return;
  wbSet({ activeGroup: groupId });
  updateSectionNavigatorActive(groupId);
  if (sectionJumpListener) sectionJumpListener();
  focusStageOnRect(section);
}

function jumpSectionNavigatorToScreen(groupId, screenId) {
  focusWorkbenchFrame(groupId, screenId);
}

export function focusWorkbenchFrame(groupId, screenId, options) {
  var frame = findBoardFrame(refreshBoardNavigationModel(), groupId, screenId);
  if (!frame || !stage) return false;
  wbSet({ activeGroup: groupId });
  updateSectionNavigatorActive(groupId);
  if (sectionJumpListener) sectionJumpListener();
  focusStageOnRect(frame, options);
  return true;
}

/** True when keyboard shortcuts should yield to text entry. */
export function isTypingTarget(el) {
  if (!el || !el.closest) return false;
  if (el.closest('input, textarea, select')) return true;
  var ce = el.closest('[contenteditable]');
  return !!(ce && ce.isContentEditable);
}

export function wireSectionNavigator() {
  if (!sectionNavWrap || !sectionNavList) return;
  sectionNavList.addEventListener('click', function (event) {
    var screenButton = event.target.closest('[data-nav-screen]');
    if (screenButton) {
      jumpSectionNavigatorToScreen(
        screenButton.getAttribute('data-nav-group'),
        screenButton.getAttribute('data-nav-screen')
      );
      return;
    }
    var sectionButton = event.target.closest('.wb-section-nav-section[data-nav-group]');
    if (sectionButton) jumpSectionNavigatorToGroup(sectionButton.getAttribute('data-nav-group'));
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && (wbGet().sectionNavOpen || wbGet().minimapOpen)) {
      var focusTarget = wbGet().sectionNavOpen ? sectionNavToggleBtn : minimapToggleBtn;
      setSectionNavigatorOpen(false);
      setMinimapOpen(false);
      if (focusTarget) focusTarget.focus();
      return;
    }
    if (event.key.toLowerCase() !== 'm' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    setSectionNavigatorOpen(!wbGet().sectionNavOpen);
  });
  window.addEventListener('resize', updateSectionNavigatorVisibility);
}

// React 挂载完成后由 main.jsx 调用一次：HUD/dock DOM 句柄赋值 + 命令式布线
// （minimap 跳点、section-nav 列表委派、Escape/M 键盘、resize）。缩放与回中
// 按钮是 CanvasHud 组件的 onClick，不在此列。
export function wireCanvasHud(deps) {
  deps = deps || {};
  sectionJumpListener = deps.onSectionJump || null;
  minimapWrap = document.getElementById('wbminimap-wrap');
  minimapEl = document.getElementById('wbminimap');
  minimapCanvas = document.getElementById('wbminimap-canvas');
  minimapToggleBtn = document.getElementById('wbminimap-toggle');
  sectionNavWrap = document.getElementById('wbsection-nav-wrap');
  sectionNavToggleBtn = document.getElementById('wbsection-nav-toggle');
  sectionNavEl = document.getElementById('wbsection-nav');
  sectionNavList = document.getElementById('wbsection-nav-list');
  wbSet({ canvasZoom: String(currentCanvasZoom()) });
  wireMinimap();
  wireSectionNavigator();
}
