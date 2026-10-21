import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import contentRoutes, { resolveContentFile, rewriteContentUrl } from './content-routes.js';
import { ensureAnnotateBundle } from './lib/annotate-bundle.js';

test('rewriteContentUrl maps the served URL prefixes onto their disk location', () => {
  assert.equal(rewriteContentUrl('/kits/ios/ios-kit.css'), '/content/kits/ios/ios-kit.css');
  assert.equal(rewriteContentUrl('/previews/_index.json'), '/content/previews/_index.json');
  assert.equal(rewriteContentUrl('/lib/ann-list.css'), '/src/shared/ann-list.css');
});

test('rewriteContentUrl keeps the query string and leaves unmapped URLs alone', () => {
  assert.equal(rewriteContentUrl('/kits/ios/ios-kit.js?t=1'), '/content/kits/ios/ios-kit.js?t=1');
  assert.equal(rewriteContentUrl('/annotate.js'), '/annotate.js');
  assert.equal(rewriteContentUrl('/sites/demo/index.html'), '/sites/demo/index.html');
});

test('rewriteContentUrl does not project a traversal back under content/', () => {
  for (const url of [
    '/previews/../../package.json',
    '/previews/%2e%2e/%2e%2e/package.json',
    '/previews/%2E%2E/%2E%2E/package.json',
    '/kits/../../package.json',
    '/lib/%2e%2e/%2e%2e/package.json',
  ]) {
    assert.equal(rewriteContentUrl(url), url, url);
  }
});

test('rewriteContentUrl still maps a traversal that stays inside the prefix', () => {
  assert.equal(
    rewriteContentUrl('/previews/demo/../shared/screen.html'),
    '/content/previews/demo/../shared/screen.html',
  );
});

test('rewriteContentUrl passes through undecodable percent escapes untouched', () => {
  assert.equal(rewriteContentUrl('/previews/%zz/screen.html'), '/previews/%zz/screen.html');
});

test('rewriteContentUrl leaves percent encoding in the mapped remainder intact', () => {
  assert.equal(
    rewriteContentUrl('/previews/my%20page/screen.html'),
    '/content/previews/my%20page/screen.html',
  );
});

/* ---- 缺文件答真 404（2026-09-04；旧行为是掉进 vite 的 SPA fallback 拿 200 HTML） ---- */

function fakeDisk(entries) {
  return (diskPath) => entries[diskPath] || null;
}

test('resolveContentFile passes through anything the prefixes do not map', () => {
  const exists = fakeDisk({});
  assert.deepEqual(resolveContentFile('/annotate.js', exists), { action: 'pass', url: '/annotate.js' });
  assert.deepEqual(resolveContentFile('/sites/demo/x.css', exists), { action: 'pass', url: '/sites/demo/x.css' });
  // 归一后逃出前缀的穿越同样不归本插件管（rewriteContentUrl 已原样透传）
  assert.deepEqual(resolveContentFile('/previews/%2e%2e/%2e%2e/package.json', exists),
    { action: 'pass', url: '/previews/%2e%2e/%2e%2e/package.json' });
});

test('resolveContentFile serves an existing file and keeps the query string', () => {
  const exists = fakeDisk({ '/content/kits/ios/ios-kit.css': 'file' });
  assert.deepEqual(resolveContentFile('/kits/ios/ios-kit.css', exists),
    { action: 'serve', url: '/content/kits/ios/ios-kit.css' });
  assert.deepEqual(resolveContentFile('/kits/ios/ios-kit.css?t=42', exists),
    { action: 'serve', url: '/content/kits/ios/ios-kit.css?t=42' });
});

test('resolveContentFile answers 404 for a missing file, naming the requested URL', () => {
  const exists = fakeDisk({ '/content/previews/library': 'dir' });
  assert.deepEqual(resolveContentFile('/previews/library/missing.json', exists),
    { action: 'notFound', url: '/previews/library/missing.json' });
  assert.deepEqual(resolveContentFile('/kits/nope.css', exists),
    { action: 'notFound', url: '/kits/nope.css' });
  assert.deepEqual(resolveContentFile('/lib/gone.css?t=1', exists),
    { action: 'notFound', url: '/lib/gone.css?t=1' });
});

test('resolveContentFile serves a directory only when it holds an index.html', () => {
  const withIndex = fakeDisk({
    '/content/previews/library': 'dir',
    '/content/previews/library/index.html': 'file',
  });
  assert.deepEqual(resolveContentFile('/previews/library/', withIndex),
    { action: 'serve', url: '/content/previews/library/' });
  const bare = fakeDisk({ '/content/previews/library': 'dir' });
  assert.deepEqual(resolveContentFile('/previews/library/', bare),
    { action: 'notFound', url: '/previews/library/' });
});

/* ---- ios-kit 自注入的哈希地址替换（审计 B3，工作台自身的加载处）---- */

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

function kitMiddleware() {
  const plugin = contentRoutes();
  let handler;
  plugin.configureServer({
    config: { root: ROOT },
    middlewares: { use(fn) { handler = fn; } },
  });
  return handler;
}

function callKit(handler, method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = headers;
    const res = {
      statusCode: 0,
      headers: {},
      chunks: [],
      setHeader(k, v) { this.headers[k] = v; },
      end(data) {
        if (data !== undefined) this.chunks.push(Buffer.from(data));
        this.ended = true;
        resolve({ next: false, res: this });
      },
      get text() { return Buffer.concat(this.chunks).toString('utf8'); },
    };
    const next = () => resolve({ next: true, res });
    try {
      Promise.resolve(handler(req, res, next)).then((r) => { if (r !== undefined) return; }, reject);
    } catch (error) { reject(error); }
    // 中间件同步 end / next 之外没有别的出口；超时即 fail。
    setTimeout(() => reject(new Error('kit middleware neither ended nor called next')), 2000);
  });
}

test('served ios-kit.js self-injection references the hashed artifact URL', async () => {
  await ensureAnnotateBundle();
  const handler = kitMiddleware();
  const { next, res } = await callKit(handler, 'GET', '/kits/ios/ios-kit.js?t=1');
  assert.equal(next, false, '替换命中时不放行给磁盘投影');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /^application\/javascript/);
  assert.equal(res.headers['Cache-Control'], 'no-cache', '换版后新哈希要立刻跟着发出去');
  assert.match(res.headers.ETag, /^"\/annotate\.[0-9a-f]{10}\.js-[\d.]+"$/, 'ETag 由产物地址 + kit 源 mtime 原值拼（R5 S2：不取整）');
  assert.ok(/s\.src = '\/annotate\.[0-9a-f]{10}\.js';/.test(res.text), 'self-injection swapped to the hash URL');
  assert.ok(!res.text.includes("s.src = '/annotate.js';"), 'old literal gone from the served bytes');
  // HEAD 同路径同头，无响应体。
  const head = await callKit(handler, 'HEAD', '/kits/ios/ios-kit.js');
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.chunks.length, 0);
  // If-None-Match 命中（精确、弱化、列表）答 304。
  const etag = res.headers.ETag;
  for (const header of [etag, `W/${etag}`, `"whatever", ${etag}`]) {
    const notModified = await callKit(handler, 'GET', '/kits/ios/ios-kit.js', { 'if-none-match': header });
    assert.equal(notModified.res.statusCode, 304, header);
    assert.equal(notModified.res.chunks.length, 0);
  }
  const changed = await callKit(handler, 'GET', '/kits/ios/ios-kit.js', { 'if-none-match': '"other"' });
  assert.equal(changed.res.statusCode, 200, 'ETag 不匹配照常 200 带体');
});

test('kit path only answers GET/HEAD; write methods are a loud 405', async () => {
  const handler = kitMiddleware();
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const { next, res } = await callKit(handler, method, '/kits/ios/ios-kit.js');
    assert.equal(next, false, `${method} 不放行给 vite 静态层（此前 200 带体）`);
    assert.equal(res.statusCode, 405, method);
    assert.equal(res.headers.Allow, 'GET, HEAD', method);
    assert.equal(res.chunks.length, 0, method);
  }
});

test('frame shell css and frame-boot answer the raw source, with HEAD and 304', async () => {
  const handler = kitMiddleware();
  const css = await callKit(handler, 'GET', '/api/frame-shell.css?v=ignored');
  assert.equal(css.next, false);
  assert.equal(css.res.statusCode, 200);
  assert.match(css.res.headers['Content-Type'], /^text\/css/);
  assert.equal(css.res.headers['Cache-Control'], 'no-cache');
  assert.match(css.res.headers.ETag, /^"[0-9a-f]{16}"$/);
  assert.match(css.res.text, /html,body\{margin:0/);
  assert.ok(!css.res.text.includes('/@vite/client'));
  const boot = await callKit(handler, 'GET', '/api/frame-boot.js?v=0123456789abcdef');
  assert.equal(boot.res.statusCode, 200);
  assert.match(boot.res.headers['Content-Type'], /^application\/javascript/);
  assert.match(boot.res.text, /\/api\/frame 嵌入页的预览脚本运行时/);
  assert.ok(!boot.res.text.includes('/@vite/client'));
  const head = await callKit(handler, 'HEAD', '/api/frame-boot.js');
  assert.equal(head.res.statusCode, 200);
  assert.equal(head.res.chunks.length, 0);
  assert.equal(head.res.headers.ETag, boot.res.headers.ETag);
  const cached = await callKit(handler, 'GET', '/api/frame-boot.js', { 'if-none-match': boot.res.headers.ETag });
  assert.equal(cached.res.statusCode, 304);
  assert.equal(cached.res.chunks.length, 0);
  const post = await callKit(handler, 'POST', '/api/frame-shell.css');
  assert.equal(post.res.statusCode, 405);
  assert.equal(post.res.headers.Allow, 'GET, HEAD');
  const missing = await callKit(handler, 'GET', '/api/frame-boot/nope.js');
  assert.equal(missing.next, true, '外壳只有这两个精确路径，其余继续交给后面的路由');
});

test('外壳源读失败结束成 500 no-store，HEAD 无体，下一请求仍按正常资源应答', async () => {
  const handler = kitMiddleware();
  const readFileSync = fs.readFileSync;
  const indexPath = path.join(ROOT, 'index.html');
  fs.readFileSync = function (file, ...args) {
    if (String(file) === indexPath) {
      const error = new Error('probe: index.html unavailable');
      error.code = 'ENOENT';
      throw error;
    }
    return readFileSync.call(this, file, ...args);
  };
  try {
    const failed = await callKit(handler, 'GET', '/api/frame-shell.css');
    assert.equal(failed.next, false);
    assert.equal(failed.res.statusCode, 500);
    assert.equal(failed.res.headers['Cache-Control'], 'no-store');
    assert.equal(JSON.parse(failed.res.text).error, 'frame_failed');
    const head = await callKit(handler, 'HEAD', '/api/frame-shell.css');
    assert.equal(head.res.statusCode, 500);
    assert.equal(head.res.chunks.length, 0);
    assert.equal(head.res.headers['Cache-Control'], 'no-store');
    assert.match(head.res.headers['Content-Type'], /^application\/json/);
  } finally {
    fs.readFileSync = readFileSync;
  }
  const again = await callKit(handler, 'GET', '/api/frame-shell.css');
  assert.equal(again.res.statusCode, 200);
  assert.equal(again.res.headers['Cache-Control'], 'no-cache');
  assert.match(again.res.text, /html,body\{margin:0/);
  const cached = await callKit(handler, 'GET', '/api/frame-shell.css', { 'if-none-match': again.res.headers.ETag });
  assert.equal(cached.res.statusCode, 304);
  assert.equal(cached.res.chunks.length, 0);
});

test('缺失文件的真 404 带 no-cache（review 建议 3：URL 之后可能补回来，不许存「不存在」）', async () => {
  const handler = kitMiddleware();
  const { next, res } = await callKit(handler, 'GET', '/kits/nope.css');
  assert.equal(next, false, 'notFound 不放行给 vite 的 SPA fallback');
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['Cache-Control'], 'no-cache');
  assert.match(res.text, /^not found: \/kits\/nope\.css$/);
});


test('kit ETag 用 mtime 原值不取整（R5 S2）：取整会让同毫秒等长重写 304 回旧字节', async (t) => {
  await ensureAnnotateBundle();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-content-routes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // 独立的临时 root：只走 ios-kit.js 这条路由，不碰仓里的 kit 文件。
  // 「同毫秒等长重写」无法在测试里稳定构造（utimes 只有毫秒），改为钉死性质本身：
  // ETag 内嵌 stat.mtimeMs 原值——APFS 的亚毫秒一被 Math.round 折掉，等长重写就
  // 会撞出不变的 ETag（http-respond statEtag 的防坑注释）。
  const kitDir = path.join(dir, 'content', 'kits', 'ios');
  fs.mkdirSync(kitDir, { recursive: true });
  const kitFile = path.join(kitDir, 'ios-kit.js');
  fs.writeFileSync(kitFile, '/* kit */\n');
  const stat = fs.statSync(kitFile);
  if (stat.mtimeMs % 1 === 0) {
    t.skip('这块盘的 mtime 没有亚毫秒粒度，取整无从谈起');
    return;
  }
  const plugin = contentRoutes();
  let handler;
  plugin.configureServer({ config: { root: dir }, middlewares: { use(fn) { handler = fn; } } });
  const { res } = await callKit(handler, 'GET', '/kits/ios/ios-kit.js');
  assert.equal(res.statusCode, 200);
  assert.ok(
    res.headers.ETag.includes(`-${stat.mtimeMs}"`),
    `ETag 应内嵌 mtime 原值 ${stat.mtimeMs}，实际 ${res.headers.ETag}（Math.round 的旧实现这里必挂）`,
  );
});
