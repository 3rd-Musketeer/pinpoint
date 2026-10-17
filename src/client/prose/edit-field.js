/* 右栏编辑框的 DOM 读写。textarea 用 value / selectionStart；开头带目标记号的那句是行内可写 span，
 * 光标要在文本节点上数。导出 cssEscape、railArea、editAreaOf、editFieldText、setEditFieldText、
 * editFieldSelection、setEditFieldSelection、growEdit。 */

export function cssEscape(v) {
  return window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v);
}

export function railArea(rail, id) {
  return rail.querySelector('textarea[data-reply="' + cssEscape(id) + '"]');
}

export function editAreaOf(rail, key) {
  var id = cssEscape(key);
  return rail.querySelector('textarea.pp-edit[data-edit="' + id + '"], .pp-body.pp-edit[data-edit="' + id + '"]');
}

export function editFieldText(el) {
  if (!el) return '';
  return el.tagName === 'TEXTAREA' ? el.value : String(el.textContent || '');
}

export function setEditFieldText(el, value) {
  if (el.tagName === 'TEXTAREA') el.value = value;
  else el.textContent = value == null ? '' : String(value);
}

/** 光标在字段文字里的偏移。textarea 用 selectionStart；可写 span 只有文本节点。 */
export function editFieldSelection(el) {
  var text = editFieldText(el);
  if (el.tagName === 'TEXTAREA') return { start: el.selectionStart, end: el.selectionEnd };
  var sel = window.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return { start: text.length, end: text.length };
  var range = sel.getRangeAt(0);
  function at(node, off) {
    if (node === el) {
      var n = 0;
      for (var i = 0; i < off && i < el.childNodes.length; i++) n += el.childNodes[i].textContent.length;
      return n;
    }
    var total = 0;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var cur;
    while ((cur = walker.nextNode())) {
      if (cur === node) return total + off;
      total += cur.textContent.length;
    }
    return text.length;
  }
  return { start: at(range.startContainer, range.startOffset), end: at(range.endContainer, range.endOffset) };
}

export function setEditFieldSelection(el, start, end) {
  if (el.tagName === 'TEXTAREA') {
    try { el.setSelectionRange(start, end); } catch (e) { /* */ }
    return;
  }
  var node = el.firstChild;
  if (!node || node.nodeType !== 3) return;
  var len = node.textContent.length;
  var a = Math.max(0, Math.min(start, len));
  var b = Math.max(0, Math.min(end, len));
  try {
    var range = document.createRange();
    range.setStart(node, a);
    range.setEnd(node, b);
    var sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) { /* */ }
}

/** 块级 textarea 贴合内容：默认 rows 会比原文高一行，先按换行数给高，再收成 scrollHeight，打字时跟着长。
    开头带元素文字的那句是行内 span，高度随文字自己长，这里碰不到。 */
export function growEdit(area) {
  if (!area || area.tagName !== 'TEXTAREA') return;
  var lines = String(area.value || '').split('\n').length;
  area.rows = lines;
  area.style.height = 'auto';
  area.style.height = area.scrollHeight + 'px';
}
