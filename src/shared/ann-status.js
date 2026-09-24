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

/* ---- 状态筛选（owner 2026-09-24 改为两段）：pending = open / check / done，
   都在等 owner 验收；closed = owner 确认做完的。取代 09-23 的全部 · open ·
   check · done · closed 五段。行模型（annRowModel）的 status 是 'close'，
   筛选键按 owner 的叫法是 'closed'。 ---- */

export var ANN_FILTERS = ['pending', 'closed'];

var FILTER_LABELS = { pending: 'pending', closed: 'closed' };

/** 段钮文案：与筛选键同词（owner 的叫法）。 */
export function annStatusLabel(filter) {
  return FILTER_LABELS[filter] || 'pending';
}

function isClosed(r) {
  return ((r && r.status) || 'open') === 'close';
}

/** 该状态在这个筛选下是否可见（画布钉子与列表行同一口径）；未知键按 pending。 */
export function filterIncludesStatus(filter, status) {
  var closed = (status || 'open') === 'close';
  return filter === 'closed' ? closed : !closed;
}

/** 段钮计数，也是右下角计数的口径（pending）。 */
export function annFilterCounts(rows) {
  var out = { pending: 0, closed: 0 };
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    out[isClosed(r) ? 'closed' : 'pending']++;
  });
  return out;
}

/** 筛选后的行，保持原序；未知键按 pending。不改传入数组。 */
export function annFilterRows(rows, filter) {
  var list = Array.isArray(rows) ? rows.slice() : [];
  var wantClosed = filter === 'closed';
  return list.filter(function (r) { return isClosed(r) === wantClosed; });
}

/** 筛选选择的本地记忆（按页，key 由调用方拼）：读写都包 try/catch ——
 * 隐私模式 / quota 下静默回 'pending'。09-23 存下的旧值（all / open /
 * check / done）一律读成 'pending'。 */
export function readAnnFilter(storage, key) {
  try {
    return storage.getItem(key) === 'closed' ? 'closed' : 'pending';
  } catch (e) {
    return 'pending';
  }
}

export function writeAnnFilter(storage, key, value) {
  try {
    if (FILTER_LABELS[value]) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch (e) { /* quota / privacy mode */ }
}
