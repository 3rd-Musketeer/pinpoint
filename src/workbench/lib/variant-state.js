// 变体组的展示状态（2026-10-10 grilling）：收起 = 只显示选中的那个变体（缺省第一个），展开 = 全部并排、
// 选中的高亮。状态是评审偏好，不是原型内容：存本机 prefs.variantsByPage[pageId][组键]，不进 board.json。
// 纯函数、DOM-free（node --test 直测）；DOM 侧在 workbench/variants.js。

/** 组键：section id + NUL + 组 id（组 id 只在段内唯一）。 */
export function variantGroupKey(sectionId, groupId) {
  return sectionId + '\0' + groupId;
}

function stateTable(prefs, pageId) {
  var all = prefs && prefs.variantsByPage;
  var page = all && typeof all === 'object' && !Array.isArray(all) ? all[pageId] : null;
  return page && typeof page === 'object' && !Array.isArray(page) ? page : {};
}

/**
 * 一组的当前状态 → { open, sel }。偏好里的脏值（选中的变体已被删 / 改名）落回第一个，
 * 不能让组一个变体都不显示。
 */
export function groupState(prefs, pageId, key, variantIds) {
  var raw = stateTable(prefs, pageId)[key];
  var ids = variantIds || [];
  var sel = raw && ids.indexOf(raw.sel) >= 0 ? raw.sel : (ids[0] || '');
  return { open: !!(raw && raw.open === true), sel: sel };
}

/** 写侧 patch（savePrefs 合并写）：缺省态（收起 + 选第一个）删 key，偏好不积灰。 */
export function withGroupState(prefs, pageId, key, variantIds, next) {
  var all = Object.assign({}, prefs && prefs.variantsByPage);
  var page = Object.assign({}, stateTable(prefs, pageId));
  var ids = variantIds || [];
  var sel = ids.indexOf(next.sel) >= 0 ? next.sel : ids[0];
  if (!next.open && sel === ids[0]) delete page[key];
  else page[key] = { open: !!next.open, sel: sel };
  if (Object.keys(page).length) all[pageId] = page; else delete all[pageId];
  return { variantsByPage: all };
}

/** 一个变体此刻要不要摆上画布：展开 = 全部，收起 = 只有选中的。 */
export function variantShown(state, variantId) {
  return state.open || state.sel === variantId;
}

/** 一页所有组当前选中的变体：{ 组键: 变体 id }，只含偏好里记过的组（没记的组按缺省选第一个，由读的一方补）。
    分享页导出带上它，高亮的就是评审者在工作台里选中的那个。 */
export function selectionsForPage(prefs, pageId) {
  var table = stateTable(prefs, pageId);
  var out = {};
  Object.keys(table).forEach(function (key) {
    var entry = table[key];
    if (entry && typeof entry.sel === 'string' && entry.sel) out[key] = entry.sel;
  });
  return out;
}
