import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readTargetBoard, resolveBoardSource, resolvePageTarget } from './board-source.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-board-source-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // 有板 dir 条目
  const withBoard = path.join(dir, 'with-board');
  write(path.join(withBoard, 'board.json'), JSON.stringify({ sections: [{ id: 's', title: 'S', layout: 'row', screens: [{ id: 'home' }] }] }));
  write(path.join(withBoard, 'home.html'), '<div class="ios-app">home</div>\n');
  // 无板 dir 条目（顶层两个 html → 合成板）
  const plain = path.join(dir, 'plain');
  write(path.join(plain, 'a.html'), '<p>a</p>\n');
  write(path.join(plain, 'b.html'), '<p>b</p>\n');
  // file 条目
  const single = path.join(dir, 'single.html');
  write(single, '<p>single</p>\n');
  // 模板页（临时 root 的 content/previews/<id>/board.json，不在清单里）
  const root = path.join(dir, 'repo');
  write(path.join(root, 'content', 'previews', 'tpl', 'board.json'), JSON.stringify({ sections: [{ id: 's', screens: ['x'] }] }));
  write(path.join(root, 'content', 'previews', 'tpl', 'x.html'), '<div class="ios-app">x</div>\n');
  // project + 文章
  const proj = path.join(dir, 'proj');
  write(path.join(proj, 'docs', 'pinpoint', 'project.json'), JSON.stringify({ id: 'demo' }));
  write(path.join(proj, 'docs', 'pinpoint', 'articles', 'flow', 'index.mdx'), [
    '---', 'title: 流程', '---', '',
    '<Section id="ask" title="提问">', '', '<Canvas frames={["ask-open"]} />', '', '</Section>', '',
  ].join('\n'));
  write(path.join(proj, 'docs', 'pinpoint', 'articles', 'flow', 'ask-open.jsx'), 'export default function A() {\n  return <div className="ios-app">问</div>;\n}\n');
  const registry = {
    entries: [
      { id: 'with-board', kind: 'dir', path: withBoard },
      { id: 'plain', kind: 'dir', path: plain },
      { id: 'single', kind: 'file', path: single },
    ],
    projects: [{ id: 'demo', kind: 'project', path: proj }],
  };
  return { dir, root, registry, withBoard, plain, single };
}

test('dir 条目：磁盘有 board.json → 可编译目标；readBoard 读磁盘原样（不摊平）', (t) => {
  const { registry } = fixture(t);
  const source = resolveBoardSource('with-board', { registry });
  assert.equal(source.kind, 'dir');
  assert.deepEqual(source.target, {
    entryId: 'with-board',
    pageDir: source.pageDir,
    urlBase: '/sites/with-board/',
    kind: 'dir',
  });
  assert.equal(source.mode, 'html'); // 没写 board:'ios' 的目录缺省 html（entryBoardMode）
  const board = source.readBoard();
  assert.equal(board.sections[0].screens[0].id, 'home');
  assert.deepEqual(readTargetBoard(source.target), board);
  // 磁盘优先：有板时合成板不参与（synthBoard 仍在，消费方自己决定回落）
  assert.equal(source.synthBoard().sections[0].shell, 'doc');
});

test('无板 dir / file 条目：target 为 null（不可编译），板靠合成', (t) => {
  const { registry } = fixture(t);
  const dirSource = resolveBoardSource('plain', { registry });
  assert.equal(dirSource.kind, 'dir');
  assert.equal(dirSource.target, null);
  assert.equal(dirSource.readBoard(), null);
  assert.deepEqual(dirSource.synthBoard().sections[0].screens.map((s) => s.id), ['a', 'b']);
  const fileSource = resolveBoardSource('single', { registry });
  assert.equal(fileSource.kind, 'file');
  assert.equal(fileSource.pageDir, null);
  assert.equal(fileSource.target, null);
  assert.equal(fileSource.synthBoard().sections[0].screens[0].id, 'index');
  assert.equal(resolvePageTarget('plain', { registry }), null);
});

test('模板页：previews/<id>/board.json 在盘上即来源，不在清单里 manifest 为 null', (t) => {
  const { root } = fixture(t);
  const source = resolveBoardSource('tpl', { registry: null, root });
  assert.equal(source.kind, 'template');
  assert.equal(source.manifest, null);
  assert.equal(source.mode, 'ios');
  assert.deepEqual(source.target, {
    entryId: 'tpl',
    pageDir: path.join(root, 'content', 'previews', 'tpl'),
    urlBase: '/previews/tpl/',
    kind: 'template',
  });
  assert.equal(source.readBoard().sections[0].id, 's');
  assert.equal(source.synthBoard(), null);
});

test('文章画布：target 是文章编译目标，readBoard 由 index.mdx 派生', (t) => {
  const { registry } = fixture(t);
  const source = resolveBoardSource('demo_flow', { registry });
  assert.equal(source.kind, 'article');
  assert.equal(source.target.kind, 'article');
  assert.equal(source.mode, 'ios');
  const board = source.readBoard();
  assert.equal(board.sections[0].id, 'ask');
  assert.deepEqual(readTargetBoard(source.target), board);
  // 派生坏了（正文读不到）→ readBoard null（readTargetBoard 抛错，两条路各归各的消费方）
  fs.rmSync(source.target.articleFile);
  assert.equal(source.readBoard(), null);
  assert.throws(() => readTargetBoard(source.target));
});

test('判定优先序：条目 → 模板页 → 文章；非法 id 与陌生 id 为 null', (t) => {
  const { registry, root } = fixture(t);
  assert.equal(resolveBoardSource('../etc', { registry, root }), null);
  assert.equal(resolveBoardSource('ghost', { registry, root }), null);
  assert.equal(resolveBoardSource('', { registry, root }), null);
  // 条目 id 与文章页 id 撞名（条目 id 不含 _，构造上撞不了；这里只守「条目先认」）
  assert.equal(resolveBoardSource('with-board', { registry, root }).kind, 'dir');
});
