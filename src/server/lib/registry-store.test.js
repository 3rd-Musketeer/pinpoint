import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addRegistryEntry,
  createRegistryStore,
  listRegistryEntries,
  removeRegistryEntry,
  renameRegistryEntry,
  updateRegistryEntry,
  validateNewEntry,
  withRegistryLock,
  writeRegistryFile,
} from './registry-store.js';

function withTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-registry-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeSite(dir, name = 'site') {
  const site = path.join(dir, name);
  fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body>x</body></html>');
  return site;
}

test('writeRegistryFile: creates parent dirs, 2-space JSON, trailing newline, no tmp left', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'nested', 'registry.json');
  writeRegistryFile(file, { version: 1, entries: [{ id: 'a', kind: 'dir', path: dir }] });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw, JSON.stringify(JSON.parse(raw), null, 2) + '\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['registry.json'], 'tmp sibling is renamed away');
});

test('writeRegistryFile: 写失败时清掉半截 tmp，不在数据根留垃圾', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  // 占住 tmp 名：writeFileSync 打不开 → 抛错；finally 把占位的 tmp 清掉。
  const tmp = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(tmp);
  assert.throws(() => writeRegistryFile(file, { version: 1, entries: [] }));
  assert.deepEqual(fs.readdirSync(dir), [], '写失败的 tmp 不残留');
  assert.ok(!fs.existsSync(file), '正式文件不被半截写碰着');
});

test('addRegistryEntry: missing file starts a fresh {version:1, entries:[...]} document', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const site = makeSite(dir);
  const entry = addRegistryEntry(file, { id: 'site', kind: 'dir', path: site, board: 'html' });
  assert.equal(entry.title, 'site', 'title defaults to id');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.version, 1);
  assert.deepEqual(doc.entries, [entry]);
});

test('addRegistryEntry: preserves the existing document shape and appends', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, comment: 'hand-written', entries: [
    { id: 'old', title: 'Old', kind: 'url', url: 'https://old.localhost' },
  ] }));
  addRegistryEntry(file, { id: 'new', title: 'New', kind: 'dir', path: makeSite(dir) });
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.comment, 'hand-written', 'unknown top-level fields survive');
  assert.deepEqual(doc.entries.map((e) => e.id), ['old', 'new']);
  assert.deepEqual(doc.entries[0], { id: 'old', title: 'Old', kind: 'url', url: 'https://old.localhost' }, '已退役的老条目原样留在文件里');
});

test('addRegistryEntry: strict validation rejects and leaves the file untouched', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const site = makeSite(dir);
  const page = path.join(dir, 'page.html');
  fs.writeFileSync(page, '<!doctype html><html><body>p</body></html>');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ id: 'taken', kind: 'dir', path: site }] }));
  const before = fs.readFileSync(file, 'utf8');

  const cases = [
    [{ id: 'Bad Id', kind: 'dir', path: site }, /id 必须匹配/],
    [{ id: 'taken', kind: 'dir', path: site }, /已存在/],
    [{ id: 'k', kind: 'git', path: site }, /kind/],
    [{ id: 'rel', kind: 'dir', path: 'relative/dir' }, /绝对路径/],
    [{ id: 'ghost', kind: 'dir', path: path.join(dir, 'nope') }, /不存在/],
    [{ id: 'notdir', kind: 'dir', path: page }, /不是目录/],
    [{ id: 'notfile', kind: 'file', path: site }, /不是文件/],
    // url 条目已退役（2026-10-14）：kind "url" 与 url 字段都写不进去
    [{ id: 'web', kind: 'url', url: 'https://x.localhost' }, /未知字段：url/],
    [{ id: 'web', kind: 'url' }, /kind 必须是 dir \/ file \/ project/],
    [{ id: 'u2', kind: 'dir', path: site, url: 'https://x.localhost' }, /未知字段：url/],
    [{ id: 'bb', kind: 'dir', path: site, board: 42 }, /board/],
    // 未知字段响亮拒绝；已删功能的字段（page / role）也是未知字段
    [{ id: 'p1', kind: 'dir', path: site, page: 'library' }, /未知字段：page/],
    [{ id: 'r1', kind: 'dir', path: site, role: 'draft' }, /未知字段：role/],
    [{ id: 'u1', kind: 'dir', path: site, stage: 'x' }, /未知字段：stage/],
  ];
  for (const [raw, pattern] of cases) {
    assert.throws(() => addRegistryEntry(file, raw), pattern, JSON.stringify(raw));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'failed adds never touch the file');
});

test('addRegistryEntry: a malformed existing file is an error, never clobbered', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => addRegistryEntry(file, { id: 'x', kind: 'dir', path: dir }), /不是合法 JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('addRegistryEntry: file entries keep their absolute path and board', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const page = path.join(dir, 'report.html');
  fs.writeFileSync(page, '<!doctype html><html><body>r</body></html>');
  const entry = addRegistryEntry(file, { id: 'report', title: 'Report', kind: 'file', path: page, board: 'ios' });
  assert.ok(entry.addedAt > 0);
  assert.deepEqual(entry, { addedAt: entry.addedAt, id: 'report', kind: 'file', title: 'Report', path: page, board: 'ios' });
});

test('listRegistryEntries: whole entries, missing file is empty, malformed throws', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  assert.deepEqual(listRegistryEntries(file), []);
  const site = makeSite(dir);
  writeRegistryFile(file, { version: 1, entries: [{ id: 'a', kind: 'dir', path: site }, null] });
  assert.deepEqual(listRegistryEntries(file), [{ id: 'a', kind: 'dir', path: site }], 'null 条目不进结果');
  fs.writeFileSync(file, '{ nope');
  assert.throws(() => listRegistryEntries(file), /JSON/);
});

test('updateRegistryEntry: 原地替换，位置与其它条目不动', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const before = makeSite(dir, 'before');
  const after = makeSite(dir, 'after');
  writeRegistryFile(file, { version: 1, entries: [
    { id: 'a', kind: 'dir', path: before },
    { id: 'b', title: 'B', kind: 'dir', path: before, board: 'ios' },
    { id: 'c', kind: 'url', url: 'https://c.localhost' },
  ] });
  const written = updateRegistryEntry(file, { id: 'b', title: 'B', kind: 'dir', path: after, board: 'ios' });
  assert.deepEqual(written, { id: 'b', kind: 'dir', title: 'B', path: after, board: 'ios' });
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(doc.entries.map((e) => e.id), ['a', 'b', 'c']);
  assert.equal(doc.entries[0].path, before, '别的条目不动');
  assert.equal(doc.version, 1);
});

test('updateRegistryEntry: 未知 id / 非法新形状都拒写，文件不动', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const site = makeSite(dir);
  writeRegistryFile(file, { version: 1, entries: [{ id: 'a', kind: 'dir', path: site }] });
  const raw = fs.readFileSync(file, 'utf8');
  assert.throws(() => updateRegistryEntry(file, { id: 'ghost', kind: 'dir', path: site }), /条目不存在：ghost/);
  assert.throws(() => updateRegistryEntry(file, { id: 'a', kind: 'dir', path: path.join(dir, 'gone') }), /路径不存在/);
  assert.throws(() => updateRegistryEntry(file, { id: 'a', kind: 'dir', path: site, nope: 1 }), /未知字段/);
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
});

test('validateNewEntry accepts a well-formed entry (null = no problem)', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  assert.equal(validateNewEntry({ id: 'ok', kind: 'dir', path: site }, new Set()), null);
  const page = path.join(site, 'index.html');
  assert.equal(validateNewEntry({ id: 'ok', kind: 'file', path: page }, new Set()), null);
  assert.equal(validateNewEntry(null, new Set()), '条目必须是对象');
});

test('createRegistryStore: getters delegate to the snapshot; reload picks up external rewrites', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const site = makeSite(dir);
  writeRegistryFile(file, { version: 1, entries: [{ id: 'one', kind: 'dir', path: site }] });
  const store = createRegistryStore({ path: file, root: dir, log: () => {} });

  assert.equal(store.path, file);
  assert.equal(store.ok, true);
  assert.deepEqual(store.entries.map((e) => e.id), ['one']);
  assert.equal(store.resolve('one').path, site);
  assert.equal(store.resolve('two'), null);

  writeRegistryFile(file, { version: 1, entries: [
    { id: 'one', kind: 'dir', path: site },
    { id: 'two', kind: 'file', path: path.join(site, 'index.html') },
  ] });
  assert.equal(store.entries.length, 1, 'snapshot is stable until reload');
  const next = store.reload();
  assert.equal(next.entries.length, 2);
  assert.equal(store.entries.length, 2);
  assert.equal(store.resolve('two').path, path.join(site, 'index.html'));
});

test('createRegistryStore: add() writes the file and reloads in one step', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const store = createRegistryStore({ path: file, root: dir, log: () => {} });
  assert.deepEqual(store.entries.map((e) => e.id), ['pinpoint'], 'missing file starts at the default');

  const site = makeSite(dir);
  const entry = store.add({ id: 'site', kind: 'dir', path: site });
  assert.equal(entry.id, 'site');
  assert.equal(store.resolve('site').path, site, 'live view already sees it');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries.map((e) => e.id), ['pinpoint', 'site']);
});

test('createRegistryStore: reload surfaces a malformed file as errors, not a crash', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  writeRegistryFile(file, { version: 1, entries: [] });
  const store = createRegistryStore({ path: file, root: dir, log: () => {} });
  fs.writeFileSync(file, '{ broken');
  const next = store.reload();
  assert.equal(next.ok, false);
  assert.equal(store.ok, false);
  assert.match(store.errors[0], /json/i);
  assert.deepEqual(store.entries.map((e) => e.id), ['pinpoint'], 'falls back to the default entries');
});

/* ---- 已退役功能留下的字段（2026-10-14） ---- */

test('老登记表里条目带退役字段（folder / order / page / role）：move 与 rename 照常写，写出的条目不再带它们', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const before = makeSite(dir, 'before');
  const after = makeSite(dir, 'after');
  writeRegistryFile(file, {
    version: 1,
    folders: [{ id: 'shipped', name: '已上线' }],
    entries: [{ id: 'alpha', kind: 'dir', path: before, folder: 'shipped', order: 0, page: 'home', role: 'draft' }],
  });
  const moved = updateRegistryEntry(file, { id: 'alpha', kind: 'dir', path: after, folder: 'shipped', order: 0, page: 'home', role: 'draft' });
  assert.deepEqual(moved, { id: 'alpha', kind: 'dir', title: 'alpha', path: after });

  writeRegistryFile(file, { version: 1, entries: [{ id: 'alpha', kind: 'dir', path: before, folder: 'shipped', page: 'home' }] });
  const renamed = renameRegistryEntry(file, 'alpha', 'beta');
  assert.deepEqual(renamed.entry, { id: 'beta', kind: 'dir', title: 'beta', path: before });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries, [renamed.entry]);
});

test('老登记表里残留的 url 条目：remove 照常删；保持 kind url 的 rename / move 拒写并保持文件不动，重指到本地目录照常写', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const site = makeSite(dir);
  writeRegistryFile(file, { version: 1, entries: [
    { id: 'a', kind: 'dir', path: site },
    { id: 'web', title: 'Web', kind: 'url', url: 'http://127.0.0.1:5173' },
  ] });
  const raw = fs.readFileSync(file, 'utf8');
  assert.throws(() => renameRegistryEntry(file, 'web', 'web2'), /kind 必须是 dir \/ file \/ project/);
  assert.throws(() => updateRegistryEntry(file, { id: 'web', kind: 'url', url: 'http://127.0.0.1:5174' }), /kind 必须是 dir \/ file \/ project/);
  assert.equal(fs.readFileSync(file, 'utf8'), raw);

  const moved = updateRegistryEntry(file, { id: 'web', title: 'Web', kind: 'dir', path: site, url: 'http://127.0.0.1:5173' });
  assert.deepEqual(moved, { id: 'web', kind: 'dir', title: 'Web', path: site }, 'url 字段随 move 去掉');
  assert.equal(removeRegistryEntry(file, 'web').kind, 'dir');
  writeRegistryFile(file, { version: 1, entries: [
    { id: 'a', kind: 'dir', path: site },
    { id: 'web', title: 'Web', kind: 'url', url: 'http://127.0.0.1:5173' },
  ] });
  const removed = removeRegistryEntry(file, 'web');
  assert.equal(removed.kind, 'url');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).entries.map((e) => e.id), ['a']);
});

test('withRegistryLock：死进程留下的 stale 锁被接管，用完释放', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, '999999');
  fs.utimesSync(lock, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  assert.equal(withRegistryLock(file, () => 'ran', { staleMs: 1000 }), 'ran');
  assert.ok(!fs.existsSync(lock), '用完释放');
});

test('withRegistryLock：别人持锁时等待方等它释放再进（不 stale 接管）', async (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const lock = `${file}.lock`;
  // 持锁方是真实子进程：自己的事件循环空闲，200ms 后释放。Atomics.wait 阻塞的是
  // 本进程的主线程，同进程 setTimeout 不会走，所以不能用本进程模拟持锁方。
  const holder = spawn(process.execPath, ['-e', `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(lock)}, '12345'); setTimeout(() => fs.unlinkSync(${JSON.stringify(lock)}), 200);`]);
  t.after(() => new Promise((resolve) => holder.on('close', resolve)));
  // 等锁文件真的出现再计时（spawn 到写锁之间有间隙）。
  await new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => (fs.existsSync(lock) || Date.now() - t0 > 2000 ? resolve() : setTimeout(poll, 10));
    poll();
  });
  const started = Date.now();
  assert.equal(withRegistryLock(file, () => 'ran', { staleMs: 60_000 }), 'ran');
  assert.ok(Date.now() - started >= 50, '等过持锁方再进');
  assert.ok(!fs.existsSync(lock), '用完释放');
});

test('并发 add：两个进程各加 5 条，10 条都在（读-改-写整段持锁，不再丢更新）', async (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const storeModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'registry-store.js');
  const script = [
    `import { addRegistryEntry } from ${JSON.stringify(storeModule)};`,
    `for (let i = 0; i < 5; i++) {`,
    `  addRegistryEntry(${JSON.stringify(file)}, { id: 'p' + process.pid + '-' + i, kind: 'dir', path: ${JSON.stringify(dir)} });`,
    `}`,
  ].join('\n');
  const exits = await Promise.all([0, 1].map(() => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stderr }));
  })));
  for (const { code, stderr } of exits) assert.equal(code, 0, stderr);
  const ids = listRegistryEntries(file).map((entry) => entry.id);
  assert.equal(ids.length, 10, `丢更新了：${ids.join(',')}`);
  assert.ok(!fs.existsSync(`${file}.lock`), '锁不残留');
});
