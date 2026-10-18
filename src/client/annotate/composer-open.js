// 打开标注框：把一行标注装进 composer，接上 mention、贴图与自动保存，
// 并摆到锚点旁边。导出 bind_composer_open、openComposer。
import { normalizeAnnotation, targetContentToDisplay, nextTargetRef } from '../../shared/annotation-indicator.js';
import { isMarkBroken, markElementTargets, normalizeElementTargets, resolveMarkAnchor } from './anchor.js';
import { removeTempArrow } from './arrow.js';
import { attachComposerAutosave, attachComposerImages } from './composer-images.js';
import { closeComposer, composerBoxHtml, placeComposerBox, richAnnotationInput, showTip, watchComposerChrome, wireComposerDrag } from './composer.js';
import { resolve } from './dom.js';
import { insertComposerIndicator, renderComposerDraftVisuals } from './gesture.js';
import { annotationContent, contentToDisplay, ensureMarkId } from './marks.js';
import { createMentionPicker } from './mention.js';
import { closeAnnotation } from './sidebar.js';
import { mountOverlay, removeMark, setStatus, showGhostForEl, showGhostForRect } from './ui.js';
export function bind_composer_open(c) { ctx = c; }
var ctx;

export function openComposer(m, anchorRect, isNew) {
  // 进来时还开着的框只有画箭头回弹这一种：它的状态已随 m（_draft / move）带进来。
  closeComposer({ silentRender: true, discard: true });
  m = normalizeAnnotation(JSON.parse(JSON.stringify(m)));
  ensureMarkId(m);
  var selectedAnchor = resolveMarkAnchor(m);
  var broken = !selectedAnchor.live;
  var modal = selectedAnchor.el && selectedAnchor.el.closest('dialog:modal');
  if (modal && ctx.overlay.parentElement !== modal) mountOverlay(modal);
  else if (!modal && ctx.overlay.parentElement.matches('dialog')) mountOverlay();
  var box = document.createElement('div');
  box.id = 'ann-box'; box.setAttribute('data-ann-ui', '');
  // 框内可编辑的草稿状态：改文案开关、研究对象（只透传）、参考截图列表。自动保存与关框存盘都读它。
  var draft = { changeOn: !!m.changeTo, research: m.research || null, images: null };
  box.innerHTML = composerBoxHtml(m, broken, isNew);
  ctx.chromeLayer.appendChild(box);
  // top layer 挂法：重开一次让 overlay 回到 top layer 栈顶，压过页面后开的 popover
  if (ctx.overlay.matches(':popover-open')) { ctx.overlay.hidePopover(); ctx.overlay.showPopover(); }
  var ta = richAnnotationInput(box.querySelector('#ann-input'), m);
  var initialText = m._draft != null ? m._draft : contentToDisplay(annotationContent(m), markElementTargets(m));
  var missingRefs = markElementTargets(m).filter(function (target) { return initialText.indexOf(targetContentToDisplay('[@t:' + target.ref + ']', [target])) < 0; });
  ta.value = missingRefs.map(function (target) { return targetContentToDisplay('[@t:' + target.ref + ']', [target]) + ' '; }).join('') + initialText;
  ta.setSelectionRange(ta.value.length, ta.value.length);

  normalizeElementTargets(m);
  var stageEl = document.getElementById('wbstage');
  var composer = {
    ta: ta,
    box: box,
    m: m,
    isNew: !!isNew,
    // 已落账本的行号；新建的在第一次自动保存后才有。getter：服务端认领可能改写 m.n。
    get persistedN() { return this.isNew ? null : m.n; },
    nextTargetNumber: parseInt(nextTargetRef(markElementTargets(m)).slice(1), 10),
    composing: false,
    pendingInlineRefs: [],
    stage: stageEl,
    previousScrollPadding: stageEl ? stageEl.style.scrollPaddingBottom : '',
    resizeObserver: null,
    dockObserver: null,
    renderTargets: function () {}
  };
  ctx.activeComposer = composer;
  composer.save = save; // 切账本收尾用：把打开中的草稿存回旧账本
  var composerMaxWidth = parseFloat(getComputedStyle(box).maxWidth) || box.offsetWidth;

  // Use the selected DOM geometry, including every visible selected target.
  // When none of the adjacent positions fits, dock without moving the canvas.
  function syncComposerLayout() { placeComposerBox(composer, box, composerMaxWidth); }
  composer.syncLayout = syncComposerLayout;

  // 拖动：按住框的空白处（内边距、按钮之间）移动；正文输入区和按钮保持原有行为。
  wireComposerDrag(box, composer, syncComposerLayout);

  composer.renderTargets = function () { syncComposerLayout(); };
  function syncTargetReferences() {
    var refs = Array.from(ta.querySelectorAll('[data-target-ref]')).map(function (node) { return node.dataset.targetRef; });
    var targets = markElementTargets(m);
    if (!refs.length && targets.length) {
      // A mark always needs one anchor; make the retained anchor visible.
      ta.value = targetContentToDisplay('[@t:' + targets[0].ref + ']', targets) + ' ' + ta.value;
      ta.setSelectionRange(ta.value.length, ta.value.length);
      refs = [targets[0].ref];
    }
    m.targets = targets.filter(function (target) { return refs.indexOf(target.ref) >= 0; });
    normalizeElementTargets(m);
    renderComposerDraftVisuals();
  }
  renderComposerDraftVisuals();

  ta.addEventListener('compositionstart', function () { composer.composing = true; });
  ta.addEventListener('compositionend', function () {
    composer.composing = false;
    var refs = composer.pendingInlineRefs.slice();
    composer.pendingInlineRefs = [];
    refs.forEach(insertComposerIndicator);
    syncTargetReferences();
    syncComposerLayout();
  });
  watchComposerChrome(composer, box, syncComposerLayout);
  syncComposerLayout();
  ta.focus({ preventScroll: true });

  var mention = createMentionPicker(ta, m);

  draft.images = attachComposerImages(box, ta, m);
  var plus = box.querySelector('#ann-plus');
  var toolsMenu = box.querySelector('#ann-tools-menu');
  function closeTools() { toolsMenu.hidden = true; plus.setAttribute('aria-expanded', 'false'); }
  plus.addEventListener('click', function () { toolsMenu.hidden = !toolsMenu.hidden; plus.setAttribute('aria-expanded', String(!toolsMenu.hidden)); });
  box.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !toolsMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeTools(); plus.focus(); } });
  function renderModes() {
    var wrap = box.querySelector('#ann-mode-pills'); wrap.replaceChildren();
    [['change', '改文案', draft.changeOn], ['move', '移动', !!m.move]].forEach(function (item) {
      if (!item[2]) return;
      var pill = document.createElement('button'); pill.type = 'button'; pill.className = 'ann-mode-pill';
      pill.textContent = item[1]; pill.setAttribute('aria-label', '取消' + item[1]);
      var cross = document.createElement('span'); cross.textContent = '×'; pill.appendChild(cross);
      pill.addEventListener('click', function () { if (item[0] === 'change') draft.changeOn = false; else { delete m.move; removeTempArrow(); } renderModes(); });
      wrap.appendChild(pill);
    });
  }
  box.querySelector('#ann-change').addEventListener('click', function () {
    draft.changeOn = true; closeTools(); renderModes(); ta.focus({ preventScroll: true });
  });
  renderModes();

  attachComposerAutosave(composer, ta, m, draft);
  // Enter = 写完这一条：存并关框。
  function save() { closeComposer(); }
  ta.addEventListener('input', function () {
    if (!composer.composing) syncTargetReferences();
    syncComposerLayout();
    mention.sync();
    composer.scheduleAutosave();
    // 输入当下就是「尚未保存」，不等去抖结束。组字中途不逐字报。
    if (!composer.composing && composer.noteSaveState) composer.noteSaveState();
  });
  ta.addEventListener('keydown', function (e) {
    if (composer.composing || e.isComposing || e.keyCode === 229) return; // 输入法组字中：回车/ESC 都交给输入法
    // macOS Chromium 的滚动边界会消费未加修饰键的 Home / End，光标仍停在原处。
    // 直接按浏览器的行边界移动选区；保留 Shift 选择与平台修饰键的原生行为。
    if ((e.key === 'Home' || e.key === 'End') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var selection = window.getSelection();
      if (selection && typeof selection.modify === 'function') {
        e.preventDefault();
        selection.modify('move', e.key === 'Home' ? 'backward' : 'forward', 'lineboundary');
        return;
      }
    }
    var mentionOpen = !!document.getElementById('ann-mention');
    if (mentionOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); mention.move(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); mention.move(-1); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mention.pick(); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        mention.close();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    // Escape (no mention): document listener closes box
  });
  box.querySelector('#ann-close').addEventListener('click', function () { closeComposer(); });
  var del = box.querySelector('#ann-del');
  if (del) del.addEventListener('click', function () {
    removeMark(m.n);
  });
  // 完成 = owner 确认（→ close），与列表行的完成勾同一条路；框里有没保存的修改先存。
  var closeMarkBtn = box.querySelector('#ann-close-mark');
  if (closeMarkBtn) closeMarkBtn.addEventListener('click', function () { closeAnnotation(m.n); });
  box.querySelector('#ann-move').addEventListener('click', function () {
    if (isMarkBroken(m) || !anchorRect) {
      setStatus('锚点失效，无法画箭头', true);
      return;
    }
    mention.close();
    m._draft = ta.value; // 暂存已输入文字（展示态 @n）
    if (draft.changeOn) m.changeTo = true; else delete m.changeTo;
    if (draft.images.length) m.images = draft.images; else delete m.images;
    m._anchor = [anchorRect[0] + anchorRect[2] / 2, anchorRect[1] + anchorRect[3] / 2];
    ctx.arrowFrom = m;
    box.remove(); // 隐藏标注框，拖完箭头再弹回
    showTip('从被标处拖一根箭头到目标位置', anchorRect);
  });

  if (anchorRect) {
    // goToMark 闪烁窗口内：保留 ann-flash，不让常驻高亮同步覆盖掉闪烁动画；
    // 闪烁到期由 endFlash 收编为常驻高亮。
    var flashCls = Date.now() < ctx.flashUntil ? 'ann-flash' : null;
    if (m.type === 'region') {
      var regionEl = resolveMarkAnchor(m).el;
      showGhostForRect(anchorRect, flashCls, regionEl);
    } else {
      var markEl = resolve(m.selector);
      if (markEl) showGhostForEl(markEl, flashCls);
    }
  }
  // 自动保存的基线：设置全部完成后取。画箭头回弹（带 _draft）的框本身就是
  // 未存的修改，不取基线，关框时照常存。
  if (m._draft == null) composer.takeSnapshot();
}
