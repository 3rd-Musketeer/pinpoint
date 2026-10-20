import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import frameApi from './frame-api.js';
import { resolvePageTarget } from './lib/board-source.js';
import { compilePage, loadDistScreenHtml, readDistScreen } from './lib/page-compiler.js';
import { loadRegistry } from './lib/registry.js';
import { mockReq, mockRes } from './test-harness.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-frame-freshness-'));
  const previous = process.env.PINPOINT_DATA_DIR;
  process.env.PINPOINT_DATA_DIR = path.join(dir, 'data');
  t.after(() => {
    if (previous === undefined) delete process.env.PINPOINT_DATA_DIR;
    else process.env.PINPOINT_DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const article = path.join(dir, 'docs/pinpoint/articles/flow');
  fs.mkdirSync(path.join(article, 'components'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/pinpoint/project.json'), JSON.stringify({ id: 'demo', title: 'Demo' }));
  fs.writeFileSync(path.join(article, 'index.mdx'), '---\ntitle: 流程\n---\n<Section id="main" title="流程">\n<Canvas frames={["home", "later"]} />\n</Section>\n');
  const stamps = new Map();
  const write = (name, text) => {
    const file = path.join(article, name);
    fs.writeFileSync(file, text);
    // 不依赖 APFS 同一时间格内的两次保存：每次保存明确属于下一代。
    const stamp = Math.max(Date.now(), stamps.get(file) || 0) + 1000;
    stamps.set(file, stamp);
    fs.utimesSync(file, stamp / 1000, stamp / 1000);
    return file;
  };
  write('home.jsx', 'export default function Home() { return <div className="ios-app">初稿</div>; }');
  write('later.jsx', 'export default function Later() { return <div className="ios-app">稍后初稿</div>; }');
  const registryFile = path.join(dir, 'registry.json');
  fs.writeFileSync(registryFile, JSON.stringify({ version: 1, entries: [{ id: 'demo', kind: 'project', path: dir }] }));
  const registry = loadRegistry({ path: registryFile, root: dir, log: () => {} });
  const target = resolvePageTarget('demo_flow', { registry });
  let middleware;
  frameApi({ registry }).configureServer({ middlewares: { use(fn) { middleware = fn; } } });
  const request = async (screen, embed = 'card', headers = {}, control = () => {}) => {
    const req = mockReq('GET', `/api/frame?page=demo_flow&screen=${screen}${embed ? `&embed=${embed}` : ''}&annotate=off`);
    req.headers = headers;
    const res = mockRes();
    const events = new EventEmitter();
    res.on = events.on.bind(events);
    res.off = events.off.bind(events);
    res.emit = events.emit.bind(events);
    const pending = middleware(req, res, () => assert.fail('应由帧 API 响应'));
    control(req, res);
    await pending;
    return res;
  };
  return { article, target, write, request };
}

test('文章嵌入帧：请求抢在 watcher 前、条件请求与稍后懒加载都返回当前源码', async (t) => {
  const { target, write, request } = fixture(t);
  assert.equal((await compilePage(target)).ok, true);
  const first = await request('home');
  assert.match(first.text, /初稿/);
  write('home.jsx', 'export default function Home() { return <div className="ios-app">修订稿</div>; }');
  // Astro reload 已发生，pinpoint watcher 尚未开始：不能等另一条 reload 自愈。
  const revised = await request('home', 'card', { 'if-none-match': first.headers.ETag });
  assert.equal(revised.statusCode, 200);
  assert.match(revised.text, /修订稿/);
  assert.notEqual(revised.headers.ETag, first.headers.ETag);
  assert.equal((await request('home', 'card', { 'if-none-match': revised.headers.ETag })).statusCode, 304, '未改稿时仍可条件命中');
  write('later.jsx', 'export default function Later() { return <div className="ios-app">稍后修订稿</div>; }');
  assert.match((await request('later')).text, /稍后修订稿/, '此前未挂载的卡片首取也须是新稿');
  write('home.jsx', 'export default function Home() { return <div className="ios-app">独立嵌入修订稿</div>; }');
  assert.match((await request('home', '')).text, /独立嵌入修订稿/, '不带 embed 的嵌入端点走同一保证');
});

test('R1：连续保存时只满足请求进入时的目标，不追赶发布之后的新保存', async (t) => {
  const { target, write, request } = fixture(t);
  await compilePage(target);
  write('home.jsx', 'export default function Home() { return <div className="ios-app">请求目标稿</div>; }');
  const original = fs.writeFileSync;
  let publishes = 0;
  const probe = t.mock.method(fs, 'writeFileSync', function (file, ...args) {
    const result = original.call(this, file, ...args);
    if (String(file).endsWith('/dist/demo_flow/home.html') && ++publishes < 6) {
      write('home.jsx', `export default function Home() { return <div className="ios-app">后继稿 ${publishes}</div>; }`);
    }
    return result;
  });
  const response = await request('home');
  probe.mock.restore();
  assert.equal(publishes, 1, '第一次满足目标就出帧；后继保存由编译完成通知推进');
  assert.ok(response.text.includes('请求目标稿'));
});

test('R1：断连只结束自身等待，既有编译继续，断连请求不发布额外编译或写响应', async (t) => {
  const { target, request } = fixture(t);
  let finished = false;
  const compiling = compilePage(target).then(() => { finished = true; });
  const response = await request('home', 'card', {}, (req) => req.emit('aborted'));
  assert.equal(finished, false, '不能等既有编译完成才处理断连');
  assert.equal(response.writableEnded, false, '断连后不发送 500 或旧帧');
  await compiling;
  assert.equal((await request('home')).statusCode, 200, '取消不破坏其他消费者的编译');
});

test('R1：GET 响应 close 同样结束等待，并清理断连监听', async (t) => {
  const { target, request } = fixture(t);
  let finished = false;
  const compiling = compilePage(target).then(() => { finished = true; });
  const response = await request('home', 'card', {}, (_req, res) => res.emit('close'));
  assert.equal(finished, false);
  assert.equal(response.writableEnded, false);
  await compiling;
});

test('文章嵌入帧：在飞编译读完旧稿后再保存，请求必须等最新代且旧编译不能覆盖', async (t) => {
  const { target, write, request } = fixture(t);
  await compilePage(target);
  write('home.jsx', 'export default function Home() { return <div className="ios-app">第二稿</div>; }');
  const writeFile = fs.writeFileSync;
  let latest;
  let intercepted = false;
  const probe = t.mock.method(fs, 'writeFileSync', function (file, ...args) {
    // 第二稿已经编完、尚未发布；在这道落盘边界保存第三稿并让卡片来取。
    if (String(file).endsWith('/dist/demo_flow/home.html') && !intercepted) {
      intercepted = true;
      write('home.jsx', 'export default function Home() { return <div className="ios-app">第三稿</div>; }');
      latest = request('home');
    }
    return writeFile.call(this, file, ...args);
  });
  await compilePage(target, { onlyScreen: 'home' });
  probe.mock.restore();
  assert.ok(latest, '断点须发生在真实编译链');
  assert.match((await latest).text, /第三稿/);
  assert.match(readDistScreen(target.entryId, 'home').html, /第三稿/);
  assert.match((await loadDistScreenHtml(target, 'home')).html, /第三稿/);
});

test('文章嵌入帧：依赖在 esbuild 读完后改变，不能把旧 HTML 记成新依赖的产物', async (t) => {
  const { target, write, request } = fixture(t);
  write('home.jsx', 'import Label from "./components/Label.jsx"; export default function Home() { return <div className="ios-app"><Label /></div>; }');
  const dependency = write('components/Label.jsx', 'export default function Label() { return <p>依赖初稿</p>; }');
  const read = fs.readFileSync;
  let intercepted = false;
  const probe = t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const text = read.call(this, file, ...args);
    // esbuild 由原生进程读文件；Node 第一次读这个组件是打包后的 lint。
    if (String(file) === dependency && !intercepted) {
      intercepted = true;
      write('components/Label.jsx', 'export default function Label() { return <p>依赖修订稿</p>; }');
    }
    return text;
  });
  await compilePage(target);
  probe.mock.restore();
  assert.ok(intercepted);
  assert.ok((await request('home')).text.includes('依赖修订稿'), '记录必须反映编译读入的依赖代次');
});

test('共享出帧：存量板的 mtime 在未来也按输入代次收敛，不按 builtAt 反复编译', { timeout: 3000 }, async (t) => {
  const { target, write } = fixture(t);
  const legacy = { ...target, kind: 'dir' };
  write('board.json', JSON.stringify({ sections: [{ id: 'main', screens: [{ id: 'home' }] }] }));
  const first = await loadDistScreenHtml(legacy, 'home');
  assert.ok(first.ok);
  assert.ok(first.html.includes('初稿'));
  write('board.json', JSON.stringify({ assets: { css: ['updated.css'] }, sections: [{ id: 'main', screens: [{ id: 'home' }] }] }));
  const revised = await loadDistScreenHtml(legacy, 'home');
  assert.ok(revised.ok);
  assert.ok(revised.html.includes('updated.css'));
});

test('R2：kit 回退变为本篇覆盖，watcher 前请求即采用新的解析选择', async (t) => {
  const { target, write, request } = fixture(t);
  write('home.jsx', 'import { Button } from "./components/Button.jsx"; export default function Home() { return <div className="ios-app"><Button>kit 回退</Button></div>; }');
  assert.equal((await compilePage(target)).ok, true);
  assert.ok((await request('home')).text.includes('kit 回退'));
  const file = write('components/Button.jsx', 'export function Button() { return <button>LOCAL OVERRIDE</button>; }');
  const local = await request('home');
  assert.ok(local.text.includes('LOCAL OVERRIDE'), '原 resolved kit 没变，但缺失的本篇候选已出现');
  fs.unlinkSync(file);
  const fallback = await request('home');
  assert.ok(fallback.text.includes('kit 回退'), '删除覆盖后重新采用 kit');
  assert.ok(!fallback.text.includes('LOCAL OVERRIDE'));
});

test('R4：失败请求不做负缓存，主文件或依赖修好后自动编译恢复', async (t) => {
  for (const dependency of [false, true]) await t.test(dependency ? '依赖语法错误' : '帧语法错误', async (t) => {
    const { target, write, request } = fixture(t);
    const file = dependency ? 'components/Label.jsx' : 'home.jsx';
    if (dependency) {
      write('home.jsx', 'import Label from "./components/Label.jsx"; export default function Home() { return <div className="ios-app"><Label /></div>; }');
      write(file, 'export default function Label() { return <p>初稿</p>; }');
    }
    await compilePage(target);
    write(file, 'export default function Broken() { return <broken ');
    const original = fs.writeFileSync;
    let writes = 0;
    const probe = t.mock.method(fs, 'writeFileSync', function (file, ...args) {
      if (String(file).endsWith('/dist/demo_flow/build.json')) writes++;
      return original.call(this, file, ...args);
    });
    for (let i = 0; i < 3; i++) assert.equal((await request('home')).statusCode, 500);
    assert.equal(writes, 6, '三次失败请求均重试（每次 build.json 写两次）');
    await compilePage(target, { onlyScreen: 'home' });
    const afterWatcher = writes;
    assert.equal((await request('home')).statusCode, 500);
    assert.equal(writes, afterWatcher + 2, 'watcher 尝试过的失败也不能阻止请求重试');
    write(file, 'export default function Fixed() { return <div className="ios-app">修好后自愈</div>; }');
    assert.ok((await request('home')).text.includes('修好后自愈'));
    assert.equal(writes, afterWatcher + 4);
    probe.mock.restore();
  });
});

test('R4：缺失默认 import 每次重试，新增文件后自动恢复', async (t) => {
  const { target, write, request } = fixture(t);
  write('home.jsx', 'import text from "./missing.js"; export default function Home() { return <div className="ios-app">{text}</div>; }');
  assert.equal((await request('home')).statusCode, 500);
  const original = fs.writeFileSync;
  let builds = 0;
  const probe = t.mock.method(fs, 'writeFileSync', function (file, ...args) {
    if (String(file).endsWith('/dist/demo_flow/build.json')) builds++;
    return original.call(this, file, ...args);
  });
  assert.equal((await request('home')).statusCode, 500);
  assert.equal(builds, 2);
  write('missing.js', 'export default "新增模块后自愈";');
  assert.ok((await request('home')).text.includes('新增模块后自愈'));
  assert.equal(builds, 4);
  probe.mock.restore();
});

test('R4：已有空目录的 import 失败后新增 index，watcher 前请求立即自愈', async (t) => {
  const { article, write, request } = fixture(t);
  fs.mkdirSync(path.join(article, 'pkg'));
  write('home.jsx', 'import text from "./pkg"; export default function Home() { return <div className="ios-app">{text}</div>; }');
  assert.equal((await request('home')).statusCode, 500);
  write('pkg/index.jsx', 'export default "目录入口修好后自愈";');
  const response = await request('home');
  assert.equal(response.statusCode, 200);
  assert.match(response.text, /目录入口修好后自愈/);
});
