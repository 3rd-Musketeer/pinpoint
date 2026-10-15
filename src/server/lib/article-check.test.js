import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compile } from '@mdx-js/mdx';

import { checkProject, emptyRefsIn, projectEmptyRefs, projectTitleIssues } from './article-check.js';
import { articleOutline } from './article-canvas.js';
import { loadRegistry } from './registry.js';
import { extractRefs } from '../../shared/refs.js';
import { remarkPinpoint } from '../../shared/remark-pinpoint.js';

const GOOD_FRAME = 'export default function F() {\n  return <div className="ios-app">好</div>;\n}\n';
const LINT_FRAME = 'export default function F() {\n  return <div className="ios-app"><button onClick={() => 1}>x</button></div>;\n}\n';

/** 一个 project 两篇文章：broken（各种错）和 clean；一个概念引用了不存在的词。 */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'article-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const content = path.join(dir, 'proj', 'docs', 'pinpoint');
  const broken = path.join(content, 'articles', 'broken');
  const clean = path.join(content, 'articles', 'clean');
  fs.mkdirSync(broken, { recursive: true });
  fs.mkdirSync(clean, { recursive: true });
  fs.mkdirSync(path.join(content, 'wiki'), { recursive: true });
  fs.writeFileSync(path.join(content, 'project.json'), JSON.stringify({ id: 'demo', title: 'Demo' }));
  fs.writeFileSync(path.join(broken, 'index.mdx'), [
    '---', 'title: 坏', '---', '', // 1-4
    '见 [[clean]] 和 [[还没写]]。', // 5
    '', '<Section id="why" title="为什么">', '', '纯文字', '', '</Section>', // 6-11
    '', '<Section id="phone" title="写错 shell">', '', '<Canvas frames={["lint-me", "ok-frame"]} shell="phone" />', '', '</Section>', // 12-17
    '', '<Foo />', '', // 18-20
  ].join('\n'));
  fs.writeFileSync(path.join(broken, 'lint-me.jsx'), LINT_FRAME);
  fs.writeFileSync(path.join(broken, 'ok-frame.jsx'), GOOD_FRAME);
  fs.writeFileSync(path.join(clean, 'index.mdx'), '---\ntitle: 好\n---\n\n<Section id="a">\n\n<Canvas frames={["good"]} />\n\n</Section>\n\n```\n[[代码里的不算]]\n```\n');
  fs.writeFileSync(path.join(clean, 'good.jsx'), GOOD_FRAME);
  fs.writeFileSync(path.join(content, 'wiki', 'term.md'), '---\nname: term\n---\n\n指向 [[另一个空词]]。\n');
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ id: 'demo', kind: 'project', path: path.join(dir, 'proj') }] }));
  return { registry: loadRegistry({ root: dir, path: file, log: () => {} }), broken, clean, content };
}

test('articleOutline：纯文字的节也列；写错 shell 的节照样列出它字面上的帧', () => {
  const text = '---\ntitle: x\n---\n\n<Section id="why" title="为什么">\n\n</Section>\n\n<Section id="b">\n\n<Canvas frames={["f1", "f2"]} shell="phone" />\n\n</Section>\n';
  assert.deepEqual(articleOutline(text), [
    { n: 1, letter: 'A', id: 'why', title: '为什么', line: 5, frames: [], canvas: false },
    { n: 2, letter: 'B', id: 'b', title: 'b', line: 9, frames: ['f1', 'f2'], canvas: true },
  ]);
  assert.deepEqual(articleOutline('<Section id="a">\n'), [], 'MDX 解析不了时是空');
});

test('checkProject：布局错误、被挡在画布外的帧的 lint、正文渲染错误、空 ref 一次给全', async (t) => {
  const { registry, broken } = fixture(t);
  const result = await checkProject(registry, 'demo', { articleId: 'broken' });
  const brief = result.diagnostics.map((row) => [row.severity, row.code, path.basename(row.file), row.line]);
  // 按级别、文件、行排。
  assert.deepEqual(brief, [
    ['error', 'canvas_shell', 'index.mdx', 15],
    ['error', 'mdx_component_missing', 'index.mdx', 19],
    ['error', 'lint_event_attr', 'lint-me.jsx', 2],
    ['info', 'empty_ref', 'index.mdx', 5],
  ]);
  const lint = result.diagnostics[2];
  assert.equal(lint.file, path.join(broken, 'lint-me.jsx'));
  assert.equal(lint.section, 'phone');
  assert.equal(lint.frame, 'lint-me');
  assert.equal(lint.article, 'demo/broken');
  assert.doesNotMatch(result.diagnostics[0].message, /^第 \d+ 行/, '行号在 line 里，message 不重复');
  assert.equal(result.frames, 2);
  assert.deepEqual(result.articles, ['broken']);
});

test('checkProject：只查一篇时别篇和概念的问题不算；查整个 project 时都算', async (t) => {
  const { registry } = fixture(t);
  const one = await checkProject(registry, 'demo', { articleId: 'clean' });
  assert.deepEqual(one.diagnostics, [], '代码块里的 [[ ]] 不是空 ref');
  const all = await checkProject(registry, 'demo');
  assert.equal(all.diagnostics.filter((row) => row.severity === 'error').length, 3);
  assert.ok(all.diagnostics.some((row) => row.code === 'empty_ref' && row.file.endsWith('term.md') && row.line === 5));
  assert.equal(all.frames, 3);
  assert.equal(await checkProject(registry, 'nope'), null);
});

test('project title 只写名字：带冒号或超过 24 个字符给一条提示（info，不是错误）', async (t) => {
  assert.deepEqual(projectTitleIssues('Vault'), []);
  assert.deepEqual(projectTitleIssues('Areta browser use'), []);
  assert.deepEqual(projectTitleIssues('一二三四五六七八九十一二三四五六七八九十一二三四'), [], '正好 24 个字符');
  assert.deepEqual(projectTitleIssues('Vault：本地优先的笔记库'), ['带冒号']);
  assert.deepEqual(projectTitleIssues('Vault: notes'), ['带冒号']);
  assert.deepEqual(projectTitleIssues('Areta browser use for long running tasks'), ['超过 24 个字符']);

  const { registry, content } = fixture(t);
  assert.ok(!(await checkProject(registry, 'demo')).diagnostics.some((row) => row.code === 'project_title_long'));
  fs.writeFileSync(path.join(content, 'project.json'), '{\n  "id": "demo",\n  "title": "Demo：浏览器任务里怎样让用户在付款之前自己确认最后一步"\n}\n');
  for (const result of [await checkProject(registry, 'demo'), await checkProject(registry, 'demo', { articleId: 'clean' })]) {
    const hint = result.diagnostics.find((row) => row.code === 'project_title_long');
    assert.equal(hint.severity, 'info');
    assert.equal(hint.file, path.join(content, 'project.json'));
    assert.equal(hint.line, 3);
    assert.match(hint.message, /只写名字.*（带冒号、超过 24 个字符）$/);
  }
  assert.deepEqual((await checkProject(registry, 'demo', { articleId: 'clean' })).diagnostics.map((row) => row.severity), ['info'], '提示不让 check 失败');
});

// 站点列的空 ref（extractRefs）、ppnt check 报的空 ref（emptyRefsIn）和站点真正渲染成引用的
// （remark 步骤，跳过 code / inlineCode 节点）必须是同一组：代码怎么算只有一份实现。
test('空 ref 的扫描与 remark 步骤同口径：围栏没关、缩进围栏、带字的“结束行”、双反引号行内代码', async () => {
  const samples = {
    unclosed: '前 [[一]]\n\n```\n[[二]]\n',
    indented: '- 列表\n\n  ```\n  [[二]]\n  ```\n\n[[三]]\n',
    longerCloser: '````\n[[二]]\n`````\n\n[[三]]\n',
    otherChar: '~~~\n[[二]]\n```\n[[三]]\n~~~\n\n[[四]]\n',
    infoOnCloser: '```\n[[二]]\n``` js\n[[三]]\n```\n\n[[四]]\n',
    doubleTick: '有 ``a [[二]] `b`` 和 [[三]]\n',
    tickInsideSingle: '有 `a``[[二]]` 和 [[三]]\n',
  };
  const remarkRefs = async (value) => {
    const out = String(await compile({ value, path: '/x/docs/pinpoint/articles/a/index.mdx' }, {
      remarkPlugins: [[remarkPinpoint, { projectIdFor: () => 'p' }]],
    }));
    return [...out.matchAll(/raw: "([^"]*)"/g)].map((m) => m[1]);
  };
  const resolve = (raw) => ({ name: raw, projectId: 'p', found: false });
  const mismatches = [];
  for (const [name, text] of Object.entries(samples)) {
    const truth = JSON.stringify(await remarkRefs(text));
    const site = JSON.stringify(extractRefs(text));
    const check = JSON.stringify(emptyRefsIn(text, { from: 'p', resolve }).map((ref) => ref.raw));
    if (site !== truth) mismatches.push(`${name} · extractRefs ${site}，remark ${truth}`);
    if (check !== truth) mismatches.push(`${name} · emptyRefsIn ${check}，remark ${truth}`);
  }
  assert.deepEqual(mismatches, []);
});

test('emptyRefsIn / projectEmptyRefs：跳过 frontmatter 与代码；按名字合并来源', (t) => {
  const resolve = (raw) => ({ name: raw, projectId: 'p', found: raw === '有' });
  const text = '---\ntitle: "[[不算]]"\n---\n[[有]] [[无]]\n`[[行内代码]]`\n~~~\n[[围栏]]\n~~~\n[[无]]\n';
  assert.deepEqual(emptyRefsIn(text, { from: 'p', resolve }).map((ref) => [ref.name, ref.line]), [['无', 4], ['无', 9]]);
  const { registry } = fixture(t);
  assert.deepEqual(projectEmptyRefs(registry, 'demo').map((ref) => [ref.name, ref.sources.map((s) => `${s.kind}:${s.id}:${s.line}`)]), [
    ['还没写', ['article:broken:5']],
    ['另一个空词', ['concept:term:5']],
  ]);
});
