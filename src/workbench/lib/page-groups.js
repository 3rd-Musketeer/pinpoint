// 左栏「页面」组的列表模型：纯函数，Sidebar 消费。搜索过滤、行首类型图标、显示名。
// 排序走 lib/page-sort.js 的三档。

/** 列表全集（模板显隐曾是这里唯一的过滤；退役后是全量返回）。 */
export function visiblePages(pages) {
  return (pages || []).slice();
}

/** 搜索命中：标题或 id 的大小写无关子串。空查询 = 全留。 */
function matchesQuery(page, query) {
  var q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return true;
  var title = String(page.title || '').toLowerCase();
  return title.indexOf(q) >= 0 || String(page.id || '').toLowerCase().indexOf(q) >= 0;
}

export function filterPages(pages, query) {
  return pages.filter(function (page) { return matchesQuery(page, query); });
}

/* 页面类型 → 图标（owner 2026-09-05 定的映射，与横条类型标同一套词，见
   board-entries.js ENTRY_TAG_LABELS）：画布 = 目录条目 board ios（多屏排在画布上）
   → smartphone；文档 = 单份 HTML 或 board html → file-text。
   每一行都有，不留空槽。混合页按默认打开的那个条目算，这里
   用 manifest page 的 mode；Component Library 内建页的 mode 钉在 pages.js COMPONENTS_PAGE。 */
export var PAGE_KIND_ICONS = { canvas: 'smartphone', doc: 'file-text' };

export function pageKindKey(page) {
  if (!page) return 'doc';
  return page.mode === 'ios' ? 'canvas' : 'doc';
}

/** 页的显示名：重命名优先（prefs.pageNames），内建页（system）不参与重命名。 */
export function pageDisplayTitle(page, names) {
  if (!page) return '';
  var custom = names && names[page.id];
  if (!page.system && typeof custom === 'string' && custom.trim()) return custom.trim();
  return page.title || page.id;
}
