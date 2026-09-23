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
    { id: 'draft-b', kind: 'file', path: path.join(root, 'draft.html'), page: 'site-a' },
    { id: 'live-url', kind: 'url', url: 'https://live.localhost' },
  ];
  return { root, dataRoot, siteDir, previewsRoot, pageDir, entries };
}

function writeLedger(bucket, name, doc) {
  fs.mkdirSync(bucket, { recursive: true });
  fs.writeFileSync(path.join(bucket, name), JSON.stringify(doc));
}

test('pageSurfaceSpaces：自己 + 挂靠条目 + manifest 页各成一个 URL 空间', (t) => {
  const { root, previewsRoot, entries } = withFixture(t);
  const spaces = pageSurfaceSpaces({ pageId: 'site-a', entries, isManifestPage: false, previewsRoot });
  assert.deepEqual(spaces.map((s) => s.prefix).sort(), ['/sites/draft-b/', '/sites/site-a/']);
  const tpl = pageSurfaceSpaces({ pageId: 'tpl-page', entries, isManifestPage: true, previewsRoot });
  assert.deepEqual(tpl.map((s) => s.prefix), ['/previews/tpl-page/']);
  assert.equal(tpl[0].root, path.join(previewsRoot, 'tpl-page'));
  assert.equal(root.length > 0, true);
});

test('collectPageOrphans：文件没了 / url 移走是孤儿；@canvas、活文件、dist 屏不是', (t) => {
  const { dataRoot, siteDir, previewsRoot, entries } = withFixture(t);
  const bucket = path.join(dataRoot, 'site-a');
  writeLedger(bucket, '@canvas.json', { page: '@canvas', path: '@canvas', annotations: [] });
  writeLedger(bucket, 'doc~1.json', { page: 'doc~1', path: '/sites/site-a/doc.html', annotations: [] });
  writeLedger(bucket, 'gone~2.json', { page: 'gone~2', path: '/sites/site-a/gone.html', annotations: [] });
  // 挂靠条目的文档（宿主页桶里、/sites/<挂靠 id>/ 空间）。
  writeLedger(bucket, 'draft~3.json', { page: 'draft~3', path: '/sites/draft-b/draft.html', annotations: [] });
  // 没挂靠的 url 条目空间不存在于本页：错放，保守不判。
  writeLedger(bucket, 'stray~4.json', { page: 'stray~4', path: '/sites/live-url/app', annotations: [] });
  // 存量账本没有 path：表面未知，不判。
  writeLedger(bucket, 'legacy~5.json', { page: 'legacy~5', annotations: [] });
  fs.rmSync(path.join(siteDir, 'gone.html'));
  assert.deepEqual(collectPageOrphans({ pageId: 'site-a', dataRoot, entries, previewsRoot }), ['gone~2.json']);

  // url 条目从登记表移走：它自己的桶不再是任何页 —— 整桶孤儿走 CLI 的按桶
  // 判定（ppnt prune），不进 /registry 的按页计数；落在别的页桶里、指向该
  // url 空间的账本是错放不是表面消失，保守放过。
  const after = entries.filter((e) => e.id !== 'live-url');
  writeLedger(path.join(dataRoot, 'live-url'), 'url~6.json', { page: 'url~6', path: '/sites/live-url/app', annotations: [] });
  assert.deepEqual(
    collectPageOrphans({ pageId: 'site-a', dataRoot, entries: after, previewsRoot }).sort(),
    ['gone~2.json'],
  );
  assert.deepEqual(collectBucketOrphans('live-url', dataRoot), ['url~6.json']);
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

test('collectOrphanCounts：按已知页计数；collectBucketOrphans：未知页整桶皆孤儿', (t) => {
  const { root, dataRoot, previewsRoot, entries } = withFixture(t);
  const bucket = path.join(dataRoot, 'ghost-page');
  writeLedger(bucket, '@canvas.json', { page: '@canvas', path: '@canvas', annotations: [{ id: 'g1' }] });
  writeLedger(bucket, 'doc~1.json', { page: 'doc~1', path: '/sites/ghost-page/x.html', annotations: [] });
  const counts = collectOrphanCounts({ entries, dataRoot, localIds: ['tpl-page'], root });
  assert.deepEqual(counts, { 'tpl-page': 0, 'site-a': 0, 'live-url': 0 });
  assert.deepEqual(collectBucketOrphans('ghost-page', dataRoot).sort(), ['@canvas.json', 'doc~1.json']);
});

test('ledgerIsOrphan：目录 URL 回落 index.html；穿越路径是孤儿', (t) => {
  const { dataRoot, siteDir, previewsRoot, entries } = withFixture(t);
  fs.writeFileSync(path.join(siteDir, 'index.html'), '<!doctype html><p>home</p>');
  const spaces = pageSurfaceSpaces({ pageId: 'site-a', entries, previewsRoot });
  assert.equal(ledgerIsOrphan({ name: 'x.json', doc: { path: '/sites/site-a/' } }, spaces), false, 'index.html 在');
  assert.equal(ledgerIsOrphan({ name: 'x.json', doc: { path: '/sites/site-a/../../etc/passwd' } }, spaces), true);
});
