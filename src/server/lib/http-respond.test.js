import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BodyTooLargeError,
  CACHE_POLICIES,
  contentEtag,
  contentTypeFor,
  mimeFor,
  readBody,
  sendCacheable,
  sendFile,
  sendJson,
  sendMethodNotAllowed,
  statEtag,
} from './http-respond.js';
import { mockReq, mockRes } from '../test-harness.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('frameHtml：导航时暴露实际响应的 ETag，父文档可条件检查原生 iframe', () => {
  const body = Buffer.from('<html><body>原生页面</body></html>');
  const res = mockRes();
  sendCacheable(mockReq('GET', '/frame'), res, body, { policy: 'frameHtml', contentType: 'text/html' });
  assert.equal(res.headers['Server-Timing'], `pp-etag;desc="${encodeURIComponent(res.headers.ETag)}"`);
  assert.equal(res.text, body.toString(), '不改原生 HTML 字节或地址');
});

test('mimeFor / contentTypeFor：全表、fallback、文本类补 charset', () => {
  assert.equal(mimeFor('a.html'), 'text/html');
  assert.equal(mimeFor('a.JS'), 'application/javascript');
  assert.equal(mimeFor('a.unknown'), 'application/octet-stream');
  assert.equal(mimeFor('a.unknown', 'image/png'), 'image/png');
  assert.equal(contentTypeFor('a.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('a.json'), 'application/json; charset=utf-8');
  assert.equal(contentTypeFor('a.svg'), 'image/svg+xml; charset=utf-8');
  assert.equal(contentTypeFor('a.png'), 'image/png');
  assert.equal(contentTypeFor('a.woff2'), 'font/woff2');
});

test('sendJson：status、json 头、Content-Length；cacheControl 给了才发', () => {
  const res = mockRes();
  sendJson(res, 418, { error: 'teapot', message: '茶' });
  assert.equal(res.statusCode, 418);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['Content-Length'], String(Buffer.byteLength(JSON.stringify({ error: 'teapot', message: '茶' }))));
  assert.equal(res.headers['Cache-Control'], undefined);
  assert.deepEqual(res.json, { error: 'teapot', message: '茶' });

  const res2 = mockRes();
  sendJson(res2, 200, { ok: true }, { cacheControl: 'no-cache' });
  assert.equal(res2.headers['Cache-Control'], 'no-cache');
});

test('readBody：上限内原样读出；上限必给', async () => {
  assert.equal(await readBody(mockReq('POST', '/x', { a: 1 }), 1024), JSON.stringify({ a: 1 }));
  assert.throws(() => readBody(mockReq('POST', '/x', 'a'), 0), /readBody 要明确的字节上限/);
  assert.throws(() => readBody(mockReq('POST', '/x', 'a'), undefined), /readBody 要明确的字节上限/);
});

test('CACHE_POLICIES：出帧的五类资源各一行，值齐全；annotate bundle 不在表里', () => {
  for (const row of ['distScreen', 'frameHtml', 'staticFile', 'boardJson', 'image']) {
    const policy = CACHE_POLICIES[row];
    assert.ok(policy, `缺 ${row} 行`);
    assert.equal(policy.cacheControl, 'no-cache');
    assert.ok(['content', 'stat'].includes(policy.etag), `${row}.etag 应是 content|stat`);
  }
  assert.equal(CACHE_POLICIES.distScreen.cacheControl, 'no-cache');
  assert.equal(CACHE_POLICIES.frameHtml.cacheControl, 'no-cache');
  assert.equal(CACHE_POLICIES.boardJson.cacheControl, 'no-cache');
  assert.equal(CACHE_POLICIES.staticFile.etag, 'stat');
  assert.equal(CACHE_POLICIES.image.etag, 'stat');
  // review 建议 2：哈希地址路由自己写 immutable 头、不出 ETag，表行没有调用方。
  assert.ok(!('annotateBundle' in CACHE_POLICIES), 'annotate bundle 不该有看着像约定、实际不生效的死行');
});

test('contentEtag / statEtag：内容一变 ETag 就变；stat 是 mtime 原值+size 的形状', () => {
  const a = contentEtag(Buffer.from('<p>one</p>'));
  const b = contentEtag(Buffer.from('<p>two</p>'));
  assert.match(a, /^"[0-9a-f]{16}"$/);
  assert.notEqual(a, b, '不同内容必须不同 ETag（HMR 后不许 304 旧内容）');
  assert.equal(contentEtag(Buffer.from('<p>one</p>')), a, '同内容同 ETag');
  assert.equal(statEtag({ mtimeMs: 1729300000123.1, size: 4242 }), '"1729300000123.1-4242"', 'mtime 原值，不取整到毫秒');
});

test('sendCacheable：条件应答——If-None-Match 命中 304（弱比较与列表都算），未命中 200 出体', () => {
  const body = Buffer.from('<html>hi</html>');
  const tag = contentEtag(body);

  const fresh = mockRes();
  sendCacheable(mockReq('GET', '/x.html'), fresh, body, { policy: 'frameHtml', contentType: 'text/html; charset=utf-8' });
  assert.equal(fresh.statusCode, 200);
  assert.equal(fresh.headers['Cache-Control'], 'no-cache');
  assert.equal(fresh.headers.ETag, tag);
  assert.equal(fresh.text, '<html>hi</html>');

  for (const header of [tag, `W/${tag}`, `"other", ${tag}`, '*']) {
    const res304 = mockRes();
    const req = mockReq('GET', '/x.html');
    req.headers = { 'if-none-match': header };
    sendCacheable(req, res304, body, { policy: 'frameHtml', contentType: 'text/html; charset=utf-8' });
    assert.equal(res304.statusCode, 304, header);
    assert.equal(res304.chunks.length, 0, '304 不带体');
    assert.equal(res304.headers['Content-Length'], undefined, '304 不带表示头');
    assert.equal(res304.headers.ETag, tag, '304 带 ETag 让浏览器记住验证器');
  }

  const miss = mockRes();
  const missReq = mockReq('GET', '/x.html');
  missReq.headers = { 'if-none-match': '"stale"' };
  sendCacheable(missReq, miss, body, { policy: 'frameHtml', contentType: 'text/html; charset=utf-8' });
  assert.equal(miss.statusCode, 200);
  assert.equal(miss.text, '<html>hi</html>');

  const head = mockRes();
  sendCacheable(mockReq('HEAD', '/x.html'), head, body, { policy: 'frameHtml', contentType: 'text/html; charset=utf-8' });
  assert.equal(head.statusCode, 200);
  assert.equal(head.chunks.length, 0, 'HEAD 只回头');
  assert.equal(head.headers['Content-Length'], String(body.length));

  assert.throws(() => sendCacheable(mockReq('GET', '/x'), mockRes(), body, { policy: 'no-such-row', contentType: 'text/plain' }), /策略表里的一行/);
});

test('readBody：超上限拒 BodyTooLargeError，不resolve出截断体；不毁请求（应答要能发出去）', async () => {
  const req = mockReq('POST', '/x', 'x'.repeat(100));
  let destroyed = false;
  req.destroy = () => { destroyed = true; };
  await assert.rejects(readBody(req, 10), (error) => {
    assert.ok(error instanceof BodyTooLargeError);
    assert.equal(error.message, 'body is too large');
    assert.equal(error.limit, 10);
    return true;
  });
  assert.equal(destroyed, false, 'req.destroy 会把 socket 带走，调用方的 413 发不出去');
});

test('sendFile：出文件 + 头；HEAD 只回头；inject 只作用于 HTML；策略行定缓存', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-respond-'));
  const html = path.join(dir, 'a.html');
  const png = path.join(dir, 'a.png');
  fs.writeFileSync(html, '<html><body>hi</body></html>');
  fs.writeFileSync(png, Buffer.from([1, 2, 3]));

  const res = mockRes();
  assert.equal(sendFile(mockReq('GET', '/a.html'), res, html), true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(res.headers['Cache-Control'], 'no-cache');
  assert.equal(res.headers['Content-Length'], String(fs.statSync(html).size));
  assert.equal(res.headers.ETag, statEtag(fs.statSync(html)), '缺省 staticFile 行用 mtime+size');
  assert.equal(res.text, '<html><body>hi</body></html>');

  // 条件请求：静态文件带 If-None-Match 回 304，文件重写（mtime 变）后放行新内容。
  const hit = mockRes();
  const hitReq = mockReq('GET', '/a.html');
  hitReq.headers = { 'if-none-match': statEtag(fs.statSync(html)) };
  sendFile(hitReq, hit, html);
  assert.equal(hit.statusCode, 304);
  assert.equal(hit.chunks.length, 0);

  const head = mockRes();
  sendFile(mockReq('HEAD', '/a.html'), head, html);
  assert.equal(head.chunks.length, 0);
  assert.equal(head.headers['Content-Length'], String(fs.statSync(html).size));

  const injected = mockRes();
  sendFile(mockReq('GET', '/a.html'), injected, html, { inject: (body) => body + '<!-- ann -->' });
  assert.equal(injected.text, '<html><body>hi</body></html><!-- ann -->');
  assert.equal(injected.headers['Content-Length'], String(Buffer.byteLength(injected.text)));

  // HTML 帧（frameHtml 行）：ETag 是注入后字节的内容哈希，注入一变就变。
  const frame = mockRes();
  sendFile(mockReq('GET', '/a.html'), frame, html, { inject: (body) => body + '<!-- ann -->', policy: 'frameHtml' });
  assert.equal(frame.headers['Cache-Control'], 'no-cache');
  assert.equal(frame.headers.ETag, contentEtag(Buffer.from('<html><body>hi</body></html><!-- ann -->')));

  const notHtml = mockRes();
  sendFile(mockReq('GET', '/a.png'), notHtml, png, { inject: (body) => body + 'x', policy: 'image' });
  assert.deepEqual([...notHtml.body], [1, 2, 3]);
  assert.equal(notHtml.headers['Cache-Control'], 'no-cache');
  assert.equal(notHtml.headers['Content-Type'], 'image/png');
  assert.equal(notHtml.headers.ETag, statEtag(fs.statSync(png)));

  assert.throws(() => sendFile(mockReq('GET', '/a.html'), mockRes(), html, { policy: 'nope' }), /策略表里的一行/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('同一毫秒内的等长重写：stat ETag 分得开，带旧 ETag 必须拿到新内容（review 必须修 1）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-respond-samems-'));
  const css = path.join(dir, 'article.css');
  // 两次写入的 mtime 用 utimesSync 构造（不赛真实时间）：取整后同一个整毫秒、
  // 亚毫秒不同——APFS 相邻两次写入的真实分布（125µs 一格，取整后常同毫秒）。
  // 亚毫秒都取 0.5 以下：Math.round 会把 ≥0.5 的进位到下一毫秒，取整就不同了。
  const base = 1729300000123; // 整毫秒
  const at = (ms) => (base + ms) / 1000; // utimesSync 收秒
  fs.writeFileSync(css, '.x { color: red;  } /* 1 */\n');
  fs.utimesSync(css, at(0.1), at(0.1));
  const first = mockRes();
  sendFile(mockReq('GET', '/article.css'), first, css);
  assert.equal(first.statusCode, 200);
  const etag = first.headers.ETag;
  const before = fs.statSync(css);

  fs.writeFileSync(css, '.x { color: blue; } /* 1 */\n'); // 等长、不同字节
  fs.utimesSync(css, at(0.4), at(0.4));
  const after = fs.statSync(css);
  // 前提（平台得能表达亚毫秒 mtime，两次写入落进同一个整毫秒）：
  assert.equal(Math.round(before.mtimeMs), base, '第一次写入的 mtime（前提）');
  assert.equal(Math.round(after.mtimeMs), base, '第二次写入同一个整毫秒（前提）');
  assert.notEqual(before.mtimeMs, after.mtimeMs, '亚毫秒把两次写入分开（前提）');

  const revalidate = mockRes();
  const req = mockReq('GET', '/article.css');
  req.headers = { 'if-none-match': etag };
  sendFile(req, revalidate, css);
  assert.equal(revalidate.statusCode, 200, '同一毫秒内等长重写，旧 ETag 不许 304');
  assert.equal(revalidate.text, '.x { color: blue; } /* 1 */\n');
  assert.notEqual(revalidate.headers.ETag, etag, '新字节的新验证器');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('sendFile：读的窗口里文件被改写就重读，体和 ETag 是同一份（review 必须修 1 后半）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-respond-window-'));
  const css = path.join(dir, 'article.css');
  // 改写的 mtime 也用 utimesSync 钉死（不赛真实时间：两次真实写入会落进 APFS
  // 同一个 tick，mtimeNs 不动，改写就探测不到）。
  const base = 1729300000123; // 整毫秒
  const at = (ms) => (base + ms) / 1000; // utimesSync 收秒
  fs.writeFileSync(css, '.x { color: red;  }\n');
  fs.utimesSync(css, at(0.1), at(0.1));
  // 在「读之后那一次 stat」前把文件改写成等长新内容：旧实现（先读后 stat）在这
  // 里体 = 旧字节、ETag = 新 stat，这个 ETag 被记下去以后每次验证都 304 旧体。
  const realStatSync = fs.statSync;
  let calls = 0;
  try {
    fs.statSync = (...args) => {
      if (++calls === 2) {
        fs.writeFileSync(css, '.x { color: blue; }\n');
        fs.utimesSync(css, at(0.4), at(0.4));
      }
      return realStatSync(...args);
    };
    const res = mockRes();
    sendFile(mockReq('GET', '/article.css'), res, css);
    assert.equal(res.statusCode, 200);
    assert.equal(res.text, '.x { color: blue; }\n', '读的窗口里被改写：重读拿新体');
    assert.equal(res.headers.ETag, statEtag(realStatSync(css)), 'ETag 与体同源');
  } finally {
    fs.statSync = realStatSync;
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

test('sendMethodNotAllowed：405 + Allow + 统一错误体', () => {
  const res = mockRes();
  sendMethodNotAllowed(res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET, HEAD');
  assert.deepEqual(res.json, { error: 'method_not_allowed', message: 'method not allowed' });

  const postOnly = mockRes();
  sendMethodNotAllowed(postOnly, 'POST');
  assert.equal(postOnly.headers.Allow, 'POST');
});
