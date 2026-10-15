import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fixture, SAFE, SECRET } from './source-boundary-fixture.js';

test('模板非板 HTML HTTP 边界：注入、annotate=off、HEAD、fragment 与目录 symlink 都不越界', async (t) => {
  for (const previewAlias of [false, true]) await t.test(previewAlias ? '根自身是 alias' : '普通根', async (t) => {
    const fx = await fixture(t, { template: true, previewAlias, files: { 'doc.html': `<!doctype html><p>${SAFE}</p>`, 'fragment.html': `<p>${SAFE}</p>`, 'inside.html': `<!doctype html><p>${SAFE}</p>` } });
    fs.symlinkSync('inside.html', path.join(fx.page, 'inside-alias.html'));
    for (const url of ['/previews/demo/doc.html', '/previews/demo/inside-alias.html']) {
      const response = await fx.get(url);
      assert.equal(response.status, 200);
      assert.ok(response.text.includes(SAFE));
    }
    fx.replace('doc.html', `<!doctype html><p>${SECRET}</p>`);
    fx.replace('fragment.html', `<p>${SECRET}</p>`);
    fs.symlinkSync(path.join(fx.root, 'outside'), path.join(fx.root, 'content/previews/alias'));
    for (const url of ['/previews/demo/doc.html', '/previews/demo/doc.html?annotate=off', '/previews/demo/fragment.html', '/previews/alias/doc.html', '/previews/demo/%64oc.html', '/previews/demo/..%2f..%2foutside/doc.html']) {
      for (const method of ['GET', 'HEAD']) {
        const res = await fx.get(url, { method });
        assert.ok(!res.text.includes(SECRET), `${method} ${url}`);
        assert.equal(res.status, 404, `${method} ${url}`);
      }
    }
  });
});

test('模板的越界 board 不退回注入或静态服务，HTTP 正文没有旧帧', async (t) => {
  const fx = await fixture(t, { template: true, files: { 'view.html': `<!doctype html><p>${SAFE}</p>` } });
  assert.ok((await fx.get('/previews/demo/view.html')).text.includes(SAFE));
  fx.replace('board.json', JSON.stringify({ title: SECRET, sections: [] }));
  for (const url of ['/previews/demo/view.html', '/previews/demo/view.html?annotate=off', '/previews/demo/board.json']) {
    const response = await fx.get(url);
    assert.equal(response.status, 404);
    assert.ok(!response.text.includes(SECRET));
    assert.ok(!response.text.includes(SAFE));
  }
});
