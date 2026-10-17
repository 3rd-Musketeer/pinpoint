/* 右栏重画。按引文位置排正文评论、按卡片位置穿插画布标注，重画前后保住输入框和编辑框的字与光标。
 * 导出 createRail。依赖 html.js 的卡片片段和 edit-field.js 的光标读写。 */

import { canvasRailItems, railOrder } from '../../shared/prose-thread.js';
import { canvasThreadHtml, draftHtml, esc, threadHtml } from './html.js';
import {
  editAreaOf,
  editFieldSelection,
  editFieldText,
  growEdit,
  railArea,
  setEditFieldSelection,
  setEditFieldText,
} from './edit-field.js';

export function createRail(opts) {
  var rail = opts.rail;
  var root = opts.root;
  var state = opts.state;
  var sync = opts.sync;
  var hooks = opts.hooks;

  function renderRail() {
    // value 和选区不能恢复浏览器的 composition 会话；所有更新合并到组字结束后重画。
    if (state.composingArea && state.composingArea.isConnected) { state.railDirty = true; return; }
    state.railDirty = false;
    // 重画前记下输入框的内容与光标，重画后放回（SSE 推来 agent 回复时正在打字）。
    var keep = {};
    var active = document.activeElement;
    var areas = rail.querySelectorAll('textarea[data-reply]');
    for (var i = 0; i < areas.length; i++) {
      var key = areas[i].getAttribute('data-reply');
      keep[key] = {
        value: areas[i].value,
        focus: areas[i] === active,
        start: areas[i].selectionStart,
        end: areas[i].selectionEnd,
      };
      if (key !== '__draft') {
        if (areas[i].value) state.replyText[key] = areas[i].value;
        else delete state.replyText[key];
      }
    }
    var keepEdit = {};
    var editAreas = rail.querySelectorAll('textarea.pp-edit[data-edit], .pp-body.pp-edit[data-edit]');
    for (var j = 0; j < editAreas.length; j++) {
      var range = editFieldSelection(editAreas[j]);
      keepEdit[editAreas[j].getAttribute('data-edit')] = {
        value: editFieldText(editAreas[j]),
        focus: editAreas[j] === active,
        start: range.start,
        end: range.end,
      };
    }
    // 一列：正文评论按引文位置，画布标注按所属卡片的位置（排在紧跟卡片的那段正文之前），同位按 #n。
    var canvasItems = sync.canvas ? canvasRailItems(sync.canvas.rows(), hooks.canvasCards()) : [];
    var entries = state.rows.map(function (row) { return { kind: 'prose', row: row, n: row.n, key: hooks.orderKey(row) }; })
      .concat(canvasItems.map(function (item) {
        var at = state.cardOffsets.has(item.section) ? state.cardOffsets.get(item.section) - 0.5 : Infinity;
        return { kind: 'canvas', item: item, n: item.row.n, key: at };
      }));
    var ordered = railOrder(entries, function (e) { return e.key; });
    var list = '';
    var draftPlaced = false;
    var draftKey = state.draft ? state.draft.start : Infinity;
    var view = hooks.view();
    ordered.forEach(function (e) {
      if (state.draft && !draftPlaced && e.key > draftKey) { list += draftHtml(state.draft); draftPlaced = true; }
      list += e.kind === 'canvas' ? canvasThreadHtml(e.item, view) : threadHtml(e.row, view);
    });
    if (state.draft && !draftPlaced) list += draftHtml(state.draft);
    var empty = !ordered.length && !state.draft
      ? '<p class="empty-rail">选中正文里的一段文字，点“评论”。</p>'
      : '';
    var note = sync.connection() === 'offline'
      ? '未连接 pinpoint 服务，评论暂时存不下。'
      : (sync.prose.error() || (sync.canvas && sync.canvas.error()) || '');
    rail.innerHTML = '<div class="pp-rail-head"><div class="label">评论</div></div>'
      + '<div class="pp-threads">' + list + '</div>' + empty
      + '<p class="pp-rail-note" role="status">' + esc(note) + '</p>';
    Object.keys(keep).forEach(function (id) {
      var area = railArea(rail, id);
      if (!area) return;
      area.value = keep[id].value;
      if (keep[id].focus) {
        area.focus();
        try { area.setSelectionRange(keep[id].start, keep[id].end); } catch (e) { /* */ }
      }
    });
    // 编辑框：放回重画前的字与光标（没有旧字就是渲染时带上的原文），再按内容长高。
    // 框没了（SSE 推来状态改动把线程收成了行）：字收进 editText，别跟着框一起丢。
    Object.keys(keepEdit).forEach(function (id) {
      var area = editAreaOf(rail, id);
      if (!area) {
        if (state.editingId === id && keepEdit[id].value) state.editText[id] = keepEdit[id].value;
        return;
      }
      setEditFieldText(area, keepEdit[id].value);
      if (keepEdit[id].focus) {
        area.focus();
        setEditFieldSelection(area, keepEdit[id].start, keepEdit[id].end);
      }
      growEdit(area);
    });
    // 刚展开的回复框：放回框收起前留下的草稿。
    state.replyOpen.forEach(function (id) {
      var area = railArea(rail, id);
      if (area && !area.value && state.replyText[id]) area.value = state.replyText[id];
    });
    Object.keys(sync.restoreText).forEach(function (id) {
      var area = railArea(rail, id);
      if (!area) return;
      area.value = area.value ? area.value + '\n' + sync.restoreText[id] : sync.restoreText[id];
      delete sync.restoreText[id];
    });
  }

  function focusThread(id, focusOpts) {
    state.focusedId = id;
    renderRail();
    hooks.syncFocusClasses();
    var t = rail.querySelector('.pp-thread[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (t && (!focusOpts || focusOpts.scroll !== false)) t.scrollIntoView({ block: 'nearest' });
    if (focusOpts && focusOpts.reveal) {
      var mark = root.querySelector('mark.pp-hl.on');
      if (mark) mark.scrollIntoView({ block: 'nearest' });
    }
  }

  return { renderRail: renderRail, focusThread: focusThread };
}
