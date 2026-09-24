/**
 * 分组层的三个写接口（PUT /registry/folders · /registry/entries/:id/folder ·
 * /registry/order）—— workbench 的文件夹操作打的就是这三条。每条都要：校验、
 * 一次原子写、reload 共享 store（HMR 的 registry:update 靠它）、把重载后的
 * 完整 /registry 载荷还回去。拒绝时登记表必须一个字节不动。
 * harness 与 registry-reload.test.js 同款（mock req/res + 直接调 handler）。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAnnotateHandler } from './annotate-api.js';
import { loadRegistry } from './lib/registry.js';
import { createRegistryStore, writeRegistryFile } from './lib/registry-store.js';
import { mockReq, mockRes } from './test-harness.js';

function withFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-folders-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataRoot = path.join(dir, 'data');
  const registryFile = path.join(dir, 'registry.json');
  const site = path.join(dir, 'mysite');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body>x</body></html>');
  // 服务的仓库根：模板页名单从这里读（Component Library 这类页不在登记表里，
  // 但照样要能拖进夹）。
  fs.mkdirSync(path.join(dir, 'content', 'previews'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'content', 'previews', '_index.json'),
    JSON.stringify({ pages: [{ id: 'component-library' }, { id: 'example-library' }] }),
  );
  writeRegistryFile(registryFile, { version: 1, entries: [
    { id: 'mysite', title: 'My Site', kind: 'dir', path: site },
    { id: 'other', title: 'Other', kind: 'url', url: 'https://other.localhost' },
  ] });

  const reloads = [];
  const store = createRegistryStore({ path: registryFile, root: dir, log: () => {} });
  const annotate = createAnnotateHandler({
    dataRoot,
    root: dir,
    registry: store,
    // scope 平铺进捕获对象，既有的 summary 断言照旧可用。
    onRegistryReload: (summary, scope) => reloads.push({ ...summary, scope }),
  });
  return { dir, dataRoot, registryFile, site, store, annotate, reloads };
}



async function call(handler, method, url, body) {
  const req = mockReq(method, url, body === undefined ? undefined : JSON.stringify(body));
  const res = mockRes();
  const handled = await handler(req, res, url.split('?')[0]);
  return { handled, res, json: res.chunks.length ? res.json : null };
}

function readDoc(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('PUT /registry/folders 建夹：写盘 + 重载 + 应答就是完整的 /registry 载荷', async (t) => {
  const f = withFixture(t);
  const { res, json } = await call(f.annotate, 'PUT', '/registry/folders', {
    folders: [{ id: 'shipped', name: '已上线', collapsed: true }, { id: 'wip' }],
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(json.folders, [
    { id: 'shipped', name: '已上线', collapsed: true },
    { id: 'wip', name: 'wip' },
  ]);
  assert.deepEqual(json.entries.map((e) => e.id), ['mysite', 'other'], '应答带完整条目表');
  assert.deepEqual(json.pageFolders, {});
  assert.equal(f.reloads.length, 1, 'HMR 的 registry:update 靠这一次回调');
  assert.equal(f.reloads[0].folders, 1 + 1);
  assert.deepEqual(readDoc(f.registryFile).folders.map((x) => x.id), ['shipped', 'wip']);
  assert.deepEqual(f.store.folders.map((x) => x.id), ['shipped', 'wip'], '活视图立刻生效');
});

test('PUT /registry/folders 删夹不删页：条目变散页，模板页映射一并释放', async (t) => {
  const f = withFixture(t);
  await call(f.annotate, 'PUT', '/registry/folders', { folders: [{ id: 'shipped', name: 'S' }] });
  await call(f.annotate, 'PUT', '/registry/entries/mysite/folder', { folder: 'shipped' });
  await call(f.annotate, 'PUT', '/registry/entries/component-library/folder', { folder: 'shipped' });

  const { json } = await call(f.annotate, 'PUT', '/registry/folders', { folders: [] });
  assert.deepEqual(json.folders, []);
  assert.deepEqual(json.entries.map((e) => e.id), ['mysite', 'other'], '页一个没少');
  assert.equal(json.entries[0].folder, undefined);
  assert.deepEqual(json.pageFolders, {});
});

test('PUT /registry/entries/:id/folder：条目与模板页两条落点，null = 拖成散页', async (t) => {
  const f = withFixture(t);
  await call(f.annotate, 'PUT', '/registry/folders', { folders: [{ id: 'wip', name: '在做' }] });

  const entry = await call(f.annotate, 'PUT', '/registry/entries/mysite/folder', { folder: 'wip', order: 2 });
  assert.equal(entry.res.statusCode, 200);
  assert.equal(entry.json.entries[0].folder, 'wip');
  assert.equal(entry.json.entries[0].order, 2);

  const page = await call(f.annotate, 'PUT', '/registry/entries/component-library/folder', { folder: 'wip' });
  assert.deepEqual(page.json.pageFolders, { 'component-library': 'wip' });
  assert.deepEqual(page.json.entries.map((e) => e.id), ['mysite', 'other'], '模板页不进 entries');

  const loose = await call(f.annotate, 'PUT', '/registry/entries/mysite/folder', { folder: null });
  assert.equal(loose.json.entries[0].folder, undefined);
  assert.equal(f.reloads.length, 4);
});

test('PUT /registry/order：一串 id 按序写 order，条目与模板页各落各处', async (t) => {
  const f = withFixture(t);
  const { res, json } = await call(f.annotate, 'PUT', '/registry/order', {
    ids: ['other', 'component-library', 'mysite'],
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(json.entries.map((e) => [e.id, e.order]), [['mysite', 2], ['other', 0]]);
  assert.deepEqual(json.pageOrder, { 'component-library': 1 });
});

test('三条写接口的广播都带 scope=grouping，/registry/reload 是 entries（审计 B2）', async (t) => {
  const f = withFixture(t);
  await call(f.annotate, 'PUT', '/registry/folders', { folders: [{ id: 'wip', name: '在做' }] });
  await call(f.annotate, 'PUT', '/registry/entries/mysite/folder', { folder: 'wip' });
  await call(f.annotate, 'PUT', '/registry/order', { ids: ['mysite', 'other'] });
  assert.deepEqual(
    f.reloads.map((r) => r.scope),
    ['grouping', 'grouping', 'grouping'],
    '分组与顺序类写接口不触发条目级失效',
  );

  // CLI 写文件后的 reload：条目可能增删改名，照旧条目级。
  writeRegistryFile(f.registryFile, { version: 1, entries: [
    { id: 'mysite', title: 'My Site', kind: 'dir', path: f.site },
    { id: 'other', title: 'Other', kind: 'url', url: 'https://other.localhost' },
  ] });
  const reload = await call(f.annotate, 'POST', '/registry/reload');
  assert.equal(reload.res.statusCode, 200);
  assert.equal(f.reloads[3].scope, 'entries');
});

test('未知 id / 未知文件夹 / 坏形状都是 400 + 一句人话，登记表一个字节不动', async (t) => {
  const f = withFixture(t);
  await call(f.annotate, 'PUT', '/registry/folders', { folders: [{ id: 'wip', name: '在做' }] });
  const raw = fs.readFileSync(f.registryFile, 'utf8');

  const cases = [
    ['/registry/entries/ghost/folder', { folder: 'wip' }, /未知 id：ghost/],
    ['/registry/entries/mysite/folder', { folder: 'nope' }, /文件夹不存在：nope/],
    ['/registry/entries/mysite/folder', { folder: 'wip', order: 'x' }, /order 必须是数字/],
    ['/registry/order', { ids: ['mysite', 'ghost'] }, /未知 id：ghost/],
    ['/registry/order', { ids: 'mysite' }, /必须是数组/],
    ['/registry/folders', { folders: [{ id: 'a' }, { id: 'a' }] }, /id 重复/],
    ['/registry/folders', { folders: [{ id: 'a', color: 'red' }] }, /未知字段：color/],
    ['/registry/folders', {}, /必须是数组/],
  ];
  for (const [url, body, pattern] of cases) {
    const { res, json } = await call(f.annotate, 'PUT', url, body);
    assert.equal(res.statusCode, 400, `${url} ${JSON.stringify(body)}`);
    assert.equal(json.error, 'bad_request');
    assert.match(json.message, pattern);
  }
  assert.equal(fs.readFileSync(f.registryFile, 'utf8'), raw);
  assert.equal(f.reloads.length, 1, '只有那次建夹广播过');
});

test('坏 body 与不认识的 PUT 路径：400 bad_json / 落回下一个中间件', async (t) => {
  const f = withFixture(t);
  const req = mockReq('PUT', '/registry/folders', '{ broken');
  const res = mockRes();
  assert.equal(await f.annotate(req, res, '/registry/folders'), true);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json.error, 'bad_json');

  assert.equal((await call(f.annotate, 'PUT', '/registry/nope', {})).handled, false);
  assert.equal((await call(f.annotate, 'PUT', '/registry/entries/mysite', {})).handled, false);
  assert.equal((await call(f.annotate, 'POST', '/registry/folders', {})).handled, false, 'POST 不是写接口');
});

test('静态快照（不可写的 registry）答 409，不是崩', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-folders-static-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registry = loadRegistry({ path: path.join(dir, 'missing.json'), root: dir, log: () => {} });
  const handler = createAnnotateHandler({ dataRoot: path.join(dir, 'data'), registry });
  const { res } = await call(handler, 'PUT', '/registry/folders', { folders: [] });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json.error, 'registry_not_writable');
});

test('GET /registry 带 folders/pageFolders/pageOrder；/health 的对应字段是数量', async (t) => {
  const f = withFixture(t);
  await call(f.annotate, 'PUT', '/registry/folders', { folders: [{ id: 'wip', name: '在做' }] });
  await call(f.annotate, 'PUT', '/registry/entries/component-library/folder', { folder: 'wip', order: 0 });

  const listed = await call(f.annotate, 'GET', '/registry');
  assert.deepEqual(listed.json.folders, [{ id: 'wip', name: '在做' }]);
  assert.deepEqual(listed.json.pageFolders, { 'component-library': 'wip' });
  assert.deepEqual(listed.json.pageOrder, { 'component-library': 0 });

  const health = await call(f.annotate, 'GET', '/health');
  assert.equal(health.json.registry.entries, 2);
  assert.equal(health.json.registry.folders, 1);
  assert.equal(health.json.registry.pageFolders, 1);
});
