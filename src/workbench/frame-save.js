// 页面浮层和活卡片回收同一条规则：先提交草稿，只有客户端明确确认落盘才卸载。
export function frameReadyToUnload(frame) {
  try {
    var api = frame.contentWindow && frame.contentWindow.pinpoint;
    if (!api || typeof api.getState !== 'function') return false;
    if (api.hasActiveDraft()) api.cancelDraft();
    var s = api.getState();
    return s.unsynced === false && !s.routing && !s.syncing && !s.outbox &&
      !s.lastRectPending && !s.syncError && !api.hasActiveDraft();
  } catch (e) { return false; }
}
