/**
 * Runtime URL rebasing for proxied registry `url` entries (阶段 4 live 代理画中画).
 *
 * A proxied page lives under `/sites/<id>/` on the pinpoint origin, but its
 * own JS still issues absolute-path requests (`fetch('/api/...')`,
 * `new EventSource('/events')`, `new WebSocket('/ws')`, …) that no HTML
 * rewrite can reach. The injected bootstrap monkey-patches those APIs to
 * call these pure functions, rebasing any root-absolute URL onto the
 * `/sites/<id>` prefix so the request lands back on the proxy.
 *
 * The pinpoint annotate client's own API calls (loaded same-origin inside
 * the proxied page) must pass through untouched — they are exempted by an
 * explicit name list, not by guessing. Known blind spot: a target app whose
 * own root endpoints collide with the pinpoint API names below (`/save`,
 * `/events`, …) is NOT rebased and will hit pinpoint instead — rename the
 * entry or the app route in that case.
 *
 * Isomorphic: no DOM / node deps. The browser bootstrap inlines this file
 * (src/server/lib/site-proxy.js reads it and strips the `export ` keywords, the
 * same pattern as /annotate.js); node tests import it directly.
 */

// pinpoint-owned root endpoints used by the in-page annotate client
// (src/client/annotate.js): /save, /image, /annotations[/<page>], /images/<name>,
// /events (SSE), /annotate.js. /sites/ covers every already-rebased URL.
export const REBASE_EXEMPT_EXACT = ['/annotate.js', '/save', '/image', '/annotations', '/events'];
export const REBASE_EXEMPT_PREFIX = ['/annotations/', '/images/', '/sites/'];

export function isRebaseExemptPath(pathname) {
  if (typeof pathname !== 'string') return false;
  if (REBASE_EXEMPT_EXACT.includes(pathname)) return true;
  return REBASE_EXEMPT_PREFIX.some((prefix) => pathname.startsWith(prefix));
}

/**
 * URL virtualization for client-side routers. A proxied page is served under
 * `/sites/<id>/…`, but an SPA router reads `location.pathname` directly (a
 * native getter — impossible to monkey-patch), so a prefixed path falls
 * through to the router's catch-all (my-todos renders「Not Found」). The
 * bootstrap therefore `history.replaceState`s the URL back to the path the
 * app expects, BEFORE any page script runs; runtime API calls still rebase
 * through rebaseProxyUrl. Side effect (intended): the annotate client boots
 * after this and keys its ledger on the app path (`/`, `/global`, …), which
 * converges byte-for-byte with the extension-injected ledger on the app's own
 * origin. Known hazards (documented): `location.reload()` reloads the virtual
 * URL (an iframe refresh then loads the unprefixed path), and hard
 * navigations (`location.href = '/x'`) leave the proxy.
 */
export function virtualAppPath(pathname, prefix) {
  if (typeof pathname !== 'string' || !prefix) return pathname;
  if (pathname === prefix) return '/';
  if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length) || '/';
  return pathname;
}

function alreadyPrefixed(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/**
 * Rebase one URL for fetch / XHR / EventSource / sendBeacon.
 * cfg: { prefix: '/sites/<id>', targetOrigin: 'https://app.localhost',
 *        selfOrigin: location.origin }
 * Returns the input unchanged when nothing applies.
 */
export function rebaseProxyUrl(raw, cfg) {
  if (typeof raw !== 'string' || !raw) return raw;
  const prefix = cfg.prefix;
  if (raw[0] === '/') {
    if (raw[1] === '/') return raw; // protocol-relative: another origin's business
    if (alreadyPrefixed(raw, prefix) || isRebaseExemptPath(raw)) return raw;
    return prefix + raw;
  }
  if (/^https?:\/\//i.test(raw)) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return raw;
    }
    // Same-origin absolute (the annotate client builds SERVER + '/save') and
    // target-origin absolute (app code that hardcodes its own origin) both
    // rebase onto the prefix; every other origin is left alone.
    if (u.origin !== cfg.selfOrigin && u.origin !== cfg.targetOrigin) return raw;
    if (alreadyPrefixed(u.pathname, prefix) || isRebaseExemptPath(u.pathname)) return raw;
    return prefix + u.pathname + u.search + u.hash;
  }
  return raw;
}

/**
 * WebSocket variant: a root-absolute `/path` has no scheme, so it must be
 * expanded against the page origin (ws/wss by page protocol) after rebasing.
 * Absolute ws(s) URLs pointing at the page origin or the target origin are
 * rewritten back onto the proxy; other origins pass through.
 * cfg additionally carries { selfProtocol: location.protocol, selfHost: location.host }.
 */
export function rebaseProxyWsUrl(raw, cfg) {
  if (typeof raw !== 'string' || !raw) return raw;
  const prefix = cfg.prefix;
  const wsSelf = (cfg.selfProtocol === 'https:' ? 'wss://' : 'ws://') + cfg.selfHost;
  if (raw[0] === '/') {
    if (raw[1] === '/') return raw;
    const p = alreadyPrefixed(raw, prefix) || isRebaseExemptPath(raw) ? raw : prefix + raw;
    return wsSelf + p;
  }
  if (/^wss?:\/\//i.test(raw)) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return raw;
    }
    // ws/wss 与目标 http/https scheme 不必相等 —— 按 host[:port] 比对归属。
    let targetHost = '';
    try {
      targetHost = new URL(cfg.targetOrigin).host;
    } catch {
      return raw;
    }
    if (u.host !== cfg.selfHost && u.host !== targetHost) return raw;
    if (alreadyPrefixed(u.pathname, prefix) || isRebaseExemptPath(u.pathname)) return raw;
    return wsSelf + prefix + u.pathname + u.search + u.hash;
  }
  return raw;
}
