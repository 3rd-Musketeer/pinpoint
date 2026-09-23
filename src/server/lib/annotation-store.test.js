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

  assert.equal(store.save({ page: 'index.html', annotations: [] }).status, 400);
  assert.equal(store.save({ page: 'index.html', baseRevision: null, annotations: [] }).status, 400);

  const first = store.save({ page: 'index.html', baseRevision: 0, annotations: [{ n: 1 }] });
  assert.equal(first.status, 200);
  assert.equal(first.doc.revision, 1);
  assert.deepEqual(first.doc.annotations, [{ n: 1, status: 'open' }]);
  assert.equal(first.doc.marks, undefined);

  const stale = store.save({ page: 'index.html', baseRevision: 0, annotations: [{ n: 2 }] });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.doc.annotations, [{ n: 1, status: 'open' }]);
});

test('save atomically replaces the document without leaving temp files', (t) => {
  const { dataDir, store } = withStore(t);

  store.save({ page: 'index.html', baseRevision: 0, annotations: [{ n: 1 }] });
  // 两行都没带 id：M1 下无从比对存量，一律当新标注由服务端取号（2、3），
  // 客户端自带的 n 不被采纳。
  store.save({ page: 'index.html', baseRevision: 1, annotations: [{ n: 1 }, { n: 2 }] });

  const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.html.json'), 'utf8'));
  assert.ok(Array.isArray(disk.annotations));
  assert.equal(disk.marks, undefined);
  assert.deepEqual(store.readDoc('index.html').annotations, [{ n: 2, status: 'open' }, { n: 3, status: 'open' }]);
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
    annotations: [{ n: 1, images: [{ file: 'index.html-keep.png' }] }],
  });

  assert.equal(fs.existsSync(path.join(imagesDir, 'index.html-keep.png')), true);
  assert.equal(fs.existsSync(path.join(imagesDir, 'index.html-drop.png')), false);
  assert.equal(fs.existsSync(path.join(imagesDir, 'other-keep.png')), true);
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

test('#n（M1）：新标注一律服务端取号，客户端带的 n 忽略', (t) => {
  const { store } = withStore(t);

  // 同桶两个账本各存一条新标注，两条都自称 n:1（客户端 nextN 的视角看不到
  // 别的账本）：服务端各发 #1、#2，不认客户端的号。
  const a = store.save({ page: 'a.html', baseRevision: 0, annotations: [{ id: 'x1', n: 1, content: '甲' }] });
  assert.equal(a.status, 200);
  assert.deepEqual(a.doc.annotations.map((row) => row.n), [1]);
  const b = store.save({ page: 'b.html', baseRevision: 0, annotations: [{ id: 'y1', n: 1, content: '乙' }] });
  assert.equal(b.status, 200);
  assert.deepEqual(b.doc.annotations.map((row) => row.n), [2]);

  // 删掉 #1 再存新的：号接在桶级计数器后面（#3），已发过的号不复活。
  store.save({ page: 'a.html', baseRevision: 1, annotations: [] });
  const c = store.save({ page: 'a.html', baseRevision: 2, annotations: [{ id: 'x2', content: '丙' }] });
  assert.deepEqual(c.doc.annotations.map((row) => row.n), [3]);
});

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

test('#n（M3）：_seq.json 丢失后取号以桶内现有 max(n)+1 为地板', (t) => {
  const { dataDir, store } = withStore(t);

  // 两条标注 (#1,#2) → 删 _seq.json → 新标注得 #3，不回到 #1 撞存量。
  // （save 是整文档原子替换：加一行要带上存量行，同 id 沿用旧号。）
  store.save({ page: 'a.html', baseRevision: 0, annotations: [{ id: 'x1', content: '甲' }, { id: 'x2', content: '乙' }] });
  fs.rmSync(path.join(dataDir, '_seq.json'));
  const after = store.save({ page: 'a.html', baseRevision: 1, annotations: [
    { id: 'x1', content: '甲' }, { id: 'x2', content: '乙' }, { id: 'x3', content: '丙' },
  ] });
  assert.deepEqual(after.doc.annotations.map((row) => row.n), [1, 2, 3]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, '_seq.json'), 'utf8')).next, 4);

  // 损坏的 _seq.json 同样成立；地板跨账本生效（b.html 的新条接 #4）。
  fs.writeFileSync(path.join(dataDir, '_seq.json'), '{broken');
  const other = store.save({ page: 'b.html', baseRevision: 0, annotations: [{ id: 'y1', content: '丁' }] });
  assert.deepEqual(other.doc.annotations.map((row) => row.n), [4]);
});

test('#n：重存既有标注缺 n 时沿用旧号，永不重新取号（R3）', (t) => {
  const { dataDir, store } = withStore(t);

  store.save({ page: 'a.html', baseRevision: 0, annotations: [{ id: 'x1', content: '甲' }] });
  // 非工作台写入方（CLI / 直 POST /save 的 agent）同 id 不带 n：号必须沿用。
  const resave = store.save({ page: 'a.html', baseRevision: 1, annotations: [{ id: 'x1', content: '甲' }] });
  assert.equal(resave.status, 200);
  assert.deepEqual(resave.doc.annotations.map((a) => a.n), [1]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, '_seq.json'), 'utf8')).next, 2, '_seq 不被无谓烧号');
  // 新标注仍正常取号（1 已占用，落 2）。
  const next = store.save({ page: 'a.html', baseRevision: 2, annotations: [{ id: 'x1', content: '甲' }, { id: 'x2', content: '乙' }] });
  assert.deepEqual(next.doc.annotations.map((a) => a.n), [1, 2]);
});

test('listDocs 跳过 _seq.json：聚合视图不多出 _seq 空文档（R6）', (t) => {
  const { dataDir, store } = withStore(t);
  store.save({ page: 'a.html', baseRevision: 0, annotations: [{ id: 'x1', content: '甲' }] });
  assert.ok(fs.existsSync(path.join(dataDir, '_seq.json')), '取过号的桶里 _seq.json 存在');
  const docs = store.listDocs();
  assert.deepEqual(Object.keys(docs), ['a.html.json']);
});

/* ---- storage-unify：@canvas 账本名 / page_updated_at 停写 ---- */

test('@canvas 账本：文件名原样（不过 slug），doc.page 保持 @canvas', (t) => {
  const { dataDir, store } = withStore(t);
  const saved = store.save({ page: '@canvas', path: '@canvas', baseRevision: 0, annotations: [{ id: 'c1', content: '画布' }] });
  assert.equal(saved.status, 200);
  assert.equal(saved.doc.page, '@canvas');
  const file = path.join(dataDir, '@canvas.json');
  assert.ok(fs.existsSync(file), '文件名是 @canvas.json，不是 _canvas.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).page, '@canvas');
  const read = store.readDoc('@canvas');
  assert.deepEqual(read.annotations.map((a) => a.content), ['画布']);
  assert.equal(store.jsonPathFor('@canvas'), file);
});

test('图片路径不再 slug：@canvas 前缀的图片名按原样命中', (t) => {
  const { dataDir, store } = withStore(t);
  const image = store.writeImage('@canvas', 'png', Buffer.from('x'));
  assert.equal(image.file.slice(0, '@canvas-'.length), '@canvas-');
  assert.equal(store.imagePath(image.file), path.join(dataDir, 'images', image.file));
});

test('page_updated_at 停写：保存与状态写入只透传存量映射，不新增条目', (t) => {
  const { dataDir, store } = withStore(t);
  // page key 'index.html~1b' 的账本文件名是 slug 后的 index.html_1b.json。
  const legacy = {
    page: 'index.html~1b', path: '/index.html', revision: 2,
    page_updated_at: { 'old-page': 111 },
    annotations: [{ id: 'a1', n: 1, pageId: 'old-page', status: 'open', content: '存量' }],
  };
  fs.writeFileSync(path.join(dataDir, 'index.html_1b.json'), JSON.stringify(legacy));
  const saved = store.save({ page: 'index.html~1b', baseRevision: 2, path: '/index.html', annotations: [...legacy.annotations, { id: 'a2', content: '新' }] });
  assert.equal(saved.status, 200);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.html_1b.json'), 'utf8'));
  assert.deepEqual(onDisk.page_updated_at, { 'old-page': 111 }, '映射原样保留');
  const marked = store.setStatus({ page: 'index.html~1b', baseRevision: 3, id: 'a2', status: 'check' });
  assert.equal(marked.status, 200);
  const after = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.html_1b.json'), 'utf8'));
  assert.deepEqual(after.page_updated_at, { 'old-page': 111 }, '状态写入也不动映射');
  // 全新账本从零保存：没有映射就一个也不写。
  store.save({ page: 'fresh.html', baseRevision: 0, annotations: [{ id: 'f1', content: '新账本' }] });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'fresh.html.json'), 'utf8')).page_updated_at, undefined);
});

test('R14：/save 无编辑的 → open 拒绝；编辑回 open 与 close 撤销照常放行', (t) => {
  const { store } = withStore(t);
  // open → check（经 mark 端点），再拿 /save 原样重存但把状态写回 open：409。
  store.save({ page: 'a.html', baseRevision: 0, annotations: [{ id: 'x1', content: '甲' }] });
  store.setStatus({ page: 'a.html', baseRevision: 1, id: 'x1', status: 'check' });
  const demote = store.save({ page: 'a.html', baseRevision: 2, annotations: [{ id: 'x1', content: '甲', status: 'open' }] });
  assert.equal(demote.status, 409);
  assert.equal(demote.error, 'illegal_transition');
  // 编辑正文（内容变了）→ 服务端强制回 open，放行。
  const edited = store.save({ page: 'a.html', baseRevision: 2, annotations: [{ id: 'x1', content: '乙' }] });
  assert.equal(edited.status, 200);
  assert.equal(edited.doc.annotations[0].status, 'open');
  // done → close（工作台）后，/save 无编辑撤回 open：放行（close 撤销路径）。
  store.setStatus({ page: 'a.html', baseRevision: 3, id: 'x1', status: 'done' });
  const closed = store.save({ page: 'a.html', baseRevision: 4, annotations: [{ id: 'x1', content: '乙', status: 'close' }] });
  assert.equal(closed.status, 200);
  const reverted = store.save({ page: 'a.html', baseRevision: 5, annotations: [{ id: 'x1', content: '乙', status: 'open' }] });
  assert.equal(reverted.status, 200);
  assert.equal(reverted.doc.annotations[0].status, 'open');
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
