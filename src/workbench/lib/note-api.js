// Note API 客户端（2026-08-17 detail 面板）：frame/section note 的 GET/PUT 与
// baseRevision 冲突处理。note 的展示数据直接读 activeBoard（board.json 已在
// Query 缓存里），这里只在「进入编辑」时拉取 fresh revision、保存时回写。
// 画布行内编辑器（frame-notes.js）已随 note 收编右栏退役 —— 本模块是唯一消费端。
export function frameNoteUrl(pageId, screenId) {
  return '/api/frame-notes/' + encodeURIComponent(pageId) + '/' + encodeURIComponent(screenId);
}

export function sectionNoteUrl(pageId, sectionId) {
  return '/api/section-notes/' + encodeURIComponent(pageId) + '/' + encodeURIComponent(sectionId);
}

function noteError(response, data) {
  var error = new Error((data && data.message) || ('Note 请求失败，状态 ' + response.status));
  error.status = response.status;
  error.data = data || {};
  return error;
}

function readNoteResponse(response) {
  return response.json().catch(function () { return {}; }).then(function (data) {
    if (!response.ok) throw noteError(response, data);
    return data;
  });
}

export function fetchNote(url) {
  return fetch(url).then(readNoteResponse);
}

export function saveNote(url, note, baseRevision) {
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: note, baseRevision: baseRevision })
  }).then(readNoteResponse);
}
