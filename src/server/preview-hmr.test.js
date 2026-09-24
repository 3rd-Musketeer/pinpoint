import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import previewHmr from './preview-hmr.js';
import { fakeServer } from './test-harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = path.join(ROOT, '..', 'external-site');


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

test('模板页 components/ 子目录变更 → 重编 + preview:update（M2）', async (t) => {
  // 造一个模板页：root/content/previews/<页>/，帧 + components/X.jsx。
  const templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-tpl-'));
  t.after(() => fs.rmSync(templateRoot, { recursive: true, force: true }));
  const pageDir = path.join(templateRoot, 'content', 'previews', 'tpl-page');
  fs.mkdirSync(path.join(pageDir, 'components'), { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify({
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'home', title: 'Home' }] }],
  }));
  fs.writeFileSync(path.join(pageDir, 'home.html'), '<div class="ios-app">第一版</div>\n');
  fs.writeFileSync(path.join(pageDir, 'components', 'X.jsx'), 'export default function X(){return null}\n');
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const hit = previewHmr({ registry: { entries: [] }, distRoot, templateRoot });
  const s = fakeServer();

  // 组件子目录变更（旧正则只认顶层单段文件名，这里静默失配不重编）。
  const out = await hit.handleHotUpdate({ file: path.join(pageDir, 'components', 'X.jsx'), server: s });
  assert.deepEqual(out, []);
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'tpl-page' } }]);

  // 子目录里的资源同样接住；顶层 board.json 照旧；嵌套 board.json 不是板。
  s.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(pageDir, 'components', 'X.css'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'tpl-page' } }]);
  s.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(pageDir, 'board.json'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'tpl-page' } }]);
  s.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(pageDir, 'components', 'board.json'), server: s });
  assert.equal(s.sent.length, 0);
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
  // 无板条目（ext-page）不在通知集。范例页（example）是仓库真实 manifest 里的
  // 模板页且 kit 印章入编译期产物，通知集随它入场多一页——这正是该分支要保证的
  // 「模板页也在印章重编的通报范围内」。
  assert.deepEqual(out, []);
  assert.deepEqual(s.sent.filter((m) => m.event === 'preview:update').map((m) => m.data.id), ['e2e-ios', 'example']);
});

test('编译期间到达的变更：job 收尾后补跑一轮，dist 落最后状态（R11）', async (t) => {
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-rerun-'));
  t.after(() => fs.rmSync(pageDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify({
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'home', title: 'Home' }] }],
  }));
  fs.writeFileSync(path.join(pageDir, 'home.html'), '<div class="ios-app">第一版</div>\n');
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const hit = previewHmr({ registry: { entries: [{ id: 'rerun-page', kind: 'dir', path: pageDir }] }, distRoot });
  const s = fakeServer();
  // .html 帧在 compilePage 的第一个同步段就读盘：第一个 job 确定拿「第一版」。
  const first = hit.handleHotUpdate({ file: path.join(pageDir, 'home.html'), server: s });
  fs.writeFileSync(path.join(pageDir, 'home.html'), '<div class="ios-app">第二版</div>\n');
  const second = hit.handleHotUpdate({ file: path.join(pageDir, 'home.html'), server: s });
  await Promise.all([first, second]);
  // 没有补跑的话这里停在「第一版」——编译期间的新事件拿到的是变更前结果。
  assert.equal(
    fs.readFileSync(path.join(distRoot, 'rerun-page', 'home.html'), 'utf8'),
    '<div class="ios-app">第二版</div>\n',
  );
});

test('编译期间到达多个变更：补跑合并全部变更文件，逐屏命中各编各的（审计 B1）', async (t) => {
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-merge-'));
  t.after(() => fs.rmSync(pageDir, { recursive: true, force: true }));
  const board = { sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }] };
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify(board));
  fs.writeFileSync(path.join(pageDir, 'a.html'), '<div class="ios-app">a1</div>\n');
  fs.writeFileSync(path.join(pageDir, 'b.html'), '<div class="ios-app">b1</div>\n');
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const hit = previewHmr({ registry: { entries: [{ id: 'merge-page', kind: 'dir', path: pageDir }] }, distRoot });
  const s = fakeServer();
  // 先全量一次，让 build.json 建起依赖图。
  await hit.handleHotUpdate({ file: path.join(pageDir, 'board.json'), server: s });
  // 编译 a=a2 期间，b 与 a 自己又各来一拍：两个事件都在 inflight 期进 pending，
  // 补跑那轮合并成一批 [b, a] —— 只拿最后一个事件的话 b 会停在 b1。
  const aFinal = '<div class="ios-app">a3</div>\n';
  const bFinal = '<div class="ios-app">b2</div>\n';
  fs.writeFileSync(path.join(pageDir, 'a.html'), '<div class="ios-app">a2</div>\n');
  const first = hit.handleHotUpdate({ file: path.join(pageDir, 'a.html'), server: s });
  fs.writeFileSync(path.join(pageDir, 'b.html'), bFinal);
  const second = hit.handleHotUpdate({ file: path.join(pageDir, 'b.html'), server: s });
  fs.writeFileSync(path.join(pageDir, 'a.html'), aFinal);
  const third = hit.handleHotUpdate({ file: path.join(pageDir, 'a.html'), server: s });
  await Promise.all([first, second, third]);
  assert.equal(fs.readFileSync(path.join(distRoot, 'merge-page', 'a.html'), 'utf8'), aFinal);
  assert.equal(fs.readFileSync(path.join(distRoot, 'merge-page', 'b.html'), 'utf8'), bFinal);
});

test('改一屏只重编该屏：其余屏的 dist 产物不重写（审计 B1）', async (t) => {
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-pick-'));
  t.after(() => fs.rmSync(pageDir, { recursive: true, force: true }));
  const board = { sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }] };
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify(board));
  fs.writeFileSync(path.join(pageDir, 'a.html'), '<div class="ios-app">a1</div>\n');
  fs.writeFileSync(path.join(pageDir, 'b.html'), '<div class="ios-app">b1</div>\n');
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const hit = previewHmr({ registry: { entries: [{ id: 'pick-page', kind: 'dir', path: pageDir }] }, distRoot });
  const s = fakeServer();
  await hit.handleHotUpdate({ file: path.join(pageDir, 'board.json'), server: s });
  const bBefore = fs.statSync(path.join(distRoot, 'pick-page', 'b.html')).mtimeMs;
  // 只动 a 的帧：b 的产物 mtime 必须原地不动 —— 这是「只重编该屏」的观察点。
  fs.writeFileSync(path.join(pageDir, 'a.html'), '<div class="ios-app">a2</div>\n');
  await hit.handleHotUpdate({ file: path.join(pageDir, 'a.html'), server: s });
  assert.equal(fs.readFileSync(path.join(distRoot, 'pick-page', 'a.html'), 'utf8'), '<div class="ios-app">a2</div>\n');
  assert.equal(fs.statSync(path.join(distRoot, 'pick-page', 'b.html')).mtimeMs, bBefore);
});
