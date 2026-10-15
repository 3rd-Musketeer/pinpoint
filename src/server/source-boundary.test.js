import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fixture, SAFE, SECRET, jsx } from './source-boundary-fixture.js';

test('编译源文件 HTTP 边界：HTML、JSX、组件、依赖、图与板越界时拒绝，旧 dist 不返回', async (t) => {
  const cases = [
    { name: 'HTML', files: { 'view.html': `<p>${SAFE}</p>` }, rel: 'view.html', secret: `<p>${SECRET}</p>` },
    { name: 'JSX', files: { 'view.jsx': jsx(SAFE) }, rel: 'view.jsx', secret: jsx(SECRET) },
    { name: 'import 组件', files: { 'view.jsx': "import View from './components/View.jsx';\nexport default View;\n", 'components/View.jsx': jsx(SAFE) }, rel: 'components/View.jsx', secret: jsx(SECRET) },
    { name: 'import JSON', files: { 'view.jsx': "import text from './data.json';\nexport default function View() {\n return <p>{text}</p>;\n}\n", 'data.json': JSON.stringify(SAFE) }, rel: 'data.json', secret: JSON.stringify(SECRET) },
    { name: 'comp 来源', board: { sections: [{ id: 's', shell: 'comp', screens: [{ id: 'view', comp: 'View' }] }] }, files: { 'components/View.jsx': jsx(SAFE) }, rel: 'components/View.jsx', secret: jsx(SECRET) },
    { name: 'board', files: { 'view.html': `<p>${SAFE}</p>` }, rel: 'board.json', secret: JSON.stringify({ title: SECRET, sections: [{ id: 's', shell: 'app', screens: ['view'] }] }) },
    ...['figures/view.jsx', 'components/View.jsx', 'figures/view.js', 'figures/view.css'].map((rel) => ({
      name: `图 ${rel}`, article: true, figure: true, rel,
      files: { 'view.jsx': jsx(SAFE), 'figures/view.jsx': "import View from '../components/View.jsx';\nexport default View;\n", 'components/View.jsx': jsx(SAFE), 'figures/view.js': 'export default function mount() {}', 'figures/view.css': 'p { color: red; }' },
      secret: rel.endsWith('.jsx') ? jsx(SECRET) : rel.endsWith('.css') ? `/* ${SECRET} */` : `export const text = '${SECRET}';`,
    })),
    { name: '模板 board HTML', template: true, files: { 'view.html': `<p>${SAFE}</p>` }, rel: 'view.html', secret: `<p>${SECRET}</p>` },
  ];
  for (const item of cases) await t.test(item.name, async (t) => {
    const fx = await fixture(t, item);
    const pageId = item.article ? 'demo_demo' : 'legacy';
    const urls = item.figure ? [`/api/frame?page=${pageId}&figure=view&embed=figure`]
      : item.template ? ['/previews/demo/view.html?annotate=off']
        : [`/sites/${pageId}/view.html?annotate=off`, `/api/frame?page=${pageId}&screen=view&annotate=off`];
    for (const url of urls) {
      const first = await fx.get(url);
      assert.equal(first.status, 200, `${item.name} 正常文件`);
      assert.ok(first.text.includes(SAFE));
    }
    fx.replace(item.rel, item.secret);
    for (const state of ['已有 dist', '冷编译']) {
      for (const url of urls) {
        const res = await fx.get(url);
        assert.ok(!res.text.includes(SECRET), `${state} ${url} 不得含根外内容`);
        assert.ok(!res.text.includes(SAFE), `${state} ${url} 不得返回旧产物`);
        assert.ok([404, 500].includes(res.status), `${state} ${url}: ${res.status}`);
      }
      fs.rmSync(path.join(fx.data, 'dist'), { recursive: true, force: true });
    }
    if (item.rel === 'board.json') {
      const res = await fx.get('/sites/legacy/board.json');
      assert.equal(res.status, 404);
      assert.ok(!res.text.includes(SECRET));
    }
  });
});


test('project 元数据 HTTP 边界：project.json 与 wiki 目录均不得从根外读出内容', async (t) => {
  for (const kind of ['project.json', 'wiki']) await t.test(kind, async (t) => {
    const fx = await fixture(t, { article: true, files: { 'view.jsx': jsx(SAFE) } });
    const metadata = path.join(fx.project, 'docs/pinpoint');
    const outside = path.join(fx.root, 'outside');
    fs.mkdirSync(outside);
    if (kind === 'project.json') {
      const file = path.join(outside, 'project.json');
      fs.writeFileSync(file, JSON.stringify({ id: 'demo', title: SECRET }));
      fs.unlinkSync(path.join(metadata, 'project.json'));
      fs.symlinkSync(file, path.join(metadata, 'project.json'));
    } else {
      fs.writeFileSync(path.join(outside, 'secret.md'), `---\nname: ${SECRET}\nboundary: ${SECRET}\n---\n`);
      fs.symlinkSync(outside, path.join(metadata, 'wiki'));
    }
    for (const url of ['/api/projects', '/api/projects/demo', '/api/projects/demo/articles/demo/canvas']) {
      const response = await fx.get(url);
      assert.equal(response.status, 200);
      assert.ok(!response.text.includes(SECRET), `${kind}: ${url}`);
    }
  });
});

test('编译仍接受登记根 alias 与根内源码 symlink，HTTP 正文正确', async (t) => {
  for (const article of [false, true]) await t.test(article ? '文章' : '存量页', async (t) => {
    const fx = await fixture(t, { article, alias: true, files: { 'view.jsx': jsx(SAFE), 'components/Inside.jsx': jsx(SAFE) } });
    fs.unlinkSync(path.join(fx.page, 'view.jsx'));
    fs.symlinkSync('components/Inside.jsx', path.join(fx.page, 'view.jsx'));
    const id = article ? 'demo_demo' : 'legacy';
    for (const url of [`/sites/${id}/view.html?annotate=off`, `/api/frame?page=${id}&screen=view&annotate=off`]) {
      const response = await fx.get(url);
      assert.equal(response.status, 200);
      assert.ok(response.text.includes(SAFE));
    }
  });
});
