// Pages 排序与相对时间（2026-08-17g）：纯函数，Sidebar 消费。
// 排序档：default（manifest + registry 书写顺序）→ updated（内容 mtime 倒序，
// 无 mtime 的页保持原相对顺序沉底）→ name（标题 locale 排序）。一档只回答
// 一个问题；「最近活跃（含标注）」是另一个档，不在此列（见 backlog）。
export var PAGE_SORTS = ['default', 'updated', 'name'];

export var PAGE_SORT_LABELS = {
  default: '默认',
  updated: '最近更新',
  name: '名称'
};

export function nextPageSort(current) {
  var i = PAGE_SORTS.indexOf(current);
  return PAGE_SORTS[(i + 1) % PAGE_SORTS.length] || PAGE_SORTS[0];
}

export function normalizePageSort(value) {
  return PAGE_SORTS.indexOf(value) >= 0 ? value : 'default';
}

export function sortPages(pages, sort) {
  var list = pages.slice();
  if (sort === 'updated') {
    // Array.prototype.sort 是稳定排序：无 mtime（0）的页按原顺序沉底。
    list.sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
  } else if (sort === 'name') {
    list.sort(function (a, b) {
      return String(a.title || a.id).localeCompare(String(b.title || b.id), 'zh');
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
