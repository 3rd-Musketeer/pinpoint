/**
 * pp3 文章代理：/<project>/… 与 Astro 的内部路径（/_astro/…、/_image）同源代理到
 * 文章站点的开发服务器（Astro，按需拉起，见 lib/site-dev-server.js）。路由判定
 * 在 lib/article-routes.js；不归站点的请求一律 next()，pinpoint 原有路由不受影响。
 *
 * - 文章页的 HTML 响应注入标注客户端，与 /sites/ 同一份 injectAnnotateClient；
 *   ?annotate=off 单请求不注入。非 HTML 原样透传。注入的 entry（标注桶）：
 *   文章页（/<project>/<article>/…）是这篇的画布页 id（articlePageId，画布标注
 *   与正文评论共用一个桶，common-m1.md §2）；project 首页、概念页等仍是 project id。
 * - 站点没就绪时：浏览器导航（Accept 含 text/html）拿到一张自动刷新的「站点
 *   启动中」页（503），其他请求拿 503 纯文本；站点起不来（failed）时那张页写
 *   原因和日志尾巴。
 * - websocket：/_astro/ 下的 upgrade（Astro 的 vite HMR）原样转发；pinpoint 自己
 *   的 HMR 在 / 上，不碰。
 */
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

import { dataRoot } from './lib/annotate-data-dir.js';
import { injectAnnotateClient } from './lib/annotate-snippet.js';
import { resolveArticleTarget } from './lib/article-board.js';
import { isProjectId, routeArticleRequest, routeArticleUpgrade } from './lib/article-routes.js';
import { articlePageId } from './lib/projects.js';
import { parseReqUrl } from './lib/req-url.js';
import { createSiteDevServer } from './lib/site-dev-server.js';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const UPGRADE_SKIP = new Set(['keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding']);

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** 站点没就绪时给浏览器的页。failed 时写原因与日志尾巴，刷新慢一些。 */
export function siteWaitPageHtml(snapshot, logTail = []) {
  const failed = snapshot.state === 'failed';
  const title = failed ? '站点没有起来' : '站点启动中';
  const lead = failed
    ? `文章站点的开发服务器没有起来：${escapeHtml(snapshot.lastError || '原因未知')}。页面每 5 秒重试一次。`
    : `正在启动文章站点（端口 ${snapshot.port}），就绪后页面自动刷新。`;
  const detail = failed
    ? `<p>命令：<code>${escapeHtml(snapshot.command)}</code></p>
<p>日志：<code>${escapeHtml(snapshot.logFile || '无')}</code></p>
${logTail.length ? `<pre>${escapeHtml(logTail.join('\n'))}</pre>` : ''}`
    : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="${failed ? 5 : 1}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#1f1f1e;--muted:#6f6e69}
@media (prefers-color-scheme:dark){:root{--bg:#191918;--fg:#ececea;--muted:#a3a29d}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
main{max-width:640px;margin:18vh auto 0;padding:0 16px}
h1{font-size:20px;font-weight:600;margin:0 0 8px}
p{color:var(--muted);margin:0 0 8px}
pre{overflow:auto;font-size:12px;padding:12px;border-radius:6px;background:color-mix(in srgb,var(--fg) 6%,transparent)}
</style></head>
<body><main data-site-state="${escapeHtml(snapshot.state)}"><h1>${title}</h1><p>${lead}</p>${detail}</main></body></html>
`;
}

function wantsDocument(req) {
  const accept = String(req.headers.accept || '');
  return (req.method === 'GET' || req.method === 'HEAD') && accept.includes('text/html');
}

function sendWaitResponse(req, res, devServer) {
  const snapshot = devServer.snapshot();
  const failed = snapshot.state === 'failed';
  res.statusCode = failed ? 502 : 503;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', failed ? '5' : '1');
  if (wantsDocument(req)) {
    const body = Buffer.from(siteWaitPageHtml(snapshot, failed ? devServer.logTail(20) : []), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Length', String(body.length));
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(failed ? `site dev server failed: ${snapshot.lastError || 'unknown'}\n` : 'site dev server is starting\n');
}

function decodeBody(body, encoding) {
  const enc = String(encoding || 'identity').toLowerCase().trim();
  if (!enc || enc === 'identity') return body.toString('utf8');
  if (enc === 'gzip') return zlib.gunzipSync(body).toString('utf8');
  if (enc === 'deflate') return zlib.inflateSync(body).toString('utf8');
  if (enc === 'br') return zlib.brotliDecompressSync(body).toString('utf8');
  throw new Error(`unsupported content-encoding: ${enc}`);
}

/** 注入的标注桶：登记过的文章 → 画布页 id；其余 project 路径 → project id。 */
export function annotationBucketFor(route, registry) {
  const second = String(route.upstream || '').split('?')[0].split('/')[3] || '';
  let articleId = '';
  try { articleId = decodeURIComponent(second); } catch { return route.project; }
  if (!articleId) return route.project;
  try {
    const pageId = articlePageId(route.project, articleId);
    return resolveArticleTarget(registry, pageId) ? pageId : route.project;
  } catch {
    return route.project;
  }
}

function forward(req, res, route, devServer, registry) {
  const port = devServer.port;
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name)) continue;
    headers[name] = value;
  }
  headers.host = `127.0.0.1:${port}`;
  headers['accept-encoding'] = 'identity';
  if (headers.origin) headers.origin = `http://127.0.0.1:${port}`;
  const inject = route.kind === 'article' && parseReqUrl(req).query.get('annotate') !== 'off';

  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: route.upstream, headers }, (upRes) => {
    const outHeaders = {};
    for (const [name, value] of Object.entries(upRes.headers)) {
      if (HOP_BY_HOP.has(name) || value === undefined) continue;
      outHeaders[name] = value;
    }
    const isHtml = String(upRes.headers['content-type'] || '').toLowerCase().includes('text/html');
    if (!inject || !isHtml || req.method === 'HEAD') {
      if (inject && isHtml) delete outHeaders['content-length'];
      res.writeHead(upRes.statusCode || 502, outHeaders);
      upRes.pipe(res);
      return;
    }
    const chunks = [];
    upRes.on('data', (chunk) => chunks.push(chunk));
    upRes.on('error', () => res.destroy());
    upRes.on('end', () => {
      const raw = Buffer.concat(chunks);
      let text;
      try {
        text = decodeBody(raw, upRes.headers['content-encoding']);
      } catch {
        res.writeHead(upRes.statusCode || 502, outHeaders);
        res.end(raw);
        return;
      }
      delete outHeaders['content-encoding'];
      const data = Buffer.from(injectAnnotateClient(text, annotationBucketFor(route, registry)), 'utf8');
      outHeaders['content-length'] = String(data.length);
      res.writeHead(upRes.statusCode || 502, outHeaders);
      res.end(data);
    });
  });
  up.on('error', (error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (error && (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET')) {
      devServer.noteUnreachable();
      devServer.ensure();
      sendWaitResponse(req, res, devServer);
      return;
    }
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'bad_gateway', upstream: `127.0.0.1:${port}`, message: error.message }));
  });
  res.on('close', () => {
    if (!res.writableEnded) up.destroy();
  });
  req.pipe(up);
}

/**
 * options:
 *   registry   live registry（isProjectId 读它）
 *   isProject  直接给 project 判定函数（测试用；缺省读 registry）
 *   devServer  createSiteDevServer() 的实例
 */
export function createArticleHandler({ registry, isProject, devServer }) {
  const projectCheck = isProject || ((id) => isProjectId(registry, id));
  return function handleArticle(req, res) {
    const route = routeArticleRequest(req.url, projectCheck);
    if (!route) return false;
    const snapshot = devServer.ensure();
    if (snapshot.state !== 'ready') {
      sendWaitResponse(req, res, devServer);
      return true;
    }
    forward(req, res, route, devServer, registry);
    return true;
  };
}

/** httpServer 'upgrade' 监听：只接 /_astro/ 下的 socket，其余不碰（vite 自己的 HMR 在 /）。 */
export function createArticleUpgradeHandler({ devServer }) {
  return function handleArticleUpgrade(req, socket, head) {
    const route = routeArticleUpgrade(req.url);
    if (!route) return;
    if (devServer.ensure().state !== 'ready') {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    const port = devServer.port;
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (UPGRADE_SKIP.has(name)) continue;
      headers[name] = value;
    }
    headers.host = `127.0.0.1:${port}`;
    if (headers.origin) headers.origin = `http://127.0.0.1:${port}`;
    const up = http.request({ host: '127.0.0.1', port, method: 'GET', path: route.upstream, headers });
    up.on('upgrade', (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage || 'Switching Protocols'}`];
      for (const [name, value] of Object.entries(upRes.headers)) {
        if (Array.isArray(value)) value.forEach((v) => lines.push(`${name}: ${v}`));
        else if (value !== undefined) lines.push(`${name}: ${value}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (upHead && upHead.length) socket.write(upHead);
      if (head && head.length) upSocket.write(head);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
      upSocket.on('error', () => socket.destroy());
      socket.on('error', () => upSocket.destroy());
    });
    up.on('response', (upRes) => {
      socket.end(`HTTP/1.1 ${upRes.statusCode || 502} ${upRes.statusMessage || ''}\r\nConnection: close\r\n\r\n`);
      upRes.resume();
    });
    up.on('error', () => socket.destroy());
    up.end();
  };
}

/**
 * vite 插件。options.devServer 给定时用它（测试），否则按环境变量建一个：
 * 仓库根下跑站点命令，日志写 <数据根>/logs/site-dev.log。
 */
export default function articleProxy(options = {}) {
  const devServer = options.devServer || createSiteDevServer({
    cwd: options.root || process.cwd(),
    logFile: path.join(dataRoot(), 'logs', 'site-dev.log'),
  });
  const handleArticle = createArticleHandler({ registry: options.registry, isProject: options.isProject, devServer });
  const handleUpgrade = createArticleUpgradeHandler({ devServer });
  return {
    name: 'article-proxy',
    devServer,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (handleArticle(req, res)) return;
        next();
      });
      if (server.httpServer) {
        server.httpServer.on('upgrade', handleUpgrade);
        server.httpServer.once('close', () => { devServer.stop(); });
      }
      process.once('exit', () => devServer.stopSync());
    },
  };
}
