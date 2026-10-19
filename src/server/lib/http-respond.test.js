import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BodyTooLargeError,
  contentTypeFor,
  mimeFor,
  readBody,
  sendFile,
  sendJson,
  sendMethodNotAllowed,
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

test('sendFile：出文件 + 头；HEAD 只回头；inject 只作用于 HTML', () => {
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
  assert.equal(res.text, '<html><body>hi</body></html>');

  const head = mockRes();
  sendFile(mockReq('HEAD', '/a.html'), head, html);
  assert.equal(head.chunks.length, 0);
  assert.equal(head.headers['Content-Length'], String(fs.statSync(html).size));

  const injected = mockRes();
  sendFile(mockReq('GET', '/a.html'), injected, html, { inject: (body) => body + '<!-- ann -->' });
  assert.equal(injected.text, '<html><body>hi</body></html><!-- ann -->');
  assert.equal(injected.headers['Content-Length'], String(Buffer.byteLength(injected.text)));

  const notHtml = mockRes();
  sendFile(mockReq('GET', '/a.png'), notHtml, png, { inject: (body) => body + 'x', cacheControl: null });
  assert.deepEqual([...notHtml.body], [1, 2, 3]);
  assert.equal(notHtml.headers['Cache-Control'], undefined);
  assert.equal(notHtml.headers['Content-Type'], 'image/png');

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
