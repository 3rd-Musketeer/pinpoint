import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createServer } from 'vite';
import loopbackListener from './loopback-listener.js';

async function start(t, port = 0) {
  if (!port) {
    const reservation = net.createServer();
    reservation.listen({ host: '127.0.0.1', port: 0 });
    await once(reservation, 'listening');
    port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-loopback-test-'));
  const server = await createServer({
    root, cacheDir: path.join(root, 'vite-cache'),
    configFile: false, logLevel: 'silent', appType: 'custom',
    server: { host: '127.0.0.1', port, strictPort: true, watch: null },
    plugins: [loopbackListener(), { name: 'fixture', configureServer(s) {
      s.middlewares.use((req, res) => res.end(`来自 ${req.socket.localAddress}`));
    } }],
  });
  t.after(async () => {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await server.listen();
  return server;
}

test('双回环入口共享 HTTP 与 upgrade，关闭和重启后均释放 IPv6 端口', async (t) => {
  const server = await start(t);
  let port = server.httpServer.address().port;
  assert.equal(server.httpServer.address().address, '127.0.0.1');
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), '来自 127.0.0.1');
  assert.equal(await (await fetch(`http://[::1]:${port}`)).text(), '来自 ::1');
  // 真实 upgrade 也必须进入同一个 HTTP server，HMR 依赖这条路径。
  server.httpServer.on('upgrade', (req, socket) => {
    if (req.url === '/probe') socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: probe\r\n\r\n');
  });
  const req = http.request({ host: '::1', port, path: '/probe', headers: { Connection: 'Upgrade', Upgrade: 'probe' } });
  const upgraded = once(req, 'upgrade');
  req.end();
  const [response, socket] = await upgraded;
  assert.equal(response.statusCode, 101);
  socket.destroy();
  await server.restart();
  port = server.httpServer.address().port;
  assert.equal(await (await fetch(`http://[::1]:${port}`)).text(), '来自 ::1');
  await server.close();
  const replacement = net.createServer();
  t.after(() => replacement.close());
  replacement.listen({ host: '::1', port, ipv6Only: true });
  await once(replacement, 'listening');
});

test('IPv6 端口冲突时启动失败并释放 IPv4 入口，不留下半启动服务', async (t) => {
  const occupied = net.createServer();
  t.after(() => occupied.close());
  occupied.listen({ host: '::1', port: 0, ipv6Only: true });
  await once(occupied, 'listening');
  const port = occupied.address().port;
  await assert.rejects(start(t, port), { code: 'EADDRINUSE' });
  const replacement = net.createServer();
  t.after(() => replacement.close());
  replacement.listen({ host: '127.0.0.1', port });
  await once(replacement, 'listening');
});
