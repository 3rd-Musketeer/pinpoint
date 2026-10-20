// @mention 选择器：在标注框里输入 @ 时列出可引用的标注，选中后写入 [@a:id]。
// 导出 bind_mention、createMentionPicker。
import { markElementTargets } from './anchor.js';
import { closeMention } from './composer.js';
import { computePosition, offset, shift } from './floating.js';
import { annotationContent, annotationSectionLabel, contentToDisplay, ensureMarkId } from './marks.js';
export function bind_mention(c) { ctx = c; }
var ctx;

// B9：触发规则 —— @ 前是行首或任一「非 ASCII 词字符」。旧规则（行首或空白）
// 是英文语境防 email@host 误触的写法，中文没有词间空格，汉字后接 @ 永远不弹，
// 引用功能对中文语境不可达。放宽后汉字、全角标点、空白都放行；ASCII 字母数字
// 仍拦住 email@host，@ 连 @ 也不触发。query 是 @ 后到光标的连续非空白。
export function mentionContextAt(text, pos) {
  var hit = text.slice(0, pos).match(/(^|[^\w@])@([^\s@]*)$/);
  if (!hit) return null;
  var query = hit[2];
  return { start: pos - query.length - 1, end: pos, query: query };
}

export function createMentionPicker(ta, m) {
var mentionItems = [];
var mentionIndex = 0;
var mentionRange = null; // { start, end }

function mentionCandidates(query) {
  var q = String(query || '').toLowerCase();
  return ctx.marks.filter(function (k) {
    if (k.n === m.n) return false;
    ensureMarkId(k);
    if (!q) return true;
    var hay = String(k.n) + ' ' + contentToDisplay(annotationContent(k), markElementTargets(k)) + ' ' + (k.text || '') + ' ' + annotationSectionLabel(k);
    return hay.toLowerCase().indexOf(q) >= 0;
  }).slice(0, 12);
}

function mentionPreview(k) {
  var body = contentToDisplay(annotationContent(k), markElementTargets(k)).trim();
  if (!body) body = (k.text || '').trim() || (k.type === 'region' ? '框选区域' : '元素');
  return body.slice(0, 80);
}

function closeMentionPicker() {
  closeMention();
  mentionItems = [];
  mentionRange = null;
}

// 贴在输入区左下、间距 4px，两轴向 overlay 收 8px 边距（@floating-ui/dom，
// 2026-10-19 C4；与旧 placeChromeFixed 的 clamp 同语义）。弹层每次渲染重建，
// 只有最新那份还连着文档，isConnected 守卫足够。
function placeMention(pop) {
  computePosition(ta, pop, {
    placement: 'bottom-start',
    middleware: [offset(4), shift({ boundary: ctx.overlay, padding: 8, crossAxis: true })]
  }).then(function (result) {
    if (!pop.isConnected) return;
    pop.style.left = result.x + 'px';
    pop.style.top = result.y + 'px';
  });
}

function renderMentionPicker() {
  closeMention();
  if (!mentionItems.length) {
    var empty = document.createElement('div');
    empty.id = 'ann-mention';
    empty.setAttribute('data-ann-ui', '');
    empty.innerHTML = '<div class="ann-men-empty">没有可引用的标注</div>';
    ctx.chromeLayer.appendChild(empty);
    placeMention(empty);
    return;
  }
  var pop = document.createElement('div');
  pop.id = 'ann-mention';
  pop.setAttribute('data-ann-ui', '');
  pop.innerHTML = mentionItems.map(function (k, i) {
    return '<button type="button" class="ann-men-item' + (i === mentionIndex ? ' on' : '') + '" data-men-i="' + i + '">' +
      '<span class="ann-men-n">@' + k.n + '</span>' +
      '<span class="ann-men-body"></span></button>';
  }).join('');
  ctx.chromeLayer.appendChild(pop);
  var bodies = pop.querySelectorAll('.ann-men-body');
  for (var bi = 0; bi < bodies.length; bi++) {
    bodies[bi].textContent = mentionPreview(mentionItems[bi]);
  }
  pop.addEventListener('mousedown', function (e) {
    var btn = e.target.closest('[data-men-i]');
    if (!btn) return;
    e.preventDefault();
    mentionIndex = parseInt(btn.getAttribute('data-men-i'), 10) || 0;
    pickMention();
  });
  placeMention(pop);
  var on = pop.querySelector('.ann-men-item.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
}

function getMentionContext() {
  return mentionContextAt(ta.value, ta.selectionStart);
}

function syncMentionFromCaret() {
  var ctx = getMentionContext();
  if (!ctx) {
    closeMentionPicker();
    return;
  }
  mentionRange = { start: ctx.start, end: ctx.end };
  mentionItems = mentionCandidates(ctx.query);
  if (mentionIndex >= mentionItems.length) mentionIndex = Math.max(0, mentionItems.length - 1);
  renderMentionPicker();
}

function pickMention() {
  if (!mentionRange || !mentionItems.length) {
    closeMentionPicker();
    return;
  }
  var hit = mentionItems[mentionIndex];
  if (!hit) return;
  ensureMarkId(hit);
  var insert = '@' + hit.n;
  var before = ta.value.slice(0, mentionRange.start);
  var after = ta.value.slice(mentionRange.end);
  var needsSpace = after.length === 0 || !/^\s/.test(after);
  ta.value = before + insert + (needsSpace ? ' ' : '') + after;
  var caret = before.length + insert.length + (needsSpace ? 1 : 0);
  ta.setSelectionRange(caret, caret);
  closeMentionPicker();
  ta.focus();
}

function mentionMove(delta) {
  if (!mentionItems.length) return;
  mentionIndex = (mentionIndex + delta + mentionItems.length) % mentionItems.length;
  renderMentionPicker();
}
return { sync: syncMentionFromCaret, pick: pickMention, move: mentionMove, close: closeMentionPicker };
}

// 参考截图：粘贴或选文件，立即上传到本机服务；返回的数组就是框里的图片列表（原地增删，调用方直接读 length / 存进 m.images）。
