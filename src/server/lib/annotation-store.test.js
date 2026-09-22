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
  assert.deepEqual(first.doc.annotations, [{ n: 1, status: 'open' }]);
  assert.equal(first.doc.marks, undefined);

  const stale = store.save({ page: 'index.html', baseRevision: 0, marks: [{ n: 2 }] });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.doc.annotations, [{ n: 1, status: 'open' }]);
});

test('save atomically replaces the document without leaving temp files', (t) => {
  const { dataDir, store } = withStore(t);

  store.save({ page: 'index.html', baseRevision: 0, marks: [{ n: 1 }] });
  store.save({ page: 'index.html', baseRevision: 1, annotations: [{ n: 1 }, { n: 2 }] });

  const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.html.json'), 'utf8'));
  assert.ok(Array.isArray(disk.annotations));
  assert.equal(disk.marks, undefined);
  assert.deepEqual(store.readDoc('index.html').annotations, [{ n: 1, status: 'open' }, { n: 2, status: 'open' }]);
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

/* ---- pp2 状态机：#n 取号 / 转换校验 / setStatus ---- */

test('#n：缺号标注按创建顺序补号，跨账本唯一，删过的号不复用', (t) => {
  const { dataDir, store } = withStore(t);

  const first = store.save({ page: 'a.html', baseRevision: 0, annotations: [{ id: 'x1', content: '甲' }, { id: 'x2', content: '乙' }] });
  assert.equal(first.status, 200);
  assert.deepEqual(first.doc.annotations.map((a) => a.n), [1, 2]);

  // 另一个账本共享同一个桶的计数器（跨账本唯一）。
  const second = store.save({ page: 'b.html', baseRevision: 0, annotations: [{ id: 'y1', content: '丙' }] });
  assert.deepEqual(second.doc.annotations.map((a) => a.n), [3]);

  // 删掉 #2 再写：下一个号仍是 4，不复用。
  store.save({ page: 'a.html', baseRevision: 1, annotations: [{ id: 'x1', n: 1, content: '甲' }] });
  const third = store.save({ page: 'a.html', baseRevision: 2, annotations: [{ id: 'x1', n: 1, content: '甲' }, { id: 'x3', content: '丁' }] });
  assert.deepEqual(third.doc.annotations.map((a) => a.n), [1, 4]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, '_seq.json'), 'utf8')).next, 5);

  // 旧账本（没有 n）首次读到时补号并写回。
  fs.writeFileSync(path.join(dataDir, 'old.html.json'), JSON.stringify({
    page: 'old.html', path: '/old.html', revision: 1,
    annotations: [{ id: 'o1', content: '旧一' }, { id: 'o2', content: '旧二' }],
  }));
  const old = store.readDoc('old.html');
  assert.deepEqual(old.annotations.map((a) => a.n), [5, 6]);
  const rewritten = JSON.parse(fs.readFileSync(path.join(dataDir, 'old.html.json'), 'utf8'));
  assert.deepEqual(rewritten.annotations.map((a) => a.n), [5, 6]);
  assert.equal(rewritten.revision, 1, '补号不动 revision');
});

test('/save 转换校验：非法转换 409，编辑回 open，新标注恒 open', (t) => {
  const { store } = withStore(t);
  store.save({ page: 'index.html', baseRevision: 0, annotations: [{ id: 'a1', content: '一' }] });
  const open1 = store.readDoc('index.html');
  assert.equal(open1.annotations[0].status, 'open');

  // open → check / done 经 /save 非法。
  assert.equal(store.save({ page: 'index.html', baseRevision: 1, annotations: [{ id: 'a1', n: 1, content: '一', status: 'check' }] }).status, 409);
  assert.equal(store.save({ page: 'index.html', baseRevision: 1, annotations: [{ id: 'a1', n: 1, content: '一', status: 'done' }] }).status, 409);

  // 先经 setStatus 到 done，再 /save 做 done → close（合法）。
  const marked = store.setStatus({ page: 'index.html', id: 1, status: 'done', baseRevision: 1 });
  assert.equal(marked.status, 200);
  const closed = store.save({ page: 'index.html', baseRevision: 2, annotations: [{ id: 'a1', n: 1, content: '一', status: 'close' }] });
  assert.equal(closed.status, 200);
  assert.equal(closed.doc.annotations[0].status, 'close');

  // owner 编辑正文 → 自动回 open（客户端说 close 也不算）。
  const edited = store.save({ page: 'index.html', baseRevision: 3, annotations: [{ id: 'a1', n: 1, content: '一改', status: 'close' }] });
  assert.equal(edited.status, 200);
  assert.equal(edited.doc.annotations[0].status, 'open');

  // 新标注恒 open。
  const fresh = store.save({ page: 'index.html', baseRevision: 4, annotations: [{ id: 'a1', n: 1, content: '一改' }, { id: 'a2', content: '二', status: 'done' }] });
  assert.equal(fresh.doc.annotations[1].status, 'open');
});

test('setStatus：open/check → check/done 带 note；其余一律拒', (t) => {
  const { store } = withStore(t);
  store.save({ page: 'index.html', baseRevision: 0, annotations: [{ id: 'a1', content: '一' }] });

  const checked = store.setStatus({ page: 'index.html', id: 1, status: 'check', note: '看过，不改', baseRevision: 1 });
  assert.equal(checked.status, 200);
  assert.equal(checked.annotation.status, 'check');
  assert.equal(checked.annotation.note, '看过，不改');
  assert.equal(checked.doc.revision, 2);

  const done = store.setStatus({ page: 'index.html', id: 'a1', status: 'done', baseRevision: 2 });
  assert.equal(done.status, 200);
  assert.equal(done.annotation.status, 'done');

  assert.equal(store.setStatus({ page: 'index.html', id: 1, status: 'done', baseRevision: 3 }).status, 409, 'done → done 非法');
  assert.equal(store.setStatus({ page: 'index.html', id: 1, status: 'open', baseRevision: 3 }).status, 400, '端点只写 check/done');
  assert.equal(store.setStatus({ page: 'index.html', id: 99, status: 'check', baseRevision: 3 }).status, 404);
  assert.equal(store.setStatus({ page: 'index.html', id: 1, status: 'check', baseRevision: 1 }).status, 409, 'baseRevision 过期');
});
