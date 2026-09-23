import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { defaultEntries, loadRegistry } from './registry.js';

const ROOT = '/repo/pinpoint';

function withTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-registry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeRegistry(dir, value) {
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function quietLoad(options) {
  const logs = [];
  const registry = loadRegistry({ root: ROOT, log: (msg) => logs.push(msg), ...options });
  return { registry, logs };
}

test('missing registry file falls back to the default pinpoint-only registry', (t) => {
  const dir = withTempDir(t);
  const file = path.join(dir, 'registry.json');
  const { registry, logs } = quietLoad({ path: file });

  assert.equal(registry.ok, true);
  assert.equal(registry.path, file);
  assert.deepEqual(registry.errors, []);
  assert.deepEqual(registry.entries, defaultEntries(ROOT));
  assert.equal(registry.entries[0].id, 'pinpoint');
  assert.equal(registry.entries[0].kind, 'dir');
  assert.equal(registry.entries[0].path, ROOT);
  assert.deepEqual(logs, []);
});

test('malformed JSON falls back to the default registry and reports the error', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, '{ not json');
  const { registry, logs } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.equal(registry.errors.length, 1);
  assert.match(registry.errors[0], /json/i);
  assert.deepEqual(registry.entries, defaultEntries(ROOT));
  assert.equal(logs.length, 1, 'parse failure is logged');
});

test('a document without an entries array falls back to the default registry', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, { version: 1, entries: 'pinpoint' });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.equal(registry.errors.length, 1);
  assert.deepEqual(registry.entries, defaultEntries(ROOT));
});

test('entries with invalid ids are skipped and reported', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    entries: [
      { id: 'Bad Id', title: 'x', kind: 'url', url: 'https://x.localhost' },
      { id: '-leading-dash', title: 'x', kind: 'url', url: 'https://x.localhost' },
      { id: 'ok-entry', title: 'ok', kind: 'url', url: 'https://ok.localhost' },
    ],
  });
  const { registry, logs } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.equal(registry.errors.length, 2);
  assert.deepEqual(registry.entries.map((e) => e.id), ['ok-entry']);
  assert.equal(logs.length, 2);
});

test('duplicate ids keep the first entry and skip later ones', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    entries: [
      { id: 'dup', title: 'first', kind: 'url', url: 'https://one.localhost' },
      { id: 'dup', title: 'second', kind: 'url', url: 'https://two.localhost' },
    ],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.equal(registry.errors.length, 1);
  assert.match(registry.errors[0], /duplicate/);
  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0].title, 'first');
});

test('kind validation: dir requires path, url requires url, unknown kinds are skipped', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    entries: [
      { id: 'dir-no-path', title: 'x', kind: 'dir' },
      { id: 'url-no-url', title: 'x', kind: 'url' },
      { id: 'weird', title: 'x', kind: 'git', path: '/tmp' },
      { id: 'good-dir', title: 'x', kind: 'dir', path: dir },
      { id: 'good-url', title: 'x', kind: 'url', url: 'https://x.localhost' },
    ],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.equal(registry.errors.length, 3);
  assert.deepEqual(registry.entries.map((e) => e.id), ['good-dir', 'good-url']);
});

test('kind "file": requires a path, keeps it, and warns instead of dropping when missing', (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'report.html');
  fs.writeFileSync(page, '<!doctype html><html><body>r</body></html>');
  const file = writeRegistry(dir, {
    version: 1,
    entries: [
      { id: 'file-no-path', title: 'x', kind: 'file' },
      { id: 'good-file', title: 'x', kind: 'file', path: page, board: 'ios' },
      { id: 'ghost-file', title: 'x', kind: 'file', path: path.join(dir, 'gone.html') },
    ],
  });
  const { registry } = quietLoad({ path: file });
  assert.equal(registry.ok, false, 'file without a path is an invalid entry');
  assert.equal(registry.errors.length, 1);
  assert.deepEqual(registry.entries.map((e) => e.id), ['good-file', 'ghost-file']);
  assert.equal(registry.resolve('good-file').path, page);
  assert.equal(registry.resolve('good-file').board, 'ios');
  assert.equal(registry.warnings.length, 1, 'missing file path warns but stays registered');
  assert.match(registry.warnings[0], /does not exist/);
});

test('a dir entry with a missing path is kept but warned about', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    entries: [{ id: 'ghost', title: 'x', kind: 'dir', path: path.join(dir, 'does-not-exist') }],
  });
  const { registry, logs } = quietLoad({ path: file });

  assert.equal(registry.ok, true, 'warnings do not flip ok');
  assert.deepEqual(registry.errors, []);
  assert.equal(registry.warnings.length, 1);
  assert.match(registry.warnings[0], /does not exist/);
  assert.equal(registry.entries.length, 1);
  assert.equal(logs.length, 1, 'warning is logged');
});

test('resolve returns the entry by id and null for unknown ids', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    entries: [
      { id: 'alpha', title: 'A', kind: 'url', url: 'https://a.localhost', board: 'web' },
      { id: 'beta', title: 'B', kind: 'dir', path: dir },
    ],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, true);
  assert.equal(registry.resolve('alpha').url, 'https://a.localhost');
  assert.equal(registry.resolve('alpha').board, 'web');
  assert.equal(registry.resolve('beta').kind, 'dir');
  assert.equal(registry.resolve('missing'), null);
});

test('阶段 8：page/role 透传；非法 page/role 与 url+page 组合跳过并报告', (t) => {
  const dir = withTempDir(t);
  const page = path.join(dir, 'draft.html');
  fs.writeFileSync(page, '<!doctype html><html><body>d</body></html>');
  const file = writeRegistry(dir, {
    version: 1,
    entries: [
      { id: 'attached', kind: 'file', path: page, page: 'library', role: 'draft' },
      { id: 'bad-page', kind: 'file', path: page, page: 42 },
      { id: 'bad-role', kind: 'dir', path: dir, role: 'wip' },
      { id: 'url-attached', kind: 'url', url: 'https://x.localhost', page: 'library' },
    ],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.equal(registry.errors.length, 3);
  assert.deepEqual(registry.entries.map((e) => e.id), ['attached']);
  assert.equal(registry.resolve('attached').page, 'library');
  assert.equal(registry.resolve('attached').role, 'draft');
  assert.match(registry.errors[2], /url.*cannot attach/);
});

/* ---- 分组层：folders / folder / order / pageFolders / pageOrder（2026-09-04） ---- */

test('文件夹：folders 归一（name 缺省等于 id、collapsed 只留 true）与条目归属透传', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    folders: [
      { id: 'shipped', name: '已上线', collapsed: true, order: 1 },
      { id: 'wip' },
    ],
    pageFolders: { 'component-library': 'wip' },
    pageOrder: { 'component-library': 2 },
    entries: [
      { id: 'alpha', kind: 'dir', path: dir, folder: 'shipped', order: 0 },
      { id: 'loose', kind: 'url', url: 'https://x.localhost' },
    ],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, true);
  assert.deepEqual(registry.folders, [
    { id: 'shipped', name: '已上线', collapsed: true, order: 1 },
    { id: 'wip', name: 'wip' },
  ]);
  assert.equal(registry.resolve('alpha').folder, 'shipped');
  assert.equal(registry.resolve('alpha').order, 0);
  assert.equal(registry.resolve('loose').folder, undefined);
  assert.deepEqual(registry.pageFolders, { 'component-library': 'wip' });
  assert.deepEqual(registry.pageOrder, { 'component-library': 2 });
});

test('文件夹：缺省是空分组（没有 folders 字段的老登记表照常读）', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, { version: 1, entries: [{ id: 'a', kind: 'dir', path: dir }] });
  const { registry } = quietLoad({ path: file });
  assert.deepEqual(registry.folders, []);
  assert.deepEqual(registry.pageFolders, {});
  assert.deepEqual(registry.pageOrder, {});
});

test('文件夹：id 重复只毙那一个夹，另一个夹与所有页都不受影响', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    folders: [
      { id: 'dup', name: '第一个' },
      { id: 'dup', name: '第二个' },
      { id: 'Bad Id', name: 'x' },
      { id: 'fine', name: 'ok' },
    ],
    entries: [{ id: 'a', kind: 'dir', path: dir, folder: 'dup' }],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.equal(registry.errors.length, 2);
  assert.match(registry.errors[0], /duplicate folder id/);
  assert.match(registry.errors[1], /folder id must match/);
  assert.deepEqual(registry.folders.map((f) => f.id), ['dup', 'fine']);
  assert.deepEqual(registry.folders[0].name, '第一个', '同 id 的第二个夹被跳过，第一个留着');
  assert.equal(registry.resolve('a').folder, 'dup', '页照旧挂在还在的那个夹上');
});

test('文件夹：条目指着不存在的夹 = warning + 散页，条目本身不会被丢掉', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    folders: [{ id: 'real', name: 'Real' }],
    entries: [
      { id: 'ghost-folder', kind: 'dir', path: dir, folder: 'gone' },
      { id: 'bad-order', kind: 'dir', path: dir, order: 'first' },
    ],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, true, '归属坏了不是 error —— 页还在，只是散着');
  assert.equal(registry.warnings.length, 2);
  assert.match(registry.warnings[0], /folder does not exist.*loose/);
  assert.match(registry.warnings[1], /order must be a number/);
  assert.deepEqual(registry.entries.map((e) => e.id), ['ghost-folder', 'bad-order']);
  assert.equal(registry.resolve('ghost-folder').folder, undefined);
  assert.equal(registry.resolve('bad-order').order, undefined);
});

test('文件夹：pageFolders 的坏键、坏值与撞 registry 条目 id 的死映射都只 warn', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    folders: [{ id: 'real', name: 'Real' }],
    pageFolders: {
      'component-library': 'real',
      'example-library': 'gone',
      'bad id': 'real',
      alpha: 'real',
    },
    pageOrder: { 'component-library': 'first', 'example-library': 3 },
    entries: [{ id: 'alpha', kind: 'dir', path: dir }],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, true);
  assert.deepEqual(registry.pageFolders, { 'component-library': 'real' });
  assert.deepEqual(registry.pageOrder, { 'example-library': 3 });
  assert.equal(registry.warnings.length, 4);
  assert.ok(registry.warnings.some((w) => /is a registry entry/.test(w)), '条目自己的 folder 字段才算数');
});

test('文件夹：folders / pageFolders 顶层形状不对是 error，条目照常读', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    folders: { shipped: '已上线' },
    pageFolders: [],
    entries: [{ id: 'a', kind: 'dir', path: dir }],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.deepEqual(registry.errors, ['registry folders must be an array', 'registry pageFolders must be an object']);
  assert.deepEqual(registry.folders, []);
  assert.deepEqual(registry.entries.map((e) => e.id), ['a'], '分组坏了不影响条目');
});

test('PINPOINT_REGISTRY overrides the default registry path', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    entries: [{ id: 'env-entry', title: 'x', kind: 'url', url: 'https://env.localhost' }],
  });
  const previous = process.env.PINPOINT_REGISTRY;
  process.env.PINPOINT_REGISTRY = file;
  t.after(() => {
    if (previous === undefined) delete process.env.PINPOINT_REGISTRY;
    else process.env.PINPOINT_REGISTRY = previous;
  });

  const { registry } = quietLoad();
  assert.equal(registry.path, file);
  assert.deepEqual(registry.entries.map((e) => e.id), ['env-entry']);
});

