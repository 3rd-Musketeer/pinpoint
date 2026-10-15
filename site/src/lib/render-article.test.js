import test from 'node:test';
import assert from 'node:assert/strict';

import { renderArticle, syncingResponse } from './render-article.js';

const entry = { id: 'p/hello', deferredRender: true, filePath: '../../sites/p/docs/pinpoint/articles/hello/index.mdx' };
const missing = () => { throw Object.assign(new Error('Unexpected error while rendering  → p/hello.'), { name: 'UnknownContentCollectionError' }); };

test('renderArticle：渲染模块表里还没有这篇（内容库先到）→ syncing，页面回 503 而不是 500', async () => {
  const out = await renderArticle(entry, { render: missing, moduleImports: async () => new Map() });
  assert.deepEqual(out, { syncing: true });
});

test('renderArticle：模块表里有这篇时的渲染错误照旧抛；正常渲染原样交回', async () => {
  const modules = new Map([[entry.filePath, () => {}]]);
  await assert.rejects(renderArticle(entry, { render: missing, moduleImports: async () => modules }), /Unexpected error while rendering/);
  await assert.rejects(renderArticle({ ...entry, deferredRender: false }, { render: missing, moduleImports: async () => new Map() }), /Unexpected error/);
  const ok = await renderArticle(entry, { render: async () => ({ Content: 'C' }), moduleImports: async () => { throw new Error('不该读'); } });
  assert.deepEqual(ok, { syncing: false, rendered: { Content: 'C' } });
});

test('syncingResponse：503、Retry-After、不缓存、会自己刷新', async () => {
  const res = syncingResponse('你好 <b>');
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '1');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /<title>你好 &lt;b&gt;<\/title>/);
});
