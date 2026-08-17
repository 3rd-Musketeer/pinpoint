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

// 相对时间：<1m「刚刚」→ <60m「Nm」→ <24h「Nh」→ <7d「Nd」→ 同年「MM-DD」
// → 跨年「YYYY-MM-DD」。行内只有 mono 小字一格的宽度，不出完整句子。
export function formatRelativeTime(mtimeMs, nowMs) {
  var diff = Math.max(0, nowMs - mtimeMs);
  var minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return minutes + 'm';
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h';
  var days = Math.floor(hours / 24);
  if (days < 7) return days + 'd';
  var date = new Date(mtimeMs);
  var now = new Date(nowMs);
  var mm = String(date.getMonth() + 1).padStart(2, '0');
  var dd = String(date.getDate()).padStart(2, '0');
  if (date.getFullYear() === now.getFullYear()) return mm + '-' + dd;
  return date.getFullYear() + '-' + mm + '-' + dd;
}
