import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

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
      { id: 'web', title: 'web', kind: 'dir', path: dir },
    ],
  }));
  const registry = loadRegistry({ path: registryFile, root: dir, log: () => {} });
  return { dir, dataRoot, registry, handler: createAnnotateHandler({ dataRoot, registry }) };
}



async function call(handler, method, url, body, headers) {
  const req = mockReq(method, url, body);
  Object.assign(req.headers, headers || {});
  const res = mockRes();
  const handled = await handler(req, res, url.split('?')[0]);
  let json = null;
  try { json = JSON.parse(res.body); } catch { /* not JSON */ }
  return { handled, res, json };
}

test('a route that throws answers 500 instead of rejecting (the service stays up)', async (t) => {
  const { dataRoot, registry } = withFixture(t);
  const broken = { save() { throw Object.assign(new Error('rename failed'), { code: 'ENOENT' }); } };
  const handler = createAnnotateHandler({ dataRoot, registry, stores: new Map([['pinpoint', broken]]) });
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const { handled, res, json } = await call(handler, 'POST', '/save', { page: 'index', entry: 'pinpoint', baseRevision: 0, annotations: [] });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(json, { error: 'internal_error', message: 'rename failed' });
  assert.equal(errors.length, 1);
});

test('路径里的坏百分号编码答 400，不是 500（pp3 review 余项 14）', async (t) => {
  const { handler } = withFixture(t);
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const cases = [
    ['GET', '/annotations/%ff?entry=pinpoint', undefined],
    ['GET', '/images/%ff?entry=pinpoint', undefined],
    ['POST', '/annotations/%ff/12/status', { entry: 'pinpoint', status: 'check', baseRevision: 0 }],
    ['POST', '/annotations/%ff/12/reply', { entry: 'pinpoint', text: '回', baseRevision: 0 }],
  ];
  for (const [method, url, body] of cases) {
    const { res, json } = await call(handler, method, url, body);
    assert.equal(res.statusCode, 400, `${method} ${url}`);
    assert.equal(json.error, 'bad_request', `${method} ${url}`);
  }
  assert.deepEqual(errors, [], '坏编码是请求错，不该惊动服务端日志');
});

test('/save：桶在写入途中被删 → 503 bucket_gone，带说明，不是 500', async (t) => {
  const { dataRoot, registry } = withFixture(t);
  const handler = createAnnotateHandler({ dataRoot, registry });
  const original = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(from).includes('.json.tmp-')) fs.rmSync(path.dirname(String(from)), { recursive: true, force: true });
    return original(from, to);
  });
  const { res, json } = await call(handler, 'POST', '/save', { page: '@canvas', entry: 'pinpoint', baseRevision: 0, annotations: [{ content: 'a' }] });
  t.mock.restoreAll();
  assert.equal(res.statusCode, 503);
  assert.equal(json.error, 'bucket_gone');
  assert.match(json.message, /在写入途中被删除或移走/);
});

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

test('resolveRequestEntry: an article page id <project>_<article> is a bucket; the bare project id is not', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-api-proj-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registryFile = path.join(dir, 'registry.json');
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'e2e', 'project-site');
  fs.writeFileSync(registryFile, JSON.stringify({ version: 1, entries: [{ id: 'e2e-project', kind: 'project', path: projectRoot }] }));
  const registry = loadRegistry({ path: registryFile, root: dir, log: () => {} });
  assert.deepEqual(resolveRequestEntry(registry, 'e2e-project_commit-confirm'), { entry: 'e2e-project_commit-confirm' });
  assert.deepEqual(resolveRequestEntry(registry, 'e2e-project_takeover'), { entry: 'e2e-project_takeover' });
  assert.deepEqual(resolveRequestEntry(registry, 'e2e-project_ghost'), { entry: 'e2e-project_ghost', unknown: true });
  assert.deepEqual(resolveRequestEntry(registry, 'e2e-project'), { entry: 'e2e-project', unknown: true });
  assert.deepEqual(resolveRequestEntry(registry, 'ghost'), { entry: 'ghost', unknown: true });
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

test('/save 有读体上限：超了 413 body_too_large，一个字都不写', async (t) => {
  const { dataRoot, handler } = withFixture(t);
  // 上限 2 MiB（LEDGER_BODY_LIMIT，实测最大账本 197 KB 的约 10 倍）；这里发 3 MiB。
  const huge = { page: 'index.html', entry: 'web', baseRevision: 0, annotations: [{ content: 'x'.repeat(3 * 1024 * 1024) }] };
  const { res, json } = await call(handler, 'POST', '/save', huge);
  assert.equal(res.statusCode, 413);
  assert.equal(json.error, 'body_too_large');
  assert.ok(!fs.existsSync(path.join(dataRoot, 'web')), '超限的请求不落盘');
});

test('/image 的上限另算：账本上限 2 MiB 不挡截图', async (t) => {
  const { dataRoot, handler } = withFixture(t);
  // 3 MiB 的 base64 截图：超 /save 的 2 MiB，在 /image 的 16 MiB 内，照常收。
  const data = `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024).toString('base64')}`;
  const { res, json } = await call(handler, 'POST', '/image', { page: '@canvas', entry: 'web', data });
  assert.equal(res.statusCode, 200, JSON.stringify(json));
  assert.ok(fs.existsSync(path.join(dataRoot, 'web', 'images', json.file)));
});

// S3：标注图片走策略表 image 行。200 路径此前无单测（e2e article-viewer 右栏的
// 截图断言逮到 run 漏解构 req 的回归），200 / ETag / 304 在这里守。
test('GET /images/<name>?entry= 200 出图带 no-cache + ETag，条件请求 304；缺图 404', async (t) => {
  const { dataRoot, handler } = withFixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mNk+M9Qz0AEYBxVSF+FAP0lBHHc0sQUAAAAAElFTkSuQmCC', 'base64');
  fs.mkdirSync(path.join(dataRoot, 'web', 'images'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'web', 'images', 'shot.png'), png);

  const first = await call(handler, 'GET', '/images/shot.png?entry=web');
  assert.equal(first.res.statusCode, 200);
  assert.equal(first.res.headers['Cache-Control'], 'no-cache');
  assert.match(first.res.headers.ETag, /^"\d+(\.\d+)?-\d+"$/, 'mtime 原值（review 必须修 1 起带小数）+size');
  assert.deepEqual([...first.res.body], [...png]);

  const hit = await call(handler, 'GET', '/images/shot.png?entry=web', undefined, { 'if-none-match': first.res.headers.ETag });
  assert.equal(hit.res.statusCode, 304);
  assert.equal(hit.res.chunks.length, 0);

  assert.equal((await call(handler, 'GET', '/images/missing.png?entry=web')).res.statusCode, 404);
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
  // entries / projects 都是数量（完整清单走 GET /registry）。
  assert.deepEqual(json.registry, {
    ok: true, path: registry.path, entries: 2, projects: 0, errors: [], warnings: [],
  });
  assert.deepEqual(json.projects, { count: 0, errors: [] });
});

test('/health counts project entries apart from pages and lists their layout errors', async (t) => {
  const { dir, dataRoot } = withFixture(t);
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const registryFile = path.join(dir, 'registry-projects.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    entries: [
      { id: 'pinpoint', kind: 'dir', path: dir },
      { id: 'e2e-project', kind: 'project', path: path.join(repo, 'e2e', 'project-site') },
      { id: 'clash', kind: 'project', path: path.join(repo, 'site', 'fixtures', 'projects', 'clash') },
    ],
  }));
  const registry = loadRegistry({ path: registryFile, root: dir, log: () => {} });
  const { json } = await call(createAnnotateHandler({ dataRoot, registry }), 'GET', '/health');
  assert.equal(json.registry.entries, 1);
  assert.equal(json.registry.projects, 2);
  assert.equal(json.projects.count, 2);
  assert.equal(json.projects.errors.length, 1);
  assert.match(json.projects.errors[0], /^clash: 撞名 \[\[confirm-card\]\]/);
  const listed = await call(createAnnotateHandler({ dataRoot, registry }), 'GET', '/registry');
  assert.deepEqual(listed.json.entries.map((e) => e.id), ['pinpoint'], 'projects never show up as pages');
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

test('接口只给同源页面：OPTIONS 交给下一个中间件，响应不带 CORS 头', async (t) => {
  const { handler } = withFixture(t);
  for (const route of ['/save', '/image', '/annotations/x', '/events', '/registry']) {
    const { handled, res } = await call(handler, 'OPTIONS', route);
    assert.equal(handled, false, route);
    assert.equal(res.statusCode, 0, route);
  }
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
  for (const { handled, res } of checks) {
    assert.equal(handled, true);
    assert.equal(res.headers['Access-Control-Allow-Origin'], undefined);
  }
});

// ---- /annotate.js · /annotate.<hash>.js（审计 B3：产物 + 缓存契约）-----------

function bundleStub(overrides = {}) {
  const js = '/* annotate bundle stub */console.log("stub");';
  return {
    js,
    hash: '44bc529372',
    gzip: zlib.gzipSync(Buffer.from(js)),
    br: zlib.brotliCompressSync(Buffer.from(js)),
    ...overrides,
  };
}

function withBundleStub(t, artifact, ensureError) {
  const fx = withFixture(t);
  const handler = createAnnotateHandler({
    dataRoot: fx.dataRoot,
    registry: fx.registry,
    annotateBundleByHash: (hash) => (hash === artifact.hash ? artifact : null),
    ensureAnnotateBundle: () => (ensureError ? Promise.reject(ensureError) : Promise.resolve(artifact)),
  });
  return { ...fx, handler };
}

test('GET /annotate.js serves the current artifact with ETag + no-cache + Vary', async (t) => {
  const artifact = bundleStub();
  const { handler } = withBundleStub(t, artifact);
  const { res } = await call(handler, 'GET', '/annotate.js', undefined, { 'accept-encoding': 'br' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.ETag, '"44bc529372"');
  assert.equal(res.headers['Cache-Control'], 'no-cache');
  assert.equal(res.headers.Vary, 'Accept-Encoding');
  assert.equal(res.headers['Content-Encoding'], 'br');
  assert.equal(zlib.brotliDecompressSync(res.body).toString('utf8'), artifact.js, 'brotli 解回来 = 产物原文');
});

test('GET /annotate.js answers If-None-Match with 304 (weak and list forms too)', async (t) => {
  const artifact = bundleStub();
  const { handler } = withBundleStub(t, artifact);
  for (const header of ['"44bc529372"', 'W/"44bc529372"', '"deadbeef01", "44bc529372"', '*']) {
    const { res } = await call(handler, 'GET', '/annotate.js', undefined, { 'if-none-match': header });
    assert.equal(res.statusCode, 304, header);
    assert.equal(res.headers.ETag, '"44bc529372"');
    assert.equal(res.chunks.length, 0, '304 无响应体');
  }
  const miss = await call(handler, 'GET', '/annotate.js', undefined, { 'if-none-match': '"other000000"' });
  assert.equal(miss.res.statusCode, 200);
});

test('GET /annotate.<hash>.js is immutable and encoding-negotiated; HEAD returns headers only', async (t) => {
  const artifact = bundleStub();
  const { handler } = withBundleStub(t, artifact);
  const hashed = `/annotate.${artifact.hash}.js`;
  const hit = await call(handler, 'GET', hashed, undefined, { 'accept-encoding': 'gzip, deflate, br, zstd' });
  assert.equal(hit.res.statusCode, 200);
  assert.equal(hit.res.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(hit.res.headers.Vary, 'Accept-Encoding');
  assert.equal(hit.res.headers['Content-Encoding'], 'br', 'br 声明了就优先');
  assert.equal(hit.res.headers.ETag, undefined, 'immutable 地址不需要 ETag 协商');

  const gzipOnly = await call(handler, 'GET', hashed, undefined, { 'accept-encoding': 'gzip' });
  assert.equal(gzipOnly.res.headers['Content-Encoding'], 'gzip');
  const plain = await call(handler, 'GET', hashed);
  assert.equal(plain.res.headers['Content-Encoding'], undefined);
  assert.equal(plain.res.body.toString('utf8'), artifact.js);

  // 编码名按逗号拆开精确匹配：子串匹配会把怪值误判成 gzip / br。
  const weird = await call(handler, 'GET', hashed, undefined, { 'accept-encoding': 'xgzip, brotli' });
  assert.equal(weird.res.headers['Content-Encoding'], undefined, 'xgzip / brotli 不是 gzip / br');
  const withQ = await call(handler, 'GET', hashed, undefined, { 'accept-encoding': 'gzip;q=0.9, br;q=0.8' });
  assert.equal(withQ.res.headers['Content-Encoding'], 'br', '带 q 值的编码名仍认得出');

  const head = await call(handler, 'HEAD', hashed, undefined, { 'accept-encoding': 'br' });
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.headers['Content-Length'], String(artifact.br.length), 'HEAD 给全元数据');
  assert.equal(head.res.chunks.length, 0, 'HEAD 无响应体');
  const headOld = await call(handler, 'HEAD', '/annotate.js');
  assert.equal(headOld.res.statusCode, 200);
  assert.equal(headOld.res.headers.ETag, '"44bc529372"');
  assert.equal(headOld.res.chunks.length, 0);
});

test('unknown hash is a loud 404; stale-hash rebuild finds the same content', async (t) => {
  const artifact = bundleStub();
  // byHash 找不到（进程重启内存清空）但 ensure 重编出同哈希 → 200。
  const restarted = createAnnotateHandler({
    dataRoot: path.join(os.tmpdir(), 'pinpoint-api-x'),
    registry: loadRegistry({ path: path.join(os.tmpdir(), 'pinpoint-api-x-reg.json'), root: os.tmpdir(), log: () => {} }),
    annotateBundleByHash: () => null,
    ensureAnnotateBundle: () => Promise.resolve(artifact),
  });
  const rematched = await call(restarted, 'GET', `/annotate.${artifact.hash}.js`);
  assert.equal(rematched.res.statusCode, 200);
  // ensure 也对不上 → 真不认识的哈希，404。
  const unknown = await call(restarted, 'GET', '/annotate.0000000000.js');
  assert.equal(unknown.res.statusCode, 404);
});

test('build failure is a loud 500 with the reason; retained hashes keep serving', async (t) => {
  const failure = Object.assign(new Error('annotate client build failed: src/client/annotate.js:1 Expected ident'), {
    name: 'AnnotateBundleError',
  });
  const artifact = bundleStub();
  const { handler } = withBundleStub(t, artifact, failure);
  // 老地址（构建还没落地或失败时注入点的回退目标）必须把原因喊出来。
  const old = await call(handler, 'GET', '/annotate.js');
  assert.equal(old.res.statusCode, 500);
  assert.match(old.res.text, /Expected ident/);
  assert.equal(old.res.headers['Cache-Control'], undefined);
  // 内存里没有的哈希要靠重编对上，重编挂了同样 500。
  const unknown = await call(handler, 'GET', '/annotate.0000000000.js');
  assert.equal(unknown.res.statusCode, 500);
  // 已经发出去的哈希地址是 immutable 契约：那份字节还在内存里就继续发
  // （缓存的页面拿着旧地址不该拿 404），这与「不静默发旧版」不冲突 ——
  // 新注入在构建失败时回退老地址拿 500，不会引用旧哈希。
  const retained = await call(handler, 'GET', `/annotate.${artifact.hash}.js`);
  assert.equal(retained.res.statusCode, 200);
});

// ---- /prose.js · /prose.<hash>.js（A6：文章页正文评论入口，与 annotate 同一套缓存契约）-----------

// bundleStub 的压缩体基于它自己的 js 算，改 js 的 stub 必须连压缩一起重算。
function proseStub() {
  const js = '/* prose bundle stub */console.log("prose");';
  return {
    js,
    hash: '5e5e5e5e5e',
    gzip: zlib.gzipSync(Buffer.from(js)),
    br: zlib.brotliCompressSync(Buffer.from(js)),
  };
}

// annotate 侧装另一份哈希不同的 stub：两条路由共用 serveAnnotateClient，参数
// 串了（prose 拿到 annotate 的 ensure / byHash）会直接体现在字节与 ETag 上。
function withProseStub(t, artifact, ensureError) {
  const fx = withFixture(t);
  const annotate = bundleStub({ hash: 'aaaa000000' });
  const handler = createAnnotateHandler({
    dataRoot: fx.dataRoot,
    registry: fx.registry,
    annotateBundleByHash: (hash) => (hash === annotate.hash ? annotate : null),
    ensureAnnotateBundle: () => Promise.resolve(annotate),
    proseBundleByHash: (hash) => (hash === artifact.hash ? artifact : null),
    ensureProseBundle: () => (ensureError ? Promise.reject(ensureError) : Promise.resolve(artifact)),
  });
  return { ...fx, handler, annotate };
}

test('GET /prose.js serves the prose artifact with ETag + no-cache; /annotate.js keeps serving the full client', async (t) => {
  const artifact = proseStub();
  const { handler, annotate } = withProseStub(t, artifact);
  const { res } = await call(handler, 'GET', '/prose.js', undefined, { 'accept-encoding': 'br' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.ETag, `"${artifact.hash}"`);
  assert.equal(res.headers['Cache-Control'], 'no-cache');
  assert.equal(res.headers.Vary, 'Accept-Encoding');
  assert.equal(res.headers['Content-Encoding'], 'br');
  assert.equal(zlib.brotliDecompressSync(res.body).toString('utf8'), artifact.js, 'br 解回来 = prose 产物原文');
  const full = await call(handler, 'GET', '/annotate.js', undefined, { 'accept-encoding': 'br' });
  assert.equal(zlib.brotliDecompressSync(full.res.body).toString('utf8'), annotate.js, '老地址仍是完整客户端，没被 prose 串掉');
});

test('GET /prose.js answers If-None-Match with 304; a different ETag is a 200', async (t) => {
  const artifact = proseStub();
  const { handler } = withProseStub(t, artifact);
  for (const header of [`"${artifact.hash}"`, `W/"${artifact.hash}"`, `"${artifact.hash}", "other000000"`, '*']) {
    const { res } = await call(handler, 'GET', '/prose.js', undefined, { 'if-none-match': header });
    assert.equal(res.statusCode, 304, header);
    assert.equal(res.headers.ETag, `"${artifact.hash}"`);
    assert.equal(res.chunks.length, 0, '304 无响应体');
  }
  const miss = await call(handler, 'GET', '/prose.js', undefined, { 'if-none-match': '"other000000"' });
  assert.equal(miss.res.statusCode, 200);
  const headOld = await call(handler, 'HEAD', '/prose.js');
  assert.equal(headOld.res.statusCode, 200);
  assert.equal(headOld.res.headers.ETag, `"${artifact.hash}"`);
  assert.equal(headOld.res.chunks.length, 0);
});

test('GET /prose.<hash>.js is immutable and encoding-negotiated; HEAD returns headers only', async (t) => {
  const artifact = proseStub();
  const { handler } = withProseStub(t, artifact);
  const hashed = `/prose.${artifact.hash}.js`;
  const hit = await call(handler, 'GET', hashed, undefined, { 'accept-encoding': 'gzip, deflate, br' });
  assert.equal(hit.res.statusCode, 200);
  assert.equal(hit.res.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(hit.res.headers.Vary, 'Accept-Encoding');
  assert.equal(hit.res.headers['Content-Encoding'], 'br');
  assert.equal(hit.res.headers.ETag, undefined, 'immutable 地址不需要 ETag 协商');
  const plain = await call(handler, 'GET', hashed);
  assert.equal(plain.res.headers['Content-Encoding'], undefined);
  assert.equal(plain.res.body.toString('utf8'), artifact.js);
  const head = await call(handler, 'HEAD', hashed, undefined, { 'accept-encoding': 'br' });
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.headers['Content-Length'], String(artifact.br.length), 'HEAD 给全元数据');
  assert.equal(head.res.chunks.length, 0, 'HEAD 无响应体');
});

test('unknown prose hash is a loud 404 naming prose; stale-hash rebuild finds the same content', async (t) => {
  const artifact = proseStub();
  // byHash 找不到（进程重启内存清空）但 ensure 重编出同哈希 → 200；对不上是真
  // 不认识的哈希，404 且消息点名 prose（不是 annotate 的那条文案）。
  const fx = withFixture(t);
  const restarted = createAnnotateHandler({
    dataRoot: fx.dataRoot,
    registry: fx.registry,
    proseBundleByHash: () => null,
    ensureProseBundle: () => Promise.resolve(artifact),
  });
  const rematched = await call(restarted, 'GET', `/prose.${artifact.hash}.js`);
  assert.equal(rematched.res.statusCode, 200);
  const unknown = await call(restarted, 'GET', '/prose.0000000000.js');
  assert.equal(unknown.res.statusCode, 404);
  assert.match(unknown.res.text, /unknown prose bundle/);
});

test('prose build failure is a loud 500 on the fallback address, same contract as annotate', async (t) => {
  const failure = Object.assign(new Error('prose client build failed: src/client/prose-boot.js:1 Expected ident'), {
    name: 'AnnotateBundleError',
  });
  const artifact = proseStub();
  const { handler } = withProseStub(t, artifact, failure);
  const old = await call(handler, 'GET', '/prose.js');
  assert.equal(old.res.statusCode, 500);
  assert.match(old.res.text, /Expected ident/);
  // 已发出去的哈希地址是 immutable 契约：字节还在内存里就继续发。
  const retained = await call(handler, 'GET', `/prose.${artifact.hash}.js`);
  assert.equal(retained.res.statusCode, 200);
});

test('a concurrent ledger write rejects a stale /status with revision_conflict and keeps the other edit', async (t) => {
  const { handler } = withFixture(t);
  // 浏览器只用来造第一条标注，判定全在 HTTP 之下：/save 推进 revision 后，
  // 拿旧 revision 的 /status 写入要 409 revision_conflict，另一窗口的改动原样保留。
  const first = await call(handler, 'POST', '/save', {
    page: 'index.html', entry: 'web', baseRevision: 0, annotations: [{ content: '请改标题' }],
  });
  assert.equal(first.res.statusCode, 200);
  const staleRev = first.json.revision;

  // 另一个窗口先把账本推进一格（正文改写 + revision+1）。
  const doc = await call(handler, 'GET', '/annotations/index.html?entry=web');
  const other = await call(handler, 'POST', '/save', {
    page: 'index.html', entry: 'web', baseRevision: staleRev,
    annotations: doc.json.annotations.map((m) => ({ ...m, content: '另一窗口更新后的意见' })),
  });
  assert.equal(other.res.statusCode, 200);

  // 旧 revision 的 status 写入被 409 拒掉，错误码 revision_conflict 原样透出。
  const stale = await call(handler, 'POST', '/annotations/index.html/1/status', {
    entry: 'web', baseRevision: staleRev, status: 'check',
  });
  assert.equal(stale.res.statusCode, 409);
  assert.equal(stale.json.error, 'revision_conflict');

  const after = await call(handler, 'GET', '/annotations/index.html?entry=web');
  assert.equal(after.json.annotations[0].content, '另一窗口更新后的意见');
  assert.equal(after.json.annotations[0].status, 'open');
});

test('article bucket: prose comments save to <project>_<article>/@prose.json; /reply appends an agent message and broadcasts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-api-prose-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataRoot = path.join(dir, 'data');
  const registryFile = path.join(dir, 'registry.json');
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'e2e', 'project-site');
  fs.writeFileSync(registryFile, JSON.stringify({ version: 1, entries: [{ id: 'e2e-project', kind: 'project', path: projectRoot }] }));
  const registry = loadRegistry({ path: registryFile, root: dir, log: () => {} });
  const handler = createAnnotateHandler({ dataRoot, registry });
  const entry = 'e2e-project_commit-confirm';

  const saved = await call(handler, 'POST', '/save', {
    page: '@prose', entry, path: '/e2e-project/commit-confirm/', baseRevision: 0,
    annotations: [{ id: 'p1', type: 'prose', content: '这句改短', quote: { exact: '先弹', prefix: '之前', suffix: '；' }, messages: [] }],
  });
  assert.equal(saved.res.statusCode, 200);
  assert.ok(fs.existsSync(path.join(dataRoot, entry, '@prose.json')));
  assert.equal(saved.json.annotations[0].n, 1);

  const sse = mockRes();
  const sseReq = new EventEmitter();
  sseReq.method = 'GET';
  sseReq.url = '/events';
  await handler(sseReq, sse, '/events');
  t.after(() => sseReq.emit('close'));
  const bad = await call(handler, 'POST', '/annotations/@prose/1/reply', { entry, baseRevision: 0, text: 'x' });
  assert.equal(bad.res.statusCode, 409);
  const ok = await call(handler, 'POST', '/annotations/@prose/1/reply', { entry, baseRevision: 1, text: '改了' });
  assert.equal(ok.res.statusCode, 200);
  assert.equal(ok.json.revision, 2);
  assert.equal(ok.json.annotation.status, 'open');
  assert.equal(ok.json.message.who, 'agent');
  assert.equal(ok.json.message.text, '改了');
  const event = sse.text.split('\n').find((line) => line.startsWith('data: {'));
  const payload = JSON.parse(event.slice('data: '.length));
  assert.deepEqual([payload.entry, payload.page, payload.revision], [entry, '@prose', 2]);
  assert.equal(payload.annotations[0].messages[0].text, '改了');

  const ghost = await call(handler, 'POST', '/annotations/@prose/1/reply', { entry: 'e2e-project', baseRevision: 2, text: 'x' });
  assert.equal(ghost.res.statusCode, 400);
  assert.equal(ghost.json.error, 'unknown_entry');
});

test('整桶孤儿：桶目录在盘上就能读、写状态、回复；桶不在或 id 不合页 id 形状照旧 400（E）', async (t) => {
  const { dataRoot, registry, handler } = withFixture(t);
  // 页已不在（文章删了、条目撤登记，或集成后被跳过的老 url 条目）：桶还在盘上。
  const bucket = path.join(dataRoot, 'gone-page');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, 'app_x1.json'), JSON.stringify({
    page: 'app_x1', path: '/sites/gone-page/app', revision: 2,
    annotations: [{ id: 'u1', n: 1, type: 'element', status: 'open', content: '线上页意见' }],
  }));
  assert.deepEqual(resolveRequestEntry(registry, 'gone-page', [], { dataRoot }), { entry: 'gone-page' });
  assert.deepEqual(resolveRequestEntry(registry, 'no-bucket', [], { dataRoot }), { entry: 'no-bucket', unknown: true });
  // 桶检查只认页 id 形状：`..` 之类不拿去拼路径。
  fs.mkdirSync(path.join(path.dirname(dataRoot), 'outside'), { recursive: true });
  assert.deepEqual(resolveRequestEntry(registry, '../outside', [], { dataRoot }), { entry: '../outside', unknown: true });

  const read = await call(handler, 'GET', '/annotations/app_x1?entry=gone-page');
  assert.equal(read.res.statusCode, 200);
  assert.equal(read.json.revision, 2);
  const reply = await call(handler, 'POST', '/annotations/app_x1/1/reply', { entry: 'gone-page', baseRevision: 2, text: '那一页已经撤了' });
  assert.equal(reply.res.statusCode, 200, JSON.stringify(reply.json));
  const status = await call(handler, 'POST', '/annotations/app_x1/1/status', { entry: 'gone-page', baseRevision: 3, status: 'done' });
  assert.equal(status.res.statusCode, 200, JSON.stringify(status.json));
  const disk = JSON.parse(fs.readFileSync(path.join(bucket, 'app_x1.json'), 'utf8'));
  assert.equal(disk.annotations[0].status, 'done');
  assert.deepEqual(disk.annotations[0].messages.map((m) => [m.who, m.text]), [['agent', '那一页已经撤了']]);

  const ghost = await call(handler, 'POST', '/annotations/app_x1/1/status', { entry: 'no-bucket', baseRevision: 0, status: 'done' });
  assert.equal(ghost.res.statusCode, 400);
  assert.equal(ghost.json.error, 'unknown_entry');
  assert.ok(!fs.existsSync(path.join(dataRoot, 'no-bucket')));
});

test('桶被 prune 掉以后迟到的保存不把它写回来：页已不在就 503 bucket_gone，桶不重建（O）', async (t) => {
  const { dataRoot, handler } = withFixture(t);
  const bucket = path.join(dataRoot, 'gone-page');
  fs.mkdirSync(bucket, { recursive: true });
  // 入口校验时桶还在（整桶孤儿放行）；读账本那一刻 prune 把整个桶删了。
  const originalExists = fs.existsSync;
  t.mock.method(fs, 'existsSync', (p) => {
    if (String(p) === path.join(bucket, '@canvas.json')) fs.rmSync(bucket, { recursive: true, force: true });
    return originalExists(p);
  });
  const { res, json } = await call(handler, 'POST', '/save', { page: '@canvas', entry: 'gone-page', baseRevision: 0, annotations: [{ content: '关页补发' }] });
  t.mock.restoreAll();
  assert.equal(res.statusCode, 503, JSON.stringify(json));
  assert.equal(json.error, 'bucket_gone');
  assert.ok(!fs.existsSync(bucket), '桶没有被重建');
  // 图片同一条：桶不在、页也不在，不新建。
  fs.mkdirSync(bucket, { recursive: true });
  const originalStat = fs.statSync;
  let gate = false;
  t.mock.method(fs, 'statSync', (p, ...rest) => {
    const out = originalStat(p, ...rest);
    if (!gate && String(p) === bucket) { gate = true; fs.rmSync(bucket, { recursive: true, force: true }); }
    return out;
  });
  const image = await call(handler, 'POST', '/image', { page: '@canvas', entry: 'gone-page', data: 'data:image/png;base64,eA==' });
  t.mock.restoreAll();
  assert.equal(image.res.statusCode, 503, JSON.stringify(image.json));
  assert.ok(!fs.existsSync(bucket), '图片也不重建桶');
});

test('GET /annotations 的聚合也摊平文章桶（Q）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-api-agg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataRoot = path.join(dir, 'data');
  const registryFile = path.join(dir, 'registry.json');
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'e2e', 'project-site');
  fs.writeFileSync(registryFile, JSON.stringify({ version: 1, entries: [{ id: 'e2e-project', kind: 'project', path: projectRoot }] }));
  const registry = loadRegistry({ path: registryFile, root: dir, log: () => {} });
  const handler = createAnnotateHandler({ dataRoot, registry });
  const entry = 'e2e-project_commit-confirm';
  const saved = await call(handler, 'POST', '/save', {
    page: '@prose', entry, path: '/e2e-project/commit-confirm/', baseRevision: 0,
    annotations: [{ id: 'p1', type: 'prose', content: '这句改短', quote: { exact: '先弹' }, messages: [] }],
  });
  assert.equal(saved.res.statusCode, 200);
  const { json } = await call(handler, 'GET', '/annotations');
  const rows = json.filter((doc) => doc.entry === entry);
  assert.deepEqual(rows.map((doc) => [doc.page, doc.annotations.length]), [['@prose', 1]]);
});
