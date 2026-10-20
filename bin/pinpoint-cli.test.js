import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { boardRefs } from '../src/workbench/lib/board-refs.js';

import {
  buildEntry,
  buildMove,
  buildRename,
  classifyOriginStatus,
  classifyStatus,
  CliError,
  collectStatus,
  decideStart,
  decideStop,
  displayWidth,
  formatStatus,
  manifestPageIds,
  parseArgs,
  parseRoutes,
  pickRoute,
  planAdd,
  planRemove,
  planRenderOutput,
  portlessRoutesPath,
  requestJson,
  rewriteSitePrefix,
  rewriteSitePrefixUnder,
  resolveRegistryPath,
  run,
  runAdd,
  runBuild,
  runComments,
  runShow,
  runMv,
  runRender,
  runRemove,
  runList,
  runStatus,
  runStop,
  serviceLogPath,
  slugify,
  startPageWatch,
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

test('parseArgs: shot --figure takes the figure id; refs become optional (the page is the one positional)', () => {
  assert.deepEqual(parseArgs(['shot', '--figure', 'message-flow']), { command: 'shot', refs: [], flags: { figure: 'message-flow' } });
  assert.deepEqual(parseArgs(['shot', 'demo_flow', '--figure=message-flow']), { command: 'shot', refs: ['demo_flow'], flags: { figure: 'message-flow' } });
  assert.throws(() => parseArgs(['shot']), /shot 至少要一个目标或引用/);
  assert.throws(() => parseArgs(['locate', '--figure', 'x', 'B1']), /不适用于 locate/);
  assert.throws(() => parseArgs(['shot', '--figure', 'message-flow', '--page', 'demo_flow']), /未知选项：--page/);
});

test('parseArgs: usage errors are loud', () => {
  assert.throws(() => parseArgs([]), /缺少命令/);
  assert.throws(() => parseArgs(['destroy', '/x']), /未知命令/);
  assert.throws(() => parseArgs(['status', 'extra']), /不接受位置参数/);
  assert.throws(() => parseArgs(['status', '--title', 'T']), /不适用于 status/);
  assert.throws(() => parseArgs(['mv', 'x']), /mv 需要两个参数/);
  assert.throws(() => parseArgs(['mv', 'x', '/a', '/b']), /只接受两个参数/);
  assert.throws(() => parseArgs(['move', 'x', '/a']), /未知命令：move/);
  assert.throws(() => parseArgs(['rename', 'x', 'y']), /未知命令：rename/);
  assert.throws(() => parseArgs(['mv', 'x', '/a', '--title', 'T']), /不适用于 mv/);
  assert.throws(() => parseArgs(['add']), /需要一个目标/);
  assert.throws(() => parseArgs(['add', '/a', '/b']), /只接受一个目标/);
  assert.throws(() => parseArgs(['add', '/a', '--wat', '1']), /未知选项/);
  assert.throws(() => parseArgs(['add', '/a', '--title']), /缺少值/);
  assert.throws(() => parseArgs(['add', '/a', '--title', '--id', 'x']), /缺少值/);
  assert.throws(() => parseArgs(['add', '/a', '--id=']), /缺少值/);
});

test('parseArgs: add 不收 --page 与 --draft（登记表级挂靠已删）', () => {
  assert.throws(() => parseArgs(['add', '/tmp/x', '--page', 'weekly-review']), /未知选项：--page/);
  assert.throws(() => parseArgs(['add', '/tmp/x', '--draft']), /未知选项：--draft/);
});

test('parseArgs: -h/--help short-circuits', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['add', '-h']), { help: true, command: 'add' });
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

test('buildEntry: http(s) 网址不登记，报错指向本地目录或 .html 文件', (t) => {
  const dir = withTempDir(t);
  for (const target of ['https://my-todos.localhost/app?q=1', 'http://127.0.0.1:5173/']) {
    assert.throws(() => buildEntry(target, {}, { cwd: dir }), (error) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /登记的目标是本地目录或 \.html 文件/);
      return true;
    }, target);
  }
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
      assert.match(error.message, /ppnt mv my-site <新路径>/);
      assert.match(error.message, /--id <其他 id>/);
      return true;
    },
  );
  // 显式 --id 撞车同样指路
  assert.throws(
    () => buildEntry(site, { id: 'my-site' }, { cwd: dir, takenEntries: [existing] }),
    /ppnt mv my-site/,
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

test('manifestPageIds: 读真实仓库 manifest（与 _index.json 的 pages 一致）', () => {
  // 范例页落地后模板页不再是空名单——断言从钉死「空数组」改为钉死「函数输出
  // 与真实 manifest 逐字一致」，既不依赖模板页数量，也不放宽（多列、漏列都挂）。
  const doc = JSON.parse(fs.readFileSync(new URL('../content/previews/_index.json', import.meta.url), 'utf8'));
  const ids = manifestPageIds();
  assert.deepEqual(ids, doc.pages.map((page) => page.id));
  assert.ok(ids.includes('example'), '范例页在名单里');
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

test('runAdd: usage error exits 2 and never creates the file', async (t) => {
  const dir = withTempDir(t);
  const rec = recorder();
  const file = path.join(dir, 'registry.json');
  const code = await runAdd(['add', '--bogus', 'x'], { ...rec.io, cwd: dir, env: { PINPOINT_REGISTRY: file } });
  assert.equal(code, 2);
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

test('runAdd: the reload line counts project entries too', async (t) => {
  // reload 的 entries 只数 page，project 另计（2026-10-13 fresh-reader：文件里 2 条，CLI 说共 1 条）。
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const rec = recorder();
  const file = path.join(dir, 'registry.json');
  const requestFn = (url) => Promise.resolve(url.endsWith('/health')
    ? { status: 200, json: { ok: true } }
    : { status: 200, json: { ok: true, path: file, entries: 1, projects: 1, errors: [], warnings: [] } });
  const code = await runAdd(['add', site, '--registry', file], { ...rec.io, cwd: dir, env: { PINPOINT_ORIGIN: 'https://pinpoint.localhost' }, requestFn });
  assert.equal(code, 0);
  assert.ok(rec.out.some((line) => /服务已重载（registry 共 2 条，其中 project 1 个）/.test(line)), rec.out.join('\n'));
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
  assert.ok(rec.err.some((line) => /ppnt mv my-site <新路径>/.test(line)));
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

test('buildMove: dir → file 丢掉 board；网址目标拒绝；老 url 条目能重指到本地目录', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const page = path.join(dir, 'one.html');
  fs.writeFileSync(page, '<!doctype html><html><body>1</body></html>');
  const before = { id: 'app', title: 'App', kind: 'dir', path: '/gone', board: 'ios' };
  assert.deepEqual(buildMove('app', page, { cwd: dir, entries: [before] }).after,
    { id: 'app', title: 'App', kind: 'file', path: page });
  assert.throws(() => buildMove('app', 'https://app.localhost/x', { cwd: dir, entries: [before] }), /登记的目标是本地目录或 \.html 文件/);
  const legacy = { id: 'web', title: 'Web', kind: 'url', url: 'https://app.localhost/x' };
  assert.deepEqual(buildMove('web', site, { cwd: dir, entries: [legacy] }).after,
    { id: 'web', title: 'Web', kind: 'dir', path: site });
});

test('buildMove: 未知 id / 不存在的目标都响亮拒绝；老条目上已删功能的字段不带过去', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const entries = [{ id: 'app', kind: 'dir', path: '/gone' }, { id: 'draft', kind: 'file', path: '/gone.html', page: 'library', role: 'draft' }];
  assert.throws(() => buildMove('ghost', site, { cwd: dir, entries }), /条目不存在：ghost（现有：app、draft）/);
  assert.throws(() => buildMove('app', path.join(dir, 'nope'), { cwd: dir, entries }), /路径不存在/);
  assert.throws(() => buildMove('app', path.join(dir, 'x.txt'), { cwd: dir, entries }), /路径不存在/);
  assert.deepEqual(buildMove('draft', site, { cwd: dir, entries }).after, { id: 'draft', kind: 'dir', path: site });
});

test('mv <id> <路径>: 原地改路径、保留 id 与位置，并 reload 服务', async (t) => {
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
  const code = await runMv(['mv', 'app', next, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn });
  assert.equal(code, 0);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.entries.map((e) => e.id), ['pinpoint', 'app'], '顺序不变');
  assert.deepEqual(doc.entries[1], { id: 'app', kind: 'dir', title: '我的应用', path: next, board: 'ios' });
  assert.deepEqual(calls, ['GET /health', 'POST /registry/reload'].map((c) => c.replace(' /', ' https://pinpoint.localhost/')));
  assert.ok(rec.out.some((line) => /已重指 app/.test(line)));
  assert.ok(rec.out.some((line) => /标注桶 ~\/\.pinpoint\/app\/ 不变/.test(line)));
  assert.ok(rec.out.some((line) => /服务已重载/.test(line)));
});

test('mv <id> <路径>: file 目标；网址目标退非零、registry 不动', async (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'r.html');
  fs.writeFileSync(page, '<!doctype html><html><body>r</body></html>');
  const file = registryWith(dir, [{ id: 'app', title: 'App', kind: 'dir', path: dir, board: 'ios' }]);
  const requestFn = () => Promise.reject(new Error('down'));
  const rec = recorder();
  assert.equal(await runMv(['mv', 'app', page, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries[0],
    { id: 'app', kind: 'file', title: 'App', path: page });
  assert.ok(rec.err.some((line) => /服务未在跑/.test(line)));
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(await runMv(['mv', 'app', 'https://app.localhost/', '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn }), 1);
  assert.ok(rec.err.some((line) => /登记的目标是本地目录或 \.html 文件/.test(line)));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('mv <id> <路径>: 未知 id 与不存在的目标退非零，registry 不动', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  const file = registryWith(dir, [{ id: 'app', kind: 'dir', path: dir }]);
  const before = fs.readFileSync(file, 'utf8');
  const requestFn = () => Promise.reject(new Error('down'));
  const rec = recorder();
  assert.equal(await runMv(['mv', 'ghost', site, '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn }), 1);
  assert.equal(await runMv(['mv', 'app', path.join(dir, 'ghost'), '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn }), 1);
  assert.ok(rec.err.some((line) => /条目不存在：ghost/.test(line)));
  assert.ok(rec.err.some((line) => /路径不存在/.test(line)));
  assert.ok(!rec.err.some((line) => /^用法：/.test(line)), '目标不成立不刷 usage，答案在错误行里');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  // 参数形状不对才刷 usage
  const usage = recorder();
  assert.equal(await runMv(['mv', 'app'], { ...usage.io, cwd: dir, env: {}, requestFn }), 2);
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

test('buildRename: 只换 id，落点与标题原样', (t) => {
  const entries = [
    { id: 'old', title: '我的应用', kind: 'dir', path: '/x', board: 'ios' },
    { id: 'other', kind: 'file', path: '/o.html' },
  ];
  const { before, after } = buildRename('old', 'fresh', { entries });
  assert.equal(before.id, 'old');
  assert.deepEqual(after, { id: 'fresh', title: '我的应用', kind: 'dir', path: '/x', board: 'ios' });
});

test('buildRename: 未知 id / 非法新 id / 同名 / 撞 id 都响亮拒绝', () => {
  const entries = [{ id: 'old', kind: 'dir', path: '/x' }, { id: 'taken', kind: 'dir', path: '/t' }];
  assert.throws(() => buildRename('ghost', 'fresh', { entries }), /条目不存在：ghost（现有：old、taken）/);
  assert.throws(() => buildRename('old', 'Not Ok', { entries }), /新 id 必须匹配/);
  assert.throws(() => buildRename('old', 'old', { entries }), /新旧 id 相同/);
  assert.throws(() => buildRename('old', 'taken', { entries }), /id 已存在：taken，指向 \/t；把两个条目并成一个 = 先 `ppnt mv` 改 id，再 `ppnt mv <id> <路径>` 换路径/);
});

test('mv <旧 id> <新 id>: 登记表 + 标注桶 + 资源前缀一起改，并 reload 服务', async (t) => {
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
    { id: 'note', kind: 'file', path: path.join(site, 'index.html') },
  ]);
  const rec = recorder();
  const calls = [];
  const requestFn = (url, options = {}) => {
    calls.push(`${options.method || 'GET'} ${url}`);
    if (url.endsWith('/health')) return Promise.resolve({ status: 200, json: { ok: true } });
    return Promise.resolve({ status: 200, json: { ok: true, path: file, entries: 3 } });
  };
  const env = { PINPOINT_DATA_DIR: dataRoot };
  const code = await runMv(['mv', 'old', 'fresh', '--registry', file], { ...rec.io, cwd: dir, env, requestFn });
  assert.equal(code, 0);

  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.entries.map((e) => e.id), ['pinpoint', 'fresh', 'note'], '位置不变');
  assert.deepEqual(doc.entries[1], { id: 'fresh', kind: 'dir', title: '我的应用', path: site, board: 'ios' });
  assert.deepEqual(doc.entries[2], { id: 'note', kind: 'file', path: path.join(site, 'index.html') }, '别的条目一个字节不动');

  assert.ok(!fs.existsSync(path.join(dataRoot, 'old')), '旧桶已改名');
  assert.equal(fs.readFileSync(path.join(dataRoot, 'fresh', 'page.json'), 'utf8'), '{"annotations":[]}');

  assert.equal(fs.readFileSync(path.join(site, 'card.html'), 'utf8'), '<link rel="stylesheet" href="/sites/fresh/card.css">');
  assert.equal(fs.readFileSync(path.join(site, 'card.css'), 'utf8'), '@import url("/sites/fresh/base.css");');

  assert.deepEqual(calls, ['GET https://pinpoint.localhost/health', 'POST https://pinpoint.localhost/registry/reload']);
  assert.ok(rec.out.some((line) => /已改 id：old → fresh/.test(line)));
  assert.ok(rec.out.some((line) => /2 个文件里的 \/sites\/old\/ 已换成 \/sites\/fresh\//.test(line)));
  assert.ok(rec.out.some((line) => /服务已重载/.test(line)));
});

test('storage-unify：rename 改桶名就完成归属迁移 —— @canvas 行上的 pageId 不动', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, 'site');
  const dataRoot = path.join(dir, 'data');
  const bucket = path.join(dataRoot, 'old');
  fs.mkdirSync(path.join(bucket, 'images'), { recursive: true });
  fs.writeFileSync(path.join(bucket, '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 1,
    annotations: [{ id: 'c1', n: 1, pageId: 'old', screenId: 'home', status: 'open', content: '帧意见' }],
  }));
  fs.writeFileSync(path.join(bucket, 'doc~1.json'), JSON.stringify({
    page: 'doc~1', path: `/sites/old/card.html`, revision: 1,
    annotations: [{ id: 'd1', n: 2, status: 'open', content: '文档意见' }],
  }));
  fs.writeFileSync(path.join(bucket, 'images', '@canvas-1-1.png'), 'pin');
  const file = registryWith(dir, [
    { id: 'pinpoint', kind: 'dir', path: dir },
    { id: 'old', title: '我的应用', kind: 'dir', path: site, board: 'ios' },
  ]);
  const rec = recorder();
  const requestFn = () => Promise.reject(new Error('down'));
  assert.equal(await runMv(['mv', 'old', 'fresh', '--registry', file], { ...rec.io, cwd: dir, env: { PINPOINT_DATA_DIR: dataRoot }, requestFn }), 0);
  const fresh = path.join(dataRoot, 'fresh');
  assert.ok(!fs.existsSync(bucket), '旧桶整体改名');
  const canvas = JSON.parse(fs.readFileSync(path.join(fresh, '@canvas.json'), 'utf8'));
  assert.equal(canvas.annotations[0].pageId, 'old', '行上的 pageId 不承担归属（桶 = 页），rename 不改行');
  assert.ok(fs.existsSync(path.join(fresh, 'doc~1.json')), '文档账本随桶走');
  assert.ok(fs.existsSync(path.join(fresh, 'images', '@canvas-1-1.png')), '图片随桶走');
});

test('runPrune：--dry-run 只列不删；落盘删孤儿账本与它的图片，活的账本不动', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, 'site');
  fs.writeFileSync(path.join(site, 'doc.html'), '<!doctype html><p>doc</p>');
  const dataRoot = path.join(dir, 'data');
  const bucket = path.join(dataRoot, 'gone-page');
  fs.mkdirSync(path.join(bucket, 'images'), { recursive: true });
  fs.writeFileSync(path.join(bucket, 'doc~1.json'), JSON.stringify({
    page: 'doc~1', path: '/sites/gone-page/missing.html', revision: 1,
    annotations: [{ id: 'd1', n: 1, status: 'open', content: '孤儿行' }],
  }));
  fs.writeFileSync(path.join(bucket, 'doc~2.json'), JSON.stringify({
    page: 'doc~2', path: '/sites/gone-page/doc.html', revision: 1,
    annotations: [{ id: 'd2', n: 2, status: 'open', content: '活账本' }],
  }));
  fs.writeFileSync(path.join(bucket, 'images', 'doc~1-1-1.png'), 'orphan');
  fs.writeFileSync(path.join(bucket, 'images', 'doc~2-1-1.png'), 'live');
  const file = registryWith(dir, [
    { id: 'pinpoint', kind: 'dir', path: dir },
    { id: 'gone-page', kind: 'dir', path: site },
  ]);
  const env = { PINPOINT_DATA_DIR: dataRoot, PINPOINT_REGISTRY: file };

  const dry = recorder();
  assert.equal(await runPrune(['prune', 'gone-page', '--dry-run'], { ...dry.io, env }), 0);
  assert.ok(dry.out.some((line) => line.includes('doc~1.json') && line.includes('missing.html') === false), dry.out.join('\n'));
  assert.ok(dry.out.some((line) => /--dry-run：1 本孤儿账本待删/.test(line)), dry.out.join('\n'));
  assert.ok(fs.existsSync(path.join(bucket, 'doc~1.json')), 'dry-run 不删');

  const rec = recorder();
  assert.equal(await runPrune(['prune', 'gone-page'], { ...rec.io, env }), 0);
  assert.ok(rec.out.some((line) => /已删除 1 本孤儿账本 与 1 个孤儿图片/.test(line)), rec.out.join('\n'));
  assert.ok(!fs.existsSync(path.join(bucket, 'doc~1.json')), '孤儿账本已删');
  assert.ok(!fs.existsSync(path.join(bucket, 'images', 'doc~1-1-1.png')), '孤儿图片已删');
  assert.ok(fs.existsSync(path.join(bucket, 'doc~2.json')), '活账本不动');
  assert.ok(fs.existsSync(path.join(bucket, 'images', 'doc~2-1-1.png')), '活图片不动');

  // 再跑一遍：没有孤儿了，幂等退 0。
  const again = recorder();
  assert.equal(await runPrune(['prune', 'gone-page'], { ...again.io, env }), 0);
  assert.ok(again.out.some((line) => /没有孤儿账本/.test(line)), again.out.join('\n'));
});

test('runPrune：页不在 registry 与 manifest 里 = 整桶皆孤儿', async (t) => {
  const dir = withTempDir(t);
  const dataRoot = path.join(dir, 'data');
  const bucket = path.join(dataRoot, 'ghost');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 1,
    annotations: [{ id: 'g1', n: 1, status: 'open', content: '页没了' }],
  }));
  const file = registryWith(dir, [{ id: 'pinpoint', kind: 'dir', path: dir }]);
  const env = { PINPOINT_DATA_DIR: dataRoot, PINPOINT_REGISTRY: file };
  const rec = recorder();
  assert.equal(await runPrune(['prune', 'ghost'], { ...rec.io, env }), 0);
  assert.ok(rec.out.some((line) => /页已不存在，整桶孤儿/.test(line)), rec.out.join('\n'));
  assert.ok(!fs.existsSync(path.join(bucket, '@canvas.json')), '整桶清空');
});

test('mv <旧 id> <新 id>: 没有标注桶 / file 条目跳过资源前缀', async (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'r.html');
  fs.writeFileSync(page, '<!doctype html><html><body>r</body></html>');
  const file = registryWith(dir, [{ id: 'doc', title: 'Doc', kind: 'file', path: page }]);
  const rec = recorder();
  const requestFn = () => Promise.reject(new Error('down'));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  assert.equal(await runMv(['mv', 'doc', 'report', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries[0],
    { id: 'report', kind: 'file', title: 'Doc', path: page });
  assert.ok(rec.out.some((line) => /标注桶：.*不存在，没有标注要搬/.test(line)));
  assert.ok(rec.out.some((line) => /file 条目没有目录可扫，跳过/.test(line)));
  assert.ok(rec.err.some((line) => /服务未在跑/.test(line)));
});

test('mv <旧 id> <新 id>: 预检不过就一个字节都不动（新桶已存在 / 目录不存在 / 撞 id）', async (t) => {
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
  assert.equal(await runMv(['mv', 'old', 'fresh', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 1);
  assert.equal(await runMv(['mv', 'gone', 'other', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 1);
  assert.equal(await runMv(['mv', 'old', 'taken', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 1);
  assert.ok(rec.err.some((line) => /标注桶已存在/.test(line)));
  assert.ok(rec.err.some((line) => /目录不存在.*先 `ppnt mv gone/.test(line)));
  assert.ok(rec.err.some((line) => /id 已存在：taken/.test(line)));
  assert.ok(!rec.err.some((line) => /^用法：/.test(line)));
  assert.equal(fs.readFileSync(file, 'utf8'), before);

  // 参数形状不对才刷 usage
  const usage = recorder();
  assert.equal(await runMv(['mv', 'old'], { ...usage.io, cwd: dir, env, requestFn }), 2);
  assert.ok(usage.err.some((line) => /^用法：/.test(line)));
});

/* ---- remove ---- */

test('parseArgs: remove 需要恰一个条目 id，只收 --registry', () => {
  assert.deepEqual(parseArgs(['remove', 'app', '--registry', '/r.json']), {
    command: 'remove', id: 'app', flags: { registry: '/r.json' },
  });
  assert.throws(() => parseArgs(['remove']), /remove 需要一个条目 id/);
  assert.throws(() => parseArgs(['remove', 'a', 'b']), /只接受一个条目 id/);
  assert.throws(() => parseArgs(['remove', 'a', '--title', 'T']), /不适用于 remove/);
});

test('runRemove: 正常删——登记行消失、其余原位、源文件不动、reload 服务', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, 'site');
  const file = registryWith(dir, [
    { id: 'pinpoint', kind: 'dir', path: dir },
    { id: 'app', kind: 'dir', path: site, board: 'ios' },
    { id: 'keep', kind: 'url', url: 'https://keep.localhost/' },
  ]);
  const rec = recorder();
  const calls = [];
  const requestFn = (url, options = {}) => {
    calls.push(`${options.method || 'GET'} ${url}`);
    if (url.endsWith('/health')) return Promise.resolve({ status: 200, json: { ok: true } });
    return Promise.resolve({ status: 200, json: { ok: true, path: file, entries: 2 } });
  };
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  const code = await runRemove(['remove', 'app', '--registry', file], { ...rec.io, cwd: dir, env, requestFn });
  assert.equal(code, 0);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.entries.map((e) => e.id), ['pinpoint', 'keep'], '只少了被删的那条，位置不变');
  assert.ok(fs.existsSync(path.join(site, 'index.html')), '源文件不动');
  assert.deepEqual(calls, ['GET https://pinpoint.localhost/health', 'POST https://pinpoint.localhost/registry/reload']);
  assert.ok(rec.out.some((line) => /已从登记表删除 app/.test(line)), rec.out.join('\n'));
  assert.ok(rec.out.some((line) => /服务已重载/.test(line)));
});

test('runRemove: id 不存在退非零，registry 不动，并列出现有条目', async (t) => {
  const dir = withTempDir(t);
  const file = registryWith(dir, [{ id: 'app', kind: 'dir', path: dir }]);
  const before = fs.readFileSync(file, 'utf8');
  const rec = recorder();
  const requestFn = () => Promise.reject(new Error('down'));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  assert.equal(await runRemove(['remove', 'ghost', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 1);
  assert.ok(rec.err.some((line) => /条目不存在：ghost（现有：app）/.test(line)), rec.err.join('\n'));
  assert.ok(!rec.err.some((line) => /^用法：/.test(line)), '目标不成立不刷 usage，答案在错误行里');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('runRemove: 桶里有标注行就拒绝（@canvas 算数，空账本不算），registry 与桶都不动', async (t) => {
  const dir = withTempDir(t);
  const dataRoot = path.join(dir, 'data');
  const bucket = path.join(dataRoot, 'app');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 1,
    annotations: [{ id: 'c1', n: 1, status: 'open', content: '帧意见' }],
  }));
  fs.writeFileSync(path.join(bucket, 'doc~1.json'), JSON.stringify({
    page: 'doc~1', path: '/sites/app/doc.html', revision: 1, annotations: [],
  }));
  fs.writeFileSync(path.join(bucket, '_seq.json'), JSON.stringify({ next: 3 }));
  const file = registryWith(dir, [{ id: 'app', kind: 'dir', path: dir }]);
  const before = fs.readFileSync(file, 'utf8');
  const rec = recorder();
  const requestFn = () => Promise.reject(new Error('down'));
  const env = { PINPOINT_DATA_DIR: dataRoot };
  assert.equal(await runRemove(['remove', 'app', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 1);
  assert.ok(rec.err.some((line) => /还有 1 行标注/.test(line) && /pinpoint prune app/.test(line)), rec.err.join('\n'));
  assert.ok(fs.existsSync(path.join(bucket, '@canvas.json')), '桶不动');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('runRemove: 空桶（空账本 + _seq.json）顺手删掉；没有桶就只删登记', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, 'site');
  const dataRoot = path.join(dir, 'data');
  const bucket = path.join(dataRoot, 'empty');
  fs.mkdirSync(path.join(bucket, 'images'), { recursive: true });
  fs.writeFileSync(path.join(bucket, '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 4, annotations: [],
  }));
  fs.writeFileSync(path.join(bucket, 'doc~1.json'), JSON.stringify({
    page: 'doc~1', path: '/sites/empty/doc.html', revision: 2, annotations: [],
  }));
  fs.writeFileSync(path.join(bucket, '_seq.json'), JSON.stringify({ next: 7 }));
  fs.writeFileSync(path.join(bucket, 'images', 'doc~1-1-1.png'), 'leftover');
  const file = registryWith(dir, [
    { id: 'empty', kind: 'dir', path: site },
    { id: 'nobucket', kind: 'dir', path: site },
  ]);
  const rec = recorder();
  const requestFn = () => Promise.reject(new Error('down'));
  const env = { PINPOINT_DATA_DIR: dataRoot };
  assert.equal(await runRemove(['remove', 'empty', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 0);
  assert.ok(!fs.existsSync(bucket), '空桶连遗留图片一起删');
  assert.ok(fs.existsSync(path.join(site, 'index.html')), '源文件不动');
  assert.ok(rec.out.some((line) => /没有标注行，已顺手删掉/.test(line)), rec.out.join('\n'));
  assert.ok(rec.err.some((line) => /服务未在跑/.test(line)), '服务不在跑也照删，下次启动生效');

  assert.equal(await runRemove(['remove', 'nobucket', '--registry', file], { ...rec.io, cwd: dir, env, requestFn }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries, [], '两条删完后登记表为空');
  assert.ok(rec.out.some((line) => /不存在，没有桶要清/.test(line)), rec.out.join('\n'));
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

function siteStatusReport(site) {
  const json = healthJson({ site });
  return classifyStatus({
    repoRoot: REPO_ROOT,
    routesPath: '/r.json',
    route: { hostname: 'pinpoint.localhost', port: 4812, pid: 94084 },
    pidAlive: true,
    direct: { url: 'd', ok: true, status: 200, json },
    proxied: { url: 'p', ok: true, status: 200, json },
  });
}

test('classifyStatus: 文章站点按需拉起 —— idle 不算故障，failed 算', () => {
  const base = { port: 4530, pid: null, external: false, restarts: 0, logFile: '/x/logs/site-dev.log', warning: null };
  const idle = siteStatusReport({ ...base, state: 'idle' });
  assert.equal(idle.ok, true);
  assert.equal(idle.diagnosis, '服务正常。');
  const idleRow = idle.rows.find((r) => r.label === '文章站点');
  assert.equal(idleRow.state, 'skip');
  assert.match(idleRow.detail, /127\.0\.0\.1:4530 没在跑，第一次打开文章时启动/);

  const ready = siteStatusReport({ ...base, state: 'ready', pid: 4242 });
  assert.equal(ready.ok, true);
  assert.match(ready.rows.find((r) => r.label === '文章站点').detail, /就绪（pid 4242）/);

  const starting = siteStatusReport({ ...base, state: 'starting', pid: 4242 });
  assert.equal(starting.ok, true);
  assert.equal(starting.rows.find((r) => r.label === '文章站点').state, 'warn');

  const misconfigured = siteStatusReport({ ...base, state: 'ready', external: true, warning: '站点的 vite 没有以 /_astro/ 为 base' });
  const rows = misconfigured.rows.filter((r) => r.label === '文章站点' || r.state === 'note');
  assert.deepEqual(rows.map((r) => r.state), ['warn', 'note']);
  assert.match(rows[0].detail, /外部进程/);

  const failed = siteStatusReport({ ...base, state: 'failed', lastError: '连续 2 次没就绪就退出' });
  assert.equal(failed.ok, false);
  assert.match(failed.rows.find((r) => r.label === '文章站点').detail, /没起来：连续 2 次没就绪就退出；日志 \/x\/logs\/site-dev\.log/);
  assert.match(failed.diagnosis, /文章站点的开发服务器起不来/);
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

test('runStatus: 设了 PINPOINT_ORIGIN 只体检那一个服务，不读 portless 路由、不打路由端口', async (t) => {
  // 路由表里有一条健康的 portless 路由（owner 的常驻服务）；PINPOINT_ORIGIN 指测试服务。
  const made = lifecycleIo(t);
  const asked = [];
  const io = {
    ...made.io,
    env: { ...made.io.env, PINPOINT_ORIGIN: 'http://127.0.0.1:5710/' },
    requestFn: (url) => {
      asked.push(url);
      return Promise.resolve({ status: 200, json: healthJson() });
    },
  };
  assert.equal(await runStatus(['status'], io), 0);
  assert.deepEqual(asked, ['http://127.0.0.1:5710/health']);
  const out = made.rec.out;
  assert.equal(out[0], 'pinpoint status · http://127.0.0.1:5710（PINPOINT_ORIGIN；没看 portless 路由）');
  assert.ok(out.some((line) => /\/health +正常 +http:\/\/127\.0\.0\.1:5710\/health 200/.test(line)));
  assert.ok(!out.some((line) => /路由 |进程 |直连|代理|pinpoint\.localhost|4812/.test(line)), out.join('\n'));
  assert.ok(out.some((line) => /→ 服务正常。/.test(line)));

  // 测试服务不通：报红、指名是哪个 origin，也不去问 portless 那个。
  const down = lifecycleIo(t);
  const downAsked = [];
  const downIo = {
    ...down.io,
    env: { ...down.io.env, PINPOINT_ORIGIN: 'http://127.0.0.1:5710' },
    requestFn: (url) => { downAsked.push(url); return Promise.reject(new Error('connect ECONNREFUSED')); },
  };
  assert.equal(await runStatus(['status'], downIo), 1);
  assert.deepEqual(downAsked, ['http://127.0.0.1:5710/health']);
  assert.ok(down.rec.out.some((line) => /→ http:\/\/127\.0\.0\.1:5710 的 \/health 不通/.test(line)));

  // 服务答了但跑的是别的目录：同样判失败。
  const other = classifyOriginStatus({ repoRoot: REPO_ROOT, origin: 'http://o', health: { url: 'http://o/health', ok: true, status: 200, json: healthJson({ root: '/elsewhere' }) } });
  assert.equal(other.ok, false);
  assert.match(other.diagnosis, /另一个目录（\/elsewhere）/);
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

test('run: 未知命令退 2 并指向命令一览；无参数打命令一览', async (t) => {
  const { io, rec } = lifecycleIo(t);
  assert.equal(await run(['reload'], io), 2);
  assert.ok(rec.err.some((line) => /未知命令：reload/.test(line)));
  assert.ok(rec.err.includes('命令一览：ppnt --help'), rec.err.join('\n'));
  assert.equal(await run([], io), 0);
  assert.match(rec.out.at(-1), /用法/);
});

test('run: --json 写在命令前面与写在后面是同一次调用', async (t) => {
  const { io, rec } = lifecycleIo(t);
  // 信封的 command 记命令，不是 flag；未知命令照样退 2。
  assert.equal(await run(['--json', 'reload'], io), 2);
  const envelope = JSON.parse(rec.out.at(-1));
  assert.equal(envelope.command, 'reload');
  assert.equal(envelope.exit, 2);
  // 原生命令（list）不管 flag 在哪边，stdout 顶层都是它自己的 JSON 文档。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cli-json-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [] }));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data'), PINPOINT_ORIGIN: 'http://127.0.0.1:1' };
  const before = recorder();
  assert.equal(await run(['list', '--json', '--registry', registry], { ...before.io, env }), 0, before.err.join('\n'));
  const after = recorder();
  assert.equal(await run(['--json', 'list', '--registry', registry], { ...after.io, env }), 0, after.err.join('\n'));
  assert.deepEqual(JSON.parse(after.out.join('\n')), JSON.parse(before.out.join('\n')));
  // help 经 dispatch 也能带 --json：帮助文本进信封 output。
  const helpRec = recorder();
  assert.equal(await run(['--json', 'help', 'mv'], helpRec.io), 0);
  const helpEnvelope = JSON.parse(helpRec.out.join('\n'));
  assert.equal(helpEnvelope.exit, 0);
  assert.ok(helpEnvelope.output.join('\n').length > 0);
});

/* ---- pp2：build / render ---- */

test('parseArgs: build / render 的选项与位置参数', () => {
  assert.deepEqual(parseArgs(['build', 'plugins']), { command: 'build', target: 'plugins', flags: {} });
  assert.deepEqual(parseArgs(['build', 'plugins', '--frame', 's1-home', '--watch']), {
    command: 'build', target: 'plugins', flags: { frame: 's1-home', watch: true },
  });
  assert.deepEqual(parseArgs(['render', 'library/home', '--full']), {
    command: 'render', target: 'library/home', flags: { full: true },
  });
  assert.throws(() => parseArgs(['build']), /build 需要一个目标/);
  assert.throws(() => parseArgs(['render']), /render 需要一帧/);
  assert.throws(() => parseArgs(['build', 'x', '--full']), /选项 --full 不适用于 build/);
  assert.throws(() => parseArgs(['render', 'x/y', '--watch']), /选项 --watch 不适用于 render/);
  assert.throws(() => parseArgs(['build', 'x', '--frame']), /选项 --frame 缺少值/);
  assert.throws(() => parseArgs(['build', 'x', '--screen', 's1-home']), /未知选项：--screen/);
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
  assert.equal(code3, 2, '找不到目标是用法错');
  assert.ok(ghost.err.some((line) => /找不到 ghost/.test(line)), ghost.err.join('\n'));
  assert.ok(ghost.err.some((line) => /t-page/.test(line)), '报错列出可用 id');
});

test('startPageWatch：多个文件的改动都编出来；只改一屏时没改的屏不重编（审计 B1）', async (t) => {
  const made = makeCompiledPage(t, {
    screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
    files: {
      'a.html': '<div class="ios-app">a1</div>\n',
      'b.html': '<div class="ios-app">b1</div>\n',
      'c.html': '<div class="ios-app">c1</div>\n',
    },
  });
  // 先整页编一次：dist 与 build.json 的依赖图就位，watch 才有得筛。
  const first = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', made.registry], { ...first.io, env: made.env }), 0, first.err.join('\n'));
  const distEntry = path.join(made.env.PINPOINT_DATA_DIR, 'dist', 't-page');

  const target = { entryId: 't-page', pageDir: made.page, urlBase: '/sites/t-page/', kind: 'dir' };
  const results = [];
  const { watcher, done } = startPageWatch(
    target,
    (result) => results.push(result),
    { debounceMs: 30, distRoot: path.join(made.env.PINPOINT_DATA_DIR, 'dist') },
  );
  t.after(() => watcher.close());
  // macOS 的 recursive fs.watch 走 FSEvents，挂载是异步的：起 watch 后立刻写
  // 文件会赶不上第一拍。挂载前写丢的改动会被漂移校验判成全编（正确行为，但会
  // 重写 c），所以先只重写 a（同内容）直到收到第一拍，确认 watch 已挂上，再记 c 的基线。
  for (const deadline = Date.now() + 5000; !results.length;) {
    if (Date.now() > deadline) throw new Error('watch 5s 内没挂上');
    fs.writeFileSync(path.join(made.page, 'a.html'), '<div class="ios-app">a1</div>\n');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await done();
  }
  // 第一段：a、b 都改，两屏都编出新内容。周期性重写直到 dist 出现新内容（重写
  // 同内容幂等，只当触发器用）；事件送达与去抖的时序不打紧，拆成几批终态也一样。
  // 这一段不断言 c：a 那一批规划时 b 的事件可能还没送到，漂移校验会判全编
  // （宁可多编，正确行为），c 被重写与否取决于负载下的事件时序。
  const writeUntil = async (writes, expect) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      for (const [file, body] of writes) fs.writeFileSync(path.join(made.page, file), body);
      const state = expect.map(([file, needle]) => fs.readFileSync(path.join(distEntry, file), 'utf8').includes(needle));
      if (state.every(Boolean)) return;
      if (Date.now() > deadline) throw new Error(`watch 5s 内没编出新 dist（${expect.map(([f], i) => `${f}=${state[i]}`).join(' ')}）`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };
  await writeUntil(
    [['a.html', '<div class="ios-app">a2</div>\n'], ['b.html', '<div class="ios-app">b2</div>\n']],
    [['a.html', 'a2'], ['b.html', 'b2']],
  );
  // 等迟到的事件排空：结果数 500ms 不再增长才记 c 的基线。
  for (let seen = -1; seen !== results.length;) {
    seen = results.length;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await done();
  }
  const cBefore = fs.statSync(path.join(distEntry, 'c.html')).mtimeMs;
  // 第二段：只改 a。a 自己在变更集合里，b、c 的记录与盘一致，没有漂移 → 只编 a。
  await writeUntil([['a.html', '<div class="ios-app">a3</div>\n']], [['a.html', 'a3']]);
  watcher.close();
  await done();
  assert.ok(results.length >= 1, 'onResult 至少收到一次编译结果');
  assert.equal(fs.statSync(path.join(distEntry, 'c.html')).mtimeMs, cBefore, '没改的屏不重编');
});

test('runBuild：只编部分帧时写明「增量 M/N 帧」，整页照旧打帧数', async (t) => {
  const made = makeCompiledPage(t, {
    screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    files: { 'a.html': '<div class="ios-app">a</div>\n', 'b.html': '<div class="ios-app">b</div>\n' },
  });
  const full = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', made.registry], { ...full.io, env: made.env }), 0);
  assert.match(full.out.at(-1), /^完成 t-page {2}共 [\d.]+ms（2 帧）$/);
  const one = recorder();
  assert.equal(await runBuild(['build', 't-page', '--frame', 'b', '--registry', made.registry], { ...one.io, env: made.env }), 0);
  assert.match(one.out.at(-1), /^完成 t-page {2}共 [\d.]+ms（增量 1\/2 帧）$/);
  const viaFrame = recorder();
  assert.equal(await runBuild(['build', 't-page', '--frame', 'a', '--registry', made.registry], { ...viaFrame.io, env: made.env }), 0);
  assert.match(viaFrame.out.at(-1), /增量 1\/2 帧/);
  assert.ok(viaFrame.out.some((line) => /^ok {3}a /.test(line)), viaFrame.out.join('\n'));
});

test('startPageWatch：一拍抛错只打日志，串行链不断，后面的批次照常编（review glm 建议 3）', async (t) => {
  const made = makeCompiledPage(t, {
    screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    files: { 'a.html': '<div class="ios-app">a1</div>\n', 'b.html': '<div class="ios-app">b1</div>\n' },
  });
  const first = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', made.registry], { ...first.io, env: made.env }), 0);
  const distEntry = path.join(made.env.PINPOINT_DATA_DIR, 'dist', 't-page');
  const target = { entryId: 't-page', pageDir: made.page, urlBase: '/sites/t-page/', kind: 'dir' };
  const errors = [];
  const results = [];
  const { watcher, done } = startPageWatch(target, (result) => {
    results.push(result);
    // 第一拍的收尾抛错（替身：dist 写盘 IO 错之类）；链必须活下来。
    if (results.length === 1) throw new Error('第一拍炸了');
  }, {
    debounceMs: 30,
    distRoot: path.join(made.env.PINPOINT_DATA_DIR, 'dist'),
    onError: (error) => errors.push(error.message),
  });
  t.after(() => watcher.close());
  // FSEvents 挂载是异步的，周期性重写当触发器（见上一条的注释）。
  const until = async (label, ready, touch) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      touch();
      await new Promise((resolve) => setTimeout(resolve, 250));
      await done();
      if (ready()) return;
      if (Date.now() > deadline) throw new Error(`watch 5s 内没等到：${label}`);
    }
  };
  await until('第一拍抛错', () => errors.length >= 1, () => fs.writeFileSync(path.join(made.page, 'a.html'), '<div class="ios-app">a2</div>\n'));
  await until('抛错之后的下一拍照常编', () => fs.readFileSync(path.join(distEntry, 'b.html'), 'utf8').includes('b2'),
    () => fs.writeFileSync(path.join(made.page, 'b.html'), '<div class="ios-app">b2</div>\n'));
  watcher.close();
  assert.deepEqual(errors, ['第一拍炸了']);
  assert.ok(results.length >= 2, '抛错后的批次仍回报结果');
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
  assert.equal(await runRender(['render', 't-page', ...args], { ...badRef.io, env: made.env }), 2);
  assert.ok(badRef.err.some((line) => /形如 <目标>\/<帧 id>/.test(line)));

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

/* ---- pp2 切片 4：comments / locate / mark ---- */

import {
  planShotJobs,
  runCheck,
  runLocate,
  runMark,
  runPrune,
  runReply,
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

/** 编译好的页 + 页桶 @canvas 里两条指向 home.jsx:4/5 的帧标注（storage-unify）。 */
async function makeAnnotatedPage(t) {
  const made = makeCompiledPage(t, {
    screens: [{ id: 'home', title: 'Home' }],
    files: { 'home.jsx': HOME_JSX },
  });
  const build = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', made.registry], { ...build.io, env: made.env }), 0, build.err.join('\n'));
  fs.mkdirSync(path.join(made.env.PINPOINT_DATA_DIR, 't-page'), { recursive: true });
  fs.writeFileSync(path.join(made.env.PINPOINT_DATA_DIR, 't-page', '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 2,
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

test('parseArgs：check / comments / locate / shot / mark 的形状与用法错误', () => {
  assert.deepEqual(parseArgs(['comments', 'p', '--frame', 'B3', '--status', 'done', '--mode', 'both', '--group-by', 'component', '--json']), {
    command: 'comments', target: 'p',
    flags: { frame: 'B3', status: 'done', mode: 'both', 'group-by': 'component', json: true },
  });
  assert.deepEqual(parseArgs(['check', 'p', '--json']), { command: 'check', target: 'p', flags: { json: true } });
  for (const flag of ['--frame', '--status', '--mode', '--group-by']) {
    assert.throws(() => parseArgs(['check', 'p', flag, 'x']), new RegExp(`选项 ${flag} 不适用于 check`));
  }
  for (const command of ['locate', 'mark', 'reply']) {
    assert.throws(() => parseArgs([command, '#1', 'done', '--page', 'p']), /未知选项：--page/);
  }
  assert.throws(() => parseArgs(['status', '--page', 'p']), /未知选项：--page/);
  assert.deepEqual(parseArgs(['locate', '#1', 'B3']), { command: 'locate', refs: ['#1', 'B3'], flags: {} });
  assert.deepEqual(parseArgs(['locate', 'p/a', '#1']), { command: 'locate', refs: ['p/a', '#1'], flags: {} });
  assert.deepEqual(parseArgs(['shot', 'p/a', '--canvas', '--timeout', '30']), { command: 'shot', refs: ['p/a'], flags: { canvas: true, timeout: '30' } });
  assert.deepEqual(parseArgs(['reply', 'p/a', '#3', '好', '了']), { command: 'reply', target: 'p/a', refs: ['#3'], text: '好 了', flags: {} });
  assert.deepEqual(parseArgs(['reply', 'p/a#3', '好']), { command: 'reply', refs: ['p/a#3'], text: '好', flags: {} });
  assert.deepEqual(parseArgs(['comments', 'p', '--status', 'all']), { command: 'comments', target: 'p', flags: { status: 'all' } });
  assert.deepEqual(parseArgs(['show', 'p/a', '--json']), { command: 'show', target: 'p/a', flags: { json: true } });
  assert.deepEqual(parseArgs(['shot', 'B', '--marks', '--scale', '2']), { command: 'shot', refs: ['B'], flags: { marks: true, scale: '2' } });
  assert.deepEqual(parseArgs(['mark', '#1', '#3-#5', 'done']), {
    command: 'mark', refs: ['#1', '#3-#5'], statusWord: 'done', flags: {},
  });
  assert.deepEqual(parseArgs(['mark', 'p/a', '#1', 'done', '--note', '改好了']).flags, { note: '改好了' }, 'mark --note 带回复');
  assert.throws(() => parseArgs(['mark', '#1', 'done', '--note']), /--note 缺少值/);
  assert.throws(() => parseArgs(['locate']), /至少要一个目标或引用/);
  assert.throws(() => parseArgs(['mark', '#1']), /mark 需要目标、引用与状态/);
  assert.throws(() => parseArgs(['show', 'p', '--frames']), /--frames 不适用于 show/);
  assert.throws(() => parseArgs(['check', 'p', '--watch', '--registry', 'r']), /--watch 不适用于 check/);
});

test('runComments：默认 open 按帧分组，摘录指到源码行；--json 结构化', async (t) => {
  const made = await makeAnnotatedPage(t);
  const rec = recorder();
  const code = await runComments(['comments', 't-page', '--registry', made.registry], { ...rec.io, env: made.env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => line.includes('# demo-page') || line.includes('# t-page')), rec.out[0]);
  assert.ok(rec.out.some((line) => line.includes('[#1]') && line.includes('这段要改') && line.includes('open')), rec.out.join('\n'));
  assert.ok(rec.out.some((line) => /4>/.test(line) && line.includes('目标段')), '锚点行 home.jsx:4 带 > 前缀');
  assert.ok(!rec.out.some((line) => line.includes('[#2]')), '默认只看 open');

  const all = recorder();
  assert.equal(await runComments(['comments', 't-page', '--registry', made.registry, '--status', 'all'], { ...all.io, env: made.env }), 0);
  assert.ok(all.out.some((line) => line.includes('[#2]') && line.includes('done')));

  const json = recorder();
  assert.equal(await runComments(['comments', 't-page', '--registry', made.registry, '--json'], { ...json.io, env: made.env }), 0);
  const parsed = JSON.parse(json.out.join('\n'));
  assert.equal(parsed.groups[0].rows[0].file, 'home.jsx');
  assert.equal(parsed.groups[0].rows[0].line, 4);
});

test('runComments：未知帧 / 坏状态码非零退出并报因', async (t) => {
  const made = await makeAnnotatedPage(t);
  const ghost = recorder();
  assert.equal(await runComments(['comments', 't-page', '--registry', made.registry, '--frame', 'Z9'], { ...ghost.io, env: made.env }), 1);
  assert.ok(ghost.err.some((line) => /没有帧 Z9/.test(line)));
  const bad = recorder();
  assert.equal(await runComments(['comments', 't-page', '--registry', made.registry, '--status', 'nope'], { ...bad.io, env: made.env }), 2);
  assert.ok(bad.err.some((line) => /--status/.test(line)));
});

test('runLocate：#n → 源文件:行；未编页给 selector', async (t) => {
  const made = await makeAnnotatedPage(t);
  const rec = recorder();
  const code = await runLocate(['locate', 't-page', '#1', '--registry', made.registry], { ...rec.io, env: made.env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => /#1 → home\.jsx:4/.test(line)), rec.out.join('\n'));
  const range = recorder();
  assert.equal(await runLocate(['locate', 't-page', '#1-#2', '--registry', made.registry], { ...range.io, env: made.env }), 0);
  assert.ok(range.out.some((line) => /#2 → home\.jsx:5/.test(line)), range.out.join('\n'));
});

test('runMark：走状态端点带 baseRevision，逐条打印；close / open 拒收；服务不在跑报 ppnt start', async (t) => {
  const made = await makeAnnotatedPage(t);
  const close = recorder();
  assert.equal(await runMark(['mark', 't-page', '#1', 'close', '--registry', made.registry], { ...close.io, env: made.env }), 2);
  assert.ok(close.err.some((line) => /close 只在工作台/.test(line)));
  // open 只由 owner 在工作台编辑触发，mark 不写——传 open 指名道姓报因。
  const open = recorder();
  assert.equal(await runMark(['mark', 't-page', '#1', 'open', '--registry', made.registry], { ...open.io, env: made.env }), 2);
  assert.ok(open.err.some((line) => /open 由工作台编辑触发，mark 不写/.test(line)));

  // 服务不在跑（requestFn 抛错 = 探活失败）。
  const down = recorder();
  assert.equal(await runMark(['mark', 't-page', '#1', 'done', '--registry', made.registry], {
    ...down.io,
    env: { ...made.env, PINPOINT_ORIGIN: 'http://127.0.0.1:1' },
  }), 1);
  // 设了 PINPOINT_ORIGIN 是隔离运行：不能 ppnt start，提示去起那个服务。
  assert.ok(down.err.some((line) => /PINPOINT_ORIGIN=http:\/\/127\.0\.0\.1:1 那个服务没答/.test(line)), down.err.join('\n'));
  const downDefault = recorder();
  assert.equal(await runMark(['mark', 't-page', '#1', 'done', '--registry', made.registry], {
    ...downDefault.io,
    env: made.env,
    requestFn: () => Promise.reject(new Error('down')),
  }), 1);
  assert.ok(downDefault.err.some((line) => /先 `ppnt start`/.test(line)), downDefault.err.join('\n'));

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
  const code = await runMark(['mark', 't-page', '#1', 'done', '--registry', made.registry], {
    ...rec.io, env: made.env, requestFn,
  });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => /#1 → done$/.test(line)), rec.out.join('\n'));
  const post = calls.find((call) => call.method === 'POST');
  assert.match(post.url, /\/annotations\/%40canvas\/1\/status$/);
  assert.equal(post.body.entry, 't-page', '桶 = 页（storage-unify）');
  assert.equal(post.body.baseRevision, 2);

  // 409 不中断其他条：#1 成功（rev 2 对上）后 #2 因端点只认（返回 409 模拟非法转换）失败。
  const mixed = recorder();
  const mixedFn = async (urlString, opts = {}) => {
    if (opts.method === 'POST') {
      return opts.body.status === 'done'
        ? { status: 200, json: { revision: 3, annotation: { status: 'done' } } }
        : { status: 409, json: { error: 'illegal_transition', message: 'done → check' } };
    }
    return { status: 200, json: { revision: 2, annotations: [] } };
  };
  const code2 = await runMark(['mark', 't-page', '#1-#2', 'done', '--registry', made.registry], { ...mixed.io, env: made.env, requestFn: mixedFn });
  assert.equal(code2, 0);
  assert.equal(mixed.out.filter((line) => line.includes('→ done')).length, 2, mixed.out.join('\n'));
});

test('runComments：抬头给各状态计数；dist 落后于源码时先重编并在 stderr 说明', async (t) => {
  const made = await makeAnnotatedPage(t);
  const rec = recorder();
  const code = await runComments(['comments', 't-page', '--registry', made.registry], { ...rec.io, env: made.env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => /^共 1 条（全量 2） · open 1 · check 0 · done 1 · close 0$/.test(line)), rec.out.join('\n'));
  assert.ok(!rec.err.some((line) => line.includes('dist 不在或落后于源码')), 'dist 最新时不重编');
  // 源码比产物新 → 过期，先编再列。
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(made.page, 'home.jsx'), future, future);
  const stale = recorder();
  assert.equal(await runComments(['comments', 't-page', '--registry', made.registry], { ...stale.io, env: made.env }), 0);
  assert.ok(stale.err.some((line) => line.includes('dist 不在或落后于源码，先编了 t-page')), stale.err.join('\n'));
});

/* ---- shot：页引用（<页>）作业规划 ---- */

test('planShotJobs：页引用不必是基页 —— 非基页装载自己的上下文、marks 与输出目录', () => {
  const base = { pageId: 'demo', frameRows: [{ screenId: 'home', status: 'open' }, { screenId: 'settings', status: 'close' }] };
  const other = { pageId: 'example', frameRows: [{ screenId: 'beans', status: 'open' }] };
  const plan = planShotJobs(
    [
      { kind: 'page', pageId: 'demo' },
      { kind: 'page', pageId: 'example' },
      { kind: 'frame', screenId: 'home', via: 'A1' },
      { kind: 'frame', screenId: 'home', via: 'A1' }, // 重复：按 screenId 去重
    ],
    {
      basePageId: 'demo',
      baseContext: base,
      scale: 2,
      withMarks: true,
      contextFor: (pageId) => (pageId === 'example' ? other : null),
      dataRootDir: '/data',
    },
  );
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.jobs.length, 3);
  const pageJobs = plan.jobs.filter((job) => job.kind === 'page');
  assert.deepEqual(pageJobs.map((job) => job.pageId), ['demo', 'example']);
  assert.equal(pageJobs[0].scale, 2);
  // marks 跟着页走：基页只出 open 行，非基页出自己页的行；目录也按页分家。
  assert.deepEqual(pageJobs[0].marks.map((row) => row.screenId), ['home']);
  assert.deepEqual(pageJobs[1].marks.map((row) => row.screenId), ['beans']);
  assert.equal(pageJobs[1].out, path.join('/data', 'shot', 'example', 'example.png'));
  const frameJob = plan.jobs.find((job) => job.kind === 'frame');
  assert.equal(frameJob.pageId, 'demo');
  // 产物按不变的帧 id 命名，不按显示编号（编号随 board 调序漂移）。
  assert.equal(frameJob.out, path.join('/data', 'shot', 'demo', 'home.png'));
  assert.deepEqual(frameJob.marks.map((row) => row.screenId), ['home']);
});

test('planShotJobs：文章的文档帧（HTML 帧）按自己的地址拍，节里全是文档帧时不拍节图', () => {
  const board = { sections: [
    { id: 'pages', letter: 'B', screens: [{ id: 'long', shell: 'doc' }, { id: 'cat', shell: 'doc', src: 'sites/d_a/@root/x/cat.html' }] },
    { id: 'app', letter: 'C', screens: [{ id: 'phone' }] },
  ] };
  const base = {
    pageId: 'd_a',
    article: { projectId: 'd', articleId: 'a' },
    target: { urlBase: '/sites/d_a/' },
    board,
    refs: { outline: [{ id: 'pages', frames: [{ id: 'long', ref: 'B1' }, { id: 'cat', ref: 'B2' }] }, { id: 'app', frames: [{ id: 'phone', ref: 'C1' }] }] },
    frameRows: [{ n: 1, screenId: 'long', status: 'open' }],
  };
  const plan = planShotJobs(
    [
      { kind: 'section', sectionId: 'pages', ref: 'B', frames: [{ id: 'long' }, { id: 'cat' }] },
      { kind: 'frame', screenId: 'phone', via: 'C1' },
    ],
    { basePageId: 'd_a', baseContext: base, scale: 1, withMarks: true, dataRootDir: '/data' },
  );
  assert.deepEqual(plan.jobs.map((job) => [job.kind, job.screenId || job.sectionId, job.url || '', job.label]), [
    ['doc', 'long', '/sites/d_a/long.html', 'B1 · long'],
    ['doc', 'cat', '/sites/d_a/@root/x/cat.html', 'B2 · cat'],
    ['frame', 'phone', '', 'C1 · phone'],
  ]);
  assert.deepEqual(plan.jobs[0].marks.map((row) => row.n), [1]);
  assert.equal(plan.jobs[1].out, path.join('/data', 'shot', 'd_a', 'cat.png'));
});

test('planShotJobs：非基页装载失败 → problem 逐条报，不炸整批', () => {
  const plan = planShotJobs(
    [{ kind: 'page', pageId: 'ghost' }, { kind: 'frame', screenId: 'home', via: 'A1' }],
    {
      basePageId: 'demo',
      baseContext: { pageId: 'demo', frameRows: [] },
      scale: 1,
      withMarks: false,
      contextFor: () => null,
      dataRootDir: '/data',
    },
  );
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.problems.length, 1);
  assert.match(plan.problems[0], /找不到页：ghost/);
});

test('runComments：整桶孤儿的页直接报孤儿，不先打「找不到页」（K8）', async (t) => {
  const made = await makeAnnotatedPage(t);
  const bucket = path.join(made.env.PINPOINT_DATA_DIR, 'ghost-page');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 1,
    annotations: [{ id: 'g1', n: 1, type: 'element', pageId: 'ghost-page', status: 'open', content: '残留行' }],
  }));

  const rec = recorder();
  const code = await runComments(['comments', 'ghost-page', '--registry', made.registry], { ...rec.io, env: made.env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => /^ghost-page 不在 registry 与本地页面清单里（.*）；桶里 1 本账本全是孤儿/.test(line)), rec.out.join('\n'));
  assert.ok(rec.err.length === 0, '不先打「找不到页」错误');

  // 桶也不在：没有报告可给，原样报错，按找不到目标退 2。
  const bare = recorder();
  const code2 = await runComments(['comments', 'no-bucket', '--registry', made.registry], { ...bare.io, env: made.env });
  assert.equal(code2, 2);
  assert.ok(bare.err.some((line) => /找不到 no-bucket/.test(line)), bare.err.join('\n'));
});

test('无 board.json 的 dir 条目是 doc 页：comments 列账本行带 pathname、给计数，mark 能写', async (t) => {
  const dir = withTempDir(t);
  const site = path.join(dir, 'handbook');
  fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<h1>handbook</h1>\n');
  fs.writeFileSync(path.join(site, 'guide.html'), '<h1>guide</h1>\n');
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({
    version: 1,
    entries: [{ id: 't-handbook', title: 'H', kind: 'dir', path: site, board: 'html' }],
  }));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  const bucket = path.join(env.PINPOINT_DATA_DIR, 't-handbook');
  fs.mkdirSync(bucket, { recursive: true });
  // doc 页的账本形态：每个 pathname 一本，doc.path 记表面路径；路径都落在
  // 条目目录里 → 不是孤儿（prune 不得误判）。
  fs.writeFileSync(path.join(bucket, 'index.html_1a2b3c.json'), JSON.stringify({
    page: 'index.html~1a2b3c', path: '/sites/t-handbook/index.html', revision: 3,
    annotations: [{ id: 'd1', n: 1, type: 'element', status: 'open', content: '首页意见' }],
  }));
  fs.writeFileSync(path.join(bucket, 'guide.html_4d5e6f.json'), JSON.stringify({
    page: 'guide.html~4d5e6f', path: '/sites/t-handbook/guide.html', revision: 1,
    annotations: [{ id: 'd2', n: 2, type: 'element', status: 'done', content: '指南页意见' }],
  }));

  // comments：每行带账本对应的 pathname；摘录位置明说不是编译页，退 0。
  const rec = recorder();
  const code = await runComments(['comments', 't-handbook', '--registry', registry, '--status', 'all'], { ...rec.io, env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => line.includes('[#1]') && line.includes('首页意见') && line.includes('/sites/t-handbook/index.html')), rec.out.join('\n'));
  assert.ok(rec.out.some((line) => line.includes('[#2]') && line.includes('/sites/t-handbook/guide.html')), rec.out.join('\n'));
  assert.ok(rec.out.some((line) => line.includes('这页不是编译页，没有源码摘录')), rec.out.join('\n'));
  assert.ok(!rec.out.some((line) => /home\.jsx|dist\//.test(line)), 'doc 页没有源码 / dist 摘录');

  // 抬头给计数；不误报「整桶孤儿」。
  assert.ok(rec.out.some((line) => /^共 2 条 · open 1 · check 0 · done 1 · close 0$/.test(line)), rec.out.join('\n'));
  assert.ok(!rec.out.some((line) => line.includes('全是孤儿')), rec.out.join('\n'));

  // mark：#1 → done 走服务端点（mock），桶 = 页。
  const calls = [];
  const requestFn = async (urlString, opts = {}) => {
    calls.push({ url: urlString, method: opts.method || 'GET', body: opts.body });
    if (opts.method === 'POST') return { status: 200, json: { revision: 4, annotation: { status: 'done' } } };
    return { status: 200, json: { revision: 3, annotations: [] } };
  };
  const mk = recorder();
  const code3 = await runMark(['mark', 't-handbook', '#1', 'done', '--registry', registry], { ...mk.io, env, requestFn });
  assert.equal(code3, 0, mk.err.join('\n'));
  assert.ok(mk.out.some((line) => line.includes('#1 → done')), mk.out.join('\n'));
  const post = calls.find((call) => call.method === 'POST');
  assert.match(post.url, /\/annotations\/index\.html_1a2b3c\/1\/status$/);
  assert.equal(post.body.entry, 't-handbook');
});

test('runComments：老登记表里的 url 条目读时跳过，它的桶整桶报孤儿', async (t) => {
  const dir = withTempDir(t);
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({
    version: 1,
    entries: [{ id: 't-live', title: 'L', kind: 'url', url: 'https://live.example/app' }],
  }));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  const bucket = path.join(env.PINPOINT_DATA_DIR, 't-live');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, 'app_x1.json'), JSON.stringify({
    page: 'app~x1', path: '/sites/t-live/app', revision: 2,
    annotations: [{ id: 'u1', n: 1, type: 'element', status: 'open', content: '线上页意见' }],
  }));
  const rec = recorder();
  const code = await runComments(['comments', 't-live', '--registry', registry], { ...rec.io, env });
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => line.includes('全是孤儿')), rec.out.join('\n'));
});

test('整桶孤儿照样能 mark / reply：老 url 条目的桶、删掉的文章的桶，目标解析认盘上的桶，comments 列出行（E）', async (t) => {
  const made = makeProjectWithBuckets(t);
  // 集成后老登记表里的 url 条目读时被跳过：它的桶留在盘上，整桶是孤儿。
  const bucket = path.join(made.data, 't-live');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, 'app_x1.json'), JSON.stringify({
    page: 'app~x1', path: '/sites/t-live/app', revision: 2,
    annotations: [{ id: 'u1', n: 1, type: 'element', status: 'open', content: '线上页意见' }],
  }));
  const comments = recorder();
  assert.equal(await runComments(['comments', 't-live', '--registry', made.registry], { ...comments.io, env: made.env }), 0, comments.err.join('\n'));
  assert.ok(comments.out[0].includes('全是孤儿'), comments.out.join('\n'));
  assert.ok(comments.out.some((line) => line.includes('[#1]') && line.includes('线上页意见')), comments.out.join('\n'));

  const calls = [];
  const requestFn = async (urlString, opts = {}) => {
    calls.push({ url: urlString, method: opts.method || 'GET', body: opts.body });
    if (opts.method === 'POST') return { status: 200, json: { revision: 3, annotation: { status: 'done' } } };
    return { status: 200, json: { revision: 2, annotations: [] } };
  };
  const mark = recorder();
  assert.equal(await runMark(['mark', 't-live', '#1', 'done', '--note', '那一页撤了', '--registry', made.registry], { ...mark.io, env: made.env, requestFn }), 0, mark.err.join('\n'));
  const posts = calls.filter((call) => call.method === 'POST');
  assert.deepEqual(posts.map((call) => call.url.replace(/^.*?\/annotations\//, '')), ['app_x1/1/reply', 'app_x1/1/status']);
  assert.ok(posts.every((call) => call.body.entry === 't-live'));

  calls.length = 0;
  const reply = recorder();
  assert.equal(await runReply(['reply', 'demo/gone#4', '文章已经删了', '--registry', made.registry], { ...reply.io, env: made.env, requestFn }), 0, reply.err.join('\n'));
  const post = calls.find((call) => call.method === 'POST');
  assert.match(post.url, /\/annotations\/%40canvas\/4\/reply$/);
  assert.equal(post.body.entry, 'demo_gone');
});

/* ---- list ---- */

test('runList: 关键词对上口头说法，计数读页桶，找不到时给出路', async (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, 'routine');
  fs.writeFileSync(path.join(site, 'board.json'), '{"sections":[]}');
  const file = registryWith(dir, [
    { id: 'routine-creator', title: 'Routine 创建', kind: 'dir', path: site },
    { id: 'docs', title: 'Handbook', kind: 'dir', path: makeSite(dir, 'docs') },
  ]);
  const dataRootDir = path.join(dir, 'data');
  fs.mkdirSync(path.join(dataRootDir, 'routine-creator'), { recursive: true });
  fs.writeFileSync(path.join(dataRootDir, 'routine-creator', '@canvas.json'), JSON.stringify({
    annotations: [{ n: 1, status: 'open' }, { n: 2, status: 'check' }, { n: 3, status: 'close' }],
  }));
  const env = { PINPOINT_DATA_DIR: dataRootDir };

  const rec = recorder();
  assert.equal(await runList(['list', 'routines', '--registry', file], { ...rec.io, cwd: dir, env }), 0);
  assert.match(rec.out[0], /^routine-creator {2}· {2}Routine 创建 {2}· {2}编译页 {2}· {2}open 1 · check 1 · done 0$/);
  assert.equal(rec.out[1], '    ' + site);
  assert.match(rec.out.at(-1), /^共 1 页（匹配“routines”）/);

  const all = recorder();
  assert.equal(await runList(['list', '--registry', file], { ...all.io, cwd: dir, env }), 0);
  assert.ok(all.out.some((line) => /^docs {2}· {2}Handbook {2}· {2}文档页$/.test(line)));

  const none = recorder();
  assert.equal(await runList(['list', 'zzz-nothing', '--registry', file], { ...none.io, cwd: dir, env }), 1);
  assert.match(none.out[0], /没有匹配“zzz-nothing”的页/);
});

test('list <页> --frames：编号 · 帧 id · 源文件 · 标题；build 对形如编号的 id 给提示', async (t) => {
  const made = makeCompiledPage(t, {
    screens: [{ id: 'c1b-detail', title: '详情' }, { id: 'run-noop', title: '没出卡' }],
    files: { 'c1b-detail.html': '<div class="ios-app">详情</div>\n', 'run-noop.jsx': 'export default () => <div className="ios-app">空</div>;\n' },
  });
  const rec = recorder();
  assert.equal(await runList(['list', 't-page', '--frames', '--registry', made.registry], { ...rec.io, env: made.env }), 0, rec.err.join('\n'));
  assert.ok(rec.out.some((line) => /^A {2}main {2}Main$/.test(line)), rec.out.join('\n'));
  assert.ok(rec.out.some((line) => /^ {2}A1 +c1b-detail +c1b-detail\.html +详情$/.test(line)), rec.out.join('\n'));
  assert.ok(rec.out.some((line) => /^ {2}A2 +run-noop +run-noop\.jsx +没出卡$/.test(line)), rec.out.join('\n'));

  const bad = recorder();
  assert.equal(await runList(['list', 't-page', 'extra', '--frames', '--registry', made.registry], { ...bad.io, env: made.env }), 2);

  const build = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', made.registry], { ...build.io, env: made.env }), 0, build.err.join('\n'));
  assert.ok(build.out.some((line) => /注意 c1b-detail 这些帧 id 形如编号/.test(line)), build.out.join('\n'));
  assert.ok(!build.out.some((line) => /run-noop/.test(line) && /形如编号/.test(line)));
});

/* ---- 页 tab（ADR 0041） ---- */

/** 两个 tab 的编译页：comps（按钮 / 标签）与 flow（引导），帧各一个 .jsx。 */
function makeTabbedPage(t, board = null) {
  const dir = withTempDir(t);
  const page = path.join(dir, 'page');
  fs.mkdirSync(page, { recursive: true });
  const sec = (id, title, ids) => ({ id, title, layout: 'row', screens: ids.map((sid) => ({ id: sid, title: `屏 ${sid}` })) });
  fs.writeFileSync(path.join(page, 'board.json'), JSON.stringify(board || {
    tabs: [
      { id: 'comps', title: '组件', sections: [sec('btn', '按钮', ['btn-a', 'btn-b']), sec('chip', '标签', ['chip-a'])] },
      { id: 'flow', title: '交互', sections: [sec('onboard', '引导', ['ob-1', 'ob-2'])] },
    ],
  }));
  for (const id of ['btn-a', 'btn-b', 'chip-a', 'ob-1', 'ob-2']) {
    fs.writeFileSync(path.join(page, `${id}.jsx`), `export default function F() {\n  return <div className="ios-app"><p>${id}</p></div>;\n}\n`);
  }
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [{ id: 't-page', title: 'T', kind: 'dir', path: page }] }));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  return { dir, page, registry, env };
}

test('build 编译所有 tab 的屏（与活动 tab 无关）；list --frames 按 tab 分组、位置号带前缀', async (t) => {
  const made = makeTabbedPage(t);
  const build = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', made.registry], { ...build.io, env: made.env }), 0, build.err.join('\n'));
  for (const id of ['btn-a', 'btn-b', 'chip-a', 'ob-1', 'ob-2']) {
    assert.ok(fs.existsSync(path.join(made.env.PINPOINT_DATA_DIR, 'dist', 't-page', `${id}.html`)), `${id} 没编`);
  }
  assert.ok(build.out.some((line) => /完成 t-page.*5 帧/.test(line)), build.out.join('\n'));

  const rec = recorder();
  assert.equal(await runList(['list', 't-page', '--frames', '--registry', made.registry], { ...rec.io, env: made.env }), 0, rec.err.join('\n'));
  const text = rec.out.join('\n');
  assert.match(text, /tab：comps、flow/);
  assert.ok(rec.out.some((line) => /^tab {2}comps {2}组件$/.test(line)), text);
  assert.ok(rec.out.some((line) => /^tab {2}flow {2}交互$/.test(line)), text);
  assert.ok(rec.out.some((line) => /^A {2}btn {2}按钮$/.test(line)), text);
  assert.ok(rec.out.some((line) => /^B {2}chip {2}标签$/.test(line)), text);
  assert.ok(rec.out.some((line) => /^A {2}onboard {2}引导$/.test(line)), text);
  assert.ok(rec.out.some((line) => /^ {2}comps:A2 +btn-b +btn-b\.jsx +屏 btn-b$/.test(line)), text);
  assert.ok(rec.out.some((line) => /^ {2}flow:A1 +ob-1 +ob-1\.jsx +屏 ob-1$/.test(line)), text);
  assert.match(text, /共 2 个 tab 3 节 5 帧/);
});

test('存量单 board 的 list --frames 不出 tab 行（输出与从前相同）', async (t) => {
  const made = makeCompiledPage(t, {
    screens: [{ id: 'home', title: 'Home' }],
    files: { 'home.html': '<div class="ios-app">在</div>\n' },
  });
  const rec = recorder();
  assert.equal(await runList(['list', 't-page', '--frames', '--registry', made.registry], { ...rec.io, env: made.env }), 0, rec.err.join('\n'));
  const text = rec.out.join('\n');
  assert.doesNotMatch(text, /tab/);
  assert.match(text, /共 1 节 1 帧/);
});

test('comments --frame <tab>:A1 只出那个 tab 的帧；裸 A1 在两个 tab 里都有 → 报候选；标题带 tab 前缀', async (t) => {
  const made = makeTabbedPage(t);
  const build = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', made.registry], { ...build.io, env: made.env }), 0, build.err.join('\n'));
  fs.mkdirSync(path.join(made.env.PINPOINT_DATA_DIR, 't-page'), { recursive: true });
  const target = (text) => [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > p:nth-of-type(1)', text }];
  fs.writeFileSync(path.join(made.env.PINPOINT_DATA_DIR, 't-page', '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 2,
    annotations: [
      { id: 'k1', n: 1, type: 'element', pageId: 't-page', screenId: 'btn-a', status: 'open', content: '按钮这里 [@t:i1]', targets: target('btn-a') },
      { id: 'k2', n: 2, type: 'element', pageId: 't-page', screenId: 'ob-1', status: 'open', content: '引导这里 [@t:i1]', targets: target('ob-1') },
    ],
  }));
  const flow = recorder();
  assert.equal(await runComments(['comments', 't-page', '--frame', 'flow:A1', '--registry', made.registry], { ...flow.io, env: made.env }), 0, flow.err.join('\n'));
  const text = flow.out.join('\n');
  assert.match(text, /## flow:A1 · ob-1 · 屏 ob-1/);
  assert.match(text, /引导这里/);
  assert.doesNotMatch(text, /按钮这里/);

  const ambiguous = recorder();
  assert.equal(await runComments(['comments', 't-page', '--frame', 'A1', '--registry', made.registry], { ...ambiguous.io, env: made.env }), 1);
  assert.ok(ambiguous.err.some((line) => /A1 在多个 tab 里有，写 comps:A1 或 flow:A1/.test(line)), ambiguous.err.join('\n'));

  const all = recorder();
  assert.equal(await runComments(['comments', 't-page', '--registry', made.registry], { ...all.io, env: made.env }), 0);
  assert.match(all.out.join('\n'), /## comps:A1 · btn-a/);

  // 帧 id 裸写在多 tab 页上照旧可用
  const bare = recorder();
  assert.equal(await runComments(['comments', 't-page', '--frame', 'btn-a', '--registry', made.registry], { ...bare.io, env: made.env }), 0, bare.err.join('\n'));
  assert.match(bare.out.join('\n'), /按钮这里/);
});

test('build：sections 与 tabs 并存、空 tab、跨 tab 重复 id 都是编译失败，带同一句话', async (t) => {
  const sec = (id, ids) => ({ id, title: id, layout: 'row', screens: ids });
  const both = makeTabbedPage(t, { sections: [sec('a', ['btn-a'])], tabs: [{ id: 't', sections: [sec('b', ['btn-b'])] }] });
  const r1 = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', both.registry], { ...r1.io, env: both.env }), 1);
  assert.ok(r1.err.some((line) => /sections 与 tabs 二选一/.test(line)), r1.err.join('\n'));

  const empty = makeTabbedPage(t, { tabs: [{ id: 't', sections: [] }] });
  const r2 = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', empty.registry], { ...r2.io, env: empty.env }), 1);
  assert.ok(r2.err.some((line) => /tab "t" 至少要有一个 section/.test(line)), r2.err.join('\n'));

  const dup = makeTabbedPage(t, { tabs: [
    { id: 't1', sections: [sec('a', ['btn-a'])] },
    { id: 't2', sections: [sec('b', ['btn-a'])] },
  ] });
  const r3 = recorder();
  assert.equal(await runBuild(['build', 't-page', '--registry', dup.registry], { ...r3.io, env: dup.env }), 1);
  assert.ok(r3.err.some((line) => /duplicate screen id "btn-a"/.test(line)), r3.err.join('\n'));
});

test('planShotJobs：多 tab 页的帧 / 段作业带 tabId；整页引用逐 tab 各拍一张', () => {
  const sec = (id, ids) => ({ id, title: id, layout: 'row', screens: ids });
  const board = { tabs: [
    { id: 'comps', sections: [sec('btn', ['btn-a'])] },
    { id: 'flow', sections: [sec('onboard', ['ob-1'])] },
  ] };
  const refs = boardRefs(board);
  const base = { pageId: 'demo', board, refs, frameRows: [{ screenId: 'ob-1', status: 'open' }] };
  const picks = [
    { kind: 'frame', screenId: 'ob-1', ref: 'flow:A1', via: 'flow:A1' },
    { kind: 'section', sectionId: 'btn', ref: 'comps:A', frames: refs.outline[0].frames, tabId: 'comps', via: 'comps:A' },
    { kind: 'page', pageId: 'demo' },
  ];
  const plan = planShotJobs(picks, { basePageId: 'demo', baseContext: base, scale: 1, withMarks: false, contextFor: () => null, dataRootDir: '/data' });
  assert.deepEqual(plan.problems, []);
  const frame = plan.jobs.find((job) => job.kind === 'frame');
  assert.equal(frame.tabId, 'flow');
  assert.equal(frame.label, 'flow:A1 · ob-1');
  assert.equal(frame.out, path.join('/data', 'shot', 'demo', 'ob-1.png'));
  const section = plan.jobs.find((job) => job.kind === 'section');
  assert.equal(section.tabId, 'comps');
  const pages = plan.jobs.filter((job) => job.kind === 'page');
  assert.deepEqual(pages.map((job) => job.tabId), ['comps', 'flow']);
  assert.deepEqual(pages.map((job) => path.basename(job.out)), ['demo--comps.png', 'demo--flow.png']);

  // 存量页：整页一张，没有 tabId 键
  const legacy = planShotJobs([{ kind: 'page', pageId: 'demo' }], {
    basePageId: 'demo', baseContext: { pageId: 'demo', frameRows: [], refs: boardRefs({ sections: [sec('a', ['x'])] }) },
    scale: 1, withMarks: false, contextFor: () => null, dataRootDir: '/data',
  });
  assert.equal(legacy.jobs.length, 1);
  assert.equal('tabId' in legacy.jobs[0], false);
  assert.equal(path.basename(legacy.jobs[0].out), 'demo.png');
});

/* ---- project（pp3） ---- */

const FIXTURE_PROJECT = path.join(REPO_ROOT, 'e2e', 'project-site');
const FIXTURE_COLLIDE = path.join(REPO_ROOT, 'site', 'fixtures', 'projects', 'clash');
const offline = () => Promise.reject(new Error('connect ECONNREFUSED'));

/** 临时 project 根：<dir>/<name>/docs/pinpoint/project.json + 一篇文章。 */
function makeProjectRoot(dir, name, json) {
  const root = path.join(dir, name);
  const content = path.join(root, 'docs', 'pinpoint');
  fs.mkdirSync(path.join(content, 'articles', 'intro'), { recursive: true });
  fs.writeFileSync(path.join(content, 'articles', 'intro', 'index.mdx'), '---\ntitle: Intro\n---\n');
  if (json !== null) fs.writeFileSync(path.join(content, 'project.json'), JSON.stringify(json));
  return root;
}

test('parseArgs: --project is a switch on add only', () => {
  assert.deepEqual(parseArgs(['add', './p', '--project']), { command: 'add', target: './p', flags: { project: true } });
  assert.throws(() => parseArgs(['add', './p', '--project=yes']), /是开关，不带值/);
  assert.throws(() => parseArgs(['mv', 'a', './p', '--project']), /--project 不适用于 mv/);
});

test('runAdd --project: id and title come from project.json; bad layouts and flag mixes are refused', async (t) => {
  const dir = withTempDir(t);
  const file = registryWith(dir, [{ id: 'pinpoint', kind: 'dir', path: dir }]);
  const rec = recorder();
  assert.equal(await runAdd(['add', FIXTURE_PROJECT, '--project', '--registry', file], { ...rec.io, cwd: dir, env: {}, requestFn: offline }), 0, rec.err.join('\n'));
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { addedAt, ...entry } = doc.entries[1];
  assert.ok(addedAt > 0);
  assert.deepEqual(entry, { id: 'e2e-project', kind: 'project', title: 'E2E Project', path: FIXTURE_PROJECT });
  assert.ok(rec.out.includes('已登记 e2e-project（project）：' + FIXTURE_PROJECT));
  assert.ok(rec.out.includes('文章与 wiki：`ppnt show e2e-project`；验证：`ppnt check e2e-project`'));

  const refusals = [
    [['add', FIXTURE_PROJECT, '--project'], /id 已存在：e2e-project/],
    [['add', FIXTURE_COLLIDE, '--project', '--id', 'other'], /--id other 与 project.json 的 id "clash" 不同/],
    [['add', FIXTURE_COLLIDE, '--project', '--board', 'ios'], /--project 不能和 --board 同用/],
    [['add', FIXTURE_COLLIDE, '--project', '--title', 'X'], /--project 不接受 --title/],
    [['add', makeProjectRoot(dir, 'nojson', null), '--project'], /缺 docs\/pinpoint\/project\.json/],
    [['add', makeProjectRoot(dir, 'reserved', { id: 'api' }), '--project'], /保留名（服务已占用 \/api\/）/],
    [['add', makeProjectRoot(dir, 'badid', { id: 'Bad Id' }), '--project'], /project\.json 的 id 必须匹配/],
    [['add', path.join(FIXTURE_PROJECT, 'docs', 'pinpoint', 'project.json'), '--project'], /需要 project 根目录/],
  ];
  for (const [argv, pattern] of refusals) {
    const bad = recorder();
    assert.equal(await runAdd([...argv, '--registry', file], { ...bad.io, cwd: dir, env: {}, requestFn: offline }), 1, argv.join(' '));
    assert.match(bad.err.join('\n'), pattern);
  }
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).entries.length, 2, 'refusals leave the registry untouched');
});

test('mv / remove on a project entry', async (t) => {
  const dir = withTempDir(t);
  const first = makeProjectRoot(dir, 'first', { id: 'demo', title: 'Demo' });
  const second = makeProjectRoot(dir, 'second', { id: 'demo', title: 'Demo moved' });
  const foreign = makeProjectRoot(dir, 'foreign', { id: 'other' });
  const file = registryWith(dir, [
    { id: 'pinpoint', kind: 'dir', path: dir },
    { id: 'demo', title: 'Demo', kind: 'project', path: first },
  ]);
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  const io = (rec) => ({ ...rec.io, cwd: dir, env, requestFn: offline });

  await t.test('move keeps the id and requires the same project.json id', async () => {
    const bad = recorder();
    assert.equal(await runMv(['mv', 'demo', foreign, '--registry', file], io(bad)), 1);
    assert.match(bad.err.join('\n'), /project\.json id 是 "other"，不是 demo/);
    const plain = recorder();
    assert.equal(await runMv(['mv', 'demo', makeSite(dir, 'plain'), '--registry', file], io(plain)), 1);
    assert.match(plain.err.join('\n'), /缺 docs\/pinpoint\/project\.json/);
    const rec = recorder();
    assert.equal(await runMv(['mv', 'demo', second, '--registry', file], io(rec)), 0, rec.err.join('\n'));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries[1], { id: 'demo', kind: 'project', title: 'Demo', path: second });
  });

  await t.test('rename rewrites project.json together with the registry; reserved ids are refused', async () => {
    const reserved = recorder();
    assert.equal(await runMv(['mv', 'demo', 'sites', '--registry', file], io(reserved)), 1);
    assert.match(reserved.err.join('\n'), /保留名/);
    const rec = recorder();
    assert.equal(await runMv(['mv', 'demo', 'demo-two', '--registry', file], io(rec)), 0, rec.err.join('\n'));
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).entries[1].id, 'demo-two');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(second, 'docs', 'pinpoint', 'project.json'), 'utf8')), { id: 'demo-two', title: 'Demo moved' });
    assert.ok(rec.out.some((line) => line.startsWith('  project.json：id demo → demo-two')));
  });

  await t.test('remove drops the entry and leaves the project files alone', async () => {
    const rec = recorder();
    assert.equal(await runRemove(['remove', 'demo-two', '--registry', file], io(rec)), 0, rec.err.join('\n'));
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries.map((e) => e.id), ['pinpoint']);
    assert.ok(fs.existsSync(path.join(second, 'docs', 'pinpoint', 'project.json')));
  });
});

test('runList: projects get their own rows with indented articles; list <project> shows articles, concepts, errors', async (t) => {
  const dir = withTempDir(t);
  const file = registryWith(dir, [
    { id: 'pinpoint', title: 'pinpoint workbench', kind: 'dir', path: makeSite(dir, 'pp') },
    { id: 'e2e-project', title: 'E2E Project', kind: 'project', path: FIXTURE_PROJECT },
    { id: 'clash', title: '撞名项目', kind: 'project', path: FIXTURE_COLLIDE },
  ]);
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };

  const all = recorder();
  assert.equal(await runList(['list', '--registry', file], { ...all.io, cwd: dir, env }), 0);
  const at = all.out.indexOf('e2e-project  ·  E2E Project  ·  project  ·  2 篇文章 · 2 条 wiki');
  assert.ok(at > 0, all.out.join('\n'));
  assert.deepEqual(all.out.slice(at + 1, at + 4), [
    `    ${FIXTURE_PROJECT}`,
    '    e2e-project/commit-confirm  ·  提交前确认',
    '    e2e-project/takeover  ·  用户接手',
  ]);
  assert.ok(all.out.includes('clash  ·  撞名项目  ·  project  ·  1 篇文章 · 1 条 wiki · 1 个布局错误'));
  assert.ok(!all.out.some((line) => /^e2e-project .*文档页/.test(line)), 'a project is not listed as a page');
  assert.match(all.out.at(-1), /^共 \d+ 页 · 2 个 project · registry：/);

  const byArticle = recorder();
  assert.equal(await runList(['list', '用户接手', '--registry', file], { ...byArticle.io, cwd: dir, env }), 0);
  assert.equal(byArticle.out[0], 'e2e-project  ·  E2E Project  ·  project  ·  2 篇文章 · 2 条 wiki');

  const detail = recorder();
  assert.equal(await runList(['list', 'e2e-project', '--registry', file], { ...detail.io, cwd: dir, env }), 0);
  const text = detail.out.join('\n');
  assert.match(text, /^# e2e-project · E2E Project/);
  // list <project> 同 show <project>：文章写成斜杠地址。
  assert.match(text, /文章（2）\n {2}e2e-project\/commit-confirm {2}· {2}提交前确认 {2}· {2}4 节 · 5 帧 · open 0/);
  assert.match(text, /wiki（2）\n {2}confirm-card {2}· {2}收敛中 {2}· {2}只在不可撤销的动作之前出现/);
  assert.match(text, /布局错误：无\n/);

  const collide = recorder();
  assert.equal(await runList(['list', 'clash', '--registry', file], { ...collide.io, cwd: dir, env }), 1, 'layout errors exit non-zero');
  assert.match(collide.out.join('\n'), /布局错误（1）\n {2}✗ 撞名 \[\[confirm-card\]\]/);
});

// 原在 e2e/article-canvas.spec.js（2026-10-13 测试清理下移）：文章画布页的 --frames
// 也是编号 ↔ 帧 id ↔ 源文件，节字母跟正文走（纯文字的 why 占了 A）。
test('list <文章画布页> --frames：编号 · 帧 id · 源文件，节字母与正文一致', async (t) => {
  const dir = withTempDir(t);
  const file = registryWith(dir, [{ id: 'e2e-project', title: 'E2E Project', kind: 'project', path: FIXTURE_PROJECT }]);
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data') };
  const rec = recorder();
  assert.equal(await runList(['list', 'e2e-project_commit-confirm', '--frames', '--registry', file], { ...rec.io, cwd: dir, env }), 0, rec.err.join('\n'));
  const text = rec.out.join('\n');
  assert.ok(text.includes('# e2e-project/commit-confirm · 画布帧'), text);
  assert.match(text, /B1 {2}confirm-sheet +confirm-sheet\.jsx/);
  assert.match(text, /C1 {2}card-plain +card-plain\.jsx/);
  assert.ok(text.includes('共 3 节 5 帧'), text);
});

test('classifyStatus: project layout errors are a warning row, not a failure', () => {
  const json = healthJson({ projects: { count: 2, errors: ['e2e-collide: 撞名 [[confirm-card]]：…'] } });
  const report = classifyStatus({
    repoRoot: REPO_ROOT,
    routesPath: '/r.json',
    route: { hostname: 'pinpoint.localhost', port: 4812, pid: 94084 },
    pidAlive: true,
    direct: { url: 'http://127.0.0.1:4812/health', ok: true, status: 200, json },
    proxied: { url: 'https://pinpoint.localhost/health', ok: true, status: 200, json },
  });
  assert.equal(report.ok, true);
  const row = report.rows.find((r) => r.label === 'project');
  assert.equal(row.state, 'warn');
  assert.match(row.detail, /^2 个，1 个布局错误/);
  assert.equal(report.rows[report.rows.indexOf(row) + 1].detail, 'e2e-collide: 撞名 [[confirm-card]]：…');
  assert.equal(report.diagnosis, '服务在跑，但有告警（见上）。');
});

/* ---- pp3：文章页的正文评论 ---- */

/** 一个 project（一篇文章）+ 它的文章桶里一本 @prose 账本（一条正文评论）+ 一本 @canvas。 */
function makeArticleWithComments(t) {
  const dir = withTempDir(t);
  const root = path.join(dir, 'proj');
  const content = path.join(root, 'docs', 'pinpoint');
  fs.mkdirSync(path.join(content, 'articles', 'notes'), { recursive: true });
  fs.writeFileSync(path.join(content, 'project.json'), JSON.stringify({ id: 't-proj', title: 'T' }));
  fs.writeFileSync(path.join(content, 'articles', 'notes', 'index.mdx'), [
    '---', 'title: 评论固件', '---', '', '<Section id="how" title="底层">', '', 'agent 读到提交按钮时先停下，确认卡写清收款方。', '', '</Section>', '',
  ].join('\n'));
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [
    { id: 't-page', kind: 'dir', path: dir },
    { id: 't-proj', kind: 'project', path: root },
  ] }));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data'), PINPOINT_ORIGIN: 'http://127.0.0.1:1' };
  const bucket = path.join(env.PINPOINT_DATA_DIR, 't-proj_notes');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, '@prose.json'), JSON.stringify({
    page: '@prose', path: '/t-proj/notes/', revision: 2,
    annotations: [{
      id: 'p1', n: 2, type: 'prose', status: 'open', content: '“收款方”写全称', section: 'how',
      quote: { exact: '确认卡写清收款方', prefix: '先停下，', suffix: '。' },
      created_at: '2026-10-13T01:00:00.000Z',
      messages: [{ who: 'agent', text: '改成了全称', at: '2026-10-13T02:00:00.000Z' }],
    }],
  }));
  fs.writeFileSync(path.join(bucket, '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 1,
    annotations: [{ id: 'c1', n: 1, type: 'element', status: 'open', content: '画布上的意见', pageId: 't-proj_notes', screenId: 'x' }],
  }));
  return { dir, registry, env, file: path.join(content, 'articles', 'notes', 'index.mdx') };
}

test('comments <project>/<article>：正文评论单独成组 —— 引文、节号与节 id、源文件行、线程；画布标注照列', async (t) => {
  const made = makeArticleWithComments(t);
  const rec = recorder();
  const code = await runComments(['comments', 't-proj/notes', '--registry', made.registry], { ...rec.io, env: made.env });
  assert.equal(code, 0, rec.err.join('\n'));
  const text = rec.out.join('\n');
  assert.ok(text.startsWith('# t-proj/notes · 标注队列（open）\n共 2 条（全量 2） · open 2 · check 0 · done 0 · close 0'), text);
  assert.ok(text.includes(`文章：/t-proj/notes/ · ${made.file}`), text);
  // 文章就是一个画布页（M1-E 的 resolvePageTarget 命中 kind article），画布标注按帧分组照列，
  // 正文评论另起一组；不再走“只有正文评论”的无板分支。
  assert.ok(text.includes('## x\n[#1] 画布上的意见 · 普通 · open · @canvas'), text);
  assert.ok(!text.includes('这篇文章还没有编译的画布帧'), text);
  assert.ok(text.includes('## 正文评论 · 评论固件（/t-proj/notes/）'), text);
  assert.ok(text.includes('[#2] “收款方”写全称 · 正文评论 · open · 节 §1 how'), text);
  assert.ok(text.includes('  引文：「确认卡写清收款方」'), text);
  assert.ok(text.includes(`  源文件：${made.file}:7`), text);
  assert.match(text, /  agent（10-13 \d\d:00）：改成了全称/);
  assert.ok(text.includes('[#1] 画布上的意见'), text);

  // check 只做验证：同一个目标不列标注队列。
  const validate = recorder();
  assert.equal(await runCheck(['check', 't-proj_notes', '--registry', made.registry], { ...validate.io, env: made.env }), 0, validate.err.join('\n'));
  assert.deepEqual(validate.out, ['check t-proj/notes', '通过：0 个错误 · 0 个警告 · 0 条提示（查了 1 篇文章、0 帧）']);
  assert.deepEqual(validate.err, []);

  const json = recorder();
  assert.equal(await runComments(['comments', 't-proj_notes', '--registry', made.registry, '--json'], { ...json.io, env: made.env }), 0);
  const report = JSON.parse(json.out.join('\n'));
  const prose = report.groups.find((group) => group.kind === 'prose');
  assert.deepEqual(
    [prose.rows[0].n, prose.rows[0].quote, prose.rows[0].section, prose.rows[0].line, prose.rows[0].messages.map((m) => m.who)],
    [2, '确认卡写清收款方', 'how', 7, ['agent']],
  );
  assert.equal(report.counts.total, 2);
  assert.equal(report.article.url, '/t-proj/notes/');

  // 没有的文章：说清是哪一层没有，并列出这个 project 的文章。
  const miss = recorder();
  assert.equal(await runComments(['comments', 't-proj/ghost', '--registry', made.registry], { ...miss.io, env: made.env }), 2);
  assert.ok(miss.err.includes('错误：找不到文章 t-proj/ghost：project t-proj 里没有 articles/ghost/index.mdx'), miss.err.join('\n'));
  assert.ok(miss.err.includes('  t-proj/notes'), miss.err.join('\n'));
});

test('quoteSourceLine：逐字命中给行号；重复出现按前后文与节挑；夹了 markdown 记号退到前 12 个字符；都没有是 0', async () => {
  const { quoteSourceLine } = await import('../src/server/lib/ann-query.js');
  const src = 'a\n用户始终知道钱什么时候会被扣、扣给谁。\n确认卡写清**收款方**。';
  assert.equal(quoteSourceLine(src, '扣给谁'), 2);
  assert.equal(quoteSourceLine(src, '用户始终知道钱什么时候会被扣、扣给谁，并且最后一下由他自己点'), 2);
  assert.equal(quoteSourceLine(src, '确认卡写清收款方'), 0);
  assert.equal(quoteSourceLine(null, 'x'), 0);
  const twice = ['<Section id="why">', '确认卡写清收款方。', '</Section>', '<Section id="how">', 'agent 先停下，确认卡写清收款方。', '</Section>'].join('\n');
  assert.equal(quoteSourceLine(twice, { exact: '确认卡写清收款方', prefix: '先停下，', suffix: '。' }), 5);
  assert.equal(quoteSourceLine(twice, { exact: '确认卡写清收款方' }, 'how'), 5);
  assert.equal(quoteSourceLine(twice, { exact: '确认卡写清收款方' }), 2);
});

test('reply：正文评论追加 agent 消息走回复端点（带 baseRevision），不碰状态；画布标注、空回复、服务不在都拒绝', async (t) => {
  const made = makeArticleWithComments(t);
  const calls = [];
  const requestFn = async (urlString, opts = {}) => {
    calls.push({ url: urlString, method: opts.method || 'GET', body: opts.body });
    if (urlString.endsWith('/health')) return { status: 200, json: { ok: true } };
    if (opts.method === 'POST') return { status: 200, json: { revision: 3, annotation: { status: 'open' } } };
    return { status: 200, json: { revision: 2, annotations: [] } };
  };
  const ok = recorder();
  assert.equal(await runReply(['reply', 't-proj_notes', '#2', '改好了，见', 'B4', '--registry', made.registry], { ...ok.io, env: made.env, requestFn }), 0, ok.err.join('\n'));
  assert.deepEqual(ok.out, ['#2 ← agent：改好了，见 B4（状态仍是 open）']);
  const post = calls.find((call) => call.method === 'POST');
  assert.equal(post.url, 'http://127.0.0.1:1/annotations/%40prose/2/reply');
  assert.deepEqual(post.body, { entry: 't-proj_notes', baseRevision: 2, text: '改好了，见 B4' });

  // 跨页引用 <project>_<article>#n：基页是 registry 第一个页（t-page），评论在文章桶里。
  const cross = recorder();
  calls.length = 0;
  assert.equal(await runReply(['reply', 't-proj_notes#2', '再看一下', '--registry', made.registry], { ...cross.io, env: made.env, requestFn }), 0, cross.err.join('\n'));
  const crossPost = calls.find((call) => call.method === 'POST');
  assert.equal(crossPost.url, 'http://127.0.0.1:1/annotations/%40prose/2/reply');
  assert.equal(crossPost.body.entry, 't-proj_notes');

  // 画布标注也有线程：reply 照样走回复端点。
  const canvas = recorder();
  calls.length = 0;
  assert.equal(await runReply(['reply', 't-proj_notes', '#1', '改好了', '--registry', made.registry], { ...canvas.io, env: made.env, requestFn }), 0, canvas.err.join('\n'));
  assert.equal(calls.find((call) => call.method === 'POST').url, 'http://127.0.0.1:1/annotations/%40canvas/1/reply');

  assert.throws(() => parseArgs(['reply', '#2']), /reply 需要引用与回复内容/);
  assert.deepEqual(parseArgs(['reply', 'p_a', '#2', 'a', 'b']), { command: 'reply', target: 'p_a', refs: ['#2'], text: 'a b', flags: {} });
  assert.throws(() => parseArgs(['reply', '#2', 'a', 'b', '--page', 'p_a']), /未知选项：--page/);
  const blank = recorder();
  assert.equal(await runReply(['reply', 't-proj_notes', '#2', '  ', '--registry', made.registry], { ...blank.io, env: made.env, requestFn }), 2);
  assert.ok(blank.err.some((line) => line.includes('回复内容是空的')));

  const down = recorder();
  assert.equal(await runReply(['reply', 't-proj_notes', '#2', 'x', '--registry', made.registry], { ...down.io, env: made.env, requestFn: offline }), 1);
  assert.ok(down.err.some((line) => line.includes('reply 走服务端点')), down.err.join('\n'));
});

test('mark / locate 在文章页上作用于正文评论：状态端点走 @prose 账本；locate 落到文章源文件的行', async (t) => {
  const made = makeArticleWithComments(t);
  const calls = [];
  const requestFn = async (urlString, opts = {}) => {
    calls.push({ url: urlString, method: opts.method || 'GET', body: opts.body });
    if (opts.method === 'POST') return { status: 200, json: { revision: 3, annotation: { status: 'check' } } };
    return { status: 200, json: { revision: 2, annotations: [] } };
  };
  const mk = recorder();
  assert.equal(await runMark(['mark', 't-proj_notes', '#2', 'check', '--registry', made.registry], { ...mk.io, env: made.env, requestFn }), 0, mk.err.join('\n'));
  assert.deepEqual(mk.out, ['#2 → check']);
  const post = calls.find((call) => call.method === 'POST');
  assert.equal(post.url, 'http://127.0.0.1:1/annotations/%40prose/2/status');
  assert.equal(post.body.entry, 't-proj_notes');

  const loc = recorder();
  assert.equal(await runLocate(['locate', 't-proj_notes', '#2', '--registry', made.registry], { ...loc.io, env: made.env }), 0, loc.err.join('\n'));
  assert.deepEqual(loc.out, [`#2 → ${made.file}:7（正文评论，节 how）`]);
});

/* ---- pp3：rename / remove / prune / 孤儿 对文章桶 ---- */

/** project `demo`（两篇文章 alpha、beta）+ 两个文章桶（各一本 @canvas、alpha 另有 @prose）
    + 一个已删文章的桶 demo_gone + alpha 的 dist / shot 缓存。 */
function makeProjectWithBuckets(t) {
  const dir = withTempDir(t);
  const root = path.join(dir, 'proj');
  const content = path.join(root, 'docs', 'pinpoint');
  for (const id of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(content, 'articles', id), { recursive: true });
    fs.writeFileSync(path.join(content, 'articles', id, 'index.mdx'), `---\ntitle: ${id}\n---\n\n<Section id="s" title="S">\n\n正文 ${id}。\n\n</Section>\n`);
  }
  fs.writeFileSync(path.join(content, 'articles', 'alpha', 'hero.jsx'), "export default () => <img src=\"/sites/demo_alpha/assets/a.png\" />;\n");
  fs.writeFileSync(path.join(content, 'project.json'), JSON.stringify({ id: 'demo', title: 'Demo' }));
  const registry = registryWith(dir, [
    { id: 'pinpoint', kind: 'dir', path: makeSite(dir, 'pp') },
    { id: 'demo', title: 'Demo', kind: 'project', path: root },
  ]);
  const data = path.join(dir, 'data');
  const ledger = (pageId, name, doc) => {
    fs.mkdirSync(path.join(data, pageId), { recursive: true });
    fs.writeFileSync(path.join(data, pageId, name), JSON.stringify(doc));
  };
  for (const [pageId, n] of [['demo_alpha', 1], ['demo_beta', 1], ['demo_gone', 4]]) {
    ledger(pageId, '@canvas.json', { page: '@canvas', path: '@canvas', revision: 1, annotations: [{ id: `${pageId}-c`, n, status: 'open', content: `画布 ${pageId}`, pageId, screenId: 'x' }] });
  }
  ledger('demo_alpha', '@prose.json', { page: '@prose', path: '/demo/alpha/', revision: 1, annotations: [{ id: 'p', n: 2, type: 'prose', status: 'open', content: '正文评论', section: 's', quote: { exact: '正文 alpha' } }] });
  fs.mkdirSync(path.join(data, 'dist', 'demo_alpha'), { recursive: true });
  fs.writeFileSync(path.join(data, 'dist', 'demo_alpha', 'x.html'), '<script src="/sites/demo_alpha/x.js"></script>');
  fs.mkdirSync(path.join(data, 'shot', 'demo_alpha'), { recursive: true });
  fs.writeFileSync(path.join(data, 'shot', 'demo_alpha', 'x.png'), 'png');
  const env = { PINPOINT_DATA_DIR: data };
  return { dir, root, content, registry, data, env, io: (rec) => ({ ...rec.io, cwd: dir, env, requestFn: offline }) };
}

test('rename a project moves every <old>_<article> bucket, rewrites ledger addresses, refreshes caches, warns about hard-coded /sites/ paths', async (t) => {
  const made = makeProjectWithBuckets(t);
  const rec = recorder();
  assert.equal(await runMv(['mv', 'demo', 'demo2', '--registry', made.registry], made.io(rec)), 0, rec.err.join('\n'));
  for (const id of ['alpha', 'beta', 'gone']) {
    assert.ok(!fs.existsSync(path.join(made.data, `demo_${id}`)), `old bucket demo_${id} is gone`);
    assert.ok(fs.existsSync(path.join(made.data, `demo2_${id}`, '@canvas.json')), `new bucket demo2_${id}`);
  }
  const canvas = JSON.parse(fs.readFileSync(path.join(made.data, 'demo2_alpha', '@canvas.json'), 'utf8'));
  assert.equal(canvas.annotations[0].pageId, 'demo2_alpha');
  assert.equal(JSON.parse(fs.readFileSync(path.join(made.data, 'demo2_alpha', '@prose.json'), 'utf8')).path, '/demo2/alpha/');
  assert.ok(rec.out.includes(`  文章桶：${path.join(made.data, 'demo_alpha')} → ${path.join(made.data, 'demo2_alpha')}（账本改写：@canvas.json、@prose.json）`), rec.out.join('\n'));
  assert.ok(fs.existsSync(path.join(made.data, 'shot', 'demo2_alpha', 'x.png')), 'shot cache moves');
  assert.ok(!fs.existsSync(path.join(made.data, 'dist', 'demo_alpha')), 'stale dist is dropped');
  assert.ok(rec.out.some((line) => line.startsWith('  画布 demo2_alpha：已重编')), rec.out.join('\n'));
  assert.ok(fs.existsSync(path.join(made.data, 'dist', 'demo2_alpha')), 'dist rebuilt under the new page id');
  assert.ok(!rec.out.some((line) => line.includes(`${path.join(made.data, 'demo')} 不存在`)), 'the project id itself is not a bucket');
  assert.ok(rec.err.includes(`    ${path.join(made.content, 'articles', 'alpha', 'hero.jsx')}`), rec.err.join('\n'));
  assert.match(fs.readFileSync(path.join(made.content, 'articles', 'alpha', 'hero.jsx'), 'utf8'), /\/sites\/demo_alpha\//, 'author files are not rewritten');

  // 搬过去的文章桶照常是活页：comments 读得到画布标注与正文评论。
  const check = recorder();
  assert.equal(await runComments(['comments', 'demo2_alpha', '--registry', made.registry, '--status', 'all', '--json'], { ...check.io, env: made.env }), 0, check.err.join('\n'));
  assert.equal(JSON.parse(check.out.join('\n')).counts.total, 2);
});

test('rename a project: a cache move that fails only warns and names what stayed behind; buckets and project.json still finish (xreview L)', async (t) => {
  const made = makeProjectWithBuckets(t);
  const shot = path.join(made.data, 'shot');
  const rec = recorder();
  fs.chmodSync(shot, 0o555); // shot/ 不可写：shot/demo_alpha 搬不动
  let code;
  try {
    code = await runMv(['mv', 'demo', 'demo2', '--registry', made.registry], made.io(rec));
  } finally {
    fs.chmodSync(shot, 0o755); // 先恢复，临时目录才删得掉
  }
  assert.equal(code, 0, rec.err.join('\n'));
  assert.ok(rec.err.some((line) => line.includes(`shot/demo_alpha`) && line.includes('没搬')), rec.err.join('\n'));
  assert.ok(fs.existsSync(path.join(shot, 'demo_alpha', 'x.png')), 'the cache stays under the old id');
  for (const id of ['alpha', 'beta', 'gone']) assert.ok(fs.existsSync(path.join(made.data, `demo2_${id}`, '@canvas.json')), `bucket demo2_${id} moved`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(made.content, 'project.json'), 'utf8')).id, 'demo2');
});

test('rename a project refuses up front when any target article bucket exists', async (t) => {
  const made = makeProjectWithBuckets(t);
  fs.mkdirSync(path.join(made.data, 'demo2_beta'), { recursive: true });
  const before = fs.readFileSync(made.registry, 'utf8');
  const rec = recorder();
  assert.equal(await runMv(['mv', 'demo', 'demo2', '--registry', made.registry], made.io(rec)), 1);
  assert.match(rec.err.join('\n'), new RegExp(`文章桶的目标已存在：${path.join(made.data, 'demo2_beta').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(fs.readFileSync(made.registry, 'utf8'), before, 'registry untouched');
  assert.ok(fs.existsSync(path.join(made.data, 'demo_alpha', '@canvas.json')), 'no bucket moved');
  assert.equal(JSON.parse(fs.readFileSync(path.join(made.content, 'project.json'), 'utf8')).id, 'demo');
});

test('remove a project: article buckets follow the bucket rule (rows refuse, empty buckets go)', async (t) => {
  const made = makeProjectWithBuckets(t);
  const busy = recorder();
  assert.equal(await runRemove(['remove', 'demo', '--registry', made.registry], made.io(busy)), 1);
  assert.match(busy.err.join('\n'), /文章桶里还有标注：demo_alpha（2 行）、demo_beta（1 行）、demo_gone（1 行）/);
  for (const id of ['alpha', 'beta', 'gone']) {
    fs.writeFileSync(path.join(made.data, `demo_${id}`, '@canvas.json'), JSON.stringify({ page: '@canvas', annotations: [] }));
  }
  fs.rmSync(path.join(made.data, 'demo_alpha', '@prose.json'));
  const rec = recorder();
  assert.equal(await runRemove(['remove', 'demo', '--registry', made.registry], made.io(rec)), 0, rec.err.join('\n'));
  for (const id of ['alpha', 'beta', 'gone']) assert.ok(!fs.existsSync(path.join(made.data, `demo_${id}`)), `empty bucket demo_${id} removed`);
});

test('live article: prune clears ledgers of HTML frames that are gone, keeps live frames and fixed ledgers; comments counts only live rows (D)', async (t) => {
  const made = makeProjectWithBuckets(t);
  const article = path.join(made.content, 'articles', 'alpha');
  fs.writeFileSync(path.join(article, 'index.mdx'), '---\ntitle: alpha\n---\n\n<Section id="s" title="S">\n\n正文 alpha。\n\n<Canvas frames={["page"]} />\n\n</Section>\n');
  fs.writeFileSync(path.join(article, 'page.html'), '<!doctype html><p>page</p>');
  const ledger = (name, docPath, n, content) => fs.writeFileSync(path.join(made.data, 'demo_alpha', name), JSON.stringify({
    page: name.replace(/\.json$/, ''), path: docPath, revision: 1,
    annotations: [{ id: `r${n}`, n, type: 'element', status: 'open', content }],
  }));
  ledger('page.html_a1.json', '/sites/demo_alpha/page.html', 5, '活帧上的标注');
  ledger('removed.html_b2.json', '/sites/demo_alpha/removed.html', 6, '删掉的帧上的标注');
  const dry = recorder();
  assert.equal(await runPrune(['prune', 'demo/alpha', '--dry-run', '--registry', made.registry], { ...dry.io, env: made.env }), 0, dry.err.join('\n'));
  assert.deepEqual(dry.out, [path.join(made.data, 'demo_alpha', 'removed.html_b2.json'), '--dry-run：1 本孤儿账本待删（ppnt prune demo_alpha 落盘）。']);
  const comments = recorder();
  assert.equal(await runComments(['comments', 'demo/alpha', '--registry', made.registry], { ...comments.io, env: made.env }), 0, comments.err.join('\n'));
  assert.ok(comments.out.some((line) => /^共 \d+ 条（全量 3）/.test(line)), comments.out.join('\n'));
  assert.ok(comments.out.some((line) => line.startsWith('## 孤儿标注')), comments.out.join('\n'));
  const real = recorder();
  assert.equal(await runPrune(['prune', 'demo/alpha', '--registry', made.registry], { ...real.io, env: made.env }), 0, real.err.join('\n'));
  assert.deepEqual(fs.readdirSync(path.join(made.data, 'demo_alpha')).sort(), ['@canvas.json', '@prose.json', 'page.html_a1.json']);
});

test('article buckets as orphans: prune on a live article lists nothing; a deleted article is a whole-bucket orphan in comments / prune, and check says the article is gone', async (t) => {
  const made = makeProjectWithBuckets(t);
  const live = recorder();
  assert.equal(await runPrune(['prune', 'demo_alpha', '--dry-run', '--registry', made.registry], { ...live.io, env: made.env }), 0, live.err.join('\n'));
  assert.deepEqual(live.out, ['页 demo_alpha 没有孤儿账本。']);
  const liveReal = recorder();
  assert.equal(await runPrune(['prune', 'demo_alpha', '--registry', made.registry], { ...liveReal.io, env: made.env }), 0);
  assert.ok(fs.existsSync(path.join(made.data, 'demo_alpha', '@canvas.json')) && fs.existsSync(path.join(made.data, 'demo_alpha', '@prose.json')), 'live ledgers survive prune');

  // 文章目录改名（beta → beta2）：旧页 id 不再是页，整桶皆孤儿。
  fs.renameSync(path.join(made.content, 'articles', 'beta'), path.join(made.content, 'articles', 'beta2'));
  for (const pageId of ['demo_gone', 'demo_beta']) {
    const status = recorder();
    assert.equal(await runComments(['comments', pageId, '--registry', made.registry], { ...status.io, env: made.env }), 0, status.err.join('\n'));
    assert.equal(status.out[0], `${pageId.replace('_', '/')} 不在 registry 与本地页面清单里（文章删了、改名了，或页不在了）；桶里 1 本账本全是孤儿：`);
    const check = recorder();
    // check 只验证：文章不在了就是找不到目标，退 2 并列这个 project 的文章。
    assert.equal(await runCheck(['check', pageId, '--registry', made.registry], { ...check.io, env: made.env }), 2);
    assert.deepEqual(check.out, []);
    assert.equal(check.err[0], `错误：找不到文章 ${pageId.replace('_', '/')}：project demo 里没有 articles/${pageId.split('_')[1]}/index.mdx`);
  }
  const dry = recorder();
  assert.equal(await runPrune(['prune', 'demo_gone', '--dry-run', '--registry', made.registry], { ...dry.io, env: made.env }), 0);
  assert.deepEqual(dry.out, [`${path.join(made.data, 'demo_gone', '@canvas.json')}（页已不存在，整桶孤儿）`, '--dry-run：1 本孤儿账本待删（ppnt prune demo_gone 落盘）。']);
});

test('prune 整桶孤儿连桶目录一起删（_seq.json、图片也走），迟到的写不会把它当成还在的桶（O）', async (t) => {
  const made = makeProjectWithBuckets(t);
  const bucket = path.join(made.data, 'demo_gone');
  fs.writeFileSync(path.join(bucket, '_seq.json'), JSON.stringify({ next: 5 }));
  fs.mkdirSync(path.join(bucket, 'images'));
  fs.writeFileSync(path.join(bucket, 'images', '@canvas-1-1.png'), 'png');
  const rec = recorder();
  assert.equal(await runPrune(['prune', 'demo/gone', '--registry', made.registry], { ...rec.io, env: made.env }), 0, rec.err.join('\n'));
  assert.ok(!fs.existsSync(bucket), rec.out.join('\n'));
  assert.ok(rec.out.some((line) => line.includes('桶目录也删了')), rec.out.join('\n'));
  // 活页的 prune 只删孤儿账本，桶留着。
  assert.equal(await runPrune(['prune', 'demo/alpha', '--registry', made.registry], { ...recorder().io, env: made.env }), 0);
  assert.ok(fs.existsSync(path.join(made.data, 'demo_alpha', '@canvas.json')));
});

test('<project>_<article>#n resolves without a separate target in locate / mark / reply / comments', async (t) => {
  const made = makeArticleWithComments(t);
  const loc = recorder();
  assert.equal(await runLocate(['locate', 't-proj_notes#2', '--registry', made.registry], { ...loc.io, env: made.env }), 0, loc.err.join('\n'));
  assert.deepEqual(loc.out, [`#2 → ${made.file}:7（正文评论，节 how）`]);
  // 基页是别的页时，跨页行按它自己的页上下文定位。
  const other = recorder();
  assert.equal(await runLocate(['locate', 't-page', 't-proj_notes#2', '--registry', made.registry], { ...other.io, env: made.env }), 0, other.err.join('\n'));
  assert.deepEqual(other.out, loc.out);

  const calls = [];
  const requestFn = async (urlString, opts = {}) => {
    calls.push({ url: urlString, method: opts.method || 'GET', body: opts.body });
    if (opts.method === 'POST') return { status: 200, json: { revision: 3, annotation: { status: 'open' } } };
    return { status: 200, json: { revision: 2, annotations: [] } };
  };
  const mk = recorder();
  assert.equal(await runMark(['mark', 't-proj_notes#1', 'check', '--registry', made.registry], { ...mk.io, env: made.env, requestFn }), 0, mk.err.join('\n'));
  assert.deepEqual(calls.find((call) => call.method === 'POST').body.entry, 't-proj_notes');
  calls.length = 0;
  const rp = recorder();
  assert.equal(await runReply(['reply', 't-proj_notes#2', '好', '--registry', made.registry], { ...rp.io, env: made.env, requestFn }), 0, rp.err.join('\n'));
  assert.equal(calls.find((call) => call.method === 'POST').url, 'http://127.0.0.1:1/annotations/%40prose/2/reply');

  const ck = recorder();
  assert.equal(await runComments(['comments', 't-proj_notes#2', '--registry', made.registry, '--json'], { ...ck.io, env: made.env }), 0, ck.err.join('\n'));
  const report = JSON.parse(ck.out.join('\n'));
  assert.equal(report.counts.total, 1);
  assert.equal(report.groups.find((group) => group.kind === 'prose').rows[0].n, 2);
  const miss = recorder();
  assert.equal(await runComments(['comments', 't-proj_notes#9', '--registry', made.registry], { ...miss.io, env: made.env }), 1);
  assert.ok(miss.err.includes('错误：t-proj/notes 没有 #9'), miss.err.join('\n'));
});

/* ---- pp3：CLI 说文章模型 ---- */

import { planArticleShots } from './pinpoint-cli.js';

/** e2e/project-site 复制一份（要改正文的用例在副本上改）+ 桶里一条画布标注（B1）一条正文评论（§1）。 */
function makeFixtureCopy(t) {
  const dir = withTempDir(t);
  const root = path.join(dir, 'proj');
  fs.cpSync(FIXTURE_PROJECT, root, { recursive: true });
  const legacy = makeSite(dir, 'legacy');
  const registry = registryWith(dir, [
    { id: 'legacy', kind: 'dir', path: legacy },
    { id: 'e2e-project', kind: 'project', path: root },
  ]);
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data'), PINPOINT_ORIGIN: 'http://127.0.0.1:1' };
  const bucket = path.join(env.PINPOINT_DATA_DIR, 'e2e-project_commit-confirm');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, '@canvas.json'), JSON.stringify({ page: '@canvas', path: '@canvas', revision: 1, annotations: [
    { id: 'c1', n: 1, type: 'element', status: 'open', content: '按钮改大', pageId: 'e2e-project_commit-confirm', screenId: 'confirm-sheet', targets: [] },
  ] }));
  fs.writeFileSync(path.join(bucket, '@prose.json'), JSON.stringify({ page: '@prose', path: '/e2e-project/commit-confirm/', revision: 1, annotations: [
    { id: 'p1', n: 2, type: 'prose', status: 'open', content: '说清楚', section: 'why', quote: { exact: 'agent 不替用户拍板' }, messages: [] },
  ] }));
  const article = path.join(root, 'docs', 'pinpoint', 'articles', 'commit-confirm');
  return { dir, root, registry, env, article, file: path.join(article, 'index.mdx') };
}

const withRegistry = (made, ...args) => [...args, '--registry', made.registry];

test('缺目标不再猜 registry 第一页：locate / mark / shot / reply 都报错退 2 并列候选', async (t) => {
  const made = makeFixtureCopy(t);
  for (const argv of [['locate', '#1'], ['mark', '#1', 'done'], ['shot', 'B1'], ['shot', '--figure', 'message-flow'], ['reply', '#2', '好']]) {
    const rec = recorder();
    assert.equal(await run(withRegistry(made, ...argv), { ...rec.io, env: made.env }), 2, argv.join(' '));
    assert.match(rec.err[0], new RegExp(`^错误：${argv[0]} 缺目标`), rec.err.join('\n'));
    assert.ok(rec.err.includes('  e2e-project/commit-confirm'), rec.err.join('\n'));
    assert.ok(rec.err.includes('  legacy  （存量页）'), rec.err.join('\n'));
    assert.deepEqual(rec.out, []);
  }
  // project 不是目标：说清要写哪篇文章，只列这个 project 的文章。
  const project = recorder();
  assert.equal(await run(withRegistry(made, 'locate', 'e2e-project', '#1'), { ...project.io, env: made.env }), 2);
  assert.deepEqual(project.err.slice(0, 2), ['错误：e2e-project 是 project；标注和评论在文章里，写 e2e-project/<article>。', 'e2e-project 的文章：']);
});

test('@frame:<页 id>/<帧 id> 自带页：不写目标时它就是目标；和目标不是一页时说清楚', async (t) => {
  // 从前缺目标时取 registry 第一页，@frame 里的页被丢掉，报“图纸上没有帧”（TODO 里那条）。
  const made = makeFixtureCopy(t);
  const frame = '@frame:e2e-project_commit-confirm/confirm-sheet';
  const loc = recorder();
  assert.equal(await run(withRegistry(made, 'locate', frame), { ...loc.io, env: made.env }), 0, loc.err.join('\n'));
  assert.match(loc.out[0], /^#1 /, loc.out.join('\n'));
  // shot 也从 @frame 取目标，一直走到渲染（测试里服务不在跑）。
  const shot = recorder();
  assert.equal(await run(withRegistry(made, 'shot', frame), { ...shot.io, env: made.env }), 1);
  assert.ok(!shot.err.some((line) => /缺目标|没有帧/.test(line)), shot.err.join('\n'));
  assert.match(shot.err.join('\n'), /截图要 pinpoint 服务在跑/);
  // 目标写了别的页：说出 @frame 指的是哪一页，不报“画布上没有帧”。
  const other = recorder();
  assert.equal(await run(withRegistry(made, 'shot', 'legacy', frame), { ...other.io, env: made.env }), 1);
  assert.ok(other.err.includes(`${frame} 是 e2e-project/commit-confirm 上的帧，这次的目标是 legacy：目标写 e2e-project/commit-confirm，或不写目标、只写 ${frame}`), other.err.join('\n'));
});

test('目标是第一个参数：斜杠形、网址、页 id、@page:、<project>/<article>#n、@section: 指同一篇；输出打斜杠形', async (t) => {
  const made = makeFixtureCopy(t);
  const expected = [`#2 → ${made.file}:15（正文评论，节 why）`];
  for (const argv of [
    ['locate', 'e2e-project/commit-confirm', '#2'],
    ['locate', 'http://127.0.0.1:1/e2e-project/commit-confirm/', '#2'],
    ['locate', 'e2e-project_commit-confirm', '#2'],
    ['locate', '@page:e2e-project_commit-confirm', '#2'],
    ['locate', 'e2e-project/commit-confirm#2'],
    ['locate', '@section:e2e-project_commit-confirm/why'],
    ['locate', 'e2e-project/commit-confirm', '@section:e2e-project_commit-confirm/why'],
    ['locate', 'e2e-project/commit-confirm', '§1'],
    ['locate', 'e2e-project/commit-confirm', 'why'],
  ]) {
    const rec = recorder();
    assert.equal(await run(withRegistry(made, ...argv), { ...rec.io, env: made.env }), 0, `${argv.join(' ')}\n${rec.err.join('\n')}`);
    assert.deepEqual(rec.out, expected, argv.join(' '));
  }
  const tooFar = recorder();
  assert.equal(await run(withRegistry(made, 'locate', 'e2e-project/commit-confirm', '§9'), { ...tooFar.io, env: made.env }), 1);
  assert.ok(tooFar.err.includes('错误：§9：这篇文章只有 4 节'), tooFar.err.join('\n'));

  const calls = [];
  const requestFn = async (urlString, opts = {}) => {
    calls.push({ url: urlString, method: opts.method || 'GET', body: opts.body });
    if (opts.method === 'POST') return { status: 200, json: { revision: 2, annotation: { status: 'open' } } };
    return { status: 200, json: { revision: 1, annotations: [] } };
  };
  const mk = recorder();
  assert.equal(await run(withRegistry(made, 'mark', 'e2e-project/commit-confirm', 'B1', 'done'), { ...mk.io, env: made.env, requestFn }), 0, mk.err.join('\n'));
  assert.deepEqual(mk.out, ['#1 → done']);
  assert.equal(calls.find((call) => call.method === 'POST').body.entry, 'e2e-project_commit-confirm');
  calls.length = 0;
  const rp = recorder();
  assert.equal(await run(withRegistry(made, 'reply', 'e2e-project/commit-confirm', '#2', '改好了'), { ...rp.io, env: made.env, requestFn }), 0, rp.err.join('\n'));
  assert.equal(calls.find((call) => call.method === 'POST').url, 'http://127.0.0.1:1/annotations/%40prose/2/reply');

  const st = recorder();
  assert.equal(await run(withRegistry(made, 'comments', 'e2e-project/commit-confirm'), { ...st.io, env: made.env }), 0, st.err.join('\n'));
  assert.equal(st.out[0], '# e2e-project/commit-confirm · 标注队列（open）');
  const viaIndicator = recorder();
  assert.equal(await run(withRegistry(made, 'comments', '@page:e2e-project_commit-confirm'), { ...viaIndicator.io, env: made.env }), 0, viaIndicator.err.join('\n'));
  assert.deepEqual(viaIndicator.out, st.out);
  const otherSection = recorder();
  assert.equal(await run(withRegistry(made, 'locate', 'e2e-project/commit-confirm', '@section:other_x/why'), { ...otherSection.io, env: made.env }), 1);
  assert.ok(otherSection.err.includes('错误：@section:other_x/why 是 other/x 上的节，这次的目标是 e2e-project/commit-confirm：目标写 other/x，或不写目标、只写 @section:other_x/why'), otherSection.err.join('\n'));
  const build = recorder();
  assert.equal(await run(withRegistry(made, 'build', 'e2e-project/commit-confirm', '--frame', 'card-plain'), { ...build.io, env: made.env }), 0, build.err.join('\n'));
  assert.match(build.out.at(-1), /^完成 e2e-project\/commit-confirm {2}共 [\d.]+ms（增量 1\/5 帧）$/);
  const render = recorder();
  assert.equal(await run(withRegistry(made, 'render', 'e2e-project/commit-confirm/card-plain'), { ...render.io, env: made.env }), 0, render.err.join('\n'));
  assert.match(render.out[0], /只读确认卡/);
});

test('show <project>/<article>：每节 §n · 字母 · 节 id · 帧 · open 数 · 网址，纯文字的节也列', async (t) => {
  const made = makeFixtureCopy(t);
  const rec = recorder();
  assert.equal(await runShow(withRegistry(made, 'show', 'e2e-project/commit-confirm'), { ...rec.io, env: made.env }), 0, rec.err.join('\n'));
  const text = rec.out.join('\n');
  assert.ok(text.startsWith('# e2e-project/commit-confirm · 提交前确认\n'), text);
  assert.ok(text.includes('画布视图：http://127.0.0.1:1/workbench/?page=e2e-project_commit-confirm'), text);
  assert.ok(text.includes('标注队列：open 2 · check 0 · done 0 · close 0（ppnt comments e2e-project/commit-confirm）'), text);
  assert.ok(text.includes('§1  A  why · 为什么要停下来 · 纯文字 · open 1\n      http://127.0.0.1:1/e2e-project/commit-confirm/#why'), text);
  assert.ok(text.includes('§2  B  confirm · 确认卡 · 2 帧 · open 1\n      B1   confirm-sheet  confirm-sheet.jsx\n      B2   confirm-done  confirm-done.jsx'), text);
  assert.ok(text.includes('http://127.0.0.1:1/e2e-project/commit-confirm/#confirm  ·  画布 http://127.0.0.1:1/workbench/?page=e2e-project_commit-confirm&section=confirm'), text);
  assert.ok(text.endsWith('布局错误：无'), text);

  const json = recorder();
  assert.equal(await runShow(withRegistry(made, 'show', 'e2e-project_commit-confirm', '--json'), { ...json.io, env: made.env }), 0);
  const model = JSON.parse(json.out.join('\n'));
  assert.deepEqual(model.sections.map((section) => `${section.n}${section.letter}:${section.id}:${section.frames.length}:${section.open}`), ['1A:why:0:1', '2B:confirm:2:1', '3C:variants:1:0', '4D:mixed:2:0']);

  // 写错 shell 的节不进画布：show 照样列出它和它的帧，并说明原因。
  fs.writeFileSync(made.file, fs.readFileSync(made.file, 'utf8').replace('shell="comp"', 'shell="phone"'));
  const broken = recorder();
  assert.equal(await runShow(withRegistry(made, 'show', 'e2e-project/commit-confirm'), { ...broken.io, env: made.env }), 0);
  assert.ok(broken.out.includes('§3  C  variants · 卡片做法 · 画布有错，不在画布视图上（1 帧） · open 0'), broken.out.join('\n'));
  assert.ok(broken.out.some((line) => /✗ articles\/commit-confirm\/index\.mdx：第 \d+ 行：.*shell 只能是/.test(line)), broken.out.join('\n'));
});

test('show <project>：文章（斜杠地址）、概念、空 ref、布局错误；存量页列帧；找不到退 2', async (t) => {
  const made = makeFixtureCopy(t);
  const rec = recorder();
  assert.equal(await runShow(withRegistry(made, 'show', 'e2e-project'), { ...rec.io, env: made.env }), 0, rec.err.join('\n'));
  assert.ok(rec.out.includes('  e2e-project/commit-confirm  ·  提交前确认  ·  4 节 · 5 帧 · open 2'), rec.out.join('\n'));
  assert.ok(rec.out.includes('  [[risk-score]] ← commit-confirm:9'), rec.out.join('\n'));
  assert.ok(rec.out.includes('  confirm-card  ·  收敛中  ·  只在不可撤销的动作之前出现'), rec.out.join('\n'));
  const missing = recorder();
  assert.equal(await runShow(withRegistry(made, 'show', 'e2e-project/ghost'), { ...missing.io, env: made.env }), 2);
  assert.equal(missing.err[0], '错误：找不到文章 e2e-project/ghost：project e2e-project 里没有 articles/ghost/index.mdx');
  const nothing = recorder();
  assert.equal(await runShow(withRegistry(made, 'show', 'zzz'), { ...nothing.io, env: made.env }), 2);
});

test('planArticleShots：不写引用截文章页；§n 截文章页那一节；编号留给画布；纯文字节的字母也截文章页', () => {
  const context = {
    pageId: 'p_a',
    address: 'p/a',
    article: { url: '/p/a/' },
    refs: { outline: [{ id: 'confirm', letter: 'B', frames: [{ id: 'f1', ref: 'B1' }] }] },
  };
  const outline = [
    { n: 1, letter: 'A', id: 'why', frames: [], canvas: false },
    { n: 2, letter: 'B', id: 'confirm', frames: ['f1'], canvas: true },
  ];
  const base = { context, outline, origin: 'http://o', dataRootDir: '/d', scale: 1, canvas: false };
  const none = planArticleShots([], base);
  assert.deepEqual(none.articleJobs, [{ kind: 'article', url: 'http://o/p/a/', scale: 1, label: 'p/a 文章页', out: '/d/shot/p_a/article.png' }]);
  assert.deepEqual(none.canvasTokens, []);
  const mixed = planArticleShots(['§2', 'B1', 'B', 'A', '§7'], base);
  assert.deepEqual(mixed.articleJobs.map((job) => [job.kind, job.sectionId, job.label, job.out]), [
    ['article-section', 'confirm', 'B（§2 confirm）文章页', '/d/shot/p_a/article-confirm.png'],
    ['article-section', 'why', 'A（§1 why）文章页', '/d/shot/p_a/article-why.png'],
  ]);
  assert.deepEqual(mixed.canvasTokens, ['B1', 'B']);
  assert.deepEqual(mixed.errors, ['§7：这篇文章只有 2 节']);
  assert.deepEqual(planArticleShots([], { ...base, canvas: true }).articleJobs, [], '--canvas 不截文章页');
});

test('check <project>[/<article>]：验证——布局、帧、正文渲染、空 ref；退出码 0 / 1 / 2；--json', async (t) => {
  const made = makeFixtureCopy(t);
  const clean = recorder();
  assert.equal(await runCheck(withRegistry(made, 'check', 'e2e-project'), { ...clean.io, env: made.env }), 0, clean.err.join('\n'));
  assert.equal(clean.out[0], 'check e2e-project');
  assert.ok(clean.out.some((line) => /^· .*index\.mdx:9 {2}提示 {2}empty_ref {2}空 ref \[\[risk-score\]\]/.test(line)), clean.out.join('\n'));
  assert.equal(clean.out.at(-1), '通过：0 个错误 · 0 个警告 · 1 条提示（查了 2 篇文章、5 帧、2 个图）');

  fs.writeFileSync(made.file, fs.readFileSync(made.file, 'utf8')
    .replace('<Canvas frames={["card-plain"]} shell="comp" />', '<Canvas frames={["card-plain", "lint-me"]} shell="phone" />\n\n<Foo />'));
  fs.writeFileSync(path.join(made.article, 'lint-me.jsx'), 'export default function F() {\n  return <div className="ios-app">{fetch("/x")}</div>;\n}\n');
  const bad = recorder();
  assert.equal(await runCheck(withRegistry(made, 'check', 'e2e-project/commit-confirm', '--json'), { ...bad.io, env: made.env }), 1);
  const report = JSON.parse(bad.out.join('\n'));
  assert.equal(report.target, 'e2e-project/commit-confirm');
  assert.equal(report.ok, false);
  assert.deepEqual(report.counts, { error: 3, warning: 0, info: 1 });
  assert.deepEqual(report.diagnostics.filter((row) => row.severity === 'error').map((row) => [row.code, path.basename(row.file), row.line]), [
    ['canvas_shell', 'index.mdx', 31],
    ['mdx_component_missing', 'index.mdx', 33],
    ['lint_fetch', 'lint-me.jsx', 2],
  ]);
  const text = recorder();
  assert.equal(await runCheck(withRegistry(made, 'check', 'e2e-project/commit-confirm'), { ...text.io, env: made.env, cwd: made.root }), 1);
  assert.ok(text.out.includes('✗ docs/pinpoint/articles/commit-confirm/lint-me.jsx:2  错误  lint_fetch  禁止 fetch（编译期渲染，没有数据请求）（节 variants · 帧 lint-me）'), text.out.join('\n'));
  assert.equal(text.out.at(-1), '没通过：3 个错误 · 0 个警告 · 1 条提示（查了 1 篇文章、6 帧、2 个图）');

  const usage = recorder();
  assert.equal(await runCheck(withRegistry(made, 'check', 'e2e-project/ghost'), { ...usage.io, env: made.env }), 2);
  const legacyPage = recorder();
  assert.equal(await runCheck(withRegistry(made, 'check', 'nothing-here'), { ...legacyPage.io, env: made.env }), 2);
  assert.equal(await runCheck(['check', 'e2e-project', '--bogus'], { ...recorder().io, env: made.env }), 2);
});

test('图：check 编正文里的图、诊断带 code / 文件 / 行 / figure；show <project> 列图的编译错误', async (t) => {
  const made = makeFixtureCopy(t);
  const figures = path.join(made.article, 'figures');
  fs.writeFileSync(path.join(figures, 'wait-sequence.jsx'), fs.readFileSync(path.join(figures, 'wait-sequence.jsx'), 'utf8')
    .replace("  const w = textWidth(name, 13) + 28;", "  const w = textWidth(name, 13) + 28 + fetch('/x');"));
  fs.writeFileSync(path.join(figures, 'message-flow.js'), 'export default function mount(root) {\n  return (;\n}\n');
  const rec = recorder();
  assert.equal(await runCheck(withRegistry(made, 'check', 'e2e-project/commit-confirm', '--json'), { ...rec.io, env: made.env }), 1);
  const report = JSON.parse(rec.out.join('\n'));
  assert.equal(report.figures, 2);
  assert.deepEqual(report.diagnostics.filter((row) => row.severity === 'error').map((row) => [row.code, path.basename(row.file), row.line, row.figure, row.section || null]), [
    ['compile', 'message-flow.js', 2, 'message-flow', 'why'],
    ['lint_fetch', 'wait-sequence.jsx', 5, 'wait-sequence', null],
  ]);
  const text = recorder();
  assert.equal(await runCheck(withRegistry(made, 'check', 'e2e-project/commit-confirm'), { ...text.io, env: made.env, cwd: made.root }), 1);
  assert.ok(text.out.some((line) => line.startsWith('✗ docs/pinpoint/articles/commit-confirm/figures/wait-sequence.jsx:5  错误  lint_fetch  ') && line.endsWith('（图 wait-sequence）')), text.out.join('\n'));
  // show <project>（= list <project>）把过期的图重编，编译错误进布局错误，退 1。
  const show = recorder();
  assert.equal(await runShow(withRegistry(made, 'show', 'e2e-project', '--json'), { ...show.io, env: made.env }), 1);
  const model = JSON.parse(show.out.join('\n'));
  assert.deepEqual(model.errors.filter((error) => error.code === 'figure_compile').map((error) => error.figure).sort(), ['message-flow', 'wait-sequence']);
});

test('shot --figure：目标照 shot 的规则（第一个参数），不和引用同用，存量页没有图', async (t) => {
  const made = makeFixtureCopy(t);
  // 目标解析过了才去找服务：服务没在跑就报服务那一句，退 1。
  for (const argv of [
    ['shot', 'e2e-project/commit-confirm', '--figure', 'message-flow'],
    ['shot', 'e2e-project_commit-confirm', '--figure', 'message-flow'],
  ]) {
    const rec = recorder();
    assert.equal(await run(withRegistry(made, ...argv), { ...rec.io, env: made.env }), 1, argv.join(' '));
    assert.match(rec.err.join('\n'), /截图要 pinpoint 服务在跑：PINPOINT_ORIGIN=http:\/\/127\.0\.0\.1:1/, argv.join(' '));
  }
  const mixed = recorder();
  assert.equal(await run(withRegistry(made, 'shot', 'e2e-project/commit-confirm', 'B1', '--figure', 'message-flow'), { ...mixed.io, env: made.env }), 2);
  assert.match(mixed.err[0], /--figure 只拍一个图，不和引用（B1）一起用/);
  const legacy = recorder();
  assert.equal(await run(withRegistry(made, 'shot', 'legacy', '--figure', 'x'), { ...legacy.io, env: made.env }), 2);
  assert.match(legacy.err[0], /legacy 是存量页，没有正文里的图/);
  const help = recorder();
  assert.equal(await run(['shot', '--help'], help.io), 0);
  assert.ok(help.out.join('\n').includes('--figure <图 id>'), help.out.join('\n'));
});

test('check 只验证：--status 是用法错、<目标>#n 不列标注；comments 先编 dist 再列', async (t) => {
  const made = makeFixtureCopy(t);
  const viaFlag = recorder();
  assert.equal(await runCheck(withRegistry(made, 'check', 'e2e-project/commit-confirm', '--status', 'all'), { ...viaFlag.io, env: made.env }), 2);
  assert.equal(viaFlag.err[0], '错误：选项 --status 不适用于 check');
  assert.deepEqual(viaFlag.out, []);
  // 没有 dist：先编再摘录（stderr 一行），不再要求先 ppnt build。
  const comments = recorder();
  assert.equal(await runComments(withRegistry(made, 'comments', 'e2e-project/commit-confirm', '--status', 'all'), { ...comments.io, env: made.env }), 0);
  assert.deepEqual(comments.err, ['dist 不在或落后于源码，先编了 e2e-project/commit-confirm（5 帧）']);
  const checkOne = recorder();
  assert.equal(await runCheck(withRegistry(made, 'check', 'e2e-project/commit-confirm#2'), { ...checkOne.io, env: made.env }), 0, checkOne.err.join('\n'));
  assert.equal(checkOne.out[0], 'check e2e-project/commit-confirm');
  assert.ok(!checkOne.out.some((line) => line.includes('[#2]')), checkOne.out.join('\n'));
  const one = recorder();
  assert.equal(await runComments(withRegistry(made, 'comments', 'e2e-project/commit-confirm#2'), { ...one.io, env: made.env }), 0);
  assert.ok(one.out.includes('[#2] 说清楚 · 正文评论 · open · 节 §1 why'), one.out.join('\n'));
});

test('comments <project>：逐篇列出有条目的文章，最后一行汇总；--frame 要指定文章', async (t) => {
  const made = makeFixtureCopy(t);
  const rec = recorder();
  assert.equal(await runComments(withRegistry(made, 'comments', 'e2e-project'), { ...rec.io, env: made.env }), 0, rec.err.join('\n'));
  assert.equal(rec.out[0], '# e2e-project/commit-confirm · 标注队列（open）');
  assert.equal(rec.out.filter((line) => line.startsWith('# ')).length, 1, '没有条目的 takeover 不出');
  assert.equal(rec.out.at(-1), 'project e2e-project：2 篇文章，1 篇有 open 的条目');
  const json = recorder();
  assert.equal(await runComments(withRegistry(made, 'comments', 'e2e-project', '--json'), { ...json.io, env: made.env }), 0);
  const parsed = JSON.parse(json.out.join('\n'));
  assert.deepEqual(parsed.articles.map((report) => [report.address, report.counts.total]), [['e2e-project/commit-confirm', 2], ['e2e-project/takeover', 0]]);
  const frame = recorder();
  assert.equal(await runComments(withRegistry(made, 'comments', 'e2e-project', '--frame', 'B1'), { ...frame.io, env: made.env }), 2);
  const oneFrame = recorder();
  assert.equal(await runComments(withRegistry(made, 'comments', 'e2e-project/commit-confirm', '--frame', 'B1'), { ...oneFrame.io, env: made.env }), 0);
  assert.ok(oneFrame.out.includes('[#1] 按钮改大 · 普通 · open · @canvas'), oneFrame.out.join('\n'));
});

test('每个命令有自己的短帮助；用错选项只打一行错误 + 用法行 + 去哪看，不刷整份帮助', async () => {
  const help = recorder();
  assert.equal(await run(['shot', '--help'], help.io), 0);
  assert.match(help.out[0], /^用法：ppnt shot <目标> \[引用…\] \[选项\]/);
  assert.equal(help.out.length, 1);
  assert.ok(help.out[0].split('\n').length < 40, '短帮助');
  const viaHelp = recorder();
  assert.equal(await run(['help', 'comments'], viaHelp.io), 0);
  assert.match(viaHelp.out[0], /^用法：ppnt comments <目标>\[#n\]/);
  const top = recorder();
  assert.equal(await run(['--help'], top.io), 0);
  assert.match(top.out[0], /每个命令的选项与例子：ppnt <命令> --help/);
  assert.doesNotMatch(top.out[0], /段|屏|图纸号/, '帮助用 CONTEXT.md 的词：节、帧、编号');
  for (const name of ['show', 'check', 'comments', 'build', 'render', 'shot', 'locate', 'mark', 'reply', 'list', 'status']) {
    const one = recorder();
    await run([name, '--help'], one.io);
    assert.doesNotMatch(one.out.join('\n'), /段|屏|图纸号/, name);
  }
  const wrong = recorder();
  assert.equal(await run(['shot', 'p/a', '--bogus'], { ...wrong.io, env: {} }), 2);
  assert.deepEqual(wrong.err, ['错误：未知选项：--bogus', `用法：${(await import('./pinpoint-cli.js')).HELP.shot.usage}`, '选项与例子：ppnt shot --help']);
  const listBogus = recorder();
  assert.equal(await run(['list', '--bogus'], { ...listBogus.io, env: {} }), 2, '未知选项不当关键词');
  assert.equal(listBogus.err[0], '错误：未知选项：--bogus');
});

/* ---- 2026-10-14 HTML 页面三处修复：孤儿标注可写、--canvas 逐帧、懒加载未完的提示 ---- */

import { pendingWarning } from './pinpoint-cli.js';

/** 存量 doc 页，一屏连文件一起删了：它的账本成了孤儿（lib/orphans.js 第 1 种）。 */
function orphanDocPage(t) {
  const dir = withTempDir(t);
  const site = path.join(dir, 'site');
  fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(site, 'live.html'), '<h1>live</h1>\n');
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [{ id: 't-orphans', title: 'O', kind: 'dir', path: site, board: 'html' }] }));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data'), PINPOINT_ORIGIN: 'http://127.0.0.1:1' };
  const bucket = path.join(env.PINPOINT_DATA_DIR, 't-orphans');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, 'live.html_aaa111.json'), JSON.stringify({
    page: 'live.html_aaa111', path: '/sites/t-orphans/live.html', revision: 2,
    annotations: [{ id: 'live01', n: 1, type: 'element', status: 'open', content: '活页意见' }],
  }));
  fs.writeFileSync(path.join(bucket, 'gone.html_bbb222.json'), JSON.stringify({
    page: 'gone.html_bbb222', path: '/sites/t-orphans/gone.html', revision: 7,
    annotations: [
      { id: 'gone02', n: 2, type: 'element', status: 'check', content: '删掉那屏的意见' },
      { id: 'gone03', n: 3, type: 'element', status: 'open', content: '删掉那屏的另一条' },
    ],
  }));
  const calls = [];
  const requestFn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    if (url.endsWith('/health')) return { status: 200, json: { ok: true } };
    if (opts.method === 'POST') return { status: 200, json: { revision: 8, annotation: { status: opts.body.status || 'open' } } };
    return { status: 200, json: { revision: url.includes('gone.html') ? 7 : 2, annotations: [] } };
  };
  return { registry, env, calls, requestFn };
}

test('mark / reply：comments 列出的孤儿标注也能用 #n、@a:id、<页>#n 指到，写回它自己的账本', async (t) => {
  const made = orphanDocPage(t);
  const listed = recorder();
  assert.equal(await runComments(['comments', 't-orphans', '--status', 'all', '--registry', made.registry], { ...listed.io, env: made.env }), 0, listed.err.join('\n'));
  const orphanPart = listed.out.slice(listed.out.findIndex((line) => line.includes('孤儿标注'))).join('\n');
  assert.match(orphanPart, /\[#2\][^\n]*删掉那屏的意见/);

  const mk = recorder();
  const code = await runMark(['mark', 't-orphans', '#2', 'check', '--note', '改好了', '--registry', made.registry], { ...mk.io, env: made.env, requestFn: made.requestFn });
  assert.equal(code, 0, mk.err.join('\n'));
  const posts = made.calls.filter((call) => call.method === 'POST');
  assert.deepEqual(posts.map((call) => call.url.replace(/^.*\/annotations\//, '')), ['gone.html_bbb222/2/reply', 'gone.html_bbb222/2/status']);
  assert.equal(posts[0].body.entry, 't-orphans');
  assert.equal(posts[0].body.baseRevision, 7);

  made.calls.length = 0;
  const rp = recorder();
  assert.equal(await runReply(['reply', 't-orphans', '@a:gone03', '看过了', '--registry', made.registry], { ...rp.io, env: made.env, requestFn: made.requestFn }), 0, rp.err.join('\n'));
  assert.match(made.calls.find((call) => call.method === 'POST').url, /\/annotations\/gone\.html_bbb222\/3\/reply$/);

  made.calls.length = 0;
  const cross = recorder();
  assert.equal(await runMark(['mark', 't-orphans#3', 'done', '--registry', made.registry], { ...cross.io, env: made.env, requestFn: made.requestFn }), 0, cross.err.join('\n'));
  assert.match(made.calls.find((call) => call.method === 'POST').url, /\/gone\.html_bbb222\/3\/status$/);

  // comments <页>#n 也认孤儿。
  const one = recorder();
  assert.equal(await runComments(['comments', 't-orphans#2', '--registry', made.registry], { ...one.io, env: made.env }), 0, one.err.join('\n'));
  assert.ok(one.out.some((line) => line.includes('[#2]')), one.out.join('\n'));
});

test('mark --status：批量展开只走活的行，孤儿不会被顺手改掉', async (t) => {
  const made = orphanDocPage(t);
  const mk = recorder();
  assert.equal(await runMark(['mark', 't-orphans', 'check', '--status', 'open', '--registry', made.registry], { ...mk.io, env: made.env, requestFn: made.requestFn }), 0, mk.err.join('\n'));
  const posted = made.calls.filter((call) => call.method === 'POST').map((call) => call.url.replace(/^.*\/annotations\//, ''));
  assert.deepEqual(posted, ['live.html_aaa111/1/status']);
});

test('planShotJobs：文章的画布视图整页 —— 全是 HTML 帧时逐帧截、不出画布图；混着 JSX 帧时两样都出，notes 说明', () => {
  const docsOnly = {
    pageId: 'd_a',
    article: { projectId: 'd', articleId: 'a' },
    target: { urlBase: '/sites/d_a/' },
    board: { sections: [{ id: 'pages', letter: 'A', screens: [{ id: 'long', shell: 'doc' }, { id: 'cat', shell: 'doc', src: 'x/cat.html' }] }] },
    refs: { outline: [{ id: 'pages', letter: 'A', frames: [{ id: 'long', ref: 'A1' }, { id: 'cat', ref: 'A2' }] }] },
    frameRows: [{ n: 1, screenId: 'long', status: 'open' }],
  };
  const only = planShotJobs([{ kind: 'page', pageId: 'd_a' }], { basePageId: 'd_a', baseContext: docsOnly, scale: 1, withMarks: true, dataRootDir: '/data' });
  assert.deepEqual(only.jobs.map((job) => [job.kind, job.screenId, job.url, job.label]), [
    ['doc', 'long', '/sites/d_a/long.html', 'A1 · long'],
    ['doc', 'cat', '/x/cat.html', 'A2 · cat'],
  ]);
  assert.deepEqual(only.jobs[0].marks.map((row) => row.n), [1]);
  assert.equal(only.notes.length, 1);
  assert.match(only.notes[0], /d\/a 的 2 帧都是 HTML 帧.*不出画布视图图/);

  const mixed = {
    ...docsOnly,
    board: { sections: [...docsOnly.board.sections, { id: 'app', letter: 'B', screens: [{ id: 'phone' }] }] },
    refs: { outline: [...docsOnly.refs.outline, { id: 'app', letter: 'B', frames: [{ id: 'phone', ref: 'B1' }] }] },
  };
  // --canvas 再加一个指同一帧的引用：同一帧只拍一次。
  const both = planShotJobs([{ kind: 'page', pageId: 'd_a' }, { kind: 'frame', screenId: 'long' }], { basePageId: 'd_a', baseContext: mixed, scale: 1, withMarks: false, dataRootDir: '/data' });
  assert.deepEqual(both.jobs.map((job) => [job.kind, job.screenId || job.pageId]), [['doc', 'long'], ['doc', 'cat'], ['page', 'd_a']]);
  assert.match(both.notes[0], /2 个 HTML 帧按截图策略各截整页.*画布视图那张图只含 1 个 JSX 帧/);

  // 存量页的整页引用不变：一张画布图，没有 notes。
  const legacy = planShotJobs([{ kind: 'page', pageId: 'demo' }], { basePageId: 'demo', baseContext: { pageId: 'demo', frameRows: [], refs: { outline: [] } }, scale: 1, withMarks: false, dataRootDir: '/data' });
  assert.deepEqual(legacy.jobs.map((job) => job.kind), ['page']);
  assert.deepEqual(legacy.notes, []);
});

test('pendingWarning：列出没加载完的 iframe / 图片，多于 5 个时只列前 5 个并给总数', () => {
  const one = pendingWarning({ label: 'A1 · cat', pending: ['iframe preview-frames/t.html'] });
  assert.match(one, /^A1 · cat 截图时还有 1 个 iframe \/ 图片没加载完.*iframe preview-frames\/t\.html$/);
  const many = pendingWarning({ out: '/x.png', pending: Array.from({ length: 7 }, (_, i) => `img ${i}.png`) });
  assert.match(many, /^\/x\.png 截图时还有 7 个/);
  assert.ok(many.includes('img 4.png') && !many.includes('img 5.png') && many.endsWith('等 7 个'), many);
});
