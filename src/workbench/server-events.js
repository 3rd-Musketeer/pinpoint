// 工作台的 SSE 连接转给嵌在画布里的页面（2026-10-15 活的 HTML 卡片）。文章画布上每张卡片是一份带标注客户端的
// 页面，各开一条 /events 会让连接数跟着卡片数涨（HTTP/1.1 同源只有 6 条，第 7 条起请求全堵住）。所以卡片的
// iframe 带 data-pp-parent-events，里面的标注客户端不自己连，订阅这里（window.workbench.subscribeEvents）。
// 连接本身还是左栏那一条（app/Sidebar.jsx），它把开合与 annotations 推送报到这里。
var online = false;
var listeners = new Set();

function deliver(fn, msg) {
  // 订阅方活在卡片的 iframe 里：卡片卸掉、板重装后它的函数可能已经调不动，调不动就摘掉。
  try { fn(msg); } catch (e) { listeners.delete(fn); }
}

export function setServerEventsOnline(on) {
  on = !!on;
  if (on === online) return;
  online = on;
  listeners.forEach(function (fn) { deliver(fn, { type: 'status', online: online }); });
}

/** type = SSE 事件名，data = 原始字符串（订阅方自己 JSON.parse）。 */
export function emitServerEvent(type, data) {
  listeners.forEach(function (fn) { deliver(fn, { type: type, data: data }); });
}

/** 订阅；先同步送一次当前连接状态。返回退订函数。 */
export function subscribeServerEvents(fn) {
  if (typeof fn !== 'function') return function () {};
  listeners.add(fn);
  deliver(fn, { type: 'status', online: online });
  return function () { listeners.delete(fn); };
}
