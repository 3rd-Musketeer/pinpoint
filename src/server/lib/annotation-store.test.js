import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAnnotationStore } from './annotation-store.js';

function withStore(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-store-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return {
    dataDir,
    store: createAnnotationStore({
      dataDir,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    }),
  };
}

test('save requires a valid base revision and rejects stale writers', (t) => {
  const { store } = withStore(t);

  assert.equal(store.save({ page: 'index.html', marks: [] }).status, 400);
  assert.equal(store.save({ page: 'index.html', baseRevision: null, marks: [] }).status, 400);

  const first = store.save({ page: 'index.html', baseRevision: 0, marks: [{ n: 1 }] });
  assert.equal(first.status, 200);
  assert.equal(first.doc.revision, 1);
  assert.deepEqual(first.doc.annotations, [{ n: 1 }]);
  assert.equal(first.doc.marks, undefined);

  const stale = store.save({ page: 'index.html', baseRevision: 0, marks: [{ n: 2 }] });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.doc.annotations, [{ n: 1 }]);
});

test('save atomically replaces the document without leaving temp files', (t) => {
  const { dataDir, store } = withStore(t);

  store.save({ page: 'index.html', baseRevision: 0, marks: [{ n: 1 }] });
  store.save({ page: 'index.html', baseRevision: 1, annotations: [{ n: 1 }, { n: 2 }] });

  const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.html.json'), 'utf8'));
  assert.ok(Array.isArray(disk.annotations));
  assert.equal(disk.marks, undefined);
  assert.deepEqual(store.readDoc('index.html').annotations, [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(fs.readdirSync(dataDir).filter((name) => name.includes('.tmp-')), []);
});

test('save removes only unreferenced images owned by the page', (t) => {
  const { dataDir, store } = withStore(t);
  const imagesDir = path.join(dataDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(imagesDir, 'index.html-keep.png'), 'keep');
  fs.writeFileSync(path.join(imagesDir, 'index.html-drop.png'), 'drop');
  fs.writeFileSync(path.join(imagesDir, 'other-keep.png'), 'other');

  store.save({
    page: 'index.html',
    baseRevision: 0,
    marks: [{ n: 1, images: [{ file: 'index.html-keep.png' }] }],
  });

  assert.equal(fs.existsSync(path.join(imagesDir, 'index.html-keep.png')), true);
  assert.equal(fs.existsSync(path.join(imagesDir, 'index.html-drop.png')), false);
  assert.equal(fs.existsSync(path.join(imagesDir, 'other-keep.png')), true);
});

test('readDoc upgrades legacy marks/comment/group on disk', (t) => {
  const { dataDir, store } = withStore(t);
  fs.writeFileSync(path.join(dataDir, 'index.html.json'), JSON.stringify({
    page: 'index.html',
    revision: 2,
    marks: [{
      n: 1,
      id: 'ab12cd',
      comment: 'see [@m:zz99aa]',
      group: 'inbox',
      groupLabel: 'Inbox',
      reply: { content: '旧处理说明', author: 'agent' },
    }],
  }));

  const doc = store.readDoc('index.html');
  assert.equal(doc.revision, 2);
  assert.equal(doc.annotations[0].content, 'see [@a:zz99aa]');
  assert.equal(doc.annotations[0].section, 'inbox');
  assert.equal(doc.annotations[0].sectionLabel, 'Inbox');
  assert.equal(doc.annotations[0].comment, undefined);
  assert.equal(doc.annotations[0].reply, undefined);

  const saved = store.save({
    page: 'index.html',
    baseRevision: 2,
    annotations: doc.annotations,
  });
  assert.equal(saved.status, 200);
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.html.json'), 'utf8'));
  assert.equal(raw.marks, undefined);
  assert.equal(raw.annotations[0].content, 'see [@a:zz99aa]');
  assert.equal(raw.annotations[0].section, 'inbox');
  assert.equal(raw.annotations[0].reply, undefined);
});

test('read and save preserve stable target refs and first-target compatibility aliases', (t) => {
  const { dataDir, store } = withStore(t);
  fs.writeFileSync(path.join(dataDir, 'index.html.json'), JSON.stringify({
    page: 'index.html',
    revision: 4,
    annotations: [{
      n: 1,
      type: 'element',
      selector: '#legacy',
      text: 'Legacy',
      targets: [
        { selector: '#first', text: 'First' },
        { selector: '#second', text: 'Second' },
      ],
      content: '把 [@t:i2] 对齐到 [@a:ab12cd]',
      mentions: ['ab12cd'],
    }],
  }));

  const doc = store.readDoc('index.html');
  assert.deepEqual(doc.annotations[0].targets, [
    { ref: 'i1', selector: '#first', text: 'First' },
    { ref: 'i2', selector: '#second', text: 'Second' },
  ]);
  assert.equal(doc.annotations[0].selector, '#first');
  assert.equal(doc.annotations[0].text, 'First');
  assert.equal(doc.annotations[0].content, '把 [@t:i2] 对齐到 [@a:ab12cd]');
  assert.deepEqual(doc.annotations[0].mentions, ['ab12cd']);

  const saved = store.save({ page: 'index.html', baseRevision: 4, annotations: doc.annotations });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.doc.annotations[0].targets, doc.annotations[0].targets);
});
