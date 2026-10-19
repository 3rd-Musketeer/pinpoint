/**
 * pp3 文章代理：/<project>/… 与 Astro 的内部路径（/_astro/…、/_image）同源代理到
 * 文章站点的开发服务器（Astro，按需拉起，见 lib/site-dev-server.js）。路由判定
 * 在 lib/article-routes.js；不归站点的请求一律 next()，pinpoint 原有路由不受影响。
 *
 * - 文章页（/<project>/<article>/）的 HTML 响应注入标注客户端，与 /sites/ 同一份
 *   injectAnnotateClient：桶 = 这篇的页 id（src/shared/project-ids.js articlePageId），并带上
 *   __pinpointProse，客户端只跑正文评论。project 首页、wiki 页不注入（没有评论面）。
 * - 旧的 wiki 地址 /<project>/concepts/… 直接 301 到 /<project>/wiki/…，不拉起站点（ADR 0045）。
 *   ?annotate=off 单请求不注入。非 HTML 原样透传。
 * - 站点没就绪时：浏览器导航（Accept 含 text/html）拿到一张自动刷新的「站点
 *   启动中」页（503）；站点起不来（failed）时那张页写原因和日志尾巴。页面里的
 *   GET / HEAD 子资源（脚本、样式、图片）先等站点就绪（至多 RESOURCE_WAIT_MS），
 *   就绪了照常转发，等不到才回 503 纯文本：它们没有自动刷新，一个 503 就是页面上
 *   缺一块。
 * - 连上游复用 keep-alive 连接（upstreamAgent）。复用的空闲连接恰好被上游关掉时
 *   请求报 ECONNRESET，这不说明站点没了：GET / HEAD 换一条新连接重发一次，别的
 *   方法不走复用连接。只有新连接也连不上（ECONNREFUSED / ECONNRESET）才算站点
 *   不可达（2026-10-14：高负载下文章页的 /_astro/ 资源因此成批 503）。
 * - websocket：/_astro/ 下的 upgrade（Astro 的 vite HMR）原样转发；pinpoint 自己
 *   的 HMR 在 / 上，不碰。
 * - 来源（lib/proxy-origin.js）：Origin 是 pinpoint 自己的来源才改写成站点地址；
 *   别的来源的 websocket upgrade 与非 GET / HEAD 请求回 403，不拉起站点；别的来源的
 *   GET / HEAD 不转发 Origin。
 */
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

import { dataRoot } from './lib/annotate-data-dir.js';
import { injectAnnotateClient } from './lib/annotate-snippet.js';
import { resolveArticleTarget } from './lib/page-resolve.js';
import { isProjectId, routeArticleRequest, routeArticleUpgrade } from './lib/article-routes.js';
import { listenOrigins, originDecision, originsGetter } from './lib/proxy-origin.js';
import { parseReqUrl } from './lib/req-url.js';
import { escHtml } from '../shared/esc-html.js';
import { articlePageId } from '../shared/project-ids.js';
import { createSiteDevServer, stopOnSignals } from './lib/site-dev-server.js';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const UPGRADE_SKIP = new Set(['keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding']);

/** 子资源等站点就绪的上限：Astro 重新监听一般一两秒，满载机器上更久。 */
export const RESOURCE_WAIT_MS = 15_000;

// 上游连接池只给 GET / HEAD 用：它们能在复用连接被关掉时安全重发。
const upstreamAgent = new http.Agent({ keepAlive: true });

function isIdempotent(req) {
  return req.method === 'GET' || req.method === 'HEAD';
}

/** 站点没就绪时给浏览器的页。failed 时写原因与日志尾巴，刷新慢一些。 */
export function siteWaitPageHtml(snapshot, logTail = []) {
  const failed = snapshot.state === 'failed';
  const title = failed ? '站点没有起来' : '站点启动中';
  const lead = failed
    ? `文章站点的开发服务器没有起来：${escHtml(snapshot.lastError || '原因未知')}。页面每 5 秒重试一次。`
    : `正在启动文章站点（端口 ${snapshot.port}），就绪后页面自动刷新。`;
  const detail = failed
    ? `<p>命令：<code>${escHtml(snapshot.command)}</code></p>
<p>日志：<code>${escHtml(snapshot.logFile || '无')}</code></p>
${logTail.length ? `<pre>${escHtml(logTail.join('\n'))}</pre>` : ''}`
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
<body><main data-site-state="${escHtml(snapshot.state)}"><h1>${title}</h1><p>${lead}</p>${detail}</main></body></html>
`;
}

function wantsDocument(req) {
  const accept = String(req.headers.accept || '');
  return (req.method === 'GET' || req.method === 'HEAD') && accept.includes('text/html');
}

/** 站点在起 / 在重启时等它就绪的请求：GET / HEAD 子资源。导航有自动刷新的启动中页，写请求不重放。 */
function waitsForSite(req) {
  return isIdempotent(req) && !wantsDocument(req);
}

/** 等站点就绪，至多 waitMs；返回这时是否就绪。 */
async function siteReadyWithin(devServer, waitMs) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, waitMs); });
  try {
    await Promise.race([devServer.whenReady(), timeout]);
  } finally {
    clearTimeout(timer);
  }
  return devServer.snapshot().state === 'ready';
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

/**
 * 注入的标注桶：登记过、index.mdx 在盘上的文章页 → 这篇的画布页 id（画布标注与
 * 正文评论共用，common-m1.md §2）；project 首页、wiki 页、llms.txt、不存在的文章 →
 * null，不注入（没有评论面，也没有合法的桶）。
 */
export function annotationBucketFor(route, registry) {
  if (!route.article) return null;
  try {
    const pageId = articlePageId(route.project, route.article);
    return resolveArticleTarget(registry, pageId) ? pageId : null;
  } catch {
    return null;
  }
}

function sendForbidden(res, reason) {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`forbidden: ${reason}\n`);
}

/**
 * attempt：0 = 第一次；1 = 复用连接被重置后换新连接重发；2 = 等站点重新就绪后重发。
 * 重发只发生在 GET / HEAD 上（没有请求体要重放）。
 */
function forward(req, res, route, devServer, registry, origin, attempt = 0, waitMs = RESOURCE_WAIT_MS) {
  const port = devServer.port;
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(name) || name === 'origin') continue;
    headers[name] = value;
  }
  headers.host = `127.0.0.1:${port}`;
  headers['accept-encoding'] = 'identity';
  if (origin) headers.origin = origin;
  const entry = route.kind === 'article' ? annotationBucketFor(route, registry) : null;
  const inject = Boolean(entry) && parseReqUrl(req).query.get('annotate') !== 'off';

  // 写请求的体只能读一遍，不能重发：它们每次开新连接，碰不上被关掉的空闲连接。
  const agent = isIdempotent(req) && attempt === 0 ? upstreamAgent : false;
  const up = http.request({ host: '127.0.0.1', port, method: req.method, path: route.upstream, headers, agent }, (upRes) => {
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
      const data = Buffer.from(injectAnnotateClient(text, entry, { prose: { project: route.project, article: route.article } }), 'utf8');
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
    if (res.destroyed) return;
    if (error && error.code === 'ECONNRESET' && up.reusedSocket && attempt === 0) {
      forward(req, res, route, devServer, registry, origin, 1, waitMs);
      return;
    }
    if (error && (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET')) {
      devServer.noteUnreachable();
      devServer.ensure();
      if (attempt >= 2 || !waitsForSite(req)) {
        sendWaitResponse(req, res, devServer);
        return;
      }
      forwardWhenReady(req, res, route, devServer, registry, origin, waitMs);
      return;
    }
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'bad_gateway', upstream: `127.0.0.1:${port}`, message: error.message }));
  });
  const onClose = () => {
    if (!res.writableEnded) up.destroy();
  };
  res.on('close', onClose);
  up.on('close', () => res.off('close', onClose));
  if (attempt === 0) req.pipe(up);
  else up.end();
}

/** 子资源：等站点就绪（至多 waitMs）再转发，等不到回 503。 */
function forwardWhenReady(req, res, route, devServer, registry, origin, waitMs) {
  siteReadyWithin(devServer, waitMs).then((ready) => {
    if (res.destroyed) return;
    if (ready) forward(req, res, route, devServer, registry, origin, 2, waitMs);
    else sendWaitResponse(req, res, devServer);
  });
}

function decide(req, devServer, own, upgrade) {
  return originDecision({
    origin: req.headers.origin,
    method: req.method,
    upgrade,
    own: own(),
    upstreamOrigin: `http://127.0.0.1:${devServer.port}`,
  });
}

/**
 * options:
 *   registry   live registry（isProjectId 读它）
 *   isProject  直接给 project 判定函数（测试用；缺省读 registry）
 *   devServer  createSiteDevServer() 的实例
 *   origins    pinpoint 自己的来源：Set，或返回 Set 的函数（见 lib/proxy-origin.js）
 *   resourceWaitMs  子资源等站点就绪的上限（缺省 RESOURCE_WAIT_MS；测试调小）
 */
export function createArticleHandler({ registry, isProject, devServer, origins, resourceWaitMs = RESOURCE_WAIT_MS }) {
  const projectCheck = isProject || ((id) => isProjectId(registry, id));
  const own = originsGetter(origins);
  return function handleArticle(req, res) {
    const route = routeArticleRequest(req.url, projectCheck);
    if (!route) return false;
    if (route.kind === 'redirect') {
      res.statusCode = route.status;
      res.setHeader('Location', route.location);
      res.setHeader('Cache-Control', 'no-store');
      res.end();
      return true;
    }
    const verdict = decide(req, devServer, own, false);
    if (!verdict.allow) {
      sendForbidden(res, verdict.reason);
      return true;
    }
    const snapshot = devServer.ensure();
    if (snapshot.state !== 'ready') {
      if (!waitsForSite(req)) {
        sendWaitResponse(req, res, devServer);
        return true;
      }
      forwardWhenReady(req, res, route, devServer, registry, verdict.origin, resourceWaitMs);
      return true;
    }
    forward(req, res, route, devServer, registry, verdict.origin, 0, resourceWaitMs);
    return true;
  };
}

/** httpServer 'upgrade' 监听：只接 /_astro/ 下的 socket，其余不碰（vite 自己的 HMR 在 /）。 */
export function createArticleUpgradeHandler({ devServer, origins }) {
  const own = originsGetter(origins);
  return function handleArticleUpgrade(req, socket, head) {
    const route = routeArticleUpgrade(req.url);
    if (!route) return;
    const verdict = decide(req, devServer, own, true);
    if (!verdict.allow) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n'
        + `forbidden: ${verdict.reason}\n`);
      return;
    }
    if (devServer.ensure().state !== 'ready') {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    const port = devServer.port;
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (UPGRADE_SKIP.has(name) || name === 'origin') continue;
      headers[name] = value;
    }
    headers.host = `127.0.0.1:${port}`;
    if (verdict.origin) headers.origin = verdict.origin;
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
 * options.origins 缺省 = ownOrigins({ port: 服务实际监听的端口 })。
 */
export default function articleProxy(options = {}) {
  const devServer = options.devServer || createSiteDevServer({
    cwd: options.root || process.cwd(),
    logFile: path.join(dataRoot(), 'logs', 'site-dev.log'),
  });
  let viteServer = null;
  const origins = options.origins || listenOrigins(() => viteServer);
  const handleArticle = createArticleHandler({ registry: options.registry, isProject: options.isProject, devServer, origins });
  const handleUpgrade = createArticleUpgradeHandler({ devServer, origins });
  return {
    name: 'article-proxy',
    devServer,
    configureServer(server) {
      viteServer = server;
      server.middlewares.use((req, res, next) => {
        if (handleArticle(req, res)) return;
        next();
      });
      if (server.httpServer) {
        server.httpServer.on('upgrade', handleUpgrade);
        server.httpServer.once('close', () => { devServer.stop(); });
      }
      process.once('exit', () => devServer.stopSync());
      // 被信号杀掉时 'exit' 不触发，detached 的站点进程组也不会连带：先停它。
      stopOnSignals(devServer);
    },
  };
}
