/** GET 的正常 req.close 不表示响应断连；只看 aborted 和响应未结束时的 close。 */
export function requestSignal(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!res.writableEnded) abort(); };
  req.on('aborted', abort);
  res.on('close', close);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    dispose() { req.off?.('aborted', abort); res.off?.('close', close); },
  };
}

export function waitForRequest(task, signal) {
  if (!signal) return task;
  if (signal.aborted) return Promise.reject(new DOMException('请求已断开', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('请求已断开', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
