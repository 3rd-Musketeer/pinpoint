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
  fs.writeFileSync(path.join(page, 'index.html'), '<!doctype html><html><body><h1>index</h1></body></html>');
  fs.writeFileSync(path.join(page, 'wired.html'),
    '<!doctype html><html><body><h1>wired</h1><script data-ios-annotate src="/annotate.js"></script></body></html>');
  fs.writeFileSync(path.join(page, 'fragment.html'), '<div class="ios-app"><p>fragment</p></div>');
  fs.mkdirSync(path.join(page, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(page, 'pages', 'about.html'), '<!doctype html><html><body><h1>about</h1></body></html>');
  fs.writeFileSync(path.join(page, 'board.json'), JSON.stringify({
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'home', title: 'Home' }] }],
  }));
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
  // storage-unify：注入带 entry 标记 = 该 previews 页自己的 id（桶 = 页）。
  assert.ok(res.text.includes("window.__pinpointEntry='demo'"));
  // 子路径整文档同样以第一段（页 id）为 entry。
  const nested = call(handler, 'GET', '/previews/demo/pages/about.html');
  assert.ok(nested.res.text.includes("window.__pinpointEntry='demo'"));
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

test('pp2：board 屏 URL 不注入（让给 content-routes 从 dist 出）；非屏整文档照注入', (t) => {
  const { handler } = withFixture(t);
  // 屏 URL：<页>/<屏>.html 命中 board.json 的屏 → 放行，dist 版由 content-routes 注入。
  assert.equal(call(handler, 'GET', '/previews/demo/home.html').handled, false);
  // 屏形状但不在板里（doc 不在 board.json，盘上有文件）：当非屏整文档照常注入。
  const notInBoard = call(handler, 'GET', '/previews/demo/doc.html');
  assert.equal(notInBoard.handled, true);
  assert.ok(notInBoard.res.text.includes('<script src="/annotate.js"></script>'));
  // 非屏形状（子路径整文档）照注入——屏分支收窄不得波及。
  const nested = call(handler, 'GET', '/previews/demo/pages/about.html');
  assert.equal(nested.handled, true);
  assert.ok(nested.res.text.includes('<!doctype html>'));
  assert.ok(nested.res.text.includes('<script src="/annotate.js"></script>'));
});

test('路径穿越拒绝', (t) => {
  const { handler } = withFixture(t);
  assert.equal(call(handler, 'GET', '/previews/..%2Fsecret.html').handled, false);
  assert.equal(call(handler, 'GET', '/previews/../secret.html').handled, false);
});
