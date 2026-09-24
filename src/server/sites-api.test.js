import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadRegistry } from './lib/registry.js';
import { annotateSnippet, createSitesHandler, injectAnnotateClient } from './sites-api.js';
import { ensureAnnotateBundle } from './lib/annotate-bundle.js';
import { mockReq, mockRes } from './test-harness.js';

// 注入断言盯的是构建产物的哈希地址（审计 B3）—— 先把产物编出来。
await ensureAnnotateBundle();
const HASHED_SCRIPT_RE = /<script src="\/annotate\.[0-9a-f]{10}\.js"><\/script>/;

function withFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-sites-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const site = path.join(dir, 'site');
  fs.mkdirSync(path.join(site, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body><h1>home</h1></body></html>');
  fs.writeFileSync(path.join(site, 'bare.html'), '<h1>no body tag</h1>');
  fs.writeFileSync(path.join(site, 'sub', 'page.html'), '<!doctype html><html><body><p>sub</p></body></html>');
  fs.writeFileSync(path.join(site, 'sub', 'index.html'), '<!doctype html><html><body><p>sub index</p></body></html>');
  fs.writeFileSync(path.join(site, 'app.js'), 'console.log("hi");\n');
  fs.writeFileSync(path.join(site, 'board.json'), '{"sections":[]}');
  const secret = path.join(dir, 'secret.txt');
  fs.writeFileSync(secret, 'top secret');
  // A symlink inside the entry pointing outside it must not be followed.
  fs.symlinkSync(secret, path.join(site, 'leak.txt'));
  // A `file` entry: one registered single file living next to secret.txt —
  // the sibling must stay unreachable through the file entry's namespace.
  const single = path.join(dir, 'single.html');
  fs.writeFileSync(single, '<!doctype html><html><body><p>single file</p></body></html>');
  // Synthesis fixtures: dirs WITHOUT a board.json.
  const bare = path.join(dir, 'bare');
  fs.mkdirSync(path.join(bare, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'b.html'), '<!doctype html><html><body><p>b</p></body></html>');
  fs.writeFileSync(path.join(bare, 'A Page.html'), '<!doctype html><html><body><p>a page</p></body></html>');
  fs.writeFileSync(path.join(bare, 'notes.txt'), 'not html');
  fs.writeFileSync(path.join(bare, 'sub', 'nested.html'), '<!doctype html><html><body><p>nested</p></body></html>');
  const empty = path.join(dir, 'empty');
  fs.mkdirSync(path.join(empty, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(empty, 'sub', 'only.html'), '<!doctype html><html><body><p>deep only</p></body></html>');
  const iosNoBoard = path.join(dir, 'ios-noboard');
  fs.mkdirSync(iosNoBoard);
  fs.writeFileSync(path.join(iosNoBoard, 'x.html'), '<div class="ios-app"></div>');
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({
    version: 1,
    entries: [
      { id: 'site', title: 'Site', kind: 'dir', path: site, board: 'web' },
      // url 条目（阶段 4）：/sites/web/ 走同源代理。指一个必拒连的端口，
      // 代理分支应快速回落 502 bad_gateway。
      { id: 'web', title: 'Web', kind: 'url', url: 'http://127.0.0.1:1' },
      { id: 'single', title: 'Single', kind: 'file', path: single },
      { id: 'ghost-file', title: 'Ghost', kind: 'file', path: path.join(dir, 'deleted.html') },
      { id: 'bare', title: 'Bare', kind: 'dir', path: bare },
      { id: 'empty', title: 'Empty', kind: 'dir', path: empty },
      { id: 'ios-noboard', title: 'iOS NoBoard', kind: 'dir', path: iosNoBoard, board: 'ios' },
      { id: 'ghost-dir', title: 'Ghost Dir', kind: 'dir', path: path.join(dir, 'gone') },
    ],
  }));
  const registry = loadRegistry({ path: path.join(dir, 'registry.json'), root: dir, log: () => {} });
  return { dir, site, single, handler: createSitesHandler({ registry }) };
}



async function call(handler, method, url) {
  const req = mockReq(method, url);
  const res = mockRes();
  const handled = await handler(req, res, url.split('?')[0]);
  return { handled, res };
}

test('non-/sites paths fall through', async (t) => {
  const { handler } = withFixture(t);
  const { handled } = await call(handler, 'GET', '/previews/x/board.json');
  assert.equal(handled, false);
});

test('HTML GET injects the annotate client before </body>', async (t) => {
  const { handler } = withFixture(t);
  const { res } = await call(handler, 'GET', '/sites/site/index.html');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /^text\/html/);
  const body = res.text;
  assert.ok(body.includes(annotateSnippet('site')));
  assert.ok(body.indexOf(annotateSnippet('site')) < body.indexOf('</body>'));
  assert.ok(body.includes("window.__pinpointEntry='site'"));
  assert.ok(HASHED_SCRIPT_RE.test(body), 'client tag references the content-hashed artifact');
});

test('?annotate=off serves the exact disk bytes', async (t) => {
  const { handler, site } = withFixture(t);
  const { res } = await call(handler, 'GET', '/sites/site/index.html?annotate=off');
  assert.equal(res.statusCode, 200);
  assert.equal(res.text, fs.readFileSync(path.join(site, 'index.html'), 'utf8'));
  assert.ok(!res.text.includes('__pinpointEntry'));
});

test('non-HTML files are served untouched with the right MIME', async (t) => {
  const { handler } = withFixture(t);
  const js = await call(handler, 'GET', '/sites/site/app.js');
  assert.equal(js.res.statusCode, 200);
  assert.match(js.res.headers['Content-Type'], /^application\/javascript/);
  assert.equal(js.res.text, 'console.log("hi");\n');
  const json = await call(handler, 'GET', '/sites/site/board.json');
  assert.equal(json.res.statusCode, 200);
  assert.match(json.res.headers['Content-Type'], /^application\/json/);
  // pp2：磁盘板内容原样优先，响应附带 dist 状态（这页没编过 → builtAt null / stale）。
  const board = JSON.parse(json.res.text);
  assert.deepEqual(board.sections, []);
  assert.deepEqual(board.dist, { builtAt: null, stale: true });
});

test('HTML without a </body> gets the snippet appended', async (t) => {
  const { handler } = withFixture(t);
  const { res } = await call(handler, 'GET', '/sites/site/bare.html');
  assert.equal(res.statusCode, 200);
  assert.ok(res.text.endsWith(annotateSnippet('site') + '\n'));
});

test('nested paths and directory index.html resolve', async (t) => {
  const { handler } = withFixture(t);
  const nested = await call(handler, 'GET', '/sites/site/sub/page.html');
  assert.equal(nested.res.statusCode, 200);
  assert.ok(nested.res.text.includes('<p>sub</p>'));
  for (const url of ['/sites/site', '/sites/site/', '/sites/site/sub']) {
    const { res } = await call(handler, 'GET', url);
    assert.equal(res.statusCode, 200, url);
  }
});

test('path traversal is rejected: textual, encoded, and symlink escape', async (t) => {
  const { handler } = withFixture(t);
  for (const url of [
    '/sites/site/../secret.txt',
    '/sites/site/../../etc/passwd',
    '/sites/site/%2e%2e/secret.txt',
    '/sites/site/sub/%2e%2e/%2e%2e/secret.txt',
    '/sites/site/leak.txt',
  ]) {
    const { res } = await call(handler, 'GET', url);
    assert.equal(res.statusCode, 404, url);
    assert.ok(!res.text.includes('top secret'), url);
  }
});

test('unknown entry ids and missing files 404', async (t) => {
  const { handler } = withFixture(t);
  assert.equal((await call(handler, 'GET', '/sites/ghost/index.html')).res.statusCode, 404);
  assert.equal((await call(handler, 'GET', '/sites/site/missing.html')).res.statusCode, 404);
});

test('url entries proxy under /sites/ (阶段 4): an unreachable upstream answers 502, never 404', async (t) => {
  const { handler } = withFixture(t);
  for (const url of ['/sites/web/', '/sites/web/index.html']) {
    const { res } = await call(handler, 'GET', url);
    // 代理是 fire-and-forget：handler 返回后上游 ECONNREFUSED 才异步回来。
    for (let i = 0; i < 100 && res.statusCode === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(res.statusCode, 502, url);
    assert.match(res.text, /bad_gateway/, url);
  }
  // 合成板不经代理：url 条目的 board.json 永远由本地合成（遮蔽上游同名文件）。
  const { res } = await call(handler, 'GET', '/sites/web/board.json');
  assert.equal(res.statusCode, 200);
  const board = JSON.parse(res.text);
  assert.equal(board.sections[0].screens[0].src, 'sites/web/');
});

test('only GET/HEAD are served; everything else is 405', async (t) => {
  const { handler } = withFixture(t);
  const post = await call(handler, 'POST', '/sites/site/index.html');
  assert.equal(post.res.statusCode, 405);
  const head = await call(handler, 'HEAD', '/sites/site/index.html');
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.body.length, 0);
  assert.ok(Number(head.res.headers['Content-Length']) > 0);
});

test('injectAnnotateClient unit: body replace, append fallback, exact snippet', () => {
  const withBody = injectAnnotateClient('<html><body>x</body></html>', 'e1');
  assert.equal(withBody, `<html><body>x${annotateSnippet('e1')}\n</body></html>`);
  const bare = injectAnnotateClient('<p>x</p>', 'e1');
  assert.equal(bare, `<p>x</p>\n${annotateSnippet('e1')}\n`);
});

/* ---- kind: "file" — one registered single file ---- */

test('file entry: /sites/<id>/ and /sites/<id>/<basename> both serve the file, injected', async (t) => {
  const { handler, single } = withFixture(t);
  const disk = fs.readFileSync(single, 'utf8');
  for (const url of ['/sites/single', '/sites/single/', '/sites/single/single.html']) {
    const { res } = await call(handler, 'GET', url);
    assert.equal(res.statusCode, 200, url);
    assert.match(res.headers['Content-Type'], /^text\/html/, url);
    assert.ok(res.text.includes("window.__pinpointEntry='single'"), url);
    assert.ok(res.text.includes('<p>single file</p>'), url);
    assert.ok(!res.text.includes('top secret'), url);
    assert.ok(res.text.length > disk.length, `${url} is the injected variant`);
  }
});

test('file entry: ?annotate=off serves the exact disk bytes', async (t) => {
  const { handler, single } = withFixture(t);
  const { res } = await call(handler, 'GET', '/sites/single/?annotate=off');
  assert.equal(res.statusCode, 200);
  assert.equal(res.text, fs.readFileSync(single, 'utf8'));
  assert.ok(!res.text.includes('__pinpointEntry'));
});

test('file entry: everything but the registered file 404s — same guard semantics as dir', async (t) => {
  const { handler } = withFixture(t);
  for (const url of [
    '/sites/single/secret.txt',       // sibling of the registered file, same parent dir
    '/sites/single/other.html',
    '/sites/single/../secret.txt',
    '/sites/single/%2e%2e/secret.txt',
    '/sites/single/sub/',
    '/sites/single/single.htm',       // not the exact basename
    '/sites/single/single.html/extra',
  ]) {
    const { res } = await call(handler, 'GET', url);
    assert.equal(res.statusCode, 404, url);
    assert.ok(!res.text.includes('top secret'), url);
  }
});

test('file entry: HEAD works and a missing registered file 404s', async (t) => {
  const { handler } = withFixture(t);
  const head = await call(handler, 'HEAD', '/sites/single/');
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.body.length, 0);
  assert.ok(Number(head.res.headers['Content-Length']) > 0);
  // ghost-file is registered but its path is gone: registry warning, serving 404.
  assert.equal((await call(handler, 'GET', '/sites/ghost-file/')).res.statusCode, 404);
});

/* ---- synthesized boards（条目无 board.json 时，server/lib/synth-board.js）---- */

test('file entry: board.json synthesizes a single-screen doc board; JSON 不注入; HEAD ok', async (t) => {
  const { handler } = withFixture(t);
  const { res } = await call(handler, 'GET', '/sites/single/board.json');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /^application\/json/);
  const board = JSON.parse(res.text);
  assert.equal(board.sections.length, 1);
  assert.equal(board.sections[0].shell, 'doc');
  assert.deepEqual(board.sections[0].screens, [
    { id: 'index', title: 'Single', src: 'sites/single/single.html' },
  ]);
  assert.ok(!res.text.includes('__pinpointEntry'), 'board.json 是数据响应，不走注入');
  const off = await call(handler, 'GET', '/sites/single/board.json?annotate=off');
  assert.equal(off.res.text, res.text, 'annotate=off 对合成 JSON 是无操作');
  const head = await call(handler, 'HEAD', '/sites/single/board.json');
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.body.length, 0);
});

test('dir without board.json: one doc screen per top-level .html, sorted, src percent-encoded', async (t) => {
  const { handler } = withFixture(t);
  const { res } = await call(handler, 'GET', '/sites/bare/board.json');
  assert.equal(res.statusCode, 200);
  const board = JSON.parse(res.text);
  assert.equal(board.sections[0].shell, 'doc');
  const screens = board.sections[0].screens;
  assert.deepEqual(screens.map((s) => s.title), ['A Page.html', 'b.html'], '按文件名排序');
  assert.deepEqual(screens.map((s) => s.id), ['a-page', 'b'], 'screen id slug 化');
  assert.deepEqual(screens.map((s) => s.src), ['sites/bare/A%20Page.html', 'sites/bare/b.html']);
  // sub/nested.html 与 notes.txt 不进板
});

test('synthesized screens serve their HTML through the same injected pipeline', async (t) => {
  const { handler } = withFixture(t);
  const { res } = await call(handler, 'GET', '/sites/bare/A%20Page.html');
  assert.equal(res.statusCode, 200);
  assert.ok(res.text.includes('<p>a page</p>'));
  assert.ok(res.text.includes("window.__pinpointEntry='bare'"));
});

test('disk board.json always wins over synthesis', async (t) => {
  const { handler, site } = withFixture(t);
  const { res } = await call(handler, 'GET', '/sites/site/board.json');
  assert.equal(res.statusCode, 200);
  // pp2：磁盘板优先于合成板，响应 = 磁盘内容 + dist 状态段。
  const board = JSON.parse(res.text);
  assert.deepEqual(board.sections, JSON.parse(fs.readFileSync(path.join(site, 'board.json'), 'utf8')).sections, '磁盘内容，非合成');
  assert.deepEqual(board.dist, { builtAt: null, stale: true });
});

test('no synthesis: dir without top-level .html / ios-mode dir / missing dir all 404', async (t) => {
  const { handler } = withFixture(t);
  assert.equal((await call(handler, 'GET', '/sites/empty/board.json')).res.statusCode, 404, '顶层无 .html');
  assert.equal((await call(handler, 'GET', '/sites/ios-noboard/board.json')).res.statusCode, 404, 'ios 壳必须手写 board.json');
  assert.equal((await call(handler, 'GET', '/sites/ghost-dir/board.json')).res.statusCode, 404, '目录缺失');
});
