import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkMdxRender, SITE_MDX_COMPONENTS } from './mdx-check.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILE = '/tmp/not-a-project/index.mdx';
const FM = '---\ntitle: 测试\nsummary: 一句话\n---\n';

test('站点提供的组件名与文章页传给 <Content> 的一致（改 index.astro 时同步 SITE_MDX_COMPONENTS）', () => {
  const page = fs.readFileSync(path.join(ROOT, 'site', 'src', 'pages', '[project]', '[article]', 'index.astro'), 'utf8');
  const m = page.match(/<Content components=\{\{\s*([^}]*)\}\}/);
  assert.ok(m, 'index.astro 里找不到 <Content components={{…}} />');
  assert.deepEqual(m[1].split(',').map((name) => name.trim()).filter(Boolean).sort(), [...SITE_MDX_COMPONENTS].sort());
});

test('干净的正文没有诊断（站点组件、表达式、[[ ]] 都照常）', async () => {
  const text = `${FM}\n开头 {1 + 1} [[某个词]]\n\n<Section id="a" title="A">\n\n<Canvas frames={["x"]} />\n\n</Section>\n`;
  assert.deepEqual(await checkMdxRender(text, { file: FILE }), []);
});

test('没定义的组件：每个组件一条，行号是整份文件的行号（frontmatter 也算）', async () => {
  const text = `${FM}\n<Section id="a">\n\n<Foo />\n\n</Section>\n\n<Bar>x</Bar>\n`;
  const rows = await checkMdxRender(text, { file: FILE });
  assert.deepEqual(rows.map((row) => [row.code, row.line, row.severity]).sort(), [
    ['mdx_component_missing', 12, 'error'],
    ['mdx_component_missing', 8, 'error'],
  ]);
  assert.match(rows.find((row) => row.line === 8).message, /<Foo> 没有定义/);
});

test('渲染时抛错（没定义的变量）：按 source map 找回正文的行', async () => {
  const text = `${FM}\n第一段\n\n<Section id="a">\n\n值是 {undefinedVar}。\n\n</Section>\n`;
  const rows = await checkMdxRender(text, { file: FILE });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, 'mdx_render');
  assert.equal(rows[0].line, 10);
  assert.match(rows[0].message, /ReferenceError: undefinedVar is not defined/);
});

test('编译不过：mdx_compile，带行号', async () => {
  const rows = await checkMdxRender(`${FM}\n\n<div>\n`, { file: FILE });
  assert.equal(rows[0].code, 'mdx_compile');
  assert.equal(rows[0].line, 7);
});
