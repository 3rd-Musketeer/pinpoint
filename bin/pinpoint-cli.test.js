import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildEntry,
  CliError,
  deriveId,
  parseArgs,
  planAdd,
  requestJson,
  resolveRegistryPath,
  runAdd,
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
  assert.throws(() => parseArgs(['add']), /需要一个目标/);
  assert.throws(() => parseArgs(['add', '/a', '/b']), /只接受一个目标/);
  assert.throws(() => parseArgs(['add', '/a', '--wat', '1']), /未知选项/);
  assert.throws(() => parseArgs(['add', '/a', '--title']), /缺少值/);
  assert.throws(() => parseArgs(['add', '/a', '--title', '--id', 'x']), /缺少值/);
  assert.throws(() => parseArgs(['add', '/a', '--id=']), /缺少值/);
});

test('parseArgs: -h/--help short-circuits', () => {
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['add', '-h']), { help: true });
});

/* ---- slugify / deriveId ---- */

test('slugify: lowercase, fold non-alphanumerics, trim dashes', () => {
  assert.equal(slugify('My Report'), 'my-report');
  assert.equal(slugify('  --A__b--  '), 'a-b');
  assert.equal(slugify('my-todos.localhost'), 'my-todos-localhost');
  assert.equal(slugify('我的项目'), '');
});

test('deriveId: free base, then -2, -3', () => {
  assert.equal(deriveId('app', []), 'app');
  assert.equal(deriveId('app', ['app']), 'app-2');
  assert.equal(deriveId('app', ['app', 'app-2']), 'app-3');
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
  assert.throws(() => buildEntry(site, { id: 'taken' }, { cwd: dir, takenIds: ['taken'] }), /已存在/);
  // 自动派生在同一名单上则避让
  assert.equal(buildEntry(site, {}, { cwd: dir, takenIds: ['my-site'] }).id, 'my-site-2');
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

/* ---- resolveRegistryPath / planAdd ---- */

test('resolveRegistryPath: --registry > PINPOINT_REGISTRY > default', (t) => {
  const dir = withTempDir(t);
  assert.equal(resolveRegistryPath({}, {}, dir), path.join(os.homedir(), '.pinpoint', 'registry.json'));
  assert.equal(resolveRegistryPath({}, { PINPOINT_REGISTRY: '/env/reg.json' }, dir), '/env/reg.json');
  assert.equal(resolveRegistryPath({ registry: 'rel.json' }, { PINPOINT_REGISTRY: '/env/reg.json' }, dir), path.join(dir, 'rel.json'));
});

test('planAdd: derives against existing entries and the seeded pinpoint default', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir, 'pinpoint'); // 名字撞默认条目
  // 文件不存在：避让播种的 pinpoint
  const first = planAdd(['add', site, '--registry', path.join(dir, 'registry.json')], { cwd: dir, env: {} });
  assert.equal(first.entry.id, 'pinpoint-2');
  // 文件已存在：避让文件里的条目
  const other = makeSite(dir, 'app');
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ id: 'app', kind: 'dir', path: site }] }));
  const second = planAdd(['add', other, '--registry', file], { cwd: dir, env: {} });
  assert.equal(second.entry.id, 'app-2');
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
