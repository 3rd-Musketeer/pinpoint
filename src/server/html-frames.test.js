// HTML 帧（docs/projects.md“HTML 帧”）：文章目录下的 <帧 id>.html、project 根下的 { id, src }，
// 从正文写法、派生 board、服务、/api/frame、标注队列到 ppnt check 一路走一遍。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import frameApi from './frame-api.js';
import { buildCheckReport, docFramePaths, loadPageContext } from './lib/ann-query.js';
import { articleHtmlFrameFile, articleCanvas, deriveArticleBoard } from './lib/article-board.js';
import { articleOutline, parseArticleCanvas, resolveRootFrame } from './lib/article-canvas.js';
import { checkProject } from './lib/article-check.js';
import { ensureAnnotateBundle } from './lib/annotate-bundle.js';
import { collectHtmlFrameAssets, htmlRefs, localRef } from './lib/html-frame-assets.js';
import { resolveFrameTarget } from './lib/frame-doc.js';
import { compilePage } from './lib/page-compiler.js';
import { resolveArticleTarget } from './lib/page-resolve.js';
import { listProjects } from './lib/projects.js';
import { loadRegistry } from './lib/registry.js';
import { createSitesHandler } from './sites-api.js';
import { mockReq, mockRes } from './test-harness.js';
import { rootFrameSrc } from '../shared/project-ids.js';

await ensureAnnotateBundle();

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const PAGE = (title, body = '') => `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n<link rel="stylesheet" href="page.css">\n</head>\n<body>\n<h1 id="t">${title}</h1>${body}\n</body>\n</html>\n`;

/** project `demo`：文章 pages 有本篇的 long.html、project 根下 shared/cat.html 和一帧 JSX；根下还有 .env。 */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-html-frames-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const previous = process.env.PINPOINT_DATA_DIR;
  process.env.PINPOINT_DATA_DIR = path.join(dir, 'data');
  t.after(() => {
    if (previous === undefined) delete process.env.PINPOINT_DATA_DIR;
    else process.env.PINPOINT_DATA_DIR = previous;
  });
  const root = path.join(dir, 'proj');
  const content = path.join(root, 'docs', 'pinpoint');
  const article = path.join(content, 'articles', 'pages');
  write(path.join(content, 'project.json'), JSON.stringify({ id: 'demo' }));
  write(path.join(article, 'index.mdx'), [
    '---', 'title: 页面', '---', '', // 1-4
    '<Section id="intro" title="说明">', '', '文字', '', '</Section>', '', // 5-10
    '<Section id="pages" title="页面">', '', // 11-12
    '<Canvas frames={["long", { id: "cat", src: "shared/cat.html" }]} />', '', // 13-14
    '</Section>', '', // 15-16
    '<Section id="app" title="手机">', '', '<Canvas frames={["phone"]} />', '', '</Section>', '', // 17-22
  ].join('\n'));
  write(path.join(article, 'long.html'), PAGE('长页面', '\n<img src="img/missing.png">'));
  write(path.join(article, 'page.css'), 'body { margin: 0; }\n');
  write(path.join(article, 'article.css'), '.x { color: red; }\n');
  write(path.join(article, 'phone.jsx'), 'export default function Phone() {\n  return <div className="ios-app">手机</div>;\n}\n');
  write(path.join(root, 'shared', 'cat.html'), PAGE('目录', '\n<iframe src="frames/inner.html"></iframe>'));
  write(path.join(root, 'shared', 'page.css'), '@import "../tokens.css";\nbody { background: url(img/bg.svg); }\n');
  write(path.join(root, 'shared', 'img', 'bg.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write(path.join(root, 'shared', 'frames', 'inner.html'), '<!doctype html><p>inner</p>');
  write(path.join(root, 'tokens.css'), ':root { --x: 1; }\n');
  write(path.join(root, '.env'), 'SECRET=1\n');
  write(path.join(dir, 'outside.html'), PAGE('外面'));
  write(path.join(dir, 'registry.json'), JSON.stringify({ version: 1, entries: [{ id: 'demo', kind: 'project', path: root }] }));
  const registry = loadRegistry({ path: path.join(dir, 'registry.json'), root: dir, log: () => {} });
  return { dir, root, content, article, registry, pageId: 'demo_pages' };
}

async function get(handler, url) {
  const req = mockReq('GET', url);
  const res = mockRes();
  await handler(req, res, url.split('?')[0]);
  return res;
}

test('服务与文章清单：文章目录、正文的 symlink 不开放未登记目录', async (t) => {
  const { dir, root, article, registry, pageId } = fixture(t);
  const outside = path.join(dir, 'unregistered');
  write(path.join(outside, 'index.mdx'), '---\ntitle: 私有文章\n---\n');
  write(path.join(outside, 'private.txt'), 'UNREGISTERED_SECRET_C');
  fs.symlinkSync(outside, path.join(path.dirname(article), 'escape'));
  fs.unlinkSync(path.join(article, 'index.mdx'));
  fs.symlinkSync(path.join(outside, 'index.mdx'), path.join(article, 'index.mdx'));
  const handler = createSitesHandler({ registry });
  for (const url of ['/sites/demo_escape/private.txt', `/sites/${pageId}/page.css`]) {
    const res = await get(handler, url);
    assert.equal(res.statusCode, 404, url);
    assert.ok(!res.text.includes('UNREGISTERED_SECRET_C'));
  }
  assert.deepEqual(listProjects(registry).flatMap((project) => project.articles), []);
  // 登记根本身可以是 symlink，真实根内的普通文章仍可读。
  fs.unlinkSync(path.join(article, 'index.mdx'));
  write(path.join(article, 'index.mdx'), '---\ntitle: 正常文章\n---\n');
  fs.symlinkSync(root, path.join(dir, 'alias'));
  const aliasRegistry = { projects: [{ id: 'demo', path: path.join(dir, 'alias') }], entries: [] };
  assert.equal((await get(createSitesHandler({ registry: aliasRegistry }), `/sites/${pageId}/page.css`)).statusCode, 200);
});

test('正文写法：字符串帧可以是 .html，对象写法指 project 根下的文件；HTML 帧缺省 doc', (t) => {
  const { article, root, registry, pageId } = fixture(t);
  const target = resolveArticleTarget(registry, pageId);
  assert.equal(target.projectRoot, root);
  const { board, sections, errors } = deriveArticleBoard(target);
  assert.deepEqual(errors, []);
  assert.deepEqual(sections.find((s) => s.id === 'pages').frameSrc, { cat: 'shared/cat.html' });
  assert.deepEqual(board.sections.map((s) => [s.id, s.letter, s.screens]), [
    ['pages', 'B', [{ id: 'long', shell: 'doc' }, { id: 'cat', shell: 'doc', src: 'sites/demo_pages/@root/shared/cat.html' }]],
    ['app', 'C', [{ id: 'phone' }]],
  ]);
  assert.equal(articleHtmlFrameFile(target, { id: 'long' }), path.join(article, 'long.html'));
  assert.equal(articleHtmlFrameFile(target, board.sections[0].screens[1]), path.join(root, 'shared', 'cat.html'));
  assert.equal(articleHtmlFrameFile(target, { id: 'phone' }), null);
  // 站点卡片：文档帧带 shell doc 和编号（文章画布上文档帧也占号），project 根下的帧带 src；HTML 帧都带 url
  // （服务上的地址 = 那一页标注账本的名字来源，一篇文章一张画布 2026-10-15）。JSX 帧没有 url。
  const canvas = articleCanvas('demo', 'pages', { registry });
  assert.deepEqual(canvas.sections[0].frames, [
    { id: 'long', ref: 'B1', shell: 'doc', url: '/sites/demo_pages/long.html' },
    { id: 'cat', ref: 'B2', shell: 'doc', src: 'shared/cat.html', url: '/sites/demo_pages/@root/shared/cat.html' },
  ]);
  assert.equal(canvas.sections[1].frames[0].url, undefined);
  assert.deepEqual(articleOutline(fs.readFileSync(target.articleFile, 'utf8'))[1].sources, { cat: 'shared/cat.html' });
  assert.equal(rootFrameSrc('demo_pages', 'a b/c.html'), 'sites/demo_pages/@root/a%20b/c.html');
});

test('正文写法的错误：越出根、隐藏目录、不是 .html、缺文件、重名、对象写错，都带节、帧和行', (t) => {
  const { root } = fixture(t);
  const readers = {
    frameSource: (id) => (id === 'long' ? { kind: 'html' } : id === 'both' ? { kind: 'jsx', both: true } : null),
    rootFrame: (src) => resolveRootFrame(root, src),
  };
  const mdx = (frames) => `<Section id="s" title="S">\n\n<Canvas frames={[${frames}]} />\n\n</Section>\n`;
  const errorsOf = (frames) => parseArticleCanvas(mdx(frames), readers).errors.map((e) => [e.code, e.frame, e.line]);
  assert.deepEqual(errorsOf('{ id: "a", src: "../outside.html" }'), [['frame_src', 'a', 3]]);
  assert.deepEqual(errorsOf('{ id: "a", src: "/abs/x.html" }'), [['frame_src', 'a', 3]]);
  assert.deepEqual(errorsOf('{ id: "a", src: ".git/x.html" }'), [['frame_src', 'a', 3]]);
  assert.deepEqual(errorsOf('{ id: "a", src: "shared/page.css" }'), [['frame_src', 'a', 3]]);
  assert.deepEqual(errorsOf('{ id: "a", src: "shared/nope.html" }'), [['frame_missing', 'a', 3]]);
  assert.deepEqual(errorsOf('{ id: "long", src: "shared/cat.html" }'), [['frame_source', 'long', 3]]);
  assert.deepEqual(errorsOf('"both"'), [['frame_source', 'both', 3]]);
  assert.deepEqual(errorsOf('"ghost"'), [['frame_missing', 'ghost', 3]]);
  assert.deepEqual(errorsOf('{ id: "a" }'), [['canvas_frames', undefined, 3]]);
  assert.deepEqual(errorsOf('{ id: "a", src: x }'), [['canvas_frames', undefined, 3]]);
  assert.deepEqual(errorsOf('{ id: "a", src: "shared/cat.html", shell: "app" }'), [['canvas_frames', undefined, 3]]);
  // 缺文件的帧照样进画布（错误面板占位），越出根的不进。
  const missing = parseArticleCanvas(mdx('{ id: "a", src: "shared/nope.html" }'), readers);
  assert.deepEqual(missing.sections[0].frames, ['a']);
  assert.deepEqual(parseArticleCanvas(mdx('{ id: "a", src: "../outside.html" }'), readers).sections, []);
  // symlink 指到根外：按真实路径判。
  fs.symlinkSync(path.join(path.dirname(root), 'outside.html'), path.join(root, 'shared', 'link.html'));
  assert.match(resolveRootFrame(root, 'shared/link.html').error, /project 根外面/);
  // <Canvas shell> 写了就用它（存量的 HTML 片段帧在手机壳里）。
  const app = parseArticleCanvas('<Section id="s" title="S">\n<Canvas frames={["long"]} shell="app" />\n</Section>\n', readers);
  assert.equal(app.sections[0].frameShells, undefined);
  assert.equal(app.sections[0].shell, 'app');
});

test('布局错误进 listProjects，带 path 和行', (t) => {
  const { article, registry } = fixture(t);
  fs.appendFileSync(path.join(article, 'index.mdx'), '<Section id="bad" title="坏">\n\n<Canvas frames={[{ id: "x", src: "../../x.html" }]} />\n\n</Section>\n');
  const [project] = listProjects(registry);
  assert.deepEqual(project.errors.map((e) => [e.code, e.path, e.line, e.frame]), [['frame_src', 'articles/pages/index.mdx', 24, 'x']]);
});

test('服务：HTML 帧从源文件出并注入标注客户端，@root 只出 project 根下的非隐藏文件', async (t) => {
  const { registry, pageId } = fixture(t);
  const handler = createSitesHandler({ registry });
  const long = await get(handler, `/sites/${pageId}/long.html`);
  assert.equal(long.statusCode, 200);
  assert.match(long.text, /^<!doctype html>/);
  assert.match(long.text, /annotate\.[0-9a-f]+\.js/);
  assert.doesNotMatch(long.text, /article\.css/); // 整份文档不注 article.css
  const quiet = await get(handler, `/sites/${pageId}/long.html?annotate=off`);
  assert.doesNotMatch(quiet.text, /annotate\.[0-9a-f]+\.js/);
  assert.equal((await get(handler, `/sites/${pageId}/page.css`)).statusCode, 200);

  const cat = await get(handler, `/sites/${pageId}/@root/shared/cat.html`);
  assert.equal(cat.statusCode, 200);
  // 编码的来源标记（%40root，ppnt shot 发的就是这种）与 @root 同一份。
  const catEncoded = await get(handler, `/sites/${pageId}/%40root/shared/cat.html`);
  assert.equal(catEncoded.statusCode, 200);
  assert.equal(catEncoded.text, cat.text);
  assert.match(cat.text, /annotate\.[0-9a-f]+\.js/);
  // 帧引用的文件原样出，不注入；内嵌的 HTML 也不注入。
  assert.equal((await get(handler, `/sites/${pageId}/@root/shared/page.css`)).text, '@import "../tokens.css";\nbody { background: url(img/bg.svg); }\n');
  assert.equal((await get(handler, `/sites/${pageId}/@root/tokens.css`)).statusCode, 200);
  assert.doesNotMatch((await get(handler, `/sites/${pageId}/@root/shared/frames/inner.html`)).text, /annotate/);
  for (const bad of ['@root/.env', '@root/..%2Foutside.html', '@root/../outside.html', '@root/shared/nope.css']) {
    assert.equal((await get(handler, `/sites/${pageId}/${bad}`)).statusCode, 404, bad);
  }
});

test('服务：三条出文件的分支同一套规则，文章目录里 . 开头的段和指出去的 symlink 都 404', async (t) => {
  const { dir, root, article, registry, pageId } = fixture(t);
  write(path.join(article, '.env'), 'SECRET=article\n');
  write(path.join(article, '.cache', 'x.css'), '.x {}\n');
  write(path.join(dir, 'outside.css'), '.outside {}\n');
  fs.symlinkSync(path.join(dir, 'outside.css'), path.join(article, 'escape.css'));
  fs.symlinkSync(path.join(article, '.env'), path.join(article, 'alias.txt'));
  fs.symlinkSync(path.join(root, '.env'), path.join(root, 'shared', 'alias.txt'));
  const handler = createSitesHandler({ registry });
  for (const bad of ['.env', '.cache/x.css', 'escape.css', 'alias.txt', '@root/shared/alias.txt', '@root/.env']) {
    assert.equal((await get(handler, `/sites/${pageId}/${bad}`)).statusCode, 404, bad);
  }
  assert.equal((await get(handler, `/sites/${pageId}/page.css`)).statusCode, 200);
});

test('本篇的 HTML 帧是指出文章目录的 symlink：布局错误 frame_src，不进画布，服务 404', async (t) => {
  const { dir, article, registry, pageId } = fixture(t);
  write(path.join(dir, 'outside.html'), PAGE('外面的 sentinel'));
  fs.symlinkSync(path.join(dir, 'outside.html'), path.join(article, 'escape.html'));
  fs.appendFileSync(path.join(article, 'index.mdx'), '<Section id="esc" title="越界">\n\n<Canvas frames={["escape"]} />\n\n</Section>\n');
  const handler = createSitesHandler({ registry });
  const res = await get(handler, `/sites/${pageId}/escape.html?annotate=off`);
  assert.equal(res.statusCode, 404);
  assert.doesNotMatch(String(res.text || res.body || ''), /sentinel/);
  const target = resolveArticleTarget(registry, pageId);
  const { board, errors } = deriveArticleBoard(target);
  assert.deepEqual(errors.map((e) => [e.code, e.frame]), [['frame_src', 'escape']]);
  assert.match(errors[0].message, /文章目录外面/);
  assert.equal(board.sections.some((s) => s.screens.some((screen) => screen.id === 'escape')), false);
  assert.equal(articleHtmlFrameFile(target, { id: 'escape' }), null);
  assert.deepEqual(listProjects(registry)[0].errors.map((e) => [e.code, e.path, e.frame]), [['frame_src', 'articles/pages/index.mdx', 'escape']]);
});

test('服务：index.mdx 在文章目录和 @root 下都不出（含指向它的 symlink）', async (t) => {
  const { article, registry, pageId } = fixture(t);
  fs.symlinkSync(path.join(article, 'index.mdx'), path.join(article, 'source.txt'));
  const handler = createSitesHandler({ registry });
  for (const bad of ['index.mdx', 'source.txt', '@root/docs/pinpoint/articles/pages/index.mdx', '@root/docs/pinpoint/articles/pages/source.txt']) {
    assert.equal((await get(handler, `/sites/${pageId}/${bad}`)).statusCode, 404, bad);
  }
  assert.equal((await get(handler, `/sites/${pageId}/@root/docs/pinpoint/articles/pages/page.css`)).statusCode, 200);
});

test('服务：文章的 /sites/ 也拒绝 cross-site 请求', async (t) => {
  const { registry, pageId } = fixture(t);
  const handler = createSitesHandler({ registry });
  for (const url of [`/sites/${pageId}/long.html`, `/sites/${pageId}/page.css`, `/sites/${pageId}/@root/shared/cat.html`, `/sites/${pageId}/board.json`]) {
    const req = mockReq('GET', url);
    req.headers['sec-fetch-site'] = 'cross-site';
    const res = mockRes();
    await handler(req, res, url);
    assert.equal(res.statusCode, 403, url);
    assert.equal((await get(handler, url)).statusCode, 200, url);
  }
});

test('服务：这篇没有 project 根下的帧时 @root 不开', async (t) => {
  const { article, registry, pageId } = fixture(t);
  const mdx = path.join(article, 'index.mdx');
  fs.writeFileSync(mdx, fs.readFileSync(mdx, 'utf8').replace(', { id: "cat", src: "shared/cat.html" }', ''));
  const handler = createSitesHandler({ registry });
  assert.equal((await get(handler, `/sites/${pageId}/@root/tokens.css`)).statusCode, 404);
});

test('/api/frame：文档帧 302 到自己的地址，embed=card 带上 annotate=off', async (t) => {
  const { registry, pageId } = fixture(t);
  let middleware = null;
  frameApi({ registry }).configureServer({ middlewares: { use: (fn) => { middleware = fn; } } });
  const call = async (url) => {
    const res = mockRes();
    await middleware(mockReq('GET', url), res, () => { res.statusCode = 418; });
    return res;
  };
  const card = await call(`/api/frame?page=${pageId}&screen=cat&annotate=off&embed=card`);
  assert.equal(card.statusCode, 302);
  assert.equal(card.headers.Location, `/sites/${pageId}/@root/shared/cat.html?annotate=off`);
  const plain = await call(`/api/frame?page=${pageId}&screen=long`);
  assert.equal(plain.headers.Location, `/sites/${pageId}/long.html`);
});

test('编译：HTML 帧原样进 dist，记源文件；文档里不注 article.css', async (t) => {
  const { dir, registry, pageId } = fixture(t);
  const target = resolveArticleTarget(registry, pageId);
  const distRoot = path.join(dir, 'dist');
  const result = await compilePage(target, { distRoot });
  assert.ok(result.ok, JSON.stringify(result.screens));
  const out = (id) => fs.readFileSync(path.join(distRoot, pageId, `${id}.html`), 'utf8');
  assert.equal(out('cat'), fs.readFileSync(path.join(target.projectRoot, 'shared', 'cat.html'), 'utf8'));
  assert.doesNotMatch(out('long'), /article\.css/);
  assert.match(out('phone'), /article\.css/);
  const build = JSON.parse(fs.readFileSync(path.join(distRoot, pageId, 'build.json'), 'utf8'));
  assert.equal(build.sources.long.file, 'long.html');
  assert.equal(build.sources.cat.file, '../../../../shared/cat.html');
});

test('标注队列：文档帧账本里的行按路径对回帧，带编号；mark 仍写回原账本', async (t) => {
  const { dir, registry, pageId } = fixture(t);
  const target = resolveArticleTarget(registry, pageId);
  const board = deriveArticleBoard(target).board;
  assert.deepEqual([...docFramePaths(board, target.urlBase)], [
    [`/sites/${pageId}/long.html`, 'long'],
    [`/sites/${pageId}/@root/shared/cat.html`, 'cat'],
  ]);
  const bucket = path.join(dir, 'data', pageId);
  const row = (n, selector, text) => ({ n, id: `a${n}`, type: 'element', selector, text, targets: [{ ref: 'i1', selector, text }], content: `[@t:i1] 改 ${n}`, status: 'open' });
  write(path.join(bucket, 'long.html~x.json'), JSON.stringify({ path: `/sites/${pageId}/long.html`, annotations: [row(1, '#t', '长页面')] }));
  write(path.join(bucket, 'cat.html~y.json'), JSON.stringify({ path: `/sites/${pageId}/@root/shared/cat.html`, annotations: [row(2, '#t', '目录')] }));
  write(path.join(bucket, 'other~z.json'), JSON.stringify({ path: `/sites/${pageId}/stray.html`, annotations: [row(3, 'p', '')] }));
  await compilePage(target, { distRoot: path.join(dir, 'data', 'dist') });
  const registryPath = path.join(dir, 'registry.json');
  const context = loadPageContext({ pageRef: pageId, registryPath, root: dir, dataRootDir: path.join(dir, 'data') });
  assert.deepEqual(context.frameRows.map((r) => [r.n, r.screenId, r.__ledger]).sort(), [[1, 'long', 'long.html~x'], [2, 'cat', 'cat.html~y']]);
  // 不是任何 HTML 帧的路径：文章页上没有这个表面，账本是孤儿（不计数，prune 清得掉）。
  assert.deepEqual(context.docRows.map((r) => r.n), []);
  assert.deepEqual(context.orphanRows.map((r) => r.n), [3]);
  const distHtmlFor = (id) => {
    try { return fs.readFileSync(path.join(dir, 'data', 'dist', pageId, `${id}.html`), 'utf8'); } catch { return null; }
  };
  const report = buildCheckReport({ ...context, distHtmlFor }, {});
  const frameGroups = report.groups.filter((g) => g.kind === 'frame');
  assert.deepEqual(frameGroups.map((g) => [g.ref, g.screenId]), [['B1', 'long'], ['B2', 'cat']]);
  // 摘录指源文件：本篇的写文件名，project 根下的写绝对路径；行号与源文件相同。
  assert.equal(frameGroups[0].rows[0].file, 'long.html');
  assert.equal(frameGroups[0].rows[0].line, 9);
  assert.equal(frameGroups[1].rows[0].file, path.join(target.projectRoot, 'shared', 'cat.html'));
});

test('ppnt check：HTML 帧引用的文件不在盘上是警告，越出可服务范围是错误', async (t) => {
  const { article, root, registry } = fixture(t);
  let result = await checkProject(registry, 'demo', { articleId: 'pages' });
  assert.equal(result.frames, 3);
  assert.deepEqual(result.diagnostics.map((d) => [d.severity, d.code, path.relative(root, d.file), d.line, d.frame]), [
    ['warning', 'html_asset_missing', 'docs/pinpoint/articles/pages/long.html', 10, 'long'],
  ]);
  // 本篇目录下的帧只能引用文章目录里的文件（服务在 /sites/<页 id>/ 下出它）。
  write(path.join(article, 'long.html'), PAGE('长页面', '\n<link rel="stylesheet" href="../../../../tokens.css">'));
  result = await checkProject(registry, 'demo', { articleId: 'pages' });
  assert.deepEqual(result.diagnostics.map((d) => [d.severity, d.code, d.line]), [['error', 'html_asset_outside', 10]]);
});

test('ppnt check 与服务同一条规则：指出范围的 symlink、. 开头的文件，check 报错、服务 404', async (t) => {
  const { dir, root, registry, pageId } = fixture(t);
  write(path.join(dir, 'outside.css'), '.outside {}\n');
  fs.symlinkSync(path.join(dir, 'outside.css'), path.join(root, 'shared', 'escape.css'));
  write(path.join(root, 'shared', '.hidden.css'), '.h {}\n');
  write(path.join(root, 'shared', 'cat.html'), PAGE('目录', '\n<link rel="stylesheet" href="escape.css">\n<link rel="stylesheet" href=".hidden.css">'));
  const found = collectHtmlFrameAssets(path.join(root, 'shared', 'cat.html'), { root });
  assert.deepEqual(found.outside.map((row) => [row.url, row.reason]), [['escape.css', 'outside'], ['.hidden.css', 'denied']]);
  assert.deepEqual(found.files.map((row) => path.relative(root, row.file)).sort(), ['shared/img/bg.svg', 'shared/page.css', 'tokens.css']);
  const result = await checkProject(registry, 'demo', { articleId: 'pages' });
  const rows = result.diagnostics.filter((d) => d.frame === 'cat');
  assert.deepEqual(rows.map((d) => [d.severity, d.code, d.line]), [['error', 'html_asset_outside', 10], ['error', 'html_asset_outside', 11]]);
  const handler = createSitesHandler({ registry });
  for (const bad of ['@root/shared/escape.css', '@root/shared/.hidden.css']) {
    assert.equal((await get(handler, `/sites/${pageId}/${bad}`)).statusCode, 404, bad);
  }
});

test('html-frame-assets：只收相对路径，顺着 CSS、内嵌 HTML 和 JS 走', (t) => {
  const { root } = fixture(t);
  assert.equal(localRef('https://x/y.png'), null);
  assert.equal(localRef('data:image/png;base64,xx'), null);
  assert.equal(localRef('#top'), null);
  assert.equal(localRef('/abs.css'), null);
  assert.equal(localRef('${name}.svg'), null);
  assert.equal(localRef('a%20b.png?v=1#x'), 'a b.png');
  assert.deepEqual(htmlRefs('<img data-src="no.png" src="yes.png" srcset="a.png 1x, b.png 2x"><div style="background:url(\'c.png\')"></div>').map((r) => r.url), ['yes.png', 'a.png', 'b.png', 'c.png']);
  write(path.join(root, 'shared', 'frames', 'inner.html'), '<!doctype html><script type="module" src="app.js"></script>');
  write(path.join(root, 'shared', 'frames', 'app.js'), "import { x } from './lib.js';\nexport { y } from \"./more.js\";\n");
  write(path.join(root, 'shared', 'frames', 'lib.js'), 'export const x = 1;\n');
  const found = collectHtmlFrameAssets(path.join(root, 'shared', 'cat.html'), { root });
  assert.deepEqual(found.files.map((f) => path.relative(root, f.file)).sort(), [
    'shared/frames/app.js', 'shared/frames/inner.html', 'shared/frames/lib.js', 'shared/img/bg.svg', 'shared/page.css', 'tokens.css',
  ]);
  assert.deepEqual(found.missing.map((f) => [path.relative(root, f.from), f.url]), [['shared/frames/app.js', './more.js']]);
  const narrow = collectHtmlFrameAssets(path.join(root, 'shared', 'cat.html'), { root: path.join(root, 'shared') });
  assert.deepEqual(narrow.outside.map((f) => f.url), ['../tokens.css']);
});

/** 在 fixture 上加两个 source：skill（相对 project 根，在根外面）和 bad（目录不在）。 */
function withSources(t, sources) {
  const fx = fixture(t);
  const skill = path.join(fx.dir, 'skill-repo', 'skill');
  write(path.join(skill, 'preview.html'), PAGE('组件', '\n<img src="img/dot.svg">'));
  write(path.join(skill, 'page.css'), 'body { color: red; }\n');
  write(path.join(skill, 'img', 'dot.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write(path.join(skill, '.git', 'config'), '[core]\n');
  write(path.join(fx.dir, 'skill-repo', 'secret.html'), PAGE('仓里别处'));
  write(path.join(fx.content, 'project.json'), JSON.stringify({ id: 'demo', sources }));
  write(path.join(fx.article, 'index.mdx'), [
    '---', 'title: 页面', '---', '', // 1-4
    '<Section id="pages" title="页面">', '', // 5-6
    '<Canvas frames={["long", { id: "skill-preview", src: "skill:preview.html" }]} />', '', // 7-8
    '</Section>', '',
  ].join('\n'));
  return { ...fx, skill };
}

test('服务：@root 与 @source 的 URL 只解码一次，保留字面百分号文件名', async (t) => {
  for (const source of [false, true]) await t.test(source ? '@source' : '@root', async (t) => {
    const fx = withSources(t, { skill: '../skill-repo/skill' });
    const base = source ? fx.skill : fx.root;
    const names = ['a%20b.html', 'a b.html', '中文.html', '50%.html', 'a%2Fb.html', '%2e%2e.html', 'nested/page.html'];
    const frames = names.map((name, i) => ({ id: `f${i}`, src: `${source ? 'skill:' : ''}shared/${name}` }));
    for (const [i, name] of names.entries()) write(path.join(base, 'shared', name), PAGE(`文件${i}:${name}`));
    write(path.join(fx.article, 'index.mdx'), `<Section id="s" title="S">\n<Canvas frames={${JSON.stringify(frames)}} />\n</Section>`);
    write(path.join(base, 'shared', 'asset%20name.css'), '/* 字面资源 */');
    const handler = createSitesHandler({ registry: fx.registry });
    for (const [i, frame] of frames.entries()) {
      const url = '/' + rootFrameSrc(fx.pageId, frame.src);
      const res = await get(handler, url + '?annotate=off');
      assert.equal(res.statusCode, 200, url);
      assert.equal(res.text, PAGE(`文件${i}:${names[i]}`), url);
    }
    const prefix = `/sites/${fx.pageId}/${source ? '@source/skill' : '@root'}/`;
    assert.equal((await get(handler, `${prefix}shared/asset%2520name.css`)).text, '/* 字面资源 */');
    assert.equal((await get(handler, `${prefix}shared%2Fnested%2Fpage.html?annotate=off`)).text, PAGE('文件6:nested/page.html'));
    for (const bad of ['%2e%2e/outside.html', 'shared%2F..%2F..%2Foutside.html', '%2egit/config', 'bad%name.html']) {
      assert.equal((await get(handler, prefix + bad)).statusCode, 404, bad);
    }
  });
});

test('sources：`<名>:<路径>` 指 project.json 登记的目录；服务只开这个目录，check 按它算范围', async (t) => {
  const fx = withSources(t, { skill: '../skill-repo/skill' });
  const [project] = listProjects(fx.registry);
  assert.deepEqual(project.errors, []);
  assert.deepEqual(project.sources, { skill: fx.skill });
  const target = resolveArticleTarget(fx.registry, fx.pageId);
  const { board } = deriveArticleBoard(target);
  assert.deepEqual(board.sections[0].screens.map((s) => [s.id, s.shell, s.src]), [
    ['long', 'doc', undefined],
    ['skill-preview', 'doc', 'sites/demo_pages/@source/skill/preview.html'],
  ]);
  assert.equal(articleHtmlFrameFile(target, board.sections[0].screens[1]), path.join(fx.skill, 'preview.html'));
  const canvas = articleCanvas('demo', 'pages', { registry: fx.registry });
  assert.equal(canvas.sections[0].frames[1].src, 'skill:preview.html');
  assert.equal(canvas.sections[0].frames[1].url, '/sites/demo_pages/@source/skill/preview.html');

  const handler = createSitesHandler({ registry: fx.registry });
  const frame = await get(handler, '/sites/demo_pages/@source/skill/preview.html');
  assert.equal(frame.statusCode, 200);
  assert.match(String(frame.body), /组件/);
  assert.match(String(frame.body), /pinpoint/); // 注入了标注客户端
  assert.equal((await get(handler, '/sites/demo_pages/@source/skill/page.css')).statusCode, 200);
  assert.equal((await get(handler, '/sites/demo_pages/@source/skill/img/dot.svg')).statusCode, 200);
  // 来源标记被编码（ppnt shot 等 CLI 用 URL 规范化后的地址）也要认：%40source 与 @source 同一份文件。
  const encoded = await get(handler, '/sites/demo_pages/%40source/skill/preview.html');
  assert.equal(encoded.statusCode, 200);
  assert.equal(String(encoded.body), String(frame.body));
  assert.equal((await get(handler, '/sites/demo_pages/%40source/skill/%2e%2e/secret.html')).statusCode, 404);
  // 目录外、隐藏文件、没登记的名字、这篇没用到的 project 根：都 404。
  assert.equal((await get(handler, '/sites/demo_pages/@source/skill/../secret.html')).statusCode, 404);
  assert.equal((await get(handler, '/sites/demo_pages/@source/skill/%2e%2e/secret.html')).statusCode, 404);
  assert.equal((await get(handler, '/sites/demo_pages/@source/skill/.git/config')).statusCode, 404);
  assert.equal((await get(handler, '/sites/demo_pages/@source/other/preview.html')).statusCode, 404);
  assert.equal((await get(handler, '/sites/demo_pages/@root/shared/cat.html')).statusCode, 404);

  const report = await checkProject(fx.registry, 'demo', { articleId: 'pages' });
  const htmlRows = report.diagnostics.filter((row) => row.code.startsWith('html_asset'));
  assert.deepEqual(htmlRows.map((row) => [row.code, row.frame]), [['html_asset_missing', 'long']]);
});

test('服务：缺文件的 { id, src } 帧不打开它的目录（source 与 project 根）', async (t) => {
  const fx = withSources(t, { skill: '../skill-repo/skill' });
  write(path.join(fx.article, 'index.mdx'), [
    '---', 'title: 页面', '---', '',
    '<Section id="pages" title="页面">', '',
    '<Canvas frames={["long", { id: "ghost", src: "skill:missing.html" }, { id: "gone", src: "shared/nope.html" }]} />', '',
    '</Section>', '',
  ].join('\n'));
  const handler = createSitesHandler({ registry: fx.registry });
  for (const bad of ['@source/skill/page.css', '@source/skill/preview.html', '@root/tokens.css', '@root/shared/cat.html']) {
    assert.equal((await get(handler, `/sites/${fx.pageId}/${bad}`)).statusCode, 404, bad);
  }
  // 补上文件，目录就开了。
  write(path.join(fx.skill, 'missing.html'), PAGE('补上'));
  assert.equal((await get(handler, `/sites/${fx.pageId}/@source/skill/page.css`)).statusCode, 200);
});

test('sources：没登记的名字、根外路径是正文错误；值写坏、目录不在是 project 错误，ppnt check 指 project.json', async (t) => {
  const fx = withSources(t, { skill: '../skill-repo/skill', gone: '../nowhere', 'Bad Name': '.', root: '.', num: 3 });
  write(path.join(fx.article, 'index.mdx'), [
    '---', 'title: 页面', '---', '',
    '<Section id="pages" title="页面">', '',
    '<Canvas frames={[{ id: "a", src: "nope:preview.html" }, { id: "b", src: "skill:../secret.html" }, { id: "c", src: "skill:missing.html" }]} />', '',
    '</Section>', '',
  ].join('\n'));
  const [project] = listProjects(fx.registry);
  const sourceErrors = project.errors.filter((error) => error.code === 'project_sources');
  assert.equal(sourceErrors.length, 4);
  assert.ok(sourceErrors.every((error) => error.path === undefined));
  assert.match(sourceErrors.map((error) => error.message).join('\n'), /"gone" 指的目录不存在/);
  assert.deepEqual(project.sources, { skill: fx.skill });
  const canvasErrors = project.errors.filter((error) => error.path === 'articles/pages/index.mdx');
  assert.deepEqual(canvasErrors.map((error) => [error.code, error.frame, error.line]), [
    ['frame_src', 'a', 7], ['frame_src', 'b', 7], ['frame_missing', 'c', 7],
  ]);
  assert.match(canvasErrors[0].message, /source "nope" 没有在 project.json 的 sources 里登记/);
  const report = await checkProject(fx.registry, 'demo', { articleId: 'pages' });
  const rows = report.diagnostics.filter((row) => row.code === 'project_sources');
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.severity === 'error' && row.file === path.join(fx.content, 'project.json')));
});

test('{ id, src } 帧写在 shell="app" 的节里：出帧目标从 dist 出（R5 B2），缺省 doc 节仍 302', async (t) => {
  const { article, registry, pageId } = fixture(t);
  const mdx = [
    '---', 'title: 页面', '---', '',
    '<Section id="shared" title="共享">', '',
    '<Canvas frames={[{ id: "cat", src: "shared/cat.html" }]} shell="app" />', '',
    '</Section>', '',
  ].join('\n');
  write(path.join(article, 'index.mdx'), mdx);
  const target = resolveArticleTarget(registry, pageId);
  const built = await compilePage(target);
  assert.ok(!built.error, `编译应成功：${built.error}`);
  const distFile = path.join(process.env.PINPOINT_DATA_DIR, 'dist', pageId, 'cat.html');
  assert.ok(fs.existsSync(distFile), 'HTML 帧原样编进 dist');
  // 上一版这里抛 unknown_screen「file not found」：useDist 只认无 src 的屏，文章直读分支又是 null。
  const resolved = resolveFrameTarget(pageId, 'cat', { registry });
  assert.equal(resolved.kind, 'fragment');
  assert.ok(resolved.distTarget, '节写了非 doc 机壳的 src 帧也从 dist 出');
  // 对照：同一帧写在缺省（doc）节里，302 到自己的地址——行为不变。
  write(path.join(article, 'index.mdx'), mdx.replace(' shell="app"', ''));
  assert.equal(resolveFrameTarget(pageId, 'cat', { registry }).kind, 'doc');
});

test('sidecar 挂载点警告（R5 S3）：同名 .js 没有挂载点报 sidecar_no_mount，标了或 doc 机壳不报', async (t) => {
  const { article, registry } = fixture(t);
  write(path.join(article, 'index.mdx'), [
    '---', 'title: 页面', '---', '',
    '<Section id="live" title="活的">', '', '<Canvas frames={["counter"]} />', '', '</Section>', '',
    '<Section id="marked" title="标了的">', '', '<Canvas frames={["marked"]} />', '', '</Section>', '',
    '<Section id="docshell" title="doc 机壳">', '', '<Canvas frames={["docframe"]} />', '', '</Section>', '',
  ].join('\n'));
  const jsx = (marker) => [
    `export default function Frame() {`,
    `  return <div className="ios-app"${marker}>计数</div>;`,
    `}`,
    '',
  ].join('\n');
  write(path.join(article, 'counter.jsx'), jsx(''));
  write(path.join(article, 'counter.js'), 'export function mount(root) { root.textContent = "0"; }\n');
  write(path.join(article, 'marked.jsx'), jsx(' data-preview-mount'));
  write(path.join(article, 'marked.js'), 'export default function mount(root) { root.textContent = "0"; }\n');
  write(path.join(article, 'docframe.jsx'), 'export const shell = "doc";\nexport default function Frame() {\n  return <div className="ios-app">文档</div>;\n}\n');
  write(path.join(article, 'docframe.js'), 'export default function mount(root) { root.textContent = "0"; }\n');
  const report = await checkProject(registry, 'demo', { articleId: 'pages' });
  const hints = report.diagnostics.filter((row) => row.code === 'sidecar_no_mount');
  assert.equal(hints.length, 1, JSON.stringify(report.diagnostics, null, 1));
  assert.equal(hints[0].severity, 'warning');
  assert.equal(hints[0].frame, 'counter');
  assert.match(hints[0].message, /data-preview-mount/);
  assert.ok(!report.diagnostics.some((row) => row.code === 'sidecar_no_mount' && row.frame !== 'counter'),
    '标了挂载点的与 doc 机壳的（含帧级 shell="doc"）不报');
  // section 写 shell="doc" 时同样豁免。
  write(path.join(article, 'index.mdx'),
    '---\ntitle: 页面\n---\n\n<Section id="live" title="活的" shell="doc">\n\n<Canvas frames={["counter"]} />\n\n</Section>\n');
  const docSection = await checkProject(registry, 'demo', { articleId: 'pages' });
  assert.ok(!docSection.diagnostics.some((row) => row.code === 'sidecar_no_mount'));
});
