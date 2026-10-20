// 工作台的 SSE 连接转给嵌在画布里的页面（2026-10-15 活的 HTML 卡片）。文章画布上每张卡片是一份带标注客户端的
// 页面，各开一条 /events 会让连接数跟着卡片数涨（HTTP/1.1 同源只有 6 条，第 7 条起请求全堵住）。所以卡片的
// iframe 带 data-pp-parent-events，里面的标注客户端不自己连，订阅这里（window.workbench.subscribeEvents）。
import { registerEmbedPark } from './embed-park.js';

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

/** 工作台唯一的 /events 连接：开合、停驻（E2）归这里。annotations 推送经
 *  onAnnotations 交回调用方（左栏刷计数与时间），停驻恢复时补一次 onResume
 *  （推送断档期间左栏落下的刷新）。返回退订函数（React effect 清理用）。 */
export function startServerEvents(onAnnotations, onResume) {
  var source = null;
  var parked = false;
  function connect() {
    if (source) return;
    source = new EventSource('/events');
    source.onopen = function () { setServerEventsOnline(true); };
    source.onerror = function () { if (source && source.readyState !== EventSource.OPEN) setServerEventsOnline(false); };
    source.addEventListener('annotations', function (ev) {
      if (parked) return;
      emitServerEvent('annotations', ev.data);
      if (onAnnotations) onAnnotations(ev.data);
    });
  }
  function disconnect() {
    if (!source) return;
    source.close();
    source = null;
    setServerEventsOnline(false);
  }
  var releasePark = registerEmbedPark({
    pause: function () { parked = true; disconnect(); },
    resume: function () { parked = false; connect(); if (onResume) onResume(); },
  });
  connect();
  return function () { releasePark(); disconnect(); };
}
