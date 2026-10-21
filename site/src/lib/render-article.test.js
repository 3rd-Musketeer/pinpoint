import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

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

test('renderArticle：已识别的本篇坏 frontmatter 解析错转成可展示错误；他篇/无归属/模块表读失败仍照旧抛', async (t) => {
  // 实际解析器产错：mdx vite 插件 transform 用的同一个 safeParseFrontmatter，YAMLException 的
  // id/loc.file=传入路径、message=reason。包的 exports 不放行 dist 子路径，经 package.json 定位
  // 实际安装处再 import，错误形态以它为准、不在测试里仿造。
  const mdxRoot = path.dirname(createRequire(import.meta.url).resolve('@astrojs/mdx/package.json'));
  const { safeParseFrontmatter } = await import(pathToFileURL(path.join(mdxRoot, 'dist/utils.js')));
  const yamlErrorFrom = (file) => {
    try { safeParseFrontmatter('---\ntitle: [\n---\n正文', file); } catch (e) { return e; }
    throw new Error(`${file} 应抛 YAMLException`);
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-article-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'index.mdx');
  const neighbor = path.join(dir, 'neighbor.mdx');
  fs.writeFileSync(file, '---\ntitle: [\n---\n正文');
  fs.writeFileSync(neighbor, '---\ntitle: {\n---\n正文');
  const own = { ...entry, id: 'p/has-file', data: { file } };
  const modules = new Map([[own.filePath, () => {}]]);
  const run = (e, error) => renderArticle(e, { render: async () => { throw error; }, moduleImports: async () => modules });

  // 模块已登记、渲染时这篇源文件已写坏（内容库先写坏、loader 的 loadError 还没接上）：
  // 这篇的解析错要成为可展示的本篇错误，而不是通用 500；路径与原解析消息都保留。
  const bad = yamlErrorFrom(file);
  assert.deepEqual(await run(own, bad), { syncing: false, rendered: null, loadError: `${file}: ${bad.message}` });
  // macOS 上 /var 与 /private/var 是同一实物（loaders.js watchAll 的 expand 同款）：别名的两个方向都认领。
  const real = fs.realpathSync(file);
  assert.deepEqual(await run(own, yamlErrorFrom(real)), { syncing: false, rendered: null, loadError: `${file}: ${bad.message}` });
  assert.equal((await run({ ...own, data: { file: real } }, bad)).loadError, `${real}: ${bad.message}`);
  // 邻篇的解析错、带不可信路径形态（query）的错、没有路径的错：都不认领，原样抛。
  const nb = yamlErrorFrom(neighbor);
  await assert.rejects(run(own, nb), (e) => e === nb);
  const q = yamlErrorFrom(`${file}?v=1`);
  await assert.rejects(run(own, q), (e) => e === q);
  const stray = Object.assign(new Error('unexpected end of the stream'), { name: 'YAMLException' });
  await assert.rejects(run(own, stray), (e) => e === stray);
  // 模块表读失败仍抛原解析错；模块还没登记仍 syncing（语义不动）。
  await assert.rejects(renderArticle(own, { render: async () => { throw bad; }, moduleImports: async () => { throw new Error('map 读失败'); } }), (e) => e === bad);
  assert.deepEqual(await renderArticle(own, { render: async () => { throw bad; }, moduleImports: async () => new Map() }), { syncing: true });
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
