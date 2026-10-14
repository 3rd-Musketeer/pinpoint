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
      { id: 'Bad Id', title: 'x', kind: 'dir', path: dir },
      { id: '-leading-dash', title: 'x', kind: 'dir', path: dir },
      { id: 'ok-entry', title: 'ok', kind: 'dir', path: dir },
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
      { id: 'dup', title: 'first', kind: 'dir', path: dir },
      { id: 'dup', title: 'second', kind: 'dir', path: dir },
    ],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.equal(registry.errors.length, 1);
  assert.match(registry.errors[0], /duplicate/);
  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0].title, 'first');
});

test('kind validation: dir requires path, unknown kinds are skipped', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    entries: [
      { id: 'dir-no-path', title: 'x', kind: 'dir' },
      { id: 'weird', title: 'x', kind: 'git', path: '/tmp' },
      { id: 'good-dir', title: 'x', kind: 'dir', path: dir },
    ],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, false);
  assert.equal(registry.errors.length, 2);
  assert.deepEqual(registry.entries.map((e) => e.id), ['good-dir']);
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
      { id: 'alpha', title: 'A', kind: 'dir', path: dir, board: 'web' },
      { id: 'beta', title: 'B', kind: 'dir', path: dir },
    ],
  });
  const { registry } = quietLoad({ path: file });

  assert.equal(registry.ok, true);
  assert.equal(registry.resolve('alpha').path, dir);
  assert.equal(registry.resolve('alpha').board, 'web');
  assert.equal(registry.resolve('beta').kind, 'dir');
  assert.equal(registry.resolve('missing'), null);
});

/* ---- 已退役功能留下的键（2026-10-14）：跳过并 warn，服务照常起 ---- */

test('退役的键：顶层 folders / pageFolders / pageOrder 与条目的 folder / order / page / role 跳过并 warn，条目照常读', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    folders: [{ id: 'shipped', name: '已上线' }],
    pageFolders: { 'component-library': 'shipped' },
    pageOrder: { 'component-library': 2 },
    entries: [
      { id: 'alpha', kind: 'dir', path: dir, folder: 'shipped', order: 0 },
      { id: 'note', kind: 'dir', path: dir, page: 'alpha', role: 'draft' },
    ],
  });
  const { registry, logs } = quietLoad({ path: file });

  assert.equal(registry.ok, true, '退役的键不是 error');
  assert.deepEqual(registry.errors, []);
  assert.deepEqual(registry.entries, [
    { id: 'alpha', title: 'alpha', kind: 'dir', path: dir },
    { id: 'note', title: 'note', kind: 'dir', path: dir },
  ], '带 page 的老条目照常自成一页');
  assert.equal('folders' in registry, false);
  assert.deepEqual(registry.warnings, [
    '"folders" belongs to a retired feature — ignored',
    '"pageFolders" belongs to a retired feature — ignored',
    '"pageOrder" belongs to a retired feature — ignored',
    'entry "alpha" field "folder" belongs to a retired feature — ignored',
    'entry "alpha" field "order" belongs to a retired feature — ignored',
    'entry "note" field "page" belongs to a retired feature — ignored',
    'entry "note" field "role" belongs to a retired feature — ignored',
  ]);
  assert.equal(logs.length, 7, '每条 warning 都进日志');
});

test('退役的 url 条目：整条跳过并 warn，不算 error；同 id 的后续条目照常读，与其它退役键并存也不崩', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    folders: [{ id: 'shipped', name: '已上线' }],
    entries: [
      { id: 'my-app', title: 'My App', kind: 'url', url: 'http://127.0.0.1:5173', folder: 'shipped' },
      { id: 'no-url', kind: 'url' },
      { id: 'alpha', kind: 'dir', path: dir },
      { id: 'my-app', title: 'My App (dir)', kind: 'dir', path: dir },
    ],
  });
  const { registry, logs } = quietLoad({ path: file });

  assert.equal(registry.ok, true, '退役的 kind 不是 error');
  assert.deepEqual(registry.errors, []);
  assert.deepEqual(registry.entries, [
    { id: 'alpha', title: 'alpha', kind: 'dir', path: dir },
    { id: 'my-app', title: 'My App (dir)', kind: 'dir', path: dir },
  ]);
  assert.equal(registry.resolve('my-app').kind, 'dir');
  assert.deepEqual(registry.warnings, [
    '"folders" belongs to a retired feature — ignored',
    'entry "my-app" kind "url" belongs to a retired feature — skipped',
    'entry "no-url" kind "url" belongs to a retired feature — skipped',
  ]);
  assert.equal(logs.length, 3, '每条 warning 都进日志');
});

test('PINPOINT_REGISTRY overrides the default registry path', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    entries: [{ id: 'env-entry', title: 'x', kind: 'dir', path: dir }],
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

