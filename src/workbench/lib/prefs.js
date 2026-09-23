// Workbench 偏好存储：localStorage 单 key + 内存缓存。从 workbench.js 平移。
// savePrefs 是合并写。
var LS_KEY = 'pinpoint-wb';
var prefsCache;

export function readPrefs() {
  if (!prefsCache) {
    try { prefsCache = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
    catch (e) { prefsCache = {}; }
  }
  return prefsCache;
}

export function savePrefs(patch) {
  prefsCache = Object.assign({}, readPrefs(), patch);
  localStorage.setItem(LS_KEY, JSON.stringify(prefsCache));
  return prefsCache;
}

/* 「最近打开」（2026-09-04 裁决 5c）：本地记录，落同一份 prefs 的 recentPages。
   形状与封顶规则在 lib/page-groups.js（纯函数，可测）；这里只做读写。 */

export function readRecentPages() {
  var raw = readPrefs().recentPages;
  return Array.isArray(raw) ? raw.filter(function (row) { return row && typeof row.id === 'string'; }) : [];
}

export function saveRecentPages(list) {
  savePrefs({ recentPages: list });
  return list;
}
