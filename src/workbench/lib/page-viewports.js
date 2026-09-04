// 每页视口偏好（scroll 位置 + canvas zoom）的读写，落在 prefs.pageViewports。
import { readPrefs, savePrefs } from './prefs.js';

export function readPageViewports() {
  var raw = readPrefs().pageViewports;
  return raw && typeof raw === 'object' ? raw : {};
}

export function pageViewport(pageId) {
  var all = readPageViewports();
  return all[pageId] || null;
}

export function savePageViewport(pageId, patch) {
  if (!pageId) return;
  var all = Object.assign({}, readPageViewports());
  all[pageId] = Object.assign({}, all[pageId] || {}, patch);
  savePrefs({ pageViewports: all });
}
