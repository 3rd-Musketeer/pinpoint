/* 改 owner 写的话。点第一句或后续回复进原地编辑，⌘/Ctrl+Enter 或点卡外面保存，Esc 取消。
 * 画布标注开头全是目标记号时只改后面的文字，记号原样接回。导出 createEdit。 */

import { canvasContentHasTargets, canvasContentText, canvasLeadingEdit } from '../../shared/prose-thread.js';
import {
  editAreaOf,
  editFieldText,
  growEdit,
  setEditFieldSelection,
} from './edit-field.js';

export function createEdit(opts) {
  var rail = opts.rail;
  var state = opts.state;
  var sync = opts.sync;
  var hooks = opts.hooks;

  /** 编辑键 → { canvas, id, index }。index 是 messages 的下标；没有就是第一句（content）。 */
  function parseEditKey(key) {
    var canvasRow = key.indexOf('c:') === 0;
    var rest = canvasRow ? key.slice(2) : key;
    var at = rest.lastIndexOf('/m');
    var index = at >= 0 ? Number(rest.slice(at + 2)) : NaN;
    return {
      canvas: canvasRow,
      id: at >= 0 && Number.isInteger(index) ? rest.slice(0, at) : rest,
      index: Number.isInteger(index) ? index : null,
    };
  }

  /** 这句现在的原文，和编辑框里的一致。画布标注开头有目标记号时，原文是记号后面的文字。 */
  function editOriginalText(key) {
    var parsed = parseEditKey(key);
    var list = parsed.canvas ? sync.canvas.rows() : state.rows;
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || String(list[i].id) !== parsed.id) continue;
      if (parsed.index != null) {
        var messages = Array.isArray(list[i].messages) ? list[i].messages : [];
        var message = messages[parsed.index];
        return message && message.who === 'owner' ? String(message.text || '') : null;
      }
      if (!parsed.canvas) return String(list[i].content || '');
      var leading = canvasLeadingEdit(list[i].content);
      // 框里的字保存前会 trim。原文按同一条比，尾部空白不算改过。
      return leading ? leading.text.trim() : canvasContentText(list[i]);
    }
    return null;
  }

  /** 画布标注开头的记号接回 content。记号不在开头（夹在文字里）时不改，免得把记号换成字面文字。 */
  function canvasStoredContent(id, text) {
    var row = sync.findCanvasRow(id);
    if (!row) return text;
    var leading = canvasLeadingEdit(row.content);
    if (leading) return leading.prefix + text;
    if (canvasContentHasTargets(row)) return null;
    return text;
  }

  function startEdit(key) {
    if (state.editingId === key) return;
    if (state.editingId != null) finishEdit(); // 换一张卡编辑：等于点了手里那张的外面，先保存
    if (hooks.hold) hooks.hold(key.indexOf('c:') === 0 ? key : key.split('/m')[0]);
    state.editingId = key;
    hooks.renderRail();
    var area = editAreaOf(rail, key);
    if (!area) { state.editingId = null; return; }
    growEdit(area);
    // 先把光标放到末尾再聚焦。反过来：focus 时光标还在开头，浏览器会把页面滚到那里，
    // preventScroll 也压不住。卡片顶对齐引文，框在视口外时只滚到框，不滚整张卡。
    var len = editFieldText(area).length;
    setEditFieldSelection(area, len, len);
    area.focus({ preventScroll: true });
    if (hooks.reveal) hooks.reveal(area.closest('.pp-thread'), area);
  }

  /** 收束编辑：写了新字就入队 edit（onChange 会重画），清空或没改就恢复原文，框不在了只退出。 */
  function finishEdit() {
    var key = state.editingId;
    if (key == null) return;
    state.editingId = null;
    var area = editAreaOf(rail, key);
    var value = area ? editFieldText(area) : state.editText[key];
    delete state.editText[key];
    if (value == null) return;
    var text = String(value).trim();
    if (!text || text === editOriginalText(key)) { hooks.renderRail(); return; } // 清空不删评论；没改不落账本
    var parsed = parseEditKey(key);
    var content = text;
    if (parsed.canvas && parsed.index == null) {
      content = canvasStoredContent(parsed.id, text);
      if (content == null) { hooks.renderRail(); return; }
    }
    var op = parsed.index != null
      ? { op: 'edit', id: parsed.id, index: parsed.index, text: text }
      : { op: 'edit', id: parsed.id, content: content };
    if (parsed.canvas) sync.canvas.enqueue(op);
    else hooks.enqueue(op);
  }

  /** Esc：丢开编辑框，恢复原文。 */
  function cancelEdit() {
    var key = state.editingId;
    if (key == null) return;
    state.editingId = null;
    delete state.editText[key];
    hooks.renderRail();
  }

  return { parseEditKey: parseEditKey, startEdit: startEdit, finishEdit: finishEdit, cancelEdit: cancelEdit };
}
