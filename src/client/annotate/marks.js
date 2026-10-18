// 标注行的内存状态与编号：marks、revision、同步世代，以及 @mention 在
// 显示文本与落盘文本之间的转换。导出 bind_marks、init_marks、contentToDisplay、
// contentToStorage、markByN、docAnnotations 等。
import { normalizeAnnotation, readingSegments, targetContentToDisplay, targetContentToStorage } from '../../shared/annotation-indicator.js';
import { annRowCap, annRowReplies } from '../../shared/ann-row.js';
import { readAnnFilter } from '../../shared/ann-status.js';

export function bind_marks(c) { ctx = c; }
var ctx;

export function init_marks() {
  ctx.marks = [];      // in-memory annotations: {n, id, type, pageId?, section?, sectionLabel?, screenId?, selector?, content, …}
  ctx.revision = 0;    // disk document revision (SSOT concurrency)
  ctx.baseMarks = [];  // 本窗口最后确认的盘上版本（revision 那一版的行）：保存撞 409 时按它三方合并（rebaseOnto）
  ctx.syncing = false;
  ctx.mutationVersion = 0;
  ctx.syncedMutationVersion = 0;
  ctx.deferredRemoteDoc = null;
  ctx.syncEpoch = 0;          // 账本世代：路由切换即 +1，在途 sync/hydrate 回调凭世代号丢弃
  ctx.ledgerSwitching = false; // switchLedgerTo 已清账、hydrate 未落地期间为 true
  ctx.queuedSwitch = null;    // 切换途中又来换账本请求：coalesce 到最新一个
  ctx.canvasLedgerApplied = false; // 画布实例是否已落到第一个页桶（boot 占位结束）
  ctx.settleWaiters = [];     // whenSettled 的等待者：hydrate 落地后一次性放行
  ctx.inflightSync = null;    // 在途 /save：Promise<{ok,status,data}|null>，换账本时交给 outbox 接着等
  ctx.inflightVersion = 0;    // 在途 /save 带的 mutationVersion
  ctx.inflightSaveId = '';    // 在途 /save 的 saveId：离开页面时的快照用 after 声明接在它之后
  ctx.ledgerOutbox = Object.create(null); // 账本键 → 换账本时没落盘的写（Promise，永不 reject）
  ctx.eventSource = null;
  ctx.serverOnline = false;   // SSE OPEN liveness only (not hydrate/POST success)
  ctx.syncError = false;      // last POST/save failed while SSE may still be open
  ctx.mode = false;    // true = 标注; false = 交互 (default)
  ctx.paused = false;  // hide pins / overlay without leaving Annotate intent
  ctx.floatingToolbar = false;
  ctx.sidebarOpen = false; // 标注面板（#ann-sidebar）；viewer 偏好，持久化到 LS
  // 状态筛选（pp2：取代「已关闭 n」折叠段）：驱动侧栏列表与画布钉子两处。
  // 按页记在 LS（key 跟账本走，账本切换时重读）；读不到 / 坏值回 'pending'。
  ctx.statusFilter = readAnnFilter(localStorage, statusFilterKey()); // 'pending' | 'closed'
  ctx.updateListeners = [];
  ctx.hoverEl = null;
  ctx.drag = null;
  ctx.arrowFrom = null;
  ctx.activeComposer = null;
  // 2026-09-04 评审板 H1 起默认开：评论卡是画布上的主体表达（钉子常显、卡在
  // hover 钉子时出），不再是一个要先去开的开关。「隐藏批注」这一档仍在，
  // 只是不再是默认。
  ctx.renderComments = true;  // "在画布渲染评论" toggle: show content bubbles beside anchors
  // 评论布局：'inline'=气泡在 iframe overlay（窄窗口可能压正文） /
  //  'sidebar'=气泡在父级 workbench 右侧 gutter（iframe 收窄、文档自己响应式回流，不压不遮）。
  ctx.bubbleLayout = 'inline';
  // Mention: UI shows @n; disk stores [@a:<id>] （旧 [@m:] 写法的读侧升级已随迁移脚本删除）.
  ctx.MENTION_STORE_RE = /\[@a:([a-z0-9]+)\]/gi;
  ctx.MENTION_DISPLAY_RE = /@(\d+)\b/g;
}

/** 状态筛选的 LS 槽：跟账本同键（= 按页），后缀区分标注数据本体。 */
export function statusFilterKey() { return ctx.LS_KEY + ':stfilter'; }
// 页面自己改 URL（pushState）不换账本：账本在加载时按 pathname 定下；
// 只有画布实例切活动页时上面三个 key 重算（switchLedgerTo）。

export function newMarkId() {
  var id = '';
  var alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  do {
    id = '';
    for (var i = 0; i < 6; i++) id += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  } while (ctx.marks.some(function (k) { return k.id === id; }));
  return id;
}

export function ensureMarkId(m) {
  if (!m) return m;
  if (!m.id || typeof m.id !== 'string') m.id = newMarkId();
  return m;
}

export function ensureAllMarkIds() {
  ctx.marks.forEach(ensureMarkId);
}

function markById(id) {
  if (!id) return null;
  for (var i = 0; i < ctx.marks.length; i++) {
    if (ctx.marks[i].id === id) return ctx.marks[i];
  }
  return null;
}

export function markByN(n) {
  n = parseInt(n, 10);
  if (!isFinite(n)) return null;
  for (var i = 0; i < ctx.marks.length; i++) {
    if (ctx.marks[i].n === n) return ctx.marks[i];
  }
  return null;
}

/** Disk / agent form → textarea form (@order). */
export function contentToDisplay(text, targets) {
  return targetContentToDisplay(text, targets || []).replace(ctx.MENTION_STORE_RE, function (_, id) {
    var hit = markById(id);
    return hit ? ('@' + hit.n) : '@?';
  });
}

/** 统一构造给气泡渲染的 mark 视图：正文走 contentToDisplay（解析 @mention 与 target 引用）。
 * iframe 内 ctx.overlay 与父级 gutter 共用，避免两边显示不一致。 */
/** 悬浮卡眉标：画布上优先用帧图注的引用号（F1），目标名留给正文 pill。
 *  没有帧（注入页、框选）时退回 annRowCap 的元素摘录。 */
function bubbleCap(m) {
  var screen = m && m.screenId && document.querySelector('.wb-screen[data-screen="' + CSS.escape(m.screenId) + '"] .wb-cap-ref');
  var ref = screen && screen.textContent.trim();
  return ref || annRowCap(m);
}

export function bubbleMarkView(m) {
  var stored = m.content != null ? m.content : '';
  var targets = m.targets || [];
  return {
    n: m.n,
    // 眉标 = 帧引用号（画布）或元素摘录（注入页）。目标名在正文 pill 里，不进眉标。
    cap: bubbleCap(m),
    // content 仍是编辑协议的纯文本（gutter 等只拿字符串的调用方用）；
    // segments 是阅读态：目标引用画成文字 pill，账本文本不动。
    content: contentToDisplay(stored, targets),
    // 分段吃账本文本（[@t:iN]），文字段再把 @mention 换成 @n。先整段换成展示文本
    // 会把目标引用变成 [indicator N]，阅读态就找不到 pill。
    segments: readingSegments(stored, targets).map(function (seg) {
      return seg.type === 'text' ? { type: 'text', text: contentToDisplay(seg.text, []) } : seg;
    }),
    replies: annRowReplies(m)
  };
}

/** Textarea form → disk form ([@a:id]). */
export function contentToStorage(text, targets) {
  var withTargetRefs = targetContentToStorage(text, targets || []);
  return withTargetRefs.replace(ctx.MENTION_DISPLAY_RE, function (full, n) {
    var hit = markByN(n);
    return hit ? ('[@a:' + ensureMarkId(hit).id + ']') : full;
  });
}

export function extractMentionIds(storedContent) {
  var ids = [];
  var seen = {};
  String(storedContent || '').replace(ctx.MENTION_STORE_RE, function (_, id) {
    if (!seen[id]) { seen[id] = true; ids.push(id); }
    return _;
  });
  return ids;
}

export function annotationContent(m) {
  return (m && m.content) || '';
}

export function annotationSection(m) {
  return (m && m.section) || '';
}

// 定位 frame 用的 section：账本行没带 section（旧行 / 手写行）时，从锚点元素所在的
// 板 section 推，别因为行里缺字段就退回“以标注居中”。
export function frameSectionFor(m, el) {
  var own = annotationSection(m);
  if (own || !el || !el.closest) return own;
  var item = el.closest('.wb-lib-item[data-ann-section]');
  return item ? item.getAttribute('data-ann-section') : '';
}

export function annotationSectionLabel(m) {
  return (m && m.sectionLabel) || '';
}

// Indicator/normalize logic comes from lib/annotation-indicator.js (SSOT, node-tested)
// via the esbuild bundle. These thin wrappers preserve annotate.js semantics.

export function docAnnotations(doc) {
  if (!doc) return null;
  return Array.isArray(doc.annotations) ? doc.annotations : null;
}
