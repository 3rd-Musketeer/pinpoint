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

test('CACHE_POLICIES：brief 点名的六类资源各一行，值齐全', () => {
  for (const row of ['distScreen', 'frameHtml', 'staticFile', 'annotateBundle', 'boardJson', 'image']) {
    const policy = CACHE_POLICIES[row];
    assert.ok(policy, `缺 ${row} 行`);
    assert.match(policy.cacheControl, /^(no-cache|public, max-age=31536000, immutable)$/);
    assert.ok(['content', 'stat'].includes(policy.etag), `${row}.etag 应是 content|stat`);
  }
  assert.equal(CACHE_POLICIES.distScreen.cacheControl, 'no-cache');
  assert.equal(CACHE_POLICIES.frameHtml.cacheControl, 'no-cache');
  assert.equal(CACHE_POLICIES.boardJson.cacheControl, 'no-cache');
  assert.equal(CACHE_POLICIES.staticFile.etag, 'stat');
  assert.equal(CACHE_POLICIES.image.etag, 'stat');
  assert.equal(CACHE_POLICIES.annotateBundle.cacheControl, 'public, max-age=31536000, immutable');
});

test('contentEtag / statEtag：内容一变 ETag 就变；stat 是 mtime+size 的形状', () => {
  const a = contentEtag(Buffer.from('<p>one</p>'));
  const b = contentEtag(Buffer.from('<p>two</p>'));
  assert.match(a, /^"[0-9a-f]{16}"$/);
  assert.notEqual(a, b, '不同内容必须不同 ETag（HMR 后不许 304 旧内容）');
  assert.equal(contentEtag(Buffer.from('<p>one</p>')), a, '同内容同 ETag');
  assert.equal(statEtag({ mtimeMs: 1729300000123.4, size: 4242 }), '"1729300000123-4242"');
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
