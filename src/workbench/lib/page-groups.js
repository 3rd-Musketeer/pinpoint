// 左栏「页面」组的列表模型：纯函数。行首类型图标、显示名。
// 排序走 lib/page-sort.js 的三档。模板页显隐与侧栏搜索都已退役，列表就是调用方手里的那份。

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
