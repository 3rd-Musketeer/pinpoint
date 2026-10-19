// 页 tab（ADR 0041）的读侧归一：board.json 的 `tabs: [{ id, title, sections }]` 是一层纯视图分组 ——
// 页 → tab → section。tab 之间共用 components/、资源与标注桶，screen id / section id 全页唯一。
//
// 这里是读侧的唯一归一点（同 board-file.js 的 readBoard、preview-contracts.js 的 validateBoard 共用）：
// 把磁盘上的 tabs 摊成「扁平 sections（每个带 tabId）+ tabs 元数据」，服务端各消费者
// （编译、frame-doc、导出、ann-query、ppnt CLI）照旧只认 sections；要按 tab 分的地方再用
// workbench/lib/board-tabs.js 的 boardForTab / tabIdOfScreen 取。没写 tabs 的 board（存量）
// 原样返回同一个对象，零迁移。
// 纯函数、DOM-free，与 shared/ 各模块同例（node --test 直测）；按 tab 取视图的助手在
// workbench/lib/board-tabs.js（从这里再导出 flattenTabs / hasRawTabs）。

/** 磁盘形态：tabs 里至少有一个 tab 自己带 sections 数组。 */
export function hasRawTabs(board) {
  return !!board && Array.isArray(board.tabs)
    && board.tabs.some(function (tab) { return tab && Array.isArray(tab.sections); });
}

/**
 * 摊平：{ tabs: [{id,title,sections}] } → { sections: [{...section, tabId}], tabs: [{id,title}] }。
 * 幂等：已摊平的 board（tabs 里不再带 sections）与没有 tabs 的 board 原样返回同一个对象。
 * 宽容：不校验形状（校验归 validateBoard）；坏条目原样放行，留给校验去报。
 */
export function flattenTabs(board) {
  if (!hasRawTabs(board)) return board;
  var sections = [];
  var tabs = [];
  board.tabs.forEach(function (tab) {
    if (!tab || typeof tab !== 'object') return;
    tabs.push({ id: tab.id, title: tab.title == null || tab.title === '' ? tab.id : tab.title });
    (Array.isArray(tab.sections) ? tab.sections : []).forEach(function (section) {
      sections.push(section && typeof section === 'object' ? Object.assign({}, section, { tabId: tab.id }) : section);
    });
  });
  var out = Object.assign({}, board, { sections: sections, tabs: tabs });
  return out;
}
