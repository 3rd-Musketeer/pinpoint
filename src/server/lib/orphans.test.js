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

