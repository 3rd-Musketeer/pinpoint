// 指针交互：悬停高亮、点选元素、框选区域、拖出移动箭头，以及给正在编辑的
// 标注追加目标。导出 bind_gesture、init_gesture、installPointerGestures、
// clearHover、updateDraftGeometry 等。
import { badgePositionInBox, expandRect } from '../../shared/annotate-clip.js';
import { targetContentToDisplay } from '../../shared/annotation-indicator.js';
import { isHidden, markElementTargets, normalizeElementTargets, resolveMarkTarget } from './anchor.js';
import { drawTempArrow, finishArrow } from './arrow.js';
import { newElementMark, newRegionMark } from './create.js';
import { annTarget, annTargetAt, beginOverlayFrame, cssPath, excerpt, hidePartNodes, isUI, overlayBadgeBox, overlayOrigin, placeFixedRect, placeOverlayRect, ppIdOf, screenIdOf, showPartNodes, viewToOverlayRect, visibleViewRectOf } from './dom.js';
import { hideGhost, syncGhost } from './ui.js';
export function bind_gesture(c) { ctx = c; }
var ctx;

export function init_gesture() {
  ctx.lasso = null;
  ctx.hoverSuppress = null; // 拖拽松手后 2s 内、鼠标没走远时不再出 hover 框
  ctx.draftNodes = [];   // active composer targets [{ frame, badge, target, sid }]
}

export function installPointerGestures() {
  document.addEventListener('mousemove', function (e) {
    // 标注框开着也出 hover 框：点下去 = 给这条加目标（元素标注）或开新标注。
    if (!ctx.mode || ctx.paused || ctx.navigationActive || ctx.drag || ctx.arrowFrom) { clearHover(); return; }
    if (ctx.hoverSuppress) {
      if (Date.now() < ctx.hoverSuppress.until && Math.hypot(e.pageX - ctx.hoverSuppress.x, e.pageY - ctx.hoverSuppress.y) < 120) {
        clearHover(); return;
      }
      ctx.hoverSuppress = null;
    }
    var el = annTargetAt(e.clientX, e.clientY, { promoteFrame: !!e.altKey });
    if (!el) { clearHover(); return; }
    if (el !== ctx.hoverEl) { ctx.hoverEl = el; syncGhost(); }
  }, true);
  document.addEventListener('mousedown', function (e) {
    if (!ctx.mode || ctx.paused || e.button !== 0 || isUI(e.target)) return;
    // 点在滚动条区域不拦截，保住原生滚动条拖拽
    if (e.clientX >= document.documentElement.clientWidth || e.clientY >= document.documentElement.clientHeight) return;
    var target = annTargetAt(e.clientX, e.clientY, { promoteFrame: !!e.altKey });
    if (!target) return;
    e.preventDefault(); e.stopPropagation();
    ctx.drag = {
      x0: e.pageX,
      y0: e.pageY,
      moved: false,
      arrow: !!ctx.arrowFrom,
      altKey: !!e.altKey,
      composer: !!(ctx.activeComposer && ctx.activeComposer.m.type === 'element')
    };
  }, true);
  document.addEventListener('mousemove', function (e) {
    if (!ctx.drag) return;
    var dx = e.pageX - ctx.drag.x0, dy = e.pageY - ctx.drag.y0;
    if (!ctx.drag.moved && Math.hypot(dx, dy) > 6) {
      ctx.drag.moved = true;
      if (!ctx.drag.arrow && !ctx.drag.composer) {
        ctx.lasso = document.createElement('div');
        ctx.lasso.id = 'ann-lasso'; ctx.lasso.setAttribute('data-ann-ui', '');
        ctx.chromeLayer.appendChild(ctx.lasso);
      }
    }
    if (ctx.drag.moved && !ctx.drag.arrow && ctx.lasso) {
      var x = Math.min(ctx.drag.x0, e.pageX) - scrollX;
      var y = Math.min(ctx.drag.y0, e.pageY) - scrollY;
      placeOverlayRect(ctx.lasso, [x, y, Math.abs(dx), Math.abs(dy)]);
    }
    if (ctx.drag.arrow) drawTempArrow(ctx.arrowFrom._anchor, [e.pageX, e.pageY]);
  }, true);
  document.addEventListener('mouseup', function (e) {
    if (!ctx.drag) return;
    var d = ctx.drag; ctx.drag = null;
    if (d.arrow) { finishArrow([e.pageX, e.pageY], e); return; }
    if (d.composer) {
      if (!d.moved) {
        var composerTarget = annTargetAt(e.clientX, e.clientY, { promoteFrame: !!(e.altKey || d.altKey) });
        if (composerTarget) addTargetToComposer(composerTarget);
      }
      return;
    }
    if (d.moved) ctx.hoverSuppress = { x: e.pageX, y: e.pageY, until: Date.now() + 2000 };
    if (d.moved && ctx.lasso) {
      var o = overlayOrigin();
      var vx = (parseInt(ctx.lasso.style.left, 10) || 0) + o[0];
      var vy = (parseInt(ctx.lasso.style.top, 10) || 0) + o[1];
      var vw = parseInt(ctx.lasso.style.width, 10) || 0;
      var vh = parseInt(ctx.lasso.style.height, 10) || 0;
      var rect = [vx + scrollX, vy + scrollY, vw, vh];
      if (rect[2] > 10 && rect[3] > 10) {
        // 写标注期间保留框选虚线框，closeComposer 时清掉（openComposer 开头会先关闭旧草稿）
        var keep = ctx.lasso; ctx.lasso = null;
        newRegionMark(rect);
        ctx.lasso = keep;
      } else {
        ctx.lasso.remove(); ctx.lasso = null;
      }
    } else {
      // Re-resolve at mouseup so Alt promote matches the release modifier, not a stale hoverEl.
      var promote = !!(e.altKey || d.altKey);
      var target = annTargetAt(e.clientX, e.clientY, { promoteFrame: promote }) || ctx.hoverEl;
      if (!target) return;
      newElementMark(target);
    }
  }, true);
  document.addEventListener('click', function (e) {
    if (ctx.mode && !ctx.paused && annTarget(e.target, { promoteFrame: !!e.altKey })) {
      e.preventDefault(); e.stopPropagation();
    }
  }, true);
}

// ---------- 悬停高亮（挂在 stage-wrap overlay，不盖侧栏）----------
export function clearHover() {
  ctx.hoverEl = null;
  // ann-flash 展示窗口内不动 ghost：跳转后的鼠标经过不得掐灭闪烁反馈。
  if (!ctx.pinned && Date.now() >= ctx.flashUntil) hideGhost();
}

// ---------- 点选 / 框选 / 箭头 ----------

export function clearDraftNodes() {
  ctx.draftNodes.forEach(function (p) {
    if (p.frame && p.frame.parentNode) p.frame.parentNode.removeChild(p.frame);
    if (p.badge && p.badge.parentNode) p.badge.parentNode.removeChild(p.badge);
  });
  ctx.draftNodes = [];
}

function placePartGeometry(part, el) {
  if (!part || !el) return;
  var viewR = visibleViewRectOf(el);
  if (!viewR) {
    hidePartNodes(part);
    return;
  }
  showPartNodes(part);
  var local = expandRect(viewToOverlayRect(viewR));
  placeFixedRect(part.frame, local);
  if (part.badge) {
    var pos = badgePositionInBox(local, overlayBadgeBox());
    part.badge.style.left = pos.left + 'px';
    part.badge.style.top = pos.top + 'px';
  }
}

export function updateDraftGeometry() {
  if (!ctx.draftNodes.length) return;
  beginOverlayFrame();
  ctx.draftNodes.forEach(function (p) {
    var el = p.target ? resolveMarkTarget(p.target, p.sid) : null;
    if (!el || isHidden(el)) return;
    placePartGeometry(p, el);
  });
}

export function renderComposerDraftVisuals() {
  clearDraftNodes();
  if (!ctx.activeComposer || ctx.activeComposer.m.type !== 'element') return;
  beginOverlayFrame();
  var sid = ctx.activeComposer.m.screenId || '';
  markElementTargets(ctx.activeComposer.m).forEach(function (target) {
    var el = resolveMarkTarget(target, sid);
    if (!el || isHidden(el)) return;
    var frame = document.createElement('div');
    frame.className = 'ann-target ann-draft-target';
    frame.setAttribute('data-ann-ui', '');
    ctx.hoverLayer.appendChild(frame);
    // Editing replaces the persisted target visuals; keep its number on the draft too.
    var badge = document.createElement('div');
    badge.className = 'ann-badge';
    badge.textContent = ctx.activeComposer.m.n;
    badge.style.pointerEvents = 'none';
    ctx.hoverLayer.appendChild(badge);
    var part = { frame: frame, badge: badge, target: target, sid: sid };
    ctx.draftNodes.push(part);
    placePartGeometry(part, el);
  });
}

export function insertComposerIndicator(ref) {
  var composer = ctx.activeComposer;
  if (!composer) return;
  if (composer.composing) {
    if (composer.pendingInlineRefs.indexOf(ref) < 0) composer.pendingInlineRefs.push(ref);
    return;
  }
  var ta = composer.ta;
  var token = targetContentToDisplay('[@t:' + ref + ']', markElementTargets(composer.m)) + ' ';
  var start = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
  var end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : start;
  ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
  var caret = start + token.length;
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function addTargetToComposer(el) {
  if (!ctx.activeComposer || ctx.activeComposer.m.type !== 'element' || !el) return false;
  var sel = cssPath(el);
  var targets = markElementTargets(ctx.activeComposer.m);
  if (targets.some(function (target) { return target.selector === sel; })) return true;
  var ref = 'i' + ctx.activeComposer.nextTargetNumber++;
  var ppId = ppIdOf(el);
  targets.push({ ref: ref, selector: sel, text: excerpt(el), ppId: ppId || undefined, screenId: screenIdOf(el) || undefined });
  ctx.activeComposer.m.targets = targets;
  normalizeElementTargets(ctx.activeComposer.m);
  if (ctx.activeComposer.scheduleAutosave) ctx.activeComposer.scheduleAutosave();
  insertComposerIndicator(ref);
  ctx.activeComposer.renderTargets();
  renderComposerDraftVisuals();
  clearHover();
  return true;
}

// 标注模式下拦截页面自身的点击（防误触链接）
