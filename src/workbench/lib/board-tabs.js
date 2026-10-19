// 页 tab（ADR 0041）：board.json 的 `tabs: [{ id, title, sections }]` 是一层纯视图分组 ——
// 页 → tab → section。tab 之间共用 components/、资源与标注桶，screen id / section id 全页唯一。
//
// 读侧归一（摊平）的唯一实现已挪进 src/shared/board-tabs.js（S2：board 遍历器
// screenEntries 在 shared，客户端与服务端共用），这里再导出保持既有 import 路径；
// 本文件只剩「摊平之后按 tab 取视图」的助手。
// 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。

import { flattenTabs } from '../../shared/board-tabs.js';

export { flattenTabs, hasRawTabs } from '../../shared/board-tabs.js';

/** board（摊平后）→ tab 元数据 [{ id, title }]；没有 tabs 的存量 board 为 []。 */
export function boardTabList(board) {
  var b = flattenTabs(board);
  return b && Array.isArray(b.tabs)
    ? b.tabs.filter(function (tab) { return tab && typeof tab.id === 'string'; })
    : [];
}

/** 有 ≥ 2 个 tab 才算多 tab 页：位置号带 tab 前缀，分享页才出切换条。
 *  工作台的 #wbtabbar 出不出看 boardShowsTabBar（board-entries.js）：≥ 2 个 tab 才出；不到 2 个 tab 的画布页大纲钮在横条里（boardHasStripOutline）。 */
export function isMultiTab(board) {
  return boardTabList(board).length >= 2;
}

/** 想要的 tab id 不存在 / 缺省 → 第一个 tab；没有 tabs → ''。 */
export function resolveTabId(board, wanted) {
  var tabs = boardTabList(board);
  if (!tabs.length) return '';
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].id === wanted) return wanted;
  }
  return tabs[0].id;
}

/**
 * 只留某个 tab 的 sections（工作台画布只挂活动 tab；大纲浮层用它取出被点的那个 tab）。
 * 没有 tabs 的 board 原样返回；返回值保留完整的 tabs 元数据并带 activeTabId。
 */
export function boardForTab(board, tabId) {
  var b = flattenTabs(board);
  if (!boardTabList(b).length) return b;
  var id = resolveTabId(b, tabId);
  return Object.assign({}, b, {
    sections: (b.sections || []).filter(function (section) { return section && section.tabId === id; }),
    activeTabId: id,
  });
}

function screenIdOf(entry) {
  return typeof entry === 'string' ? entry : entry && entry.id;
}

/** screen id（页内唯一）→ 所在 tab id；没有 tabs 或查不到 → ''。 */
export function tabIdOfScreen(board, screenId) {
  var b = flattenTabs(board);
  if (!boardTabList(b).length || !screenId) return '';
  var sections = b.sections || [];
  for (var i = 0; i < sections.length; i++) {
    var screens = (sections[i] && sections[i].screens) || [];
    for (var j = 0; j < screens.length; j++) {
      if (screenIdOf(screens[j]) === screenId) return sections[i].tabId || '';
    }
  }
  return '';
}

/** section id（页内唯一）→ 所在 tab id；没有 tabs 或查不到 → ''。 */
export function tabIdOfSection(board, sectionId) {
  var b = flattenTabs(board);
  if (!boardTabList(b).length || !sectionId) return '';
  var sections = b.sections || [];
  for (var i = 0; i < sections.length; i++) {
    if (sections[i] && sections[i].id === sectionId) return sections[i].tabId || '';
  }
  return '';
}
