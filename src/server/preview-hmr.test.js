import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import previewHmr from './preview-hmr.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = path.join(ROOT, '..', 'external-site');

function fakeServer() {
  const server = {
    sent: [],
    added: [],
    ws: { send(message) { server.sent.push(message); } },
    watcher: { add(target) { server.added.push(target); } },
  };
  return server;
}

function setup(t, entries) {
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const plugin = previewHmr({ registry: { entries }, distRoot });
  const server = fakeServer();
  return Promise.resolve(plugin.configureServer(server)).then(() => ({ plugin, server }));
}

const ENTRIES = [
  { id: 'pinpoint', kind: 'dir', path: ROOT },
  { id: 'ext-page', kind: 'dir', path: EXT },
  { id: 'ext-file', kind: 'file', path: path.join(EXT, '..', 'single.html') },
  { id: 'ext-url', kind: 'url', url: 'https://example.localhost' },
];

test('registry dir/file 条目变更 → preview:update（2026-08-17e；pp2 起 .css 也触发）', async (t) => {
  const { server } = await setup(t, ENTRIES);

  server.sent.length = 0;
  const hit = previewHmr({ registry: { entries: ENTRIES }, distRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-')) });
  const s2 = fakeServer();
  await hit.handleHotUpdate({ file: path.join(EXT, 'home.html'), server: s2 });
  assert.deepEqual(s2.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'ext-page' } }]);

  s2.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(EXT, 'board.json'), server: s2 });
  assert.deepEqual(s2.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'ext-page' } }]);

  s2.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(EXT, '..', 'single.html'), server: s2 });
  assert.deepEqual(s2.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'ext-file' } }]);

  // pp2：.css 变更同样触发该页重摆（编译器把 assets 注进每帧）。
  s2.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(EXT, 'style.css'), server: s2 });
  assert.deepEqual(s2.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'ext-page' } }]);

  // .js（sidecar）变更发 full-reload（ES module 缓存）。
  s2.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(EXT, 'pk.js'), server: s2 });
  assert.deepEqual(s2.sent, [{ type: 'full-reload' }]);

  // 非板/屏/资源文件不触发
  s2.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(EXT, 'notes.txt'), server: s2 });
  assert.equal(s2.sent.length, 0);

  // 仓库自身条目不吞 workbench 源码的默认 HMR；模板页退役后 /previews/ 下没有
  // 编译目标，该路径的变更不再发通知（pp2 切片 3）。
  s2.sent.length = 0;
  assert.equal(await hit.handleHotUpdate({ file: path.join(ROOT, 'workbench', 'stage.js'), server: s2 }), undefined);
  assert.equal(s2.sent.length, 0);
  s2.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(ROOT, 'previews', 'library', 'home.html'), server: s2 });
  assert.equal(s2.sent.length, 0);

  assert.ok(server);
});

test('syncWatcher 只挂仓外条目，仓库自身与 url 条目跳过', async (t) => {
  const { server } = await setup(t, ENTRIES);
  assert.deepEqual(server.added, [EXT, path.join(EXT, '..', 'single.html')]);
});

test('kit JSX 印章变更 → 全量重编并对每页发 preview:update（review 1-5 接力）', async (t) => {
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const entries = ENTRIES.concat([{ id: 'e2e-ios', kind: 'dir', path: path.join(ROOT, 'e2e', 'ios-site') }]);
  const hit = previewHmr({ registry: { entries }, distRoot });
  const s = fakeServer();
  const out = await hit.handleHotUpdate({ file: path.join(ROOT, 'content', 'kits', 'ios', 'jsx', 'Bubble.jsx'), server: s });
  // 编译期印章不吃 .js 的 full-reload（没有浏览器模块缓存）；全量重编后逐页通知，
  // 无板条目（ext-page）不在通知集。
  assert.deepEqual(out, []);
  assert.deepEqual(s.sent.filter((m) => m.event === 'preview:update').map((m) => m.data.id), ['e2e-ios']);
});
