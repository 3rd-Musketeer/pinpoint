// 页 tab（ADR 0041）：board.json 的 `tabs: [{ id, title, sections }]` 是一层纯视图分组 ——
// 页 → tab → section。tab 之间共用 components/、资源与标注桶，screen id / section id 全页唯一。
//
// 这里是读侧的唯一归一点（同 board-file.js 的 readBoard、preview-contracts.js 的 validateBoard 共用）：
// 把磁盘上的 tabs 摊成「扁平 sections（每个带 tabId）+ tabs 元数据」，服务端各消费者
// （编译、frame-doc、导出、ann-query、ppnt CLI）照旧只认 sections；要按 tab 分的地方再用
// boardForTab / tabIdOfScreen 取。没写 tabs 的 board（存量）原样返回同一个对象，零迁移。
// 纯函数、DOM-free，与 lib/ 各模块同例（node --test 直测）。

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

/** board（摊平后）→ tab 元数据 [{ id, title }]；没有 tabs 的存量 board 为 []。 */
export function boardTabList(board) {
  var b = flattenTabs(board);
  return b && Array.isArray(b.tabs)
    ? b.tabs.filter(function (tab) { return tab && typeof tab.id === 'string'; })
    : [];
}

/** 有 ≥ 2 个 tab 才算多 tab 页：切换条出现、位置号带 tab 前缀。单 tab 与存量 board 行为同今天。 */
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
 * 只留某个 tab 的 sections（工作台只挂活动 tab，画布 / 大纲 / 引用号 / 导航随之都只看这个 tab）。
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

/** 位置号（A / B3）在多 tab 页上带 tab 前缀：`flow:B3`；单 tab / 存量页原样。 */
export function qualifyRef(board, tabId, ref) {
  if (!ref || !tabId || !isMultiTab(board)) return ref || '';
  return tabId + ':' + ref;
}
