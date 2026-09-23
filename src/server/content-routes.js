/**
 * URL 契约与磁盘布局解耦。服务的 URL 不随目录重排变化——磁盘位置变了，
 * URL 没变：
 *   /kits/…            → content/kits/…
 *   /previews/…        → content/previews/…
 *   /lib/…             → src/shared/…        （ann-list.css 的历史 URL）
 * 只改 req.url 的磁盘投影。本插件注册在插件链末尾，所以前面按原 URL 匹配的
 * 中间件（preview-inject / template-only / sites-api / annotate API）看到的
 * 仍是原样 URL，改写只对 vite 自己的静态与 html 服务生效。
 *
 * 前缀匹配走「原样 pathname 与解码归一后的 pathname 都落在前缀里」的双判据：
 * `/previews/%2e%2e/%2e%2e/package.json` 归一后是 `/package.json`，不再被投影到
 * content/ 下，原样透传（由 vite 的 fs 规则处置）。改写只换前缀、不改写余下的
 * 百分号编码，路径里的 `%` 与空格照旧交给 vite 解码。
 *
 * 缺文件答真 404（2026-09-04）：投影完就先看磁盘。以前投影完直接 next()，
 * 文件不在时会掉进 vite 的 SPA fallback —— 200 + index.html 冒充成内容
 * （docs/debugging.md「SPA fallback 喂 HTML 冒充 200」那条的根因）。现在投影到
 * 的路径不存在就 404 + text/plain，不再 next()；目录只有带 index.html 才交给
 * vite。判定是纯函数 resolveContentFile，磁盘探测由调用方注入。
 */
import fs from 'node:fs';
import path from 'node:path';

import { injectAnnotateClient } from './lib/annotate-snippet.js';
import {
  boardScreenIds,
  serveBoardJsonWithDist,
  serveDistScreenResponse,
} from './lib/page-compiler.js';

const PREFIXES = [
  ['/kits/', '/content/kits/'],
  ['/previews/', '/content/previews/'],
  ['/lib/', '/src/shared/'],
];

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
  const normalized = normalizedPathname(pathname);
  if (normalized === null) return url;
  for (const [from, to] of PREFIXES) {
    if (!pathname.startsWith(from) || !normalized.startsWith(from)) continue;
    return to + pathname.slice(from.length) + query;
  }
  return url;
}

/**
 * 一次投影的完整判定（纯函数）。exists(磁盘相对路径) 返回 'file' | 'dir' | null。
 * 返回：
 *   { action: 'pass',     url }  没被投影（不归本插件管），原样交给 vite
 *   { action: 'serve',    url }  投影到的文件（或带 index.html 的目录）在，改写后放行
 *   { action: 'notFound', url }  投影到的路径不在磁盘上 —— 404，不能 next()
 * notFound 的 url 是**原始** URL：报错行里要出现用户请求的那个地址，不是磁盘投影。
 */
export function resolveContentFile(url, exists) {
  const rewritten = rewriteContentUrl(url);
  if (rewritten === url) return { action: 'pass', url };
  const cut = rewritten.indexOf('?');
  const pathname = cut === -1 ? rewritten : rewritten.slice(0, cut);
  let diskPath = normalizedPathname(pathname);
  if (diskPath === null) return { action: 'pass', url };
  // 目录 URL 的尾斜杠不进磁盘查询（`/previews/x/` 与 `/previews/x` 同一个 inode）。
  if (diskPath.length > 1 && diskPath.endsWith('/')) diskPath = diskPath.slice(0, -1);
  const kind = exists(diskPath);
  if (kind === 'file') return { action: 'serve', url: rewritten };
  // 目录只有自带 index.html 才有内容可服务（vite 的目录回落同规则）；
  // 否则和缺文件一样 404，不留给 SPA fallback。
  if (kind === 'dir' && exists(path.posix.join(diskPath, 'index.html')) === 'file') {
    return { action: 'serve', url: rewritten };
  }
  return { action: 'notFound', url };
}

export default function contentRoutes() {
  return {
    name: 'content-routes',
    configureServer(server) {
      const root = server.config.root;
      const previewsRoot = path.join(root, 'content', 'previews');
      const exists = (diskPath) => {
        let stat;
        try {
          stat = fs.statSync(path.join(root, diskPath));
        } catch {
          return null;
        }
        if (stat.isDirectory()) return 'dir';
        return stat.isFile() ? 'file' : null;
      };
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();

        // pp2（2026-09-22 切片 1）：模板页的「屏」从 dist 出，与 /sites/ 同约 ——
        // <dataRoot>/dist/<pageId>/<screenId>.html（懒编译兜底，失败 500）。
        // 非屏路径照旧走下面的磁盘投影。doctype 整文档在这里注入 annotate
        // （preview-inject 已把 board 屏让过来；fragment 不注入，与从前一致）。
        if (req.method === 'GET' || req.method === 'HEAD') {
          const parts = req.url.split('?');
          const urlPath = parts[0];
          const query = parts[1] || '';
          const boardMatch = urlPath.match(/^\/previews\/([a-zA-Z0-9_-]+)\/board\.json$/);
          if (boardMatch) {
            const pageDir = path.join(previewsRoot, boardMatch[1]);
            if (serveBoardJsonWithDist(req, res, boardMatch[1], pageDir)) return;
          } else {
            const screenMatch = urlPath.match(/^\/previews\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\.html$/);
            if (screenMatch) {
              const pageDir = path.join(previewsRoot, screenMatch[1]);
              const ids = boardScreenIds(pageDir);
              if (ids && ids.has(screenMatch[2])) {
                const annotate = !/(?:^|&)annotate=off(?:&|$)/.test(query);
                await serveDistScreenResponse(req, res, {
                  entryId: screenMatch[1],
                  pageDir,
                  urlBase: `/previews/${screenMatch[1]}/`,
                  kind: 'template',
                }, screenMatch[2], {
                  // storage-unify：previews 屏也带 entry 标记（= 页 id），账本落页桶。
                  inject: annotate
                    ? (html) => (/<!doctype\b/i.test(html) && !html.includes('data-ios-annotate') ? injectAnnotateClient(html, screenMatch[1]) : html)
                    : null,
                });
                return;
              }
            }
          }
        }

        const decision = resolveContentFile(req.url, exists);
        if (decision.action === 'notFound') {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(`not found: ${decision.url}`);
          return;
        }
        req.url = decision.url;
        next();
      });
    },
  };
}
