// 正文里的图（docs/projects.md“图”）：编译、按需重编、编译与运行错误、整页编译带上图。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveArticleTarget } from './page-resolve.js';
import {
  compileFigure, compilePage, figureDistErrors, figureRecordFresh, loadFigure, readFigureRecord, recordFigureRuntimeError,
} from './page-compiler.js';

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** 临时 project：文章 flow，一个带 sidecar 和样式的图、一个静态图，组件分在本篇和 project。 */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-figure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'proj');
  const content = path.join(root, 'docs', 'pinpoint');
  const article = path.join(content, 'articles', 'flow');
  write(path.join(content, 'project.json'), JSON.stringify({ id: 'demo' }));
  write(path.join(article, 'index.mdx'), [
    '---', 'title: 流程', '---', '',
    '<Figure src="figures/steps.jsx" caption="逐步" />', '',
    '<Section id="s" title="S">', '', '<Figure src="figures/still.jsx" />', '', '<Canvas frames={["f"]} />', '', '</Section>', '',
  ].join('\n'));
  write(path.join(article, 'f.jsx'), 'export default function F() {\n  return <div className="ios-app">帧</div>;\n}\n');
  write(path.join(article, 'figures', 'steps.jsx'), [
    "import { textWidth } from 'pinpoint/figure';",
    "import { Label } from '../components/Label.jsx';",
    '',
    'export default function Steps() {',
    "  const w = textWidth('用户', 13);",
    '  return (',
    '    <svg viewBox="0 0 200 40">',
    '      <rect width={w} height="20" data-step="1" />',
    '      <Label text="下一步" />',
    '    </svg>',
    '  );',
    '}',
    '',
  ].join('\n'));
  write(path.join(article, 'figures', 'steps.js'), "import { steps } from 'pinpoint/figure';\n\nexport default function mount(root) {\n  return steps(root);\n}\n");
  write(path.join(article, 'figures', 'steps.css'), '.x { fill: var(--fig-accent); }\n');
  write(path.join(article, 'figures', 'still.jsx'), 'export default function Still() {\n  return <svg viewBox="0 0 10 10"><text>静</text></svg>;\n}\n');
  // ../components/Label.jsx：本篇没有，落到 project 的 components/。
  write(path.join(content, 'components', 'Label.jsx'), 'export function Label({ text }) {\n  return <text className="label">{text}</text>;\n}\n');
  const registry = { entries: [], projects: [{ id: 'demo', kind: 'project', path: root }] };
  const target = resolveArticleTarget(registry, 'demo_flow');
  return { dir, article, target, distRoot: path.join(dir, 'dist') };
}

test('compileFigure：和帧同一套编译（pinpoint/figure、../components/ 落到 project），记下全部输入', async (t) => {
  const { target } = fixture(t);
  const result = await compileFigure(target, 'steps');
  assert.equal(result.ok, true, result.error);
  assert.match(result.html, /<rect width="26" height="20" data-step="1"/); // textWidth('用户', 13) = 26
  assert.match(result.html, /<text class="label"[^>]*>下一步<\/text>/);
  assert.match(result.html, /data-pp-id="figures\/steps\.jsx:8@1"/);
  assert.equal(result.script, true);
  assert.equal(result.css, true);
  assert.equal(result.usesKit, false);
  const files = result.sources.map((s) => s.file);
  assert.deepEqual(files.slice(0, 3), ['figures/steps.jsx', 'figures/steps.js', 'figures/steps.css']);
  assert.ok(files.some((f) => f.endsWith('content/kits/figure/figure.js')), files.join(' '));
  assert.ok(files.some((f) => f.endsWith('components/Label.jsx')), files.join(' '));
  const still = await compileFigure(target, 'still');
  assert.deepEqual([still.ok, still.script, still.css], [true, false, false]);
});

test('compileFigure 的错误：缺文件、lint 四禁（带文件与行）、没有默认导出、sidecar 语法错误', async (t) => {
  const { article, target } = fixture(t);
  assert.match((await compileFigure(target, 'ghost')).error, /^figures\/ghost\.jsx: 源文件不存在/);
  write(path.join(article, 'figures', 'click.jsx'), 'export default function Click() {\n  return <button onClick={go}>点</button>;\n}\n');
  assert.match((await compileFigure(target, 'click')).error, /figures\/click\.jsx:2: 禁止事件属性 onClick/);
  write(path.join(article, 'figures', 'bare.jsx'), "export default 'svg';\n");
  assert.match((await compileFigure(target, 'bare')).error, /图文件必须默认导出/);
  write(path.join(article, 'figures', 'steps.js'), 'export default function mount(root) {\n  return steps(root;\n}\n');
  assert.match((await compileFigure(target, 'steps')).error, /figures\/steps\.js:2: /);
});

test('loadFigure：没编过就编；源码、sidecar、依赖变了或新加了样式就重编；没变就读记录', async (t) => {
  const { article, target, distRoot } = fixture(t);
  const first = await loadFigure(target, 'still', { distRoot });
  assert.equal(first.ok, true);
  assert.ok(fs.existsSync(path.join(distRoot, 'demo_flow', 'figures', 'still.html')));
  const again = await loadFigure(target, 'still', { distRoot });
  assert.equal(again.record.builtAt, first.record.builtAt, '没变不重编');
  // 新加样式：记录不再代表盘上的源码。
  write(path.join(article, 'figures', 'still.css'), '.y {}\n');
  assert.equal(figureRecordFresh(target, 'still', readFigureRecord(distRoot, 'demo_flow', 'still')), false);
  const restyled = await loadFigure(target, 'still', { distRoot });
  assert.notEqual(restyled.record.builtAt, first.record.builtAt);
  assert.equal(restyled.record.css, true);
  // 改坏：读到错误，旧的 HTML 不顶班。
  const file = path.join(article, 'figures', 'still.jsx');
  write(file, 'export default function Still() {\n  return <svg onLoad={x} />;\n}\n');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  const broken = await loadFigure(target, 'still', { distRoot });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /figures\/still\.jsx:2: 禁止事件属性 onLoad/);
  assert.ok(!fs.existsSync(path.join(distRoot, 'demo_flow', 'figures', 'still.html')));
  // 改 project 的组件（依赖）也重编。
  await loadFigure(target, 'steps', { distRoot });
  const label = path.join(path.dirname(path.dirname(article)), 'components', 'Label.jsx');
  fs.utimesSync(label, later, later);
  assert.equal(figureRecordFresh(target, 'steps', readFigureRecord(distRoot, 'demo_flow', 'steps')), false);
});

test('整页编译带上正文里的图：ppnt build 逐个报，图编不过整页算失败；只编挑中的屏时不碰图', async (t) => {
  const { article, target, distRoot } = fixture(t);
  const result = await compilePage(target, { distRoot });
  assert.deepEqual(result.figures.map((row) => [row.id, row.ok]), [['steps', true], ['still', true]]);
  assert.equal(result.ok, true);
  write(path.join(article, 'figures', 'still.jsx'), 'export default function Still() {\n  fetch("/x");\n  return <svg />;\n}\n');
  const failed = await compilePage(target, { distRoot });
  assert.equal(failed.ok, false);
  assert.match(failed.figures.find((row) => row.id === 'still').error, /figures\/still\.jsx:2: 禁止 fetch/);
  assert.deepEqual((await compilePage(target, { distRoot, onlyScreens: ['f'] })).figures, []);
});

test('运行错误只记在这一版上；figureDistErrors 把编译与运行错误写成带节和行的 project 错误', async (t) => {
  const { article, target, distRoot } = fixture(t);
  const loaded = await loadFigure(target, 'still', { distRoot });
  const builtAt = loaded.record.builtAt;
  assert.equal(recordFigureRuntimeError(distRoot, 'demo_flow', 'still', { builtAt: builtAt - 1, message: '旧版的错' }), false);
  assert.equal(recordFigureRuntimeError(distRoot, 'demo_flow', 'still', { builtAt, message: 'boom', line: 3 }), true);
  assert.equal(recordFigureRuntimeError(distRoot, 'demo_flow', 'still', { builtAt, message: '第二次' }), true);
  assert.deepEqual(readFigureRecord(distRoot, 'demo_flow', 'still').runtimeError, { message: 'boom', line: 3 });
  write(path.join(article, 'figures', 'steps.jsx'), 'export default function Steps() {\n  return <svg onClick={x} />;\n}\n');
  const errors = await figureDistErrors(target, { distRoot });
  assert.deepEqual(errors.map((e) => [e.code, e.path, e.figure, e.line, e.section]), [
    ['figure_compile', 'articles/flow/index.mdx', 'steps', 5, undefined],
    ['figure_runtime', 'articles/flow/index.mdx', 'still', 9, 's'],
  ]);
  assert.match(errors[0].message, /^第 5 行：<Figure> 图 "steps" 编译失败：figures\/steps\.jsx:2: 禁止事件属性 onClick/);
  assert.equal(errors[1].message, '第 9 行：<Figure> 图 "still" 在浏览器里运行出错：boom（figures/still.js 第 3 行）');
  // 重编换掉记录，旧的运行错误跟着消失。
  const file = path.join(article, 'figures', 'still.jsx');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  assert.deepEqual((await figureDistErrors(target, { distRoot })).map((e) => e.figure), ['steps']);
});
