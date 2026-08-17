import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPreviewInjectHandler } from './preview-inject.js';

function withFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-inject-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const page = path.join(root, 'previews', 'demo');
  fs.mkdirSync(page, { recursive: true });
  fs.writeFileSync(path.join(page, 'doc.html'), '<!doctype html><html><body><h1>doc</h1></body></html>');
  fs.writeFileSync(path.join(page, 'wired.html'),
    '<!doctype html><html><body><h1>wired</h1><script data-ios-annotate src="/annotate.js"></script></body></html>');
  fs.writeFileSync(path.join(page, 'fragment.html'), '<div class="ios-app"><p>fragment</p></div>');
  fs.writeFileSync(path.join(page, 'board.json'), '{"sections":[]}');
  return { root, handler: createPreviewInjectHandler({ root }) };
}

function call(handler, method, url) {
  const [urlPath, query] = url.split('?');
  const req = new EventEmitter();
  req.method = method;
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.text = body || ''; },
  };
  const handled = handler(req, res, urlPath, query || '');
  return { handled, res };
}

test('previews 完整文档自动注入 annotate 客户端（契约统一）', (t) => {
  const { handler } = withFixture(t);
  const { handled, res } = call(handler, 'GET', '/previews/demo/doc.html');
  assert.equal(handled, true);
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
  assert.ok(res.text.includes('<script src="/annotate.js"></script>'));
  // previews 注入不带 entry 标记 —— 账本 ENTRY 保持缺省 pinpoint（存量账本兼容）
  assert.ok(!res.text.includes('__pinpointEntry'));
});

test('fragment / 非 html / 不存在 一律放行', (t) => {
  const { handler } = withFixture(t);
  assert.equal(call(handler, 'GET', '/previews/demo/fragment.html').handled, false);
  assert.equal(call(handler, 'GET', '/previews/demo/board.json').handled, false);
  assert.equal(call(handler, 'GET', '/previews/demo/missing.html').handled, false);
  assert.equal(call(handler, 'POST', '/previews/demo/doc.html').handled, false);
});

test('?annotate=off 与已带手工注入段的页面跳过', (t) => {
  const { handler } = withFixture(t);
  assert.equal(call(handler, 'GET', '/previews/demo/doc.html?annotate=off').handled, false);
  assert.equal(call(handler, 'GET', '/previews/demo/wired.html').handled, false);
});

test('路径穿越拒绝', (t) => {
  const { handler } = withFixture(t);
  assert.equal(call(handler, 'GET', '/previews/..%2Fsecret.html').handled, false);
  assert.equal(call(handler, 'GET', '/previews/../secret.html').handled, false);
});
