// Workbench Frame Note 簇 — 每屏说明的读取/编辑/保存与板面板上的事件委托。
// P1a 从 workbench.js 平移（goal-20260810-workbench-react-rebuild）：零行为变化。
import { wbGet } from './app/store.js';
import { COMPONENTS_ID } from './lib/page-url.js';
import { refit } from './boot-prefs.js';

function frameNoteApiUrl(pageId, screenId) {
  return '/api/frame-notes/' + encodeURIComponent(pageId) + '/' + encodeURIComponent(screenId);
}

function frameNoteError(response, data) {
  var error = new Error((data && data.message) || ('Frame Note 请求失败 · ' + response.status));
  error.status = response.status;
  error.data = data || {};
  return error;
}

function readFrameNoteResponse(response) {
  return response.json().catch(function () { return {}; }).then(function (data) {
    if (!response.ok) throw frameNoteError(response, data);
    return data;
  });
}

function setFrameNoteStatus(noteEl, message, isError) {
  var status = noteEl.querySelector('[data-frame-note-status]');
  if (!status) return;
  status.textContent = message || '';
  status.classList.toggle('is-error', !!isError);
}

function setFrameNoteBusy(noteEl, busy) {
  noteEl.querySelectorAll('button, textarea').forEach(function (control) {
    control.disabled = !!busy;
  });
}

function closeFrameNoteEditor(noteEl) {
  var view = noteEl.querySelector('[data-frame-note-view]');
  var editor = noteEl.querySelector('[data-frame-note-editor]');
  if (view) view.hidden = false;
  if (editor) editor.hidden = true;
  noteEl.classList.remove('is-editing');
  setFrameNoteBusy(noteEl, false);
  setFrameNoteStatus(noteEl, '', false);
  refit();
}

function openFrameNoteEditor(noteEl) {
  var screen = noteEl.closest('[data-screen]');
  var screenId = screen && screen.getAttribute('data-screen');
  if (!screenId || wbGet().activePageId === COMPONENTS_ID) return;
  var edit = noteEl.querySelector('[data-frame-note-action="edit"]');
  if (edit) edit.disabled = true;
  noteEl.classList.add('is-loading');

  fetch(frameNoteApiUrl(wbGet().activePageId, screenId))
    .then(readFrameNoteResponse)
    .then(function (data) {
      if (!noteEl.isConnected) return;
      noteEl.dataset.frameNoteRevision = data.revision;
      var input = noteEl.querySelector('[data-frame-note-input]');
      var view = noteEl.querySelector('[data-frame-note-view]');
      var editor = noteEl.querySelector('[data-frame-note-editor]');
      if (input) input.value = data.note || '';
      if (view) view.hidden = true;
      if (editor) editor.hidden = false;
      noteEl.classList.add('is-editing');
      setFrameNoteStatus(noteEl, '⌘/Ctrl + Enter 保存', false);
      if (input) {
        input.focus();
        input.setSelectionRange(0, 0);
        input.scrollTop = 0;
      }
      refit();
    })
    .catch(function (error) {
      if (!noteEl.isConnected) return;
      if (edit) {
        edit.textContent = '重试';
        edit.title = error.message;
      }
    })
    .finally(function () {
      if (!noteEl.isConnected) return;
      noteEl.classList.remove('is-loading');
      if (edit) edit.disabled = false;
    });
}

function saveFrameNote(noteEl) {
  var screen = noteEl.closest('[data-screen]');
  var screenId = screen && screen.getAttribute('data-screen');
  var input = noteEl.querySelector('[data-frame-note-input]');
  var revision = noteEl.dataset.frameNoteRevision;
  if (!screenId || !input || !revision || wbGet().activePageId === COMPONENTS_ID) return;

  setFrameNoteBusy(noteEl, true);
  setFrameNoteStatus(noteEl, '正在保存…', false);
  fetch(frameNoteApiUrl(wbGet().activePageId, screenId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: input.value, baseRevision: revision })
  })
    .then(readFrameNoteResponse)
    .then(function (data) {
      if (!noteEl.isConnected) return;
      noteEl.dataset.frameNoteRevision = data.revision;
      var text = noteEl.querySelector('[data-frame-note-text]');
      var edit = noteEl.querySelector('[data-frame-note-action="edit"]');
      if (text) {
        text.textContent = data.note || '添加这一步的场景、交互或能力说明。';
        text.classList.toggle('wb-frame-note-placeholder', !data.note);
      }
      if (edit) {
        edit.textContent = data.note ? '编辑' : '＋ Frame Note';
        edit.title = '';
      }
      noteEl.classList.toggle('is-empty', !data.note);
      closeFrameNoteEditor(noteEl);
    })
    .catch(function (error) {
      if (!noteEl.isConnected) return;
      var message = error.status === 409
        ? 'board.json 已被修改；请保留当前文字，取消后重新打开再保存。'
        : error.message;
      setFrameNoteBusy(noteEl, false);
      setFrameNoteStatus(noteEl, message, true);
    });
}

export function wireFrameNoteEditors(panel) {
  if (!panel || panel.dataset.frameNotesWired === '1') return;
  panel.dataset.frameNotesWired = '1';
  panel.addEventListener('click', function (event) {
    var action = event.target.closest('[data-frame-note-action]');
    if (!action || !panel.contains(action)) return;
    event.preventDefault();
    event.stopPropagation();
    var noteEl = action.closest('[data-frame-note]');
    if (!noteEl) return;
    var kind = action.getAttribute('data-frame-note-action');
    if (kind === 'edit') openFrameNoteEditor(noteEl);
    else if (kind === 'cancel') closeFrameNoteEditor(noteEl);
    else if (kind === 'save') saveFrameNote(noteEl);
  });
  panel.addEventListener('keydown', function (event) {
    var input = event.target.closest('[data-frame-note-input]');
    if (!input || !panel.contains(input)) return;
    var noteEl = input.closest('[data-frame-note]');
    if (!noteEl) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFrameNoteEditor(noteEl);
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveFrameNote(noteEl);
    }
  });
}
