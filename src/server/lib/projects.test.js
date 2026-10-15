import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter } from './frontmatter.js';
import { formatProjectError } from '../../shared/project-errors.js';
import { findProject, listProjects, readProjectJson } from './projects.js';
import { loadRegistry, projectEntry } from './registry.js';

/** 布局错误按显示的样子比（formatProjectError），字面与对象化之前一样。 */
const lines = (errors) => errors.map(formatProjectError);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SITE = path.join(REPO, 'e2e', 'project-site');
const COLLIDE = path.join(REPO, 'site', 'fixtures', 'projects', 'clash');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-projects-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function registryWith(t, entries) {
  const dir = tempDir(t);
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries }));
  return loadRegistry({ root: REPO, path: file, log: () => {} });
}

/** 在临时目录里搭一个 project：files = { 'articles/a/index.mdx': '…' }（相对 docs/pinpoint/）。 */
function makeProject(t, files) {
  const root = tempDir(t);
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, 'docs', 'pinpoint', rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

test('fixture project: two articles and two concepts, titles from frontmatter, no errors', (t) => {
  const registry = registryWith(t, [{ id: 'e2e-project', kind: 'project', path: SITE }]);
  const [project, ...rest] = listProjects(registry);
  assert.equal(rest.length, 0);
  assert.deepEqual(project.errors, []);
  assert.equal(project.id, 'e2e-project');
  assert.equal(project.title, 'E2E Project');
  assert.equal(project.root, SITE);
  assert.equal(project.dir, path.join(SITE, 'docs', 'pinpoint'));
  assert.deepEqual(project.articles, [
    {
      id: 'commit-confirm',
      title: '提交前确认',
      summary: '付款与提交前，agent 停下来请用户确认。',
      pageId: 'e2e-project_commit-confirm',
      dir: path.join(project.dir, 'articles', 'commit-confirm'),
      file: path.join(project.dir, 'articles', 'commit-confirm', 'index.mdx'),
      canvasSections: 3,
      mtimeMs: fs.statSync(path.join(project.dir, 'articles', 'commit-confirm', 'index.mdx')).mtimeMs,
    },
    {
      id: 'takeover',
      title: '用户接手',
      pageId: 'e2e-project_takeover',
      dir: path.join(project.dir, 'articles', 'takeover'),
      file: path.join(project.dir, 'articles', 'takeover', 'index.mdx'),
      canvasSections: 0,
      mtimeMs: fs.statSync(path.join(project.dir, 'articles', 'takeover', 'index.mdx')).mtimeMs,
    },
  ]);
  assert.deepEqual(project.concepts, [
    { name: 'confirm-card', slug: 'confirm-card', status: '收敛中', boundary: '只在不可撤销的动作之前出现', file: path.join(project.dir, 'wiki', 'confirm-card.md') },
    { name: 'takeover-banner', slug: 'takeover-banner', status: '占位', boundary: '只说明谁在控制浏览器', file: path.join(project.dir, 'wiki', 'takeover-banner.md') },
  ]);
  assert.equal(findProject(registry, 'e2e-project').title, 'E2E Project');
  assert.equal(findProject(registry, 'nope'), null);
});

test('article date：合法的 YYYY-MM-DD 进 date；写错的不报错、不进 date；mtimeMs 是 index.mdx 的修改时间', (t) => {
  const root = makeProject(t, {
    'project.json': '{"id":"dated"}',
    'articles/a/index.mdx': '---\ntitle: A\ndate: 2026-10-01\n---\n',
    'articles/b/index.mdx': '---\ntitle: B\ndate: 下周\n---\n',
  });
  const when = new Date(2026, 9, 9, 10, 0);
  fs.utimesSync(path.join(root, 'docs', 'pinpoint', 'articles', 'b', 'index.mdx'), when, when);
  const project = findProject(registryWith(t, [{ id: 'dated', kind: 'project', path: root }]), 'dated');
  assert.deepEqual(project.errors, []);
  const [a, b] = project.articles;
  assert.equal(a.date, '2026-10-01');
  assert.equal(b.date, undefined);
  assert.equal(b.mtimeMs, when.getTime());
});

test('collision fixture: article id and concept name share one case-insensitive namespace', (t) => {
  const registry = registryWith(t, [{ id: 'clash', kind: 'project', path: COLLIDE }]);
  const project = findProject(registry, 'clash');
  assert.equal(project.articles.length, 1, 'both sides stay listed; the error is reported, not thrown');
  assert.equal(project.concepts.length, 1);
  assert.equal(project.errors.length, 1);
  assert.match(formatProjectError(project.errors[0]), /撞名 \[\[confirm-card\]\]：article "confirm-card"、wiki 词条 "Confirm-Card"（wiki\/confirm\.md）/);
});

test('defaults: article title falls back to id, concept name to file name', (t) => {
  const root = makeProject(t, {
    'project.json': '{"id":"bare"}',
    'articles/plain/index.mdx': '# 没有 frontmatter\n',
    'wiki/裸词.md': '定义。\n',
  });
  const registry = registryWith(t, [{ id: 'bare', title: 'Bare Entry', kind: 'project', path: root }]);
  const project = findProject(registry, 'bare');
  assert.deepEqual(project.errors, []);
  assert.equal(project.title, 'Bare Entry', 'no project.json title → registry title');
  assert.equal(project.articles[0].title, 'plain');
  assert.equal(project.articles[0].summary, undefined);
  assert.deepEqual(project.concepts.map((c) => [c.name, c.slug]), [['裸词', '裸词']]);
});

test('layout errors are listed, never thrown', async (t) => {
  await t.test('missing root and missing docs/pinpoint', (t) => {
    const empty = tempDir(t);
    const registry = registryWith(t, [
      { id: 'gone', kind: 'project', path: path.join(empty, 'nope') },
      { id: 'empty', kind: 'project', path: empty },
    ]);
    const [gone, bare] = listProjects(registry);
    assert.match(formatProjectError(gone.errors[0]), /根目录不存在/);
    assert.match(formatProjectError(bare.errors[0]), /缺 docs\/pinpoint\/ 目录/);
    assert.deepEqual([gone.articles, bare.concepts], [[], []]);
  });

  await t.test('project.json missing, broken, or naming another id', (t) => {
    const missing = makeProject(t, { 'articles/a/index.mdx': '' });
    const broken = makeProject(t, { 'project.json': '{ nope' });
    const other = makeProject(t, { 'project.json': '{"id":"other","title":"T"}' });
    const [a, b, c] = listProjects(registryWith(t, [
      { id: 'missing', kind: 'project', path: missing },
      { id: 'broken', kind: 'project', path: broken },
      { id: 'mine', kind: 'project', path: other },
    ]));
    assert.match(formatProjectError(a.errors[0]), /缺 docs\/pinpoint\/project\.json/);
    assert.equal(a.articles.length, 1, 'articles still read without project.json');
    assert.match(formatProjectError(b.errors[0]), /不是合法 JSON/);
    assert.deepEqual(lines(c.errors), ['project.json 的 id "other" 与登记的 id "mine" 不一致（改 id 用 pinpoint rename）']);
  });

  await t.test('bad article dirs, reserved article id, duplicate concept names, bad frontmatter', (t) => {
    const root = makeProject(t, {
      'project.json': '{"id":"messy"}',
      'articles/stray.md': '',
      'articles/Bad_Id/index.mdx': '',
      'articles/wiki/index.mdx': '',
      'articles/concepts/index.mdx': '',
      'articles/no-index/notes.md': '',
      'articles/ok/index.mdx': '---\ntitle: OK\ntags:\n  - a\n---\n',
      'wiki/one.md': '---\nname: same\n---\n',
      'wiki/two.md': '---\nname: Same\n---\n',
      'wiki/readme.txt': 'ignored',
    });
    const project = findProject(registryWith(t, [{ id: 'messy', kind: 'project', path: root }]), 'messy');
    assert.deepEqual(project.articles.map((a) => a.id), ['ok']);
    assert.equal(project.articles[0].title, 'OK');
    assert.deepEqual(project.concepts.map((c) => c.slug), ['one', 'two']);
    assert.deepEqual(lines(project.errors), [
      'articles/Bad_Id：文章 id 必须匹配 /^[a-z0-9][a-z0-9-]*$/',
      'articles/concepts：文章 id 是保留名（/<project>/concepts/ 已被占用）',
      'articles/no-index：缺 index.mdx',
      'articles/ok/index.mdx：frontmatter 第 3 行：值为空（不写这个键，或写 ""）',
      'articles/ok/index.mdx：frontmatter 第 4 行只支持 key: value：- a',
      'articles/stray.md：articles/ 下只放文章目录',
      'articles/wiki：文章 id 是保留名（/<project>/wiki/ 已被占用）',
      'wiki/readme.txt：wiki/ 下只放 <名字>.md',
      '撞名 [[same]]：wiki 词条 "same"（wiki/one.md）、wiki 词条 "Same"（wiki/two.md）（文章 id 与 wiki 词条的 name 共用一个命名空间）',
    ]);
    // 对象本身：path 相对 docs/pinpoint/，project 级的（撞名）没有 path；code 分种类。
    assert.deepEqual(project.errors.map(({ code, path: where }) => [code, where]), [
      ['article_id_invalid', 'articles/Bad_Id'],
      ['article_id_reserved', 'articles/concepts'],
      ['article_index_missing', 'articles/no-index'],
      ['frontmatter', 'articles/ok/index.mdx'],
      ['frontmatter', 'articles/ok/index.mdx'],
      ['article_not_dir', 'articles/stray.md'],
      ['article_id_reserved', 'articles/wiki'],
      ['wiki_not_md', 'wiki/readme.txt'],
      ['name_collision', undefined],
    ]);
  });

  await t.test('concept status must be one of the three states', (t) => {
    const root = makeProject(t, { 'project.json': '{"id":"st"}', 'wiki/a.md': '---\nstatus: done\n---\n', 'wiki/b.md': '---\nstatus: 已固定\n---\n' });
    const project = findProject(registryWith(t, [{ id: 'st', kind: 'project', path: root }]), 'st');
    assert.deepEqual(project.concepts.map((c) => c.status), [undefined, '已固定']);
    assert.deepEqual(lines(project.errors), ['wiki/a.md：status 只能是 占位 / 收敛中 / 已固定：done']);
  });

  await t.test('the old concepts/ directory is a layout error, not read (ADR 0045)', (t) => {
    const root = makeProject(t, { 'project.json': '{"id":"old"}', 'concepts/a.md': '---\nname: a\n---\n', 'wiki/b.md': '---\nname: b\n---\n' });
    const project = findProject(registryWith(t, [{ id: 'old', kind: 'project', path: root }]), 'old');
    assert.deepEqual(project.concepts.map((c) => c.slug), ['b'], 'concepts/ is not read');
    assert.deepEqual(project.errors.map(({ code, path: where }) => [code, where]), [['wiki_dir_renamed', 'concepts']]);
    assert.match(formatProjectError(project.errors[0]), /^concepts：.*改名成 wiki\/.*mv .*docs\/pinpoint\/concepts .*docs\/pinpoint\/wiki/);
  });

  await t.test('reserved project ids are rejected', (t) => {
    const root = makeProject(t, { 'project.json': '{"id":"api"}' });
    assert.match(formatProjectError(readProjectJson(root).errors[0]), /保留名.*\/api\//);
    const project = findProject(registryWith(t, [{ id: 'api', kind: 'project', path: root }]), 'api');
    assert.equal(project.errors.length, 1, 'one message, not one per check');
  });
});

test('parseFrontmatter: key: value lines, quotes, comments, strict on the rest', () => {
  assert.deepEqual(parseFrontmatter('no fm'), { data: {}, body: 'no fm', errors: [] });
  const parsed = parseFrontmatter('﻿---\r\ntitle: "A: \\"q\\""\r\nsummary: it\'s fine # note\r\nname: \'x\'\'y\'\r\n# c\r\n\r\nempty: ""\r\n---\r\nbody');
  assert.deepEqual(parsed.data, { title: 'A: "q"', summary: "it's fine", name: "x'y", empty: '' });
  assert.equal(parsed.body, 'body');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parseFrontmatter('---\ntitle: a\n').errors, ['frontmatter 没有结束的 ---']);
  assert.deepEqual(parseFrontmatter('---\nt: a\nt: b\nx: "open\n---\n').errors, [
    'frontmatter 第 3 行重复的键：t',
    'frontmatter 第 4 行：双引号值没闭合或含非法转义："open',
  ]);
  // YAML 的块标量、流式列表、空值（后接块列表）都报错，字段不进 data。
  const yamlish = parseFrontmatter('---\nsummary: >\n  folded\ntags: [a, b]\nlist:\n  - a\nok: yes\n---\n');
  assert.deepEqual(yamlish.data, { ok: 'yes' });
  assert.deepEqual(yamlish.errors, [
    'frontmatter 第 2 行：只支持单行字符串，不支持以 > 开头的 YAML 写法：>',
    'frontmatter 第 3 行只支持 key: value：folded',
    'frontmatter 第 4 行：只支持单行字符串，不支持以 [ 开头的 YAML 写法：[a, b]',
    'frontmatter 第 5 行：值为空（不写这个键，或写 ""）',
    'frontmatter 第 6 行只支持 key: value：- a',
  ]);
});

// 保留首段的表、仓库根目录与服务路由都在表里：article-routes.test.js 的两条“保留首段”；
// 表 → isReservedProjectId、e2e 产物前缀：src/shared/project-ids.test.js。

test('registry: project entries live in projects, not entries; page consumers never see them', (t) => {
  const registry = registryWith(t, [
    { id: 'pinpoint', kind: 'dir', path: REPO },
    { id: 'e2e-project', kind: 'project', path: SITE },
    { id: 'e2e-project', kind: 'dir', path: REPO },
  ]);
  assert.deepEqual(registry.entries.map((e) => e.id), ['pinpoint']);
  assert.deepEqual(registry.projects, [{ id: 'e2e-project', title: 'e2e-project', kind: 'project', path: SITE }]);
  assert.equal(registry.resolve('e2e-project'), null);
  assert.equal(projectEntry(registry, 'e2e-project').path, SITE);
  assert.deepEqual(registry.errors, ['duplicate entry id "e2e-project"']);
});

