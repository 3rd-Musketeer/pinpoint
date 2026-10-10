// 每页视口偏好（scroll 位置 + canvas zoom）的读写，落在 prefs.pageViewports。
import { readPrefs, savePrefs } from './prefs.js';

/** 视口存档的键：存量页 = 页 id；多 tab 页（ADR 0041）每个 tab 各存一份滚动位置与缩放，键 = 页 id + '::' + tab id。
    activeBoard 是 store 里那份 { pageId, tabId, board }；板还没装载 / 换页途中就退回页 id。 */
export function viewportKey(pageId, activeBoard) {
  var tabs = activeBoard && activeBoard.pageId === pageId && activeBoard.board && activeBoard.board.tabs;
  if (tabs && tabs.length > 1 && activeBoard.tabId) return pageId + '::' + activeBoard.tabId;
  return pageId;
}

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
