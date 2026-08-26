import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createExportPageHtmlHandler } from './export-page-html-api.js';

function request(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}

function response() {
  return {
    statusCode: 0, headers: {}, chunks: [],
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { if (value !== undefined) this.chunks.push(Buffer.from(value)); },
    get body() { return Buffer.concat(this.chunks); },
    get json() { return JSON.parse(this.body.toString('utf8')); },
  };
}

test('scan discloses remote resources without returning the HTML payload', async () => {
  const calls = [];
  const handler = createExportPageHtmlHandler({
    builder: async (options) => {
      calls.push(options);
      return {
        pageId: 'demo', title: 'Demo', filename: 'demo__interactive.html', sectionCount: 2, frameCount: 4,
        remoteResources: [{ url: 'https://assets.example/a.svg', size: 8, sha256: 'abc', mime: 'image/svg+xml' }],
        html: '<!doctype html><p>secret payload</p>',
      };
    },
  });
  const res = response();
  assert.equal(await handler(request({ pageId: 'demo' }), res, '/api/export-page-html/scan'), true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.frameCount, 4);
  assert.equal(res.json.html, undefined);
  assert.equal(calls[0].approvals, undefined);
});

test('download forwards approvals and returns one HTML attachment', async () => {
  const calls = [];
  const handler = createExportPageHtmlHandler({
    builder: async (options) => {
      calls.push(options);
      return {
        pageId: 'demo', title: 'Demo', filename: 'demo__interactive.html', sectionCount: 1, frameCount: 2,
        remoteResources: [], html: '<!doctype html><p>offline</p>',
      };
    },
  });
  const approvals = [{ url: 'https://assets.example/a.svg', sha256: 'abc' }];
  const res = response();
  await handler(request({ pageId: 'demo', approvals }), res, '/api/export-page-html');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.match(res.headers['Content-Disposition'], /demo__interactive\.html/);
  assert.equal(res.headers['X-Export-Frames'], '2');
  assert.deepEqual(calls[0].approvals, approvals);
  assert.match(res.body.toString('utf8'), /offline/);
});
