import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAnnotateHandler, resolveRequestEntry } from './annotate-api.js';
import { loadRegistry } from './lib/registry.js';
import { mockReq, mockRes } from './test-harness.js';

function withFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataRoot = path.join(dir, 'data');
  const registryFile = path.join(dir, 'registry.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    entries: [
      { id: 'pinpoint', title: 'pinpoint workbench', kind: 'dir', path: dir },
      { id: 'web', title: 'web', kind: 'url', url: 'https://web.localhost' },
    ],
  }));
  const registry = loadRegistry({ path: registryFile, root: dir, log: () => {} });
  return { dir, dataRoot, registry, handler: createAnnotateHandler({ dataRoot, registry }) };
}



async function call(handler, method, url, body) {
  const req = mockReq(method, url, body);
  const res = mockRes();
  const handled = await handler(req, res, url.split('?')[0]);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* not JSON */ }
  return { handled, res, json };
}

test('resolveRequestEntry defaults missing entry to pinpoint and flags unknown ids', (t) => {
  const { registry } = withFixture(t);
  assert.deepEqual(resolveRequestEntry(registry, undefined), { entry: 'pinpoint' });
  assert.deepEqual(resolveRequestEntry(registry, ''), { entry: 'pinpoint' });
  assert.deepEqual(resolveRequestEntry(registry, 'web'), { entry: 'web' });
  assert.deepEqual(resolveRequestEntry(registry, 'ghost'), { entry: 'ghost', unknown: true });
  // 桶 = 页：manifest 模板页不在 registry 里，也是合法页桶。
  assert.deepEqual(resolveRequestEntry(registry, 'tpl-page', ['tpl-page']), { entry: 'tpl-page' });
  assert.deepEqual(resolveRequestEntry(registry, 'ghost', ['tpl-page']), { entry: 'ghost', unknown: true });
});

test('manifest pages are valid buckets: /save and /annotations/@canvas round-trip', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-api-page-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataRoot = path.join(dir, 'data');
  const registryFile = path.join(dir, 'registry.json');
  fs.writeFileSync(registryFile, JSON.stringify({ version: 1, entries: [{ id: 'pinpoint', kind: 'dir', path: dir }] }));
  fs.mkdirSync(path.join(dir, 'content', 'previews'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'content', 'previews', '_index.json'), JSON.stringify({ pages: [{ id: 'tpl-page' }] }));
  const registry = loadRegistry({ path: registryFile, root: dir, log: () => {} });
  const handler = createAnnotateHandler({ dataRoot, registry, root: dir });

  const saved = await call(handler, 'POST', '/save', {
    page: '@canvas', entry: 'tpl-page', path: '@canvas', baseRevision: 0, annotations: [{ id: 'c1', content: '画布' }],
  });
  assert.equal(saved.res.statusCode, 200);
  assert.equal(saved.json.saved, path.join(dataRoot, 'tpl-page', '@canvas.json'));
  const read = await call(handler, 'GET', '/annotations/@canvas?entry=tpl-page');
  assert.equal(read.res.statusCode, 200);
  assert.equal(read.json.page, '@canvas');
  assert.deepEqual(read.json.annotations.map((row) => row.content), ['画布']);
});

test('/save without entry lands in the pinpoint bucket', async (t) => {
  const { dataRoot, handler } = withFixture(t);
  const { res, json } = await call(handler, 'POST', '/save', {
    page: 'index.html', baseRevision: 0, annotations: [{ n: 1, content: 'hi' }],
  });
  assert.equal(res.statusCode, 200);
  const saved = path.join(dataRoot, 'pinpoint', 'index.html.json');
  assert.equal(json.saved, saved);
  assert.ok(fs.existsSync(saved));
});

test('/save with a registered entry lands in that entry bucket', async (t) => {
  const { dataRoot, handler } = withFixture(t);
  const { res } = await call(handler, 'POST', '/save', {
    page: 'index.html', entry: 'web', baseRevision: 0, annotations: [{ n: 1 }],
  });
  assert.equal(res.statusCode, 200);
  assert.ok(fs.existsSync(path.join(dataRoot, 'web', 'index.html.json')));
});

test('an unknown entry is a loud 400 and writes nothing', async (t) => {
  const { dataRoot, handler } = withFixture(t);
  const { res, json } = await call(handler, 'POST', '/save', {
    page: 'index.html', entry: 'ghost', baseRevision: 0, annotations: [],
  });
  assert.equal(res.statusCode, 400);
  assert.equal(json.error, 'unknown_entry');
  assert.equal(json.entry, 'ghost');
  assert.ok(!fs.existsSync(path.join(dataRoot, 'ghost')));
});

test('GET /annotations/<page> resolves entry from the query string', async (t) => {
  const { handler } = withFixture(t);
  await call(handler, 'POST', '/save', {
    // n:7 是填料：M1 下新行的号由服务端发，客户端带来的 7 不被采纳。
    page: 'index.html', entry: 'web', baseRevision: 0, annotations: [{ n: 7 }],
  });
  const hit = await call(handler, 'GET', '/annotations/index.html?entry=web');
  assert.equal(hit.res.statusCode, 200);
  assert.deepEqual(hit.json.annotations, [{ n: 1, status: 'open' }]);
  const miss = await call(handler, 'GET', '/annotations/index.html?entry=ghost');
  assert.equal(miss.res.statusCode, 400);
  assert.equal(miss.json.error, 'unknown_entry');
});

test('GET /annotations flattens every bucket into [{entry, page, ...}]', async (t) => {
  const { handler } = withFixture(t);
  await call(handler, 'POST', '/save', {
    page: 'index.html', baseRevision: 0, annotations: [{ n: 1 }],
  });
  await call(handler, 'POST', '/save', {
    page: 'other.html', entry: 'web', baseRevision: 0, annotations: [{ n: 2 }],
  });
  const { res, json } = await call(handler, 'GET', '/annotations');
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(json));
  const byEntry = Object.fromEntries(json.map((doc) => [doc.entry, doc.page]));
  assert.deepEqual(byEntry, { pinpoint: 'index.html', web: 'other.html' });
});

test('/health keeps dataDir as the default bucket and exposes registry state', async (t) => {
  const { dataRoot, registry, handler } = withFixture(t);
  const { res, json } = await call(handler, 'GET', '/health');
  assert.equal(res.statusCode, 200);
  assert.equal(json.ok, true);
  assert.equal(json.dataDir, path.join(dataRoot, 'pinpoint'));
  assert.equal(json.dataRoot, dataRoot);
  // entries / folders / pageFolders 都是数量（完整清单走 GET /registry）。
  assert.deepEqual(json.registry, {
    ok: true, path: registry.path, entries: 2, folders: 0, pageFolders: 0, errors: [], warnings: [],
  });
});

test('/health reports the repo the service runs out of (pinpoint status 拿它比对)', async (t) => {
  const { dataRoot, registry, dir } = withFixture(t);
  // 缺省 = 代码自己所在的仓库根
  const bare = await call(createAnnotateHandler({ dataRoot, registry }), 'GET', '/health');
  assert.equal(bare.json.root, path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'));
  // vite.config 显式传自己的 root
  const wired = await call(createAnnotateHandler({ dataRoot, registry, root: dir }), 'GET', '/health');
  assert.equal(wired.json.root, dir);
});

test('/registry returns the registered entries', async (t) => {
  const { registry, handler } = withFixture(t);
  const { res, json } = await call(handler, 'GET', '/registry');
  assert.equal(res.statusCode, 200);
  assert.equal(json.ok, true);
  assert.deepEqual(json.entries.map((e) => e.id), ['pinpoint', 'web']);
  assert.equal(json.path, registry.path);
});

test('/registry reports the service direct origin for extension injection', async (t) => {
  const { registry, dataRoot } = withFixture(t);
  const handler = createAnnotateHandler({ dataRoot, registry, directOrigin: 'http://127.0.0.1:4612' });
  const { json } = await call(handler, 'GET', '/registry');
  assert.deepEqual(json.service, { directOrigin: 'http://127.0.0.1:4612' });
  // 未接线时（handler 单测默认）也要保持响应形状稳定。
  const bare = await call(withFixture(t).handler, 'GET', '/registry');
  assert.deepEqual(bare.json.service, { directOrigin: null });
});

test('SSE broadcasts carry the entry of the saved bucket', async (t) => {
  const { handler } = withFixture(t);
  const sseRes = mockRes();
  const sseReq = new EventEmitter();
  sseReq.method = 'GET';
  sseReq.url = '/events';
  assert.equal(await handler(sseReq, sseRes, '/events'), true);
  const preludeChunks = sseRes.chunks.length; // ": connected" 前奏已入列，跳过

  await call(handler, 'POST', '/save', {
    page: 'index.html', entry: 'web', baseRevision: 0, annotations: [{ n: 1 }],
  });
  const dataLine = sseRes.chunks.slice(preludeChunks).join('').split('\n').find((line) => line.startsWith('data: '));
  assert.ok(dataLine, 'broadcast chunk received');
  assert.equal(JSON.parse(dataLine.slice('data: '.length)).entry, 'web');
  sseReq.emit('close');
});

test('OPTIONS preflight allows cross-origin GET/POST with Content-Type', async (t) => {
  const { handler } = withFixture(t);
  for (const route of ['/save', '/image', '/annotations/x', '/events', '/registry']) {
    const { handled, res } = await call(handler, 'OPTIONS', route);
    assert.equal(handled, true, route);
    assert.equal(res.statusCode, 204, route);
    assert.equal(res.headers['Access-Control-Allow-Origin'], '*', route);
    assert.ok(res.headers['Access-Control-Allow-Methods'].includes('GET'), route);
    assert.ok(res.headers['Access-Control-Allow-Methods'].includes('POST'), route);
    assert.ok(res.headers['Access-Control-Allow-Headers'].includes('Content-Type'), route);
  }
});

test('every API response carries Access-Control-Allow-Origin *', async (t) => {
  const { handler } = withFixture(t);
  const checks = [
    await call(handler, 'GET', '/health'),
    await call(handler, 'GET', '/registry'),
    await call(handler, 'GET', '/annotations/index.html'),
    await call(handler, 'GET', '/images/missing.png'),
    await call(handler, 'GET', '/annotate.js'),
    await call(handler, 'POST', '/save', {
      page: 'index.html', entry: 'web', baseRevision: 0, annotations: [{ n: 1 }],
    }),
    await call(handler, 'POST', '/image', { entry: 'web', data: 'data:image/png;base64,aGk=' }),
  ];
  for (const { res } of checks) {
    assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
  }
});
