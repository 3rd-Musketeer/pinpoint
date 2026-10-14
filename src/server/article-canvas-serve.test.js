// pp3：文章画布页在服务各处都按普通页工作——/sites/<页 id>/、/api/frame、
// 标注桶、/registry 清单（不进 Pages）、/api/projects/…/canvas、文章页注入的桶、watch。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { annotationBucketFor } from './article-proxy.js';
import { articleIdOfPath } from './lib/article-routes.js';
import { createAnnotateHandler, resolveRequestEntry } from './annotate-api.js';
import { ensureAnnotateBundle } from './lib/annotate-bundle.js';
import { framePageHtml, resolveFrameTarget } from './lib/frame-doc.js';
import { loadRegistry } from './lib/registry.js';
import previewHmr from './preview-hmr.js';
import { createProjectsHandler } from './projects-api.js';
import { createSitesHandler } from './sites-api.js';
import { fakeServer, mockReq, mockRes } from './test-harness.js';
import { pageEntry, pageBaseUrl } from '../workbench/lib/page-url.js';

await ensureAnnotateBundle();

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-article-serve-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const previous = process.env.PINPOINT_DATA_DIR;
  process.env.PINPOINT_DATA_DIR = path.join(dir, 'data');
  t.after(() => {
    if (previous === undefined) delete process.env.PINPOINT_DATA_DIR;
    else process.env.PINPOINT_DATA_DIR = previous;
  });
  const root = path.join(dir, 'proj');
  const content = path.join(root, 'docs', 'pinpoint');
  const article = path.join(content, 'articles', 'flow');
  write(path.join(content, 'project.json'), JSON.stringify({ id: 'demo', title: 'Demo' }));
  write(path.join(article, 'index.mdx'), '---\ntitle: 流程\n---\n\n<Section id="ask" title="提问">\n\n<Canvas frames={["ask-open"]} />\n\n</Section>\n');
  write(path.join(article, 'ask-open.jsx'), 'export default function AskOpen() {\n  return <div className="ios-app">提问</div>;\n}\n');
  write(path.join(article, 'article.css'), '.x { color: red; }\n');
  write(path.join(dir, 'registry.json'), JSON.stringify({ version: 1, entries: [
    { id: 'demo', kind: 'project', path: root },
    { id: 'page', kind: 'dir', path: path.join(dir, 'page') },
  ] }));
  fs.mkdirSync(path.join(dir, 'page'));
  const registry = loadRegistry({ path: path.join(dir, 'registry.json'), root: dir, log: () => {} });
  return { dir, root, content, article, registry };
}

async function get(handler, url) {
  const req = mockReq('GET', url);
  const res = mockRes();
  const handled = await handler(req, res, url.split('?')[0]);
  return { handled, res };
}

test('/sites/<画布页 id>/：board.json 是派生的板 + dist，帧从 dist 出且注入画布桶，article.css 静态出，index.mdx 不出', async (t) => {
  const { registry } = fixture(t);
  const handler = createSitesHandler({ registry });
  const board = await get(handler, '/sites/demo_flow/board.json');
  assert.equal(board.res.statusCode, 200);
  const json = board.res.json;
  assert.deepEqual(json.sections, [{ id: 'ask', title: '提问', layout: 'row', letter: 'A', screens: [{ id: 'ask-open' }] }]);
  assert.deepEqual(json.assets, { css: ['article.css'] });
  assert.deepEqual(Object.keys(json.dist), ['builtAt', 'stale']);

  const frame = await get(handler, '/sites/demo_flow/ask-open.html');
  assert.equal(frame.res.statusCode, 200);
  assert.match(frame.res.text, /data-pp-comp="AskOpen">提问</);
  assert.match(frame.res.text, /window\.__pinpointEntry='demo_flow'/);
  const off = await get(handler, '/sites/demo_flow/ask-open.html?annotate=off');
  assert.doesNotMatch(off.res.text, /__pinpointEntry/);
  // 编过之后 dist 是新的。
  assert.equal((await get(handler, '/sites/demo_flow/board.json')).res.json.dist.stale, false);

  const css = await get(handler, '/sites/demo_flow/article.css');
  assert.equal(css.res.statusCode, 200);
  assert.match(css.res.headers['Content-Type'], /text\/css/);
  for (const url of ['/sites/demo_flow/index.mdx', '/sites/demo_flow/../../project.json', '/sites/demo_ghost/board.json', '/sites/demo_flow/ghost.html']) {
    assert.equal((await get(handler, url)).res.statusCode, 404, url);
  }
});

test('/api/frame 的目标：文章画布帧是 fragment，桶 = 画布页 id，HTML 出得来', async (t) => {
  const { registry } = fixture(t);
  const target = resolveFrameTarget('demo_flow', 'ask-open', { registry });
  assert.equal(target.kind, 'fragment');
  assert.equal(target.entry, 'demo_flow');
  assert.equal(target.shell, 'app');
  assert.equal(target.ref, 'A1');
  assert.equal(target.section, 'ask');
  assert.equal(target.baseUrl, '/sites/demo_flow/');
  const html = await framePageHtml(target, { annotate: false });
  assert.match(html, /data-pp-comp="AskOpen">提问</);
  assert.throws(() => resolveFrameTarget('demo_flow', 'ghost', { registry }), /unknown screen/);
  assert.throws(() => resolveFrameTarget('demo_ghost', 'ask-open', { registry }), /unknown page/);
});

// 原在 e2e/article-canvas.spec.js（2026-10-13 测试清理下移）：同一节里手机帧与帧级
// comp 混排时，/api/frame 各按各的 shell 出台子。
test('/api/frame 的台子：帧级 export const shell = "comp" 进组件台，同一节的手机帧进机壳', async (t) => {
  const { article, registry } = fixture(t);
  write(path.join(article, 'index.mdx'), '---\ntitle: 流程\n---\n\n<Section id="ask" title="提问">\n\n<Canvas frames={["ask-open", "ask-bare"]} />\n\n</Section>\n');
  write(path.join(article, 'ask-bare.jsx'), 'export const shell = "comp";\n\nexport default function AskBare() {\n  return <div className="bare-card">卡片</div>;\n}\n');
  const stage = async (screen) => {
    const html = await framePageHtml(resolveFrameTarget('demo_flow', screen, { registry }), { annotate: false });
    return { comp: /class="wb-comp-stage[ "]/.test(html), phone: /class="ios-stage[ "]/.test(html) };
  };
  assert.deepEqual(await stage('ask-bare'), { comp: true, phone: false });
  assert.deepEqual(await stage('ask-open'), { comp: false, phone: true });
});

test('标注桶：画布页 id 是合法桶；/registry 带 articles 清单，entries 里没有它', async (t) => {
  const { registry, dir } = fixture(t);
  assert.deepEqual(resolveRequestEntry(registry, 'demo_flow'), { entry: 'demo_flow' });
  assert.deepEqual(resolveRequestEntry(registry, 'demo_ghost'), { entry: 'demo_ghost', unknown: true });
  const handler = createAnnotateHandler({ registry, dataRoot: path.join(dir, 'data'), root: dir });
  const req = mockReq('GET', '/registry');
  const res = mockRes();
  await handler(req, res, '/registry');
  const payload = res.json;
  assert.deepEqual(payload.articles, [{ id: 'demo_flow', title: '流程', project: 'demo', article: 'flow', url: '/demo/flow/' }]);
  assert.ok(!payload.entries.some((entry) => entry.id === 'demo_flow'));
});

test('工作台 pageEntry 认得 manifest.articles，左栏的 pages 里没有它；base URL 是 /sites/<id>/', () => {
  const manifest = { pages: [{ id: 'home' }], articles: [{ id: 'demo_flow', mode: 'ios', site: true, kind: 'article' }] };
  assert.equal(pageEntry(manifest, 'demo_flow').kind, 'article');
  assert.equal(pageBaseUrl(manifest, 'demo_flow'), '/sites/demo_flow/');
  assert.ok(!manifest.pages.some((page) => page.id === 'demo_flow'));
  assert.equal(pageEntry({ pages: [] }, 'demo_flow'), null);
});

test('GET /api/projects/<project>/articles/<article>/canvas → articleCanvas；project 没登记 404', async (t) => {
  const { registry } = fixture(t);
  const handler = createProjectsHandler({ registry });
  const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 418; res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ok = await fetch(`${origin}/api/projects/demo/articles/flow/canvas`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {
    pageId: 'demo_flow', project: 'demo', article: 'flow',
    sections: [{ id: 'ask', title: '提问', letter: 'A', frames: [{ id: 'ask-open', ref: 'A1' }] }],
    figures: [],
    errors: [],
  });
  assert.equal((await fetch(`${origin}/api/projects/nope/articles/flow/canvas`)).status, 404);
  const ghost = await (await fetch(`${origin}/api/projects/demo/articles/ghost/canvas`)).json();
  assert.deepEqual(ghost.errors, [{ code: 'article_missing', message: '文章不存在：articles/ghost/index.mdx' }]);
});

test('文章页注入的桶：登记的文章 → 画布页 id；project 首页、概念页、llms.txt、不存在的文章不注入', (t) => {
  const { registry } = fixture(t);
  const route = (pathname) => ({ kind: 'article', project: 'demo', article: articleIdOfPath(pathname), upstream: `/_astro${pathname}?x=1` });
  assert.equal(annotationBucketFor(route('/demo/flow/'), registry), 'demo_flow');
  assert.equal(annotationBucketFor(route('/demo/flow'), registry), 'demo_flow');
  assert.equal(annotationBucketFor(route('/demo/'), registry), null);
  assert.equal(annotationBucketFor(route('/demo/concepts/x/'), registry), null);
  assert.equal(annotationBucketFor(route('/demo/ghost/'), registry), null);
  assert.equal(annotationBucketFor(route('/demo/llms.txt'), registry), null);
});

test('watch：project 内容目录进 watcher；帧变更重编并通知画布页，只改正文不通知', async (t) => {
  const { registry, article, content, dir } = fixture(t);
  const distRoot = path.join(dir, 'dist');
  const plugin = previewHmr({ registry, distRoot });
  const server = fakeServer();
  await plugin.configureServer(server);
  assert.ok(server.added.includes(content), JSON.stringify(server.added));

  server.sent.length = 0;
  const frame = path.join(article, 'ask-open.jsx');
  fs.writeFileSync(frame, fs.readFileSync(frame, 'utf8').replace('提问', '再问'));
  assert.deepEqual(await plugin.handleHotUpdate({ file: frame, server }), []);
  assert.deepEqual(server.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'demo_flow' } }]);
  assert.match(fs.readFileSync(path.join(distRoot, 'demo_flow', 'ask-open.html'), 'utf8'), /再问/);

  server.sent.length = 0;
  const mdx = path.join(article, 'index.mdx');
  fs.appendFileSync(mdx, '\n多一段正文。\n');
  await plugin.handleHotUpdate({ file: mdx, server });
  assert.deepEqual(server.sent, [], '只改正文：画布没变，不重摆');

  fs.writeFileSync(mdx, fs.readFileSync(mdx, 'utf8').replace('title="提问"', 'title="发问"'));
  await plugin.handleHotUpdate({ file: mdx, server });
  assert.deepEqual(server.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'demo_flow' } }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(distRoot, 'demo_flow', 'board.json'), 'utf8')).sections[0].title, '发问');

  // project 共用组件：归这个 project 的每一篇。
  server.sent.length = 0;
  const shared = path.join(content, 'components', 'Shared.jsx');
  write(shared, 'export function Shared() {\n  return <i>s</i>;\n}\n');
  await plugin.handleHotUpdate({ file: shared, server });
  assert.deepEqual(server.sent, [{ type: 'custom', event: 'preview:update', data: { id: 'demo_flow' } }]);
});

test('projects:update：文章增删、标题、project 标题、布局错误变了才发；只改正文与帧不发（M4 左栏）', async (t) => {
  const { registry, article, content, dir } = fixture(t);
  const plugin = previewHmr({ registry, distRoot: path.join(dir, 'dist') });
  const server = fakeServer();
  await plugin.configureServer(server);
  const projectEvents = () => server.sent.filter((m) => m.event === 'projects:update');
  const UPDATE = { type: 'custom', event: 'projects:update', data: { project: 'demo' } };

  server.sent.length = 0;
  const frame = path.join(article, 'ask-open.jsx');
  fs.writeFileSync(frame, fs.readFileSync(frame, 'utf8').replace('提问', '再问'));
  await plugin.handleHotUpdate({ file: frame, server });
  const mdx = path.join(article, 'index.mdx');
  fs.appendFileSync(mdx, '\n多一段正文。\n');
  await plugin.handleHotUpdate({ file: mdx, server });
  assert.deepEqual(projectEvents(), [], '帧内容与正文不改列表');

  // 新文章（没有画布）：列表多一行。Vite 6 的新建不走 handleHotUpdate，走 watcher 的 add。
  const added = path.join(content, 'articles', 'notes', 'index.mdx');
  write(added, '---\ntitle: 笔记\n---\n\n纯文字。\n');
  await plugin.onProjectFileAddOrRemove(server, added, false);
  assert.deepEqual(projectEvents(), [UPDATE]);

  // 新文章带画布：新建时就编，画布页收到 preview:update。
  server.sent.length = 0;
  const flowDir = path.join(content, 'articles', 'board');
  write(path.join(flowDir, 'one.jsx'), 'export default function One() {\n  return <div className="ios-app">一</div>;\n}\n');
  write(path.join(flowDir, 'index.mdx'), '---\ntitle: 画布\n---\n\n<Section id="s" title="节">\n\n<Canvas frames={["one"]} />\n\n</Section>\n');
  await plugin.onProjectFileAddOrRemove(server, path.join(flowDir, 'index.mdx'), false);
  assert.deepEqual(server.sent, [UPDATE, { type: 'custom', event: 'preview:update', data: { id: 'demo_board' } }]);
  assert.match(fs.readFileSync(path.join(dir, 'dist', 'demo_board', 'one.html'), 'utf8'), /一/);
  // project 外的文件不管。
  server.sent.length = 0;
  assert.deepEqual(await plugin.onProjectFileAddOrRemove(server, path.join(dir, 'page', 'x.jsx'), false), []);
  assert.deepEqual(server.sent, []);

  // 文章标题变了。
  server.sent.length = 0;
  fs.writeFileSync(added, fs.readFileSync(added, 'utf8').replace('笔记', '随记'));
  await plugin.handleHotUpdate({ file: added, server });
  assert.deepEqual(projectEvents(), [UPDATE]);

  // project.json 的标题。
  server.sent.length = 0;
  const meta = path.join(content, 'project.json');
  fs.writeFileSync(meta, JSON.stringify({ id: 'demo', title: 'Demo 2' }));
  await plugin.handleHotUpdate({ file: meta, server });
  assert.deepEqual(projectEvents(), [UPDATE]);

  // 删掉帧文件 → 布局错误变了（缺帧）。
  server.sent.length = 0;
  fs.rmSync(frame);
  await plugin.handleHotUpdate({ file: frame, server });
  assert.deepEqual(projectEvents(), [UPDATE]);

  // 删文章（watcher 的 unlink）。
  server.sent.length = 0;
  fs.rmSync(path.dirname(added), { recursive: true });
  await plugin.onProjectFileAddOrRemove(server, added, true);
  assert.deepEqual(server.sent, [UPDATE]);
});
