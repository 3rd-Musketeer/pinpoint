import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildEntry,
  buildMove,
  classifyStatus,
  CliError,
  collectStatus,
  decideStart,
  decideStop,
  displayWidth,
  formatStatus,
  localManifestPageIds,
  parseArgs,
  parseRoutes,
  pickRoute,
  planAdd,
  portlessRoutesPath,
  requestJson,
  resolveRegistryPath,
  run,
  runAdd,
  runMove,
  runStatus,
  runStop,
  serviceLogPath,
  slugify,
} from './pinpoint-cli.js';

function withTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeSite(dir, name = 'My Site') {
  const site = path.join(dir, name);
  fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body>x</body></html>');
  return site;
}

function recorder() {
  const out = [];
  const err = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
}

/* ---- parseArgs ---- */

test('parseArgs: happy path with spaced and =inline flags', () => {
  assert.deepEqual(parseArgs(['add', '/tmp/x', '--title', 'T', '--board=ios', '--id', 'x']), {
    command: 'add',
    target: '/tmp/x',
    flags: { title: 'T', board: 'ios', id: 'x' },
  });
});

test('parseArgs: usage errors are loud', () => {
  assert.throws(() => parseArgs([]), /缺少命令/);
  assert.throws(() => parseArgs(['remove', '/x']), /未知命令/);
  assert.throws(() => parseArgs(['status', 'extra']), /不接受位置参数/);
  assert.throws(() => parseArgs(['status', '--title', 'T']), /不适用于 status/);
  assert.throws(() => parseArgs(['move', 'x']), /move 需要两个参数/);
  assert.throws(() => parseArgs(['move', 'x', '/a', '/b']), /只接受两个参数/);
  assert.throws(() => parseArgs(['move', 'x', '/a', '--draft']), /不适用于 move/);
  assert.throws(() => parseArgs(['add']), /需要一个目标/);
  assert.throws(() => parseArgs(['add', '/a', '/b']), /只接受一个目标/);
  assert.throws(() => parseArgs(['add', '/a', '--wat', '1']), /未知选项/);
  assert.throws(() => parseArgs(['add', '/a', '--title']), /缺少值/);
  assert.throws(() => parseArgs(['add', '/a', '--title', '--id', 'x']), /缺少值/);
  assert.throws(() => parseArgs(['add', '/a', '--id=']), /缺少值/);
});

test('parseArgs: 阶段 8 的 --page（值选项）与 --draft（布尔开关）', () => {
  assert.deepEqual(parseArgs(['add', '/tmp/x', '--page', 'weekly-review', '--draft']), {
    command: 'add',
    target: '/tmp/x',
    flags: { page: 'weekly-review', draft: true },
  });
  assert.deepEqual(parseArgs(['add', '/tmp/x', '--page=library']).flags, { page: 'library' });
  // 布尔开关不吃下一个 token（positional 仍是目标），也不许带 =值
  assert.deepEqual(parseArgs(['add', '--draft', '/tmp/x']), {
    command: 'add', target: '/tmp/x', flags: { draft: true },
  });
  assert.throws(() => parseArgs(['add', '/x', '--draft=yes']), /开关，不带值/);
  assert.throws(() => parseArgs(['add', '/x', '--page']), /缺少值/);
  assert.throws(() => parseArgs(['add', '/x', '--page', '--draft']), /缺少值/);
});

test('parseArgs: -h/--help short-circuits', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['add', '-h']), { help: true });
});

/* ---- slugify ---- */

test('slugify: lowercase, fold non-alphanumerics, trim dashes', () => {
  assert.equal(slugify('My Report'), 'my-report');
  assert.equal(slugify('  --A__b--  '), 'a-b');
  assert.equal(slugify('my-todos.localhost'), 'my-todos-localhost');
  assert.equal(slugify('我的项目'), '');
});

/* ---- buildEntry ---- */

test('buildEntry: a directory becomes a dir entry with absolute path and defaults', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const entry = buildEntry(path.relative(dir, site), {}, { cwd: dir });
  assert.deepEqual(entry, { id: 'my-site', title: 'My Site', kind: 'dir', path: site, board: 'html' });
});

test('buildEntry: a single .html file becomes a file entry; id drops the extension', (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'Report V2.HTM');
  fs.writeFileSync(page, '<!doctype html><html><body>r</body></html>');
  // file 条目恒 doc 壳，不落 board 字段
  const entry = buildEntry(page, {}, { cwd: dir });
  assert.deepEqual(entry, { id: 'report-v2', title: 'Report V2.HTM', kind: 'file', path: page });
  assert.equal(buildEntry(page, { board: 'html' }, { cwd: dir }).board, undefined, 'file 冗余的 html 也不落盘');
  assert.throws(() => buildEntry(page, { board: 'ios' }, { cwd: dir }), /--board ios 只对目录有意义/);
});

test('buildEntry: non-html single files and missing paths are rejected', (t) => {
  const dir = withTempDir(t);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  assert.throws(() => buildEntry(path.join(dir, 'notes.txt'), {}, { cwd: dir }), /只支持 \.html\/\.htm/);
  assert.throws(() => buildEntry(path.join(dir, 'ghost'), {}, { cwd: dir }), /路径不存在/);
});

test('buildEntry: http(s) URLs become url entries keyed off the hostname, board dropped', (t) => {
  const dir = withTempDir(t);
  const entry = buildEntry('https://my-todos.localhost/app?q=1', { board: 'ios' }, { cwd: dir });
  assert.deepEqual(entry, {
    id: 'my-todos-localhost',
    title: 'my-todos.localhost',
    kind: 'url',
    url: 'https://my-todos.localhost/app?q=1',
  });
});

test('buildEntry: --id validation — pattern enforced, duplicates error instead of overwriting', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  assert.throws(() => buildEntry(site, { id: 'Bad Id' }, { cwd: dir }), /--id 必须匹配/);
  assert.throws(() => buildEntry(site, { id: 'taken' }, { cwd: dir, takenIds: ['taken'] }), /id 已存在/);
});

test('buildEntry: 撞 id 不再静默追加 -2，而是指路 move（既有标注按 id 寻址）', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const existing = { id: 'my-site', kind: 'dir', path: '/old/place' };
  assert.throws(
    () => buildEntry(site, {}, { cwd: dir, takenEntries: [existing] }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /id 已存在：my-site，指向 \/old\/place/);
      assert.match(error.message, /pinpoint move my-site <新路径>/);
      assert.match(error.message, /--id <其他 id>/);
      return true;
    },
  );
  // 显式 --id 撞车同样指路
  assert.throws(
    () => buildEntry(site, { id: 'my-site' }, { cwd: dir, takenEntries: [existing] }),
    /pinpoint move my-site/,
  );
});

test('buildEntry: --board only accepts ios|html', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  assert.throws(() => buildEntry(site, { board: 'web' }, { cwd: dir }), /--board 只支持/);
  assert.equal(buildEntry(site, { board: 'ios' }, { cwd: dir }).board, 'ios');
});

test('buildEntry: a name that cannot slugify needs an explicit --id', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, '看板');
  assert.throws(() => buildEntry(site, {}, { cwd: dir }), /--id 显式指定/);
  assert.equal(buildEntry(site, { id: 'kanban' }, { cwd: dir }).id, 'kanban');
});

/* ---- 阶段 8：--page / --draft ---- */

test('buildEntry: --page 归属既有页（本地 manifest 页或另一 registry 条目），--draft 落 role', (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'Variant.html');
  fs.writeFileSync(page, '<!doctype html><html><body>v</body></html>');
  // 本地 manifest 页
  assert.deepEqual(
    buildEntry(page, { page: 'weekly-review', draft: true }, { cwd: dir, pageIds: ['weekly-review'] }),
    { id: 'variant', title: 'Variant.html', kind: 'file', path: page, page: 'weekly-review', role: 'draft' },
  );
  // 另一 registry 条目（经 takenIds）；不带 --draft 不落 role 字段
  const product = buildEntry(page, { page: 'e2e-dir' }, { cwd: dir, takenIds: ['e2e-dir'] });
  assert.equal(product.page, 'e2e-dir');
  assert.equal('role' in product, false);
});

test('buildEntry: --page 的互斥与可解析性守卫', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const page = path.join(dir, 'v.html');
  fs.writeFileSync(page, '<!doctype html><html><body>v</body></html>');
  // url 条目恒为独立页
  assert.throws(
    () => buildEntry('https://x.localhost', { page: 'library' }, { cwd: dir, pageIds: ['library'] }),
    /url 条目恒为独立页/,
  );
  // --draft 必须搭配 --page
  assert.throws(() => buildEntry(page, { draft: true }, { cwd: dir }), /--draft 需要搭配 --page/);
  // 不可解析的目标页响亮拒绝（不静默写坏 registry）
  assert.throws(
    () => buildEntry(page, { page: 'ghost-page' }, { cwd: dir, pageIds: ['library'], takenIds: ['e2e-dir'] }),
    /目标页不可解析：ghost-page/,
  );
  // 非法 page id 形状
  assert.throws(() => buildEntry(page, { page: 'bad page!' }, { cwd: dir }), /--page 必须匹配/);
  // dir 条目同样可归属
  assert.equal(buildEntry(site, { page: 'library' }, { cwd: dir, pageIds: ['library'] }).page, 'library');
});

test('localManifestPageIds: 读真实仓库 manifest（tracked 模板页恒在）', () => {
  const ids = localManifestPageIds();
  assert.ok(Array.isArray(ids));
  assert.ok(ids.includes('library'), 'tracked 模板页 library 必在');
});

/* ---- resolveRegistryPath / planAdd ---- */

test('resolveRegistryPath: --registry > PINPOINT_REGISTRY > default', (t) => {
  const dir = withTempDir(t);
  assert.equal(resolveRegistryPath({}, {}, dir), path.join(os.homedir(), '.pinpoint', 'registry.json'));
  assert.equal(resolveRegistryPath({}, { PINPOINT_REGISTRY: '/env/reg.json' }, dir), '/env/reg.json');
  assert.equal(resolveRegistryPath({ registry: 'rel.json' }, { PINPOINT_REGISTRY: '/env/reg.json' }, dir), path.join(dir, 'rel.json'));
});

test('planAdd: 查重同时算上文件里的条目与将播种的 pinpoint 默认条目', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, 'pinpoint'); // 名字撞默认条目
  // 文件不存在：写入会播种 pinpoint，所以这个 id 也算占用
  assert.throws(
    () => planAdd(['add', site, '--registry', path.join(dir, 'registry.json')], { cwd: dir, env: {} }),
    /id 已存在：pinpoint/,
  );
  // 文件已存在：撞文件里的条目
  const other = makeSite(dir, 'app');
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ id: 'app', kind: 'dir', path: site }] }));
  assert.throws(() => planAdd(['add', other, '--registry', file], { cwd: dir, env: {} }), /id 已存在：app/);
  // 不撞就照常
  const fresh = makeSite(dir, 'fresh');
  assert.equal(planAdd(['add', fresh, '--registry', file], { cwd: dir, env: {} }).entry.id, 'fresh');
});

/* ---- runAdd ---- */

test('runAdd: usage error exits 1 and never creates the file', async (t) => {
  const dir = withTempDir(t);
  const rec = recorder();
  const file = path.join(dir, 'registry.json');
  const code = await runAdd(['add', '--bogus', 'x'], { ...rec.io, cwd: dir, env: { PINPOINT_REGISTRY: file } });
  assert.equal(code, 1);
  assert.equal(fs.existsSync(file), false);
  assert.match(rec.err[0], /未知选项/);
});

test('runAdd: --help exits 0 with usage on stdout', async () => {
  const rec = recorder();
  const code = await runAdd(['--help'], { ...rec.io, env: {} });
  assert.equal(code, 0);
  assert.match(rec.out[0], /用法/);
});

test('runAdd: server down still registers and says so on stderr', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const rec = recorder();
  const file = path.join(dir, 'registry.json');
  const requestFn = () => Promise.reject(new Error('connect ECONNREFUSED'));
  const code = await runAdd(['add', site, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn });
  assert.equal(code, 0);
  assert.ok(rec.err.some((line) => /服务未在跑/.test(line)));
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.entries.map((e) => e.id), ['pinpoint', 'my-site'], '首次 add 播种 pinpoint 默认条目');
});

test('runAdd: reachable server gets POST /registry/reload; matching path confirms', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const rec = recorder();
  const file = path.join(dir, 'registry.json');
  const calls = [];
  const requestFn = (url, options = {}) => {
    calls.push(`${options.method || 'GET'} ${url}`);
    if (url.endsWith('/health')) return Promise.resolve({ status: 200, json: { ok: true } });
    return Promise.resolve({ status: 200, json: { ok: true, path: file, entries: 2, errors: [], warnings: [] } });
  };
  const code = await runAdd(['add', site, '--registry', file], { ...rec.io, cwd: dir, env: { PINPOINT_ORIGIN: 'https://pinpoint.localhost' }, requestFn });
  assert.equal(code, 0);
  assert.deepEqual(calls, ['GET https://pinpoint.localhost/health', 'POST https://pinpoint.localhost/registry/reload']);
  assert.ok(rec.out.some((line) => /服务已重载（registry 共 2 条）/.test(line)));
});

test('runAdd: a different registry path on the server is called out', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const rec = recorder();
  const file = path.join(dir, 'registry.json');
  const requestFn = (url) => Promise.resolve(url.endsWith('/health')
    ? { status: 200, json: { ok: true } }
    : { status: 200, json: { ok: true, path: '/Users/x/.pinpoint/registry.json', entries: 3, errors: [], warnings: [] } });
  const code = await runAdd(['add', site, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn });
  assert.equal(code, 0);
  assert.ok(rec.err.some((line) => /不是同一个文件/.test(line)));
});

test('runAdd: reachable server with a failing reload is a warning, not a failure', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const rec = recorder();
  const file = path.join(dir, 'registry.json');
  const requestFn = (url) => Promise.resolve(url.endsWith('/health')
    ? { status: 200, json: { ok: true } }
    : { status: 404, json: null });
  const code = await runAdd(['add', site, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn });
  assert.equal(code, 0);
  assert.ok(rec.err.some((line) => /reload 失败/.test(line)));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).entries.length, 2, '条目已登记');
});

test('runAdd: store-level write failure exits 1', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const rec = recorder();
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, '{ broken');
  const code = await runAdd(['add', site, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn: () => Promise.reject(new Error('down')) });
  assert.equal(code, 1);
  assert.ok(rec.err.some((line) => /登记失败/.test(line)));
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});

test('runAdd: --page --draft 写入归属字段并提示分组', async (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'Draft.html');
  fs.writeFileSync(page, '<!doctype html><html><body>d</body></html>');
  const rec = recorder();
  const file = path.join(dir, 'registry.json');
  const requestFn = () => Promise.reject(new Error('down'));
  // 目标页 = tracked 模板页 library（CLI 读真实仓库 manifest 解析）
  const code = await runAdd(['add', page, '--page', 'library', '--draft', '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn });
  assert.equal(code, 0);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = doc.entries.find((e) => e.id === 'draft');
  assert.equal(entry.page, 'library');
  assert.equal(entry.role, 'draft');
  assert.ok(rec.out.some((line) => /归属 Page「library」.*草稿组/.test(line)));
  // 不可解析页整单失败，registry 不动（换个文件，避开 id 查重先报错）
  const other = path.join(dir, 'Draft2.html');
  fs.writeFileSync(other, '<!doctype html><html><body>d2</body></html>');
  const before = fs.readFileSync(file, 'utf8');
  const bad = await runAdd(['add', other, '--page', 'nope', '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn });
  assert.equal(bad, 1);
  assert.ok(rec.err.some((line) => /目标页不可解析/.test(line)));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('requestJson: real HTTP round-trip against a loopback server, timeout on a hung one', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/hang') return; // never answer
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ method: req.method, url: req.url }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const got = await requestJson(`${base}/health`);
  assert.equal(got.status, 200);
  assert.equal(got.json.method, 'GET');
  const posted = await requestJson(`${base}/registry/reload`, { method: 'POST' });
  assert.equal(posted.json.method, 'POST');
  await assert.rejects(() => requestJson(`${base}/hang`, { timeoutMs: 200 }), /timeout/);
});

/* ---- add 撞 id 的出口行为 ---- */

test('runAdd: 撞 id 退非零、不写盘，并指路 move', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    entries: [{ id: 'my-site', title: 'My Site', kind: 'dir', path: '/old/place' }],
  }, null, 2) + '\n');
  const before = fs.readFileSync(file, 'utf8');
  const rec = recorder();
  const code = await runAdd(['add', site, '--registry', file], {
    ...rec.io, cwd: dir, env: {}, requestFn: () => Promise.reject(new Error('down')),
  });
  assert.equal(code, 1);
  assert.ok(rec.err.some((line) => /id 已存在：my-site，指向 \/old\/place/.test(line)));
  assert.ok(rec.err.some((line) => /pinpoint move my-site <新路径>/.test(line)));
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'registry 一个字节没动');
});

/* ---- move ---- */

function registryWith(dir, entries) {
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries }, null, 2) + '\n');
  return file;
}

test('buildMove: 换落点，id / title / 归属原样带走', (t) => {
  const dir = withTempDir(t);
  const next = makeSite(dir, 'new-home');
  const before = { id: 'app', title: '我的应用', kind: 'dir', path: '/gone', board: 'ios' };
  const { after } = buildMove('app', next, { cwd: dir, entries: [before] });
  assert.deepEqual(after, { id: 'app', title: '我的应用', kind: 'dir', path: next, board: 'ios' });
});

test('buildMove: dir → file 丢掉 board，dir → url 换字段', (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'one.html');
  fs.writeFileSync(page, '<!doctype html><html><body>1</body></html>');
  const before = { id: 'app', title: 'App', kind: 'dir', path: '/gone', board: 'ios' };
  assert.deepEqual(buildMove('app', page, { cwd: dir, entries: [before] }).after,
    { id: 'app', title: 'App', kind: 'file', path: page });
  assert.deepEqual(buildMove('app', 'https://app.localhost/x', { cwd: dir, entries: [before] }).after,
    { id: 'app', title: 'App', kind: 'url', url: 'https://app.localhost/x' });
});

test('buildMove: 未知 id / 不存在的目标 / 挂了页的条目改 url，都响亮拒绝', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const entries = [{ id: 'app', kind: 'dir', path: '/gone' }, { id: 'draft', kind: 'file', path: '/gone.html', page: 'library' }];
  assert.throws(() => buildMove('ghost', site, { cwd: dir, entries }), /条目不存在：ghost（现有：app、draft）/);
  assert.throws(() => buildMove('app', path.join(dir, 'nope'), { cwd: dir, entries }), /路径不存在/);
  assert.throws(() => buildMove('app', path.join(dir, 'x.txt'), { cwd: dir, entries }), /路径不存在/);
  assert.throws(() => buildMove('draft', 'https://x.localhost', { cwd: dir, entries }), /url 条目恒为独立页/);
});

test('runMove: 原地改路径、保留 id 与位置，并 reload 服务', async (t) => {
  const dir = withTempDir(t);
  const next = makeSite(dir, 'moved');
  const file = registryWith(dir, [
    { id: 'pinpoint', title: 'pinpoint workbench', kind: 'dir', path: dir },
    { id: 'app', title: '我的应用', kind: 'dir', path: '/gone', board: 'ios' },
  ]);
  const rec = recorder();
  const calls = [];
  const requestFn = (url, options = {}) => {
    calls.push(`${options.method || 'GET'} ${url}`);
    if (url.endsWith('/health')) return Promise.resolve({ status: 200, json: { ok: true } });
    return Promise.resolve({ status: 200, json: { ok: true, path: file, entries: 2 } });
  };
  const code = await runMove(['move', 'app', next, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn });
  assert.equal(code, 0);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.entries.map((e) => e.id), ['pinpoint', 'app'], '顺序不变');
  assert.deepEqual(doc.entries[1], { id: 'app', kind: 'dir', title: '我的应用', path: next, board: 'ios' });
  assert.deepEqual(calls, ['GET /health', 'POST /registry/reload'].map((c) => c.replace(' /', ' https://pinpoint.localhost/')));
  assert.ok(rec.out.some((line) => /已重指 app/.test(line)));
  assert.ok(rec.out.some((line) => /标注桶 ~\/\.pinpoint\/app\/ 不变/.test(line)));
  assert.ok(rec.out.some((line) => /服务已重载/.test(line)));
});

test('runMove: file 与 url 目标', async (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'r.html');
  fs.writeFileSync(page, '<!doctype html><html><body>r</body></html>');
  const file = registryWith(dir, [{ id: 'app', title: 'App', kind: 'dir', path: dir, board: 'ios' }]);
  const requestFn = () => Promise.reject(new Error('down'));
  const rec = recorder();
  assert.equal(await runMove(['move', 'app', page, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries[0],
    { id: 'app', kind: 'file', title: 'App', path: page });
  assert.equal(await runMove(['move', 'app', 'https://app.localhost/', '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries[0],
    { id: 'app', kind: 'url', title: 'App', url: 'https://app.localhost/' });
  assert.ok(rec.err.some((line) => /服务未在跑/.test(line)));
});

test('runMove: 未知 id 与不存在的目标退非零，registry 不动', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const file = registryWith(dir, [{ id: 'app', kind: 'dir', path: dir }]);
  const before = fs.readFileSync(file, 'utf8');
  const requestFn = () => Promise.reject(new Error('down'));
  const rec = recorder();
  assert.equal(await runMove(['move', 'ghost', site, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn }), 1);
  assert.equal(await runMove(['move', 'app', path.join(dir, 'ghost'), '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn }), 1);
  assert.ok(rec.err.some((line) => /条目不存在：ghost/.test(line)));
  assert.ok(rec.err.some((line) => /路径不存在/.test(line)));
  assert.ok(!rec.err.some((line) => /^用法：/.test(line)), '目标不成立不刷 usage，答案在错误行里');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  // 参数形状不对才刷 usage
  const usage = recorder();
  assert.equal(await runMove(['move', 'app'], { ...usage.io, cwd: dir, env: {}, requestFn }), 1);
  assert.ok(usage.err.some((line) => /^用法：/.test(line)));
});

/* ---- 服务生命周期：路由表与判定 ---- */

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ROUTES_OK = JSON.stringify([
  { hostname: 'other.localhost', port: 3001, pid: 0 },
  { hostname: 'pinpoint.localhost', port: 4812, pid: 94084 },
]);

function healthJson(overrides = {}) {
  return {
    ok: true,
    root: REPO_ROOT,
    dataDir: '/x/pinpoint',
    dataRoot: '/x',
    registry: { ok: true, path: '/x/registry.json', entries: 22, errors: [], warnings: [] },
    ...overrides,
  };
}

test('parseRoutes / pickRoute: 规范化 portless 路由表，坏文件当空表', () => {
  assert.deepEqual(parseRoutes(ROUTES_OK), [
    { hostname: 'other.localhost', port: 3001, pid: 0 },
    { hostname: 'pinpoint.localhost', port: 4812, pid: 94084 },
  ]);
  assert.deepEqual(parseRoutes('{ broken'), []);
  assert.deepEqual(parseRoutes('{"routes":[]}'), []);
  assert.deepEqual(parseRoutes('[{"hostname":"a.localhost"},{"port":1}]'), []);
  assert.deepEqual(parseRoutes('[{"hostname":"a.localhost","port":"5199"}]'), [{ hostname: 'a.localhost', port: 5199, pid: 0 }]);
  assert.equal(pickRoute(parseRoutes(ROUTES_OK)).port, 4812);
  assert.equal(pickRoute(parseRoutes(ROUTES_OK), 'ghost.localhost'), null);
});

test('portlessRoutesPath / serviceLogPath: 环境变量可覆盖', () => {
  assert.equal(portlessRoutesPath({ PORTLESS_ROUTES: '/tmp/r.json' }), '/tmp/r.json');
  assert.match(portlessRoutesPath({}), /\.portless\/routes\.json$/);
  assert.equal(serviceLogPath({ PINPOINT_DATA_DIR: '/tmp/pp' }), '/tmp/pp/logs/service.log');
});

test('displayWidth: 全角算两列（状态表靠它对齐）', () => {
  assert.equal(displayWidth('路由'), 4);
  assert.equal(displayWidth('直连 /health'), 12);
});

test('classifyStatus: 全绿', () => {
  const report = classifyStatus({
    repoRoot: REPO_ROOT,
    routesPath: '/r.json',
    route: { hostname: 'pinpoint.localhost', port: 4812, pid: 94084 },
    pidAlive: true,
    direct: { url: 'http://127.0.0.1:4812/health', ok: true, status: 200, json: healthJson() },
    proxied: { url: 'https://pinpoint.localhost/health', ok: true, status: 200, json: healthJson() },
  });
  assert.equal(report.ok, true);
  assert.equal(report.diagnosis, '服务正常。');
  assert.deepEqual(report.rows.map((r) => r.state), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
  const lines = formatStatus(report);
  assert.equal(lines.length, 7);
  assert.match(lines[0], /路由\s+正常\s+pinpoint\.localhost → 127\.0\.0\.1:4812/);
  assert.match(lines.at(-1), /→ 服务正常。/);
});

test('classifyStatus: 没起过（portless 里没有路由）', () => {
  const report = classifyStatus({ repoRoot: REPO_ROOT, routesPath: '/r.json', route: null, proxied: { url: 'p', ok: false, error: 'ECONNREFUSED' } });
  assert.equal(report.ok, false);
  assert.match(report.diagnosis, /没在跑.*pinpoint start/);
  assert.match(report.rows[0].detail, /\/r\.json 里没有 pinpoint\.localhost/);
  assert.equal(report.rows[1].state, 'skip');
});

test('classifyStatus: 2026-08-17 形态 —— 路由在、进程死了', () => {
  const report = classifyStatus({
    repoRoot: REPO_ROOT,
    routesPath: '/r.json',
    route: { hostname: 'pinpoint.localhost', port: 4812, pid: 28792 },
    pidAlive: false,
    direct: { url: 'd', ok: false, error: 'ECONNREFUSED' },
    proxied: { url: 'p', ok: false, status: 404 },
  });
  assert.equal(report.ok, false);
  assert.equal(report.pidAlive, false);
  assert.match(report.diagnosis, /进程没了（2026-08-17 形态/);
  assert.match(report.rows[1].detail, /pid 28792 已不在/);
});

test('classifyStatus: 2026-09-04 形态 —— 进程活着、直连不通（配置落回默认）', () => {
  const report = classifyStatus({
    repoRoot: REPO_ROOT,
    routesPath: '/r.json',
    route: { hostname: 'pinpoint.localhost', port: 4939, pid: 28792 },
    pidAlive: true,
    direct: { url: 'http://127.0.0.1:4939/health', ok: false, error: 'connect ECONNREFUSED' },
    proxied: { url: 'https://pinpoint.localhost/health', ok: false, status: 502 },
  });
  assert.equal(report.ok, false);
  assert.equal(report.pidAlive, true);
  assert.match(report.diagnosis, /进程活着但直连 \/health 不通（2026-09-04 形态/);
  assert.match(report.rows[3].detail, /HTTP 502/);
  // /health 问不到时，root 与 registry 两行诚实标 skip，不装作查过
  assert.deepEqual(report.rows.slice(4).map((r) => r.state), ['skip', 'skip']);
});

test('classifyStatus: 直连通、代理不通 = 代理侧问题（不去动 proxy daemon）', () => {
  const report = classifyStatus({
    repoRoot: REPO_ROOT,
    routesPath: '/r.json',
    route: { hostname: 'pinpoint.localhost', port: 4812, pid: 1 },
    pidAlive: true,
    direct: { url: 'd', ok: true, status: 200, json: healthJson() },
    proxied: { url: 'p', ok: false, status: 502 },
  });
  assert.equal(report.ok, false);
  assert.match(report.diagnosis, /穿代理打不通/);
  assert.equal(report.rows[4].state, 'ok', '直连拿到的 /health 仍可比对 root');
});

test('classifyStatus: 服务跑在别的目录 = 失败（worktree / 搬迁后的旧路径）', () => {
  const report = classifyStatus({
    repoRoot: REPO_ROOT,
    routesPath: '/r.json',
    route: { hostname: 'pinpoint.localhost', port: 4812, pid: 1 },
    pidAlive: true,
    direct: { url: 'd', ok: true, status: 200, json: healthJson({ root: '/somewhere/else' }) },
    proxied: { url: 'p', ok: true, status: 200, json: healthJson({ root: '/somewhere/else' }) },
  });
  assert.equal(report.ok, false);
  assert.equal(report.serviceRoot, '/somewhere/else');
  assert.match(report.diagnosis, /服务跑的是另一个目录（\/somewhere\/else）/);
});

test('classifyStatus: registry 告警不拉红，registry error 才拉红', () => {
  const base = {
    repoRoot: REPO_ROOT,
    routesPath: '/r.json',
    route: { hostname: 'pinpoint.localhost', port: 4812, pid: 1 },
    pidAlive: true,
  };
  const withHealth = (registry) => {
    const json = healthJson({ registry });
    return classifyStatus({ ...base, direct: { url: 'd', ok: true, status: 200, json }, proxied: { url: 'p', ok: true, status: 200, json } });
  };
  const warned = withHealth({ ok: true, path: '/x.json', entries: 3, errors: [], warnings: ['entry "a" path does not exist: /gone'] });
  assert.equal(warned.ok, true);
  assert.match(warned.diagnosis, /有告警/);
  assert.ok(warned.rows.some((row) => row.state === 'note' && /\/gone/.test(row.detail)), '告警正文照抄一行');
  const broken = withHealth({ ok: false, path: '/x.json', entries: 1, errors: ['registry is not valid JSON'], warnings: [] });
  assert.equal(broken.ok, false);
  assert.match(broken.diagnosis, /registry 有 error/);
  // 旧服务（没有 root 字段）只是告警，不拉红
  const old = classifyStatus({ ...base, direct: { url: 'd', ok: true, status: 200, json: { ok: true, registry: { ok: true, entries: 1, errors: [], warnings: [] } } }, proxied: { url: 'p', ok: true, status: 200, json: { ok: true, registry: { ok: true, entries: 1, errors: [], warnings: [] } } } });
  assert.equal(old.ok, true);
  assert.equal(old.rows[4].state, 'warn');
});

test('decideStart / decideStop: 健康就不重复起，进程还在就走 restart', () => {
  const healthy = { ok: true, pid: 7, pidAlive: true };
  const zombie = { ok: false, pid: 7, pidAlive: true };
  const dead = { ok: false, pid: 7, pidAlive: false };
  const never = { ok: false, pid: 0, pidAlive: false };
  assert.equal(decideStart(healthy).action, 'refuse');
  assert.match(decideStart(healthy).reason, /已经在跑/);
  assert.equal(decideStart(zombie).action, 'refuse');
  assert.match(decideStart(zombie).reason, /pinpoint restart/);
  assert.equal(decideStart(dead).action, 'start');
  assert.equal(decideStart(never).action, 'start');
  assert.deepEqual(decideStop(zombie), { action: 'kill', pid: 7 });
  assert.equal(decideStop(dead).action, 'none');
  assert.equal(decideStop(never).action, 'none');
});

/* ---- 服务生命周期：run* ---- */

function lifecycleIo(t, { routes = ROUTES_OK, health = healthJson(), alive = true, dataDir } = {}) {
  const dir = withTempDir(t);
  const routesFile = path.join(dir, 'routes.json');
  fs.writeFileSync(routesFile, routes);
  const rec = recorder();
  const state = { health, alive, killed: [], spawned: [], routesFile, dir };
  const io = {
    ...rec.io,
    cwd: dir,
    env: { PORTLESS_ROUTES: routesFile, PINPOINT_DATA_DIR: dataDir || path.join(dir, 'data') },
    requestFn: (url) => (state.health
      ? Promise.resolve({ status: 200, json: state.health })
      : Promise.reject(new Error('connect ECONNREFUSED'))),
    pidAlive: () => state.alive,
    killPid: (pid, signal) => { state.killed.push(`${signal} ${pid}`); },
    sleep: () => Promise.resolve(),
    spawnService: (options) => { state.spawned.push(options); return { pid: 5150 }; },
  };
  return { io, rec, state };
}

test('collectStatus: 读真实 routes.json 文件 + 两条 /health 探测', async (t) => {
  const { io } = lifecycleIo(t);
  const report = await collectStatus(io);
  assert.equal(report.port, 4812);
  assert.equal(report.pid, 94084);
  assert.equal(report.ok, true);
  const missing = lifecycleIo(t, { routes: '[]' });
  assert.equal((await collectStatus(missing.io)).ok, false);
});

test('runStatus: 全绿退 0，出问题退 1 并打表', async (t) => {
  const green = lifecycleIo(t);
  assert.equal(await runStatus(['status'], green.io), 0);
  assert.equal(green.rec.out[0], 'pinpoint status');
  assert.ok(green.rec.out.some((line) => /→ 服务正常。/.test(line)));

  const dead = lifecycleIo(t, { health: null, alive: false });
  assert.equal(await runStatus(['status'], dead.io), 1);
  assert.ok(dead.rec.out.some((line) => /进程没了/.test(line)));
});

test('runStop: 没有活进程是幂等的；有就 SIGTERM 并复核', async (t) => {
  const none = lifecycleIo(t, { routes: '[]' });
  assert.equal(await runStop(['stop'], none.io), 0);
  assert.ok(none.rec.out.some((line) => /没有在跑的 pinpoint 服务/.test(line)));
  assert.deepEqual(none.state.killed, []);

  const running = lifecycleIo(t);
  running.io.pidAlive = () => running.state.alive;
  running.io.killPid = (pid, signal) => { running.state.killed.push(`${signal} ${pid}`); running.state.alive = false; };
  assert.equal(await runStop(['stop'], running.io), 0);
  assert.deepEqual(running.state.killed, ['SIGTERM 94084']);
  assert.ok(running.rec.out.some((line) => /已停。/.test(line)));

  // 不肯退出的进程 = 失败，交给人决定要不要 SIGKILL
  const stubborn = lifecycleIo(t);
  assert.equal(await runStop(['stop'], stubborn.io), 1);
  assert.ok(stubborn.rec.err.some((line) => /没退出/.test(line)));
});

test('runStart: 健康就拒绝；不健康时 spawn 并轮询到健康', async (t) => {
  const green = lifecycleIo(t);
  assert.equal(await run(['start'], green.io), 1);
  assert.deepEqual(green.state.spawned, []);
  assert.ok(green.rec.err.some((line) => /已经在跑/.test(line)));

  // 进程还在但不健康：不叠一个新的 portless 注册，指路 restart
  const zombie = lifecycleIo(t, { health: null, alive: true });
  assert.equal(await run(['start'], zombie.io), 1);
  assert.deepEqual(zombie.state.spawned, []);
  assert.ok(zombie.rec.err.some((line) => /pinpoint restart/.test(line)));

  // 干净起：spawn 后服务变健康
  const cold = lifecycleIo(t, { routes: '[]', health: null, alive: false });
  cold.io.spawnService = (options) => {
    cold.state.spawned.push(options);
    fs.writeFileSync(cold.state.routesFile, ROUTES_OK);
    cold.state.health = healthJson();
    cold.state.alive = true;
    return { pid: 5150 };
  };
  assert.equal(await run(['start'], cold.io), 0);
  assert.equal(cold.state.spawned.length, 1);
  assert.match(cold.state.spawned[0].logFile, /logs\/service\.log$/);
  assert.ok(fs.existsSync(path.dirname(cold.state.spawned[0].logFile)), '日志目录已建');
  assert.ok(cold.rec.out.some((line) => /→ 服务正常。/.test(line)));
});

test('runRestart: 先停后起，停不掉就不起', async (t) => {
  const running = lifecycleIo(t);
  running.io.killPid = () => { running.state.alive = false; running.state.health = null; fs.writeFileSync(running.state.routesFile, '[]'); };
  running.io.spawnService = (options) => {
    running.state.spawned.push(options);
    fs.writeFileSync(running.state.routesFile, ROUTES_OK);
    running.state.health = healthJson();
    running.state.alive = true;
    return { pid: 5151 };
  };
  assert.equal(await run(['restart'], running.io), 0);
  assert.equal(running.state.spawned.length, 1);

  const stuck = lifecycleIo(t);
  assert.equal(await run(['restart'], stuck.io), 1);
  assert.deepEqual(stuck.state.spawned, [], '停不掉就不 spawn');
});

test('run: 未知命令退 1 并打 usage；无参数打 usage', async (t) => {
  const { io, rec } = lifecycleIo(t);
  assert.equal(await run(['reload'], io), 1);
  assert.ok(rec.err.some((line) => /未知命令：reload/.test(line)));
  assert.equal(await run([], io), 0);
  assert.match(rec.out.at(-1), /用法/);
});
