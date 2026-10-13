import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('保留首段：服务实际占用的路由都在表里，且都符合 id 规则', () => {
  for (const name of ['health', 'registry', 'events', 'annotations', 'save', 'image', 'images', 'api', 'sites',
    'kits', 'previews', 'lib', 'src', 'site', 'workbench', 'assets', 'annotate']) {
    assert.equal(isReservedSegment(name), true, name);
  }
  assert.equal(new Set(RESERVED_TOP_SEGMENTS).size, RESERVED_TOP_SEGMENTS.length);
  for (const name of RESERVED_TOP_SEGMENTS) assert.match(name, /^[a-z0-9][a-z0-9-]*$/);
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
