import assert from 'node:assert/strict';
import test from 'node:test';

import { routeWorkbenchRequest } from './workbench-routes.js';
import { createWorkbenchHandler } from '../workbench-routes.js';
import { canvasViewHref, workbenchHref, WORKBENCH_PATH } from '../../shared/workbench-url.js';
import { mockReq, mockRes } from '../test-harness.js';

test('routeWorkbenchRequest：/workbench 补尾斜杠 302；旧的 /?page= 与 /index.html 一律 404（迁移期结束）', () => {
  assert.deepEqual(routeWorkbenchRequest('GET', '/workbench'), { action: 'redirect', location: '/workbench/' });
  assert.deepEqual(routeWorkbenchRequest('GET', '/workbench?page=x'), { action: 'redirect', location: '/workbench/?page=x' });
  for (const url of ['/?page=a', '/?page=demo_pay&section=flow', '/?embed=overlay&gen=2', '/?tab=t', '/index.html', '/index.html?page=e2e-ios']) {
    assert.deepEqual(routeWorkbenchRequest('GET', url), { action: 'notFound' }, url);
  }
  assert.deepEqual(routeWorkbenchRequest('HEAD', '/index.html'), { action: 'notFound' });
});

test('routeWorkbenchRequest：/workbench/ 改写成仓库根的 index.html；首页（含不带深链参数的 query）不归这里（blog 首页）', () => {
  assert.deepEqual(routeWorkbenchRequest('GET', '/workbench/'), { action: 'rewrite', url: '/index.html' });
  assert.deepEqual(routeWorkbenchRequest('GET', '/workbench/?page=a&section=b'), { action: 'rewrite', url: '/index.html?page=a&section=b' });
  assert.deepEqual(routeWorkbenchRequest('GET', '/workbench/index.html?page=a'), { action: 'rewrite', url: '/index.html?page=a' });
  for (const url of ['/', '/?', '/?utm_source=review', '/demo/', '/demo/a/', '/sites/x/index.html', '/annotate.js', '/api/frame?page=a',
    '/kits/ios/ios-kit.css', '/previews/x/index.html', '/workbench/x.js', '/workbenches/']) {
    assert.equal(routeWorkbenchRequest('GET', url), null, url);
  }
  assert.equal(routeWorkbenchRequest('POST', '/?page=a'), null);
});

test('工作台中间件：补尾斜杠回 302 + Location，旧地址回 404 + text，改写只换 req.url 交给下一个', () => {
  const handle = createWorkbenchHandler();
  const res = mockRes();
  assert.equal(handle(mockReq('GET', '/workbench?page=a'), res), true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/workbench/?page=a');

  // 旧地址 404，不再放出壳页。
  const gone = mockRes();
  assert.equal(handle(mockReq('GET', '/?page=a'), gone), true);
  assert.equal(gone.statusCode, 404);
  assert.match(gone.headers['Content-Type'], /text\/plain/);
  assert.match(String(gone.body), /已退役/);

  const req = mockReq('GET', '/workbench/?page=a');
  assert.equal(handle(req, mockRes()), false);
  assert.equal(req.url, '/index.html?page=a');

  const home = mockReq('GET', '/');
  assert.equal(handle(home, mockRes()), false);
  assert.equal(home.url, '/');
});

test('workbench-url：画布视图地址在 /workbench/ 下', () => {
  assert.equal(WORKBENCH_PATH, '/workbench/');
  assert.equal(workbenchHref(), '/workbench/');
  assert.equal(workbenchHref('page=a'), '/workbench/?page=a');
  assert.equal(canvasViewHref('demo_pay'), '/workbench/?page=demo_pay');
  assert.equal(canvasViewHref('demo_pay', 'flow'), '/workbench/?page=demo_pay&section=flow');
});
