import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { request } from '@playwright/test';

import { serviceDownMessage, waitArticleReady } from './ppnt-shot.js';

/** 按脚本依次回状态码的本地服务；脚本用完后一直回最后一个。 */
async function scripted(t, statuses, body = '') {
  let i = 0;
  const server = http.createServer((req, res) => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(status === 200 ? '<h1>ok</h1>' : body || `<h1>${status}</h1>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}/demo/notes/`, hits: () => i };
}

test('waitArticleReady：503（站点启动中）一直等到 200', async (t) => {
  const site = await scripted(t, [503, 503, 200]);
  const ctx = await request.newContext();
  t.after(() => ctx.dispose());
  await waitArticleReady(ctx, site.url, { timeoutMs: 5000, pollMs: 10 });
  assert.equal(site.hits(), 3);
});

test('waitArticleReady：502（站点起不来）立刻报，带页面里的原因', async (t) => {
  const site = await scripted(t, [502], '<h1>站点没起来</h1><pre>astro: port in use</pre>');
  const ctx = await request.newContext();
  t.after(() => ctx.dispose());
  await assert.rejects(waitArticleReady(ctx, site.url, { timeoutMs: 5000, pollMs: 10 }), /文章站点起不来（502）：站点没起来 astro: port in use/);
  assert.equal(site.hits(), 1);
});

test('waitArticleReady：一直 503 到超时，报最后一次的状态和放宽办法', async (t) => {
  const site = await scripted(t, [503]);
  const ctx = await request.newContext();
  t.after(() => ctx.dispose());
  await assert.rejects(waitArticleReady(ctx, site.url, { timeoutMs: 200, pollMs: 20 }), /等文章页就绪超时.*HTTP 503（站点启动中）.*--timeout/);
});

test('serviceDownMessage：隔离运行（设了 PINPOINT_ORIGIN）不叫人 ppnt start', () => {
  assert.match(serviceDownMessage('http://127.0.0.1:6510', { PINPOINT_ORIGIN: 'http://127.0.0.1:6510' }), /PINPOINT_ORIGIN=http:\/\/127\.0\.0\.1:6510 那个服务没答/);
  assert.match(serviceDownMessage('https://pinpoint.localhost', {}), /先 `ppnt start`/);
});
