// 文章的模块脚本与注入 IIFE 各打包一次本模块，读取状态放在同一个 window 上才能共用。
const CACHE = Symbol.for('pinpoint.ledger-reader');
function book(server, entry, name) {
  const url = new URL('/annotations/' + encodeURIComponent(name) + '?entry=' + encodeURIComponent(entry),
    server || globalThis.location?.href || 'http://localhost/').href;
  const cache = globalThis[CACHE] || (globalThis[CACHE] = new Map());
  if (!cache.has(url)) cache.set(url, {});
  return { url, state: cache.get(url) };
}

function accept(state, doc) {
  if (!state.doc || (Number(doc.revision) || 0) >= (Number(state.doc.revision) || 0)) state.doc = doc;
  return state.doc;
}

/** SSE 先于 GET 到达时，所有读取方都拿到较新的 revision。name 用原账本名。 */
export function rememberLedgerDocument(server, entry, name, doc) {
  return accept(book(server, entry, name).state, doc);
}

/** 首读共用在途请求或结果；重连、返回文章与关浮层显式 refresh，重新向磁盘取一版。
 * refresh 不复用更早发出的请求，免得断线前的旧请求漏掉断线期间的改动。 */
export function readLedgerDocument(server, entry, name, refresh = false) {
  const { url, state } = book(server, entry, name);
  if (!refresh) {
    if (state.pending) return state.pending;
    if (state.doc) return Promise.resolve(state.doc);
  }
  const pending = fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
    .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
    .then((doc) => accept(state, doc))
    .finally(() => { if (state.pending === pending) state.pending = null; });
  state.pending = pending;
  return pending;
}
