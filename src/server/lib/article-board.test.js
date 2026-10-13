import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { articleCanvas, articlePageRows, deriveArticleBoard, listArticleTargets, resolveArticleTarget } from './article-board.js';
import { compilePage, distStatus, listCompileTargets, listPageIds, readDistScreen, renderScreenHtml, resolvePageTarget } from './page-compiler.js';
import { articlePageId, ARTICLE_PAGE_ID_PATTERN, findProject, listProjects, parseArticlePageId } from './projects.js';
import { planPageRecompile } from './recompile-plan.js';
import { ENTRY_ID_PATTERN, PAGE_ID_PATTERN } from './registry.js';

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** 临时 project：一篇 flow 文章（两节画布 + 一节纯正文）、article.css、三层组件。 */
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-article-board-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'proj');
  const content = path.join(root, 'docs', 'pinpoint');
  const article = path.join(content, 'articles', 'flow');
  write(path.join(content, 'project.json'), JSON.stringify({ id: 'demo', title: 'Demo' }));
  write(path.join(article, 'index.mdx'), [
    '---', 'title: 流程', '---', '',
    '<Section id="intro" title="开头">', '', '正文', '', '</Section>', '',
    '<Section id="ask" title="提问">', '', '<Canvas frames={["ask-open", "ask-sent"]} />', '', '</Section>', '',
    '<Section id="wall" title="组件墙">', '', '<Canvas frames={["wall"]} shell="comp" />', '', '</Section>', '',
  ].join('\n'));
  // 组件解析序：本篇 components/ > project components/ > kit。Card 两处都有，取本篇的。
  write(path.join(article, 'components', 'Card.jsx'), 'export function Card() {\n  return <div className="article-card">本篇</div>;\n}\n');
  write(path.join(content, 'components', 'Card.jsx'), 'export function Card() {\n  return <div className="project-card">project</div>;\n}\n');
  write(path.join(content, 'components', 'Shared.jsx'), 'export function Shared() {\n  return <div className="project-shared">共用</div>;\n}\n');
  write(path.join(article, 'ask-open.jsx'), [
    "import { Card } from './components/Card.jsx';",
    "import { Shared } from './components/Shared.jsx';",
    "import { Nav } from './components/Nav.jsx';",
    '',
    'export default function AskOpen() {',
    '  return (',
    '    <div className="ios-app">',
    '      <Nav title="提问" size="compact" />',
    '      <Card />',
    '      <Shared />',
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n'));
  write(path.join(article, 'ask-sent.jsx'), 'export default function AskSent() {\n  return <div className="ios-app">已发送</div>;\n}\n');
  write(path.join(article, 'wall.jsx'), 'export default function Wall() {\n  return <div className="wall">墙</div>;\n}\n');
  write(path.join(article, 'article.css'), '.article-card { color: red; }\n');
  const registry = { entries: [], projects: [{ id: 'demo', kind: 'project', path: root }] };
  const distRoot = path.join(dir, 'dist');
  return { dir, root, content, article, registry, distRoot };
}

test('articlePageId：<project>_<article>，拆得回去，匹配 PAGE_ID_PATTERN，永远不匹配条目 id 规则', () => {
  const id = articlePageId('browser-use', 'payment-confirm');
  assert.equal(id, 'browser-use_payment-confirm');
  assert.ok(PAGE_ID_PATTERN.test(id));
  assert.ok(!ENTRY_ID_PATTERN.test(id), 'registry 条目 id 不含 _，所以不会撞');
  assert.ok(ARTICLE_PAGE_ID_PATTERN.test(id));
  assert.deepEqual(parseArticlePageId(id), { projectId: 'browser-use', articleId: 'payment-confirm' });
  for (const bad of ['browser-use', 'a_b_c', '_a', 'a_', 'A_b', '']) assert.equal(parseArticlePageId(bad), null, bad);
  assert.throws(() => articlePageId('Bad', 'x'), /必须匹配/);
  assert.throws(() => articlePageId('a', 'b_c'), /必须匹配/);
});

test('resolveArticleTarget / resolvePageTarget：登记的 project 下有 index.mdx 才是目标', (t) => {
  const { registry, article } = fixture(t);
  const target = resolvePageTarget('demo_flow', { registry });
  assert.deepEqual(
    { kind: target.kind, entryId: target.entryId, pageDir: target.pageDir, urlBase: target.urlBase, projectId: target.projectId, articleId: target.articleId },
    { kind: 'article', entryId: 'demo_flow', pageDir: article, urlBase: '/sites/demo_flow/', projectId: 'demo', articleId: 'flow' },
  );
  assert.equal(resolveArticleTarget(registry, 'demo_ghost'), null);
  assert.equal(resolveArticleTarget(registry, 'other_flow'), null);
  assert.equal(resolveArticleTarget(registry, 'demo_concepts'), null);
  assert.equal(resolvePageTarget('demo_flow', { registry: null }), null);
  assert.deepEqual(listArticleTargets(registry).map((row) => row.entryId), ['demo_flow']);
  assert.ok(listPageIds({ registry }).includes('demo_flow'));
  assert.ok(listCompileTargets({ registry }).some((row) => row.entryId === 'demo_flow'));
  assert.deepEqual(articlePageRows(registry), [{ id: 'demo_flow', title: '流程', project: 'demo', article: 'flow', url: '/demo/flow/' }]);
});

test('deriveArticleBoard：只含有 Canvas 的节，帧是 screen，article.css 进 assets', (t) => {
  const { registry, article } = fixture(t);
  const { board, errors } = deriveArticleBoard(resolveArticleTarget(registry, 'demo_flow'));
  assert.deepEqual(errors, []);
  assert.deepEqual(board, {
    title: '流程',
    article: { project: 'demo', id: 'flow', url: '/demo/flow/' },
    sections: [
      { id: 'ask', title: '提问', layout: 'row', letter: 'B', screens: [{ id: 'ask-open' }, { id: 'ask-sent' }] },
      { id: 'wall', title: '组件墙', layout: 'row', letter: 'C', shell: 'comp', screens: [{ id: 'wall' }] },
    ],
    assets: { css: ['article.css'] },
  });
  write(path.join(article, 'article.js'), 'export default function () {}\n');
  assert.deepEqual(deriveArticleBoard(resolveArticleTarget(registry, 'demo_flow')).board.assets, { css: ['article.css'], js: ['article.js'] });
});

test('编译：dist 出帧与派生 board，源目录不多任何文件；组件按 本篇 > project > kit 解析', async (t) => {
  const { registry, article, distRoot } = fixture(t);
  const before = fs.readdirSync(article).sort();
  const target = resolvePageTarget('demo_flow', { registry });
  const result = await compilePage(target, { distRoot });
  assert.equal(result.ok, true, JSON.stringify(result.screens));
  assert.deepEqual(result.screens.map((row) => row.id), ['ask-open', 'ask-sent', 'wall']);
  assert.deepEqual(fs.readdirSync(article).sort(), before, '不写回源目录');
  const html = readDistScreen('demo_flow', 'ask-open', { distRoot }).html;
  assert.match(html, /^<style>@import url\("\/sites\/demo_flow\/article\.css"\);<\/style>/);
  assert.match(html, /class="article-card"[^>]*>本篇</);
  assert.doesNotMatch(html, /project-card/);
  assert.match(html, /class="project-shared"[^>]*data-pp-comp="Shared">共用</);
  assert.match(html, /data-pp-id="content\/kits\/ios\/jsx\/Nav\.jsx:\d+@1" data-pp-comp="Nav"/);
  assert.match(html, /data-pp-id="ask-open\.jsx:7@1"/);
  const distBoard = JSON.parse(fs.readFileSync(path.join(distRoot, 'demo_flow', 'board.json'), 'utf8'));
  assert.deepEqual(distBoard, deriveArticleBoard(target).board);
  assert.deepEqual(await renderScreenHtml(target, 'ask-sent'), { ok: true, html: '<style>@import url("/sites/demo_flow/article.css");</style>\n<div class="ios-app" data-pp-id="ask-sent.jsx:2@1" data-pp-comp="AskSent">已发送</div>' });
});

test('dist 状态与增量：改正文不算画布变（noop），改节或帧才重编', async (t) => {
  const { registry, article, distRoot } = fixture(t);
  const target = resolvePageTarget('demo_flow', { registry });
  await compilePage(target, { distRoot });
  const board = () => deriveArticleBoard(target).board;
  assert.equal(distStatus('demo_flow', article, { distRoot, board: board() }).stale, false);
  const mdx = path.join(article, 'index.mdx');
  const original = fs.readFileSync(mdx, 'utf8');
  // 只改正文：画布没变。
  fs.writeFileSync(mdx, original.replace('正文', '改过的正文'));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(mdx, later, later);
  assert.equal(distStatus('demo_flow', article, { distRoot, board: board() }).stale, false);
  assert.deepEqual(planPageRecompile(target, [mdx], { distRoot }), { all: false, screens: [], noop: true });
  // 改了节标题：画布变了 → 全编、dist 过期。
  fs.writeFileSync(mdx, original.replace('title="提问"', 'title="发问"'));
  assert.equal(distStatus('demo_flow', article, { distRoot, board: board() }).stale, true);
  assert.deepEqual(planPageRecompile(target, [mdx], { distRoot }), { all: true });
  await compilePage(target, { distRoot });
  // 改一帧：只重编这一帧（与普通页同一套增量）。
  const frame = path.join(article, 'ask-sent.jsx');
  fs.writeFileSync(frame, fs.readFileSync(frame, 'utf8').replace('已发送', '发出去了'));
  assert.deepEqual(planPageRecompile(target, [frame], { distRoot }), { all: false, screens: ['ask-sent'] });
});

test('articleCanvas：节字母 = 正文字母（纯文字的节也占），帧引用号与工作台同一套；错误带节、只取这篇的', async (t) => {
  const { registry, content } = fixture(t);
  const canvas = (project, id) => articleCanvas(project, id, { registry });
  assert.deepEqual(canvas('demo', 'flow'), {
    pageId: 'demo_flow',
    project: 'demo',
    article: 'flow',
    sections: [
      { id: 'ask', title: '提问', letter: 'B', frames: [{ id: 'ask-open', ref: 'B1' }, { id: 'ask-sent', ref: 'B2' }] },
      { id: 'wall', title: '组件墙', letter: 'C', shell: 'comp', frames: [{ id: 'wall', ref: 'C1' }] },
    ],
    errors: [],
  });
  // 工作台与 ppnt 用同一套编号：编译后 ppnt 的 boardRefs 也是 B1 / C1。
  const { boardRefs } = await import('../../workbench/lib/board-refs.js');
  const { validateBoard } = await import('../../workbench/lib/preview-contracts.js');
  const derived = deriveArticleBoard(resolveArticleTarget(registry, 'demo_flow')).board;
  assert.deepEqual(boardRefs(validateBoard(derived)).outline.map((s) => [s.letter, s.frames.map((f) => f.ref)]), [['B', ['B1', 'B2']], ['C', ['C1']]]);

  write(path.join(content, 'articles', 'bad', 'index.mdx'), '---\ntitle: [x]\n---\n<Section id="x">\n\n<Canvas frames={["flow/ask-open", "ghost"]} />\n\n<Canvas frames={["y"]} />\n\n</Section>\n');
  const bad = canvas('demo', 'bad');
  assert.equal(bad.pageId, 'demo_bad');
  assert.deepEqual(bad.sections, [{ id: 'x', title: 'x', letter: 'A', frames: [{ id: 'ghost', ref: 'A1', missing: true }] }]);
  assert.deepEqual(bad.errors.map(({ section, frame, line }) => ({ section, frame, line })), [
    { section: 'x', frame: undefined, line: 8 },
    { section: 'x', frame: 'flow/ask-open', line: 6 },
    { section: 'x', frame: 'ghost', line: 6 },
    // frontmatter 的错误不属于哪一节：页级。
    { section: undefined, frame: undefined, line: undefined },
  ]);
  assert.match(bad.errors[3].message, /frontmatter 第 2 行/);
  // 同一份错误也进 project 的布局错误（pinpoint list <project>、站点错误条），带文件前缀。
  const projectErrors = findProject(registry, 'demo').errors;
  assert.equal(projectErrors.length, 4);
  for (const error of bad.errors) assert.ok(projectErrors.includes(`articles/bad/index.mdx：${error.message}`), error.message);
  assert.deepEqual(canvas('demo', 'flow').errors, []);
  assert.deepEqual(canvas('demo', 'ghost').errors, [{ message: '文章不存在：articles/ghost/index.mdx' }]);
  assert.deepEqual(canvas('nope', 'flow').errors, [{ message: 'project 没登记：nope' }]);
});

test('画布页 id 撞上既有页 → project 的布局错误', (t) => {
  const { registry } = fixture(t);
  // 条目 id 按规则不会含 _；这里绕过登记校验直接塞一条，验证检查确实在跑。
  const withClash = { ...registry, entries: [{ id: 'demo_flow', kind: 'dir', path: '/x' }] };
  const [project] = listProjects(withClash);
  assert.deepEqual(project.errors, ['articles/flow：画布页 id "demo_flow" 与registry 条目 "demo_flow"撞名，画布打不开（改文章 id 或那个页的 id）']);
  assert.deepEqual(listProjects(registry)[0].errors, []);
});
