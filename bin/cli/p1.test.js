/**
 * ppnt P1（docs/registry.md“CLI”）：--json 与退出码、new、open、show --uses、dev --sandbox、
 * 没有 dist 时自己编、mark --note、migrate 的下一步、shot 的图提示。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  envFileText,
  insideOwnerData,
  OWNER_PORTS,
  pickSandboxPorts,
  sandboxEnv,
} from './sandbox.js';
import { articleScaffold, frontmatterValue } from './new.js';
import { migrateNextSteps } from './migrate.js';
import { truncatedWarning } from './annotate.js';
import { REPO_ROOT } from './core.js';
import { run } from '../pinpoint-cli.js';

const FIXTURE_PROJECT = path.join(REPO_ROOT, 'e2e', 'project-site');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppnt-p1-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function recorder() {
  const out = [];
  const err = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
}

const offline = () => Promise.reject(new Error('connect ECONNREFUSED'));

/** 一份 e2e-project 的副本 + 只有它的 registry；数据目录是空的（没有 dist）。 */
function fixture(t, { annotations = true } = {}) {
  const dir = tempDir(t);
  const root = path.join(dir, 'proj');
  fs.cpSync(FIXTURE_PROJECT, root, { recursive: true });
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [{ id: 'e2e-project', kind: 'project', path: root }] }));
  const env = { PINPOINT_DATA_DIR: path.join(dir, 'data'), PINPOINT_REGISTRY: registry, PINPOINT_ORIGIN: 'http://127.0.0.1:1' };
  if (annotations) {
    const bucket = path.join(env.PINPOINT_DATA_DIR, 'e2e-project_commit-confirm');
    fs.mkdirSync(bucket, { recursive: true });
    fs.writeFileSync(path.join(bucket, '@canvas.json'), JSON.stringify({ page: '@canvas', path: '@canvas', revision: 1, annotations: [
      { id: 'c1', n: 1, type: 'element', status: 'open', content: '按钮改大', pageId: 'e2e-project_commit-confirm', screenId: 'confirm-sheet', targets: [] },
    ] }));
  }
  return { dir, root, registry, env };
}

const runIn = (made, argv, extra = {}) => {
  const rec = recorder();
  return run(argv, { ...rec.io, env: made.env, requestFn: offline, ...extra }).then((code) => ({ code, ...rec }));
};

/* ---- --json 与退出码 ---- */

test('--json：每个命令 stdout 都是一个 JSON；没有原生 JSON 的命令包进信封，用法错也是', async (t) => {
  const made = fixture(t);
  const prune = await runIn(made, ['prune', 'e2e-project/commit-confirm', '--dry-run', '--json']);
  assert.equal(prune.code, 0, prune.err.join('\n'));
  const envelope = JSON.parse(prune.out.join('\n'));
  assert.equal(envelope.ok, true);
  assert.equal(envelope.exit, 0);
  assert.equal(envelope.command, 'prune');
  assert.ok(Array.isArray(envelope.output));

  const usage = await runIn(made, ['shot', 'e2e-project/commit-confirm', '--bogus', '--json']);
  assert.equal(usage.code, 2);
  const bad = JSON.parse(usage.out.join('\n'));
  assert.deepEqual([bad.ok, bad.exit, bad.error], [false, 2, '未知选项：--bogus']);

  const missing = await runIn(made, ['show', 'e2e-project/ghost', '--json']);
  assert.equal(missing.code, 2, '找不到目标是用法错');
  assert.match(JSON.parse(missing.out.join('\n')).error, /找不到文章 e2e-project\/ghost/);

  const list = await runIn(made, ['list', 'commit', '--json']);
  assert.equal(list.code, 0);
  const listed = JSON.parse(list.out.join('\n'));
  assert.deepEqual(listed.projects.map((row) => row.articles.map((a) => a.address)), [['e2e-project/commit-confirm', 'e2e-project/takeover']]);

  const build = await runIn(made, ['build', 'e2e-project/commit-confirm', '--json']);
  assert.equal(build.code, 0, build.err.join('\n'));
  const built = JSON.parse(build.out.join('\n'));
  assert.equal(built.target, 'e2e-project/commit-confirm');
  assert.ok(built.frames.some((row) => row.id === 'confirm-sheet' && row.ok));
});

test('locate：帧上没有标注退 0、如实说一句；不在的 #n 退 1；--json 给源文件和行', async (t) => {
  const made = fixture(t);
  const none = await runIn(made, ['locate', 'e2e-project/commit-confirm', 'B2']);
  assert.equal(none.code, 0, none.err.join('\n'));
  assert.deepEqual(none.out, ['B2：该帧暂无标注']);
  const section = await runIn(made, ['locate', 'e2e-project/commit-confirm', '§3']);
  assert.equal(section.code, 0);
  assert.deepEqual(section.out, ['§3：该节暂无标注'.replace('§3', 'C')]);

  const ghost = await runIn(made, ['locate', 'e2e-project/commit-confirm', '#99']);
  assert.equal(ghost.code, 1);

  const json = await runIn(made, ['locate', 'e2e-project/commit-confirm', 'B1', '--json']);
  assert.equal(json.code, 0, json.err.join('\n'));
  const report = JSON.parse(json.out.join('\n'));
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].n, 1);
  assert.equal(report.rows[0].frame, 'confirm-sheet');
  assert.ok(Array.isArray(report.empty));
});

/* ---- 没有 dist 时自己编 ---- */

test('comments 和 locate 不要求先 build：dist 不在时先编，摘录照出', async (t) => {
  const made = fixture(t);
  const dist = path.join(made.env.PINPOINT_DATA_DIR, 'dist', 'e2e-project_commit-confirm');
  assert.equal(fs.existsSync(dist), false);
  const comments = await runIn(made, ['comments', 'e2e-project/commit-confirm']);
  assert.equal(comments.code, 0, comments.err.join('\n'));
  assert.ok(comments.err.some((line) => line.startsWith('dist 不在或落后于源码，先编了 e2e-project/commit-confirm')), comments.err.join('\n'));
  assert.ok(fs.existsSync(path.join(dist, 'confirm-sheet.html')));
  assert.doesNotMatch(comments.out.join('\n'), /先跑 ppnt build/);
  // 第二次 dist 已是最新：不再编，也不打那一行。
  const again = await runIn(made, ['comments', 'e2e-project/commit-confirm']);
  assert.deepEqual(again.err, []);
});

/* ---- new ---- */

test('new project：写 project.json 和空目录、登记；重跑不覆盖，只说已经在', async (t) => {
  const made = fixture(t, { annotations: false });
  const root = path.join(made.dir, 'Browser Use');
  const first = await runIn(made, ['new', 'project', root, '--title', 'Browser Use']);
  assert.equal(first.code, 0, first.err.join('\n'));
  const json = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'pinpoint', 'project.json'), 'utf8'));
  assert.deepEqual(json, { id: 'browser-use', title: 'Browser Use' });
  assert.ok(fs.statSync(path.join(root, 'docs', 'pinpoint', 'articles')).isDirectory());
  assert.ok(fs.statSync(path.join(root, 'docs', 'pinpoint', 'concepts')).isDirectory());
  const registry = JSON.parse(fs.readFileSync(made.registry, 'utf8'));
  assert.ok(registry.entries.some((entry) => entry.id === 'browser-use' && entry.kind === 'project' && entry.path === root));
  assert.ok(first.out.includes('首页：http://127.0.0.1:1/browser-use/'), first.out.join('\n'));
  assert.ok(first.out.some((line) => line.includes('ppnt new article browser-use/<article>')));

  fs.writeFileSync(path.join(root, 'docs', 'pinpoint', 'project.json'), JSON.stringify({ id: 'browser-use', title: '手改过的标题' }));
  const again = await runIn(made, ['new', 'project', root, '--json']);
  assert.equal(again.code, 0, again.err.join('\n'));
  const report = JSON.parse(again.out.join('\n'));
  assert.equal(report.registered, 'already');
  assert.deepEqual(report.files, []);
  assert.equal(report.skipped.length, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'docs', 'pinpoint', 'project.json'), 'utf8')).title, '手改过的标题', '不覆盖');

  const clash = await runIn(made, ['new', 'project', root, '--id', 'other']);
  assert.equal(clash.code, 2);
  assert.match(clash.err[0], /已经在，id 是 "browser-use"/);
  const reserved = await runIn(made, ['new', 'project', path.join(made.dir, 'api')]);
  assert.equal(reserved.code, 2);
  assert.match(reserved.err[0], /保留名/);
});

test('new article：写一节的 index.mdx、打印网址；check 直接通过；已经在就拒绝；project 没登记退 2', async (t) => {
  const made = fixture(t, { annotations: false });
  const res = await runIn(made, ['new', 'article', 'e2e-project/payment-confirm', '--title', '付款: 确认']);
  assert.equal(res.code, 0, res.err.join('\n'));
  const file = path.join(made.root, 'docs', 'pinpoint', 'articles', 'payment-confirm', 'index.mdx');
  assert.equal(fs.readFileSync(file, 'utf8'), articleScaffold({ title: '付款: 确认' }));
  assert.ok(res.out.includes('文章页：http://127.0.0.1:1/e2e-project/payment-confirm/'), res.out.join('\n'));
  assert.ok(res.out.some((line) => line.includes('ppnt check e2e-project/payment-confirm')));

  const check = await runIn(made, ['check', 'e2e-project/payment-confirm', '--json']);
  assert.equal(check.code, 0, check.out.join('\n'));
  const show = await runIn(made, ['show', 'e2e-project/payment-confirm', '--json']);
  const model = JSON.parse(show.out.join('\n'));
  assert.equal(model.title, '付款: 确认', 'frontmatter 值带冒号也读得回来');
  assert.deepEqual(model.sections.map((row) => [row.n, row.letter, row.id]), [[1, 'A', 'overview']]);

  const twice = await runIn(made, ['new', 'article', 'e2e-project/payment-confirm']);
  assert.equal(twice.code, 1);
  assert.match(twice.err[0], /已经在，不覆盖/);
  assert.equal(fs.readFileSync(file, 'utf8'), articleScaffold({ title: '付款: 确认' }));

  const orphan = await runIn(made, ['new', 'article', 'nobody/notes']);
  assert.equal(orphan.code, 2);
  assert.match(orphan.err[0], /project nobody 没登记：先 ppnt new project/);
  const reserved = await runIn(made, ['new', 'article', 'e2e-project/concepts']);
  assert.equal(reserved.code, 2);
  const shape = await runIn(made, ['new', 'page', 'x']);
  assert.equal(shape.code, 2);
});

test('new article：同名页 id 的桶里已有旧标注（删掉的文章留下的孤儿）就拒绝，指路换 id 或 prune；空桶照常建（xreview H）', async (t) => {
  const made = fixture(t, { annotations: false });
  const bucket = path.join(made.env.PINPOINT_DATA_DIR, 'e2e-project_reused');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, '@prose.json'), JSON.stringify({ page: '@prose', path: '/e2e-project/reused/', revision: 1, annotations: [
    { id: 'p1', n: 1, type: 'prose', status: 'open', content: '旧文章的评论', quote: { exact: '旧' } },
  ] }));
  const file = path.join(made.root, 'docs', 'pinpoint', 'articles', 'reused', 'index.mdx');
  const refused = await runIn(made, ['new', 'article', 'e2e-project/reused']);
  assert.equal(refused.code, 1);
  assert.match(refused.err.join('\n'), /标注桶 .*e2e-project_reused 里已有 1 行标注/);
  assert.match(refused.err.join('\n'), /ppnt prune e2e-project_reused/);
  assert.equal(fs.existsSync(file), false, '没写 index.mdx');

  // 桶里只剩空账本（处理完、清空了）：不拦。
  fs.writeFileSync(path.join(bucket, '@prose.json'), JSON.stringify({ page: '@prose', revision: 2, annotations: [] }));
  const created = await runIn(made, ['new', 'article', 'e2e-project/reused']);
  assert.equal(created.code, 0, created.err.join('\n'));
  assert.ok(fs.existsSync(file));
});

test('frontmatterValue：子集认不出的写法加引号', () => {
  assert.equal(frontmatterValue('付款确认'), '付款确认');
  assert.equal(frontmatterValue('a: b'), "'a: b'");
  assert.equal(frontmatterValue("it's #1 a: b"), '"it\'s #1 a: b"');
  assert.equal(frontmatterValue('[draft]'), "'[draft]'");
});

/* ---- open ---- */

test('open --print：文章页与画布视图、一节、project 全貌、概念页', async (t) => {
  const made = fixture(t, { annotations: false });
  const article = await runIn(made, ['open', 'e2e-project/commit-confirm', '--print']);
  assert.equal(article.code, 0, article.err.join('\n'));
  assert.deepEqual(article.out, [
    'e2e-project/commit-confirm 文章页  http://127.0.0.1:1/e2e-project/commit-confirm/',
    'e2e-project/commit-confirm 画布视图  http://127.0.0.1:1/?page=e2e-project_commit-confirm',
  ]);
  const section = await runIn(made, ['open', 'e2e-project/commit-confirm', '§2', '--json']);
  assert.deepEqual(JSON.parse(section.out.join('\n')).urls.map((row) => row.url), [
    'http://127.0.0.1:1/e2e-project/commit-confirm/#confirm',
    'http://127.0.0.1:1/?page=e2e-project_commit-confirm&section=confirm',
  ]);
  const prose = await runIn(made, ['open', 'e2e-project/commit-confirm', 'why', '--print']);
  assert.deepEqual(prose.out, ['A（§1 why）文章页  http://127.0.0.1:1/e2e-project/commit-confirm/#why'], '纯文字的节只有锚点');
  const project = await runIn(made, ['open', 'e2e-project', '--print']);
  assert.ok(project.out.includes('e2e-project 首页  http://127.0.0.1:1/e2e-project/'));
  assert.ok(project.out.includes('llms.txt  http://127.0.0.1:1/e2e-project/llms.txt'));
  assert.ok(project.out.some((line) => line.endsWith('/e2e-project/concepts/confirm-card/')));
  const concept = await runIn(made, ['open', 'e2e-project', 'confirm-card', '--print']);
  assert.deepEqual(concept.out, ['概念 confirm-card  http://127.0.0.1:1/e2e-project/concepts/confirm-card/']);
  const noSuch = await runIn(made, ['open', 'e2e-project/commit-confirm', 'nope', '--print']);
  assert.equal(noSuch.code, 1);

  const opened = [];
  const browser = await runIn(made, ['open', 'e2e-project/commit-confirm'], { openUrl: async (url) => opened.push(url) });
  assert.equal(browser.code, 0);
  assert.deepEqual(opened, ['http://127.0.0.1:1/e2e-project/commit-confirm/']);
});

/* ---- show --uses ---- */

test('show --uses：列出用到组件的帧和图（先编到最新），给一条截图命令；没用到退 1', async (t) => {
  const made = fixture(t, { annotations: false });
  const res = await runIn(made, ['show', 'e2e-project', '--uses', 'ConfirmCard', '--json']);
  assert.equal(res.code, 0, res.err.join('\n'));
  const model = JSON.parse(res.out.join('\n'));
  assert.equal(model.component, 'ConfirmCard');
  assert.deepEqual(model.frames.map((row) => [row.ref, row.id]).sort(), [['B1', 'confirm-sheet'], ['C1', 'card-plain'], ['D1', 'mixed-phone'], ['D2', 'mixed-bare']].sort());
  assert.ok(model.definedIn.some((file) => file.endsWith(path.join('commit-confirm', 'components', 'ConfirmCard.jsx'))));

  const text = await runIn(made, ['show', 'e2e-project/commit-confirm', '--uses', 'components/Banner.jsx']);
  assert.equal(text.code, 0, text.err.join('\n'));
  assert.ok(text.out.some((line) => /e2e-project\/commit-confirm\s+B2\s+confirm-done/.test(line)), text.out.join('\n'));
  assert.ok(text.out.includes('  ppnt shot e2e-project/commit-confirm B2'), text.out.join('\n'));

  const none = await runIn(made, ['show', 'e2e-project', '--uses', 'NoSuchThing']);
  assert.equal(none.code, 1);
});

/* ---- shot：图 id 写成引用 ---- */

test('shot：把图 id 写成引用时指向 --figure（不把位置参数猜成图）', async (t) => {
  const made = fixture(t, { annotations: false });
  const res = await runIn(made, ['shot', 'e2e-project/commit-confirm', 'wait-sequence']);
  assert.equal(res.code, 1);
  assert.ok(res.err.includes('wait-sequence 是正文里的图，不在画布上：ppnt shot e2e-project/commit-confirm --figure wait-sequence'), res.err.join('\n'));
  assert.match(truncatedWarning('p/a'), /ppnt check p\/a/);
});

/* ---- mark --note 与 reply ---- */

function fakeService(made) {
  const calls = [];
  const requestFn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    if (url.endsWith('/health')) return { status: 200, json: { ok: true } };
    if (opts.method === 'POST' && url.includes('/reply') && opts.body.text === '撞车') return { status: 409, json: { error: 'revision_conflict' } };
    if (opts.method === 'POST') return { status: 200, json: { revision: 3, annotation: { status: opts.body.status || 'open' } } };
    return { status: 200, json: { revision: 2 } };
  };
  return { calls, requestFn };
}

test('mark --note：先在线程里回一句，再写状态；回复失败就不写状态', async (t) => {
  const made = fixture(t);
  const service = fakeService(made);
  const res = await runIn(made, ['mark', 'e2e-project/commit-confirm', '#1', 'done', '--note', '按钮加大到 44pt'], { requestFn: service.requestFn });
  assert.equal(res.code, 0, res.err.join('\n'));
  const posts = service.calls.filter((call) => call.method === 'POST');
  assert.deepEqual(posts.map((call) => call.url.replace('http://127.0.0.1:1', '')), ['/annotations/%40canvas/1/reply', '/annotations/%40canvas/1/status']);
  assert.deepEqual(posts[0].body, { entry: 'e2e-project_commit-confirm', baseRevision: 2, text: '按钮加大到 44pt' });
  assert.equal(posts[1].body.status, 'done');
  assert.deepEqual(res.out, ['#1 → done，线程里回了：按钮加大到 44pt']);

  const conflict = fakeService(made);
  const failed = await runIn(made, ['mark', 'e2e-project/commit-confirm', '#1', 'check', '--note', '撞车'], { requestFn: conflict.requestFn });
  assert.equal(failed.code, 1);
  assert.equal(conflict.calls.filter((call) => call.method === 'POST' && call.url.endsWith('/status')).length, 0);
  assert.match(failed.out[0], /回复没写进去.*状态没改/);

  const blank = await runIn(made, ['mark', 'e2e-project/commit-confirm', '#1', 'done', '--note', '  ']);
  assert.equal(blank.code, 2);
});

test('reply：画布标注也有线程', async (t) => {
  const made = fixture(t);
  const service = fakeService(made);
  const res = await runIn(made, ['reply', 'e2e-project/commit-confirm', '#1', '改好了', '--json'], { requestFn: service.requestFn });
  assert.equal(res.code, 0, res.err.join('\n'));
  assert.deepEqual(JSON.parse(res.out.join('\n')), { target: 'e2e-project/commit-confirm', n: 1, ok: true, status: 'open', text: '改好了' });
});

/* ---- migrate 的下一步 ---- */

test('migrateNextSteps：登记、验证、对比、补正文、旧页标注、撤旧页；dry-run 只说去掉 --dry-run', () => {
  const plan = { project: { id: 'p', root: '/r' }, articleId: 'a', articleDir: '/r/docs/pinpoint/articles/a', pageId: 'old', legacy: { kind: 'registry' } };
  assert.deepEqual(migrateNextSteps({ plan, dryRun: true }), ['下一步：计划没问题就去掉 --dry-run 再跑一次，文件才会写。']);
  const steps = migrateNextSteps({ plan, registered: false, legacyOpen: 2, ok: true });
  assert.equal(steps[0], '下一步：');
  assert.match(steps[1], /1\. 登记 project.*ppnt add \/r --project/);
  assert.ok(steps.some((line) => line.includes('ppnt check p/a')));
  assert.ok(steps.some((line) => line.includes('ppnt shot p/a --canvas，再 ppnt shot old')));
  assert.ok(steps.some((line) => line.includes('还有 2 条没关的标注')));
  assert.ok(steps.some((line) => line.includes('ppnt remove old')));
  assert.ok(!migrateNextSteps({ plan, registered: true }).some((line) => line.includes('ppnt add')));
});

/* ---- dev --sandbox ---- */

test('pickSandboxPorts：owner 的端口一律不接受；自动找一对空端口', async () => {
  for (const port of OWNER_PORTS) {
    assert.match((await pickSandboxPorts({ port, isFree: async () => true })).error, /owner/);
    assert.match((await pickSandboxPorts({ port: 6850, sitePort: port, isFree: async () => true })).error, /owner/);
  }
  assert.deepEqual(await pickSandboxPorts({ port: 6850, isFree: async () => true }), { port: 6850, sitePort: 6855 });
  assert.match((await pickSandboxPorts({ port: 6850, isFree: async (p) => p !== 6855 })).error, /站点端口 6855 已经被占了/);
  const taken = new Set([6400, 6401, 6407]);
  assert.deepEqual(await pickSandboxPorts({ isFree: async (p) => !taken.has(p) }), { port: 6403, sitePort: 6408 });
  assert.match((await pickSandboxPorts({ port: 'abc' })).error, /端口号/);
});

test('dev --sandbox：不接受 ~/.pinpoint；env.sh 只有 CLI 的三个变量', async (t) => {
  assert.equal(insideOwnerData('/home/u/.pinpoint', '/home/u'), true);
  assert.equal(insideOwnerData('/home/u/.pinpoint/x', '/home/u'), true);
  assert.equal(insideOwnerData('/home/u/.pinpoint-sandbox', '/home/u'), false);
  const vars = sandboxEnv({ dataDir: "/tmp/it's", port: 6850, sitePort: 6855 });
  assert.deepEqual(vars, { PINPOINT_DATA_DIR: "/tmp/it's", PINPOINT_REGISTRY: "/tmp/it's/registry.json", PINPOINT_ORIGIN: 'http://127.0.0.1:6850', PORT: '6850', PINPOINT_SITE_PORT: '6855' });
  assert.equal(envFileText(vars), "export PINPOINT_DATA_DIR='/tmp/it'\\''s'\nexport PINPOINT_REGISTRY='/tmp/it'\\''s/registry.json'\nexport PINPOINT_ORIGIN='http://127.0.0.1:6850'\n");

  const home = tempDir(t);
  const refused = recorder();
  assert.equal(await run(['dev', '--sandbox', path.join(home, '.pinpoint')], { ...refused.io, env: {}, home }), 2);
  assert.equal((await run(['dev'], recorder().io)), 2, 'dev 只有 --sandbox');
});

test('dev --sandbox：起 npm run dev:app（带隔离变量）、等就绪、打印 source 那一行；收到信号停进程组', async (t) => {
  const dataDir = path.join(tempDir(t), 'box');
  const child = Object.assign(new EventEmitter(), { pid: 4242, exitCode: null });
  let spawned = null;
  let signalHandler = null;
  const killed = [];
  const rec = recorder();
  const running = run(['dev', '--sandbox', dataDir, '--port', '6850'], {
    ...rec.io,
    env: { PATH: process.env.PATH, PINPOINT_ORIGIN: 'https://pinpoint.localhost' },
    portFree: async () => true,
    spawnSandbox: (opts) => { spawned = opts; return child; },
    requestFn: async (url) => ({ status: url === 'http://127.0.0.1:6850/health' ? 200 : 500, json: null }),
    onSignal: (handler) => { signalHandler = handler; },
    killGroup: (pid, signal) => { killed.push([pid, signal]); setImmediate(() => child.emit('exit', null, signal)); },
    sleep: async () => {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  for (let i = 0; i < 20 && !rec.out.length; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(spawned.cwd, REPO_ROOT);
  assert.equal(spawned.env.PINPOINT_DATA_DIR, dataDir);
  assert.equal(spawned.env.PORT, '6850');
  assert.equal(spawned.env.PINPOINT_SITE_PORT, '6855');
  assert.equal(spawned.env.PINPOINT_ORIGIN, undefined);
  assert.ok(rec.out.includes(`  source ${path.join(dataDir, 'env.sh')}`), rec.out.join('\n'));
  assert.match(fs.readFileSync(path.join(dataDir, 'env.sh'), 'utf8'), /PINPOINT_ORIGIN='http:\/\/127\.0\.0\.1:6850'/);
  signalHandler();
  assert.equal(await running, 0);
  assert.deepEqual(killed, [[4242, 'SIGTERM']]);
});
