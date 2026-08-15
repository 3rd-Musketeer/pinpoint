/**
 * 阶段 4 e2e 上游 fixture：一个「真实 web app」的最小形态 —— 绝对路径资源
 * (/assets/*)、绝对路径 API (/api/*：fetch GET/POST、XHR、SSE、WS echo)、
 * 302、cookie。它模拟 my-todos 那样的 portless 应用：HTML/JS 里全是根绝对
 * 路径，全靠 pinpoint 代理的重写 + 运行时重基才能在 /sites/e2e-proxy/ 下活。
 *
 * 进程拓扑：playwright.config.js 模块作用域起服（webServer 拉起 e2e server
 * 之前 registry fixture 就要带上这个 origin），spec 跑在 worker 进程里，
 * 经 /__hits 回读请求日志做「确实走了代理」的断言。
 */
import crypto from 'node:crypto';
import http from 'node:http';

import { E2E_UPSTREAM_PORT } from './env.js';

// 1×1 transparent PNG.
const BG_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const PAGE_HTML = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>E2E proxy upstream</title>
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/app.js" defer></script>
</head><body>
<h1 id="title">E2E proxy upstream</h1>
<button id="btn" type="button">Do</button>
<div class="abs-bg" id="bg-probe"></div>
<div id="api-result"></div>
<div id="xhr-result"></div>
<div id="post-result"></div>
<div id="sse-result"></div>
<div id="ws-result"></div>
</body></html>
`;

const APP_JS = `
fetch('/api/data').then(function (r) { return r.json(); }).then(function (d) {
  document.getElementById('api-result').textContent = d.message;
});
var xhr = new XMLHttpRequest();
xhr.onload = function () {
  document.getElementById('xhr-result').textContent = JSON.parse(xhr.responseText).message;
};
xhr.open('GET', '/api/xhr');
xhr.send();
fetch('/api/echo', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ping: 1 }),
}).then(function (r) { return r.json(); }).then(function (d) {
  document.getElementById('post-result').textContent = String(d.echo.ping);
});
var es = new EventSource('/api/events');
es.onmessage = function (e) {
  document.getElementById('sse-result').textContent = e.data;
  es.close();
};
var ws = new WebSocket('/ws');
ws.onopen = function () { ws.send('hello'); };
ws.onmessage = function (e) {
  document.getElementById('ws-result').textContent = e.data;
  ws.close();
};
document.getElementById('btn').addEventListener('click', function () {
  this.textContent = 'clicked';
});
`;

const SITE_CSS = 'body { font-family: sans-serif; }\n.abs-bg { background: url(/assets/bg.png); }\n';

function encodeWsText(text) {
  const payload = Buffer.from(text);
  const header = [0x81];
  if (payload.length < 126) header.push(payload.length);
  else if (payload.length < 65536) header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  else throw new Error('frame too long for the fixture');
  return Buffer.concat([Buffer.from(header), payload]);
}

/** Minimal WS echo: parse masked client frames, reply with a prefix. */
function wsEcho(socket) {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) return;
      const mask = masked ? buf.subarray(offset, offset + 4) : null;
      let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
      if (mask) {
        const unmasked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) unmasked[i] = payload[i] ^ mask[i % 4];
        payload = unmasked;
      }
      buf = buf.subarray(offset + maskLen + len);
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x1) socket.write(encodeWsText(`ws-echo:${payload.toString('utf8')}`));
    }
  });
}

/** Idempotent: playwright 可能多次加载 config 模块。 */
export function startProxyUpstream() {
  if (globalThis.__pinpointE2eUpstream) return globalThis.__pinpointE2eUpstream;
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://upstream.local');
    hits.push(`${req.method} ${u.pathname}${u.search}`);
    if (u.pathname === '/__hits') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hits));
      return;
    }
    if (u.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'self'",
        'X-Frame-Options': 'DENY',
      });
      res.end(PAGE_HTML);
      return;
    }
    if (u.pathname === '/assets/app.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(APP_JS);
      return;
    }
    if (u.pathname === '/assets/site.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(SITE_CSS);
      return;
    }
    if (u.pathname === '/assets/bg.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(BG_PNG);
      return;
    }
    if (u.pathname === '/api/data') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'api-via-proxy' }));
      return;
    }
    if (u.pathname === '/api/xhr') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'xhr-via-proxy' }));
      return;
    }
    if (u.pathname === '/api/echo' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ echo: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      return;
    }
    if (u.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: sse-via-proxy\n\n');
      const timer = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => clearInterval(timer));
      return;
    }
    if (u.pathname === '/redirect') {
      res.writeHead(302, { Location: '/final' });
      res.end();
      return;
    }
    if (u.pathname === '/final') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><h1>final</h1></body></html>');
      return;
    }
    if (u.pathname === '/cookie') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Set-Cookie': 'sid=42; Path=/; Domain=upstream.local; HttpOnly',
      });
      res.end('cookie set');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('upstream 404');
  });
  server.on('upgrade', (req, socket) => {
    if (!(req.url || '').startsWith('/ws')) {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    wsEcho(socket);
  });
  server.unref(); // config 模块作用域起服，不拖住 playwright 进程退出
  server.on('error', (error) => {
    // config 模块会被 runner 与 worker 各加载一次：后到者 EADDRINUSE，
    // 先到者已在 serve 同一个 fixture —— 这不是故障。
    const level = error.code === 'EADDRINUSE' ? 'reused' : 'failed';
    console.error(`[e2e-proxy-upstream] listen ${level} on ${E2E_UPSTREAM_PORT}: ${error.message}`);
  });
  server.listen(E2E_UPSTREAM_PORT, '127.0.0.1');
  globalThis.__pinpointE2eUpstream = server;
  return server;
}
