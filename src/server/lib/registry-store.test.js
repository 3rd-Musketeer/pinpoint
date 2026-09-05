import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  addRegistryEntry,
  assignRegistryOrder,
  createRegistryStore,
  listRegistryEntries,
  listRegistryIds,
  setEntryFolder,
  updateRegistryEntry,
  validateFolderList,
  validateNewEntry,
  writeRegistryFile,
  writeRegistryFolders,
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

/* ---- 分组层：文件夹写入（2026-09-04 裁决 5a） ---- */

function withFolders(t, extra = {}) {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const site = makeSite(dir);
  writeRegistryFile(file, {
    version: 1,
    folders: [{ id: 'shipped', name: '已上线' }, { id: 'wip', name: '在做' }],
    pageFolders: { 'component-library': 'shipped' },
    entries: [
      { id: 'alpha', kind: 'dir', path: site, folder: 'shipped' },
      { id: 'beta', kind: 'url', url: 'https://beta.localhost' },
    ],
    ...extra,
  });
  return { dir, file, site };
}

function readDoc(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('validateFolderList: 形状、id 模式、重复、未知字段都拒', () => {
  assert.equal(validateFolderList([{ id: 'a', name: 'A', collapsed: true, order: 0 }]), null);
  assert.equal(validateFolderList([]), null);
  assert.match(validateFolderList({}), /必须是数组/);
  assert.match(validateFolderList([null]), /必须是对象/);
  assert.match(validateFolderList([{ id: 'Bad Id' }]), /id 必须匹配/);
  assert.match(validateFolderList([{ id: 'a' }, { id: 'a' }]), /id 重复/);
  assert.match(validateFolderList([{ id: 'a', name: 42 }]), /name 必须是字符串/);
  assert.match(validateFolderList([{ id: 'a', collapsed: 'yes' }]), /collapsed/);
  assert.match(validateFolderList([{ id: 'a', order: 'x' }]), /order 必须是数字/);
  assert.match(validateFolderList([{ id: 'a', color: 'red' }]), /未知字段：color/);
});

test('writeRegistryFolders: 整表替换，name 缺省等于 id，collapsed=false 不落盘', (t) => {
  const { file } = withFolders(t);
  const result = writeRegistryFolders(file, [
    { id: 'shipped', name: '已发布', collapsed: true },
    { id: 'wip', collapsed: false },
    { id: 'ideas', name: '想法', order: 2 },
  ]);
  assert.deepEqual(result.folders, [
    { id: 'shipped', name: '已发布', collapsed: true },
    { id: 'wip', name: 'wip' },
    { id: 'ideas', name: '想法', order: 2 },
  ]);
  assert.deepEqual(readDoc(file).folders.map((f) => f.id), ['shipped', 'wip', 'ideas']);
  assert.deepEqual(result.releasedEntries, []);
  assert.deepEqual(result.releasedPages, []);
});

test('writeRegistryFolders: 删夹不删页——条目丢 folder 变散页，pageFolders 映射一并去掉', (t) => {
  const { file } = withFolders(t);
  const result = writeRegistryFolders(file, [{ id: 'wip', name: '在做' }]);
  assert.deepEqual(result.releasedEntries, ['alpha']);
  assert.deepEqual(result.releasedPages, ['component-library']);
  const doc = readDoc(file);
  assert.deepEqual(doc.entries.map((e) => e.id), ['alpha', 'beta'], '页一个没少');
  assert.equal('folder' in doc.entries[0], false);
  assert.equal('pageFolders' in doc, false, '空映射不留在文件里');
});

test('writeRegistryFolders: 清空 folders 后文件里连 key 都不留；非法列表拒写', (t) => {
  const { file } = withFolders(t);
  const raw = fs.readFileSync(file, 'utf8');
  assert.throws(() => writeRegistryFolders(file, [{ id: 'a' }, { id: 'a' }]), /id 重复/);
  assert.equal(fs.readFileSync(file, 'utf8'), raw, '拒写时文件一个字节不动');

  writeRegistryFolders(file, []);
  const doc = readDoc(file);
  assert.equal('folders' in doc, false);
  assert.deepEqual(doc.entries.map((e) => e.id), ['alpha', 'beta']);
});

test('setEntryFolder: registry 条目进夹 / 出夹，order 同一次写入带上', (t) => {
  const { file } = withFolders(t);
  assert.deepEqual(setEntryFolder(file, 'beta', { folder: 'wip', order: 3 }), {
    id: 'beta', kind: 'entry', folder: 'wip', order: 3,
  });
  let doc = readDoc(file);
  assert.equal(doc.entries[1].folder, 'wip');
  assert.equal(doc.entries[1].order, 3);

  setEntryFolder(file, 'beta', { folder: null });
  doc = readDoc(file);
  assert.equal('folder' in doc.entries[1], false, '拖出来 = 散页');
  assert.equal(doc.entries[1].order, 3, 'order 留着，归属和次序是两回事');
});

test('setEntryFolder: manifest 页落 pageFolders / pageOrder，不进 entries', (t) => {
  const { file } = withFolders(t);
  const result = setEntryFolder(file, 'example-library', { folder: 'wip', order: 1 }, {
    pageIds: ['component-library', 'example-library'],
  });
  assert.equal(result.kind, 'page');
  const doc = readDoc(file);
  assert.deepEqual(doc.pageFolders, { 'component-library': 'shipped', 'example-library': 'wip' });
  assert.deepEqual(doc.pageOrder, { 'example-library': 1 });
  assert.deepEqual(doc.entries.map((e) => e.id), ['alpha', 'beta']);

  setEntryFolder(file, 'example-library', { folder: null }, { pageIds: ['example-library'] });
  assert.deepEqual(readDoc(file).pageFolders, { 'component-library': 'shipped' });
});

test('setEntryFolder: 未知 id、未知文件夹、坏 order 都拒写，文件不动', (t) => {
  const { file } = withFolders(t);
  const raw = fs.readFileSync(file, 'utf8');
  assert.throws(() => setEntryFolder(file, 'ghost', { folder: 'wip' }), /未知 id：ghost/);
  assert.throws(() => setEntryFolder(file, 'alpha', { folder: 'nope' }), /文件夹不存在：nope/);
  assert.throws(() => setEntryFolder(file, 'alpha', { folder: 'wip', order: 'x' }), /order 必须是数字/);
  assert.throws(() => setEntryFolder(file, 'bad id!', { folder: 'wip' }), /id 不合法/);
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
});

test('assignRegistryOrder: 一串 id 按序写 order，条目与 manifest 页各落各处', (t) => {
  const { file } = withFolders(t);
  const result = assignRegistryOrder(file, ['beta', 'component-library', 'alpha'], {
    pageIds: ['component-library'],
  });
  assert.deepEqual(result, [
    { id: 'beta', kind: 'entry', order: 0 },
    { id: 'component-library', kind: 'page', order: 1 },
    { id: 'alpha', kind: 'entry', order: 2 },
  ]);
  const doc = readDoc(file);
  assert.deepEqual(doc.entries.map((e) => [e.id, e.order]), [['alpha', 2], ['beta', 0]]);
  assert.deepEqual(doc.pageOrder, { 'component-library': 1 });
  assert.equal(doc.entries[0].folder, 'shipped', '归属不受排序影响');
});

test('assignRegistryOrder: 一个 id 不认就整单不写；重复 id 也拒', (t) => {
  const { file } = withFolders(t);
  const raw = fs.readFileSync(file, 'utf8');
  assert.throws(() => assignRegistryOrder(file, ['alpha', 'ghost']), /未知 id：ghost/);
  assert.throws(() => assignRegistryOrder(file, ['alpha', 'alpha']), /重复项/);
  assert.throws(() => assignRegistryOrder(file, 'alpha'), /必须是数组/);
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
});

test('createRegistryStore: setFolders / setEntryFolder / setOrder 写完立刻在活视图里生效', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const site = makeSite(dir);
  writeRegistryFile(file, { version: 1, entries: [{ id: 'alpha', kind: 'dir', path: site }] });
  const store = createRegistryStore({ path: file, root: dir, log: () => {} });
  assert.deepEqual(store.folders, []);

  store.setFolders([{ id: 'shipped', name: '已上线' }]);
  assert.deepEqual(store.folders, [{ id: 'shipped', name: '已上线' }]);

  store.setEntryFolder('alpha', { folder: 'shipped' });
  assert.equal(store.resolve('alpha').folder, 'shipped');

  store.setEntryFolder('component-library', { folder: 'shipped' }, { pageIds: ['component-library'] });
  assert.deepEqual(store.pageFolders, { 'component-library': 'shipped' });

  store.setOrder(['component-library', 'alpha'], { pageIds: ['component-library'] });
  assert.equal(store.resolve('alpha').order, 1);
  assert.deepEqual(store.pageOrder, { 'component-library': 0 });

  // 删夹：页留下，归属清掉。
  const released = store.setFolders([]);
  assert.deepEqual(released.releasedEntries, ['alpha']);
  assert.deepEqual(released.releasedPages, ['component-library']);
  assert.equal(store.resolve('alpha').folder, undefined);
  assert.deepEqual(store.pageFolders, {});
});
