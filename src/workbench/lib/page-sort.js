// 页面时间排序：添加、源文件修改、标注变动独立记录；最近取三者最大值。
export var PAGE_SORT_GROUPS = [
  ['name', 'name-desc'],
  ['added', 'added-asc'],
  ['updated', 'updated-asc'],
  ['annotated', 'annotated-asc'],
  ['default']
];
export var PAGE_SORTS = PAGE_SORT_GROUPS.flat();
export var PAGE_SORT_LABELS = {
  default: '手动排序',
  name: '名称（A–Z）',
  'name-desc': '名称（Z–A）',
  added: '添加时间（从新到旧）',
  'added-asc': '添加时间（从旧到新）',
  updated: '最后修改时间（从新到旧）',
  'updated-asc': '最后修改时间（从旧到新）',
  annotated: '最后标注时间（从新到旧）',
  'annotated-asc': '最后标注时间（从旧到新）'
};

export function normalizePageSort(value) {
  return PAGE_SORTS.indexOf(value) >= 0 ? value : 'default';
}

export function sortPages(pages, sort) {
  var list = pages.slice();
  var basis = sort?.split('-')[0];
  if (['added', 'updated', 'annotated'].includes(basis)) {
    list.sort(function (a, b) {
      var at = pageTime(a, basis), bt = pageTime(b, basis);
      // Unknown times stay last in either direction; ties retain their order.
      if (!at || !bt) return at ? -1 : bt ? 1 : 0;
      return sort.endsWith('-asc') ? at - bt : bt - at;
    });
  } else if (basis === 'name') {
    list.sort(function (a, b) {
      var comparison = String(a.title || a.id).localeCompare(String(b.title || b.id), 'zh');
      return sort === 'name-desc' ? -comparison : comparison;
    });
  }
  return list;
}

// 相对时间（2026-09-05 对齐评审板 C1 的写法）：<1m「刚刚」→ <60m「N 分钟前」
// → <24h「N 小时前」→ 昨天「昨天」→ <7d「周X」→ 同年「M-D」→ 跨年「YYYY-M-D」。
// 行尾只有一格 mono 小字的宽度，最长是「23 小时前」。
var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function formatRelativeTime(mtimeMs, nowMs) {
  var diff = Math.max(0, nowMs - mtimeMs);
  var minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + ' 分钟前';
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  var date = new Date(mtimeMs);
  var now = new Date(nowMs);
  var dayStart = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  var dayDiff = Math.round((dayStart(now) - dayStart(date)) / 86400000);
  if (dayDiff <= 1) return '昨天';
  if (dayDiff < 7) return WEEKDAYS[date.getDay()];
  var md = (date.getMonth() + 1) + '-' + date.getDate();
  if (date.getFullYear() === now.getFullYear()) return md;
  return date.getFullYear() + '-' + md;
}

export function pageTime(page, sort) {
  sort = sort?.split('-')[0];
  if (sort === 'added') return page.addedAt || 0;
  if (sort === 'updated') return page.mtime || 0;
  if (sort === 'annotated') return page.annotatedAt || 0;
  return Math.max(page.addedAt || 0, page.mtime || 0, page.annotatedAt || 0);
}

export function activityRows(pages) {
  return pages.map(page => ({ page, at: pageTime(page) })).filter(row => row.at > 0)
    .sort((a, b) => b.at - a.at).slice(0, 5);
}
