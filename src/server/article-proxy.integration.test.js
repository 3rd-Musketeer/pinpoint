/**
 * 文章代理的集成测试：一个真的 vite 服务（pinpoint 自己的 HMR、/@vite/client 都在）
 * 挂上 article-proxy 与 sites-api，文章站点换成测试替身（fixtures/site-dev-stub.mjs，
 * 形状照 Astro 7 + vite base /_astro/ 实测）。证明五件事：文章路径被代理并注入、
 * Astro 内部路径被代理、HMR websocket 被转发、pinpoint 原有路由不受影响、
 * 站点没就绪时给「站点启动中」页。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

import articleProxy from './article-proxy.js';
import { createSiteDevServer } from './lib/site-dev-server.js';
import sitesApi from './sites-api.js';
import workbenchRoutes from './workbench-routes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STUB = path.join(ROOT, 'src', 'server', 'fixtures', 'site-dev-stub.mjs');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(fn, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('until: timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function firstMessage(url, protocol) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, protocol);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`no message from ${url}`)); }, 5000);
    ws.onmessage = (event) => {
      clearTimeout(timer);
      ws.close();
      resolve(JSON.parse(String(event.data)));
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`websocket error on ${url}`)); };
  });
}

const HTML = { accept: 'text/html,application/xhtml+xml' };

/** 裸 websocket 握手（能自己写 Origin 头）：→ { status, frame }，frame 是升级成功后的第一帧文本。 */
function rawUpgrade(port, pathname, origin) {
  return new Promise((resolve, reject) => {
    const headers = {
      connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-protocol': 'vite-hmr',
    };
    if (origin) headers.origin = origin;
    const req = http.request({ host: '127.0.0.1', port, path: pathname, headers });
    req.on('upgrade', (res, socket, head) => {
      const done = (data) => { socket.destroy(); resolve({ status: res.statusCode, frame: JSON.parse(data.subarray(2).toString()) }); };
      if (head && head.length) done(head);
      else socket.once('data', done);
    });
    req.on('response', (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('文章代理：真 vite + 站点替身', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-article-proxy-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const dirSite = path.join(tmp, 'dir-site');
  fs.mkdirSync(dirSite);
  fs.writeFileSync(path.join(dirSite, 'index.html'), '<!doctype html><html><body><p id="dir">dir entry</p></body></html>');

  // 文章 intro 在盘上：注入的桶（画布页 id）要求 index.mdx 存在。
  fs.mkdirSync(path.join(tmp, 'docs', 'pinpoint', 'articles', 'intro'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'docs', 'pinpoint', 'articles', 'intro', 'index.mdx'), '---\ntitle: intro\n---\n');
  // 临时 registry：一条 dir 条目（/sites/ 照旧），一条 project（包 A 的 projects 形状）。
  const registry = {
    entries: [{ id: 'dir-entry', title: 'dir', kind: 'dir', path: dirSite }],
    projects: [{ id: 'demo', title: 'Demo', kind: 'project', path: tmp }],
    resolve: (id) => (id === 'dir-entry' ? registry.entries[0] : null),
  };
  const sitePort = await freePort();
  const devServer = createSiteDevServer({
    cwd: ROOT,
    port: sitePort,
    command: `${JSON.stringify(process.execPath)} ${JSON.stringify(STUB)} --port {port}`.replace('{port}', String(sitePort)),
    env: { ...process.env, STUB_READY_DELAY_MS: '500' },
    logFile: path.join(tmp, 'logs', 'site-dev.log'),
    log: () => {},
  });
  const vitePort = await freePort();
  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    plugins: [workbenchRoutes(), articleProxy({ registry, devServer }), sitesApi({ registry })],
    optimizeDeps: { noDiscovery: true, entries: [] },
    server: { port: vitePort, strictPort: true, host: '127.0.0.1', watch: null },
  });
  await server.listen();
  let closed = false;
  t.after(async () => { if (!closed) await server.close(); await devServer.stop(); });
  const origin = `http://127.0.0.1:${vitePort}`;

  await t.test('按需拉起：服务起来时站点不起；第一次文章请求给「站点启动中」页', async () => {
    assert.equal(devServer.snapshot().state, 'idle');
    const res = await fetch(`${origin}/demo/intro/`, { headers: HTML });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '1');
    const body = await res.text();
    assert.match(body, /<title>站点启动中<\/title>/);
    assert.match(body, /<meta http-equiv="refresh" content="1">/);
    assert.match(body, /data-site-state="starting"/);
    // 非导航请求（脚本、样式）没有自动刷新：它们等站点就绪再转发，不拿 503。
    const asset = await fetch(`${origin}/_astro/assets/site.css`);
    assert.equal(asset.status, 200);
    assert.equal(devServer.snapshot().state, 'ready');
    await asset.text();
  });

  await t.test('文章路径被代理：Astro 看到原路径，HTML 注入标注客户端；annotate=off 不注入', async () => {
    const res = await until(async () => {
      const r = await fetch(`${origin}/demo/intro/`, { headers: HTML });
      if (r.status === 200) return r;
      await r.text();
      return null;
    });
    const body = await res.text();
    assert.match(body, /<h1 id="stub-article">\/demo\/intro\/<\/h1>/);
    assert.match(body, /<script>window\.__pinpointEntry='demo_intro';window\.__pinpointProse=\{"project":"demo","article":"intro"\}<\/script><script src="\/prose[^"]*\.js"><\/script>\n<\/body>/);
    assert.equal(Number(res.headers.get('content-length')), Buffer.byteLength(body));

    const off = await (await fetch(`${origin}/demo/intro/?annotate=off`, { headers: HTML })).text();
    assert.match(off, /stub-article/);
    assert.doesNotMatch(off, /__pinpointEntry/);
    assert.equal(devServer.snapshot().state, 'ready');
  });

  await t.test('Astro 内部路径被代理：/_astro//@vite/client、样式、/_image 原样透传，不注入', async () => {
    const client = await fetch(`${origin}/_astro//@vite/client`);
    assert.equal(client.status, 200);
    assert.equal(await client.text(), '// stub vite client\nexport const stub = true;\n');
    const css = await fetch(`${origin}/_astro/assets/site.css`);
    assert.equal(await css.text(), 'body{color:rgb(1, 2, 3)}\n');
    const image = await fetch(`${origin}/_image?href=%2Fa.png&w=10`);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from('89504e470d0a1a0a', 'hex'));
    const echo = await (await fetch(`${origin}/_astro/__stub/echo?x=1`)).json();
    assert.equal(echo.url, '/_astro/__stub/echo?x=1');
    assert.equal(echo.headers.host, `127.0.0.1:${sitePort}`);
    assert.equal(echo.headers['accept-encoding'], 'identity');
  });

  await t.test('HMR websocket：/_astro/ 转发到站点；pinpoint 自己的 HMR（/）照常', async () => {
    const astro = await firstMessage(`ws://127.0.0.1:${vitePort}/_astro/?token=t1`, 'vite-hmr');
    assert.deepEqual(astro, { type: 'connected', stub: true, url: '/_astro/?token=t1', origin: null });
    const clientCode = await (await fetch(`${origin}/@vite/client`)).text();
    const token = clientCode.match(/wsToken = "([^"]+)"/)[1];
    const own = await firstMessage(`ws://127.0.0.1:${vitePort}/?token=${token}`, 'vite-hmr');
    assert.equal(own.type, 'connected');
    assert.equal(own.stub, undefined);
  });

  await t.test('来源：自己的来源改写成站点地址；别的网页的 websocket 与写请求 403，GET 不带 Origin 过去', async () => {
    const own = await rawUpgrade(vitePort, '/_astro/?token=t2', origin);
    assert.equal(own.status, 101);
    assert.equal(own.frame.origin, `http://127.0.0.1:${sitePort}`);
    for (const foreign of ['https://evil.example', 'http://localhost:1', `http://evil.example:${vitePort}`]) {
      const refused = await rawUpgrade(vitePort, '/_astro/?token=t2', foreign);
      assert.equal(refused.status, 403, foreign);
      assert.match(refused.body, /forbidden: websocket from foreign origin/);
    }
    const echo = async (init) => (await (await fetch(`${origin}/_astro/__stub/echo`, init)).json()).headers.origin;
    assert.equal(await echo({ headers: { origin } }), `http://127.0.0.1:${sitePort}`);
    assert.equal(await echo({ headers: { origin: 'https://pinpoint.localhost' } }), `http://127.0.0.1:${sitePort}`);
    assert.equal(await echo({ headers: { origin: 'https://evil.example' } }), undefined, '别的来源的 GET 不转发 Origin');
    const post = await fetch(`${origin}/demo/intro/`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: 'x' });
    assert.equal(post.status, 403);
    await post.text();
    const ownPost = await fetch(`${origin}/_astro/__stub/echo`, { method: 'POST', headers: { origin }, body: 'x' });
    assert.equal((await ownPost.json()).method, 'POST');
  });

  await t.test('blog 首页与工作台：不带参数的 / 归站点、不注入；旧地址 404；/workbench/ 是工作台壳页', async () => {
    const home = await fetch(`${origin}/`, { headers: HTML });
    assert.equal(home.status, 200);
    const homeBody = await home.text();
    assert.match(homeBody, /<h1 id="stub-article">\/<\/h1>/);
    assert.doesNotMatch(homeBody, /__pinpointEntry|annotate/);
    // 旧地址（/?page=…、/index.html）一律 404 text/plain（迁移期结束，review 建议 1）。
    for (const from of ['/?page=demo_intro&section=flow', '/index.html?page=dir-entry', '/index.html']) {
      const res = await fetch(`${origin}${from}`, { headers: HTML, redirect: 'manual' });
      assert.equal(res.status, 404, from);
      assert.match(res.headers.get('content-type') || '', /text\/plain/, from);
      assert.match(await res.text(), /已退役/, from);
    }
    // 首页带别的 query（utm 之类）照常是 blog 首页。
    const utm = await fetch(`${origin}/?utm_source=review`, { headers: HTML });
    assert.equal(utm.status, 200);
    assert.match(await utm.text(), /<h1 id="stub-article">\/<\/h1>/);
    const shell = await fetch(`${origin}/workbench/?page=demo_intro`, { headers: HTML });
    assert.equal(shell.status, 200);
    const shellBody = await shell.text();
    assert.match(shellBody, /<title>pinpoint<\/title>/);
    assert.match(shellBody, /<base href="\/">/, '壳页里的相对地址（sites/…、previews/…）仍按站点根解析');
    assert.doesNotMatch(shellBody, /stub-article/);
  });

  await t.test('pinpoint 原有路由不受影响：/@vite/client、/sites/、未登记首段', async () => {
    const client = await (await fetch(`${origin}/@vite/client`)).text();
    assert.doesNotMatch(client, /stub vite client/);
    assert.match(client, /createHotContext/);
    const dir = await (await fetch(`${origin}/sites/dir-entry/`)).text();
    assert.match(dir, /<p id="dir">dir entry<\/p>/);
    assert.match(dir, /__pinpointEntry='dir-entry'/);
    const unknown = await (await fetch(`${origin}/not-a-project/`, { headers: HTML })).text();
    assert.doesNotMatch(unknown, /stub-article|站点启动中/);
  });

  await t.test('站点死了：先给启动中页，自动重启后恢复', async () => {
    const before = devServer.snapshot();
    process.kill(-before.pid, 'SIGKILL');
    await until(() => devServer.snapshot().state !== 'ready');
    const waiting = await fetch(`${origin}/demo/intro/`, { headers: HTML });
    assert.equal(waiting.status, 503);
    assert.match(await waiting.text(), /站点启动中/);
    const res = await until(async () => {
      const r = await fetch(`${origin}/demo/intro/`, { headers: HTML });
      if (r.status === 200) return r;
      await r.text();
      return null;
    });
    assert.match(await res.text(), /stub-article/);
    assert.notEqual(devServer.snapshot().pid, before.pid);
  });

  await t.test('站点跟着服务停', async () => {
    const pid = devServer.snapshot().pid;
    assert.ok(pidAlive(pid));
    await server.close();
    closed = true;
    await until(() => !pidAlive(pid));
    assert.equal(devServer.snapshot().state, 'stopped');
  });
});
