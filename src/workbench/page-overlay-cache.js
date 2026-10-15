// 页面浮层保留最近两份文档；标注保存未完成时暂缓淘汰。
export var MAX_PAGE_OVERLAYS = 2;
var seen = new WeakMap();
var clock = 0;
var retries = new WeakMap();

function framesOf(panel) {
  return Array.from(panel.querySelectorAll('[data-page-screen] iframe.wb-doc-frame[src]'));
}

function hidden(frame) {
  return !!frame.closest('[data-page-screen][data-doc-hidden]');
}

function saved(frame) {
  var api;
  try { api = frame.contentWindow && frame.contentWindow.pinpoint; } catch (e) { return false; }
  // 页面还在加载时不能把它当成已保存；之后的重试会再读一次。
  if (!api || typeof api.getState !== 'function') return false;
  // closeComposer 会提交草稿，沿用用户关标注框时的保存流程。
  if (api.hasActiveDraft()) api.cancelDraft();
  var s = api.getState();
  return !s.routing && !s.syncing && !s.outbox && !s.lastRectPending && !s.syncError && !api.hasActiveDraft();
}

function trim(panel) {
  if (retries.has(panel)) { clearTimeout(retries.get(panel)); retries.delete(panel); }
  if (!panel.isConnected) return;
  var frames = framesOf(panel);
  var extra = frames.length - MAX_PAGE_OVERLAYS;
  if (extra <= 0) return;
  var candidates = frames.filter(hidden).sort(function (a, b) { return (seen.get(a) || 0) - (seen.get(b) || 0); });
  // 每次重试都重读可见状态与 LRU，迟到的保存不会卸掉重新打开的文档。
  for (var frame of candidates) {
    if (extra <= 0) break;
    if (!saved(frame)) break;
    frame.removeAttribute('src');
    try { frame.contentWindow.location.replace('about:blank'); } catch (e) { /* 已卸载 */ }
    seen.delete(frame);
    extra--;
  }
  if (extra > 0) retries.set(panel, setTimeout(function () { trim(panel); }, 100));
}

export function touchPageOverlayFrame(panel, frame) {
  if (frame) seen.set(frame, ++clock);
  trim(panel);
}
