import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import previewHmr from './preview-hmr.js';
import { loadRegistry } from './lib/registry.js';
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

  // 子目录里的资源同样接住；顶层 board.json 照旧。嵌套 board.json 不是板，但
  // .json 可能是帧 import 的数据（进 deps），现在同样触发 —— recompile-plan 认领
  // 不到 → 整页重编，多编不少编。
  s.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(pageDir, 'components', 'X.css'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'tpl-page' } }]);
  s.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(pageDir, 'board.json'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'tpl-page' } }]);
  s.sent.length = 0;
  await hit.handleHotUpdate({ file: path.join(pageDir, 'components', 'board.json'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'tpl-page' } }]);
});

test('deps 可能出现的 json / ts / tsx / mjs / cjs 也触发重编；dist、build.json、node_modules 不触发（review 必须修 2）', async () => {
  // dist 故意放进条目目录里：这是会自触发循环的布局（EXT 不存在，没有编译目标，
  // 什么都不会写盘；命中的文件走「无编译目标 → 直接通知」分支）。
  const distRoot = path.join(EXT, 'dist-out');
  const hit = previewHmr({ registry: { entries: ENTRIES }, distRoot });
  const s = fakeServer();
  for (const name of ['data.json', 'util.ts', 'Card.tsx', 'lib.mjs', 'lib.cjs']) {
    s.sent.length = 0;
    await hit.handleHotUpdate({ file: path.join(EXT, name), server: s });
    assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'ext-page' } }], name);
  }
  // 编译自己写出的东西与依赖目录：盯了就是「写盘 → 事件 → 再编译」的循环。
  for (const file of [
    path.join(EXT, 'node_modules', 'pkg', 'index.js'),
    path.join(EXT, 'node_modules', 'pkg', 'package.json'),
    path.join(EXT, 'build.json'),
    path.join(distRoot, 'ext-page', 'home.html'),
  ]) {
    s.sent.length = 0;
    assert.equal(await hit.handleHotUpdate({ file, server: s }), undefined, file);
    assert.equal(s.sent.length, 0, file);
  }
});

test('syncWatcher 只挂仓外条目，仓库自身跳过', async (t) => {
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

test('增量重编的通知带屏清单（S2/F2：工作台按屏重摆）；整页重编不带', async (t) => {
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-screens-'));
  t.after(() => fs.rmSync(pageDir, { recursive: true, force: true }));
  const board = { sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }] };
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify(board));
  fs.writeFileSync(path.join(pageDir, 'a.html'), '<div class="ios-app">a1</div>\n');
  fs.writeFileSync(path.join(pageDir, 'b.html'), '<div class="ios-app">b1</div>\n');
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const hit = previewHmr({ registry: { entries: [{ id: 'screens-page', kind: 'dir', path: pageDir }] }, distRoot });
  const s = fakeServer();
  // 整页（首编 / 板变更）：不带屏清单，客户端整板重摆。
  await hit.handleHotUpdate({ file: path.join(pageDir, 'board.json'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'screens-page' } }]);
  // 增量：带重编过的屏清单。
  s.sent.length = 0;
  fs.writeFileSync(path.join(pageDir, 'a.html'), '<div class="ios-app">a2</div>\n');
  await hit.handleHotUpdate({ file: path.join(pageDir, 'a.html'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'screens-page', screens: ['a'] } }]);
});

test('registry dir 源码 add：删除重建后 watcher 重扫只交付 add，dist 从 v1 到 v2 并发 preview:update（hmr-watch-probe 根因）', async (t) => {
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-add-'));
  t.after(() => fs.rmSync(pageDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify({
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'home', title: 'Home' }] }],
  }));
  fs.writeFileSync(path.join(pageDir, 'home.html'), '<div class="ios-app">v1</div>\n');
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const hit = previewHmr({ registry: { entries: [{ id: 'add-page', kind: 'dir', path: pageDir }] }, distRoot, collectMs: 0 });
  // 真实 configureServer 注册的 add 回调：fakeServer 的 watcher 补上 on 收集，
  // 事件从注册入口进，编译与磁盘产物全真。
  const handlers = {};
  const s = fakeServer();
  s.watcher.on = (event, fn) => { handlers[event] = fn; };
  await hit.configureServer(s);
  assert.equal(fs.readFileSync(path.join(distRoot, 'add-page', 'home.html'), 'utf8'), '<div class="ios-app">v1</div>\n');
  // 探针实测的形状：目录删除重建后 v2 写入落在重扫窗口里，Vite 只交付 add
  // （handleHotUpdate 收不到），dist 停在 v1。
  fs.writeFileSync(path.join(pageDir, 'home.html'), '<div class="ios-app">v2</div>\n');
  await handlers.add(path.join(pageDir, 'home.html'));
  assert.equal(fs.readFileSync(path.join(distRoot, 'add-page', 'home.html'), 'utf8'), '<div class="ios-app">v2</div>\n');
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'add-page', screens: ['home'] } }]);
});

test('add/unlink 边界：dist、node_modules、未登记路径、无板 dir、file 条目的 add 与 dir 条目的 unlink 都不重编不通知', async (t) => {
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-add-edge-'));
  t.after(() => fs.rmSync(pageDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify({
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'home', title: 'Home' }] }],
  }));
  fs.writeFileSync(path.join(pageDir, 'home.html'), '<div class="ios-app">v1</div>\n');
  const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-plain-'));
  t.after(() => fs.rmSync(plainDir, { recursive: true, force: true }));
  const singleFile = path.join(plainDir, 'single.html');
  fs.writeFileSync(singleFile, '<p>单文件</p>\n');
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const entries = [
    { id: 'add-page', kind: 'dir', path: pageDir },
    { id: 'plain-dir', kind: 'dir', path: plainDir },
    { id: 'one-file', kind: 'file', path: singleFile },
  ];
  const hit = previewHmr({ registry: { entries }, distRoot, collectMs: 0 });
  const handlers = {};
  const s = fakeServer();
  s.watcher.on = (event, fn) => { handlers[event] = fn; };
  await hit.configureServer(s);
  s.sent.length = 0;
  // 编译产物与依赖目录不进编译分支（盯了就是自触发循环）。
  await handlers.add(path.join(distRoot, 'add-page', 'home.html'));
  await handlers.add(path.join(pageDir, 'node_modules', 'pkg', 'index.js'));
  await handlers.add(path.join(pageDir, 'build.json'));
  // 未登记路径不管。
  await handlers.add(path.join(os.tmpdir(), 'elsewhere.html'));
  // 无板 dir 与 file 条目的 add 保持不重编不通知（change 的「无编译目标 → 通知」
  // 分支不搬到 add：无板目录新建文件没有待刷新的编译产物）。
  await handlers.add(path.join(plainDir, 'new.html'));
  await handlers.add(singleFile);
  // 删除维持原边界：registry 条目的 unlink 不重编不通知（只 project 刷列表 digest）。
  await handlers.unlink(path.join(pageDir, 'home.html'));
  assert.deepEqual(s.sent, []);
  assert.equal(fs.readFileSync(path.join(distRoot, 'add-page', 'home.html'), 'utf8'), '<div class="ios-app">v1</div>\n');
});

test('首事件等一小拍收同伴：收集窗走完、收口之前才到的第二拍仍并进同一次编译（S2/F3）', async (t) => {
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-collect-'));
  t.after(() => fs.rmSync(pageDir, { recursive: true, force: true }));
  const board = { sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }] };
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify(board));
  fs.writeFileSync(path.join(pageDir, 'a.html'), '<div class="ios-app">a1</div>\n');
  fs.writeFileSync(path.join(pageDir, 'b.html'), '<div class="ios-app">b1</div>\n');
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  // 第二拍卡在「首批收口之后、窗口再开的那一次之前」。同一 tick 进来的两拍没有
  // 窗口也会并进 pending（review 建议 4：COLLECT_MS 改 0 旧断言照样过），锁不住 80ms。
  // 窗口在时这一拍还算这一批；窗口改成 0 时再开的那一次立刻返回，它落进下一次编译。
  let primed = false;
  const hit = previewHmr({
    registry: { entries: [{ id: 'collect-page', kind: 'dir', path: pageDir }] },
    distRoot,
    onCompileStart(pending) {
      if (!primed) return;
      primed = false;
      const bFile = path.join(pageDir, 'b.html');
      fs.writeFileSync(bFile, '<div class="ios-app">b2</div>\n');
      pending.add(bFile);
    },
  });
  const s = fakeServer();
  await hit.handleHotUpdate({ file: path.join(pageDir, 'board.json'), server: s });
  s.sent.length = 0;
  primed = true;
  fs.writeFileSync(path.join(pageDir, 'a.html'), '<div class="ios-app">a2</div>\n');
  await hit.handleHotUpdate({ file: path.join(pageDir, 'a.html'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'collect-page', screens: ['a', 'b'] } }]);
  assert.equal(fs.readFileSync(path.join(distRoot, 'collect-page', 'a.html'), 'utf8'), '<div class="ios-app">a2</div>\n');
  assert.equal(fs.readFileSync(path.join(distRoot, 'collect-page', 'b.html'), 'utf8'), '<div class="ios-app">b2</div>\n');
});

// 登记根与事件路径的等价拼写（owner 第四轮现场：登记 /var/...，watcher 可交付
// realpath 形态 /private/var/...；macOS 上 /var 是 /private/var 的 symlink）。
// 归属只按登记拼写做字符串前缀比较时，同一实体的事件落不进归属/过滤/编译。
// fixture 用显式 symlink 造同一实体的两种拼写，不依赖平台自身的 alias。
function aliasPair(t, prefix) {
  const real = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(real, { recursive: true, force: true }));
  const alias = path.join(os.tmpdir(), `${prefix}link-${path.basename(real)}`);
  fs.symlinkSync(real, alias);
  t.after(() => fs.rmSync(alias, { force: true }));
  return { real, alias };
}

test('registry dir 的等价路径事件（realpath 拼写）照常归属：change/add 都单屏重编（owner 第四轮条件缺口）', async (t) => {
  const { real, alias } = aliasPair(t, 'pp-hmr-eq-');
  const board = { sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }] };
  fs.writeFileSync(path.join(real, 'board.json'), JSON.stringify(board));
  fs.writeFileSync(path.join(real, 'a.html'), '<div class="ios-app">a1</div>\n');
  fs.writeFileSync(path.join(real, 'b.html'), '<div class="ios-app">b1</div>\n');
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  // 登记用 alias 拼写（owner 现场的 /var/... 角色），事件交付 realpath 拼写。
  const hit = previewHmr({ registry: { entries: [{ id: 'alias-page', kind: 'dir', path: alias }] }, distRoot, collectMs: 0 });
  const handlers = {};
  const s = fakeServer();
  s.watcher.on = (event, fn) => { handlers[event] = fn; };
  await hit.configureServer(s);
  assert.equal(fs.readFileSync(path.join(distRoot, 'alias-page', 'a.html'), 'utf8'), '<div class="ios-app">a1</div>\n');
  const bBefore = fs.statSync(path.join(distRoot, 'alias-page', 'b.html')).mtimeMs;

  // change 入口：归属 alias-page 且只重编 a（归一化回登记拼写，planPageRecompile 才能按屏认领）。
  fs.writeFileSync(path.join(real, 'a.html'), '<div class="ios-app">a2</div>\n');
  await hit.handleHotUpdate({ file: path.join(real, 'a.html'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'alias-page', screens: ['a'] } }]);
  assert.equal(fs.readFileSync(path.join(distRoot, 'alias-page', 'a.html'), 'utf8'), '<div class="ios-app">a2</div>\n');
  assert.equal(fs.statSync(path.join(distRoot, 'alias-page', 'b.html')).mtimeMs, bBefore, '兄弟屏不重编');

  // add 入口：同一等价形状（删除重建后重扫只交付 add）。
  s.sent.length = 0;
  fs.writeFileSync(path.join(real, 'a.html'), '<div class="ios-app">a3</div>\n');
  await handlers.add(path.join(real, 'a.html'));
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'alias-page', screens: ['a'] } }]);
  assert.equal(fs.readFileSync(path.join(distRoot, 'alias-page', 'a.html'), 'utf8'), '<div class="ios-app">a3</div>\n');

  // 登记拼写（raw）的常规事件不受归一化影响。
  s.sent.length = 0;
  fs.writeFileSync(path.join(real, 'a.html'), '<div class="ios-app">a4</div>\n');
  await hit.handleHotUpdate({ file: path.join(alias, 'a.html'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'alias-page', screens: ['a'] } }]);

  // 共享 realpath 前缀的兄弟目录不误归属。
  const sibling = `${real}-sibling`;
  fs.mkdirSync(sibling, { recursive: true });
  t.after(() => fs.rmSync(sibling, { recursive: true, force: true }));
  fs.writeFileSync(path.join(sibling, 'a.html'), '<div class="ios-app">旁</div>\n');
  s.sent.length = 0;
  assert.equal(await hit.handleHotUpdate({ file: path.join(sibling, 'a.html'), server: s }), undefined);
  assert.deepEqual(s.sent, []);
});

test('project 文章帧的等价路径 change：归属该篇、单屏重编、发 preview:update（同一条件缺口）', async (t) => {
  const { real, alias } = aliasPair(t, 'pp-hmr-eqp-');
  const content = path.join(real, 'docs', 'pinpoint');
  const article = path.join(content, 'articles', 'flow');
  fs.mkdirSync(article, { recursive: true });
  fs.writeFileSync(path.join(content, 'project.json'), JSON.stringify({ id: 'demo', title: 'Demo' }));
  fs.writeFileSync(path.join(article, 'index.mdx'), '---\ntitle: 流程\n---\n\n<Section id="s" title="节">\n\n<Canvas frames={["a", "b"]} />\n\n</Section>\n');
  fs.writeFileSync(path.join(article, 'a.jsx'), 'export default function A() {\n  return <div className="ios-app">甲1</div>;\n}\n');
  fs.writeFileSync(path.join(article, 'b.jsx'), 'export default function B() {\n  return <div className="ios-app">乙1</div>;\n}\n');
  // 登记 alias 拼写；loadRegistry 出 projects，projectDirs/findProject 才生效。
  const registryPath = path.join(real, 'registry.json');
  fs.writeFileSync(registryPath, JSON.stringify({ version: 1, entries: [{ id: 'demo', kind: 'project', path: alias }] }));
  const registry = loadRegistry({ path: registryPath, root: real, log: () => {} });
  const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-hmr-dist-'));
  t.after(() => fs.rmSync(distRoot, { recursive: true, force: true }));
  const hit = previewHmr({ registry, distRoot, collectMs: 0 });
  const s = fakeServer();
  await hit.configureServer(s);
  assert.match(fs.readFileSync(path.join(distRoot, 'demo_flow', 'a.html'), 'utf8'), /甲1/);
  const bBefore = fs.statSync(path.join(distRoot, 'demo_flow', 'b.html')).mtimeMs;

  fs.writeFileSync(path.join(article, 'a.jsx'), 'export default function A() {\n  return <div className="ios-app">甲2</div>;\n}\n');
  await hit.handleHotUpdate({ file: path.join(article, 'a.jsx'), server: s });
  assert.deepEqual(s.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'demo_flow', screens: ['a'] } }]);
  assert.match(fs.readFileSync(path.join(distRoot, 'demo_flow', 'a.html'), 'utf8'), /甲2/);
  assert.equal(fs.statSync(path.join(distRoot, 'demo_flow', 'b.html')).mtimeMs, bBefore, '兄弟帧不重编');
});
