// 标注框骨架：定位、拖动、跟随 chrome 让位、关闭时提交或丢弃，以及提示条。
// 导出 bind_composer、init_composer、closeComposer、annotationTargetRects、
// placeComposerBox、removeTip 等。
import { escHtml } from '../../shared/esc-html.js';
import { isClosed } from '../../shared/ann-status.js';
import { annRowReplies } from '../../shared/ann-row.js';
import { markElementTargets, resolveAllLiveTargets, resolveMarkAnchor } from './anchor.js';
import { removeTempArrow } from './arrow.js';
import { renderAll } from './bubbles.js';
import { beginOverlayFrame, docToView, overlayOrigin } from './dom.js';
import { clearDraftNodes } from './gesture.js';
import { computePosition, offset, shift, virtualRect } from './floating.js';
import { annIcon, hideGhost } from './ui.js';
export function bind_composer(c) { ctx = c; }
var ctx;

export function init_composer() {
  ctx.tipEl = null;
  ctx.pinned = null; // 标注期间保持高亮的被点元素
}

// ---------- 标注框 ----------

export function placeChromeFixed(el, left, top, width, height) {
  var pad = 8;
  var w = width != null ? width : (el.offsetWidth || 320);
  var h = height != null ? height : (el.offsetHeight || 200);
  var bounds = ctx.overlay.getBoundingClientRect();
  var maxL = Math.max(pad, bounds.width - w - pad);
  var maxT = Math.max(pad, bounds.height - h - pad);
  var o = overlayOrigin();
  var localL = left - o[0];
  var localT = top - o[1];
  el.style.left = Math.max(pad, Math.min(localL, maxL)) + 'px';
  el.style.top = Math.max(pad, Math.min(localT, maxT)) + 'px';
}

export function showTip(text, anchorRect) {
  removeTip();
  ctx.tipEl = document.createElement('div');
  ctx.tipEl.id = 'ann-tip';
  ctx.tipEl.setAttribute('data-ann-ui', '');
  ctx.tipEl.textContent = text;
  ctx.chromeLayer.appendChild(ctx.tipEl);
  var vr = docToView(anchorRect);
  placeChromeFixed(ctx.tipEl, vr[0], vr[1] - 36);
}
export function removeTip() { if (ctx.tipEl) { ctx.tipEl.remove(); ctx.tipEl = null; } }

export function closeMention() {
  var el = document.getElementById('ann-mention');
  if (el) el.remove();
}

/** 关标注框。没有「取消」：框里的修改默认先存（commit），只有删除 / 清空
    这类「行已经不该存在」的路径传 discard。 */
export function closeComposer(opts) {
  opts = opts || {};
  closeMention();
  if (ctx.activeComposer) {
    if (ctx.activeComposer.cancelAutosave) ctx.activeComposer.cancelAutosave();
    if (!opts.discard && ctx.activeComposer.commit) ctx.activeComposer.commit();
  }
  if (ctx.activeComposer) {
    if (ctx.activeComposer.dropSaveState) ctx.activeComposer.dropSaveState();
    if (ctx.activeComposer.resizeObserver) ctx.activeComposer.resizeObserver.disconnect();
    if (ctx.activeComposer.dockObserver) ctx.activeComposer.dockObserver.disconnect();
    if (ctx.activeComposer.stage) ctx.activeComposer.stage.style.scrollPaddingBottom = ctx.activeComposer.previousScrollPadding || '';
  }
  ctx.activeComposer = null;
  var b = document.getElementById('ann-box'); if (b) b.remove();
  removeTempArrow(); removeTip(); ctx.arrowFrom = null;
  if (ctx.pinned) { ctx.pinned = null; hideGhost(); }
  if (ctx.lasso) { ctx.lasso.remove(); ctx.lasso = null; }
  clearDraftNodes();
  ctx.hoverSuppress = null; // 标注框一关，悬停高亮立即恢复
  ctx.structureDirty = true;
  if (!opts.silentRender) requestAnimationFrame(renderAll);
}

// DOM-backed input keeps the persisted text-token format; pills are atomic
// editing nodes, never selectors reconstructed from their display labels.
export function richAnnotationInput(el, mark) {
  var savedSelection = [0, 0];
  function text(node) {
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1 && node.nodeType !== 11) return '';
    if (node.dataset && node.dataset.token) return node.dataset.token;
    if (node.nodeName === 'BR') return '\n';
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (child, i) {
      if (i && /^(DIV|P)$/.test(child.nodeName) && !out.endsWith('\n')) out += '\n';
      out += text(child);
    });
    return out;
  }
  function offsets() {
    var selection = window.getSelection();
    if (!selection || !selection.rangeCount || !el.contains(selection.anchorNode) || !el.contains(selection.focusNode)) return savedSelection;
    var range = selection.getRangeAt(0);
    var prefix = range.cloneRange(); prefix.selectNodeContents(el); prefix.setEnd(range.startContainer, range.startOffset);
    var suffix = range.cloneRange(); suffix.selectNodeContents(el); suffix.setEnd(range.endContainer, range.endOffset);
    savedSelection = [text(prefix.cloneContents()).length, text(suffix.cloneContents()).length];
    return savedSelection;
  }
  function render(value) {
    el.replaceChildren();
    var regex = /\[indicator ([1-9][0-9]*)\]/g, offset = 0, hit;
    while ((hit = regex.exec(value))) {
      el.appendChild(document.createTextNode(value.slice(offset, hit.index)));
      var ref = 'i' + hit[1];
      var target = markElementTargets(mark).find(function (t) { return t.ref === ref; });
      if (!target) el.appendChild(document.createTextNode(hit[0]));
      else {
        var pill = document.createElement('span');
        pill.className = 'ann-inline-target'; pill.contentEditable = 'false';
        pill.dataset.token = hit[0]; pill.dataset.targetRef = ref;
        pill.title = target.text || '元素';
        var label = document.createElement('span'); label.textContent = target.text || '元素';
        var remove = document.createElement('button'); remove.type = 'button';
        remove.className = 'ann-inline-remove'; remove.textContent = '×'; remove.setAttribute('aria-label', '移除目标 ' + hit[1]);
        pill.appendChild(label); pill.appendChild(remove); el.appendChild(pill);
      }
      offset = regex.lastIndex;
    }
    el.appendChild(document.createTextNode(value.slice(offset)));
  }
  function setSelection(start, end) {
    function point(position) {
      var remaining = position, answer;
      function walk(node) {
        if (answer) return;
        if (node.nodeType === 3) {
          if (remaining <= node.length) answer = [node, remaining]; else remaining -= node.length;
        } else if (node.dataset && node.dataset.token) {
          var index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
          if (remaining <= node.dataset.token.length) answer = [node.parentNode, index + (remaining ? 1 : 0)];
          else remaining -= node.dataset.token.length;
        } else Array.prototype.forEach.call(node.childNodes, walk);
      }
      walk(el); return answer || [el, el.childNodes.length];
    }
    var a = point(start), b = point(end), range = document.createRange();
    range.setStart(a[0], a[1]); range.setEnd(b[0], b[1]);
    var selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    savedSelection = [start, end];
  }
  Object.defineProperties(el, {
    value: { get: function () { return text(el); }, set: function (value) { render(String(value)); } },
    selectionStart: { get: function () { return offsets()[0]; } },
    selectionEnd: { get: function () { return offsets()[1]; } }
  });
  el.setSelectionRange = setSelection;
  el.addEventListener('keyup', offsets); el.addEventListener('mouseup', offsets); el.addEventListener('blur', offsets);
  el.addEventListener('mousedown', function (event) { if (event.target.closest('.ann-inline-remove')) event.preventDefault(); });
  el.addEventListener('click', function (event) {
    var remove = event.target.closest('.ann-inline-remove'); if (!remove) return;
    remove.closest('.ann-inline-target').remove(); el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  el.addEventListener('paste', function (event) {
    if (!event.clipboardData || Array.prototype.some.call(event.clipboardData.items, function (item) { return item.type.indexOf('image/') === 0; })) return;
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
  });
  return el;
}

export function annotationTargetRects(m) {
  var rects = m.type === 'element' ? resolveAllLiveTargets(m).map(function (target) {
    return target.el.getBoundingClientRect();
  }) : [];
  if (m.type === 'region') {
    var anchor = resolveMarkAnchor(m);
    if (anchor.live && anchor.rectDoc) {
      var r = docToView(anchor.rectDoc);
      rects.push({left:r[0],top:r[1],right:r[0]+r[2],bottom:r[1]+r[3]});
    }
  }
  return rects;
}

// 输入框的静态骨架：只依赖行本身、锚点是否失效、是否新建，不碰任何状态。
/** 线程回复（agent 经 ppnt reply / mark --note 写的）：编辑框下面逐条，只读。 */
function composerThreadHtml(replies) {
  if (!replies.length) return '';
  return '<div id="ann-thread">' + replies.map(function (r) {
    return '<div class="ann-reply" data-who="' + escHtml(r.who) + '"><span class="who">' + escHtml(r.who) + '</span>'
      + '<span class="text">' + escHtml(r.text) + '</span></div>';
  }).join('') + '</div>';
}

export function composerBoxHtml(m, broken, isNew) {
  var brokenInfo = broken
    ? '<div class="t" style="color:var(--wb-danger,#c0392b);margin-bottom:8px">锚点失效 · 目标节点已不在当前稿中</div>'
    : '';
  return '<button type="button" id="ann-close" aria-label="关闭标注" title="关闭，修改会自动保存">' + annIcon('x') + '</button>' +
    brokenInfo +
    '<div id="ann-imgs"></div>' +
    '<div id="ann-input" contenteditable="true" role="textbox" aria-label="写标注" aria-multiline="true" data-placeholder="写标注…"></div>' +
    composerThreadHtml(isNew ? [] : annRowReplies(m)) +
    '<div class="acts"><div class="ann-tools">' +
    '<button type="button" id="ann-plus" aria-label="标注操作" aria-expanded="false">+</button>' +
    '<div id="ann-mode-pills"></div>' +
    '<div id="ann-tools-menu" hidden>' +
    '<button type="button" id="ann-change">' + annIcon('pencil') + '<span>改文案</span></button>' +
    '<button type="button" id="ann-move"' + (broken ? ' disabled' : '') + '>' + annIcon('arrow-up-right') + '<span>移动</span></button></div></div>' +
    '<div class="ann-submit-actions">' +
    '<span id="ann-save-state" aria-live="polite"></span>' +
    (isNew ? '' : '<button type="button" id="ann-del" aria-label="删除标注" title="删除标注">' + annIcon('trash') + '</button>') +
    (isNew || isClosed(m) ? '' : '<button type="button" id="ann-close-mark" aria-label="完成标注" title="完成（close）">' + annIcon('check') + '</button>') +
    '</div></div>';
}

// Use the selected DOM geometry, including every visible selected target.
// When none of the adjacent positions fits, dock without moving the canvas.
// 候选位枚举与求交交给 @floating-ui/dom（2026-10-19 C4）：侧序（右→左→下→上，
// preferredSide=below 时下面先）、12px 气口与贴边、目标并集矩形参照、chrome
// 避让判定、dock 兜底与用户拖动位都保持原语义。视口预筛不能删：参照完全在
// 视口外时 flip/shift 的输出不可用（实验踩过）。computePosition 是 async
// （微任务里落地，写样式仍在同帧）；等待期间被更新的布局（再输入、拖动、关框）
// 经 placeSeq / userPos / activeComposer 守卫挡掉。
export function placeComposerBox(composer, box, maxWidth) {
  if (ctx.activeComposer !== composer || !box.isConnected) return;
  var seq = composer.placeSeq = (composer.placeSeq || 0) + 1;
  beginOverlayFrame();
  var bounds = ctx.overlay.getBoundingClientRect();
  var pad = 12, gap = 12;
  var width = Math.min(maxWidth, Math.max(0, bounds.width - pad * 2));
  box.style.width = width + 'px';
  box.style.maxHeight = Math.max(80, bounds.height - pad * 2) + 'px';
  var height = box.offsetHeight;
  function writePos(position, placement) {
    box.dataset.placement = placement;
    box.style.left = position[0] + 'px';
    box.style.top = position[1] + 'px';
    box.style.right = 'auto'; box.style.bottom = 'auto'; box.style.margin = '0';
  }
  function dockPos() {
    var strip = document.getElementById('wbstrip');
    var bottomSpace = strip && strip.getClientRects().length ? Math.max(pad, bounds.bottom - strip.getBoundingClientRect().top + gap) : pad;
    return [(bounds.width - width) / 2, Math.max(pad, bounds.height - height - bottomSpace)];
  }
  if (composer.userPos) {
    // 用户拖过：位置固定在视口里，只夹回可视范围，不再跟着目标自动让位。
    writePos([
      Math.max(pad, Math.min(composer.userPos[0], bounds.width - width - pad)),
      Math.max(pad, Math.min(composer.userPos[1], bounds.height - height - pad))
    ], 'user');
    return;
  }
  var rects = annotationTargetRects(composer.m);
  rects = rects.filter(function (r) { return r.right > bounds.left && r.left < bounds.right && r.bottom > bounds.top && r.top < bounds.bottom; });
  if (!rects.length) { writePos(dockPos(), 'dock'); return; }
  var left = Math.min.apply(null, rects.map(function (r) { return r.left; }));
  var right = Math.max.apply(null, rects.map(function (r) { return r.right; }));
  var top = Math.min.apply(null, rects.map(function (r) { return r.top; }));
  var bottom = Math.max.apply(null, rects.map(function (r) { return r.bottom; }));
  var placements = ['right-start', 'left-start', 'bottom-start', 'top-start'];
  if (composer.preferredSide === 'below') placements.unshift(placements.splice(2, 1)[0]);
  var chrome = Array.from(document.querySelectorAll('#wbside, #wbstrip, #wbdock > *, #wbcanvas-dock > *, #ann-sidebar')).filter(function (el) { return el && el.getClientRects().length; }).map(function (el) { return el.getBoundingClientRect(); });
  function stale() {
    return composer.placeSeq !== seq || ctx.activeComposer !== composer || !box.isConnected || !!composer.userPos;
  }
  (async function () {
    for (var i = 0; i < placements.length && !stale(); i++) {
      // computePosition 给出的 x/y 相对 offsetParent（#ann-chrome），与
      // overlay 同原点（两种挂法下都是 inset:0 同盒），即旧的 overlay-local 坐标。
      var result = await computePosition(virtualRect([left, top, right - left, bottom - top]), box, {
        placement: placements[i],
        middleware: [offset(gap), shift({ boundary: ctx.overlay, padding: pad })]
      });
      if (result.x < pad || result.y < pad || result.x + width > bounds.width - pad || result.y + height > bounds.height - pad) continue;
      if (chrome.some(function (r) { return result.x + bounds.left < r.right && result.x + width + bounds.left > r.left && result.y + bounds.top < r.bottom && result.y + height + bounds.top > r.top; })) continue;
      if (!stale()) writePos([result.x, result.y], 'anchor');
      return;
    }
    if (!stale()) writePos(dockPos(), 'dock');
  })();
}

// 拖动：按住框的空白处（内边距、按钮之间）移动；正文输入区和按钮保持原有行为。
export function wireComposerDrag(box, composer, relayout) {
  box.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.target.closest('#ann-input, button, a, input, textarea, select, [contenteditable]')) return;
    var startX = e.clientX, startY = e.clientY;
    var startLeft = parseFloat(box.style.left) || 0, startTop = parseFloat(box.style.top) || 0;
    var pid = e.pointerId, dragging = false;
    // 位移超过 4px 才算拖动：单击不被吞，框内自带点击的小控件（图片删除叉等）照常响应。
    function move(ev) {
      if (ev.pointerId !== pid) return;
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 4) return;
        dragging = true;
        box.classList.add('ann-dragging');
      }
      composer.userPos = [startLeft + ev.clientX - startX, startTop + ev.clientY - startY];
      relayout();
    }
    function end(ev) {
      if (ev.pointerId !== pid) return;
      box.classList.remove('ann-dragging');
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
    }
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
  });
}

// 输入框要盯的让位来源：自身与 overlay 的尺寸、画布 dock / 浮层槽的开合、左栏折叠与拖宽。
export function watchComposerChrome(composer, box, relayout) {
  if (typeof ResizeObserver !== 'undefined') {
    composer.resizeObserver = new ResizeObserver(relayout);
    composer.resizeObserver.observe(box);
    composer.resizeObserver.observe(ctx.overlay);
  }
  // 让位的三个来源都要盯：画布 dock 的开合、右下浮层槽的换住客、左栏的
  // 折叠与拖宽（宽度变化 ResizeObserver 才看得见，属性观察看不见）。
  // 浮层槽里 React 每次提交（hover 态、行高亮）都会触发观察；一帧内合并成一次量测。
  var dockSyncRaf = 0;
  function relayoutSoon() {
    if (dockSyncRaf) return;
    dockSyncRaf = requestAnimationFrame(function () { dockSyncRaf = 0; relayout(); });
  }
  if (typeof MutationObserver !== 'undefined') {
    composer.dockObserver = new MutationObserver(relayoutSoon);
    ['wbcanvas-dock', 'wbdock'].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) {
        composer.dockObserver.observe(node, {
          childList: true, subtree: true, attributes: true,
          attributeFilter: ['hidden', 'class', 'style']
        });
      }
    });
  }
  if (composer.resizeObserver) {
    var sideEl = document.getElementById('wbside');
    if (sideEl) composer.resizeObserver.observe(sideEl);
  }
}

// 输入框里的 @ 引用选择器（展示 @n → 盘上 [@a:id]）。状态（候选、当前项、触发区间）都在闭包里。
