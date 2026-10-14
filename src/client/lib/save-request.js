/**
 * POST /save for both annotation clients (canvas `annotate.js`, article prose `prose-comments.js`).
 *
 * Every save goes out with `keepalive` when the body is small enough, so a save
 * that is still in flight when the page is closed or navigated away still reaches
 * the server. Browsers cap all in-flight keepalive bodies of a page at 64 KiB in
 * total; a body above KEEPALIVE_MAX_BYTES is sent without it (leaves room for two
 * at once). If the browser refuses the keepalive request (quota), it is retried
 * once as a plain fetch.
 */

export const KEEPALIVE_MAX_BYTES = 30000;

export function byteLength(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length * 3;
}

/**
 * One id per POST /save. A snapshot sent while leaving the page names the save
 * still in flight as `after`, so the server accepts it whichever of the two
 * arrives first (annotation-store `save`, docs/annotation.md).
 */
export function newSaveId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Request options for one save body (a JSON string). */
export function saveInit(text) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text };
  if (byteLength(text) <= KEEPALIVE_MAX_BYTES) init.keepalive = true;
  return init;
}

/** POST <server>/save → { ok, status, data }. `fetchFn` is for tests. */
export function postSave(server, body, fetchFn = fetch) {
  const init = saveInit(JSON.stringify(body));
  const send = (options) => fetchFn(server + '/save', options);
  return send(init)
    .catch((error) => {
      if (!init.keepalive) throw error;
      const plain = { ...init };
      delete plain.keepalive;
      return send(plain);
    })
    .then((r) => r.json().then((data) => ({ ok: r.ok, status: r.status, data })));
}

/**
 * Calls `onLeave` when the page is being left: `pagehide`, and `visibilitychange`
 * to hidden (the last event mobile browsers reliably fire). Both can fire for one
 * departure; `onLeave` must be cheap to call twice.
 */
export function onPageLeave(onLeave) {
  window.addEventListener('pagehide', onLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onLeave();
  });
}
