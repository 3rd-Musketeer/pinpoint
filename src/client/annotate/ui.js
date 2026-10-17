// 工具条与覆盖层：样式注入、overlay / chrome 挂载、标注模式与暂停开关、
// 清空失效标注。导出 bind_ui、init_ui、installUiBindings、mountOverlay、
// toggleMode、notify、setStatus 等。
import { annotateCss } from '../annotate-css.js';
import { installOverlayScrollbars } from '../overlay-scrollbar.js';
import { isClearableMark } from '../../shared/annotation-indicator.js';
import { badgePositionInBox, expandRect } from '../../shared/annotate-clip.js';
import { markElementTargets, markOnActivePage, resolveMarkTarget, screenOffTab } from './anchor.js';
import { clearBubbles, renderAll } from './bubbles.js';
import { closeComposer } from './composer.js';
import { clearAnchorCache, placeOverlayRect, visibleViewRectDoc, visibleViewRectOf } from './dom.js';
import { clearHover } from './gesture.js';
import { persist } from './persist.js';
import { sidebarSuppressed, toggleSidebar } from './sidebar.js';
export function bind_ui(c) { ctx = c; }
var ctx;

export function init_ui() {
  ctx.hoverGhost = null;
  ctx.flashUntil = 0; // goToMark 闪烁框的保护窗口（syncGhost 在此期间不收 ghost）
  // Lucide 风格内联图标（24 viewBox、stroke currentColor）。注入包保持单文件
  // 自包含，composer/侧栏用的几个图标以 path data 放这里，不引 workbench-icons.js。
  ctx.ANN_ICONS = {
    trash: '<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'arrow-up-right': '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>'
  };
}

export function installUiBindings() {
  var style = document.createElement('style');
  style.textContent = annotateCss();
  document.head.appendChild(style);
  // 注入 UI 里的滚动区（侧栏列表、输入框、线程、提及）用隐藏式浮条；只认 [data-ann-ui]，宿主页面自己的滚动不碰。
  // 工作台与文章站点已经整页装过，这里是空操作。
  installOverlayScrollbars(document, { scope: '[data-ann-ui]' });

  ctx.overlay = document.createElement('div');
  ctx.overlay.id = 'ann-overlay'; ctx.overlay.setAttribute('data-ann-ui', '');
  ctx.marksLayer = document.createElement('div');
  ctx.marksLayer.id = 'ann-marks';
  // 画布模式下 #ann-marks 挂在 #wbstage 的滚动内容里（不在 #ann-overlay 下），isUI / mutation 过滤
  // 都靠这个属性认它，不再借 overlay 的。
  ctx.marksLayer.setAttribute('data-ann-ui', '');
  ctx.bubblesLayer = document.createElement('div');
  ctx.bubblesLayer.id = 'ann-bubbles';
  ctx.bubblesLayer.setAttribute('data-ann-ui', '');
  ctx.hoverLayer = document.createElement('div');
  ctx.hoverLayer.id = 'ann-hover-layer';
  // #ann-chrome 自带 data-ann-ui：workbench 挂法下它不在 overlay 里，命中排除
  //（isUI）与 [data-ann-ui] 的 token / 字体基规则都要靠它自己这一个属性。
  ctx.chromeLayer = document.createElement('div');
  ctx.chromeLayer.id = 'ann-chrome'; ctx.chromeLayer.setAttribute('data-ann-ui', '');
  ctx.overlay.appendChild(ctx.marksLayer);
  ctx.overlay.appendChild(ctx.bubblesLayer);
  ctx.overlay.appendChild(ctx.hoverLayer);
  ctx.overlay.appendChild(ctx.chromeLayer);
  ctx.bubblesLayer.style.display = ctx.renderComments ? '' : 'none';
  mountOverlay();
  document.addEventListener('close', function (event) {
    if (event.target === ctx.overlay.parentElement) { mountOverlay(); renderAll(); }
  }, true);

  ctx.toolbar = document.createElement('div');
  ctx.toolbar.id = 'ann-toolbar'; ctx.toolbar.setAttribute('data-ann-ui', '');
  ctx.toolbar.innerHTML = '<button id="ann-toggle">标注</button><button id="ann-comments" title="在画布渲染评论">评论</button><button id="ann-channel" title="评论布局：压字 / 留通道" hidden>压字</button><button id="ann-list" title="标注列表 (S)">列表</button><button id="ann-workbench" title="在新标签页打开 workbench">打开 workbench</button><button id="ann-clear">清空标记</button><span id="ann-count">0 条</span><span id="ann-status"></span><button id="ann-hide">暂停</button>';
  ctx.toolbar.style.display = 'none';
  document.body.appendChild(ctx.toolbar);
  ctx.btnToggle = ctx.toolbar.querySelector('#ann-toggle');
  ctx.btnComments = ctx.toolbar.querySelector('#ann-comments');
  ctx.btnChannel = ctx.toolbar.querySelector('#ann-channel');
  ctx.btnList = ctx.toolbar.querySelector('#ann-list');
  // 回 workbench 的路（2026-09-04，BACKLOG「空态与错误面板」）：/sites/ 页面与
  // 扩展注入页都是从 workbench 之外进来的，之前只能靠记住 URL 走回去。
  // 服务 origin 取自脚本自己的 src（SERVER），拿不到时回落当前 origin。
  ctx.btnWorkbench = ctx.toolbar.querySelector('#ann-workbench');
  ctx.btnHide = ctx.toolbar.querySelector('#ann-hide');
  ctx.btnClear = ctx.toolbar.querySelector('#ann-clear');
  ctx.elCount = ctx.toolbar.querySelector('#ann-count');
  ctx.elStatus = ctx.toolbar.querySelector('#ann-status');
  ctx.btnToggle.addEventListener('click', toggleMode);
  ctx.btnComments.addEventListener('click', function () { setRenderComments(!ctx.renderComments); });
  if (ctx.btnChannel) ctx.btnChannel.addEventListener('click', function () {
    setBubbleLayout(ctx.bubbleLayout === 'inline' ? 'sidebar' : 'inline');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'a' && e.key !== 'A') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleMode();
  });

  // 快捷键 S：开合标注面板（次要入口，主入口是扩展图标；守卫同 A；看列表是只读行为，标注/交互模式都可用）
  document.addEventListener('keydown', function (e) {
    if (e.key !== 's' && e.key !== 'S') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    toggleSidebar();
  });
  ctx.btnHide.addEventListener('click', function () { setPaused(!ctx.paused); });
  ctx.btnClear.addEventListener('click', doClear);
}

// ---------- UI 骨架 ----------
export function annIcon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ctx.ANN_ICONS[name] + '</svg>';
}
// switchLedgerTo 换账本时挂载点掉出文档，复用这套逻辑重挂。
export function mountOverlay(modal) {
  // 三种挂法。workbench：overlay 与 chrome 都直接挂在 .wb-stage-wrap 里按 --wb-z 阶梯排
  //（钉子在面板 / 横条之下，输入框在横条之上；两者同一父级 inset:0，坐标一致）。
  // 原生 modal：modal 之外的节点都 inert，overlay 连同 chrome 挂进 modal 并进 top layer。
  // 没有舞台（独立文档、汇报页 iframe）：挂 body、贴视口并进 top layer，压住被评审页面
  // 自己的 fixed 弹窗；挂 body 时若不贴视口，absolute + inset:0 只覆盖第一屏，滚下去命中框全被裁掉。
  var stageWrap = document.querySelector('.wb-stage-wrap');
  var inModal = !!(modal && modal.matches('dialog:modal'));
  var host = inModal ? modal : (stageWrap || document.body);
  var topLayer = host !== stageWrap;
  var popoverApi = typeof ctx.overlay.showPopover === 'function';
  if (popoverApi && ctx.overlay.matches(':popover-open')) ctx.overlay.hidePopover();
  ctx.overlay.removeAttribute('popover');
  ctx.overlay.toggleAttribute('data-ann-viewport', topLayer);
  (topLayer ? ctx.overlay : stageWrap).appendChild(ctx.chromeLayer);
  host.appendChild(ctx.overlay);
  if (topLayer && popoverApi) {
    ctx.overlay.setAttribute('popover', 'manual');
    ctx.overlay.showPopover();
  }
  ctx._originCache = null; // 挂载点/模式变了 origin 语义也变，缓存作废
}

export function setStatus(msg, err) {
  ctx.elStatus.textContent = msg; ctx.elStatus.className = err ? 'err' : '';
}

export function syncModeClass() {
  document.documentElement.classList.toggle('ann-mode-on', ctx.mode && !ctx.paused);
}

function ensureHoverGhost() {
  if (!ctx.hoverGhost) {
    ctx.hoverGhost = document.createElement('div');
    ctx.hoverGhost.className = 'ann-hover-ghost';
    ctx.hoverGhost.setAttribute('data-ann-ui', '');
    ctx.hoverGhost.hidden = true;
    ctx.hoverLayer.appendChild(ctx.hoverGhost);
  }
  return ctx.hoverGhost;
}

export function showGhostForEl(el, extraClass) {
  if (!el) { hideGhost(); return; }
  var viewR = visibleViewRectOf(el);
  if (!viewR) { hideGhost(); return; }
  var g = ensureHoverGhost();
  g.className = 'ann-hover-ghost' + (extraClass ? ' ' + extraClass : '');
  placeOverlayRect(g, viewR);
  g.hidden = false;
}

export function hideGhost() {
  if (ctx.hoverGhost) {
    ctx.hoverGhost.hidden = true;
    ctx.hoverGhost.classList.remove('ann-flash');
  }
}

export function showGhostForRect(r, extraClass, clipEl) {
  var viewR = visibleViewRectDoc(r, clipEl || null);
  if (!viewR) { hideGhost(); return; }
  var g = ensureHoverGhost();
  g.className = 'ann-hover-ghost' + (extraClass ? ' ' + extraClass : '');
  placeOverlayRect(g, viewR);
  g.hidden = false;
}
function ghostTarget() {
  if (ctx.pinned) return ctx.pinned;
  return ctx.hoverEl;
}

function syncToolbarUi() {
  ctx.btnToggle.className = ctx.mode ? 'on' : '';
  ctx.btnToggle.textContent = ctx.mode ? '标注' : '交互';
  ctx.btnToggle.title = ctx.mode ? '标注模式 (A → 交互)' : '交互模式 (A → 标注)';
  ctx.btnHide.className = ctx.paused ? 'on' : '';
  ctx.btnComments.className = ctx.renderComments ? 'on' : '';
  ctx.btnComments.textContent = ctx.renderComments ? '评论✓' : '评论';
  ctx.btnComments.title = ctx.renderComments ? '在画布渲染评论（点击关闭）' : '在画布渲染评论';
  if (ctx.btnChannel) {
    ctx.btnChannel.hidden = !ctx.renderComments;
    var layoutLabel = ctx.bubbleLayout === 'sidebar' ? 'sidebar' : 'inline';
    ctx.btnChannel.className = ctx.bubbleLayout === 'sidebar' ? 'on' : '';
    ctx.btnChannel.textContent = layoutLabel;
    ctx.btnChannel.title = '评论布局：' + layoutLabel + '（点击切换 inline ↔ sidebar）';
  }
  if (ctx.btnList) {
    ctx.btnList.className = ctx.sidebarOpen ? 'on' : '';
    ctx.btnList.hidden = sidebarSuppressed();
  }
  // workbench 壳页 / 被嵌入的 frame 上不出这个钮 —— 那里已经在 workbench 里
  if (ctx.btnWorkbench) ctx.btnWorkbench.hidden = sidebarSuppressed();
  syncModeClass();
}

export function syncGhost() {
  if (ctx.navigationActive) { hideGhost(); return; }
  // ann-flash 展示期间（goToMark 跳转）滚动/几何重算不得收掉闪烁框，
  // 否则跳转一闪即逝；显式 hideGhost（暂停、切账本等）不受影响。
  if (Date.now() < ctx.flashUntil) return;
  var el = ghostTarget();
  if (el) showGhostForEl(el);
  else hideGhost();
}

export function notify() {
  syncToolbarUi();
  ctx.updateListeners.forEach(function (fn) {
    try { fn(); } catch (e) { if (console && console.error) console.error('[annotate] listener', e); }
  });
}

export function toggleMode() {
  ctx.mode = !ctx.mode;
  if (!ctx.mode) { clearHover(); closeComposer(); }
  notify();
}

export function setRenderComments(on) {
  on = !!on;
  if (ctx.renderComments === on) return;
  ctx.renderComments = on;
  ctx.bubblesLayer.style.display = on ? '' : 'none';
  if (on) renderAll();
  else { clearBubbles(); }
  notify();
}

/** 评论布局二态切换：inline(iframe overlay) ↔ sidebar(父级 gutter)。
 *  ctx.sidebar 模式下 iframe 内不画气泡（由父级 workbench 在右侧 gutter 渲染）。 */
export function setBubbleLayout(layout) {
  if (layout !== 'inline' && layout !== 'sidebar') layout = 'inline';
  if (ctx.bubbleLayout === layout) return;
  ctx.bubbleLayout = layout;
  if (ctx.renderComments) renderAll();
  notify();
}

// 快捷键 A：切换标注模式（输入框内打字/组字中不触发）

function setPaused(on) {
  on = !!on;
  if (ctx.paused === on) return;
  ctx.paused = on;
  ctx.overlay.style.display = ctx.paused ? 'none' : '';
  if (ctx.paused) { clearHover(); closeComposer(); ctx.drag = null; }
  else { renderAll(); }
  notify();
}

function scopeForScreen(screenId) {
  if (ctx.FRAME) return ctx.FRAME.screenId === screenId || !screenId ? document : null;
  if (!screenId) return document.getElementById('wb-board-panel') || document;
  return document.querySelector('.wb-screen[data-screen="' + CSS.escape(screenId) + '"]');
}

// Missing DOM is conclusive only inside a loaded scope. Hidden elements are
// still present and must never be cleared merely because they cannot paint.
export function canClearInvalid(mark, scopes) {
  function loadedScope(screenId) {
    if (scopes && scopes.has(screenId)) return scopes.get(screenId);
    var scope = scopeForScreen(screenId);
    var loading = '.wb-screen-loading,.wb-screen-err,[data-loading="true"],[aria-busy="true"]';
    var loaded = scope && !(scope.matches && scope.matches(loading)) && !scope.querySelector(loading) ? scope : null;
    if (scopes) scopes.set(screenId, loaded);
    return loaded;
  }
  if (!markOnActivePage(mark) || ctx.ledgerSwitching || document.readyState !== 'complete') return false;
  // R5：done 未 close 与已 close 的不参与清空 —— agent 按标注删掉目标元素（=
  // 干完活）后锚点必失效，一键清掉丢的是 owner 还没验收 / 已留档的执行历史。
  if (mark.status === 'done' || mark.status === 'close') return false;
  // 这屏此刻不归本实例（另一个 tab 上没挂载，或文章画布上的 HTML 卡片：那一页的标注在页面浮层里）。
  if (mark.screenId && screenOffTab(mark.screenId)) return false;
  if (!loadedScope(mark.screenId || '')) return false;
  var sid = mark.screenId || '';
  // 判定与解析同一条优先级（决定 #15）：ppId 还指得到的目标不算失效 ——
  // 否则 cssPath 被结构改动漂掉、ppId 仍锚着的标注会被 clearInvalid 误清。
  var targets = mark.type === 'element'
    ? markElementTargets(mark)
    : [mark.base].concat(mark.contains || []).filter(Boolean);
  if (!targets.length) return false;
  if (targets.some(function (target) { return !!resolveMarkTarget(target, sid); })) return false;
  return true;
}

export function clearInvalid() {
  if (ctx.activeComposer) return false;
  clearAnchorCache();
  var scopes = new Map();
  var invalid = ctx.marks.filter(function (mark) { return canClearInvalid(mark, scopes); });
  if (!invalid.length) return 0;
  var ids = new Set(invalid.map(function (mark) { return mark.id; }));
  ctx.marks = ctx.marks.filter(function (mark) { return !ids.has(mark.id); });
  persist();
  return invalid.length;
}

export function doClear() {
  // 决定 #11：close 是执行历史 —— 清空只带走当前页未关闭的行（open / check /
  // done），已关闭的留在账本里。页内工具条「清空标记」与工作台弹层「清空未
  // 关闭标注」走同一个函数；后者的计数只数未关闭（annSnap.countClosed）。
  var before = ctx.marks.length;
  ctx.marks = ctx.marks.filter(function (k) { return !(markOnActivePage(k) && isClearableMark(k)); });
  if (ctx.marks.length === before) {
    // 只剩已关闭：没东西可清，别谎报成功。
    ctx.btnClear.textContent = '仅剩已关闭';
  } else {
    closeComposer({ silentRender: true, discard: true });
    persist();
    ctx.btnClear.className = 'ok'; ctx.btnClear.textContent = '已清空 ✓';
  }
  setTimeout(function () { ctx.btnClear.className = ''; ctx.btnClear.textContent = '清空标记'; }, 2000);
}

export function removeMark(n) {
  n = parseInt(n, 10);
  if (!isFinite(n)) return false;
  var before = ctx.marks.length;
  ctx.marks = ctx.marks.filter(function (k) { return k.n !== n; });
  if (ctx.marks.length === before) return false;
  var open = document.getElementById('ann-box');
  if (open) closeComposer({ silentRender: true, discard: true });
  persist();
  return true;
}

