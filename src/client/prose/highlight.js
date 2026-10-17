/* 正文高亮。按规范化区间把原文拆成 <mark.pp-hl>，同一段文字可被多条覆盖（data-ids 列全部）。
 * 导出 unpaint、paintSegments。依赖 offsetsToSegments（prose/text-index.js）。 */

import { offsetsToSegments } from './text-index.js';

var MARK_CLASS = 'pp-hl';

export function unpaint(root) {
  var marks = root.querySelectorAll('mark.' + MARK_CLASS);
  var parents = new Set();
  for (var i = 0; i < marks.length; i++) {
    var m = marks[i];
    var parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parents.add(parent);
  }
  parents.forEach(function (p) { p.normalize(); });
}

/** items: [{ id, start, end, draft? }]，同一段文字可被多条覆盖（data-ids 列全部）。 */
export function paintSegments(index, items) {
  var byNode = new Map();
  items.forEach(function (item) {
    offsetsToSegments(item.start, item.end, index).forEach(function (seg) {
      if (!byNode.has(seg.entry)) byNode.set(seg.entry, []);
      byNode.get(seg.entry).push({ from: seg.from, to: seg.to, id: item.id, draft: !!item.draft });
    });
  });
  byNode.forEach(function (spans, entry) {
    var node = entry.node;
    var raw = node.data;
    var cuts = new Set([0, raw.length]);
    spans.forEach(function (s) { cuts.add(s.from); cuts.add(s.to); });
    var points = Array.from(cuts).sort(function (a, b) { return a - b; });
    var frag = document.createDocumentFragment();
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i];
      var b = points[i + 1];
      if (a === b) continue;
      var piece = raw.slice(a, b);
      var covering = spans.filter(function (s) { return s.from <= a && s.to >= b; });
      if (!covering.length) {
        frag.appendChild(document.createTextNode(piece));
        continue;
      }
      var mark = document.createElement('mark');
      mark.className = MARK_CLASS + (covering.some(function (s) { return s.draft; }) ? ' draft' : '');
      mark.setAttribute('data-ids', covering.map(function (s) { return s.id; }).join(' '));
      mark.textContent = piece;
      frag.appendChild(mark);
    }
    node.parentNode.replaceChild(frag, node);
  });
}
