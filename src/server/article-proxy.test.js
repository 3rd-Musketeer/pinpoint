import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createArticleHandler, createArticleUpgradeHandler, siteWaitPageHtml } from './article-proxy.js';
import { mockReq, mockRes } from './test-harness.js';

function fakeDevServer(snapshot, extra = {}) {
  return {
    port: snapshot.port,
    ensured: 0,
    ensure() { this.ensured++; return snapshot; },
    snapshot: () => snapshot,
    noteUnreachable() {},
    logTail: () => ['line 1', '<b>line 2</b>'],
    ...extra,
  };
}

const isProject = (id) => id === 'demo';

/** project demo 登记在临时目录，文章目录在盘上（注入的桶要求文章存在）。 */
function demoRegistry(t, articles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-article-proxy-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const id of articles) {
    const dir = path.join(root, 'docs', 'pinpoint', 'articles', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.mdx'), `---\ntitle: ${id}\n---\n`);
  }
  return { entries: [], projects: [{ id: 'demo', kind: 'project', path: root }], resolve: () => null };
}

test('不归站点的请求不碰：返回 false，也不拉起站点', () => {
  const dev = fakeDevServer({ state: 'idle', port: 1 });
  const handle = createArticleHandler({ isProject, devServer: dev });
  for (const url of ['/index.html', '/sites/x/', '/@vite/client', '/other/x/']) {
    assert.equal(handle(mockReq('GET', url), mockRes()), false, url);
  }
  assert.equal(dev.ensured, 0);
});

test('站点没就绪：导航给启动中页（503，自动刷新），failed 给原因与日志尾巴（502，HTML 转义）', () => {
  const starting = fakeDevServer({ state: 'starting', port: 4530, command: 'npm run site:dev' });
  const handle = createArticleHandler({ isProject, devServer: starting });
  const req = mockReq('GET', '/demo/a/');
  req.headers.accept = 'text/html';
  const res = mockRes();
  assert.equal(handle(req, res), true);
  assert.equal(starting.ensured, 1);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.match(res.text, /<h1>站点启动中<\/h1>/);
  assert.match(res.text, /端口 4530/);

  const failed = fakeDevServer({ state: 'failed', port: 4530, command: 'npm run site:dev', lastError: 'exit <3>', logFile: '/x/site-dev.log' });
  const res2 = mockRes();
  const req2 = mockReq('GET', '/demo/a/');
  req2.headers.accept = 'text/html';
  createArticleHandler({ isProject, devServer: failed })(req2, res2);
  assert.equal(res2.statusCode, 502);
  assert.match(res2.text, /<h1>站点没有起来<\/h1>/);
  assert.match(res2.text, /exit &lt;3&gt;/);
  assert.match(res2.text, /&lt;b&gt;line 2&lt;\/b&gt;/);
  assert.match(res2.text, /content="5"/);
});

test('来源：别的网页发来的写请求与 websocket upgrade 回 403，不拉起站点；自己的来源与没有 Origin 照常', () => {
  const dev = fakeDevServer({ state: 'starting', port: 4530, command: 'x' });
  const origins = new Set(['https://pinpoint.localhost']);
  const handle = createArticleHandler({ isProject, devServer: dev, origins });
  const post = mockReq('POST', '/demo/a/');
  post.headers.origin = 'https://evil.example';
  const res = mockRes();
  assert.equal(handle(post, res), true);
  assert.equal(res.statusCode, 403);
  assert.match(res.text, /foreign origin https:\/\/evil\.example/);
  assert.equal(dev.ensured, 0, '被拒的请求不拉起站点');
  for (const origin of ['https://pinpoint.localhost', undefined]) {
    const req = mockReq('POST', '/demo/a/');
    if (origin) req.headers.origin = origin;
    const ok = mockRes();
    handle(req, ok);
    assert.equal(ok.statusCode, 503, `${origin} 走到站点（这里站点还在启动）`);
  }
  const getFromElsewhere = mockReq('GET', '/_astro/@vite/client');
  getFromElsewhere.headers.origin = 'https://evil.example';
  const got = mockRes();
  handle(getFromElsewhere, got);
  assert.equal(got.statusCode, 503, '别的来源的 GET 放行（不转发 Origin，见集成测试）');

  const upgrade = createArticleUpgradeHandler({ devServer: dev, origins });
  const written = [];
  const socket = { end: (text) => written.push(text), write() {}, destroy() {} };
  const ensuredBefore = dev.ensured;
  upgrade({ url: '/_astro/?token=x', method: 'GET', headers: { origin: 'http://localhost:3000' } }, socket, Buffer.alloc(0));
  assert.match(written[0], /^HTTP\/1\.1 403 Forbidden\r\n/);
  assert.equal(dev.ensured, ensuredBefore);
});

test('siteWaitPageHtml：启动中不带日志；页面自带浅色 / 深色两套颜色', () => {
  const html = siteWaitPageHtml({ state: 'starting', port: 4530 }, ['secret log']);
  assert.doesNotMatch(html, /secret log/);
  assert.match(html, /prefers-color-scheme:dark/);
});

test('代理：HTML 注入、非 HTML 原样、HEAD 不带体；上游 gzip 的 HTML 解压后注入', async (t) => {
  const zlib = await import('node:zlib');
  const upstream = http.createServer((req, res) => {
    if (req.url.startsWith('/_astro/demo/gz/')) {
      const body = zlib.gzipSync('<html><body>gz</body></html>');
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': body.length });
      res.end(body);
    } else if (req.url.startsWith('/_astro/demo/data.json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"a":"</body>"}');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Up': req.url });
      res.end('<html><body><h1>a</h1></body></html>');
    }
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const { port } = upstream.address();
  const registry = demoRegistry(t, ['a', 'gz']);
  const handle = createArticleHandler({ registry, isProject, devServer: fakeDevServer({ state: 'ready', port }) });
  const proxy = http.createServer((req, res) => {
    if (!handle(req, res)) { res.statusCode = 404; res.end('next'); }
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());
  const origin = `http://127.0.0.1:${proxy.address().port}`;

  const page = await fetch(`${origin}/demo/a/?q=1`);
  assert.equal(page.headers.get('x-up'), '/_astro/demo/a/?q=1');
  assert.match(await page.text(), /<h1>a<\/h1><script>window\.__pinpointEntry='demo_a';window\.__pinpointProse=\{"project":"demo","article":"a"\}<\/script>/);

  // project 首页、概念页不是文章页，不存在的文章没有桶：都不注入。
  for (const p of ['/demo/', '/demo/concepts/x/', '/demo/ghost/']) {
    const other = await fetch(`${origin}${p}`);
    assert.doesNotMatch(await other.text(), /__pinpoint/, p);
  }

  const data = await fetch(`${origin}/demo/data.json`);
  assert.equal(await data.text(), '{"a":"</body>"}');

  const gz = await fetch(`${origin}/demo/gz/`);
  assert.equal(gz.headers.get('content-encoding'), null);
  assert.match(await gz.text(), /^<html><body>gz<script>window\.__pinpointEntry='demo_gz'/);

  const head = await fetch(`${origin}/demo/a/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), null);
});
