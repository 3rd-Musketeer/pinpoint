// 文章画布上活的 HTML 卡片该装哪几张、卸哪几张（2026-10-15，owner：“预览的时候是交互模式，不然在画布上
// 看到并排 html 的时候没法比对”）。纯函数、DOM-free（node --test 直测）；DOM 一侧在 ../live-cards.js。
// 规则：
// - 进了舞台视野（含一圈余量）的卡片装上；看得见的卡片从不卸（正在比对的几页不能在人眼前清空）。
// - 装着的卡片超过 maxLive 时，从视野外、最久没看见的那张开始卸，卸到不超过为止。卸掉的卡片下次进视野重新装，
//   里面滚到哪、点了什么不保留。
// - 一次最多 maxConcurrent 张在装：缩小画布时十几张同时进视野，排队装，不让它们同时解析、同时出图。

export var MAX_LIVE_CARDS = 6;
export var MAX_CONCURRENT_LOADS = 2;

/**
 * cards: [{ id, visible, live, loading, seenAt }]（seenAt = 最近一次在视野里的时刻，越大越新）
 * → { load: [id…], unload: [id…] }。load 按传入顺序（画布上的先后），已在装的也算进并发数。
 */
export function planLiveCards(cards, options) {
  var maxLive = (options && options.maxLive) || MAX_LIVE_CARDS;
  var maxConcurrent = (options && options.maxConcurrent) || MAX_CONCURRENT_LOADS;
  var list = Array.isArray(cards) ? cards.filter(Boolean) : [];
  var loading = list.filter(function (c) { return c.loading; }).length;
  var load = [];
  list.forEach(function (c) {
    if (!c.visible || c.live || c.loading) return;
    if (loading + load.length >= maxConcurrent) return;
    load.push(c.id);
  });
  var liveCount = list.filter(function (c) { return c.live || c.loading; }).length + load.length;
  var unload = [];
  if (liveCount > maxLive) {
    list
      .filter(function (c) { return (c.live || c.loading) && !c.visible; })
      .sort(function (a, b) { return (a.seenAt || 0) - (b.seenAt || 0); })
      .forEach(function (c) {
        if (liveCount <= maxLive) return;
        unload.push(c.id);
        liveCount--;
      });
  }
  return { load: load, unload: unload };
}

/** 卡片 iframe 里的一点（它自己的 client 坐标）→ 工作台的 client 坐标。画布缩放是 transform，
    rect 是缩放后的框，layoutWidth 是 iframe 自己的宽（clientWidth）。 */
export function cardPointToParent(rect, layoutWidth, x, y) {
  var scale = layoutWidth > 0 ? rect.width / layoutWidth : 1;
  return { x: rect.left + x * scale, y: rect.top + y * scale };
}
