// annotate 客户端的就绪信号（C1）：src/client/annotate.js 初始化完成时 dispatch
// 'pinpoint:ready'（同一文档），嵌在 iframe 里时再向父级 postMessage 一条
// 'pinpoint-annotate' ready（父级按 event.source 认帧；postMessage 排队投递，
// 父级监听挂得晚也收得到）。工作台的绑定方（ann-bridge / live-cards）认这条消息。
var ANNOTATE_READY_SOURCE = 'pinpoint-annotate';

export function isAnnotateReadyMessage(data) {
  return !!data && typeof data === 'object'
    && data.source === ANNOTATE_READY_SOURCE
    && data.type === 'ready';
}
