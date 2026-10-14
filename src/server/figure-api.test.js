// /api/frame?…&figure=…&embed=figure 与 POST /api/figure-error（docs/projects.md“图”）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import frameApi from './frame-api.js';
import { readFigureRecord } from './lib/page-compiler.js';

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

async function serve(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-figure-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'proj');
  const article = path.join(root, 'docs', 'pinpoint', 'articles', 'flow');
  write(path.join(root, 'docs', 'pinpoint', 'project.json'), JSON.stringify({ id: 'demo' }));
  write(path.join(article, 'index.mdx'), '<Figure src="figures/steps.jsx" />\n');
  write(path.join(article, 'figures', 'steps.jsx'), 'export default function Steps() {\n  return <svg viewBox="0 0 10 10"><g data-step="1" /></svg>;\n}\n');
  write(path.join(article, 'figures', 'steps.js'), 'export default function mount() {}\n');
  write(path.join(article, 'figures', 'steps.css'), '.a {}\n');
  write(path.join(article, 'figures', 'broken.jsx'), 'export default function Broken() {\n  return <svg onClick={x} />;\n}\n');
  const registry = { entries: [], projects: [{ id: 'demo', kind: 'project', path: root }] };
  const distRoot = path.join(dir, 'dist');
  let middleware = null;
  frameApi({ registry, distRoot }).configureServer({ middlewares: { use: (fn) => { middleware = fn; } } });
  const server = http.createServer((req, res) => middleware(req, res, () => { res.statusCode = 418; res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { origin: `http://127.0.0.1:${server.address().port}`, distRoot };
}

const frameUrl = (origin, query) => `${origin}/api/frame?${query}`;

test('图页：没有机壳、图注、标注客户端；带调色板、import map、本图的样式与 sidecar；theme 参数落在 <html>', async (t) => {
  const { origin } = await serve(t);
  const res = await fetch(frameUrl(origin, 'page=demo_flow&figure=steps&embed=figure&theme=dark'));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<html lang="zh-CN" data-annotate="off" data-pp-embed="figure" data-theme="dark">/);
  assert.match(html, /<base href="\/sites\/demo_flow\/">/);
  assert.match(html, /<script type="importmap">\{"imports":\{"pinpoint\/figure":"\/kits\/figure\/figure\.js"\}\}<\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/kits\/figure\/figure\.css">/);
  assert.match(html, /<link rel="stylesheet" href="figures\/steps\.css\?v=\d+">/);
  assert.match(html, /<div class="pp-figure" data-pp-figure-root="steps">\n<svg viewBox="0 0 10 10"/);
  assert.match(html, /"script":"\.\/figures\/steps\.js\?v=\d+"/);
  assert.doesNotMatch(html, /annotate(\.[0-9a-f]+)?\.js|wb-screen-cap|ios-stage|ios-kit\.css|__pinpointEntry/);
  // 不带 theme：跟系统或外层文章页。
  assert.doesNotMatch(await (await fetch(frameUrl(origin, 'page=demo_flow&figure=steps&embed=figure'))).text(), /<html[^>]*data-theme=/);
});

test('图页的错误：参数不成对 400，图或页不在 404，编译失败 500 且图的位置写原因', async (t) => {
  const { origin } = await serve(t);
  for (const query of ['page=demo_flow&figure=steps', 'page=demo_flow&screen=x&embed=figure', 'page=demo_flow&figure=steps&embed=bogus', 'page=demo_flow&figure=../x&embed=figure']) {
    assert.equal((await fetch(frameUrl(origin, query))).status, 400, query);
  }
  assert.equal((await fetch(frameUrl(origin, 'page=demo_flow&figure=ghost&embed=figure'))).status, 404);
  assert.equal((await fetch(frameUrl(origin, 'page=demo_nope&figure=steps&embed=figure'))).status, 404);
  const broken = await fetch(frameUrl(origin, 'page=demo_flow&figure=broken&embed=figure'));
  assert.equal(broken.status, 500);
  const html = await broken.text();
  assert.match(html, /data-figure-error="figures\/broken\.jsx:2: 禁止事件属性 onClick/);
  assert.match(html, /<div class="fig-error" role="alert"><b>这个图编译失败<\/b>figures\/broken\.jsx:2: /);
  assert.match(html, /"builtAt":0,"script":null/);
});

test('POST /api/figure-error：同源才收，builtAt 对上这一版才记', async (t) => {
  const { origin, distRoot } = await serve(t);
  await fetch(frameUrl(origin, 'page=demo_flow&figure=steps&embed=figure'));
  const { builtAt } = readFigureRecord(distRoot, 'demo_flow', 'steps');
  const post = (body, headers = {}) => fetch(`${origin}/api/figure-error`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ page: 'demo_flow', figure: 'steps', builtAt, message: 'x' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post({ page: 'demo_flow', figure: 'ghost', builtAt, message: 'x' })).status, 404);
  assert.deepEqual(await (await post({ page: 'demo_flow', figure: 'steps', builtAt: 1, message: '旧版' })).json(), { recorded: false });
  assert.deepEqual(await (await post({ page: 'demo_flow', figure: 'steps', builtAt, message: 'boom', line: 4 }, { 'sec-fetch-site': 'same-origin' })).json(), { recorded: true });
  assert.deepEqual(readFigureRecord(distRoot, 'demo_flow', 'steps').runtimeError, { message: 'boom', line: 4 });
  assert.equal((await fetch(`${origin}/api/figure-error`)).status, 405);
});
