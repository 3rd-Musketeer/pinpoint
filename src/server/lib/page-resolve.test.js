import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { listArticleTargets, pageIdIsLive, projectArticleTargets, resolveArticleTarget, resolvePage } from './page-resolve.js';
import { loadRegistry, projectEntries, projectEntry, registryEntry } from './registry.js';

/** 临时 registry：一个 dir 条目、一个 url 条目、一个 project（文章 notes、flow，flow 没有 index.mdx）。 */
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-page-resolve-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proj = path.join(root, 'proj');
  const articles = path.join(proj, 'docs', 'pinpoint', 'articles');
  fs.mkdirSync(path.join(articles, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(articles, 'flow'), { recursive: true });
  fs.mkdirSync(path.join(articles, 'Bad_Name'), { recursive: true });
  fs.writeFileSync(path.join(articles, 'Bad_Name', 'index.mdx'), '# x\n');
  fs.writeFileSync(path.join(proj, 'docs', 'pinpoint', 'project.json'), JSON.stringify({ id: 'demo' }));
  fs.writeFileSync(path.join(articles, 'notes', 'index.mdx'), '# n\n');
  const file = path.join(root, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [
    { id: 'site', kind: 'dir', path: root },
    { id: 'web', kind: 'url', url: 'https://example.com/' },
    { id: 'demo', kind: 'project', path: proj },
  ] }));
  return { root, proj, registry: loadRegistry({ root, path: file, log: () => {} }) };
}

test('pageIdIsLive：条目、模板页、盘上有 index.mdx 的文章画布页是页；project id、删掉的文章、没登记的 project 不是', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-live-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, 'docs', 'pinpoint', 'articles', 'notes'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'docs', 'pinpoint', 'project.json'), JSON.stringify({ id: 'demo' }));
  fs.writeFileSync(path.join(proj, 'docs', 'pinpoint', 'articles', 'notes', 'index.mdx'), '# n\n');
  const file = path.join(root, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [
    { id: 'site', kind: 'dir', path: root },
    { id: 'web', kind: 'url', url: 'https://example.com/' },
    { id: 'demo', kind: 'project', path: proj },
  ] }));
  const registry = loadRegistry({ root, path: file });
  const live = (id) => pageIdIsLive(registry, id, { manifestIds: ['tpl'] });
  assert.deepEqual(
    ['site', 'web', 'tpl', 'demo_notes', 'demo', 'demo_gone', 'other_notes', '', null].map(live),
    [true, true, true, true, false, false, false, false, false],
  );
});


test('resolvePage：条目、模板页、文章画布页各一种；project id 与不在盘上的文章不是页', (t) => {
  const { registry, proj } = fixture(t);
  const kinds = (id) => (resolvePage(registry, id, { manifestIds: ['tpl', 'demo_notes-x'] }) || { kind: null }).kind;
  assert.deepEqual(['site', 'web', 'tpl', 'demo_notes', 'demo', 'demo_flow', 'nope'].map(kinds),
    ['entry', 'entry', 'template', 'article', null, null, null]);
  const article = resolvePage(registry, 'demo_notes');
  assert.equal(article.target.articleFile, path.join(proj, 'docs', 'pinpoint', 'articles', 'notes', 'index.mdx'));
  assert.equal(article.target.urlBase, '/sites/demo_notes/');
  assert.equal(resolvePage(registry, 'site').entry.kind, 'dir');
  // 模板页只在给了清单时认（/sites/ 不服务模板页，就不给）。
  assert.equal(resolvePage(registry, 'tpl'), null);
});

test('resolvePage：带 _ 的模板页与文章画布页撞名时模板页优先', (t) => {
  const { registry } = fixture(t);
  assert.equal(resolvePage(registry, 'demo_notes', { manifestIds: ['demo_notes'] }).kind, 'template');
});

test('文章目标：只认 registry.projects；目录名不合 id 规则的跳过', (t) => {
  const { registry } = fixture(t);
  assert.deepEqual(listArticleTargets(registry).map((target) => target.entryId), ['demo_notes']);
  assert.deepEqual(projectArticleTargets(projectEntry(registry, 'demo')).map((target) => target.articleId), ['notes']);
  assert.deepEqual(projectArticleTargets(null), []);
  assert.equal(resolveArticleTarget(registry, 'demo_concepts'), null);
  assert.equal(resolveArticleTarget(null, 'demo_notes'), null);
  // project 条目不在 entries 里：页条目的读法看不到它。
  assert.equal(registryEntry(registry, 'demo'), null);
  assert.deepEqual(projectEntries(registry).map((entry) => entry.id), ['demo']);
  assert.deepEqual(listArticleTargets({ entries: [{ id: 'demo', kind: 'project', path: '/x' }] }), []);
});

test('registryEntry：有 resolve 用 resolve，只有 entries 的视图按 entries 找', () => {
  assert.deepEqual(registryEntry({ resolve: (id) => (id === 'a' ? { id } : null) }, 'a'), { id: 'a' });
  assert.equal(registryEntry({ resolve: () => undefined }, 'a'), null);
  assert.deepEqual(registryEntry({ entries: [{ id: 'a', kind: 'dir' }] }, 'a'), { id: 'a', kind: 'dir' });
  assert.equal(registryEntry(null, 'a'), null);
});
