/**
 * URL 契约与磁盘布局解耦。服务的 URL 不随目录重排变化——磁盘位置变了，
 * URL 没变：
 *   /kits/…            → content/kits/…
 *   /previews/…        → content/previews/…
 *   /lib/…             → src/shared/…        （ann-list.css 的历史 URL）
 *   /panel.html        → src/pages/panel.html
 *   /starter.html      → src/pages/starter.html
 * 只改 req.url 的磁盘投影。本插件注册在插件链末尾，所以前面按原 URL 匹配的
 * 中间件（preview-inject / template-only / sites-api / annotate API）看到的
 * 仍是原样 URL，改写只对 vite 自己的静态与 html 服务生效。
 *
 * 前缀匹配走「原样 pathname 与解码归一后的 pathname 都落在前缀里」的双判据：
 * `/previews/%2e%2e/%2e%2e/package.json` 归一后是 `/package.json`，不再被投影到
 * content/ 下，原样透传（由 vite 的 fs 规则处置）。改写只换前缀、不改写余下的
 * 百分号编码，路径里的 `%` 与空格照旧交给 vite 解码。
 */
import path from 'node:path';

const PREFIXES = [
  ['/kits/', '/content/kits/'],
  ['/previews/', '/content/previews/'],
  ['/lib/', '/src/shared/'],
];

const EXACT = new Map([
  ['/panel.html', '/src/pages/panel.html'],
  ['/starter.html', '/src/pages/starter.html'],
]);

function normalizedPathname(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return null; }
  if (decoded.includes('\0')) return null;
  return path.posix.normalize(decoded);
}

export function rewriteContentUrl(url) {
  const cut = url.indexOf('?');
  const pathname = cut === -1 ? url : url.slice(0, cut);
  const query = cut === -1 ? '' : url.slice(cut);
  const exact = EXACT.get(pathname);
  if (exact) return exact + query;
  const normalized = normalizedPathname(pathname);
  if (normalized === null) return url;
  for (const [from, to] of PREFIXES) {
    if (!pathname.startsWith(from) || !normalized.startsWith(from)) continue;
    return to + pathname.slice(from.length) + query;
  }
  return url;
}

export default function contentRoutes() {
  return {
    name: 'content-routes',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url) req.url = rewriteContentUrl(req.url);
        next();
      });
    },
  };
}
