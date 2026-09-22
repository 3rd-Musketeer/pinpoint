/**
 * req.url 的统一解析（2026-09-22 切片 4 收拢）：node 的 http 请求路径可能是
 * undefined / 纯路径 / 路径 + query，各 API 插件此前各写各的
 * `new URL(req.url, 'http://x.local')` 与 `split('?')[0]`。这里一把尺子：
 *   parseReqUrl(req) → { pathname, query: URLSearchParams }
 * pathname 恒以 / 开头且不带 query；query 直接 .get()。
 */
export function parseReqUrl(req) {
  const raw = req && req.url ? String(req.url) : '/';
  const at = raw.indexOf('?');
  const pathname = at < 0 ? raw : raw.slice(0, at);
  return { pathname, query: new URLSearchParams(at < 0 ? '' : raw.slice(at + 1)) };
}
