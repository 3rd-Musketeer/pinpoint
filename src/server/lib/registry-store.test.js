import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  addRegistryEntry,
  createRegistryStore,
  listRegistryIds,
  validateNewEntry,
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
  writeRegistryFile(file, { version: 1, entries: [{ id: 'a', kind: 'url', url: 'https://a.localhost' }] });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw, JSON.stringify(JSON.parse(raw), null, 2) + '\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['registry.json'], 'tmp sibling is renamed away');
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
  addRegistryEntry(file, { id: 'new', title: 'New', kind: 'url', url: 'https://new.localhost' });
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.comment, 'hand-written', 'unknown top-level fields survive');
  assert.deepEqual(doc.entries.map((e) => e.id), ['old', 'new']);
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
    [{ id: 'Bad Id', kind: 'url', url: 'https://x.localhost' }, /id 必须匹配/],
    [{ id: 'taken', kind: 'url', url: 'https://x.localhost' }, /已存在/],
    [{ id: 'k', kind: 'git', path: site }, /kind/],
    [{ id: 'rel', kind: 'dir', path: 'relative/dir' }, /绝对路径/],
    [{ id: 'ghost', kind: 'dir', path: path.join(dir, 'nope') }, /不存在/],
    [{ id: 'notdir', kind: 'dir', path: page }, /不是目录/],
    [{ id: 'notfile', kind: 'file', path: site }, /不是文件/],
    [{ id: 'proto', kind: 'url', url: 'ftp://x.localhost' }, /http/],
    [{ id: 'badurl', kind: 'url', url: '://nope' }, /不合法/],
    [{ id: 'bb', kind: 'dir', path: site, board: 42 }, /board/],
    // 阶段 8：page/role 字段校验 + 未知字段响亮拒绝
    [{ id: 'p1', kind: 'dir', path: site, page: 42 }, /page 必须匹配/],
    [{ id: 'p2', kind: 'dir', path: site, page: 'bad page!' }, /page 必须匹配/],
    [{ id: 'p3', kind: 'url', url: 'https://x.localhost', page: 'library' }, /url 条目.*不能归属页面/],
    [{ id: 'r1', kind: 'dir', path: site, role: 'wip' }, /role 必须是 product \/ draft/],
    [{ id: 'u1', kind: 'dir', path: site, stage: 'x' }, /未知字段：stage/],
  ];
  for (const [raw, pattern] of cases) {
    assert.throws(() => addRegistryEntry(file, raw), pattern, JSON.stringify(raw));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'failed adds never touch the file');
});

test('addRegistryEntry: page/role 合法组合落盘并原样透传', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const page = path.join(dir, 'draft.html');
  fs.writeFileSync(page, '<!doctype html><html><body>d</body></html>');
  const entry = addRegistryEntry(file, { id: 'draft', kind: 'file', path: page, page: 'library', role: 'draft' });
  assert.deepEqual(entry, { id: 'draft', kind: 'file', title: 'draft', path: page, page: 'library', role: 'draft' });
  // 缺省不带 page/role 的条目字段面不变（不写死数据）
  const plain = addRegistryEntry(file, { id: 'plain', kind: 'file', path: page });
  assert.deepEqual(plain, { id: 'plain', kind: 'file', title: 'plain', path: page });
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(doc.entries[0].page, 'library');
  assert.equal(doc.entries[0].role, 'draft');
  assert.equal('page' in doc.entries[1], false);
  assert.equal('role' in doc.entries[1], false);
});

test('addRegistryEntry: a malformed existing file is an error, never clobbered', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, '{ not json');
  assert.throws(() => addRegistryEntry(file, { id: 'x', kind: 'url', url: 'https://x.localhost' }), /不是合法 JSON/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('addRegistryEntry: file entries keep their absolute path and board', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const page = path.join(dir, 'report.html');
  fs.writeFileSync(page, '<!doctype html><html><body>r</body></html>');
  const entry = addRegistryEntry(file, { id: 'report', title: 'Report', kind: 'file', path: page, board: 'ios' });
  assert.deepEqual(entry, { id: 'report', kind: 'file', title: 'Report', path: page, board: 'ios' });
});

test('listRegistryIds: missing file is empty, malformed throws', (t) => {
  const dir = withTempDir(t);
  assert.deepEqual(listRegistryIds(path.join(dir, 'registry.json')), []);
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, '{ nope');
  assert.throws(() => listRegistryIds(file), /JSON/);
});

test('validateNewEntry accepts a well-formed entry (null = no problem)', (t) => {
  const dir = withTempDir(t);
  const site = makeSite(dir);
  assert.equal(validateNewEntry({ id: 'ok', kind: 'dir', path: site }, new Set()), null);
  assert.equal(validateNewEntry({ id: 'ok', kind: 'url', url: 'http://127.0.0.1:3000' }, new Set()), null);
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
    { id: 'two', kind: 'url', url: 'https://two.localhost' },
  ] });
  assert.equal(store.entries.length, 1, 'snapshot is stable until reload');
  const next = store.reload();
  assert.equal(next.entries.length, 2);
  assert.equal(store.entries.length, 2);
  assert.equal(store.resolve('two').url, 'https://two.localhost');
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
