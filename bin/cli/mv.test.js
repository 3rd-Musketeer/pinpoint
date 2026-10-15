/**
 * `ppnt mv <源> <目标>`（ADR 0045）：文章换 project 和 / 或改 id、project 与存量页改 id、换根目录。
 * 改 id 与换根目录的细节在 bin/pinpoint-cli.test.js（原 rename / move 的用例改成 mv 写法）；这里守
 * 文章搬家、按目标写法分派和 --dry-run。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REPO_ROOT } from './core.js';
import { classifyMv } from './mv.js';
import { run } from '../pinpoint-cli.js';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppnt-mv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function recorder() {
  const out = [];
  const err = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
}

const offline = () => Promise.reject(new Error('connect ECONNREFUSED'));

/**
 * 两个 project：e2e-project（e2e/project-site 的副本）和 e2e-html（e2e/html-site 的副本，source kit 指同目录下
 * 复制的 html-source）。commit-confirm 的桶里有一条画布标注和一条正文评论，另有 dist / shot 缓存。
 */
function fixture(t) {
  const dir = tempDir(t);
  const proj = path.join(dir, 'proj');
  const html = path.join(dir, 'html-site');
  fs.cpSync(path.join(REPO_ROOT, 'e2e', 'project-site'), proj, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'e2e', 'html-site'), html, { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'e2e', 'html-source'), path.join(dir, 'html-source'), { recursive: true });
  const registry = path.join(dir, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ version: 1, entries: [
    { id: 'e2e-project', kind: 'project', path: proj },
    { id: 'e2e-html', kind: 'project', path: html },
  ] }));
  const data = path.join(dir, 'data');
  const bucket = path.join(data, 'e2e-project_commit-confirm');
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, '@canvas.json'), JSON.stringify({ page: '@canvas', path: '@canvas', revision: 1, annotations: [
    { id: 'c1', n: 1, type: 'element', status: 'open', content: '按钮改大', pageId: 'e2e-project_commit-confirm', screenId: 'confirm-sheet', targets: [] },
  ] }));
  fs.writeFileSync(path.join(bucket, '@prose.json'), JSON.stringify({ page: '@prose', path: '/e2e-project/commit-confirm/', revision: 1, annotations: [
    { id: 'p1', n: 2, type: 'prose', status: 'open', content: '这句改短', section: 'why', quote: { exact: '提交' } },
  ] }));
  for (const cache of ['dist', 'shot']) {
    fs.mkdirSync(path.join(data, cache, 'e2e-project_commit-confirm'), { recursive: true });
    fs.writeFileSync(path.join(data, cache, 'e2e-project_commit-confirm', 'x'), 'x');
  }
  const env = { PINPOINT_DATA_DIR: data, PINPOINT_REGISTRY: registry, PINPOINT_ORIGIN: 'http://127.0.0.1:1' };
  return { dir, proj, html, registry, data, env };
}

const runIn = (made, argv) => {
  const rec = recorder();
  return run(argv, { ...rec.io, cwd: made.dir, env: made.env, requestFn: offline }).then((code) => ({ code, ...rec }));
};

const articleDir = (root, id) => path.join(root, 'docs', 'pinpoint', 'articles', id);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('classifyMv：按目标写法分派——文章、改 id、磁盘路径；写不通的给原因', () => {
  assert.deepEqual(classifyMv('a/b', 'c/d'), { kind: 'article', from: { project: 'a', article: 'b' }, to: { project: 'c', article: 'd' } });
  assert.deepEqual(classifyMv('a/b', 'c/'), { kind: 'article', from: { project: 'a', article: 'b' }, to: { project: 'c', article: 'b' } }, '目标写 <project>/ 保留文章 id');
  assert.deepEqual(classifyMv('a_b', 'a/c'), { kind: 'article', from: { project: 'a', article: 'b' }, to: { project: 'a', article: 'c' } }, '源也认页 id');
  assert.deepEqual(classifyMv('demo', 'demo-two'), { kind: 'id', id: 'demo', newId: 'demo-two' });
  for (const target of ['/abs/x', './x', '../x', '~/x', '.', 'https://app.localhost/']) {
    assert.deepEqual(classifyMv('demo', target), { kind: 'path', id: 'demo', target }, target);
  }
  assert.match(classifyMv('a/b', './x').error, /文章不能挪到磁盘路径/);
  assert.match(classifyMv('a/b', 'c').error, /<project>\/<article>/);
  assert.match(classifyMv('demo', 'x/y').error, /\.\/x\/y/);
  assert.match(classifyMv('Bad Id', 'x').error, /源/);
});

test('mv 文章改 id（同一个 project）：目录、桶、账本地址、缓存一起搬；别处的 [[旧 id]] 列成注意', async (t) => {
  const made = fixture(t);
  // takeover 里加一句指向 commit-confirm 的引用，搬完应被点名。
  const takeover = path.join(articleDir(made.proj, 'takeover'), 'index.mdx');
  fs.appendFileSync(takeover, '\n回看 [[commit-confirm|提交确认]]。\n');
  const res = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-project/confirm-flow']);
  assert.equal(res.code, 0, res.err.join('\n'));
  assert.ok(!fs.existsSync(articleDir(made.proj, 'commit-confirm')));
  assert.ok(fs.existsSync(path.join(articleDir(made.proj, 'confirm-flow'), 'index.mdx')));
  assert.ok(!fs.existsSync(path.join(made.data, 'e2e-project_commit-confirm')));
  const bucket = path.join(made.data, 'e2e-project_confirm-flow');
  assert.equal(readJson(path.join(bucket, '@canvas.json')).annotations[0].pageId, 'e2e-project_confirm-flow');
  assert.equal(readJson(path.join(bucket, '@prose.json')).path, '/e2e-project/confirm-flow/');
  assert.ok(fs.existsSync(path.join(made.data, 'shot', 'e2e-project_confirm-flow', 'x')), 'shot 跟着搬');
  assert.ok(!fs.existsSync(path.join(made.data, 'dist', 'e2e-project_commit-confirm')), '旧 dist 删掉');
  assert.ok(res.err.some((line) => line.includes(`${takeover}:`) && line.includes('[[commit-confirm|提交确认]]')), res.err.join('\n'));

  // 搬过去的是活页：comments 读得到两条。
  const comments = await runIn(made, ['comments', 'e2e-project/confirm-flow', '--status', 'all', '--json']);
  assert.equal(comments.code, 0, comments.err.join('\n'));
  assert.equal(JSON.parse(comments.out.join('\n')).counts.total, 2);
});

test('mv 文章换 project：目标写 <project>/ 保留 id；文章里写死的 /sites/<旧页 id>/ 换成新页 id', async (t) => {
  const made = fixture(t);
  const card = path.join(articleDir(made.proj, 'commit-confirm'), 'components', 'Hero.jsx');
  fs.writeFileSync(card, 'export function Hero() {\n  return <img src="/sites/e2e-project_commit-confirm/assets/a.png" />;\n}\n');
  const res = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-html/']);
  assert.equal(res.code, 0, res.err.join('\n'));
  const moved = articleDir(made.html, 'commit-confirm');
  assert.ok(fs.existsSync(path.join(moved, 'index.mdx')));
  assert.match(fs.readFileSync(path.join(moved, 'components', 'Hero.jsx'), 'utf8'), /\/sites\/e2e-html_commit-confirm\/assets\/a\.png/);
  assert.equal(readJson(path.join(made.data, 'e2e-html_commit-confirm', '@prose.json')).path, '/e2e-html/commit-confirm/');
  const show = await runIn(made, ['show', 'e2e-html/commit-confirm', '--json']);
  assert.equal(show.code, 0, show.err.join('\n'));
});

test('mv 文章：目标已存在、目标桶有标注、HTML 帧在新 project 里找不到，都整单拒绝，一个字节不动', async (t) => {
  const made = fixture(t);
  const snapshot = () => [fs.readdirSync(path.join(made.proj, 'docs', 'pinpoint', 'articles')).sort(), fs.readdirSync(made.data).sort()];
  const before = snapshot();

  const exists = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-project/takeover']);
  assert.equal(exists.code, 1);
  assert.match(exists.err.join('\n'), /已经在/);

  const busy = path.join(made.data, 'e2e-project_reused');
  fs.mkdirSync(busy, { recursive: true });
  fs.writeFileSync(path.join(busy, '@canvas.json'), JSON.stringify({ annotations: [{ id: 'x', n: 1, status: 'open' }] }));
  const taken = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-project/reused']);
  assert.equal(taken.code, 1);
  assert.match(taken.err.join('\n'), /e2e-project_reused.*1 行标注/);
  fs.rmSync(busy, { recursive: true });

  // e2e-html/pages 有 { id, src } 帧：shared/catalog.html（相对 project 根）和 kit:widget.html（source）。
  // e2e-project 根下没有 shared/，project.json 也没登记 kit。
  const frames = await runIn(made, ['mv', 'e2e-html/pages', 'e2e-project/pages']);
  assert.equal(frames.code, 1);
  const text = frames.err.join('\n');
  assert.match(text, /catalog.*shared\/catalog\.html/);
  assert.match(text, /widget.*kit:widget\.html.*sources/);
  assert.ok(fs.existsSync(path.join(articleDir(made.html, 'pages'), 'index.mdx')));
  assert.deepEqual(snapshot(), before);

  const missing = await runIn(made, ['mv', 'e2e-project/ghost', 'e2e-project/x']);
  assert.equal(missing.code, 2);
  const unregistered = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'nobody/x']);
  assert.equal(unregistered.code, 2);
  const reserved = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-project/wiki']);
  assert.equal(reserved.code, 2);
});

test('mv --dry-run：列计划，什么都不写', async (t) => {
  const made = fixture(t);
  const res = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-html/confirm', '--dry-run']);
  assert.equal(res.code, 0, res.err.join('\n'));
  const text = res.out.join('\n');
  assert.match(text, /计划：e2e-project\/commit-confirm → e2e-html\/confirm/);
  assert.match(text, /标注桶：.*e2e-project_commit-confirm → .*e2e-html_confirm/);
  assert.match(text, /--dry-run/);
  assert.ok(fs.existsSync(articleDir(made.proj, 'commit-confirm')));
  assert.ok(!fs.existsSync(articleDir(made.html, 'confirm')));
  assert.ok(fs.existsSync(path.join(made.data, 'e2e-project_commit-confirm', '@canvas.json')));

  const rename = await runIn(made, ['mv', 'e2e-project', 'e2e-two', '--dry-run']);
  assert.equal(rename.code, 0, rename.err.join('\n'));
  assert.match(rename.out.join('\n'), /计划：e2e-project 改 id 成 e2e-two/);
  assert.equal(readJson(made.registry).entries[0].id, 'e2e-project');
  assert.equal(readJson(path.join(made.proj, 'docs', 'pinpoint', 'project.json')).id, 'e2e-project');
});

test('mv <project> <路径>：相对路径按当前目录，换根目录、id 不变；mv <project> <新 id> 改 id', async (t) => {
  const made = fixture(t);
  fs.cpSync(made.proj, path.join(made.dir, 'proj-copy'), { recursive: true });
  const moved = await runIn(made, ['mv', 'e2e-project', './proj-copy']);
  assert.equal(moved.code, 0, moved.err.join('\n'));
  assert.equal(readJson(made.registry).entries[0].path, path.join(made.dir, 'proj-copy'));
  const renamed = await runIn(made, ['mv', 'e2e-project', 'e2e-two']);
  assert.equal(renamed.code, 0, renamed.err.join('\n'));
  assert.equal(readJson(made.registry).entries[0].id, 'e2e-two');
  assert.ok(fs.existsSync(path.join(made.data, 'e2e-two_commit-confirm', '@canvas.json')), '文章桶跟着 project 改名');
});

test('mv 用法：参数不够、目标写成文章以外的路径形状退 2；rename / move 已删', async (t) => {
  const made = fixture(t);
  assert.equal((await runIn(made, ['mv', 'e2e-project'])).code, 2);
  assert.equal((await runIn(made, ['mv', 'e2e-project/commit-confirm', './x'])).code, 2);
  assert.equal((await runIn(made, ['mv', 'e2e-project', 'some/where'])).code, 2);
  for (const gone of [['rename', 'e2e-project', 'x'], ['move', 'e2e-project', '/tmp']]) {
    const res = await runIn(made, gone);
    assert.equal(res.code, 2, gone[0]);
    assert.match(res.err.join('\n'), new RegExp(`未知命令：${gone[0]}`));
  }
  const json = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-project/c2', '--json']);
  assert.equal(json.code, 0, json.err.join('\n'));
  const envelope = JSON.parse(json.out.join('\n'));
  assert.deepEqual([envelope.ok, envelope.command], [true, 'mv']);
});

test('D2：目标桶无法证明为空时拒绝搬迁，保留源文章和两桶原字节', async (t) => {
  for (const [name, content] of [
    ['@canvas.json', '{"annotations":[{"id":"recoverable"}]'],
    ['@canvas.json', '{"annotations":{}}'],
    ['unknown.bin', '保留附件'],
    ['_seq.json', '{bad'],
  ]) {
    const made = fixture(t);
    const target = path.join(made.data, 'e2e-project_reused');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, name), content);
    const source = path.join(made.data, 'e2e-project_commit-confirm', '@canvas.json');
    const before = fs.readFileSync(source, 'utf8');
    const res = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-project/reused']);
    assert.equal(res.code, 1, `${name}: ${res.err.join('\n')}`);
    assert.ok(fs.existsSync(articleDir(made.proj, 'commit-confirm')));
    assert.ok(!fs.existsSync(articleDir(made.proj, 'reused')));
    assert.equal(fs.readFileSync(source, 'utf8'), before);
    assert.equal(fs.readFileSync(path.join(target, name), 'utf8'), content);
    assert.match(res.err.join('\n'), /无法确认.*为空/);
  }
});

test('D4：跨设备复制中途失败不发布半篇文章，源完整且可以重试', async (t) => {
  const made = fixture(t);
  const from = articleDir(made.proj, 'commit-confirm');
  const to = articleDir(made.html, 'commit-confirm');
  const rename = fs.renameSync;
  const copy = fs.cpSync;
  t.mock.method(fs, 'renameSync', (a, b) => {
    if (a === from && b === to) throw Object.assign(new Error('不同设备'), { code: 'EXDEV' });
    return rename(a, b);
  });
  t.mock.method(fs, 'cpSync', (a, b, opts) => {
    if (a !== from) return copy(a, b, opts);
    fs.mkdirSync(b, { recursive: true });
    fs.copyFileSync(path.join(a, 'index.mdx'), path.join(b, 'index.mdx'));
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  });
  const res = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-html/']);
  assert.equal(res.code, 1);
  assert.ok(!fs.existsSync(to), '正式目标不能出现半篇文章');
  assert.ok(fs.existsSync(path.join(from, 'index.mdx')));
  assert.ok(!fs.readdirSync(path.dirname(to)).some((name) => name.startsWith('.ppnt-mv-')), '复制临时目录已清理');
  t.mock.restoreAll();
  assert.equal((await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-html/'])).code, 0);
});

test('D5：跨设备搬迁保留篇内、篇外与断链的 symlink 原文', async (t) => {
  const made = fixture(t);
  const from = articleDir(made.proj, 'commit-confirm');
  const to = articleDir(made.html, 'commit-confirm');
  fs.writeFileSync(path.join(from, 'real.html'), '页面正文');
  for (const [name, target] of [['home.html', 'real.html'], ['outside.html', '../outside.html'], ['broken.html', 'missing.html']]) {
    fs.symlinkSync(target, path.join(from, name));
  }
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (a, b) => {
    if (a === from && b === to) throw Object.assign(new Error('不同设备'), { code: 'EXDEV' });
    return rename(a, b);
  });
  const res = await runIn(made, ['mv', 'e2e-project/commit-confirm', 'e2e-html/']);
  assert.equal(res.code, 0, res.err.join('\n'));
  assert.equal(fs.readlinkSync(path.join(to, 'home.html')), 'real.html');
  assert.equal(fs.readFileSync(path.join(to, 'home.html'), 'utf8'), '页面正文');
  assert.equal(fs.readlinkSync(path.join(to, 'outside.html')), '../outside.html');
  assert.equal(fs.readlinkSync(path.join(to, 'broken.html')), 'missing.html');
  assert.ok(!fs.existsSync(from));
});
