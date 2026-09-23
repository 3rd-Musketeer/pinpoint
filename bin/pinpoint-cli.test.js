import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildEntry,
  buildMove,
  buildFolderAdd,
  buildFolderMove,
  buildFolderRemove,
  buildFolderRename,
  buildRename,
  classifyStatus,
  CliError,
  collectStatus,
  decideStart,
  decideStop,
  displayWidth,
  folderRows,
  formatFolderList,
  formatStatus,
  manifestPageIds,
  parseArgs,
  parseRoutes,
  pickRoute,
  planAdd,
  planFolder,
  planRenderOutput,
  portlessRoutesPath,
  requestJson,
  rewriteSitePrefix,
  rewriteSitePrefixUnder,
  resolveRegistryPath,
  run,
  runAdd,
  runBuild,
  runFolder,
  runMove,
  runRename,
  runRender,
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

test('manifestPageIds: 读真实仓库 manifest（模板页退役后为空数组）', () => {
  const ids = manifestPageIds();
  assert.deepEqual(ids, []);
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
  // 目标页 = 已登记的 registry 条目（模板页退役后 --page 只认登记表与空 manifest，
  // CLI 读真实仓库 manifest 解析，空 manifest 不报错）。
  const file = seedRegistry(dir, { entries: [{ id: 'target-page', kind: 'dir', path: dir }] });
  const requestFn = () => Promise.reject(new Error('down'));
  const code = await runAdd(['add', page, '--page', 'target-page', '--draft', '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn });
  assert.equal(code, 0);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = doc.entries.find((e) => e.id === 'draft');
  assert.equal(entry.page, 'target-page');
  assert.equal(entry.role, 'draft');
  assert.ok(rec.out.some((line) => /归属 Page「target-page」.*草稿组/.test(line)));
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

/* ---- rename ---- */

test('rewriteSitePrefix: 只换精确的 /sites/<id>/ 前缀', () => {
  assert.deepEqual(rewriteSitePrefix('<link href="/sites/old/a.css">', 'old', 'new'),
    { text: '<link href="/sites/new/a.css">', changed: true });
  assert.deepEqual(
    rewriteSitePrefix('@import url("/sites/old/m.css"); src="/sites/old/x.js"', 'old', 'new').text,
    '@import url("/sites/new/m.css"); src="/sites/new/x.js"');
  // 不是这个 id、不是这一层前缀、相对路径，一律不动
  for (const text of ['/sites/older/a.css', '/sites/old', 'sites/old/a.css', './old/a.css']) {
    assert.deepEqual(rewriteSitePrefix(text, 'old', 'new'), { text, changed: false }, text);
  }
});

test('rewriteSitePrefixUnder: 只碰 html/css/js，跳过 node_modules 与逃逸 symlink', (t) => {
  const dir = withTempDir(t);
  const site = path.join(dir, 'site');
  fs.mkdirSync(path.join(site, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(site, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(site, 'a.html'), '<script src="/sites/old/x.js"></script>');
  fs.writeFileSync(path.join(site, 'sub', 'b.css'), '@import url("/sites/old/m.css");');
  fs.writeFileSync(path.join(site, 'sub', 'c.js'), 'fetch("/sites/old/d.json")');
  fs.writeFileSync(path.join(site, 'notes.md'), '/sites/old/x.js');       // 扩展名不在名单
  fs.writeFileSync(path.join(site, 'clean.html'), '<p>no prefix</p>');    // 不含前缀
  fs.writeFileSync(path.join(site, 'node_modules', 'dep.js'), '"/sites/old/x.js"');
  const outside = path.join(dir, 'outside.html');
  fs.writeFileSync(outside, '"/sites/old/x.js"');
  fs.symlinkSync(outside, path.join(site, 'link.html'));

  const preview = rewriteSitePrefixUnder(site, 'old', 'new', { dryRun: true });
  assert.deepEqual(preview.sort(), ['a.html', 'sub/b.css', 'sub/c.js']);
  assert.equal(fs.readFileSync(path.join(site, 'a.html'), 'utf8'), '<script src="/sites/old/x.js"></script>', 'dryRun 不落盘');

  const changed = rewriteSitePrefixUnder(site, 'old', 'new');
  assert.deepEqual(changed.sort(), ['a.html', 'sub/b.css', 'sub/c.js']);
  assert.equal(fs.readFileSync(path.join(site, 'a.html'), 'utf8'), '<script src="/sites/new/x.js"></script>');
  assert.equal(fs.readFileSync(path.join(site, 'sub', 'b.css'), 'utf8'), '@import url("/sites/new/m.css");');
  assert.equal(fs.readFileSync(path.join(site, 'notes.md'), 'utf8'), '/sites/old/x.js');
  assert.equal(fs.readFileSync(path.join(site, 'node_modules', 'dep.js'), 'utf8'), '"/sites/old/x.js"');
  assert.equal(fs.readFileSync(outside, 'utf8'), '"/sites/old/x.js"', '逃出条目目录的 symlink 不归它管');
});

test('buildRename: 只换 id，落点与归属原样；挂在旧 id 上的条目跟着改', (t) => {
  const entries = [
    { id: 'old', title: '我的应用', kind: 'dir', path: '/x', board: 'ios' },
    { id: 'note', kind: 'file', path: '/n.html', page: 'old', role: 'draft' },
    { id: 'other', kind: 'file', path: '/o.html', page: 'library' },
  ];
  const { before, after, attached } = buildRename('old', 'fresh', { entries });
  assert.equal(before.id, 'old');
  assert.deepEqual(after, { id: 'fresh', title: '我的应用', kind: 'dir', path: '/x', board: 'ios' });
  assert.deepEqual(attached, ['note']);
});

test('buildRename: 未知 id / 非法新 id / 同名 / 撞 id 都响亮拒绝', () => {
  const entries = [{ id: 'old', kind: 'dir', path: '/x' }, { id: 'taken', kind: 'dir', path: '/t' }];
  assert.throws(() => buildRename('ghost', 'fresh', { entries }), /条目不存在：ghost（现有：old、taken）/);
  assert.throws(() => buildRename('old', 'Not Ok', { entries }), /新 id 必须匹配/);
  assert.throws(() => buildRename('old', 'old', { entries }), /新旧 id 相同/);
  assert.throws(() => buildRename('old', 'taken', { entries }), /id 已存在：taken，指向 \/t；把两个条目并成一个 = 先 rename 再/);
});

test('runRename: 登记表 + 标注桶 + 资源前缀一起改，并 reload 服务', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, 'site');
  fs.writeFileSync(path.join(site, 'card.html'), '<link rel="stylesheet" href="/sites/old/card.css">');
  fs.writeFileSync(path.join(site, 'card.css'), '@import url("/sites/old/base.css");');
  const dataRoot = path.join(dir, 'data');
  fs.mkdirSync(path.join(dataRoot, 'old'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'old', 'page.json'), '{"annotations":[]}');
  const file = registryWith(dir, [
    { id: 'pinpoint', kind: 'dir', path: dir },
    { id: 'old', title: '我的应用', kind: 'dir', path: site, board: 'ios' },
    { id: 'note', kind: 'file', path: path.join(site, 'index.html'), page: 'old' },
  ]);
  const rec = recorder();
  const calls = [];
  const requestFn = (url, options = {}) => {
    calls.push(`${options.method || 'GET'} ${url}`);
    if (url.endsWith('/health')) return Promise.resolve({ status: 200, json: { ok: true } });
    return Promise.resolve({ status: 200, json: { ok: true, path: file, entries: 3 } });
  };
  const env = { PINPOINT_DATA_DIR: dataRoot };
  const code = await runRename(['rename', 'old', 'fresh', '--registry', file], { ...rec.io, cwd: dir, env, requestFn });
  assert.equal(code, 0);

  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.entries.map((e) => e.id), ['pinpoint', 'fresh', 'note'], '位置不变');
  assert.deepEqual(doc.entries[1], { id: 'fresh', kind: 'dir', title: '我的应用', path: site, board: 'ios' });
  assert.equal(doc.entries[2].page, 'fresh', '挂靠条目跟着改');

  assert.ok(!fs.existsSync(path.join(dataRoot, 'old')), '旧桶已改名');
  assert.equal(fs.readFileSync(path.join(dataRoot, 'fresh', 'page.json'), 'utf8'), '{"annotations":[]}');

  assert.equal(fs.readFileSync(path.join(site, 'card.html'), 'utf8'), '<link rel="stylesheet" href="/sites/fresh/card.css">');
  assert.equal(fs.readFileSync(path.join(site, 'card.css'), 'utf8'), '@import url("/sites/fresh/base.css");');

  assert.deepEqual(calls, ['GET https://pinpoint.localhost/health', 'POST https://pinpoint.localhost/registry/reload']);
  assert.ok(rec.out.some((line) => /已改 id：old → fresh/.test(line)));
  assert.ok(rec.out.some((line) => /2 个文件里的 \/sites\/old\/ 已换成 \/sites\/fresh\//.test(line)));
  assert.ok(rec.out.some((line) => /服务已重载/.test(line)));
});

test('runRename: 没有标注桶 / file 与 url 条目跳过资源前缀', async (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'r.html');
  fs.writeFileSync(page, '<!doctype html><html><body>r</body></html>');
  const file = registryWith(dir, [{ id: 'doc', title: 'Doc', kind: 'file', path: page }]);
  const rec = recorder();
  const requestFn = () => Promise.reject(new Error('down'));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  assert.equal(await runRename(['rename', 'doc', 'report', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries[0],
    { id: 'report', kind: 'file', title: 'Doc', path: page });
  assert.ok(rec.out.some((line) => /标注桶：.*不存在，没有标注要搬/.test(line)));
  assert.ok(rec.out.some((line) => /file 条目没有目录可扫，跳过/.test(line)));
  assert.ok(rec.err.some((line) => /服务未在跑/.test(line)));
});

test('runRename: 预检不过就一个字节都不动（新桶已存在 / 目录不存在 / 撞 id）', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, 'site');
  const dataRoot = path.join(dir, 'data');
  fs.mkdirSync(path.join(dataRoot, 'old'), { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'fresh'), { recursive: true });
  const file = registryWith(dir, [
    { id: 'old', kind: 'dir', path: site },
    { id: 'gone', kind: 'dir', path: path.join(dir, 'vanished') },
    { id: 'taken', kind: 'dir', path: site },
  ]);
  const before = fs.readFileSync(file, 'utf8');
  const requestFn = () => Promise.reject(new Error('down'));
  const env = { PINPOINT_DATA_DIR: dataRoot };
  const rec = recorder();
  assert.equal(await runRename(['rename', 'old', 'fresh', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 1);
  assert.equal(await runRename(['rename', 'gone', 'other', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 1);
  assert.equal(await runRename(['rename', 'old', 'taken', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 1);
  assert.ok(rec.err.some((line) => /标注桶已存在/.test(line)));
  assert.ok(rec.err.some((line) => /目录不存在.*先 `pinpoint move gone/.test(line)));
  assert.ok(rec.err.some((line) => /id 已存在：taken/.test(line)));
  assert.ok(!rec.err.some((line) => /^用法：/.test(line)));
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  // 参数形状不对才刷 usage
  const usage = recorder();
  assert.equal(await runRename(['rename', 'old'], { ...usage.io, cwd: dir, env, requestFn }), 1);
  assert.ok(usage.err.some((line) => /^用法：/.test(line)));
});

/* ---- folder（分组层） ---- */

/** 一份可写的登记表：一个 dir 条目 + 给定的分组段。 */
function seedRegistry(dir, { entries, ...rest } = {}) {
  const site = makeSite(dir, 'site');
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    entries: entries || [{ id: 'site', title: 'site', kind: 'dir', path: site }],
    ...rest,
  }));
  return file;
}

const readDoc = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
/** 服务不可达（folder 的写入照常落盘，只是不 reload）。 */
const serverDown = () => Promise.reject(new Error('connect ECONNREFUSED'));

test('parseArgs: folder 的子命令层', () => {
  assert.deepEqual(parseArgs(['folder', 'list']), { command: 'folder', sub: 'list', args: [], flags: {} });
  assert.deepEqual(parseArgs(['folder', 'add', '设计稿', '--id', 'design']), {
    command: 'folder', sub: 'add', args: ['设计稿'], flags: { id: 'design' },
  });
  assert.deepEqual(parseArgs(['folder', 'move', 'site', 'none', '--registry=/tmp/r.json']), {
    command: 'folder', sub: 'move', args: ['site', 'none'], flags: { registry: '/tmp/r.json' },
  });
  assert.throws(() => parseArgs(['folder']), /folder 需要一个子命令/);
  assert.throws(() => parseArgs(['folder', 'nuke', 'x']), /未知子命令：folder nuke/);
  assert.throws(() => parseArgs(['folder', 'list', 'extra']), /folder list 需要 0 个参数/);
  assert.throws(() => parseArgs(['folder', 'rename', 'x']), /folder rename 需要 2 个参数/);
  assert.throws(() => parseArgs(['folder', 'list', '--id', 'x']), /--id 不适用于 folder list/);
  assert.throws(() => parseArgs(['folder', 'add', 'x', '--draft']), /不适用于 folder/);
});

test('buildFolderAdd: id 由名称派生，撞 id 与派生不出都响亮拒绝', () => {
  assert.deepEqual(buildFolderAdd('Design Drafts', {}, { folders: [] }), {
    folder: { id: 'design-drafts', name: 'Design Drafts' },
    folders: [{ id: 'design-drafts', name: 'Design Drafts' }],
  });
  // 显式 --id：中文名派生不出 slug，只能这么建
  assert.deepEqual(buildFolderAdd('归档', { id: 'archive' }, { folders: [] }).folder, { id: 'archive', name: '归档' });
  assert.throws(() => buildFolderAdd('归档', {}, { folders: [] }), /无法从「归档」派生 id/);
  assert.throws(() => buildFolderAdd('  ', {}, { folders: [] }), /文件夹名不能为空/);
  assert.throws(() => buildFolderAdd('x', { id: 'Bad Id' }, { folders: [] }), /--id 必须匹配/);
  assert.throws(
    () => buildFolderAdd('Design', {}, { folders: [{ id: 'design', name: '设计' }] }),
    /文件夹 id 已存在：design（名称「设计」）.*folder rename design/,
  );
  // 既有的夹原样带走，新夹追加在末尾（文件顺序 = 左栏顺序）
  const grown = buildFolderAdd('Two', {}, { folders: [{ id: 'one', name: 'One', collapsed: true }] });
  assert.deepEqual(grown.folders.map((f) => f.id), ['one', 'two']);
  assert.equal(grown.folders[0].collapsed, true);
});

test('buildFolderRename: 只换显示名，id 与其余字段不动', () => {
  const folders = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', collapsed: true }];
  const out = buildFolderRename('b', ' 归档 ', { folders });
  assert.deepEqual(out.after, { id: 'b', name: '归档', collapsed: true });
  assert.deepEqual(out.folders.map((f) => f.name), ['A', '归档']);
  assert.throws(() => buildFolderRename('zz', 'X', { folders }), /文件夹不存在：zz（现有：a、b）/);
  assert.throws(() => buildFolderRename('a', '   ', { folders }), /文件夹名不能为空/);
  assert.throws(() => buildFolderRename('a', 'X', { folders: [] }), /一个夹都还没有/);
});

test('buildFolderRemove: 从 folders[] 去掉一条（页的释放归写侧）', () => {
  const folders = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const out = buildFolderRemove('a', { folders });
  assert.deepEqual(out.removed, { id: 'a', name: 'A' });
  assert.deepEqual(out.folders, [{ id: 'b', name: 'B' }]);
  assert.throws(() => buildFolderRemove('zz', { folders }), /文件夹不存在：zz/);
});

test('buildFolderMove: 未知的页 / 未知的夹都在写之前拒绝，none = 散页', () => {
  const ctx = { folders: [{ id: 'design', name: 'D' }], entryIds: ['site'], pageIds: ['library'] };
  assert.deepEqual(buildFolderMove('site', 'design', ctx), { id: 'site', kind: 'entry', folder: 'design' });
  assert.deepEqual(buildFolderMove('library', 'design', ctx), { id: 'library', kind: 'page', folder: 'design' });
  assert.deepEqual(buildFolderMove('site', 'none', ctx), { id: 'site', kind: 'entry', folder: null });
  assert.throws(() => buildFolderMove('ghost', 'design', ctx), /未知的页：ghost/);
  assert.throws(() => buildFolderMove('site', 'ghost', ctx), /文件夹不存在：ghost（现有：design）/);
  assert.throws(() => buildFolderMove('site', 'Bad Folder', ctx), /文件夹 id 不合法/);
  assert.throws(() => buildFolderMove('bad id', 'design', ctx), /页 id 不合法/);
});

test('folderRows / formatFolderList: 条目与 manifest 页一起数，全角对齐', () => {
  const rows = folderRows({
    folders: [{ id: 'design', name: '设计稿' }, { id: 'archive', collapsed: true }],
    entries: [{ id: 'site', folder: 'design' }, { id: 'other' }],
    pageFolders: { library: 'design', gallery: 'ghost' },
  });
  assert.deepEqual(rows, [
    { id: 'design', name: '设计稿', count: 2, collapsed: false },
    { id: 'archive', name: 'archive', count: 0, collapsed: true }, // name 缺省等于 id
  ]);
  const lines = formatFolderList(rows);
  assert.equal(lines[0].trim().split(/ {2,}/).join('|'), 'id|名称|页数|折叠');
  assert.deepEqual(lines.slice(1).map((line) => line.trim().split(/ {2,}/)), [
    ['design', '设计稿', '2', '—'],
    ['archive', 'archive', '0', '是'],
  ]);
  // 全角名（设计稿 = 6 列）与 ASCII 名（archive = 7 列）占同一列宽：最后一栏在同一列起头
  const lastColumnAt = (line) => displayWidth(line.replace(/(是|—)$/, ''));
  assert.equal(lastColumnAt(lines[1]), lastColumnAt(lines[2]));
  assert.match(formatFolderList([])[0], /还没有文件夹/);
});

test('planFolder: list 容忍不存在的登记表，写子命令不给它播种', (t) => {
  const dir = withTempDir(t);
  const missing = path.join(dir, 'nope.json');
  assert.deepEqual(planFolder(['folder', 'list', '--registry', missing], { cwd: dir, env: {} }).rows, []);
  assert.throws(
    () => planFolder(['folder', 'add', 'X', '--registry', missing], { cwd: dir, env: {} }),
    /registry 文件还不存在.*先 `pinpoint add/,
  );
  assert.equal(fs.existsSync(missing), false);
});

test('runFolder list: 打表退 0，不写盘、不打服务', async (t) => {
  const dir = withTempDir(t);
  const file = seedRegistry(dir, { folders: [{ id: 'design', name: '设计稿' }], pageFolders: { library: 'design' } });
  const before = fs.readFileSync(file, 'utf8');
  const rec = recorder();
  const calls = [];
  const code = await runFolder(['folder', 'list', '--registry', file], {
    ...rec.io, cwd: dir, env: {}, requestFn: (url) => { calls.push(url); return serverDown(); },
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, [], 'list 是只读命令，不探活也不 reload');
  assert.ok(rec.out.some((line) => /design {2,}设计稿 {2,}1 /.test(line)), '条目 site 还没进夹，夹里只有 library');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('runFolder add / rename / rm: 一次原子写 + 一次 reload；删夹不删页', async (t) => {
  const dir = withTempDir(t);
  const file = seedRegistry(dir);
  const env = { PINPOINT_ORIGIN: 'https://pinpoint.localhost' };
  const calls = [];
  const requestFn = (url, options = {}) => {
    calls.push(`${options.method || 'GET'} ${url}`);
    return Promise.resolve(url.endsWith('/health')
      ? { status: 200, json: { ok: true } }
      : { status: 200, json: { ok: true, path: file, entries: 1, errors: [], warnings: [] } });
  };

  const add = recorder();
  assert.equal(await runFolder(['folder', 'add', 'Design', '--registry', file], { ...add.io, cwd: dir, env, requestFn }), 0);
  assert.deepEqual(readDoc(file).folders, [{ id: 'design', name: 'Design' }]);
  assert.deepEqual(calls, ['GET https://pinpoint.localhost/health', 'POST https://pinpoint.localhost/registry/reload']);
  assert.ok(add.out.some((line) => /已建文件夹 design（Design）/.test(line)));

  // 页进夹，再改夹名——id 不变，条目的 folder 引用不用跟着改
  const move = recorder();
  assert.equal(await runFolder(['folder', 'move', 'site', 'design', '--registry', file], { ...move.io, cwd: dir, env, requestFn }), 0);
  assert.equal(readDoc(file).entries[0].folder, 'design');

  const rename = recorder();
  assert.equal(await runFolder(['folder', 'rename', 'design', '设计稿', '--registry', file], { ...rename.io, cwd: dir, env, requestFn }), 0);
  assert.deepEqual(readDoc(file).folders, [{ id: 'design', name: '设计稿' }]);
  assert.equal(readDoc(file).entries[0].folder, 'design');
  assert.ok(rename.out.some((line) => /已改名文件夹 design：Design → 设计稿/.test(line)));

  // 删夹：条目还在，只是丢掉 folder 字段变散页
  const rm = recorder();
  assert.equal(await runFolder(['folder', 'rm', 'design', '--registry', file], { ...rm.io, cwd: dir, env, requestFn }), 0);
  const doc = readDoc(file);
  assert.equal(doc.folders, undefined, '空的 folders 不留在文件里');
  assert.deepEqual(doc.entries.map((e) => e.id), ['site'], '删夹不删页');
  assert.equal(doc.entries[0].folder, undefined);
  assert.ok(rm.out.some((line) => /1 个页没有被删，变成散页：site/.test(line)));
});

test('runFolder move: registry 条目落条目字段，none 拖出来成散页', async (t) => {
  const dir = withTempDir(t);
  const file = seedRegistry(dir, { folders: [{ id: 'design', name: 'Design' }] });
  const io = { cwd: dir, env: {}, requestFn: serverDown };

  const entry = recorder();
  assert.equal(await runFolder(['folder', 'move', 'site', 'design', '--registry', file], { ...entry.io, ...io }), 0);
  assert.equal(readDoc(file).entries[0].folder, 'design');
  assert.equal(readDoc(file).pageFolders, undefined);
  assert.ok(entry.out.some((line) => /已把 site 放进文件夹 design（registry 条目）/.test(line)));

  // 模板页退役后 manifest 为空，「manifest 页进夹」没有对象；未知页照常被拒（见预检用例）。
  const loose = recorder();
  assert.equal(await runFolder(['folder', 'move', 'site', 'none', '--registry', file], { ...loose.io, ...io }), 0);
  assert.equal(readDoc(file).entries[0].folder, undefined);
  assert.ok(loose.out.some((line) => /已把 site 移出文件夹，现在是散页/.test(line)));
});

test('runFolder: 预检不过就一个字节都不动（未知夹 / 未知页 / 撞 id / 坏文件）', async (t) => {
  const dir = withTempDir(t);
  const file = seedRegistry(dir, { folders: [{ id: 'design', name: 'Design' }] });
  const before = fs.readFileSync(file, 'utf8');
  const io = { cwd: dir, env: {}, requestFn: serverDown };
  const rec = recorder();

  assert.equal(await runFolder(['folder', 'move', 'site', 'ghost', '--registry', file], { ...rec.io, ...io }), 1);
  assert.equal(await runFolder(['folder', 'move', 'ghost', 'design', '--registry', file], { ...rec.io, ...io }), 1);
  assert.equal(await runFolder(['folder', 'add', 'Design', '--registry', file], { ...rec.io, ...io }), 1);
  assert.equal(await runFolder(['folder', 'rm', 'ghost', '--registry', file], { ...rec.io, ...io }), 1);
  assert.ok(rec.err.some((line) => /文件夹不存在：ghost/.test(line)));
  assert.ok(rec.err.some((line) => /未知的页：ghost/.test(line)));
  assert.ok(rec.err.some((line) => /文件夹 id 已存在：design/.test(line)));
  assert.ok(!rec.err.some((line) => /^用法：/.test(line)), '目标不成立不刷 usage，答案在错误行里');
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  // 登记表本身坏了：读侧就抛，同样一个字节不动
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{ broken');
  const bad = recorder();
  assert.equal(await runFolder(['folder', 'list', '--registry', broken], { ...bad.io, ...io }), 1);
  assert.ok(bad.err.some((line) => /不是合法 JSON/.test(line)));
  assert.equal(fs.readFileSync(broken, 'utf8'), '{ broken');

  // 参数形状不对才刷 usage
  const usage = recorder();
  assert.equal(await runFolder(['folder', 'rm'], { ...usage.io, ...io }), 1);
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

/* ---- pp2：build / render ---- */

test('parseArgs: build / render 的选项与位置参数', () => {
  assert.deepEqual(parseArgs(['build', 'plugins']), { command: 'build', target: 'plugins', flags: {} });
  assert.deepEqual(parseArgs(['build', 'plugins', '--screen', 's1-home', '--watch']), {
    command: 'build', target: 'plugins', flags: { screen: 's1-home', watch: true },
  });
  assert.deepEqual(parseArgs(['render', 'library/home', '--full']), {
    command: 'render', target: 'library/home', flags: { full: true },
  });
  assert.throws(() => parseArgs(['build']), /build 需要一个页/);
  assert.throws(() => parseArgs(['render']), /render 需要一帧/);
  assert.throws(() => parseArgs(['build', 'x', '--full']), /选项 --full 不适用于 build/);
  assert.throws(() => parseArgs(['render', 'x/y', '--watch']), /选项 --watch 不适用于 render/);
  assert.throws(() => parseArgs(['build', 'x', '--screen']), /选项 --screen 缺少值/);
});

test('planRenderOutput：限内原文，超限截断 + 落盘计划，--full 不截断', () => {
  const small = planRenderOutput('x'.repeat(100), { limit: 8000, spillPath: '/tmp/s.html' });
  assert.equal(small.text, 'x'.repeat(100));
  assert.equal(small.spill, null);

  const big = 'y'.repeat(9001);
  const plan = planRenderOutput(big, { limit: 8000, spillPath: '/tmp/s.html' });
  assert.ok(plan.text.startsWith('y'.repeat(8000)));
  assert.match(plan.text, /已截断（共 9001 字符），全文见 \/tmp\/s\.html$/);
  assert.deepEqual(plan.spill, { path: '/tmp/s.html', content: big });

  const full = planRenderOutput(big, { full: true, spillPath: '/tmp/s.html' });
  assert.equal(full.text, big);
  assert.equal(full.spill, null);
});

/** pp2 页 fixture：一份临时 registry 指一个带 board.json 的页目录。 */
function makeCompiledPage(t, { screens, files }) {
  const dir = withTempDir(t);
  const page = path.join(dir, 'page');
  fs.mkdirSync(page, { recursive: true });
  fs.writeFileSync(path.join(page, 'board.json'), JSON.stringify({
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens }],
  }));
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(page, rel), content);
  }
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({
    version: 1,
    entries: [{ id: 't-page', title: 'T', kind: 'dir', path: page }],
  }));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  return { dir, page, registry, env };
}

test('runBuild：整页编译打印每屏 ok 与耗时，失败屏非零退出', async (t) => {
  const rec = recorder();
  const { registry, env } = makeCompiledPage(t, {
    screens: [{ id: 'home', title: 'Home' }],
    files: { 'home.html': '<div class="ios-app">在</div>\n' },
  });
  const code = await runBuild(['build', 't-page', '--registry', registry], { ...rec.io, env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => /^ok {3}home {2}/.test(line)));
  assert.ok(rec.out.some((line) => /完成 t-page/.test(line)));
  // dist 落在 PINPOINT_DATA_DIR 下
  assert.equal(
    fs.readFileSync(path.join(env.PINPOINT_DATA_DIR, 'dist', 't-page', 'home.html'), 'utf8'),
    '<div class="ios-app">在</div>\n',
  );

  const bad = recorder();
  const failing = makeCompiledPage(t, {
    screens: [{ id: 'home', title: 'Home' }],
    files: { 'home.jsx': 'export default function Home() {\n  return <div className="ios-app"><button onClick={() => 1}>x</button></div>;\n}\n' },
  });
  const code2 = await runBuild(['build', 't-page', '--registry', failing.registry], { ...bad.io, env: failing.env });
  assert.equal(code2, 1);
  assert.ok(bad.err.some((line) => /onClick/.test(line)));

  const ghost = recorder();
  const code3 = await runBuild(['build', 'ghost', '--registry', registry], { ...ghost.io, env });
  assert.equal(code3, 1);
  assert.ok(ghost.err.some((line) => /找不到页：ghost/.test(line)));
  assert.ok(ghost.err.some((line) => /t-page/.test(line)), '报错列出可用 id');
});

test('runRender：限内打全文，超限截断并落 spill 文件，--full 不截断', async (t) => {
  const bigBody = '长'.repeat(9000);
  const made = makeCompiledPage(t, {
    screens: [{ id: 'small', title: 'Small' }, { id: 'big', title: 'Big' }],
    files: {
      'small.html': '<div class="ios-app">小</div>\n',
      'big.html': `<div class="ios-app">${bigBody}</div>\n`,
    },
  });
  const args = ['--registry', made.registry];

  const small = recorder();
  assert.equal(await runRender(['render', 't-page/small', ...args], { ...small.io, env: made.env }), 0);
  assert.equal(small.out.at(-1), '<div class="ios-app">小</div>\n');

  const big = recorder();
  assert.equal(await runRender(['render', 't-page/big', ...args], { ...big.io, env: made.env }), 0);
  const spill = path.join(made.env.PINPOINT_DATA_DIR, 'render', 't-page', 'big.html');
  assert.match(big.out.at(-1), /已截断（共 \d+ 字符），全文见 /);
  assert.equal(fs.readFileSync(spill, 'utf8'), `<div class="ios-app">${bigBody}</div>\n`);
  assert.ok(big.out.at(-1).length < 9000, 'stdout 是截断版');

  const full = recorder();
  assert.equal(await runRender(['render', 't-page/big', '--full', ...args], { ...full.io, env: made.env }), 0);
  assert.equal(full.out.at(-1), `<div class="ios-app">${bigBody}</div>\n`);

  const badRef = recorder();
  assert.equal(await runRender(['render', 't-page', ...args], { ...badRef.io, env: made.env }), 1);
  assert.ok(badRef.err.some((line) => /形如 <页>\/<屏>/.test(line)));

  const lint = recorder();
  const failing = makeCompiledPage(t, {
    screens: [{ id: 'home', title: 'Home' }],
    files: { 'home.jsx': 'export default function Home() {\n  return <div className="ios-app">{fetch(\'/x\')}</div>;\n}\n' },
  });
  assert.equal(await runRender(['render', 't-page/home', '--registry', failing.registry], { ...lint.io, env: failing.env }), 1);
  assert.ok(lint.err.some((line) => /编译失败.*fetch/s.test(line)));
  // render 不落 dist
  assert.equal(fs.existsSync(path.join(failing.env.PINPOINT_DATA_DIR, 'dist')), false);
});

/* ---- pp2 切片 4：check / locate / mark / status --page ---- */

import {
  runCheck,
  runLocate,
  runMark,
} from './pinpoint-cli.js';

const HOME_JSX = [
  'export default function Home() {',   // 1
  '  return (',                         // 2
  '    <div className="ios-app">',      // 3
  '      <p>目标段</p>',                // 4
  '      <p>第二段</p>',                // 5
  '    </div>',                         // 6
  '  );',                               // 7
  '}',                                  // 8
  '',
].join('\n');

/** 编译好的页 + pinpoint 桶里一条指向 home.jsx:4 的帧标注。 */
async function makeAnnotatedPage(t) {
  const made = makeCompiledPage(t, {
    screens: [{ id: 'home', title: 'Home' }],
    files: { 'home.jsx': HOME_JSX },
  });
  const build = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', made.registry], { ...build.io, env: made.env }), 0, build.err.join('\n'));
  fs.mkdirSync(path.join(made.env.PINPOINT_DATA_DIR, 'pinpoint'), { recursive: true });
  fs.writeFileSync(path.join(made.env.PINPOINT_DATA_DIR, 'pinpoint', 'index~t.json'), JSON.stringify({
    page: 'index~t', revision: 2,
    annotations: [{
      id: 'k1', n: 1, type: 'element', pageId: 't-page', screenId: 'home', status: 'open',
      content: '这段要改 [@t:i1]',
      targets: [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > p:nth-of-type(1)', text: '目标段' }],
    }, {
      id: 'k2', n: 2, type: 'element', pageId: 't-page', screenId: 'home', status: 'done',
      content: '第二段已改 [@t:i1]',
      targets: [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > p:nth-of-type(2)', text: '第二段' }],
    }],
  }));
  return made;
}

test('parseArgs：check / locate / shot / mark 的形状与用法错误', () => {
  assert.deepEqual(parseArgs(['check', 'p', '--frame', 'B3', '--status', 'done', '--mode', 'both', '--group-by', 'component', '--json']), {
    command: 'check', target: 'p',
    flags: { frame: 'B3', status: 'done', mode: 'both', 'group-by': 'component', json: true },
  });
  assert.deepEqual(parseArgs(['locate', '#1', 'B3']), { command: 'locate', refs: ['#1', 'B3'], flags: {} });
  assert.deepEqual(parseArgs(['shot', 'B', '--marks', '--scale', '2']), { command: 'shot', refs: ['B'], flags: { marks: true, scale: '2' } });
  assert.deepEqual(parseArgs(['mark', '#1', '#3-#5', 'done', '--note', 'x y']), {
    command: 'mark', refs: ['#1', '#3-#5'], statusWord: 'done', flags: { note: 'x y' },
  });
  assert.throws(() => parseArgs(['locate']), /至少要一个引用/);
  assert.throws(() => parseArgs(['mark', '#1']), /mark 需要引用与状态/);
  assert.throws(() => parseArgs(['check', 'p', '--watch', '--registry', 'r']), /--watch 不适用于 check/);
});

test('runCheck：默认 open 按帧分组，摘录指到源码行；--json 结构化', async (t) => {
  const made = await makeAnnotatedPage(t);
  const rec = recorder();
  const code = await runCheck(['check', 't-page', '--registry', made.registry], { ...rec.io, env: made.env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => line.includes('# demo-page') || line.includes('# t-page')), rec.out[0]);
  assert.ok(rec.out.some((line) => line.includes('[#1]') && line.includes('这段要改') && line.includes('open')), rec.out.join('\n'));
  assert.ok(rec.out.some((line) => /4>/.test(line) && line.includes('目标段')), '锚点行 home.jsx:4 带 > 前缀');
  assert.ok(!rec.out.some((line) => line.includes('[#2]')), '默认只看 open');

  const all = recorder();
  assert.equal(await runCheck(['check', 't-page', '--registry', made.registry, '--status', 'all'], { ...all.io, env: made.env }), 0);
  assert.ok(all.out.some((line) => line.includes('[#2]') && line.includes('done')));

  const json = recorder();
  assert.equal(await runCheck(['check', 't-page', '--registry', made.registry, '--json'], { ...json.io, env: made.env }), 0);
  const parsed = JSON.parse(json.out.join('\n'));
  assert.equal(parsed.groups[0].rows[0].file, 'home.jsx');
  assert.equal(parsed.groups[0].rows[0].line, 4);
});

test('runCheck：未知帧 / 坏状态码非零退出并报因', async (t) => {
  const made = await makeAnnotatedPage(t);
  const ghost = recorder();
  assert.equal(await runCheck(['check', 't-page', '--registry', made.registry, '--frame', 'Z9'], { ...ghost.io, env: made.env }), 1);
  assert.ok(ghost.err.some((line) => /没有帧 Z9/.test(line)));
  const bad = recorder();
  assert.equal(await runCheck(['check', 't-page', '--registry', made.registry, '--status', 'nope'], { ...bad.io, env: made.env }), 1);
  assert.ok(bad.err.some((line) => /--status/.test(line)));
});

test('runLocate：#n → 源文件:行；未编页给 selector', async (t) => {
  const made = await makeAnnotatedPage(t);
  const rec = recorder();
  const code = await runLocate(['locate', '#1', '--registry', made.registry], { ...rec.io, env: made.env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => /#1 → home\.jsx:4/.test(line)), rec.out.join('\n'));
  const range = recorder();
  assert.equal(await runLocate(['locate', '#1-#2', '--registry', made.registry], { ...range.io, env: made.env }), 0);
  assert.ok(range.out.some((line) => /#2 → home\.jsx:5/.test(line)), range.out.join('\n'));
});

test('runMark：走状态端点带 baseRevision，逐条打印；close / open 拒收；服务不在跑报 ppnt start', async (t) => {
  const made = await makeAnnotatedPage(t);
  const close = recorder();
  assert.equal(await runMark(['mark', '#1', 'close', '--registry', made.registry], { ...close.io, env: made.env }), 1);
  assert.ok(close.err.some((line) => /close 只在工作台/.test(line)));
  // open 只由 owner 在工作台编辑触发，mark 不写——传 open 指名道姓报因。
  const open = recorder();
  assert.equal(await runMark(['mark', '#1', 'open', '--registry', made.registry], { ...open.io, env: made.env }), 1);
  assert.ok(open.err.some((line) => /open 由工作台编辑触发，mark 不写/.test(line)));

  // 服务不在跑（requestFn 抛错 = 探活失败）。
  const down = recorder();
  assert.equal(await runMark(['mark', '#1', 'done', '--registry', made.registry], {
    ...down.io,
    env: { ...made.env, PINPOINT_ORIGIN: 'http://127.0.0.1:1' },
  }), 1);
  assert.ok(down.err.some((line) => /ppnt start/.test(line)), down.err.join('\n'));

  const calls = [];
  const requestFn = async (urlString, opts = {}) => {
    calls.push({ url: urlString, ...opts });
    if (opts.method === 'POST') {
      const body = opts.body;
      if (body.baseRevision !== 2) return { status: 409, json: { error: 'revision_conflict' } };
      return { status: 200, json: { revision: 3, annotation: { n: 1, status: body.status } } };
    }
    return { status: 200, json: { revision: 2, annotations: [] } };
  };
  const rec = recorder();
  const code = await runMark(['mark', '#1', 'done', '--note', '改完了', '--registry', made.registry], {
    ...rec.io, env: made.env, requestFn,
  });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => /#1 → done（note：改完了）/.test(line)), rec.out.join('\n'));
  const post = calls.find((call) => call.method === 'POST');
  assert.match(post.url, /\/annotations\/index~t\/1\/status$/);
  assert.equal(post.body.entry, 'pinpoint');
  assert.equal(post.body.baseRevision, 2);

  // 409 不中断其他条：#1 成功（rev 2 对上）后 #2 因端点只认（返回 409 模拟非法转换）失败。
  const mixed = recorder();
  const mixedFn = async (urlString, opts = {}) => {
    if (opts.method === 'POST') {
      return opts.body.status === 'done'
        ? { status: 200, json: { revision: 3, annotation: { status: 'done' } } }
        : { status: 409, json: { error: 'illegal_transition', detail: 'done → check' } };
    }
    return { status: 200, json: { revision: 2, annotations: [] } };
  };
  const code2 = await runMark(['mark', '#1-#2', 'done', '--registry', made.registry], { ...mixed.io, env: made.env, requestFn: mixedFn });
  assert.equal(code2, 0);
  assert.equal(mixed.out.filter((line) => line.includes('→ done')).length, 2, mixed.out.join('\n'));
});

test('runStatus --page：各状态计数 + dist 过期状态', async (t) => {
  const made = await makeAnnotatedPage(t);
  const rec = recorder();
  const code = await runStatus(['status', '--page', 't-page', '--registry', made.registry], { ...rec.io, env: made.env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => /open 1 · check 0 · done 1 · close 0 · 共 2/.test(line)), rec.out.join('\n'));
  assert.ok(rec.out.some((line) => line.includes('dist ') && line.includes('最新')), rec.out.join('\n'));
  // 源码比产物新 → 过期。
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(made.page, 'home.jsx'), future, future);
  const stale = recorder();
  assert.equal(await runStatus(['status', '--page', 't-page', '--registry', made.registry], { ...stale.io, env: made.env }), 0);
  assert.ok(stale.out.some((line) => line.includes('已过期')), stale.out.join('\n'));
});
