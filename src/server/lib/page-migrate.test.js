import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseArgs, run } from '../../../bin/pinpoint-cli.js';
import { parseArticleCanvas } from './article-canvas.js';
import { buildArticleMdx, compFrameSource, diffLineCount, MigrateError, planPageMigration, verifyMigration, writeMigration } from './page-migrate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function tmpDir(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pinpoint-migrate-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 一个空 project 根（只有 project.json）。 */
function projectRoot(dir, id = 'demo') {
  const root = path.join(dir, 'proj');
  write(path.join(root, 'docs', 'pinpoint', 'project.json'), JSON.stringify({ id, title: 'Demo' }));
  return root;
}

/** 目录里每个文件的 sha1：证明旧页一个字节没动。 */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const item of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, item.name);
      if (item.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

/**
 * 存量页固件：平铺 sections；一帧单屏 lock；comp 墙（页内组件 + kit 组件，带 props）；
 * 组件的传递依赖；sidecar；assets 两个 css（一个在子目录、带相对 url）+ 一个 js；
 * 页地址写死的图片（/sites/legacy-page/…）、拼出来的地址和相对引用。
 */
function legacyPage(dir) {
  const page = path.join(dir, 'legacy');
  write(path.join(page, 'board.json'), JSON.stringify({
    assets: { css: ['styles/main.css', 'extra.css'], js: ['pk.js'] },
    sections: [
      { id: 'flow', title: '流程', layout: 'row', screens: [
        { id: 'home', title: '首页' },
        { id: 'lock-note', title: '锁屏', shell: 'lock' },
      ] },
      { id: 'wall', title: '徽章墙', layout: 'row', shell: 'comp', screens: [
        { id: 'badge-on', title: '亮', comp: 'Badge', props: { label: '新', count: 2, on: true, 'data-x': 'y' } },
        { id: 'nav-kit', title: 'kit', comp: 'Nav', props: { title: '标题', size: 'compact' } },
      ] },
    ],
  }));
  write(path.join(page, 'home.jsx'), [
    "import { Badge } from './components/Badge.jsx';",
    '',
    'export default function Home() {',
    '  return (',
    '    <div class="ios-app" data-preview-mount>',
    '      <img src="/sites/legacy-page/img/logo.svg" alt="" />',
    '      <img src="./img/dot.png" alt="" />',
    '      <Badge label="首页" />',
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n'));
  write(path.join(page, 'home.js'), 'export default function mount(root) { root.dataset.on = "1"; }\n');
  write(path.join(page, 'lock-note.jsx'), [
    'export default function LockNote() {',
    '  return <div class="ios-lockscreen"><p>锁屏通知</p></div>;',
    '}',
    '',
  ].join('\n'));
  write(path.join(page, 'components', 'Badge.jsx'), [
    "import { Dot } from './Dot.jsx';",
    '',
    'export function Badge({ label, count, on }) {',
    '  return <span class="badge" data-on={on ? "1" : "0"}><Dot />{label}{count ? ` ${count}` : ""}</span>;',
    '}',
    '',
  ].join('\n'));
  write(path.join(page, 'components', 'Dot.jsx'), [
    'export function Dot({ kind = "a" }) {',
    '  return <i class="dot" style={{ backgroundImage: `url(/sites/legacy-page/icons/${kind}.svg)` }} />;',
    '}',
    '',
  ].join('\n'));
  write(path.join(page, 'components', 'Unused.jsx'), 'export function Unused() { return <b />; }\n');
  write(path.join(page, 'styles', 'main.css'), '.badge { background: url(../img/bg.png) no-repeat; }\n');
  write(path.join(page, 'extra.css'), '@import url("https://example.com/font.css");\n.dot { width: 4px; }\n');
  write(path.join(page, 'pk.js'), 'export default function () {}\n');
  write(path.join(page, 'img', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write(path.join(page, 'img', 'dot.png'), 'PNG');
  write(path.join(page, 'img', 'bg.png'), 'PNG2');
  write(path.join(page, 'icons', 'a.svg'), '<svg/>');
  write(path.join(page, 'icons', 'b.svg'), '<svg/>');
  write(path.join(page, 'img', 'unused.png'), 'X');
  return page;
}

function registryWith(page, extra = {}) {
  return { entries: [{ id: 'legacy-page', title: '旧页 "引号"', kind: 'dir', board: 'ios', path: page, ...extra }], projects: [] };
}

test('flat sections + comp props + assets + page-absolute paths: plan, write, verify', async (t) => {
  const dir = tmpDir(t, 'flat');
  const page = legacyPage(dir);
  const root = projectRoot(dir);
  const before = snapshot(page);
  const plan = await planPageMigration({ pageId: 'legacy-page', projectRoot: root, registry: registryWith(page) });
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.articlePageId, 'demo_legacy-page');
  assert.deepEqual([...plan.files.keys()].sort(), [
    'article.css', 'article.js', 'assets/icons/a.svg', 'assets/icons/b.svg', 'assets/img/bg.png', 'assets/img/dot.png', 'assets/img/logo.svg',
    'badge-on.jsx', 'components/Badge.jsx', 'components/Dot.jsx', 'home.js', 'home.jsx', 'index.mdx', 'lock-note.jsx', 'nav-kit.jsx',
  ]);
  const content = (rel) => plan.files.get(rel).content ?? fs.readFileSync(plan.files.get(rel).from, 'utf8');

  // index.mdx：frontmatter（title 带引号也能解析）、每节一行正文占位、comp 墙带 shell。
  assert.equal(content('index.mdx'), [
    '---', 'title: "旧页 \\"引号\\""', 'summary: ""', '---', '',
    '<Section id="flow" title="流程">', '{/* 正文 */}', '', '<Canvas frames={["home", "lock-note"]} />', '</Section>', '',
    '<Section id="wall" title="徽章墙">', '{/* 正文 */}', '', '<Canvas frames={["badge-on", "nav-kit"]} shell="comp" />', '</Section>', '',
  ].join('\n'));

  // comp 屏 → 帧文件：页内组件按命名导出 import，kit 组件从 pinpoint/kit；props 变成属性。
  assert.equal(content('badge-on.jsx'), [
    "import { Badge } from './components/Badge.jsx';", '', 'export const shell = "comp";', '',
    'export default function BadgeOn() {', '  return <Badge label="新" count={2} on data-x="y" />;', '}', '',
  ].join('\n'));
  assert.match(content('nav-kit.jsx'), /^import \{ Nav \} from 'pinpoint\/kit';/);

  // 页地址 → 画布页地址 + assets/；相对引用（运行时按页根解析）→ ./assets/；拼出来的地址整目录搬。
  assert.match(content('home.jsx'), /src="\/sites\/demo_legacy-page\/assets\/img\/logo\.svg"/);
  assert.match(content('home.jsx'), /src="\.\/assets\/img\/dot\.png"/);
  assert.match(content('components/Dot.jsx'), /url\(\/sites\/demo_legacy-page\/assets\/icons\/\$\{kind\}\.svg\)/);
  assert.equal(content('home.jsx').split('\n').length, fs.readFileSync(path.join(page, 'home.jsx'), 'utf8').split('\n').length);
  // 单屏 shell 补在文件末尾，前面的行（data-pp-id 的行号）不动。
  assert.ok(content('lock-note.jsx').startsWith(fs.readFileSync(path.join(page, 'lock-note.jsx'), 'utf8')));
  assert.match(content('lock-note.jsx'), /\nexport const shell = "lock";\n$/);
  // article.css：两份拼起来，@import 提到最前，子目录 css 的相对 url 改成相对 article.css。
  assert.equal(content('article.css'), [
    '@import url("https://example.com/font.css");', '',
    '/* styles/main.css */', '.badge { background: url(assets/img/bg.png) no-repeat; }', '', '',
    '/* extra.css */', '.dot { width: 4px; }', '',
  ].join('\n'));
  assert.equal(content('article.js'), 'export default function () {}\n');
  assert.ok(plan.warnings.some((w) => /4 个帧标题不带过来/.test(w)));
  assert.ok(plan.warnings.some((w) => /icons\/ → assets\/icons\//.test(w)));

  writeMigration(plan);
  const report = await verifyMigration(plan);
  assert.deepEqual(report.errors, []);
  assert.equal(report.ok, true, JSON.stringify(report.rows, null, 2));
  assert.deepEqual(report.rows.map((row) => [row.ref, row.frame, row.shell, row.compile]), [
    ['A1', 'home', 'app', 'ok'], ['A2', 'lock-note', 'lock', 'ok'], ['B1', 'badge-on', 'comp', 'ok'], ['B2', 'nav-kit', 'comp', 'ok'],
  ]);
  // 旧页渲染换成新地址后与新文章逐字相同。
  assert.deepEqual(report.rows.map((row) => row.diff), ['urls', 'urls', 'urls', 'urls']);
  assert.deepEqual(snapshot(page), before, '旧页一个字节都不能动');
  // 再迁一次：目录已在，拒绝。
  await assert.rejects(planPageMigration({ pageId: 'legacy-page', projectRoot: root, registry: registryWith(page) }), /文章目录已存在/);
});

test('tabs flatten into ## headings; section letters stay A, B, C across the article', async (t) => {
  const dir = tmpDir(t, 'tabs');
  const root = projectRoot(dir);
  const page = path.join(ROOT, 'e2e', 'tabs-site');
  const before = snapshot(page);
  const plan = await planPageMigration({ pageId: 'tabs', projectRoot: root, articleId: 'tabbed', registry: { entries: [{ id: 'tabs', kind: 'dir', board: 'ios', path: page }] } });
  assert.deepEqual(plan.problems, []);
  const mdx = plan.files.get('index.mdx').content;
  assert.ok(mdx.indexOf('## 组件') < mdx.indexOf('<Section id="btn-wall"'));
  assert.ok(mdx.indexOf('## 交互') > mdx.indexOf('<Section id="chip-wall"') && mdx.indexOf('## 交互') < mdx.indexOf('<Section id="onboard"'));
  assert.equal((mdx.match(/^## /gm) || []).length, 2);
  // 二级标题不占节字母。
  const parsed = parseArticleCanvas(mdx);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.sections.map((s) => `${s.articleLetter}:${s.id}`), ['A:btn-wall', 'B:chip-wall', 'C:onboard']);
  writeMigration(plan);
  const report = await verifyMigration(plan);
  assert.equal(report.ok, true);
  assert.deepEqual(report.rows.map((row) => row.ref), ['A1', 'A2', 'B1', 'C1', 'C2']);
  assert.ok(report.rows.every((row) => row.diff === 'same' || row.diff === 'urls'));
  assert.deepEqual(snapshot(page), before);
});

test('template page with comp walls and a sidecar migrates; html-mode default shell becomes Canvas shell="doc"', async (t) => {
  const dir = tmpDir(t, 'tpl');
  const root = projectRoot(dir);
  const plan = await planPageMigration({ pageId: 'example', projectRoot: root, registry: { entries: [] } });
  assert.deepEqual(plan.problems, []);
  assert.ok(plan.files.has('timer.js'), 'sidecar 跟着帧走');
  assert.equal(plan.files.get('article.css').from, path.join(ROOT, 'content', 'previews', 'example', 'example.css'));
  writeMigration(plan);
  const report = await verifyMigration(plan);
  assert.equal(report.ok, true);
  assert.equal(report.rows.length, 9);

  // board 没写 ios 的 dir 页：屏缺省是 doc，派生的 Canvas 要写明。
  const page = path.join(dir, 'docpage');
  write(path.join(page, 'board.json'), JSON.stringify({ sections: [{ id: 'docs', title: '文档', layout: 'row', screens: [{ id: 'spec' }] }] }));
  write(path.join(page, 'spec.jsx'), 'export default function Spec() { return <main>spec</main>; }\n');
  const docPlan = await planPageMigration({ pageId: 'docpage', projectRoot: root, registry: { entries: [{ id: 'docpage', kind: 'dir', path: page }] } });
  assert.match(docPlan.files.get('index.mdx').content, /<Canvas frames=\{\["spec"\]\} shell="doc" \/>/);
});

test('blocking problems and refusals: no project, html frame, missing source, outside import, bad ids', async (t) => {
  const dir = tmpDir(t, 'bad');
  const page = path.join(dir, 'bad');
  write(path.join(page, 'board.json'), JSON.stringify({ sections: [{ id: 's', title: 'S', layout: 'row', screens: [
    { id: 'old' }, { id: 'gone' }, { id: 'reach' }, { id: 'wall', comp: 'Nope', props: {} },
  ] }] }));
  write(path.join(page, 'old.html'), '<div></div>');
  write(path.join(page, 'reach.jsx'), "import { X } from '../shared/X.jsx';\nexport default function Reach() { return <X />; }\n");
  write(path.join(dir, 'shared', 'X.jsx'), 'export function X() { return <b />; }\n');
  const registry = { entries: [{ id: 'bad', kind: 'dir', board: 'ios', path: page }] };

  await assert.rejects(planPageMigration({ pageId: 'bad', projectRoot: path.join(dir, 'nowhere'), registry }), (error) => error instanceof MigrateError && /不是可用的 project/.test(error.message));
  await assert.rejects(planPageMigration({ pageId: 'ghost-page', projectRoot: projectRoot(dir), registry }), /找不到页/);
  await assert.rejects(planPageMigration({ pageId: 'bad', projectRoot: path.join(dir, 'proj'), articleId: 'concepts', registry }), /文章 id 不可用/);

  const plan = await planPageMigration({ pageId: 'bad', projectRoot: path.join(dir, 'proj'), registry });
  assert.equal(plan.problems.length, 3, plan.problems.join('\n'));
  assert.match(plan.problems.join('\n'), /gone 没有源文件/);
  assert.match(plan.problems.join('\n'), /页目录外的文件/);
  assert.match(plan.problems.join('\n'), /组件 Nope 找不到/);
  assert.throws(() => writeMigration(plan), /不写/);
  assert.equal(fs.existsSync(plan.articleDir), false);
});

test('HTML 帧：同名复制，相对引用的文件照原路径一起复制；越出页目录的拦下', async (t) => {
  const dir = tmpDir(t, 'html');
  const page = path.join(dir, 'hp');
  write(path.join(page, 'board.json'), JSON.stringify({ tabs: [
    { id: 'v', title: '版本', sections: [{ id: 'ces', title: 'CES', layout: 'column', shell: 'doc', screens: [{ id: 'v1', title: '一' }, { id: 'v2' }] }] },
    { id: 'c', title: '组件', sections: [{ id: 'comps', title: '组件', layout: 'column', shell: 'doc', screens: [{ id: 'cat' }] }] },
  ] }));
  write(path.join(page, 'v1.html'), '<!doctype html><p>v1</p>\n<a href="data.xlsx">表</a>\n');
  write(path.join(page, 'v2.html'), '<!doctype html><p>v2</p>\n');
  write(path.join(page, 'cat.html'), '<!doctype html><link rel="stylesheet" href="mirror/c.css"><iframe src="mirror/f/inner.html"></iframe>\n');
  write(path.join(page, 'mirror', 'c.css'), 'body { background: url(img/bg.png); }\n');
  write(path.join(page, 'mirror', 'img', 'bg.png'), 'png');
  write(path.join(page, 'mirror', 'f', 'inner.html'), '<!doctype html><script src="../run.js"></script>\n');
  write(path.join(page, 'mirror', 'run.js'), 'console.log(1);\n');
  write(path.join(page, 'unused.css'), 'x\n');
  const registry = { entries: [{ id: 'hp', kind: 'dir', board: 'html', path: page }] };
  const root = projectRoot(dir);
  const plan = await planPageMigration({ pageId: 'hp', projectRoot: root, articleId: 'pages', registry });
  assert.deepEqual(plan.problems, []);
  assert.deepEqual([...plan.files.keys()].sort(), ['cat.html', 'index.mdx', 'mirror/c.css', 'mirror/f/inner.html', 'mirror/img/bg.png', 'mirror/run.js', 'v1.html', 'v2.html']);
  assert.match(plan.warnings.join('\n'), /帧 v1 引用的 "data\.xlsx" 不在盘上（v1\.html 第 2 行）/);
  // 全是 HTML 帧的 doc 节不写 shell（HTML 帧缺省就是 doc）。
  const mdx = plan.files.get('index.mdx').content;
  assert.match(mdx, /<Canvas frames=\{\["v1", "v2"\]\} \/>/);
  assert.match(mdx, /<Canvas frames=\{\["cat"\]\} \/>/);
  writeMigration(plan);
  assert.equal(fs.readFileSync(path.join(plan.articleDir, 'cat.html'), 'utf8'), fs.readFileSync(path.join(page, 'cat.html'), 'utf8'));
  const report = await verifyMigration(plan);
  assert.ok(report.ok, JSON.stringify(report));
  assert.deepEqual(report.rows.map((row) => [row.ref, row.frame, row.shell, row.diff]), [['A1', 'v1', 'doc', 'same'], ['A2', 'v2', 'doc', 'same'], ['B1', 'cat', 'doc', 'same']]);

  // 页目录外的引用：拦下，逐条列出文件和行。
  write(path.join(page, 'v2.html'), '<!doctype html>\n<link rel="stylesheet" href="../shared.css">\n');
  const blocked = await planPageMigration({ pageId: 'hp', projectRoot: root, articleId: 'pages-2', registry });
  assert.equal(blocked.problems.length, 1);
  assert.match(blocked.problems[0], /帧 v2 引用了页目录外的文件 "\.\.\/shared\.css"（v2\.html 第 2 行/);

  // 手机壳里的 HTML 片段帧：<Canvas> 写明 shell="app"（HTML 帧缺省是 doc）。
  const ios = path.join(dir, 'ios');
  write(path.join(ios, 'board.json'), JSON.stringify({ sections: [{ id: 's', title: 'S', layout: 'row', screens: [{ id: 'frag' }] }] }));
  write(path.join(ios, 'frag.html'), '<div class="ios-app">x</div>\n');
  const iosPlan = await planPageMigration({ pageId: 'ios', projectRoot: root, registry: { entries: [{ id: 'ios', kind: 'dir', board: 'ios', path: ios }] } });
  assert.deepEqual(iosPlan.problems, []);
  assert.match(iosPlan.files.get('index.mdx').content, /<Canvas frames=\{\["frag"\]\} shell="app" \/>/);
});

test('compFrameSource: default-export component, name clash, odd props', () => {
  const src = compFrameSource({ id: 'plan-schema', comp: 'PlanSchema', props: { 'a b': 1, text: 'x "y"' }, importPath: './components/PlanSchema.jsx', named: false });
  assert.equal(src, [
    "import PlanSchema from './components/PlanSchema.jsx';", '',
    'export default function PlanSchemaFrame() {',
    '  return <PlanSchema text={"x \\"y\\""} {...{"a b":1}} />;',
    '}', '',
  ].join('\n'));
  assert.equal(diffLineCount('a\nb\nc', 'a\nB\nc\nd'), 2);
  // 节标题里有双引号：换单引号，解析回来是原文。
  const mdx = buildArticleMdx({ title: 't', sections: [{ id: 'q', title: '说 "好"', frames: [{ id: 'f' }] }] });
  assert.deepEqual(parseArticleCanvas(mdx).sections.map((s) => s.title), ['说 "好"']);
});

test('CLI: migrate takes --project <root> (add keeps --project as a switch); --dry-run writes nothing', async (t) => {
  assert.deepEqual(parseArgs(['migrate', 'p', '--project', '/r', '--article', 'a', '--dry-run']), { command: 'migrate', target: 'p', flags: { project: '/r', article: 'a', 'dry-run': true } });
  assert.deepEqual(parseArgs(['add', '/r', '--project']).flags, { project: true });
  assert.throws(() => parseArgs(['migrate', 'p', '--project']), /缺少值/);

  const dir = tmpDir(t, 'cli');
  const page = legacyPage(dir);
  const root = projectRoot(dir);
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: registryWith(page).entries }));
  const lines = [];
  const io = { out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`), env: { ...process.env, PINPOINT_REGISTRY: registry, PINPOINT_DATA_DIR: path.join(dir, 'data') } };
  assert.equal(await run(['migrate', 'legacy-page', '--project', root, '--dry-run'], io), 0);
  assert.equal(fs.existsSync(path.join(root, 'docs', 'pinpoint', 'articles')), false);
  assert.ok(lines.some((l) => /--dry-run，没写/.test(l)));
  assert.ok(lines.some((l) => /旧页的标注留在旧页/.test(l)));

  lines.length = 0;
  assert.equal(await run(['migrate', 'legacy-page', '--project', root, '--article', 'moved'], io), 0, lines.join('\n'));
  assert.ok(lines.some((l) => /^A2\s+lock-note\s+复制\s+lock\s+ok\s+只差地址$/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /旧页的标注留在旧页（桶 legacy-page）/.test(l)));
  assert.ok(lines.some((l) => /登记 project（登记了才能在服务里打开文章页和画布视图）：ppnt add .* --project/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^ {2}\d\. 补正文：.*index\.mdx 里每节的/.test(l)), '结尾给下一步');
  assert.ok(lines.some((l) => /^通过：4 帧/.test(l)));
  assert.equal(fs.existsSync(path.join(dir, 'data')), false, '迁移不写数据目录');

  // 编不过的帧：文件照写，退 1。
  lines.length = 0;
  write(path.join(page, '..', 'legacy2', 'board.json'), JSON.stringify({ sections: [{ id: 's', title: 'S', layout: 'row', screens: [{ id: 'bad' }] }] }));
  write(path.join(page, '..', 'legacy2', 'bad.jsx'), 'export default function Bad() { return <div onClick={() => 1} />; }\n');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [...registryWith(page).entries, { id: 'legacy2', kind: 'dir', board: 'ios', path: path.join(page, '..', 'legacy2') }] }));
  assert.equal(await run(['migrate', 'legacy2', '--project', root], io), 1);
  assert.ok(lines.some((l) => /^错误 bad：/.test(l)), lines.join('\n'));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'pinpoint', 'articles', 'legacy2', 'index.mdx')));
});

test('CLI: migrate refuses when the new canvas page id already has a bucket with rows (stale orphan)', async (t) => {
  const dir = tmpDir(t, 'stale');
  const page = legacyPage(dir);
  const root = projectRoot(dir);
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: registryWith(page).entries }));
  const data = path.join(dir, 'data');
  write(path.join(data, 'demo_legacy-page', '@canvas.json'), JSON.stringify({ annotations: [{ id: 'a1', n: 1, content: '旧的' }] }));
  const lines = [];
  const io = { out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`), env: { ...process.env, PINPOINT_REGISTRY: registry, PINPOINT_DATA_DIR: data } };
  assert.equal(await run(['migrate', 'legacy-page', '--project', root], io), 1);
  assert.ok(lines.some((l) => /^ERR 错误：标注桶 .*demo_legacy-page 里已有 1 行标注/.test(l)), lines.join('\n'));
  assert.equal(fs.existsSync(path.join(root, 'docs', 'pinpoint', 'articles')), false);
  lines.length = 0;
  assert.equal(await run(['migrate', 'legacy-page', '--project', root, '--article', 'fresh', '--dry-run'], io), 0, lines.join('\n'));
});

test('越界拦下：assets.js / assets.css 的 ..、symlink 指到页目录外的帧和 HTML 资源，整单不写（xreview B）', async (t) => {
  const dir = tmpDir(t, 'escape');
  const root = projectRoot(dir);
  const page = path.join(dir, 'legacy');
  const outsideJs = path.join(dir, 'outside.js');
  write(outsideJs, 'console.log("outside");\n');
  write(path.join(page, 'board.json'), JSON.stringify({
    assets: { js: ['../outside.js'] },
    sections: [{ id: 's', title: 'S', layout: 'row', screens: [{ id: 'home' }] }],
  }));
  write(path.join(page, 'home.jsx'), 'export default function Home() { return <div class="ios-app">x</div>; }\n');
  // 新文章目录的兄弟文件：越界写会覆盖它。
  const sibling = path.join(root, 'docs', 'pinpoint', 'articles', 'outside.js');
  write(sibling, 'SIBLING\n');
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [{ id: 'legacy-page', kind: 'dir', board: 'ios', path: page }] }));
  const lines = [];
  const io = { out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`), env: { ...process.env, PINPOINT_REGISTRY: registry, PINPOINT_DATA_DIR: path.join(dir, 'data') } };
  assert.equal(await run(['migrate', 'legacy-page', '--project', root, '--article', 'unsafe-cli'], io), 1, lines.join('\n'));
  assert.equal(fs.readFileSync(sibling, 'utf8'), 'SIBLING\n', '文章目录外的已有文件不被覆盖');
  assert.equal(fs.existsSync(path.join(root, 'docs', 'pinpoint', 'articles', 'unsafe-cli')), false, '整单不写');
  assert.ok(lines.some((l) => /board\.assets\.js 里的 \.\.\/outside\.js 在页目录外/.test(l)), lines.join('\n'));

  const reg = { entries: [{ id: 'legacy-page', kind: 'dir', board: 'ios', path: page }] };
  // assets.css 同一套：读页目录外的 css 也拦。
  write(path.join(dir, 'outside.css'), '.x { color: red; }\n');
  write(path.join(page, 'board.json'), JSON.stringify({
    assets: { css: ['../outside.css'] },
    sections: [{ id: 's', title: 'S', layout: 'row', screens: [{ id: 'home' }] }],
  }));
  const cssPlan = await planPageMigration({ pageId: 'legacy-page', projectRoot: root, articleId: 'css-out', registry: reg });
  assert.match(cssPlan.problems.join('\n'), /board\.assets\.css 里的 \.\.\/outside\.css 在页目录外/);
  assert.equal(cssPlan.files.has('article.css'), false);

  // 帧文件本身是 symlink，真实落点在页目录外：文本路径在页内，realpath 不在。
  write(path.join(page, 'board.json'), JSON.stringify({ sections: [{ id: 's', title: 'S', layout: 'row', screens: [{ id: 'home' }, { id: 'link' }] }] }));
  write(path.join(dir, 'secret.jsx'), 'export default function Secret() { return <b>secret</b>; }\n');
  fs.symlinkSync(path.join(dir, 'secret.jsx'), path.join(page, 'link.jsx'));
  const linkPlan = await planPageMigration({ pageId: 'legacy-page', projectRoot: root, articleId: 'link-out', registry: reg });
  assert.match(linkPlan.problems.join('\n'), /link\.jsx 的真实位置在页目录外/);
  assert.throws(() => writeMigration(linkPlan), /不写/);
  fs.rmSync(path.join(page, 'link.jsx'));

  // HTML 帧的资源目录是指到页目录外的 symlink：collectHtmlFrameAssets 的文本检查看不出来，realpath 拦下。
  write(path.join(page, 'board.json'), JSON.stringify({ sections: [{ id: 's', title: 'S', layout: 'row', screens: [{ id: 'doc' }] }] }));
  write(path.join(page, 'doc.html'), '<!doctype html><link rel="stylesheet" href="mirror/c.css">\n');
  write(path.join(dir, 'elsewhere', 'c.css'), 'body {}\n');
  fs.symlinkSync(path.join(dir, 'elsewhere'), path.join(page, 'mirror'));
  const htmlPlan = await planPageMigration({ pageId: 'legacy-page', projectRoot: root, articleId: 'html-out', registry: reg });
  assert.match(htmlPlan.problems.join('\n'), /mirror\/c\.css 的真实位置在页目录外/);
});

test('writeMigration：写之前先核对全部目标都在文章目录内，越界一个都不写；已有文件不覆盖（xreview B）', async (t) => {
  const dir = tmpDir(t, 'write-guard');
  const articleDir = path.join(dir, 'articles', 'a');
  const src = path.join(dir, 'src.txt');
  write(src, 'SRC\n');
  const victim = path.join(dir, 'articles', 'victim.txt');
  write(victim, 'VICTIM\n');
  const plan = {
    articleDir,
    problems: [],
    files: new Map([
      ['index.mdx', { kind: '正文', content: '---\n---\n' }],
      ['../victim.txt', { kind: '资源', from: src }],
    ]),
  };
  assert.throws(() => writeMigration(plan), (error) => error instanceof MigrateError && /越出文章目录/.test(error.message));
  assert.equal(fs.readFileSync(victim, 'utf8'), 'VICTIM\n');
  assert.equal(fs.existsSync(articleDir), false, '核对在建目录之前');

  // 两个键落到同一个文件：按键排序先写 ./a.txt，后一份不覆盖它，报 EEXIST。
  const twice = {
    articleDir,
    problems: [],
    files: new Map([
      ['a.txt', { kind: '资源', from: src }],
      ['./a.txt', { kind: '资源', content: 'FIRST\n' }],
    ]),
  };
  assert.throws(() => writeMigration(twice), (error) => error.code === 'EEXIST');
  assert.equal(fs.readFileSync(path.join(articleDir, 'a.txt'), 'utf8'), 'FIRST\n');
});

test('节的最终 Canvas shell 和任一帧的原壳冲突就在写入前拦下；JSX 帧按最终 shell 补帧级 shell（xreview I）', async (t) => {
  const dir = tmpDir(t, 'shells');
  const root = projectRoot(dir);
  const page = path.join(dir, 'mixed');
  const registry = { entries: [{ id: 'mixed', kind: 'dir', board: 'ios', path: page }] };
  write(path.join(page, 'doc.html'), '<!doctype html><p>doc</p>\n');
  write(path.join(page, 'phone.html'), '<div class="ios-app">phone</div>\n');

  // 同一节里 doc 的 HTML 帧和 app 的 HTML 帧：两种顺序都拦，一个文件都不写。
  for (const [i, screens] of [[{ id: 'doc', shell: 'doc' }, { id: 'phone', shell: 'app' }], [{ id: 'phone', shell: 'app' }, { id: 'doc', shell: 'doc' }]].entries()) {
    write(path.join(page, 'board.json'), JSON.stringify({ sections: [{ id: 's', title: 'S', layout: 'row', screens }] }));
    const plan = await planPageMigration({ pageId: 'mixed', projectRoot: root, articleId: `mixed-${i}`, registry });
    assert.match(plan.problems.join('\n'), /section s 里的 HTML 帧 doc 在旧页是 doc，迁过去会按 app 显示/, `顺序 ${i}`);
    assert.throws(() => writeMigration(plan), /不写/);
    assert.equal(fs.existsSync(plan.articleDir), false);
  }

  // 节是 lock、HTML 帧单屏写 doc：Canvas 只能写一个 shell，同样拦下。
  write(path.join(page, 'board.json'), JSON.stringify({ sections: [{ id: 'l', title: 'L', layout: 'row', shell: 'lock', screens: [{ id: 'doc', shell: 'doc' }] }] }));
  const lockPlan = await planPageMigration({ pageId: 'mixed', projectRoot: root, articleId: 'lock-doc', registry });
  assert.match(lockPlan.problems.join('\n'), /HTML 帧 doc 在旧页是 doc，迁过去会按 lock 显示/);

  // JSX 帧排在决定节 shell 的 HTML 帧前面：按整节最终 shell 补帧级 shell，校验每帧 shell 与旧页一致。
  write(path.join(page, 'board.json'), JSON.stringify({ sections: [{ id: 'm', title: 'M', layout: 'row', screens: [{ id: 'first' }, { id: 'phone', shell: 'lock' }] }] }));
  write(path.join(page, 'first.jsx'), 'export default function First() { return <div class="ios-app">first</div>; }\n');
  const plan = await planPageMigration({ pageId: 'mixed', projectRoot: root, articleId: 'order', registry });
  assert.deepEqual(plan.problems, []);
  assert.match(plan.files.get('index.mdx').content, /<Canvas frames=\{\["first", "phone"\]\} shell="lock" \/>/);
  writeMigration(plan);
  const report = await verifyMigration(plan);
  assert.deepEqual(report.rows.map((row) => [row.frame, row.shell, row.legacyShell]), [['first', 'app', 'app'], ['phone', 'lock', 'lock']]);
  assert.equal(report.ok, true, JSON.stringify(report));
});
