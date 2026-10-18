/* 右栏卡片的纵向排版。纯函数：给定每张卡片的锚点高度、卡片高度、选中项，算出每张的 top。
 * 宽屏下卡片在右栏里绝对定位，目标高度等于锚点（正文引用的顶部，或所属画布卡片的顶部）。
 * 和上一张重叠就往下推，间距 gap。锚点缺失（null / Infinity）的紧跟上一张。
 * 选中的那张钉在锚点上：上面的卡片会和它重叠就依次往上挤，挤过 minTop 的叠在 minTop 处；下面的依次往下推。
 * 不读 DOM、不改传入数组。导出 placeRailCards。 */

/** 锚点用不上：失效、画布卡片不在正文里（key 是 Infinity）、没给。 */
function anchorMissing(anchor) {
  return anchor == null || !Number.isFinite(anchor);
}

/**
 * items: [{ id, anchor, height }]，已经按阅读顺序排好。
 * anchor 是目标高度（相对同一参照，通常是右栏内容的顶部）；缺失给 null 或 Infinity。
 * height 是卡片高度，含不了间距。activeId 是选中 / 正在编辑 / 正在回复的那张，没有就 null。
 * gap 是卡片之间的间距。
 * minTop 是选中项往上挤时最高能挤到哪（同一参照）。不给就是 0（栏顶）；
 * 页面里传文档顶部（负数）：选中的那张要留在锚点上，上面挤不下的可以越过栏顶往上排。
 * → [{ id, top }]，与 items 同序。
 */
export function placeRailCards(items, activeId, gap, minTop) {
  var list = Array.isArray(items) ? items : [];
  var space = Number.isFinite(gap) ? gap : 0;
  var ceiling = Number.isFinite(minTop) ? minTop : 0;
  var n = list.length;
  var tops = new Array(n);
  var cursor = 0;
  var i;
  for (i = 0; i < n; i++) {
    var anchor = list[i].anchor;
    var target = anchorMissing(anchor) ? cursor : anchor;
    tops[i] = Math.max(target, cursor);
    cursor = tops[i] + Math.max(0, list[i].height || 0) + space;
  }

  var active = -1;
  if (activeId != null) {
    for (i = 0; i < n; i++) {
      if (list[i].id === activeId && !anchorMissing(list[i].anchor)) { active = i; break; }
    }
  }
  if (active < 0) return list.map(function (item, k) { return { id: item.id, top: tops[k] }; });

  // 选中的钉在锚点上。上面的从紧贴它的位置往上排。
  tops[active] = list[active].anchor;
  var floor = tops[active];
  for (i = active - 1; i >= 0; i--) {
    var height = Math.max(0, list[i].height || 0);
    var above = tops[i + 1] - space - height;
    var want = anchorMissing(list[i].anchor) ? above : Math.min(tops[i], above);
    tops[i] = want;
    floor = Math.min(floor, want);
  }
  // 挤过 minTop 的不再下移整段：选中的那张必须留在锚点旁边（读者正在看它、在它里面打字）。
  // 挤不下的叠在 minTop 处，被选中的卡片盖住（样式给选中项更高的层级）。
  if (floor < ceiling) {
    for (i = 0; i < active; i++) tops[i] = Math.max(tops[i], ceiling);
  }
  cursor = tops[active] + Math.max(0, list[active].height || 0) + space;
  for (i = active + 1; i < n; i++) {
    var next = list[i].anchor;
    var place = anchorMissing(next) ? cursor : Math.max(next, cursor);
    tops[i] = place;
    cursor = tops[i] + Math.max(0, list[i].height || 0) + space;
  }
  return list.map(function (item, k) { return { id: item.id, top: tops[k] }; });
}
