/**
 * 标注四态的钉子底色（亮色）。值由 scripts/build-tokens.mjs 从 token 源生成进 ./ann-tokens.js；
 * CSS 侧消费 --ann-st-* 变量：注入端钉在 [data-ann-ui] 上（src/client/annotate-css.js），
 * 工作台在 src/workbench/wb-tokens.css，src/shared/ann-list.css 只消费。两端同一份源。
 * 白字对比度在 ann-status.test.js 里断言（≥ 3:1）。
 *
 * 纯数据 + 小映射，不碰 DOM（src/shared 的约定）：内联进 /annotate.js。
 */
import { ANN_STATUS_LIGHT } from './ann-tokens.js';

export var ANN_STATUS_COLORS = ANN_STATUS_LIGHT;

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
