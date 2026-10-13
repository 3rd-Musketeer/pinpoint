#!/usr/bin/env node
/**
 * 文章站点开发服务器的测试替身：行为照 Astro 7 + vite base /_astro/ 的实测形状
 * （见 src/server/lib/article-routes.js 文件头），不依赖 site/ 与 astro 安装。
 *
 *   --port <n> 或 PINPOINT_SITE_PORT   监听端口（127.0.0.1）
 *   PINPOINT_SITE_VITE_BASE            必须是 /_astro/，否则所有请求 404（vite 不认 base 外的路径）
 *   STUB_READY_DELAY_MS                延迟这么久才开始监听（测「站点启动中」页）
 *   STUB_EXIT_CODE                     立刻以这个退出码退出（测崩溃重启 / 放弃）
 *   STUB_IGNORE_SIGTERM                收到 SIGTERM 不退（测停服时的 SIGKILL 兜底）
 *
 * 路由（全部在 /_astro/ 下）：
 *   @vite/client      JS
 *   assets/<x>.css    CSS
 *   _image            PNG 字节
 *   __stub/echo       JSON：上游看到的 url、method、headers、pid
 *   <其他>            HTML 文章页（带 /_astro//@vite/client 脚本，与 Astro 的双斜杠同形）
 *   upgrade /_astro/  子协议 vite-hmr 的 websocket 握手，发一帧 {"type":"connected","stub":true,url,origin}
 *                     （origin = 站点看到的 Origin 头，没有为 null）
 */
import crypto from 'node:crypto';
import http from 'node:http';

if (process.env.STUB_EXIT_CODE) process.exit(Number(process.env.STUB_EXIT_CODE));

const argPort = process.argv.indexOf('--port');
const port = Number(argPort >= 0 ? process.argv[argPort + 1] : process.env.PINPOINT_SITE_PORT);
const base = process.env.PINPOINT_SITE_VITE_BASE || '/';
const delay = Number(process.env.STUB_READY_DELAY_MS || 0);

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (base !== '/_astro/' || !url.startsWith('/_astro/')) {
    send(res, 404, 'text/plain; charset=utf-8', `stub: base is ${base}, not /_astro/`);
    return;
  }
  const rest = url.slice('/_astro/'.length);
  const pathname = rest.split('?')[0];
  if (pathname === '@vite/client') {
    send(res, 200, 'text/javascript', '// stub vite client\nexport const stub = true;\n');
  } else if (pathname.startsWith('assets/') && pathname.endsWith('.css')) {
    send(res, 200, 'text/css', 'body{color:rgb(1, 2, 3)}\n');
  } else if (pathname === '_image') {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
    res.end(png);
  } else if (pathname === '__stub/echo') {
    send(res, 200, 'application/json', JSON.stringify({ url, method: req.method, headers: req.headers, pid: process.pid }));
  } else {
    const appPath = '/' + pathname;
    send(res, 200, 'text/html; charset=utf-8', `<!DOCTYPE html><html><head><title>stub article</title>
<script type="module" src="/_astro//@vite/client"></script>
<link rel="stylesheet" href="/_astro/assets/site.css"></head>
<body><h1 id="stub-article">${appPath}</h1></body></html>`);
  }
});

server.on('upgrade', (req, socket) => {
  const protocol = req.headers['sec-websocket-protocol'];
  if (!(req.url || '').startsWith('/_astro/') || protocol !== 'vite-hmr') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    'Sec-WebSocket-Protocol: vite-hmr',
    '', '',
  ].join('\r\n'));
  const payload = Buffer.from(JSON.stringify({ type: 'connected', stub: true, url: req.url, origin: req.headers.origin || null }));
  // 服务端帧不加掩码；payload < 126 字节，长度直接放第二个字节。
  socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  socket.on('error', () => {});
});

function shutdown() {
  server.close();
  process.exit(0);
}
process.on('SIGTERM', process.env.STUB_IGNORE_SIGTERM ? () => {} : shutdown);
process.on('SIGINT', shutdown);

setTimeout(() => server.listen(port, '127.0.0.1'), delay);
