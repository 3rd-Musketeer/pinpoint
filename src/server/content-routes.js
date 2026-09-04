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
 */
const PREFIXES = [
  ['/kits/', '/content/kits/'],
  ['/previews/', '/content/previews/'],
  ['/lib/', '/src/shared/'],
];

const EXACT = new Map([
  ['/panel.html', '/src/pages/panel.html'],
  ['/starter.html', '/src/pages/starter.html'],
]);

export function rewriteContentUrl(url) {
  const cut = url.indexOf('?');
  const pathname = cut === -1 ? url : url.slice(0, cut);
  const query = cut === -1 ? '' : url.slice(cut);
  const exact = EXACT.get(pathname);
  if (exact) return exact + query;
  for (const [from, to] of PREFIXES) {
    if (pathname.startsWith(from)) return to + pathname.slice(from.length) + query;
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
