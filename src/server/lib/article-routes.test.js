import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isProjectId,
  isReservedSegment,
  RESERVED_TOP_SEGMENTS,
  routeArticleRequest,
  routeArticleUpgrade,
} from './article-routes.js';
import { loadRegistry } from './registry.js';
import { createRegistryStore } from './registry-store.js';

const projects = new Set(['browser-use', 'demo']);
const isProject = (id) => projects.has(id);

test('routeArticleRequest：登记过的 project 首段进站点，上游带 /_astro 前缀，query 原样', () => {
  assert.deepEqual(routeArticleRequest('/browser-use/commit-confirm/', isProject), {
    kind: 'article', project: 'browser-use', upstream: '/_astro/browser-use/commit-confirm/',
  });
  assert.deepEqual(routeArticleRequest('/browser-use/', isProject), {
    kind: 'article', project: 'browser-use', upstream: '/_astro/browser-use/',
  });
  assert.deepEqual(routeArticleRequest('/browser-use', isProject), {
    kind: 'article', project: 'browser-use', upstream: '/_astro/browser-use',
  });
  assert.deepEqual(routeArticleRequest('/demo/llms.txt', isProject), {
    kind: 'article', project: 'demo', upstream: '/_astro/demo/llms.txt',
  });
  assert.equal(routeArticleRequest('/demo/concepts/%E7%A1%AE%E8%AE%A4/?annotate=off', isProject).upstream,
    '/_astro/demo/concepts/%E7%A1%AE%E8%AE%A4/?annotate=off');
});

test('routeArticleRequest：没登记的首段、保留首段、pinpoint 自己的路由都不归站点', () => {
  assert.equal(routeArticleRequest('/unknown/x/', isProject), null);
  for (const url of ['/', '/index.html', '/health', '/sites/demo/', '/api/frame?page=a', '/annotate.js',
    '/@vite/client', '/@fs/Users/x.js', '/@id/react', '/node_modules/.vite/deps/react.js', '/src/main.js',
    '/kits/ios/ios-kit.js', '/previews/x/a.html', '/registry', '/events', '/__vite_ping']) {
    assert.equal(routeArticleRequest(url, () => true), null, url);
  }
  // 首段即便在 registry 里登记成 project，保留名也不交给站点（包 A 的校验之外的第二道）。
  assert.equal(routeArticleRequest('/sites/x', () => true), null);
  assert.equal(routeArticleRequest('/test-results-5440/a.png', () => true), null);
  // 坏的百分号编码不抛。
  assert.equal(routeArticleRequest('/%E0%A4%A/x', () => true), null);
});

test('routeArticleRequest：Astro 的内部路径走 /_astro/，前缀后的多余斜杠压掉；/_image 补前缀', () => {
  assert.deepEqual(routeArticleRequest('/_astro//@vite/client', isProject), { kind: 'internal', upstream: '/_astro/@vite/client' });
  assert.deepEqual(routeArticleRequest('/_astro/src/pages/a.astro?astro&type=script&index=0&lang.ts', isProject), {
    kind: 'internal', upstream: '/_astro/src/pages/a.astro?astro&type=script&index=0&lang.ts',
  });
  assert.deepEqual(routeArticleRequest('/_astro', isProject), { kind: 'internal', upstream: '/_astro/' });
  assert.deepEqual(routeArticleRequest('/_image?href=%2Fa.png&w=10', isProject), {
    kind: 'internal', upstream: '/_astro/_image?href=%2Fa.png&w=10',
  });
  assert.equal(routeArticleRequest('/_astrology/x', isProject), null);
});

test('routeArticleUpgrade：只有 /_astro/ 下的 websocket 归站点（pinpoint 自己的 HMR 在 /）', () => {
  assert.deepEqual(routeArticleUpgrade('/_astro/?token=abc'), { kind: 'internal', upstream: '/_astro/?token=abc' });
  assert.deepEqual(routeArticleUpgrade('/_astro//?token=abc'), { kind: 'internal', upstream: '/_astro/?token=abc' });
  assert.equal(routeArticleUpgrade('/?token=abc'), null);
  assert.equal(routeArticleUpgrade('/sites/app/ws'), null);
  assert.equal(routeArticleUpgrade('/browser-use/'), null);
});

test('isProjectId：读 resolveProject 或 projects；两样都没有（包 A 未合入）就是没有 project', () => {
  assert.equal(isProjectId({ resolveProject: (id) => (id === 'p' ? { id } : null) }, 'p'), true);
  assert.equal(isProjectId({ resolveProject: () => null }, 'p'), false);
  assert.equal(isProjectId({ projects: [{ id: 'p', kind: 'project' }] }, 'p'), true);
  assert.equal(isProjectId({ entries: [{ id: 'p', kind: 'dir' }], resolve: () => ({ id: 'p' }) }, 'p'), false);
  assert.equal(isProjectId(null, 'p'), false);
  assert.equal(isProjectId({ projects: [] }, ''), false);
});

test('保留首段：服务实际占用的路由都在表里；不符合 id 规则的只有 Astro 内部段与 node_modules', () => {
  for (const name of ['health', 'registry', 'events', 'annotations', 'save', 'image', 'images', 'api', 'sites',
    'kits', 'previews', 'lib', 'src', 'site', 'workbench', 'assets', 'annotate', '_astro', '_image', 'node_modules']) {
    assert.equal(isReservedSegment(name), true, name);
  }
  assert.equal(new Set(RESERVED_TOP_SEGMENTS).size, RESERVED_TOP_SEGMENTS.length);
  assert.deepEqual(RESERVED_TOP_SEGMENTS.filter((name) => !/^[a-z0-9][a-z0-9-]*$/.test(name)).sort(), ['_astro', '_image', 'node_modules']);
  assert.equal(isReservedSegment('playwright-report-5440'), true);
  assert.equal(isReservedSegment('browser-use'), false);
});

test('保留首段：仓库根下 vite 会静态服务的目录名（符合 id 规则的）都在表里', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const missing = fs.readdirSync(root)
    .filter((name) => /^[a-z0-9][a-z0-9-]*$/.test(name))
    .filter((name) => !isReservedSegment(name));
  assert.deepEqual(missing, []);
});

test('isProjectId 读真实 registry：loadRegistry 结果与 live store 都只认 kind project，页条目不算', (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'pp-routes-reg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [
    { id: 'e2e-project', kind: 'project', path: path.join(root, 'e2e', 'project-site') },
    { id: 'a-page', kind: 'dir', path: root },
  ] }));
  for (const registry of [loadRegistry({ root, path: file, log: () => {} }), createRegistryStore({ root, path: file, log: () => {} })]) {
    assert.equal(isProjectId(registry, 'e2e-project'), true);
    assert.equal(isProjectId(registry, 'a-page'), false);
    assert.equal(isProjectId(registry, 'nope'), false);
    assert.deepEqual(routeArticleRequest('/e2e-project/takeover/', (id) => isProjectId(registry, id)),
      { kind: 'article', project: 'e2e-project', upstream: '/_astro/e2e-project/takeover/' });
    assert.equal(routeArticleRequest('/a-page/', (id) => isProjectId(registry, id)), null);
  }
});
