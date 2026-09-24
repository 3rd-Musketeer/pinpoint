import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRebaseExemptPath,
  rebaseProxyUrl,
  rebaseProxyWsUrl,
  virtualAppPath,
} from './proxy-rebase.js';

const CFG = {
  prefix: '/sites/app',
  targetOrigin: 'https://app.localhost',
  selfOrigin: 'https://pinpoint.localhost',
  selfProtocol: 'https:',
  selfHost: 'pinpoint.localhost',
};

test('root-absolute paths rebase onto the prefix', () => {
  assert.equal(rebaseProxyUrl('/api/todos', CFG), '/sites/app/api/todos');
  assert.equal(rebaseProxyUrl('/assets/x.js?v=1#t', CFG), '/sites/app/assets/x.js?v=1#t');
  assert.equal(rebaseProxyUrl('/', CFG), '/sites/app/');
});

test('already-prefixed and other-origin URLs pass through', () => {
  assert.equal(rebaseProxyUrl('/sites/app/api/todos', CFG), '/sites/app/api/todos');
  assert.equal(rebaseProxyUrl('/sites/app', CFG), '/sites/app');
  assert.equal(rebaseProxyUrl('/sites/other/x', CFG), '/sites/other/x');
  assert.equal(rebaseProxyUrl('//cdn.example.com/x.js', CFG), '//cdn.example.com/x.js');
  assert.equal(rebaseProxyUrl('https://unrelated.example.com/api', CFG), 'https://unrelated.example.com/api');
  assert.equal(rebaseProxyUrl('relative/path.json', CFG), 'relative/path.json');
  assert.equal(rebaseProxyUrl('', CFG), '');
  assert.equal(rebaseProxyUrl(null, CFG), null);
});

test('the annotate client API is exempt (in-page client stays on pinpoint)', () => {
  for (const path of ['/save', '/image', '/annotations', '/events', '/annotate.js']) {
    assert.equal(rebaseProxyUrl(path, CFG), path, path);
  }
  // 客户端按内容哈希地址加载（审计 B3）：豁免按严格形状 ^/annotate\.[0-9a-f]{10}\.js$，
  // 不是 /annotate. 前缀——目标应用自己的 /annotate.* 资源必须照常重基
  //（前缀豁免曾把它们错打到 pinpoint origin，拿到 SPA fallback 的 HTML）。
  assert.equal(isRebaseExemptPath('/annotate.44bc529372.js'), true);
  assert.equal(rebaseProxyUrl('/annotate.44bc529372.js', CFG), '/annotate.44bc529372.js');
  for (const path of [
    '/annotate.css',
    '/annotate.html',
    '/annotate.v2.js',
    '/annotate.min.js',
    '/annotate.worker.js',
    '/annotate.44bc52937.css',   // 哈希形状但扩展名不对
    '/annotate.44bc529372.mjs',  // 哈希长度对但扩展名不对
    '/annotate.44bc52937.js',    // 哈希短一位
  ]) {
    assert.equal(isRebaseExemptPath(path), false, path);
    assert.equal(rebaseProxyUrl(path, CFG), `/sites/app${path}`, path);
  }
  // annotate 命名空间之外的前缀撞不上：/annotations/ 另有豁免，其余照重基。
  assert.equal(isRebaseExemptPath('/annotation.js'), false);
  assert.equal(rebaseProxyUrl('/annotations/index.html~abc?entry=app', CFG), '/annotations/index.html~abc?entry=app');
  assert.equal(rebaseProxyUrl('/images/shot.png?entry=app', CFG), '/images/shot.png?entry=app');
  // 绝对形态（client 用 script origin 拼 SERVER + '/save'）同样豁免。
  assert.equal(
    rebaseProxyUrl('https://pinpoint.localhost/save', CFG),
    'https://pinpoint.localhost/save',
  );
  assert.equal(
    rebaseProxyUrl('https://pinpoint.localhost/annotate.44bc529372.js', CFG),
    'https://pinpoint.localhost/annotate.44bc529372.js',
  );
  assert.equal(
    rebaseProxyUrl('https://pinpoint.localhost/annotate.css', CFG),
    '/sites/app/annotate.css',
    '非哈希形状的绝对路径照常重基',
  );
});

test('same-origin and target-origin absolute URLs rebase; other origins stay', () => {
  assert.equal(
    rebaseProxyUrl('https://pinpoint.localhost/api/todos?x=1', CFG),
    '/sites/app/api/todos?x=1',
  );
  assert.equal(
    rebaseProxyUrl('https://app.localhost/api/todos', CFG),
    '/sites/app/api/todos',
  );
  assert.equal(
    rebaseProxyUrl('https://app.localhost/sites/app/api', CFG),
    'https://app.localhost/sites/app/api',
    'already-prefixed target-origin URL passes through (browser resolves the rewritten form)',
  );
});

test('isRebaseExemptPath: exact names and prefixes only', () => {
  assert.equal(isRebaseExemptPath('/save'), true);
  assert.equal(isRebaseExemptPath('/saved'), false, 'exact match, not prefix — /saved belongs to the app');
  assert.equal(isRebaseExemptPath('/image'), true);
  assert.equal(isRebaseExemptPath('/images'), false, 'only /images/ below');
  assert.equal(isRebaseExemptPath('/images/x.png'), true);
  assert.equal(isRebaseExemptPath('/events'), true);
  assert.equal(isRebaseExemptPath('/events/live'), false, 'app-owned sub-path under an exempt name still rebases');
  assert.equal(isRebaseExemptPath('/api/events'), false);
});

test('WebSocket: root-absolute expands against the page origin after rebasing', () => {
  assert.equal(rebaseProxyWsUrl('/ws', CFG), 'wss://pinpoint.localhost/sites/app/ws');
  assert.equal(rebaseProxyWsUrl('/sites/app/ws', CFG), 'wss://pinpoint.localhost/sites/app/ws');
  assert.equal(rebaseProxyWsUrl('/events', CFG), 'wss://pinpoint.localhost/events', 'exempt paths stay unprefixed');
  assert.equal(
    rebaseProxyWsUrl('/annotate.sock', CFG),
    'wss://pinpoint.localhost/sites/app/annotate.sock',
    '目标应用自己的 ws 端点照常重基（前缀豁免曾把它指到 pinpoint origin）',
  );
  assert.equal(
    rebaseProxyWsUrl('/annotate.44bc529372.js', CFG),
    'wss://pinpoint.localhost/annotate.44bc529372.js',
    '哈希形状的豁免对 WS 一致',
  );
});

test('哈希豁免正则与 annotate-bundle 的产物地址形状一致（SSOT 在 annotate-bundle）', async () => {
  const { ANNOTATE_BUNDLE_URL_RE } = await import('../server/lib/annotate-bundle.js');
  const { ANNOTATE_HASHED_URL_RE } = await import('./proxy-rebase.js');
  // 路由正则带捕获组（取哈希用），豁免判定不需要：去掉捕获组后 source 必须逐字节相同。
  assert.equal(ANNOTATE_HASHED_URL_RE.source, ANNOTATE_BUNDLE_URL_RE.source.replaceAll('(', '').replaceAll(')', ''));
});

test('WebSocket: absolute ws(s) URLs to self or target origin rebase back onto the proxy', () => {
  assert.equal(
    rebaseProxyWsUrl('wss://pinpoint.localhost/ws', CFG),
    'wss://pinpoint.localhost/sites/app/ws',
  );
  assert.equal(
    rebaseProxyWsUrl('wss://app.localhost/socket?token=1', CFG),
    'wss://pinpoint.localhost/sites/app/socket?token=1',
  );
  assert.equal(
    rebaseProxyWsUrl('ws://app.localhost/socket', CFG),
    'wss://pinpoint.localhost/sites/app/socket',
    'scheme follows the page, not the input',
  );
  assert.equal(rebaseProxyWsUrl('wss://elsewhere.example.com/ws', CFG), 'wss://elsewhere.example.com/ws');
});

test('http page protocol downgrades the WS self origin to ws://', () => {
  const cfg = { ...CFG, selfProtocol: 'http:', selfHost: '127.0.0.1:5199', selfOrigin: 'http://127.0.0.1:5199' };
  assert.equal(rebaseProxyWsUrl('/ws', cfg), 'ws://127.0.0.1:5199/sites/app/ws');
});

test('virtualAppPath: prefixed locations map back to the app-visible path', () => {
  assert.equal(virtualAppPath('/sites/app', '/sites/app'), '/');
  assert.equal(virtualAppPath('/sites/app/', '/sites/app'), '/');
  assert.equal(virtualAppPath('/sites/app/global', '/sites/app'), '/global');
  assert.equal(virtualAppPath('/sites/app/global/inbox', '/sites/app'), '/global/inbox');
  assert.equal(virtualAppPath('/other/page', '/sites/app'), '/other/page', '前缀之外不动');
  assert.equal(virtualAppPath('/sites/app2/x', '/sites/app'), '/sites/app2/x', '前缀必须整段匹配');
});
