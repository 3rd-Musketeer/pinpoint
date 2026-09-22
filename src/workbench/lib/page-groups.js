// 左栏 Pages 的分组模型（2026-09-04 切片 ②，ADR 0032）：纯函数，Sidebar 消费。
// 回答四件事，每件一个函数，互不缠绕：
//  1. 模板页显不显示（三个 manifest 页默认藏起来，设置里有开关）；
//  2. 搜索框打进来的字过滤谁（标题或 id 命中即留，段与段之间同一条规则）；
//  3. 页归哪个夹（registry 条目看自己的 folder 字段，模板页看顶层 pageFolders）；
//  4. 「最近」段那五条本地记录怎么进出。
//
// 顺序规则（ADR 0032）：文件夹在前、散页在后，夹按 folders[] 数组序。夹内与散页
// 区都沿用 Pages 的三档排序（lib/page-sort.js），**手动 order 只在夹内、且排序档
// 是「默认」时生效**——另外两档按时间和名字排，手动顺序在那里没有落脚的位置；
// 散页区永远不吃 order（一个页拖出夹之后它残留的 order 不该影响散页的书写顺序）。
import { sortPages } from './page-sort.js';
import { FOLDER_ID_PATTERN, slugify } from '../../shared/registry-ids.js';

// 模板页 = content/previews/_index.json 的 manifest 页（ADR 0032）。
// 按 id 点名，不按「来自 manifest」推断。
export var TEMPLATE_PAGE_IDS = ['library', 'doc-library'];

var TEMPLATE_SET = TEMPLATE_PAGE_IDS.reduce(function (acc, id) { acc[id] = true; return acc; }, {});

export function isTemplatePage(pageId) {
  return !!TEMPLATE_SET[pageId];
}

/** 模板页的显隐。keepId = 当前页：藏起来的时候它仍要留在列表里，否则选中态无处可落。 */
export function visiblePages(pages, options) {
  options = options || {};
  if (options.showTemplates) return pages.slice();
  return pages.filter(function (page) {
    return !isTemplatePage(page.id) || page.id === options.keepId;
  });
}

/** 搜索命中：标题或 id 的大小写无关子串。空查询 = 全留。 */
export function matchesQuery(page, query) {
  var q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return true;
  var title = String(page.title || '').toLowerCase();
  return title.indexOf(q) >= 0 || String(page.id || '').toLowerCase().indexOf(q) >= 0;
}

export function filterPages(pages, query) {
  return pages.filter(function (page) { return matchesQuery(page, query); });
}

/** 页归哪个夹：registry 条目自带 folder 字段，模板页只能靠顶层 pageFolders。 */
export function folderOfPage(page, pageFolders) {
  if (page && typeof page.folder === 'string') return page.folder;
  var mapped = pageFolders && pageFolders[page.id];
  return typeof mapped === 'string' ? mapped : null;
}

/** 手动次序：同上两条落点；没有次序的页返回 null（排到有次序的后面）。 */
export function orderOfPage(page, pageOrder) {
  if (page && Number.isFinite(page.order)) return page.order;
  var mapped = pageOrder && pageOrder[page.id];
  return Number.isFinite(mapped) ? mapped : null;
}

// 夹内排序：「默认」档 = 手动 order 升序（无 order 的按原相对顺序沉底，
// Array.prototype.sort 稳定）；其余两档交给 sortPages，order 不参与。
function sortInFolder(pages, sort, pageOrder) {
  if (sort !== 'default') return sortPages(pages, sort);
  var list = pages.slice();
  list.sort(function (a, b) {
    var oa = orderOfPage(a, pageOrder);
    var ob = orderOfPage(b, pageOrder);
    return (oa == null ? Infinity : oa) - (ob == null ? Infinity : ob);
  });
  return list;
}

/**
 * 分组：{ folders: [{id, name, collapsed, pages}], loose: [...] }。
 * 指着不存在的夹的页落回散页区（读侧宽容，与服务端同一条规矩：分组从不决定
 * 一个页存不存在）。
 */
export function groupPages(input) {
  input = input || {};
  var pages = input.pages || [];
  var folders = input.folders || [];
  var pageFolders = input.pageFolders || {};
  var pageOrder = input.pageOrder || {};
  var sort = input.sort;

  var buckets = {};
  folders.forEach(function (folder) { buckets[folder.id] = []; });
  var loose = [];
  pages.forEach(function (page) {
    var id = folderOfPage(page, pageFolders);
    if (id && buckets[id]) buckets[id].push(page);
    else loose.push(page);
  });

  return {
    folders: folders.map(function (folder) {
      return {
        id: folder.id,
        name: folder.name || folder.id,
        collapsed: !!folder.collapsed,
        pages: sortInFolder(buckets[folder.id], sort, pageOrder)
      };
    }),
    loose: sortPages(loose, sort)
  };
}

/** 新夹的 id：名称能派生 slug 就用 slug，派生不出（中文名）或撞车就 folder-N。 */
export function nextFolderId(existingIds, name) {
  var taken = {};
  (existingIds || []).forEach(function (id) { taken[id] = true; });
  var slug = slugify(name);
  if (FOLDER_ID_PATTERN.test(slug) && !taken[slug]) return slug;
  for (var n = 1; ; n++) {
    var candidate = 'folder-' + n;
    if (!taken[candidate]) return candidate;
  }
}

/* ---- 「最近」段（2026-09-04 裁决 5c：最近打开，本地记录）----------------
   记录形状 [{id, at}]，最新在前，最多 RECENT_MAX 条。落 prefs.recentPages
   （localStorage），与登记表无关——「最近」是这台机器上的行为，不是页的属性。 */

export var RECENT_MAX = 5;

export function pushRecent(list, pageId, nowMs) {
  if (!pageId) return (list || []).slice(0, RECENT_MAX);
  var rest = (list || []).filter(function (row) { return row && row.id !== pageId; });
  return [{ id: pageId, at: nowMs }].concat(rest).slice(0, RECENT_MAX);
}

/** 记录 → 可渲染的行：只留还存在的页，带上打开时刻（行尾相对时间用它，不是 mtime）。 */
export function recentRows(list, pages) {
  var byId = {};
  (pages || []).forEach(function (page) { byId[page.id] = page; });
  var out = [];
  (list || []).forEach(function (row) {
    if (!row || !byId[row.id]) return;
    out.push({ page: byId[row.id], at: row.at });
  });
  return out.slice(0, RECENT_MAX);
}

/* 页面类型 → 图标（owner 2026-09-05 定的映射，与横条类型标同一套词，见
   board-entries.js ENTRY_TAG_LABELS）：画布 = 目录条目 board ios（多屏排在画布上）
   → smartphone；文档 = 单份 HTML 或 board html → file-text；网页 = url 条目 → globe。
   每一行都有，不再有空槽——09-05 上午撤掉图标就是因为只给了 url / file 两种，
   目录条目没有，看起来「有的有有的没有」。混合页按默认打开的那个条目算，这里
   用 manifest page 的 mode；Component Library 内建页的 mode 钉在 pages.js COMPONENTS_PAGE。 */
export var PAGE_KIND_ICONS = { canvas: 'smartphone', doc: 'file-text', web: 'globe' };

export function pageKindKey(page) {
  if (!page) return 'doc';
  if (page.kind === 'url') return 'web';
  return page.mode === 'ios' ? 'canvas' : 'doc';
}

/** 页的显示名：重命名优先（prefs.pageNames），内建页（system）不参与重命名。 */
export function pageDisplayTitle(page, names) {
  if (!page) return '';
  var custom = names && names[page.id];
  if (!page.system && typeof custom === 'string' && custom.trim()) return custom.trim();
  return page.title || page.id;
}
