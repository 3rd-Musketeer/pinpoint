import assert from 'node:assert/strict';
import test from 'node:test';

import { routeWorkbenchRequest } from './workbench-routes.js';
import { createWorkbenchHandler } from '../workbench-routes.js';
import { canvasViewHref, workbenchHref, WORKBENCH_PATH } from '../../shared/workbench-url.js';
import { mockReq, mockRes } from '../test-harness.js';

test('routeWorkbenchRequest：旧的画布视图与工作台地址 302 到 /workbench/，参数原样带上', () => {
  for (const [url, location] of [
    ['/?page=areta-agent-dev_hosted-pages', '/workbench/?page=areta-agent-dev_hosted-pages'],
    ['/?page=demo_pay&mode=ios&entry=a&tab=t&section=flow', '/workbench/?page=demo_pay&mode=ios&entry=a&tab=t&section=flow'],
    ['/?page=%E4%B8%AD', '/workbench/?page=%E4%B8%AD'],
    ['/index.html?page=e2e-ios', '/workbench/?page=e2e-ios'],
    ['/index.html', '/workbench/'],
    ['/workbench', '/workbench/'],
    ['/workbench?page=x', '/workbench/?page=x'],
  ]) {
    assert.deepEqual(routeWorkbenchRequest('GET', url), { action: 'redirect', location }, url);
  }
  assert.deepEqual(routeWorkbenchRequest('HEAD', '/?page=x'), { action: 'redirect', location: '/workbench/?page=x' });
});

test('routeWorkbenchRequest：/workbench/ 改写成仓库根的 index.html；不带参数的 / 不归这里（blog 首页）', () => {
  assert.deepEqual(routeWorkbenchRequest('GET', '/workbench/'), { action: 'rewrite', url: '/index.html' });
  assert.deepEqual(routeWorkbenchRequest('GET', '/workbench/?page=a&section=b'), { action: 'rewrite', url: '/index.html?page=a&section=b' });
  assert.deepEqual(routeWorkbenchRequest('GET', '/workbench/index.html?page=a'), { action: 'rewrite', url: '/index.html?page=a' });
  for (const url of ['/', '/?', '/demo/', '/demo/a/', '/sites/x/index.html', '/annotate.js', '/api/frame?page=a',
    '/kits/ios/ios-kit.css', '/previews/x/index.html', '/workbench/x.js', '/workbenches/']) {
    assert.equal(routeWorkbenchRequest('GET', url), null, url);
  }
  assert.equal(routeWorkbenchRequest('POST', '/?page=a'), null);
});

test('工作台中间件：跳转回 302 + Location，改写只换 req.url 交给下一个', () => {
  const handle = createWorkbenchHandler();
  const res = mockRes();
  assert.equal(handle(mockReq('GET', '/?page=a'), res), true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/workbench/?page=a');

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
