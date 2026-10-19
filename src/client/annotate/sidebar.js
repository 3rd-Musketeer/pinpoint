// 标注面板（#ann-sidebar）：按状态筛选列出当前账本，关闭 / 重新打开一行，
// 以及操作提示 toast。导出 bind_sidebar、init_sidebar、installSidebar、
// toggleSidebar、closeAnnotation、setStatusFilter 等。
import { ANN_FILTERS, annFilterCounts, annFilterRows, annStatusLabel, annStatusOf, filterIncludesStatus, isClosed, writeAnnFilter } from '../../shared/ann-status.js';
import { readingBodyHtml } from '../../shared/annotate-bubble.js';
import { readingSegments } from '../../shared/annotation-indicator.js';
import { annRowModel, annRowPreview } from '../../shared/ann-row.js';
import { isMarkBroken, markElementTargets } from './anchor.js';
import { renderAll } from './bubbles.js';
import { closeComposer } from './composer.js';
import { annotationContent, contentToDisplay, statusFilterKey } from './marks.js';
import { goToMark, marksForActivePage } from './nav.js';
import { persist } from './persist.js';
import { annIcon, notify, toggleMode } from './ui.js';
export function bind_sidebar(c) { ctx = c; }
var ctx;

export function init_sidebar() {
  ctx.AUTOSAVE_MS = 600; // 标注框输入停下多久自动存一次
  ctx.SIDEBAR_LS_KEY = 'pinpoint:' + (ctx.CANVAS_MODE ? 'workbench' : ctx.ENTRY) + ':sidebar-open';
  ctx.sidebar = null;
  ctx.sidebarBody = null;
  ctx.sidebarCount = null;
  ctx.sidebarFilters = null;
  ctx.sidebarSegInteract = null;
  ctx.sidebarSegAnnotate = null;
  ctx.sidebarSig = '';
  ctx.toastEl = null;
  ctx.toastTimer = 0;
}

export function installSidebar() {
  if (ctx.btnList) ctx.btnList.addEventListener('click', function () { toggleSidebar(); });
  if (ctx.btnWorkbench) ctx.btnWorkbench.addEventListener('click', function () {
    window.open((ctx.SERVER || location.origin) + '/workbench/', '_blank', 'noopener');
  });
  ctx.updateListeners.push(renderSidebar);
  (function () {
    var want = false;
    try { want = localStorage.getItem(ctx.SIDEBAR_LS_KEY) === '1'; } catch (e) { /* */ }
    if (want) setSidebarOpen(true);
  })();
}

// ---------- 标注面板（#ann-sidebar）----------
// 没有 workbench 的页面（/sites/ 注入）的标注控制面：顶部
// 「交互 | 标注」segmented 切 mode，下面当前账本按 n 列出，点击跳转
// （goToMark），行尾动作与工作台弹层同款（完成勾 / close 行「重新打开」）。
// 入口 = 工具条「列表」按钮、S 键。
// 抑制规则与浮动工具条同款「单一控制面」：workbench 壳有自己的标注列表；
// doc iframe 由父级出控制面。（浏览器扩展的 pinpoint:command 桥已于 pp2
// 切片 3 随扩展一并退役。）
// 画布实例的 key 不跟活动页换（面板开合是 workbench 级浏览偏好；账本缓存
// key LS_KEY 才跟页桶走）。

export function sidebarSuppressed() {
  if (window.workbench) return true;                       // workbench 壳：列表在左栏
  if (window.top !== window.self) return true;             // 被嵌入（workbench doc iframe 等）
  return false;
}

function sidebarRowModel() {
  // 行字段走共享模型（src/shared/ann-row.js，serve 时内联）；默认 cap 语义即
  // client 现状：框选显示「框选区域」，无 text 时回退 selector 末段摘录。
  // 正文的目标引用走阅读态分段（readingSegments）：pill 用目标文字，不占
  // 眉标。preview 仍是纯文本，只给签名比对和没有分段时的退路。
  return marksForActivePage().slice().sort(function (a, b) { return a.n - b.n; }).map(function (m) {
    var stored = annotationContent(m);
    var targets = markElementTargets(m);
    var segments = readingSegments(stored, targets).map(function (seg) {
      return seg.type === 'text' ? { type: 'text', text: contentToDisplay(seg.text, []) } : seg;
    });
    var row = annRowModel(m, {
      preview: annRowPreview(contentToDisplay(annotationContent(m), markElementTargets(m))),
      broken: isMarkBroken(m)
    });
    row.segments = segments;
    return row;
  });
}

function ensureSidebar() {
  if (ctx.sidebar) return ctx.sidebar;
  ctx.sidebar = document.createElement('div');
  ctx.sidebar.id = 'ann-sidebar'; ctx.sidebar.setAttribute('data-ann-ui', '');
  ctx.sidebar.hidden = true;
  // 骨架是静态字符串（无注入面）；所有动态内容仍走 textContent 构建。
  ctx.sidebar.innerHTML =
    '<div class="ann-sb-head">' +
    '<span class="ann-sb-title">标注</span>' +
    '<span class="ann-sb-count"></span>' +
    '<button type="button" class="ann-sb-close" title="关闭 (S)">×</button>' +
    '</div>' +
    '<div class="ann-sb-modes" role="group" aria-label="模式切换">' +
    '<button type="button" data-ann-mode="interact" aria-pressed="true">交互</button>' +
    '<button type="button" data-ann-mode="annotate" aria-pressed="false">标注</button>' +
    '</div>' +
    '<div class="ann-sb-filters" role="group" aria-label="按状态筛选" hidden></div>' +
    '<div class="ann-sb-body"></div>';
  document.body.appendChild(ctx.sidebar);
  ctx.sidebar.querySelector('.ann-sb-close').addEventListener('click', function () { setSidebarOpen(false); });
  ctx.sidebarBody = ctx.sidebar.querySelector('.ann-sb-body');
  ctx.sidebarCount = ctx.sidebar.querySelector('.ann-sb-count');
  ctx.sidebarFilters = ctx.sidebar.querySelector('.ann-sb-filters');
  ctx.sidebarSegInteract = ctx.sidebar.querySelector('[data-ann-mode="interact"]');
  ctx.sidebarSegAnnotate = ctx.sidebar.querySelector('[data-ann-mode="annotate"]');
  // 状态筛选分段（2026-09-24 两段：pending / closed）。段钮骨架建一次，
  // 计数 / 选中态由 renderSidebar 就地刷新；计数为 0 弱化但仍可点。
  ANN_FILTERS.forEach(function (key) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-ann-filter', key);
    b.addEventListener('click', function () { setStatusFilter(key); });
    ctx.sidebarFilters.appendChild(b);
  });
  // segmented 是 setMode 的纯鼠标入口（同 pinpoint.setMode 语义）。
  ctx.sidebarSegInteract.addEventListener('click', function () { if (ctx.mode) toggleMode(); });
  ctx.sidebarSegAnnotate.addEventListener('click', function () { if (!ctx.mode) toggleMode(); });
  // 行内动作钮（完成 / 重新打开）各自带 listener 并 stopPropagation，
  // 这里只兜「点行 = 跳转」。
  ctx.sidebarBody.addEventListener('click', function (e) {
    var row = e.target && e.target.closest ? e.target.closest('.wb-ann-item[data-ann-n]') : null;
    if (!row) return;
    goToMark(parseInt(row.getAttribute('data-ann-n'), 10));
  });
  return ctx.sidebar;
}

function renderSidebar() {
  if (!ctx.sidebar) return;
  if (sidebarSuppressed()) { ctx.sidebar.hidden = true; return; }
  if (ctx.sidebar.hidden) return;
  // segmented 每次 notify 都同步（sig 只挡列表重建，不挡模式反映）。
  ctx.sidebarSegInteract.classList.toggle('on', !ctx.mode);
  ctx.sidebarSegInteract.setAttribute('aria-pressed', String(!ctx.mode));
  ctx.sidebarSegAnnotate.classList.toggle('on', !!ctx.mode);
  ctx.sidebarSegAnnotate.setAttribute('aria-pressed', String(!!ctx.mode));
  var rows = sidebarRowModel();
  var visibleRows = annFilterRows(rows, ctx.statusFilter);
  // 筛选分段就地刷新（骨架建一次，不随 sig 重建）：计数 + 选中态 + 0 计数弱化。
  if (ctx.sidebarFilters) {
    var counts = annFilterCounts(rows);
    ctx.sidebarFilters.hidden = !rows.length;
    ANN_FILTERS.forEach(function (key) {
      var b = ctx.sidebarFilters.querySelector('[data-ann-filter="' + key + '"]');
      if (!b) return;
      b.textContent = annStatusLabel(key) + ' ' + counts[key];
      b.classList.toggle('on', ctx.statusFilter === key);
      b.setAttribute('aria-pressed', String(ctx.statusFilter === key));
      b.classList.toggle('dim', !counts[key]);
    });
  }
  // sig 比对（同 workbench 列表）：marks 没变的 notify（模式切换等）不重建 DOM。
  var sig = rows.map(function (r) {
    return r.n + '|' + r.cap + '|' + r.preview + '|' + JSON.stringify(r.segments || []) + '|' + r.broken + '|' + r.tags + '|' + r.status + '|' + JSON.stringify(r.replies || []);
  }).join('~') + '|f:' + ctx.statusFilter;
  var pendingCount = rows.filter(function (r) { return filterIncludesStatus('pending', r.status); }).length;
  ctx.sidebarCount.textContent = pendingCount ? '(' + pendingCount + ')' : '';
  if (sig === ctx.sidebarSig) return;
  ctx.sidebarSig = sig;
  ctx.sidebarBody.textContent = '';
  if (!rows.length) {
    var empty = document.createElement('div');
    empty.className = 'wb-ann-empty';
    var emptyTitle = document.createElement('p');
    emptyTitle.className = 'wb-ann-empty-title';
    emptyTitle.textContent = '暂无标注';
    var emptyHint = document.createElement('p');
    emptyHint.className = 'wb-ann-empty-hint';
    emptyHint.textContent = '点上方「标注」进入标注模式，再点选页面元素添加标注';
    empty.appendChild(emptyTitle);
    empty.appendChild(emptyHint);
    ctx.sidebarBody.appendChild(empty);
    return;
  }
  if (!visibleRows.length) {
    var filterEmpty = document.createElement('div');
    filterEmpty.className = 'wb-ann-filter-empty';
    filterEmpty.textContent = '没有 ' + annStatusLabel(ctx.statusFilter) + ' 的标注';
    ctx.sidebarBody.appendChild(filterEmpty);
    return;
  }
  visibleRows.forEach(function (r) {
    ctx.sidebarBody.appendChild(buildRow(r));
  });
}

/** 侧栏一行。 */
function buildRow(r) {
  var item = document.createElement('div');
  item.className = 'wb-ann-item' + (r.broken ? ' wb-ann-item--broken' : '');
  item.setAttribute('data-ann-n', r.n);
  // 序号圆颜色跟着状态走（--ann-st-*，与画布钉子同一组变量）。
  item.setAttribute('data-ann-status', annStatusOf(r));
  var main = document.createElement('button');
  main.type = 'button';
  main.className = 'wb-ann-item-main';
  var num = document.createElement('span');
  num.className = 'wb-ann-num';
  num.textContent = r.n;
  var body = document.createElement('span');
  body.className = 'wb-ann-body';
  var cap = document.createElement('span');
  cap.className = 'wb-ann-cap';
  cap.textContent = r.cap;
  body.appendChild(cap);
  if (r.segments && r.segments.length) {
    var text = document.createElement('span');
    text.className = 'wb-ann-text';
    text.innerHTML = readingBodyHtml({ segments: r.segments });
    body.appendChild(text);
  } else if (r.preview) {
    var plain = document.createElement('span');
    plain.className = 'wb-ann-text';
    plain.textContent = r.preview;
    body.appendChild(plain);
  }
  (r.replies || []).forEach(function (reply) {
    var line = document.createElement('span');
    line.className = 'wb-ann-reply';
    line.setAttribute('data-who', reply.who);
    line.textContent = reply.who + '：' + reply.text;
    body.appendChild(line);
  });
  // 文字状态标（check / done / close；open 不出标）。
  if (r.status !== 'open') {
    var stTag = document.createElement('span');
    stTag.className = 'wb-ann-status-tag';
    stTag.textContent = r.status;
    body.appendChild(stTag);
  }
  if (r.broken) {
    var tag = document.createElement('span');
    tag.className = 'wb-ann-broken-tag';
    tag.textContent = '锚点失效';
    body.appendChild(tag);
  }
  main.appendChild(num);
  main.appendChild(body);
  var acts = document.createElement('span');
  acts.className = 'ann-sb-acts';
  // 行件与工作台弹层同款（pp2 状态机）：删除退役，open / check / done 行的
  // 收尾动作是「完成」= close（单击即关不二次确认，toast「已完成 #n」带
  // 撤销）；close 行给「重新打开」回 open。硬删只走工具条
  // 「清空标记」与 composer 的删除钮。
  if (!isClosed(r)) {
    var doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'wb-ann-done';
    doneBtn.innerHTML = annIcon('check');
    doneBtn.setAttribute('aria-label', '完成 #' + r.n);
    doneBtn.title = '完成 #' + r.n;
    doneBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeAnnotation(r.n);
    });
    acts.appendChild(doneBtn);
  } else {
    var reopenBtn = document.createElement('button');
    reopenBtn.type = 'button';
    reopenBtn.className = 'wb-ann-reopen';
    reopenBtn.textContent = '重新打开';
    reopenBtn.setAttribute('aria-label', '重新打开标注 ' + r.n);
    reopenBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      reopenAnnotation(r.n);
    });
    acts.appendChild(reopenBtn);
  }
  item.appendChild(main);
  item.appendChild(acts);
  return item;
}

// ---------- 关闭 / 撤销（done → close 单击，toast + 撤销 5s，不二次确认）----------

function hideToast() {
  if (ctx.toastEl) ctx.toastEl.hidden = true;
  if (ctx.toastTimer) { clearTimeout(ctx.toastTimer); ctx.toastTimer = 0; }
}

function showToast(text, actionLabel, onAction) {
  if (!ctx.toastEl) {
    ctx.toastEl = document.createElement('div');
    ctx.toastEl.id = 'ann-toast';
    ctx.toastEl.setAttribute('data-ann-ui', '');
    document.body.appendChild(ctx.toastEl);
  }
  hideToast();
  ctx.toastEl.textContent = '';
  var label = document.createElement('span');
  label.textContent = text;
  ctx.toastEl.appendChild(label);
  if (actionLabel) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = actionLabel;
    btn.addEventListener('click', function () { hideToast(); if (onAction) onAction(); });
    ctx.toastEl.appendChild(btn);
  }
  ctx.toastEl.hidden = false;
  ctx.toastTimer = setTimeout(hideToast, 5000);
}

/** 客户端允许的转换：owner 完成（open / check / done → close，工作台单击）与
    close 撤销 / 重新打开（→ 关闭前的原态）。check / done 的升档仍只经 ppnt
    mark 端点。 */
function markStatus(n, next) {
  var m = ctx.marks.find(function (k) { return k.n === n; });
  if (!m) return false;
  var from = annStatusOf(m);
  if (from === next) return true;
  var ownerMove = (next === 'close' && from !== 'close') || (from === 'close' && next !== 'close');
  if (!ownerMove) return false;
  m.status = next;
  persist();
  return true;
}

export function closeAnnotation(n) {
  // 撤销要回关闭前的原态（open / check / done），不是一律回 open。
  // 完成的正是当前打开的这条（列表点行打开后点完成，或框里的完成钮）：先关框
  // —— 关框会把没存的修改存下（状态回 open），再 close，顺序反了会把 close 盖掉。
  if (ctx.activeComposer && ctx.activeComposer.persistedN === n) closeComposer();
  var m = ctx.marks.find(function (k) { return k.n === n; });
  var from = m ? annStatusOf(m) : null;
  if (!markStatus(n, 'close')) return;
  showToast('已完成 #' + n, '撤销', function () { markStatus(n, from); });
}

export function reopenAnnotation(n) {
  markStatus(n, 'open');
}

/** 状态筛选（侧栏分段 / 工作台弹层共用入口）：记 LS（按页）→ 重画钉子 →
    notify 让侧栏与 annSnap 跟上。同值幂等。 */
export function setStatusFilter(next) {
  if (ANN_FILTERS.indexOf(next) < 0 || next === ctx.statusFilter) return;
  ctx.statusFilter = next;
  writeAnnFilter(localStorage, statusFilterKey(), next);
  ctx.structureDirty = true;
  renderAll();
  notify();
}

function setSidebarOpen(on) {
  on = !!on;
  if (on && sidebarSuppressed()) return; // 让位控制面；不动 viewer 偏好
  if (ctx.sidebarOpen === on) return;
  ctx.sidebarOpen = on;
  try { localStorage.setItem(ctx.SIDEBAR_LS_KEY, on ? '1' : ''); } catch (e) { /* quota */ }
  document.documentElement.classList.toggle('ann-sidebar-open', on);
  if (on) {
    ensureSidebar();
    ctx.sidebar.hidden = false;
    renderSidebar();
  } else if (ctx.sidebar) {
    ctx.sidebar.hidden = true; ctx.sidebarSig = '';
  }
  if (ctx.activeComposer && ctx.activeComposer.syncLayout) ctx.activeComposer.syncLayout();
  notify();
}

export function toggleSidebar() { setSidebarOpen(!ctx.sidebarOpen); }

