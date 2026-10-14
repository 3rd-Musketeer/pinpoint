/**
 * 标注 API 的路由优先级：每一种请求形状由哪条分支答，哪些交给下一个中间件。
 *
 * handleAnnotate 返回 false 时 vite 把请求交给后面的中间件（sites-api、静态服务…），
 * 所以“不认”和“认了答错”一样是行为。分支怎么认：碰存储的分支看它调了 store /
 * registry 的哪个方法（spy），不碰存储的看响应指纹（Content-Type、错误码、载荷字段）。
 * 交出去的请求 res 必须一个字节不动。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAnnotateHandler } from './annotate-api.js';
import { loadRegistry } from './lib/registry.js';
import { createRegistryStore, writeRegistryFile } from './lib/registry-store.js';
import { mockReq, mockRes } from './test-harness.js';

const HASH = '0123456789';
const BUNDLE = { js: 'void 0;', hash: HASH, gzip: Buffer.from('gz'), br: Buffer.from('br') };

// 存储方法 → 分支。一个请求可能调好几个方法（/save 之后还取 jsonPathFor），取第一个认得的。
const STORE_BRANCH = {
  listDocs: 'annotations:list',
  readDoc: 'annotations:read',
  imagePath: 'images:read',
  setStatus: 'status',
  appendMessage: 'reply',
  save: 'save',
  writeImage: 'image:write',
};
const REGISTRY_BRANCH = {
  setFolders: 'registry:folders',
  setOrder: 'registry:order',
  setEntryFolder: 'registry:entry-folder',
  reload: 'registry:reload',
};

function spyMethods(target, names, calls, label) {
  for (const name of names) {
    if (typeof target[name] !== 'function') continue;
    const original = target[name];
    target[name] = (...args) => {
      calls.push({ name, label, args });
      return original.apply(target, args);
    };
  }
}

function withFixture(t, { writable = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-routes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registryFile = path.join(dir, 'registry.json');
  writeRegistryFile(registryFile, {
    version: 1,
    entries: [{ id: 'web', title: 'web', kind: 'url', url: 'https://web.localhost' }],
  });
  const registry = writable
    ? createRegistryStore({ path: registryFile, root: dir, log: () => {} })
    : loadRegistry({ path: registryFile, root: dir, log: () => {} });
  const calls = [];
  spyMethods(registry, Object.keys(REGISTRY_BRANCH), calls, 'registry');
  // 桶的 store 在第一次用到时才建：截住 Map.set，把每个新 store 的方法包上 spy。
  const stores = new (class extends Map {
    set(entryId, store) {
      spyMethods(store, Object.keys(store), calls, entryId);
      return super.set(entryId, store);
    }
  })();
  const handler = createAnnotateHandler({
    dataRoot: path.join(dir, 'data'),
    root: dir,
    registry,
    stores,
    annotateBundleByHash: (hash) => (hash === HASH ? BUNDLE : null),
    ensureAnnotateBundle: async () => BUNDLE,
  });
  return { handler, calls, registryFile };
}

async function call(fx, method, url, body) {
  fx.calls.length = 0;
  const req = mockReq(method, url, body);
  const res = mockRes();
  const handled = await fx.handler(req, res, url.split('?')[0]);
  req.emit('close'); // SSE 连接登记在模块级集合里，用完摘掉
  let json = null;
  try { json = JSON.parse(res.text); } catch { /* not JSON */ }
  return { handled, res, json, calls: [...fx.calls] };
}

function branchOf({ handled, res, json, calls }) {
  if (!handled) return 'next';
  for (const { name, label } of calls) {
    const branch = label === 'registry' ? REGISTRY_BRANCH[name] : STORE_BRANCH[name];
    if (branch) return branch;
  }
  const type = String(res.headers['Content-Type'] || '');
  if (res.statusCode === 204 && !res.chunks.length) return 'options';
  if (type.startsWith('application/javascript')) {
    return String(res.headers['Cache-Control']).includes('immutable') ? 'client:hash' : 'client';
  }
  if (type.startsWith('text/event-stream')) return 'events';
  if (json && json.ok === true && 'dataRoot' in json) return 'health';
  if (json && 'pageTimes' in json && 'articles' in json) return 'registry:read';
  if (json && json.error === 'registry_not_writable') return 'registry:write';
  if (json && json.error === 'registry_not_reloadable') return 'registry:reload';
  return `unidentified ${res.statusCode} ${res.text.slice(0, 80)}`;
}

function assertUntouched(res, label) {
  assert.equal(res.statusCode, 0, `${label}: statusCode untouched`);
  assert.deepEqual(res.headers, {}, `${label}: no headers set`);
  assert.equal(res.chunks.length, 0, `${label}: no body written`);
  assert.equal(res.writableEnded, false, `${label}: not ended`);
}

async function assertRoutes(fx, cases) {
  for (const [method, url, body, expected, check] of cases) {
    const label = `${method} ${url}`;
    const result = await call(fx, method, url, body);
    assert.equal(branchOf(result), expected, label);
    if (expected === 'next') assertUntouched(result.res, label);
    else assert.equal(result.res.headers['Access-Control-Allow-Origin'], '*', `${label}: cors`);
    if (check) check(result, label);
  }
}

const ENTRY = { entry: 'web', baseRevision: 0 };
const argsOf = (name) => (result) => result.calls.find((c) => c.name === name).args[0];

test('route priority: every request shape lands on one branch or falls through (static registry)', async (t) => {
  const fx = withFixture(t);
  await assertRoutes(fx, [
    // OPTIONS 先于整张路由表：任何路径都答 204，包括没有路由的路径。
    ['OPTIONS', '/health', undefined, 'options'],
    ['OPTIONS', '/save', undefined, 'options'],
    ['OPTIONS', '/annotations/index.html/1/status', undefined, 'options'],
    ['OPTIONS', '/anything/at/all', undefined, 'options'],

    // 标注客户端：老地址与哈希地址，GET 与 HEAD 都认；只有它认 HEAD。
    ['GET', '/annotate.js', undefined, 'client'],
    ['HEAD', '/annotate.js', undefined, 'client'],
    ['GET', `/annotate.${HASH}.js`, undefined, 'client:hash'],
    ['HEAD', `/annotate.${HASH}.js`, undefined, 'client:hash'],
    ['GET', '/annotate.not-a-hash.js', undefined, 'next'],
    ['GET', '/annotate.js/', undefined, 'next'],
    ['POST', '/annotate.js', {}, 'next'],

    ['GET', '/health', undefined, 'health'],
    ['HEAD', '/health', undefined, 'next'],
    ['GET', '/health/', undefined, 'next'],
    ['POST', '/health', {}, 'next'],

    // /registry：GET 全等读；PUT 认整个 /registry/ 前缀（静态登记表一律 409，不看子路径，
    // 连 /registry/reload 也归写接口）；POST 只认 /registry/reload。
    ['GET', '/registry', undefined, 'registry:read'],
    ['HEAD', '/registry', undefined, 'next'],
    ['POST', '/registry', {}, 'next'],
    ['PUT', '/registry', {}, 'next'],
    ['PUT', '/registry/folders', {}, 'registry:write'],
    ['PUT', '/registry/order', {}, 'registry:write'],
    ['PUT', '/registry/entries/web/folder', {}, 'registry:write'],
    ['PUT', '/registry/reload', {}, 'registry:write'],
    ['PUT', '/registry/', {}, 'registry:write'],
    ['PUT', '/registry/unknown', {}, 'registry:write'],
    ['PUT', '/registry/folders', 'not json', 'registry:write'],
    ['GET', '/registry/', undefined, 'next'],
    ['GET', '/registry/folders', undefined, 'next'],
    ['GET', '/registry/reload', undefined, 'next'],
    ['GET', '/registry/entries/web/folder', undefined, 'next'],
    ['POST', '/registry/reload', {}, 'registry:reload'],
    ['POST', '/registry/reload/', {}, 'next'],
    ['POST', '/registry/folders', {}, 'next'],
    ['DELETE', '/registry/folders', {}, 'next'],

    ['GET', '/events', undefined, 'events'],
    ['HEAD', '/events', undefined, 'next'],
    ['GET', '/events/x', undefined, 'next'],
    ['POST', '/events', {}, 'next'],

    // /annotations 全等 = 调试聚合；/annotations/ 前缀 = 按页读，后面几段都算页名，
    // 连 status / reply 形状的路径也是（GET 不进写接口）。
    ['GET', '/annotations', undefined, 'annotations:list'],
    ['GET', '/annotations/index.html?entry=web', undefined, 'annotations:read',
      (r) => assert.equal(r.calls[0].args[0], 'index.html')],
    ['GET', '/annotations/', undefined, 'annotations:read'],
    ['GET', '/annotations/index.html/1/status?entry=web', undefined, 'annotations:read',
      (r) => assert.equal(r.calls[0].args[0], 'index.html_1_status')],
    ['GET', '/annotations/@prose/1/reply?entry=web', undefined, 'annotations:read'],
    ['HEAD', '/annotations/index.html', undefined, 'next'],
    ['POST', '/annotations', {}, 'next'],
    ['POST', '/annotations/index.html', ENTRY, 'next'],
    ['POST', '/annotations/index.html/1', ENTRY, 'next'],

    // 写状态 / 回复：两条正则各认三段且只看末段。页名或 id 恰好叫 status / reply 不改变归属；
    // 页段不能含 /（要编码），多一段少一段都交出去。
    ['POST', '/annotations/index.html/1/status', { ...ENTRY, status: 'check' }, 'status',
      (r) => assert.deepEqual(
        [argsOf('setStatus')(r).page, argsOf('setStatus')(r).id, r.calls[0].label], ['index.html', 1, 'web'])],
    ['POST', '/annotations/index.html/a1b2/status', { ...ENTRY, status: 'check' }, 'status',
      (r) => assert.equal(argsOf('setStatus')(r).id, 'a1b2')],
    ['POST', '/annotations/index.html/01/status', { ...ENTRY, status: 'check' }, 'status',
      (r) => assert.equal(argsOf('setStatus')(r).id, '01')],
    ['POST', '/annotations/a%2Fb/%231/status', { ...ENTRY, status: 'check' }, 'status',
      (r) => assert.deepEqual([argsOf('setStatus')(r).page, argsOf('setStatus')(r).id], ['a/b', '#1'])],
    ['POST', '/annotations/reply/status/status', { ...ENTRY, status: 'check' }, 'status',
      (r) => assert.deepEqual([argsOf('setStatus')(r).page, argsOf('setStatus')(r).id], ['reply', 'status'])],
    ['POST', '/annotations/@prose/1/reply', { ...ENTRY, text: 'x' }, 'reply',
      (r) => assert.deepEqual([argsOf('appendMessage')(r).page, argsOf('appendMessage')(r).id], ['@prose', 1])],
    ['POST', '/annotations/status/1/reply', { ...ENTRY, text: 'x' }, 'reply',
      (r) => assert.equal(argsOf('appendMessage')(r).page, 'status')],
    ['POST', '/annotations/index.html/1/status/x', ENTRY, 'next'],
    ['POST', '/annotations/index.html/1/reply/x', ENTRY, 'next'],
    ['POST', '/annotations/a/b/1/status', ENTRY, 'next'],
    ['POST', '/annotations//1/status', ENTRY, 'next'],
    ['PUT', '/annotations/index.html/1/status', ENTRY, 'next'],
    ['GET', '/annotations/index.html/1/reply', undefined, 'annotations:read'],

    ['GET', '/images/shot.png?entry=web', undefined, 'images:read',
      (r) => assert.deepEqual([r.res.statusCode, r.json], [404, { error: 'not found' }])],
    ['GET', '/images/', undefined, 'images:read'],
    ['GET', '/image', undefined, 'next'],
    ['HEAD', '/images/shot.png', undefined, 'next'],
    ['POST', '/images/shot.png', ENTRY, 'next'],

    // 缺 entry 落默认桶 pinpoint。
    ['POST', '/save', { page: 'index.html', baseRevision: 0, annotations: [] }, 'save',
      (r) => assert.equal(r.calls[0].label, 'pinpoint')],
    ['POST', '/save', { ...ENTRY, page: 'index.html', annotations: [] }, 'save',
      (r) => assert.equal(r.calls[0].label, 'web')],
    ['GET', '/save', undefined, 'next'],
    ['PUT', '/save', {}, 'next'],
    ['DELETE', '/save', {}, 'next'],
    ['POST', '/save/', {}, 'next'],

    ['POST', '/image', { ...ENTRY, data: 'data:image/png;base64,aGk=' }, 'image:write'],
    ['GET', '/image', undefined, 'next'],
    ['POST', '/image/', {}, 'next'],

    ['GET', '/', undefined, 'next'],
    ['GET', '/index.html', undefined, 'next'],
    ['POST', '/', {}, 'next'],
  ]);
});

test('route priority: entry gate and JSON parse answer before any store call', async (t) => {
  const fx = withFixture(t);
  const rejected = [
    ['GET', '/annotations/index.html?entry=ghost', undefined, 400, { error: 'unknown_entry', entry: 'ghost' }],
    ['GET', '/images/shot.png?entry=ghost', undefined, 400, { error: 'unknown_entry', entry: 'ghost' }],
    ['POST', '/save', { entry: 'ghost', page: 'index.html', baseRevision: 0, annotations: [] }, 400, { error: 'unknown_entry', entry: 'ghost' }],
    ['POST', '/image', { entry: 'ghost', data: 'nope' }, 400, { error: 'unknown_entry', entry: 'ghost' }],
    ['POST', '/annotations/index.html/1/status', { entry: 'ghost', baseRevision: 0, status: 'check' }, 400, { error: 'unknown_entry', entry: 'ghost' }],
    ['POST', '/annotations/index.html/1/reply', { entry: 'ghost', baseRevision: 0, text: 'x' }, 400, { error: 'unknown_entry', entry: 'ghost' }],
    ['POST', '/save', 'not json', 400, { error: 'bad_json' }],
    ['POST', '/image', 'not json', 400, { error: 'bad_json' }],
    ['POST', '/annotations/index.html/1/status', 'not json', 400, { error: 'bad_json' }],
    ['POST', '/annotations/index.html/1/reply', 'not json', 400, { error: 'bad_json' }],
    // dataURL 校验在 entry 之后、写盘之前。
    ['POST', '/image', { entry: 'web', data: 'nope' }, 400, { error: 'bad dataURL' }],
  ];
  for (const [method, url, body, status, expected] of rejected) {
    const { handled, res, json, calls } = await call(fx, method, url, body);
    assert.equal(handled, true, `${method} ${url}`);
    assert.equal(res.statusCode, status, `${method} ${url}`);
    assert.deepEqual(json, expected, `${method} ${url}`);
    assert.deepEqual(calls, [], `${method} ${url}: no store call`);
  }
});

test('route priority: PUT /registry/* on a writable registry — parse, then shape, then sub-path', async (t) => {
  const fx = withFixture(t, { writable: true });
  // 子路径分派在读完请求体之后：坏请求体在任何子路径上都是 400，没有子路径的才交出去。
  const bad = await call(fx, 'PUT', '/registry/unknown', 'not json');
  assert.deepEqual([bad.handled, bad.res.statusCode, bad.json], [true, 400, { error: 'bad_json' }]);
  const array = await call(fx, 'PUT', '/registry/unknown', []);
  assert.deepEqual([array.handled, array.res.statusCode, array.json],
    [true, 400, { error: 'bad_request', message: '请求体必须是对象' }]);
  const nul = await call(fx, 'PUT', '/registry/folders', null);
  assert.deepEqual([nul.res.statusCode, nul.json.error], [400, 'bad_request']);

  await assertRoutes(fx, [
    ['PUT', '/registry/unknown', {}, 'next'],
    ['PUT', '/registry/', {}, 'next'],
    ['PUT', '/registry/reload', {}, 'next'],
    ['PUT', '/registry/entries/web', {}, 'next'],
    ['PUT', '/registry/entries/web/folder/x', {}, 'next'],
    ['PUT', '/registry/entries/a/b/folder', {}, 'next'],
    ['PUT', '/registry/folders', { folders: [] }, 'registry:folders'],
    ['PUT', '/registry/order', { ids: ['web'] }, 'registry:order'],
    ['PUT', '/registry/entries/web/folder', { folder: null }, 'registry:entry-folder',
      (r) => assert.deepEqual(r.calls[0].args.slice(0, 2), ['web', { folder: null, order: undefined }])],
    ['PUT', '/registry/entries/%E7%BD%91/folder', {}, 'registry:entry-folder',
      (r) => assert.equal(r.calls[0].args[0], '网')],
    ['POST', '/registry/reload', {}, 'registry:reload'],
  ]);

  // 写入方法抛错（未知 id、未知文件夹）= 400 bad_request，带原因。
  const unknownId = await call(fx, 'PUT', '/registry/entries/ghost/folder', { folder: null });
  assert.equal(branchOf(unknownId), 'registry:entry-folder');
  assert.equal(unknownId.res.statusCode, 400);
  assert.equal(unknownId.json.error, 'bad_request');
  assert.equal(typeof unknownId.json.message, 'string');
});
