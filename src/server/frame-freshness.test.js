import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
  const write = (name, text) => {
    const file = path.join(article, name);
    fs.writeFileSync(file, text);
    // 不依赖 APFS 同一时间格内的两次保存：每次保存明确属于下一代。
    const stamp = fs.statSync(file).mtimeMs + 1000;
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
  const request = async (screen, embed = 'card', headers = {}) => {
    const req = mockReq('GET', `/api/frame?page=demo_flow&screen=${screen}${embed ? `&embed=${embed}` : ''}&annotate=off`);
    req.headers = headers;
    const res = mockRes();
    await middleware(req, res, () => assert.fail('应由帧 API 响应'));
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
  write('later.jsx', 'export default function Later() { return <div className="ios-app">稍后修订稿</div>; }');
  assert.match((await request('later')).text, /稍后修订稿/, '此前未挂载的卡片首取也须是新稿');
  write('home.jsx', 'export default function Home() { return <div className="ios-app">独立嵌入修订稿</div>; }');
  assert.match((await request('home', '')).text, /独立嵌入修订稿/, '不带 embed 的嵌入端点走同一保证');
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
