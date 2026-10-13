import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PINPOINT_ORIGIN, listenOrigins, normalizeOrigin, originDecision, originsGetter, ownOrigins } from './proxy-origin.js';

const UPSTREAM = 'http://127.0.0.1:4530';

test('ownOrigins：缺省地址、PINPOINT_ORIGIN、PORTLESS_URL、直连端口的三种写法；规范成 URL.origin', () => {
  const own = ownOrigins({ env: { PINPOINT_ORIGIN: 'https://pp.localhost:8443/', PORTLESS_URL: 'https://Pinpoint.localhost:1355' }, port: 5199 });
  assert.deepEqual([...own].sort(), [
    'http://127.0.0.1:5199',
    'http://[::1]:5199',
    'http://localhost:5199',
    'https://pinpoint.localhost',
    'https://pinpoint.localhost:1355',
    'https://pp.localhost:8443',
  ]);
  assert.deepEqual([...ownOrigins({ env: {} })], [DEFAULT_PINPOINT_ORIGIN], '没有端口、没有环境变量：只剩缺省地址');
  assert.deepEqual([...ownOrigins({ env: { PINPOINT_ORIGIN: 'not a url' } })], [DEFAULT_PINPOINT_ORIGIN]);
});

test('normalizeOrigin：默认端口去掉、大小写归一；null 与非 http(s) 来源不算来源', () => {
  assert.equal(normalizeOrigin('https://pinpoint.localhost:443'), 'https://pinpoint.localhost');
  assert.equal(normalizeOrigin('HTTP://127.0.0.1:5199'), 'http://127.0.0.1:5199');
  assert.equal(normalizeOrigin('null'), null);
  assert.equal(normalizeOrigin('chrome-extension://abc'), null);
  assert.equal(normalizeOrigin(''), null);
});

test('originDecision：自己的来源改写成站点地址；没有 Origin 放行不加；别的来源 upgrade 与写请求 403、GET 不转发 Origin', () => {
  const own = ownOrigins({ env: {}, port: 5199 });
  const at = (origin, extra = {}) => originDecision({ origin, own, upstreamOrigin: UPSTREAM, ...extra });

  for (const origin of ['https://pinpoint.localhost', 'http://127.0.0.1:5199', 'http://localhost:5199']) {
    assert.deepEqual(at(origin, { upgrade: true }), { allow: true, origin: UPSTREAM }, `ws ${origin}`);
    assert.deepEqual(at(origin, { method: 'POST' }), { allow: true, origin: UPSTREAM }, `POST ${origin}`);
  }
  assert.deepEqual(at(undefined, { upgrade: true }), { allow: true, origin: undefined });
  assert.deepEqual(at(undefined, { method: 'POST' }), { allow: true, origin: undefined });

  // 别的网页：公网站点、本机别的端口、DNS rebinding 到 127.0.0.1 的域名、沙箱 iframe 的 null。
  for (const origin of ['https://evil.example', 'http://localhost:3000', 'http://127.0.0.1:5200', 'http://evil.example:5199', 'null']) {
    const ws = at(origin, { upgrade: true });
    assert.equal(ws.allow, false, `ws ${origin}`);
    assert.equal(ws.status, 403);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      assert.equal(at(origin, { method }).allow, false, `${method} ${origin}`);
    }
    assert.deepEqual(at(origin, { method: 'GET' }), { allow: true, origin: undefined }, `GET ${origin}`);
    assert.deepEqual(at(origin, { method: 'head' }), { allow: true, origin: undefined }, `HEAD ${origin}`);
  }
  // upgrade 不看方法：别的来源的 GET upgrade 也拒。
  assert.equal(at('https://evil.example', { upgrade: true, method: 'GET' }).allow, false);
});

test('originsGetter / listenOrigins：Set 原样、函数照调；监听上之后按实际端口算并缓存，没监听时退回 config 端口', () => {
  const fixed = new Set(['https://a.example']);
  assert.equal(originsGetter(fixed)(), fixed);
  const fn = () => fixed;
  assert.equal(originsGetter(fn), fn);
  assert.ok(originsGetter(undefined)().has(DEFAULT_PINPOINT_ORIGIN));

  let address = null;
  const server = { httpServer: { address: () => address }, config: { server: { port: 5199 } } };
  const get = listenOrigins(() => server);
  assert.ok(get().has('http://127.0.0.1:5199'), '没监听：config.server.port');
  address = { port: 6123 };
  const listening = get();
  assert.ok(listening.has('http://127.0.0.1:6123') && !listening.has('http://127.0.0.1:5199'), '监听上：实际端口');
  address = { port: 7000 };
  assert.equal(get(), listening, '缓存');
  assert.ok(listenOrigins(() => null)().has(DEFAULT_PINPOINT_ORIGIN), 'vite server 还没有：只剩缺省来源');
});
