import { parseReqUrl } from './req-url.js';
/**
 * Same-origin path-prefix proxy for registry `url` entries (阶段 4 live 代理画中画).
 *
 * A `url` entry (e.g. my-todos → https://my-todos.localhost) is served under
 * `/sites/<id>/` — the same URL space as dir/file entries — so the target app
 * renders inside the workbench's doc-shell iframe same-origin, with the
 * annotate client injected by the proxy layer. The target app stays zero-touch
 * (目标项目零感知, decisions 08-07): every adaptation happens on the wire here.
 *
 * Four mechanisms, all in this module:
 *
 * 1. HTTP forwarding (proxySiteRequest): method/headers/body pass through;
 *    responses get Set-Cookie rebased (Domain stripped, Path prefixed), 3xx
 *    Location rewritten back under the prefix, and framing/script-blocking
 *    headers stripped (CSP, X-Frame-Options, COOP/COEP — the page must enter
 *    an iframe and run our inline bootstrap; the registry whitelist is the
 *    security boundary, so the policy is stripped wholesale, not relaxed).
 *    HTML responses get root-absolute src/href/action/… rewritten onto the
 *    prefix; CSS responses get url(/…) rewritten.
 *
 * 2. Runtime rebase bootstrap (proxyBootstrapSnippet): HTML rewrites cannot
 *    reach `fetch('/api/...')` inside JS bundles, so an inline bootstrap is
 *    injected as the FIRST <head> script (before any page script) that
 *    monkey-patches fetch / XMLHttpRequest / EventSource / WebSocket /
 *    sendBeacon through src/shared/proxy-rebase.js (inlined, like /annotate.js).
 *    The pinpoint annotate client's own API calls stay exempt via an explicit
 *    endpoint list — see REBASE_EXEMPT_* in src/shared/proxy-rebase.js. The bootstrap
 *    also virtualizes the URL (history.replaceState to the unprefixed app
 *    path, virtualAppPath) because SPA routers read location.pathname — a
 *    native getter no patch can intercept — and would hit their catch-all
 *    under the prefix; the annotate ledger thereby keys on the app path,
 *    byte-identical to the extension-injected ledger on the app's own origin.
 *
 * 3. annotate=off on a url entry means「无标注面」rather than「原始字节」
 *    (there are no disk bytes): the annotate client is not injected, but the
 *    rebase bootstrap and URL rewrites stay — they are proxy mechanics, and
 *    dropping them would point every runtime API call at the wrong origin.
 *
 * 4. WebSocket fallback (proxySiteUpgrade + createSiteUpgradeHandler): an
 *    'upgrade' listener on vite's httpServer forwards `/sites/<id>/…` WS
 *    upgrades to the target (path un-prefixed on the wire, 101 head relayed,
 *    then a raw bidirectional pipe). Non-/sites/ sockets are never touched —
 *    vite HMR keeps its own listener.
 *
 * SSRF boundary: only registry-resolved url entries are proxied, and the
 * upstream request reuses the entry's own origin. Upstream TLS verification
 * is off (rejectUnauthorized: false) because local dev origins commonly use
 * a privately-trusted CA (portless) that node's CA store does not know.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { injectAnnotateClient } from './annotate-snippet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REBASE_LIB_PATH = path.join(__dirname, '..', '..', 'shared', 'proxy-rebase.js');

/* ------------------------------------------------------------------ */
/* Pure rewriters (node-tested)                                        */
/* ------------------------------------------------------------------ */

function prefixPath(p, prefix) {
  if (typeof p !== 'string' || p[0] !== '/' || p[1] === '/') return p;
  if (p === prefix || p.startsWith(prefix + '/')) return p;
  return prefix + p;
}

/** CSS url(/…) and @import '/…' rebased onto the prefix. data:/#/// untouched. */
export function rewriteProxyCss(css, prefix) {
  return String(css)
    .replace(/url\(\s*(['"]?)(\/(?!\/)[^)"']*)\1\s*\)/g, (match, quote, p) => {
      if (p === prefix || p.startsWith(prefix + '/')) return match;
      return `url(${quote}${prefix}${p}${quote})`;
    })
    .replace(/@import\s+(['"])(\/(?!\/)[^"']*)\1/g, (match, quote, p) => {
      if (p === prefix || p.startsWith(prefix + '/')) return match;
      return `@import ${quote}${prefix}${p}${quote}`;
    });
}

function rewriteSrcset(value, prefix) {
  return value
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (!parts[0]) return candidate;
      parts[0] = prefixPath(parts[0], prefix);
      return parts.join(' ');
    })
    .join(', ');
}

/**
 * Root-absolute URL attributes in HTML rebased onto the prefix:
 * src/href/action/poster/formaction/srcset/imagesrcset/xlink:href (a leading
 * `-` deliberately still matches, so lazy-load `data-src` is covered),
 * <object data>, <meta http-equiv=refresh content="…;url=/…">, <style> bodies
 * and style="…" attributes (via rewriteProxyCss).
 * Blind spots (covered by the runtime bootstrap instead, or not at all):
 * JS-assigned DOM URLs (`img.src='/x.png'`), unquoted attributes, JSON blobs
 * inside script tags, and CSS inside external attributes not listed above.
 */
export function rewriteProxyHtml(html, prefix) {
  let out = String(html);
  const attrRe = /(?<![\w:])(xlink:href|srcset|imagesrcset|src|href|action|poster|formaction)(\s*=\s*)(["'])(\/(?!\/)[^"']*)\3/gi;
  out = out.replace(attrRe, (match, attr, eq, quote, p) => {
    const value = /srcset/i.test(attr) ? rewriteSrcset(p, prefix) : prefixPath(p, prefix);
    return `${attr}${eq}${quote}${value}${quote}`;
  });
  out = out.replace(/<object\b[^>]*>/gi, (tag) => tag.replace(
    /\bdata(\s*=\s*)(["'])(\/(?!\/)[^"']*)\2/i,
    (match, eq, quote, p) => `data${eq}${quote}${prefixPath(p, prefix)}${quote}`,
  ));
  out = out.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!/http-equiv\s*=\s*["']refresh["']/i.test(tag)) return tag;
    return tag.replace(
      /(content\s*=\s*["'][^"']*?url\s*=\s*)(\/(?!\/)[^"']*)/i,
      (match, head, p) => head + prefixPath(p, prefix),
    );
  });
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi,
    (match, open, body, close) => open + rewriteProxyCss(body, prefix) + close);
  out = out.replace(/\bstyle(\s*=\s*)(["'])([\s\S]*?)\2/gi,
    (match, eq, quote, value) => `style${eq}${quote}${rewriteProxyCss(value, prefix)}${quote}`);
  return out;
}

/** 3xx Location: root-absolute or target-origin absolute rebase under the prefix. */
export function rewriteProxyLocation(value, prefix, targetOrigin) {
  if (typeof value !== 'string' || !value) return value;
  if (value[0] === '/') return prefixPath(value, prefix);
  try {
    const u = new URL(value);
    if (u.origin !== targetOrigin) return value;
    return prefixPath(u.pathname, prefix) + u.search + u.hash;
  } catch {
    return value;
  }
}

/**
 * Referer: the page's own URL carries our prefix; strip it and point at the
 * target origin so upstream CSRF/referer checks see the app's true shape.
 * Referers outside the prefix (the workbench itself) pass through unchanged.
 */
export function rewriteProxyReferer(value, prefix, targetOrigin) {
  try {
    const u = new URL(value);
    if (u.pathname !== prefix && !u.pathname.startsWith(prefix + '/')) return value;
    const rest = u.pathname.slice(prefix.length) || '/';
    return targetOrigin + rest + u.search + u.hash;
  } catch {
    return value;
  }
}

/**
 * Set-Cookie: Domain dropped (the cookie must bind to the pinpoint origin),
 * Path rebased under the prefix (default Path added when absent) so the
 * browser sends it back through the proxy and nowhere else.
 */
export function rewriteProxySetCookie(cookie, prefix) {
  const parts = String(cookie).split(';');
  const out = [parts[0]];
  let hasPath = false;
  for (const raw of parts.slice(1)) {
    const attr = raw.trim();
    if (/^domain\s*=/i.test(attr)) continue;
    if (/^path\s*=/i.test(attr)) {
      hasPath = true;
      const p = attr.slice(attr.indexOf('=') + 1).trim() || '/';
      const rebased = p === '/' ? prefix : prefixPath(p, prefix);
      out.push(`Path=${rebased}`);
      continue;
    }
    out.push(attr);
  }
  if (!hasPath) out.push(`Path=${prefix}`);
  return out.join('; ');
}

/* ------------------------------------------------------------------ */
/* Rebase bootstrap injection                                          */
/* ------------------------------------------------------------------ */

/** src/shared/proxy-rebase.js source with ESM exports stripped (annotate.js 同款内联). */
export function rebaseLibSource() {
  // 逐次读取、不缓存：lib 改动下次响应即生效，省一套 mtime 账。
  return fs.readFileSync(REBASE_LIB_PATH, 'utf8').replace(/^export /gm, '');
}

/**
 * Inline bootstrap that installs the runtime rebase patches. Must run before
 * every page script — injectProxyBootstrap puts it right after <head> (or
 * <html>, or document start). Idempotent via window.__pinpointProxy.
 */
export function proxyBootstrapSnippet(entryId, targetUrl) {
  const targetOrigin = new URL(targetUrl).origin;
  const cfg = JSON.stringify({ prefix: `/sites/${entryId}`, targetOrigin });
  return `<script data-pinpoint-proxy="${entryId}">(function(){
if(window.__pinpointProxy)return;
${rebaseLibSource()}
var __CFG=${cfg};
__CFG.selfOrigin=location.origin;__CFG.selfProtocol=location.protocol;__CFG.selfHost=location.host;
window.__pinpointProxy=__CFG;
// URL 虚拟化：SPA 路由直接读 location.pathname（原生 getter 无法 patch），
// 在一切页面脚本之前把 URL 改回应用预期的路径；annotate 参数是代理机制不透给应用。
try{
  var __appPath=virtualAppPath(location.pathname,__CFG.prefix);
  if(__appPath!==location.pathname){
    var __qs=new URLSearchParams(location.search);
    __qs.delete('annotate');
    var __q=__qs.toString();
    history.replaceState(history.state,'',__appPath+(__q?'?'+__q:'')+location.hash);
  }
}catch(e){}
var __rebase=function(u){return rebaseProxyUrl(u,__CFG);};
var __rebaseWs=function(u){return rebaseProxyWsUrl(u,__CFG);};
if(typeof window.fetch==='function'){
  var __fetch=window.fetch;
  window.fetch=function(input,init){
    try{
      if(typeof input==='string')input=__rebase(input);
      else if(typeof URL!=='undefined'&&input instanceof URL)input=__rebase(String(input));
      else if(typeof Request!=='undefined'&&input instanceof Request){
        var next=__rebase(input.url);
        if(next!==input.url)input=new Request(next,input);
      }
    }catch(e){}
    return __fetch.call(this,input,init);
  };
}
if(typeof XMLHttpRequest!=='undefined'){
  var __open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    try{url=__rebase(String(url));}catch(e){}
    var rest=[method,url];
    for(var i=2;i<arguments.length;i++)rest.push(arguments[i]);
    return __open.apply(this,rest);
  };
}
if(typeof window.EventSource==='function'){
  var __ES=window.EventSource;
  window.EventSource=function(url,config){return new __ES(__rebase(String(url)),config);};
  window.EventSource.prototype=__ES.prototype;
  window.EventSource.CONNECTING=__ES.CONNECTING;
  window.EventSource.OPEN=__ES.OPEN;
  window.EventSource.CLOSED=__ES.CLOSED;
}
if(typeof window.WebSocket==='function'){
  var __WS=window.WebSocket;
  window.WebSocket=function(url,protocols){
    var u=__rebaseWs(String(url));
    return protocols===undefined?new __WS(u):new __WS(u,protocols);
  };
  window.WebSocket.prototype=__WS.prototype;
  window.WebSocket.CONNECTING=__WS.CONNECTING;
  window.WebSocket.OPEN=__WS.OPEN;
  window.WebSocket.CLOSING=__WS.CLOSING;
  window.WebSocket.CLOSED=__WS.CLOSED;
}
if(typeof navigator!=='undefined'&&typeof navigator.sendBeacon==='function'){
  var __beacon=navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon=function(url,data){return __beacon(__rebase(String(url)),data);};
}
})();</script>`;
}

/** Bootstrap goes first: right after <head> / <html>, else document start. */
export function injectProxyBootstrap(html, snippet) {
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (tag) => `${tag}\n${snippet}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (tag) => `${tag}\n${snippet}`);
  }
  return `${snippet}\n${html}`;
}

/* ------------------------------------------------------------------ */
/* HTTP forwarding                                                     */
/* ------------------------------------------------------------------ */

// Hop-by-hop request headers never forwarded; host/origin/referer are
// rewritten, and accept-encoding is forced to identity so rewriteable bodies
// (HTML/CSS) arrive uncompressed. A non-identity body that slips through is
// decompressed before rewriting and re-sent as identity.
const REQUEST_HEADER_SKIP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

// Upgrade requests keep connection/upgrade/sec-websocket-* intact.
const UPGRADE_HEADER_SKIP = new Set([
  'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding',
]);

const RESPONSE_HEADER_SKIP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
  // 页面必须能进 workbench iframe、必须能跑我们的 inline bootstrap —— 整头剥掉，
  // 不做局部放宽（registry 白名单是安全边界；本地 dev 代理语义=可信目标）。
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
]);

function decodeBody(body, encoding) {
  const enc = String(encoding || 'identity').toLowerCase().trim();
  if (!enc || enc === 'identity') return body.toString('utf8');
  if (enc === 'gzip') return zlib.gunzipSync(body).toString('utf8');
  if (enc === 'deflate') return zlib.inflateSync(body).toString('utf8');
  if (enc === 'br') return zlib.brotliDecompressSync(body).toString('utf8');
  throw new Error(`unsupported content-encoding: ${enc}`);
}

function collectBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Proxy one request for a resolved `url` entry. `req.url` keeps its original
 * percent-encoding on the wire (decode+re-encode would corrupt %2F & co), so
 * the prefix is stripped textually — entry ids are [a-z0-9-], never encoded.
 */
export function proxySiteRequest(req, res, entry) {
  const prefix = `/sites/${entry.id}`;
  const annotate = parseReqUrl(req).query.get('annotate') !== 'off';
  let target;
  try {
    target = new URL(entry.url);
  } catch {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'bad_gateway', entry: entry.id }));
    return;
  }
  const isTls = target.protocol === 'https:';
  const lib = isTls ? https : http;
  const tail = req.url.slice(prefix.length) || '/';
  const upstreamPath = tail[0] === '?' ? `/${tail}` : tail;

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (REQUEST_HEADER_SKIP.has(name)) continue;
    headers[name] = value;
  }
  headers.host = target.host;
  headers['accept-encoding'] = 'identity';
  if (headers.origin) headers.origin = target.origin;
  if (typeof headers.referer === 'string') {
    headers.referer = rewriteProxyReferer(headers.referer, prefix, target.origin);
  }

  const up = lib.request({
    hostname: target.hostname,
    port: target.port || (isTls ? 443 : 80),
    method: req.method,
    path: upstreamPath,
    headers,
    rejectUnauthorized: false,
  }, (upRes) => {
    const outHeaders = {};
    for (const [name, value] of Object.entries(upRes.headers)) {
      if (RESPONSE_HEADER_SKIP.has(name) || value === undefined) continue;
      if (name === 'set-cookie') {
        const list = Array.isArray(value) ? value : [value];
        outHeaders['set-cookie'] = list.map((cookie) => rewriteProxySetCookie(cookie, prefix));
        continue;
      }
      if (name === 'location' && typeof value === 'string') {
        outHeaders.location = rewriteProxyLocation(value, prefix, target.origin);
        continue;
      }
      outHeaders[name] = value;
    }
    const type = String(upRes.headers['content-type'] || '').toLowerCase();
    const rewritable = type.includes('text/html') || type.includes('text/css');
    if (req.method === 'HEAD' || !rewritable) {
      // HEAD 拿不到 body，GET 时会重写变长 —— content-length 不可信就摘。
      if (req.method === 'HEAD' && rewritable) delete outHeaders['content-length'];
      res.writeHead(upRes.statusCode || 502, outHeaders);
      upRes.pipe(res);
      return;
    }
    collectBody(upRes).then((body) => {
      let text;
      try {
        text = decodeBody(body, upRes.headers['content-encoding']);
      } catch {
        // 上游不理会 identity 且编码不识别：放弃重写保字节，原样透传。
        res.writeHead(upRes.statusCode || 502, outHeaders);
        res.end(body);
        return;
      }
      delete outHeaders['content-encoding'];
      let out;
      if (type.includes('text/css')) {
        out = rewriteProxyCss(text, prefix);
      } else {
        out = rewriteProxyHtml(text, prefix);
        out = injectProxyBootstrap(out, proxyBootstrapSnippet(entry.id, entry.url));
        if (annotate) out = injectAnnotateClient(out, entry.id);
      }
      const data = Buffer.from(out, 'utf8');
      outHeaders['content-length'] = String(data.length);
      res.writeHead(upRes.statusCode || 502, outHeaders);
      res.end(data);
    }, () => res.destroy());
  });
  up.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'bad_gateway', entry: entry.id, url: entry.url }));
  });
  res.on('close', () => {
    if (!res.writableEnded) up.destroy();
  });
  req.pipe(up);
}

/* ------------------------------------------------------------------ */
/* WebSocket forwarding                                                */
/* ------------------------------------------------------------------ */

/** Forward one `/sites/<id>/…` upgrade to the entry's target origin. */
export function proxySiteUpgrade(req, socket, head, entry) {
  const prefix = `/sites/${entry.id}`;
  let target;
  try {
    target = new URL(entry.url);
  } catch {
    socket.destroy();
    return;
  }
  const isTls = target.protocol === 'https:';
  const lib = isTls ? https : http;
  const tail = req.url.slice(prefix.length) || '/';
  const upstreamPath = tail[0] === '?' ? `/${tail}` : tail;

  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (UPGRADE_HEADER_SKIP.has(name)) continue;
    headers[name] = value;
  }
  headers.host = target.host;
  if (headers.origin) headers.origin = target.origin;

  const up = lib.request({
    hostname: target.hostname,
    port: target.port || (isTls ? 443 : 80),
    method: 'GET',
    path: upstreamPath,
    headers,
    rejectUnauthorized: false,
  });
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
    // 上游拒绝升级：把状态行如实回给客户端再断开。
    socket.write(`HTTP/1.1 ${upRes.statusCode || 502} ${upRes.statusMessage || ''}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    upRes.resume();
  });
  up.on('error', () => socket.destroy());
  up.end();
}

/**
 * httpServer 'upgrade' listener: only `/sites/<id>/…` paths resolving to a
 * url entry are handled; every other socket is left untouched (vite HMR has
 * its own listener on the same event).
 */
export function createSiteUpgradeHandler({ registry } = {}) {
  return function handleSiteUpgrade(req, socket, head) {
    const urlPath = parseReqUrl(req).pathname;
    if (!urlPath.startsWith('/sites/')) return;
    const rest = urlPath.slice('/sites/'.length);
    const slash = rest.indexOf('/');
    const rawId = slash < 0 ? rest : rest.slice(0, slash);
    let id;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      return;
    }
    const entry = id && registry && registry.resolve(id);
    if (!entry || entry.kind !== 'url') return;
    proxySiteUpgrade(req, socket, head, entry);
  };
}
