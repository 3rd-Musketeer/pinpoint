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

