import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadRegistry } from './lib/registry.js';
import { annotateSnippet, createSitesHandler, injectAnnotateClient } from './sites-api.js';

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
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({
    version: 1,
    entries: [
      { id: 'site', title: 'Site', kind: 'dir', path: site, board: 'web' },
      { id: 'web', title: 'Web', kind: 'url', url: 'https://web.localhost' },
    ],
  }));
  const registry = loadRegistry({ path: path.join(dir, 'registry.json'), root: dir, log: () => {} });
  return { dir, site, handler: createSitesHandler({ registry }) };
}

function mockReq(method, url) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  return req;
}

function mockRes() {
  return {
    headers: {},
    statusCode: 0,
    chunks: [],
    setHeader(key, value) { this.headers[key] = value; },
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); },
    write(chunk) { this.chunks.push(Buffer.from(chunk)); },
    end(data) { if (data !== undefined) this.chunks.push(Buffer.from(data)); },
    get body() { return Buffer.concat(this.chunks); },
    get text() { return this.body.toString('utf8'); },
  };
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
  assert.ok(body.includes('<script src="/annotate.js"></script>'));
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
  assert.equal(json.res.text, '{"sections":[]}');
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
  // url entries are not served under /sites/.
  assert.equal((await call(handler, 'GET', '/sites/web/index.html')).res.statusCode, 404);
  assert.equal((await call(handler, 'GET', '/sites/site/missing.html')).res.statusCode, 404);
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
