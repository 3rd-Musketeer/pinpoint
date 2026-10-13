import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { createArticleHandler, siteWaitPageHtml } from './article-proxy.js';
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
  const handle = createArticleHandler({ isProject, devServer: fakeDevServer({ state: 'ready', port }) });
  const proxy = http.createServer((req, res) => {
    if (!handle(req, res)) { res.statusCode = 404; res.end('next'); }
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => proxy.close());
  const origin = `http://127.0.0.1:${proxy.address().port}`;

  const page = await fetch(`${origin}/demo/a/?q=1`);
  assert.equal(page.headers.get('x-up'), '/_astro/demo/a/?q=1');
  assert.match(await page.text(), /<h1>a<\/h1><script>window\.__pinpointEntry='demo'<\/script>/);

  const data = await fetch(`${origin}/demo/data.json`);
  assert.equal(await data.text(), '{"a":"</body>"}');

  const gz = await fetch(`${origin}/demo/gz/`);
  assert.equal(gz.headers.get('content-encoding'), null);
  assert.match(await gz.text(), /^<html><body>gz<script>window\.__pinpointEntry='demo'/);

  const head = await fetch(`${origin}/demo/a/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), null);
});
