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

test('deprecated HTML_ANNOTATE_REGISTRY still applies, with a warning, when PINPOINT_REGISTRY is absent', (t) => {
  const dir = withTempDir(t);
  const file = writeRegistry(dir, {
    version: 1,
    entries: [{ id: 'legacy-entry', title: 'x', kind: 'url', url: 'https://legacy.localhost' }],
  });
  const previousNew = process.env.PINPOINT_REGISTRY;
  const previousOld = process.env.HTML_ANNOTATE_REGISTRY;
  delete process.env.PINPOINT_REGISTRY;
  process.env.HTML_ANNOTATE_REGISTRY = file;
  t.after(() => {
    if (previousNew === undefined) delete process.env.PINPOINT_REGISTRY;
    else process.env.PINPOINT_REGISTRY = previousNew;
    if (previousOld === undefined) delete process.env.HTML_ANNOTATE_REGISTRY;
    else process.env.HTML_ANNOTATE_REGISTRY = previousOld;
  });

  const { registry, logs } = quietLoad();
  assert.equal(registry.path, file);
  assert.deepEqual(registry.entries.map((e) => e.id), ['legacy-entry']);
  assert.equal(logs.length, 1, 'deprecation is logged');
  assert.match(logs[0], /deprecated/);
});
