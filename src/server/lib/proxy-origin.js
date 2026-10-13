/**
 * 代理的来源判定（纯函数）：一个经 pinpoint 转发的请求，按 Origin 头放行、改写还是拒绝。
 * 两处代理共用：文章站点（article-proxy.js）与 url 条目的 /sites/<id>/（lib/site-proxy.js）。
 *
 * 浏览器对 websocket 不做同源限制，挡跨站连接全靠服务端看 Origin；Astro 的 vite
 * 只在“有 Origin 时要 token”，不看 Origin 是谁；url 条目背后的应用多半按 Origin 挡
 * CSRF。代理若把一切 Origin 都改写成上游自己的地址，等于替任何网页过了来源检查。所以：
 *
 *   没有 Origin           放行，不加 Origin（命令行工具、同源 GET 导航）
 *   pinpoint 自己的来源    放行，Origin 改写成上游自己的地址（Host 也改了，上游的
 *                         来源检查按改写后的同源看）
 *   别的来源              websocket upgrade 与非 GET / HEAD 请求 → 403；GET / HEAD 放行，
 *                         但不转发 Origin（上游不按 Origin 回 CORS 头，浏览器读不到响应）
 *
 * pinpoint 自己的来源（ownOrigins）：https://pinpoint.localhost（CLI 的缺省地址，
 * bin/cli/core.js DEFAULT_ORIGIN）、环境变量 PINPOINT_ORIGIN、portless 给子进程的
 * PORTLESS_URL，以及服务直连端口上的 http://127.0.0.1:<端口>、http://localhost:<端口>、
 * http://[::1]:<端口>（dev:direct 与 e2e 的地址）。
 */

export const DEFAULT_PINPOINT_ORIGIN = 'https://pinpoint.localhost';

/** 规范成 URL.origin（小写、去默认端口）；不是 http(s) 来源返回 null。 */
export function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** pinpoint 自己的来源集合。port = 服务直连端口（vite server.port）。 */
export function ownOrigins({ env = process.env, port } = {}) {
  const list = [DEFAULT_PINPOINT_ORIGIN, env.PINPOINT_ORIGIN, env.PORTLESS_URL];
  if (port) list.push(`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`);
  return new Set(list.map(normalizeOrigin).filter(Boolean));
}

/**
 * 一次请求的来源判定。
 *   origin   请求的 Origin 头（原样，可缺）
 *   method   HTTP 方法；upgrade 为真时不看
 *   upgrade  是不是 websocket upgrade
 *   own      ownOrigins() 的集合
 *   upstreamOrigin  上游自己的来源（文章站点 http://127.0.0.1:<站点端口>；url 条目的目标 origin）
 * → { allow: true, origin: string|undefined }   origin = 转发给站点的 Origin 头，undefined 不带
 *   { allow: false, status: 403, reason }
 */
export function originDecision({ origin, method = 'GET', upgrade = false, own, upstreamOrigin }) {
  const raw = Array.isArray(origin) ? origin[0] : origin;
  if (raw === undefined || raw === '') return { allow: true, origin: undefined };
  const normalized = normalizeOrigin(raw);
  if (normalized && own && own.has(normalized)) return { allow: true, origin: upstreamOrigin };
  if (upgrade) return { allow: false, status: 403, reason: `websocket from foreign origin ${raw}` };
  const verb = String(method || 'GET').toUpperCase();
  if (verb !== 'GET' && verb !== 'HEAD') return { allow: false, status: 403, reason: `${verb} from foreign origin ${raw}` };
  return { allow: true, origin: undefined };
}

/** origins 选项 → 取集合的函数：Set 原样用，函数每次调，缺省 ownOrigins()（不含直连端口）。 */
export function originsGetter(origins) {
  if (typeof origins === 'function') return origins;
  const fixed = origins instanceof Set ? origins : ownOrigins();
  return () => fixed;
}

/**
 * vite 插件用的 origins：按服务实际监听的端口算 ownOrigins，监听上之后缓存；还没监听时
 * 退回 config.server.port。getServer 返回 configureServer 拿到的 vite server（可能还没有）。
 */
export function listenOrigins(getServer) {
  let cached = null;
  return () => {
    if (cached) return cached;
    const server = getServer();
    const address = server && server.httpServer && server.httpServer.address();
    if (address && typeof address === 'object') return (cached = ownOrigins({ port: address.port }));
    return ownOrigins({ port: server && server.config.server.port });
  };
}
