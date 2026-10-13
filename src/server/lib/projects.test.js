import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { articlePageId, isReservedProjectId, parseArticlePageId, RESERVED_TOP_SEGMENTS } from '../../shared/project-ids.js';
import { parseFrontmatter } from './frontmatter.js';
import { findProject, listProjects, readProjectJson } from './projects.js';
import { loadRegistry, projectEntry } from './registry.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SITE = path.join(REPO, 'e2e', 'project-site');
const COLLIDE = path.join(REPO, 'e2e', 'project-collide');

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
    },
    {
      id: 'takeover',
      title: '用户接手',
      pageId: 'e2e-project_takeover',
      dir: path.join(project.dir, 'articles', 'takeover'),
      file: path.join(project.dir, 'articles', 'takeover', 'index.mdx'),
      canvasSections: 0,
    },
  ]);
  assert.deepEqual(project.concepts, [
    { name: 'confirm-card', slug: 'confirm-card', status: '收敛中', boundary: '只在不可撤销的动作之前出现', file: path.join(project.dir, 'concepts', 'confirm-card.md') },
    { name: 'takeover-banner', slug: 'takeover-banner', status: '占位', boundary: '只说明谁在控制浏览器', file: path.join(project.dir, 'concepts', 'takeover-banner.md') },
  ]);
  assert.equal(findProject(registry, 'e2e-project').title, 'E2E Project');
  assert.equal(findProject(registry, 'nope'), null);
});

test('collision fixture: article id and concept name share one case-insensitive namespace', (t) => {
  const registry = registryWith(t, [{ id: 'e2e-collide', kind: 'project', path: COLLIDE }]);
  const project = findProject(registry, 'e2e-collide');
  assert.equal(project.articles.length, 1, 'both sides stay listed; the error is reported, not thrown');
  assert.equal(project.concepts.length, 1);
  assert.equal(project.errors.length, 1);
  assert.match(project.errors[0], /撞名 \[\[confirm-card\]\]：article "confirm-card"、concept "Confirm-Card"（concepts\/confirm\.md）/);
});

test('defaults: article title falls back to id, concept name to file name', (t) => {
  const root = makeProject(t, {
    'project.json': '{"id":"bare"}',
    'articles/plain/index.mdx': '# 没有 frontmatter\n',
    'concepts/裸词.md': '定义。\n',
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
    assert.match(gone.errors[0], /根目录不存在/);
    assert.match(bare.errors[0], /缺 docs\/pinpoint\/ 目录/);
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
    assert.match(a.errors[0], /缺 docs\/pinpoint\/project\.json/);
    assert.equal(a.articles.length, 1, 'articles still read without project.json');
    assert.match(b.errors[0], /不是合法 JSON/);
    assert.deepEqual(c.errors, ['project.json 的 id "other" 与登记的 id "mine" 不一致（改 id 用 pinpoint rename）']);
  });

  await t.test('bad article dirs, reserved article id, duplicate concept names, bad frontmatter', (t) => {
    const root = makeProject(t, {
      'project.json': '{"id":"messy"}',
      'articles/stray.md': '',
      'articles/Bad_Id/index.mdx': '',
      'articles/concepts/index.mdx': '',
      'articles/no-index/notes.md': '',
      'articles/ok/index.mdx': '---\ntitle: OK\ntags:\n  - a\n---\n',
      'concepts/one.md': '---\nname: same\n---\n',
      'concepts/two.md': '---\nname: Same\n---\n',
      'concepts/readme.txt': 'ignored',
    });
    const project = findProject(registryWith(t, [{ id: 'messy', kind: 'project', path: root }]), 'messy');
    assert.deepEqual(project.articles.map((a) => a.id), ['ok']);
    assert.equal(project.articles[0].title, 'OK');
    assert.deepEqual(project.concepts.map((c) => c.slug), ['one', 'two']);
    assert.deepEqual(project.errors, [
      'articles/Bad_Id：文章 id 必须匹配 /^[a-z0-9][a-z0-9-]*$/',
      'articles/concepts：文章 id 是保留名（/<project>/concepts/ 已被占用）',
      'articles/no-index：缺 index.mdx',
      'articles/ok/index.mdx：frontmatter 第 3 行：值为空（不写这个键，或写 ""）',
      'articles/ok/index.mdx：frontmatter 第 4 行只支持 key: value：- a',
      'articles/stray.md：articles/ 下只放文章目录',
      'concepts/readme.txt：concepts/ 下只放 <名字>.md',
      '撞名 [[same]]：concept "same"（concepts/one.md）、concept "Same"（concepts/two.md）（article id 与 concept name 共用一个命名空间）',
    ]);
  });

  await t.test('concept status must be one of the three states', (t) => {
    const root = makeProject(t, { 'project.json': '{"id":"st"}', 'concepts/a.md': '---\nstatus: done\n---\n', 'concepts/b.md': '---\nstatus: 已固定\n---\n' });
    const project = findProject(registryWith(t, [{ id: 'st', kind: 'project', path: root }]), 'st');
    assert.deepEqual(project.concepts.map((c) => c.status), [undefined, '已固定']);
    assert.deepEqual(project.errors, ['concepts/a.md：status 只能是 占位 / 收敛中 / 已固定：done']);
  });

  await t.test('reserved project ids are rejected', (t) => {
    const root = makeProject(t, { 'project.json': '{"id":"api"}' });
    assert.match(readProjectJson(root).errors[0], /保留名.*\/api\//);
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

test('reserved ids cover every top-level directory the service serves from the repo root', () => {
  const dirs = fs.readdirSync(REPO, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
    .map((item) => item.name)
  for (const name of dirs) assert.ok(isReservedProjectId(name), `vite 服务 /${name}/，project id 必须拒绝它`);
  assert.ok(isReservedProjectId('test-results-5420') && isReservedProjectId('playwright-report'));
  assert.ok(!isReservedProjectId('browser-use'));
  // 服务路由占用的首段（src/shared/project-ids.js RESERVED_TOP_SEGMENTS，唯一的表）：登记校验必须全部拒绝。
  const proxySide = 'health registry events annotations save image images api sites kits previews lib bin content docs e2e scripts skills src site tasks prototypes workbench assets annotate _astro _image node_modules'.split(' ');
  for (const name of proxySide) assert.ok(isReservedProjectId(name), name);
  for (const name of RESERVED_TOP_SEGMENTS) assert.ok(isReservedProjectId(name), name);
});

test('registry: project entries live in projects, not entries; page consumers never see them', (t) => {
  const registry = registryWith(t, [
    { id: 'pinpoint', kind: 'dir', path: REPO },
    { id: 'e2e-project', kind: 'project', path: SITE },
    { id: 'e2e-project', kind: 'dir', path: REPO },
    { id: 'att', kind: 'project', path: SITE, page: 'pinpoint' },
  ]);
  assert.deepEqual(registry.entries.map((e) => e.id), ['pinpoint']);
  assert.deepEqual(registry.projects, [{ id: 'e2e-project', title: 'e2e-project', kind: 'project', path: SITE }]);
  assert.equal(registry.resolve('e2e-project'), null);
  assert.equal(projectEntry(registry, 'e2e-project').path, SITE);
  assert.deepEqual(registry.errors, ['duplicate entry id "e2e-project"', 'entry "att" kind "project" cannot attach to a page']);
});

test('articlePageId: <project>_<article>, never an entry id, parses back one way', () => {
  assert.equal(articlePageId('e2e-project', 'commit-confirm'), 'e2e-project_commit-confirm');
  assert.deepEqual(parseArticlePageId('e2e-project_commit-confirm'), { projectId: 'e2e-project', articleId: 'commit-confirm' });
  // 不是这个形状：登记条目 id（没有下划线）、空段、多一个下划线、大写、点。
  for (const id of ['e2e-project', '_a', 'p_', 'p_a_b', 'P_a', 'p.a', '', null]) assert.equal(parseArticlePageId(id), null, String(id));
});
