import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { annotationPageTimes, collectPageTimes } from './page-times.js';
import { createAnnotationStore } from './annotation-store.js';
import { addRegistryEntry, updateRegistryEntry } from './registry-store.js';
import { loadRegistry } from './registry.js';
import { activityRows, sortPages } from '../../workbench/lib/page-sort.js';

test('bucket = page: the ledger\'s updated_at is the page time; saves move it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-times-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let at = 1000;
  const store = createAnnotationStore({ dataDir: dir, now: () => new Date(at) });
  store.save({ page: '@canvas', baseRevision: 0, annotations: [{ id: 'a', content: 'one' }] });
  assert.deepEqual(annotationPageTimes(dir, 'demo-page'), { 'demo-page': 1000 });
  at = 2000;
  store.save({ page: 'doc~x', baseRevision: 0, annotations: [{ id: 'b', content: 'two' }] });
  assert.deepEqual(annotationPageTimes(dir, 'demo-page'), { 'demo-page': 2000 }, '桶内取最近一次保存');
});

test('bucket = page: renamed bucket and mixed host+attach bucket both get annotatedAt (K3)', (t) => {
  // rename 后：行上 pageId 还是旧 id，桶已改名 —— 时间记给桶，页时间不断档；
  // 旧 id 不再造时间。
  const renamed = fs.mkdtempSync(path.join(os.tmpdir(), 'page-times-renamed-'));
  t.after(() => fs.rmSync(renamed, { recursive: true, force: true }));
  fs.writeFileSync(path.join(renamed, '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 1, updated_at: '2026-03-01T00:00:00.000Z',
    annotations: [{ id: 'r1', n: 1, pageId: 'old-page', status: 'open', content: 'rename 前的行' }],
  }));
  assert.deepEqual(annotationPageTimes(renamed, 'fresh-page'), { 'fresh-page': Date.parse('2026-03-01T00:00:00.000Z') });

  // 宿主 + 挂靠混合桶：两种 pageId 的行同住一个桶，宿主页拿得到时间。
  const mixed = fs.mkdtempSync(path.join(os.tmpdir(), 'page-times-mixed-'));
  t.after(() => fs.rmSync(mixed, { recursive: true, force: true }));
  fs.writeFileSync(path.join(mixed, '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 2, updated_at: '2026-03-02T00:00:00.000Z',
    annotations: [{ id: 'h1', n: 1, pageId: 'host', status: 'open', content: '宿主行' }],
  }));
  fs.writeFileSync(path.join(mixed, 'doc~1.json'), JSON.stringify({
    page: 'doc~1', path: '/sites/attach-x/doc.html', revision: 1, updated_at: '2026-03-03T00:00:00.000Z',
    annotations: [{ id: 'a1', n: 2, pageId: 'attach-x', status: 'open', content: '挂靠条目的文档行' }],
  }));
  assert.deepEqual(annotationPageTimes(mixed, 'host'), { host: Date.parse('2026-03-03T00:00:00.000Z') }, '桶内取最近一次保存');
});

test('legacy ledgers: page_updated_at mappings and single-pageId rows still count', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-times-legacy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // 旧画布账本（多页混合 + 逐页映射）：映射照读。
  fs.writeFileSync(path.join(dir, 'index~z.json'), JSON.stringify({
    page: 'index~z', path: '/index.html', revision: 1, updated_at: '2026-01-02T00:00:00.000Z',
    page_updated_at: { 'page-a': 100, 'page-b': 200 },
    annotations: [],
  }));
  // 单页行（无映射）：updated_at 记给那个页。
  fs.writeFileSync(path.join(dir, 'index~1b.json'), JSON.stringify({
    page: 'index~1b', path: '/', revision: 1, updated_at: '2026-01-03T00:00:00.000Z',
    annotations: [{ id: 'r1', pageId: 'page-a', content: '行' }],
  }));
  // 多页混合且无映射：归因不了，不造时间。
  fs.writeFileSync(path.join(dir, 'mix.json'), JSON.stringify({
    page: 'mix', revision: 1, updated_at: '2026-01-04T00:00:00.000Z',
    annotations: [{ id: 'm1', pageId: 'page-a' }, { id: 'm2', pageId: 'page-b' }],
  }));
  assert.deepEqual(annotationPageTimes(dir, null), {
    'page-a': Date.parse('2026-01-03T00:00:00.000Z'),
    'page-b': 200,
  });
});

test('collectPageTimes: page buckets + legacy pinpoint mappings + attached fold', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'page-times-collect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, 'data');
  // 页桶（新模型）。
  fs.mkdirSync(path.join(dataRoot, 'site-a'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'site-a', 'doc~1.json'), JSON.stringify({
    page: 'doc~1', revision: 1, updated_at: '2026-02-01T00:00:00.000Z', annotations: [{ id: 'd1', content: 'x' }],
  }));
  // 存量 pinpoint 桶：page_updated_at 映射喂模板页。
  fs.mkdirSync(path.join(dataRoot, 'pinpoint'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'pinpoint', 'index~z.json'), JSON.stringify({
    page: 'index~z', revision: 1, updated_at: '2026-02-02T00:00:00.000Z',
    page_updated_at: { 'template-p': 500 }, annotations: [],
  }));
  // 挂靠条目的旧桶：并进宿主页。
  fs.mkdirSync(path.join(dataRoot, 'attach-draft'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'attach-draft', 'draft~1.json'), JSON.stringify({
    page: 'draft~1', revision: 1, updated_at: '2026-02-03T00:00:00.000Z', annotations: [{ id: 'a1', content: 'x' }],
  }));
  const entries = [
    { id: 'pinpoint', kind: 'dir', path: root },
    { id: 'site-a', kind: 'dir', path: path.join(root, 'site-a') },
    { id: 'attach-draft', kind: 'file', path: path.join(root, 'd.html'), page: 'site-a' },
  ];
  const times = collectPageTimes({ entries, root, dataRoot, localIds: ['template-p'] });
  assert.equal(times['site-a'].annotatedAt, Date.parse('2026-02-03T00:00:00.000Z'), '宿主页取自己桶与挂靠旧桶的最大值');
  assert.equal(times['template-p'].annotatedAt, 500, '存量映射照读');
});

test('new registration records addition once and move preserves it; legacy is unknown', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'page-added-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'registry.json');
  const start = Date.now();
  const entry = addRegistryEntry(file, { id: 'site', kind: 'url', url: 'https://example.com' });
  assert.ok(entry.addedAt >= start);
  const moved = updateRegistryEntry(file, { id: entry.id, kind: 'url', url: 'https://example.org' });
  assert.equal(moved.addedAt, entry.addedAt);
  const r = loadRegistry({ root: dir, path: file, log: () => {} });
  assert.equal(r.entries[0].addedAt, entry.addedAt);
});

test('recent uses latest of three times and time sorts keep unknown at the bottom', () => {
  const pages = [{ id: 'a', addedAt: 300 }, { id: 'b', mtime: 200 }, { id: 'c', annotatedAt: 400 }, { id: 'unknown' }];
  assert.deepEqual(activityRows(pages).map(r => r.page.id), ['c', 'a', 'b']);
  assert.equal(sortPages(pages, 'added')[0].id, 'a');
  assert.equal(sortPages(pages, 'updated')[0].id, 'b');
  assert.equal(sortPages(pages, 'annotated')[0].id, 'c');
});
