// 就绪轮询的基础件（C1，r2 D7）：仍然需要轮询的地方统一用它，不再各写各的
// setTimeout / setInterval 循环。纯逻辑、不碰 DOM（src/shared 会内联进注入端
// bundle 的那份约束照旧成立；本文件只被需要轮询的一方 import）。
//
//   resolve(true)  —— test() 为真；
//   reject         —— 超过 deadline 还没真（错误信息带 what 与等待时长）；
//   reject         —— signal 中止（reason 透传，缺省 AbortError）。
//
// 轮询是兜底不是首选：等得到主动信号（promise、事件、postMessage）的地方优先等信号。

/**
 * @param {() => boolean} test 轮询谓词；抛错按未就绪处理。
 * @param {number} [interval=50] 轮询间隔 ms。
 * @param {number} [deadline=10000] 超时 ms。
 * @param {AbortSignal} [signal] 取消信号；abort 时 reject（reason 透传）。
 * @param {string} [what='条件'] 等待目标的可读描述，进超时与取消的错误信息。
 * @returns {Promise<boolean>}
 */
export function waitFor({ test, interval = 50, deadline = 10_000, signal, what = '条件' } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof test !== 'function') {
      reject(new Error(`waitFor: ${what} — test 必须是函数`));
      return;
    }
    const started = Date.now();
    let timer = 0;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = 0;
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const fail = (why) => {
      stop();
      reject(new Error(`waitFor: ${what} — ${why}（等了 ${Date.now() - started}ms）`));
    };
    const onAbort = () => {
      const reason = signal.reason instanceof Error ? signal.reason : new Error(`waitFor: ${what} — 已取消`);
      stop();
      reject(reason);
    };
    const tick = () => {
      timer = 0;
      let ok = false;
      try { ok = !!test(); } catch { ok = false; }
      if (ok) {
        stop();
        resolve(true);
        return;
      }
      if (Date.now() - started >= deadline) {
        fail('超时');
        return;
      }
      timer = setTimeout(tick, interval);
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
    }
    tick();
  });
}
