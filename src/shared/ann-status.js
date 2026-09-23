/**
 * Annotation status palette — the SSOT of the four status colors. Three CSS
 * sites consume the same `--ann-st-*` custom properties and must stay
 * value-identical:
 *   - canvas pin (.ann-badge, [data-ann-ui] base rule in src/client/annotate.js)
 *   - workbench popover row number (#wbann-pop rule in index.html)
 *   - injected sidebar row number (#ann-sidebar, same [data-ann-ui] rule; the
 *     shared row rules in src/shared/ann-list.css only reference the variables)
 * Three-way drift turns red in src/shared/ann-status.test.js — same trick as
 * the #ann-sidebar pin check in annotate-inline.test.js.
 *
 * Pure data + tiny mappers, DOM-free like every shared/ module: node-tested
 * directly, imported by the workbench, inlined into the served /annotate.js
 * (INLINED_LIBS in src/server/annotate-api.js).
 */

/** Status → pin / row-number background. White glyph on every value; the
 * computed WCAG ratios are asserted in ann-status.test.js. open / done clear
 * the AA large-text bar (3:1); check / close sit just below — check is the
 * owner-picked amber (2026-09-23, 等 owner 看), close is deliberate
 * de-emphasis. Both are recorded, not hidden. */
export var ANN_STATUS_COLORS = {
  open: '#5b7fa6',   // = --wb-accent，现状蓝灰
  check: '#b87c14',  // 琥珀
  done: '#2f9e63',   // 绿
  close: '#858e99',  // 灰
};

/** Status → CSS variable name carrying the color. Unknown / missing status
 * falls back to open (same default as annRowModel). */
export function annStatusVar(status) {
  return '--ann-st-' + (ANN_STATUS_COLORS[status] ? status : 'open');
}

/* ---- 状态筛选（owner 2026-09-23：「用 filter 切换查看 all、open、check、
   done、closed」）——取代「已关闭 N」折叠段：全部含 closed（沉底弱化），
   单状态只看该状态。行模型（annRowModel）的 status 是 'close'，筛选键按
   owner 的叫法是 'closed'，filterStatusOf 负责这一跳。 ---- */

export var ANN_FILTERS = ['all', 'open', 'check', 'done', 'closed'];

var FILTER_LABELS = { all: '全部', open: 'open', check: 'check', done: 'done', closed: 'closed' };

/** 段钮文案：全部/open/check/done/closed（状态名不翻，与行上的状态标同词）。 */
export function annStatusLabel(filter) {
  return FILTER_LABELS[filter] || '全部';
}

/** 筛选键 → 行 status；'all' 与未知键回 null（调用方按不过滤处理）。 */
export function filterStatusOf(filter) {
  if (filter === 'closed') return 'close';
  return ANN_STATUS_COLORS[filter] ? filter : null;
}

/** 段钮计数：all = 全部行（含 closed），closed 计 status 'close'。 */
export function annFilterCounts(rows) {
  var out = { all: 0, open: 0, check: 0, done: 0, closed: 0 };
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    var status = (r && r.status) || 'open';
    out.all++;
    out[status === 'close' ? 'closed' : (FILTER_LABELS[status] ? status : 'open')]++;
  });
  return out;
}

/** 筛选后的行序：'all' = 非 closed 在前、closed 沉底（各自保持原序）；
 * 单状态 = 只留该状态，原序。不改传入数组。 */
export function annFilterRows(rows, filter) {
  var list = Array.isArray(rows) ? rows.slice() : [];
  var want = filterStatusOf(filter);
  if (!want) {
    var open = list.filter(function (r) { return ((r && r.status) || 'open') !== 'close'; });
    var closed = list.filter(function (r) { return ((r && r.status) || 'open') === 'close'; });
    return open.concat(closed);
  }
  return list.filter(function (r) { return ((r && r.status) || 'open') === want; });
}

/** 筛选选择的本地记忆（按页，key 由调用方拼）：读写都包 try/catch ——
 * 隐私模式 / quota 下静默回 'all'，列表照常可用。 */
export function readAnnFilter(storage, key) {
  try {
    var value = storage.getItem(key);
    return FILTER_LABELS[value] ? value : 'all';
  } catch (e) {
    return 'all';
  }
}

export function writeAnnFilter(storage, key, value) {
  try {
    if (FILTER_LABELS[value]) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch (e) { /* quota / privacy mode */ }
}
