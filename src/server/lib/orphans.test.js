import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectBucketOrphans,
  collectOrphanCounts,
  collectPageOrphans,
  ledgerIsOrphan,
  pageSurfaceSpaces,
} from './orphans.js';
import { resolveArticleTarget } from './page-resolve.js';
import { loadRegistry } from './registry.js';

function withFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-orphans-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'data');
  const siteDir = path.join(root, 'site');
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'doc.html'), '<!doctype html><p>doc</p>');
  fs.writeFileSync(path.join(siteDir, 'gone.html'), '<!doctype html><p>gone</p>');
  fs.writeFileSync(path.join(root, 'draft.html'), '<!doctype html><p>draft</p>');
  const previewsRoot = path.join(root, 'content', 'previews');
  const pageDir = path.join(previewsRoot, 'tpl-page');
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify({
    sections: [{ id: 's1', title: 'S1', screens: [{ id: 'shot', title: 'Shot' }] }],
  }));
  fs.writeFileSync(path.join(pageDir, 'shot.jsx'), 'export default function Shot() { return <p>shot</p>; }\n');
  fs.writeFileSync(path.join(pageDir, 'about.html'), '<!doctype html><p>about</p>');
  const entries = [
    { id: 'site-a', kind: 'dir', path: siteDir },
    { id: 'draft-b', kind: 'file', path: path.join(root, 'draft.html') },
    { id: 'live-app', kind: 'dir', path: path.join(root, 'live-app') },
  ];
  return { root, dataRoot, siteDir, previewsRoot, pageDir, entries };
}

function writeLedger(bucket, name, doc) {
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, name), JSON.stringify(doc));
}

test('pageSurfaceSpaces：自己的条目 + manifest 页各成一个 URL 空间', (t) => {
  const { root, previewsRoot, entries } = withFixture(t);
  const spaces = pageSurfaceSpaces({ pageId: 'site-a', entries, isManifestPage: false, previewsRoot });
  assert.deepEqual(spaces.map((s) => s.prefix), ['/sites/site-a/']);
  assert.deepEqual(pageSurfaceSpaces({ pageId: 'draft-b', entries, previewsRoot }).map((s) => s.prefix), ['/sites/draft-b/']);
  const tpl = pageSurfaceSpaces({ pageId: 'tpl-page', entries, isManifestPage: true, previewsRoot });
  assert.deepEqual(tpl.map((s) => s.prefix), ['/previews/tpl-page/']);
  assert.equal(tpl[0].root, path.join(previewsRoot, 'tpl-page'));
  assert.equal(root.length > 0, true);
});

test('collectPageOrphans：文件没了 / 错放别页空间是孤儿；@canvas、活文件、dist 屏不是', (t) => {
  const { dataRoot, siteDir, previewsRoot, entries } = withFixture(t);
  const bucket = path.join(dataRoot, 'site-a');
  writeLedger(bucket, '@canvas.json', { page: '@canvas', path: '@canvas', annotations: [] });
  writeLedger(bucket, 'doc~1.json', { page: 'doc~1', path: '/sites/site-a/doc.html', annotations: [] });
  writeLedger(bucket, 'gone~2.json', { page: 'gone~2', path: '/sites/site-a/gone.html', annotations: [] });
  // 指向别页条目空间的账本 = 错放（G3 第 2 种的形态）：表面活着但不归本页。
  writeLedger(bucket, 'draft~3.json', { page: 'draft~3', path: '/sites/draft-b/draft.html', annotations: [] });
  writeLedger(bucket, 'stray~4.json', { page: 'stray~4', path: '/sites/live-app/app', annotations: [] });
  // 存量账本没有 path：表面未知，不判。
  writeLedger(bucket, 'legacy~5.json', { page: 'legacy~5', annotations: [] });
  fs.rmSync(path.join(siteDir, 'gone.html'));
  assert.deepEqual(
    collectPageOrphans({ pageId: 'site-a', dataRoot, entries, previewsRoot }).sort(),
    ['draft~3.json', 'gone~2.json', 'stray~4.json'],
  );

  // 条目从登记表移走（G3 第 3 种）：指向 /sites/live-app/ 的账本在任何页
  // 的空间里都查不到了 —— 表面已消失，判孤儿；它自己的桶（页没了）整桶皆
  // 孤儿，走 CLI 的按桶判定（ppnt prune），不进 /registry 的按页计数。
  const after = entries.filter((e) => e.id !== 'live-app');
  writeLedger(path.join(dataRoot, 'live-app'), 'app~6.json', { page: 'app~6', path: '/sites/live-app/app', annotations: [] });
  assert.deepEqual(
    collectPageOrphans({ pageId: 'site-a', dataRoot, entries: after, previewsRoot }).sort(),
    ['draft~3.json', 'gone~2.json', 'stray~4.json'],
  );
  assert.deepEqual(collectBucketOrphans('live-app', dataRoot), ['app~6.json']);
});

test('模板页：board 屏（只有 .jsx 源）不是孤儿，子路径文件没了是', (t) => {
  const { dataRoot, previewsRoot, entries } = withFixture(t);
  const bucket = path.join(dataRoot, 'tpl-page');
  writeLedger(bucket, '@canvas.json', { page: '@canvas', path: '@canvas', annotations: [] });
  writeLedger(bucket, 'shot~1.json', { page: 'shot~1', path: '/previews/tpl-page/shot.html', annotations: [] });
  writeLedger(bucket, 'about~2.json', { page: 'about~2', path: '/previews/tpl-page/about.html', annotations: [] });
  const orphans = collectPageOrphans({ pageId: 'tpl-page', dataRoot, entries, isManifestPage: true, previewsRoot });
  assert.deepEqual(orphans, [], 'shot 走 dist（board 屏），about 在盘上');
  fs.rmSync(path.join(previewsRoot, 'tpl-page', 'about.html'));
  assert.deepEqual(
    collectPageOrphans({ pageId: 'tpl-page', dataRoot, entries, isManifestPage: true, previewsRoot }),
    ['about~2.json'],
  );
});

test('collectOrphanCounts：按已知页计数（口径 = 行数，K7）；未知页整桶皆孤儿', (t) => {
  const { root, dataRoot, previewsRoot, entries } = withFixture(t);
  const bucket = path.join(dataRoot, 'ghost-page');
  writeLedger(bucket, '@canvas.json', { page: '@canvas', path: '@canvas', annotations: [{ id: 'g1' }] });
  writeLedger(bucket, 'doc~1.json', { page: 'doc~1', path: '/sites/ghost-page/x.html', annotations: [] });
  const counts = collectOrphanCounts({ entries, dataRoot, localIds: ['tpl-page'], root });
  assert.deepEqual(counts, { 'tpl-page': 0, 'site-a': 0, 'draft-b': 0, 'live-app': 0 });
  assert.deepEqual(collectBucketOrphans('ghost-page', dataRoot).sort(), ['@canvas.json', 'doc~1.json']);
  // 孤儿计数的口径是行数：一本孤儿账本装 3 行就计 3。
  writeLedger(path.join(dataRoot, 'site-a'), 'gone~9.json', {
    page: 'gone~9', path: '/sites/site-a/gone.html',
    annotations: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }],
  });
  fs.rmSync(path.join(root, 'site', 'gone.html'));
  const after = collectOrphanCounts({ entries, dataRoot, localIds: ['tpl-page'], root });
  assert.equal(after['site-a'], 3, '一本孤儿账本按行数计');
});

test('collectOrphanCounts：registry 与 manifest 同名时按条目页计，不挂 /previews/ 表面', (t) => {
  const { root, dataRoot, entries } = withFixture(t);
  writeLedger(path.join(dataRoot, 'site-a'), 'previews~site-a~missing.json', {
    page: 'previews~site-a~missing', path: '/previews/site-a/missing.html', annotations: [{ id: 'a' }],
  });
  const counts = collectOrphanCounts({ entries, dataRoot, localIds: ['site-a', 'tpl-page'], root });
  assert.equal(counts['site-a'], 0, '同名的 dir 页不是模板页，这本账本不判孤儿');
  assert.equal(counts['tpl-page'], 0);
});

test('ledgerIsOrphan：目录 URL 回落 index.html；穿越路径是孤儿', (t) => {
  const { dataRoot, siteDir, previewsRoot, entries } = withFixture(t);
  fs.writeFileSync(path.join(siteDir, 'index.html'), '<!doctype html><p>home</p>');
  const spaces = pageSurfaceSpaces({ pageId: 'site-a', entries, previewsRoot });
  assert.equal(ledgerIsOrphan({ name: 'x.json', doc: { path: '/sites/site-a/' } }, spaces), false, 'index.html 在');
  assert.equal(ledgerIsOrphan({ name: 'x.json', doc: { path: '/sites/site-a/../../etc/passwd' } }, spaces), true);
});

test('ledgerIsOrphan：子目录索引页与字面 % 文件名都不是孤儿（G1 误判两型）', (t) => {
  const { dataRoot, siteDir, previewsRoot, entries } = withFixture(t);
  fs.mkdirSync(path.join(siteDir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'sub', 'index.html'), '<!doctype html><p>sub home</p>');
  fs.writeFileSync(path.join(siteDir, '50%.html'), '<!doctype html><p>percent</p>');
  const spaces = pageSurfaceSpaces({ pageId: 'site-a', entries, previewsRoot });
  // 子目录索引 URL 的 rel 以 / 结尾：statSync 命中的是目录，回落 sub/index.html 判。
  assert.equal(ledgerIsOrphan({ name: 'sub.json', doc: { path: '/sites/site-a/sub/' } }, spaces), false);
  // path 已是 decode 形，字面 % 不再二次 decode（原来 decode 抛异常 → 误判孤儿）。
  assert.equal(ledgerIsOrphan({ name: 'pct.json', doc: { path: '/sites/site-a/50%.html' } }, spaces), false);
  assert.equal(ledgerIsOrphan({ name: 'gone.json', doc: { path: '/sites/site-a/sub/gone.html' } }, spaces), true, '子目录里的文件真没了照判');
});


/** 一个登记了的 project，文章 notes 有本篇、@root、@source 三种 HTML 帧和一个 JSX 帧。 */
function withArticle(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-orphans-article-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'proj');
  const content = path.join(root, 'docs', 'pinpoint');
  const article = path.join(content, 'articles', 'notes');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write(path.join(content, 'project.json'), JSON.stringify({ id: 'proj', title: 'P', sources: { kit: '../kit' } }));
  write(path.join(article, 'index.mdx'), '---\ntitle: N\n---\n\n<Section id="a" title="A">\n\n'
    + '<Canvas frames={["live", "card", { id: "cat", src: "shared/cat.html" }, { id: "wid", src: "kit:w.html" }]} />\n\n</Section>\n');
  write(path.join(article, 'live.html'), '<!doctype html><p>live</p>');
  write(path.join(article, 'dropped.html'), '<!doctype html><p>不在 Canvas 里了</p>');
  write(path.join(article, 'card.jsx'), 'export default () => <p>card</p>;\n');
  write(path.join(root, 'shared', 'cat.html'), '<!doctype html><p>cat</p>');
  write(path.join(dir, 'kit', 'w.html'), '<!doctype html><p>w</p>');
  write(path.join(dir, 'registry.json'), JSON.stringify({ version: 1, entries: [{ id: 'proj', kind: 'project', path: root }] }));
  const registry = loadRegistry({ path: path.join(dir, 'registry.json'), root: dir, log: () => {} });
  const dataRoot = path.join(dir, 'data');
  return { dir, root, article, registry, dataRoot, target: resolveArticleTarget(registry, 'proj_notes') };
}

test('文章页：本篇、@root、@source 的活 HTML 帧不是孤儿；删掉的帧、移出 Canvas 的帧、别篇的路径是（D）', (t) => {
  const { article, registry, dataRoot, target } = withArticle(t);
  assert.ok(target, '文章是活页');
  const bucket = path.join(dataRoot, 'proj_notes');
  writeLedger(bucket, '@canvas.json', { page: '@canvas', path: '@canvas', annotations: [] });
  writeLedger(bucket, '@prose.json', { page: '@prose', path: '/proj/notes/', annotations: [] });
  writeLedger(bucket, 'live.html~1.json', { page: 'live.html~1', path: '/sites/proj_notes/live.html', annotations: [] });
  writeLedger(bucket, 'cat.html~2.json', { page: 'cat.html~2', path: '/sites/proj_notes/@root/shared/cat.html', annotations: [] });
  writeLedger(bucket, 'w.html~3.json', { page: 'w.html~3', path: '/sites/proj_notes/@source/kit/w.html', annotations: [] });
  // 帧文件删了（Canvas 里也没有它）：Codex F6 的复现形态。
  writeLedger(bucket, 'removed.html~4.json', { page: 'removed.html~4', path: '/sites/proj_notes/removed.html', annotations: [] });
  // 文件还在盘上、帧已经从 Canvas 移走：画布视图里没有这个文档条目了。
  writeLedger(bucket, 'dropped.html~5.json', { page: 'dropped.html~5', path: '/sites/proj_notes/dropped.html', annotations: [] });
  // 别篇文章的地址错放在本桶。
  writeLedger(bucket, 'x.html~6.json', { page: 'x.html~6', path: '/sites/proj_other/x.html', annotations: [] });
  const orphans = () => collectPageOrphans({ pageId: 'proj_notes', dataRoot, entries: registry.entries, article: target }).sort();
  assert.deepEqual(orphans(), ['dropped.html~5.json', 'removed.html~4.json', 'x.html~6.json']);

  // 活帧的源文件删了：这一帧在画布上是错误面板，它的账本跟着成孤儿。
  fs.rmSync(path.join(article, 'live.html'));
  assert.deepEqual(orphans(), ['dropped.html~5.json', 'live.html~1.json', 'removed.html~4.json', 'x.html~6.json']);

  // /registry 的计数口径同一张表（行数）。
  writeLedger(bucket, 'removed.html~4.json', { page: 'removed.html~4', path: '/sites/proj_notes/removed.html', annotations: [{ id: 'r1' }, { id: 'r2' }] });
  const counts = collectOrphanCounts({ entries: registry.entries, dataRoot, localIds: [], root: dataRoot, articleTargets: [target] });
  assert.equal(counts.proj_notes, 2);
});
