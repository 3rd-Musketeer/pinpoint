/**
 * req.url 的统一解析（2026-09-22 切片 4 收拢）：node 的 http 请求路径可能是
 * undefined / 纯路径 / 路径 + query，各 API 插件此前各写各的
 * `new URL(req.url, 'http://x.local')` 与 `split('?')[0]`。这里一把尺子：
 *   parseReqUrl(req) → { pathname, query: URLSearchParams }
 * pathname 恒以 / 开头且不带 query；query 直接 .get()。
 * splitUrlQuery(url) 是同一把尺子的字符串版（拿 url 字符串、要保留 search
 * 原样的改写类路由用；workbench-routes 与 article-routes 此前各抄一份）。
 */
export function parseReqUrl(req) {
  const { pathname, search } = splitUrlQuery(req && req.url ? String(req.url) : null);
  return { pathname, query: new URLSearchParams(search.startsWith('?') ? search.slice(1) : search) };
}

export function splitUrlQuery(url) {
  const raw = typeof url === 'string' && url ? url : '/';
  const at = raw.indexOf('?');
  return at < 0 ? { pathname: raw, search: '' } : { pathname: raw.slice(0, at), search: raw.slice(at) };
}
