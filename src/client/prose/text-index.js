/* 正文→规范化文本的索引。块元素边界算一处空白，再交给 normalizeWhitespace：
 * 两个 CJK 字之间的空白算没有，其余连成一个空格。画布卡片、图、脚本、错误条不进文本，但记下卡片在文本里的位置。
 * 导出 buildTextIndex、rangeToOffsets、sectionOfNode、sectionAtFor、offsetsToSegments、SKIP_SELECTOR。 */

import { normalizeWhitespace } from '../../shared/text-quote.js';

export var SKIP_SELECTOR = 'script,style,noscript,template,textarea,[data-pp-canvas],[data-pp-figure],[data-pp-nocomment],.errors';
var BLOCK_TAGS = /^(P|H[1-6]|LI|UL|OL|DL|DT|DD|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|FIGURE|FIGCAPTION|HR|BR)$/;

/** 正文 → 规范化文本 + 每个文本节点的偏移表（map[k] = 该节点第 k 个字符在规范化文本里的位置）。 */
export function buildTextIndex(root) {
  var raw = '';
  var entries = [];
  var cards = [];
  function walk(el) {
    for (var child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        entries.push({ node: child, at: raw.length });
        raw += child.data;
      } else if (child.nodeType === 1) {
        // 画布卡片不进文本，但记下它在文本里的位置：右栏把这一节的画布标注排在这里。
        if (child.matches('[data-pp-canvas]')) cards.push({ el: child, at: raw.length });
        if (child.matches(SKIP_SELECTOR)) continue;
        var block = BLOCK_TAGS.test(child.tagName);
        if (block) raw += ' ';
        walk(child);
        if (block) raw += ' ';
      }
    }
  }
  walk(root);
  var norm = normalizeWhitespace(raw);
  var nodes = entries.map(function (e) {
    var len = e.node.data.length;
    var map = norm.map.slice(e.at, e.at + len + 1);
    return { node: e.node, start: map[0], end: map[len], map: map };
  });
  return {
    text: norm.text,
    nodes: nodes,
    cards: cards.map(function (c) { return { el: c.el, offset: norm.map[Math.min(c.at, norm.map.length - 1)] }; }),
  };
}

export function sectionOfNode(node) {
  var el = node.parentElement && node.parentElement.closest('[data-section]');
  return el ? el.getAttribute('data-section') || '' : '';
}

export function sectionAtFor(index) {
  return function (offset) {
    for (var i = 0; i < index.nodes.length; i++) {
      var n = index.nodes[i];
      if (offset < n.end) return sectionOfNode(n.node);
    }
    return '';
  };
}

/** DOM 选区 → 规范化文本上的 [start, end)；选区不碰正文返回 null。导出只给 e2e/prose-text-index.spec.js。 */
export function rangeToOffsets(range, index) {
  var start = null;
  var end = null;
  for (var i = 0; i < index.nodes.length; i++) {
    var n = index.nodes[i];
    if (!range.intersectsNode(n.node)) continue;
    var a = n.node === range.startContainer ? n.map[Math.min(range.startOffset, n.map.length - 1)] : n.map[0];
    var b = n.node === range.endContainer ? n.map[Math.min(range.endOffset, n.map.length - 1)] : n.map[n.map.length - 1];
    if (start === null) start = a;
    end = b;
  }
  return start === null || end === null || end <= start ? null : { start: start, end: end };
}

/** 规范化区间 → 各文本节点上的原文区间 [{ entry, from, to }]。 */
export function offsetsToSegments(start, end, index) {
  var out = [];
  for (var i = 0; i < index.nodes.length; i++) {
    var n = index.nodes[i];
    if (n.end <= start || n.start >= end) continue;
    var s = Math.max(start, n.start);
    var e = Math.min(end, n.end);
    if (s >= e) continue;
    var len = n.map.length - 1;
    var from = 0;
    while (from < len && n.map[from + 1] <= s) from += 1;
    var to = from + 1;
    while (to < len && n.map[to] < e) to += 1;
    if (to > from) out.push({ entry: n, from: from, to: to });
  }
  return out;
}
