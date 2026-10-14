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

test('离开页面的快照（after = 在途那次的 saveId）：在途那次先到还是后到，盘上都是快照', (t) => {
  const { store } = withStore(t);
  const page = 'index.html';
  const row = (content) => [{ id: 'a1', content }];
  assert.equal(store.save({ page, baseRevision: 0, saveId: 's0', annotations: row('一稿') }).status, 200);

  // 在途那次（s1，以 rev 1 为底）先到，快照（以 rev 1 为底、接在 s1 之后）后到：接上。
  assert.equal(store.save({ page, baseRevision: 1, saveId: 's1', annotations: row('二稿') }).status, 200);
  const after = store.save({ page, baseRevision: 1, saveId: 's2', after: 's1', annotations: row('三稿') });
  assert.equal(after.status, 200);
  assert.equal(after.doc.revision, 3);
  assert.equal(store.readDoc(page).annotations[0].content, '三稿');

  // 反过来：快照先到按 baseRevision 落盘，在途那次随后 409。
  const snapshot = store.save({ page, baseRevision: 3, saveId: 's4', after: 's3', annotations: row('五稿') });
  assert.equal(snapshot.status, 200);
  assert.equal(store.save({ page, baseRevision: 3, saveId: 's3', annotations: row('四稿') }).status, 409);
  assert.equal(store.readDoc(page).annotations[0].content, '五稿');

  // 盘上那一版不是 after 写的（别的窗口），或者差了不止一版：照旧 409。
  assert.equal(store.save({ page, baseRevision: 5, saveId: 'w', annotations: row('别的窗口') }).status, 409);
  assert.equal(store.save({ page, baseRevision: 4, saveId: 'w', annotations: row('别的窗口') }).status, 200);
  assert.equal(store.save({ page, baseRevision: 4, after: 's4', annotations: row('晚到的快照') }).status, 409);
  assert.equal(store.save({ page, baseRevision: 3, after: 'w', annotations: row('差两版') }).status, 409);
  // 不带 saveId 的写（CLI、agent 直 POST）之后，谁也接不上它。
  assert.equal(store.save({ page, baseRevision: 5, annotations: row('CLI') }).status, 200);
  assert.equal(store.save({ page, baseRevision: 5, after: 'w', annotations: row('x') }).status, 409);
  assert.equal(store.readDoc(page).annotations[0].content, 'CLI');
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

/* ---- storage-unify：@canvas 账本名 / 账本只有现行键 ---- */

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

test('账本只写现行键：保存与状态写入都不出 page_updated_at（页时间取 updated_at）', (t) => {
  const { dataDir, store } = withStore(t);
  const file = path.join(dataDir, 'fresh.html.json');
  store.save({ page: 'fresh.html', baseRevision: 0, annotations: [{ id: 'f1', content: '新账本' }] });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).sort(), ['annotations', 'page', 'path', 'revision', 'updated_at']);
  const marked = store.setStatus({ page: 'fresh.html', baseRevision: 1, id: 'f1', status: 'check' });
  assert.equal(marked.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).page_updated_at, undefined);
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

test('setStatus：open/check → check/done；传 note 不落盘；其余一律拒', (t) => {
  const { store } = withStore(t);
  store.save({ page: 'index.html', baseRevision: 0, annotations: [{ id: 'a1', content: '一' }] });

  const checked = store.setStatus({ page: 'index.html', id: 1, status: 'check', note: '看过，不改', baseRevision: 1 });
  assert.equal(checked.status, 200);
  assert.equal(checked.annotation.status, 'check');
  assert.equal(Object.hasOwn(checked.annotation, 'note'), false, 'note 机制已关，请求里带了也不写');
  assert.equal(checked.doc.revision, 2);

  const done = store.setStatus({ page: 'index.html', id: 'a1', status: 'done', baseRevision: 2 });
  assert.equal(done.status, 200);
  assert.equal(done.annotation.status, 'done');

  assert.equal(store.setStatus({ page: 'index.html', id: 1, status: 'done', baseRevision: 3 }).status, 409, 'done → done 非法');
  assert.equal(store.setStatus({ page: 'index.html', id: 1, status: 'open', baseRevision: 3 }).status, 400, '端点只写 check/done');
  assert.equal(store.setStatus({ page: 'index.html', id: 1, status: 'close', baseRevision: 3 }).status, 400, 'close 仍只归工作台');
  assert.equal(store.setStatus({ page: 'index.html', id: 99, status: 'check', baseRevision: 3 }).status, 404);
  assert.equal(store.setStatus({ page: 'index.html', id: 1, status: 'check', baseRevision: 1 }).status, 409, 'baseRevision 过期');
});

test('owner 关闭：open / check / done 三态经 /save 入 close，撤销回关闭前的原态', (t) => {
  const { store } = withStore(t);
  // 三种来源状态各占一页，互不纠缠：check / done 先经 mark 端点升档。
  for (const [page, wanted] of [['o.html', 'open'], ['c.html', 'check'], ['d.html', 'done']]) {
    store.save({ page, baseRevision: 0, annotations: [{ id: 'x1', content: '甲' }] });
    if (wanted === 'check' || wanted === 'done') {
      assert.equal(store.setStatus({ page, baseRevision: 1, id: 'x1', status: 'check' }).status, 200);
    }
    if (wanted === 'done') {
      assert.equal(store.setStatus({ page, baseRevision: 2, id: 'x1', status: 'done' }).status, 200);
    }
    const rev = store.readDoc(page).revision;
    const closed = store.save({ page, baseRevision: rev, annotations: [{ id: 'x1', content: '甲', status: 'close' }] });
    assert.equal(closed.status, 200, `${wanted} → close 放行`);
    assert.equal(closed.doc.annotations[0].status, 'close');
    const undone = store.save({
      page,
      baseRevision: closed.doc.revision,
      annotations: [{ id: 'x1', content: '甲', status: wanted }],
    });
    assert.equal(undone.status, 200, `close 撤销回 ${wanted} 放行`);
    assert.equal(undone.doc.annotations[0].status, wanted);
  }
});

test('@prose 账本（pp3）：文件名原样；与 @canvas 同桶共用 #n', (t) => {
  const { dataDir, store } = withStore(t);
  store.save({ page: '@canvas', baseRevision: 0, annotations: [{ id: 'c1', content: '画布' }] });
  const saved = store.save({
    page: '@prose',
    path: '/demo/intro/',
    baseRevision: 0,
    annotations: [{ id: 'p1', type: 'prose', content: '这句改短', section: 'why', quote: { exact: '扣给谁', prefix: '什么时候会被扣、', suffix: '，并且' }, messages: [] }],
  });
  assert.equal(saved.status, 200);
  assert.ok(fs.existsSync(path.join(dataDir, '@prose.json')));
  assert.equal(saved.doc.page, '@prose');
  assert.equal(saved.doc.annotations[0].n, 2, '#n 按桶单调：画布 #1 之后是 #2');
  assert.deepEqual(saved.doc.annotations[0].quote, { exact: '扣给谁', prefix: '什么时候会被扣、', suffix: '，并且' });
});

test('appendMessage：agent 回复追加到线程末尾，状态不动；只认正文评论', (t) => {
  const { store } = withStore(t);
  store.save({ page: '@prose', baseRevision: 0, annotations: [{ id: 'p1', type: 'prose', content: '这句改短', messages: [] }] });
  store.setStatus({ page: '@prose', id: 1, status: 'check', baseRevision: 1 });

  assert.equal(store.appendMessage({ page: '@prose', id: 1, text: 'x' }).status, 400, '要 baseRevision');
  assert.equal(store.appendMessage({ page: '@prose', id: 1, text: 'x', baseRevision: 1 }).status, 409, 'revision 过期');
  assert.equal(store.appendMessage({ page: '@prose', id: 1, text: '  ', baseRevision: 2 }).error, 'empty_message');
  assert.equal(store.appendMessage({ page: '@prose', id: 9, text: 'x', baseRevision: 2 }).status, 404);
  assert.equal(store.appendMessage({ page: '@prose', id: 1, text: 'x', who: 'bot', baseRevision: 2 }).error, 'invalid_author');

  const ok = store.appendMessage({ page: '@prose', id: 1, text: ' 改了，见 B4 ', baseRevision: 2 });
  assert.equal(ok.status, 200);
  assert.equal(ok.doc.revision, 3);
  assert.deepEqual(ok.annotation.messages, [{ who: 'agent', text: '改了，见 B4', at: '2026-07-10T00:00:00.000Z' }]);
  assert.equal(ok.annotation.status, 'check', '回复不改状态');

  // 画布标注、文档页标注也有线程：agent 改完在这里说明改了什么。
  store.save({ page: '@canvas', baseRevision: 0, annotations: [{ id: 'c1', content: '画布', status: 'open' }] });
  const canvas = store.appendMessage({ page: '@canvas', id: 'c1', text: '标题改成了冲煮日志', baseRevision: 1 });
  assert.equal(canvas.status, 200);
  assert.deepEqual(canvas.annotation.messages.map((m) => [m.who, m.text]), [['agent', '标题改成了冲煮日志']]);
  store.save({ page: 'docs-guide', baseRevision: 0, annotations: [{ id: 'd1', type: 'element', selector: 'h1', text: '指南', content: '标题太长' }] });
  assert.equal(store.appendMessage({ page: 'docs-guide', id: 'd1', text: '缩成了四个字', baseRevision: 1 }).status, 200);
});

test('/save 留住 agent 的回复：客户端快照比盘上旧、少了回复时照留，不算编辑', (t) => {
  const { store } = withStore(t);
  const row = { id: 'd1', type: 'element', selector: 'h1', text: '指南', content: '标题太长', status: 'open' };
  store.save({ page: 'docs-guide', baseRevision: 0, annotations: [row] });
  store.setStatus({ page: 'docs-guide', id: 'd1', status: 'check', baseRevision: 1 });
  store.appendMessage({ page: 'docs-guide', id: 'd1', text: '缩成了四个字', baseRevision: 2 });
  // 工作台拿的是回复之前的快照（没有 messages），改了个无关字段后整份存回来。
  const saved = store.save({ page: 'docs-guide', baseRevision: 3, annotations: [{ ...row, status: 'check', lastRect: { x: 1 } }] });
  assert.equal(saved.status, 200);
  const after = saved.doc.annotations[0];
  assert.deepEqual(after.messages.map((m) => [m.who, m.text]), [['agent', '缩成了四个字']]);
  assert.equal(after.status, 'check', '补回 agent 的回复不算 owner 编辑');
});

test('/save 正文评论：owner 回复或改引文回 open；agent 消息原样回存不算编辑', (t) => {
  const { store } = withStore(t);
  const base = { id: 'p1', type: 'prose', content: '这句改短', quote: { exact: '扣给谁' }, messages: [] };
  store.save({ page: '@prose', baseRevision: 0, annotations: [base] });
  store.setStatus({ page: '@prose', id: 1, status: 'done', baseRevision: 1 });
  const replied = store.appendMessage({ page: '@prose', id: 1, text: '改好了', baseRevision: 2 }).annotation;

  // 客户端把带 agent 消息的行原样存回（比如同一页上另一条评论被改了）：不算编辑，done 保持。
  const same = store.save({ page: '@prose', baseRevision: 3, annotations: [replied] });
  assert.equal(same.status, 200);
  assert.equal(same.doc.annotations[0].status, 'done');

  // owner 在线程里回一句：回 open。
  const ownerReply = { ...replied, messages: [...replied.messages, { who: 'owner', text: '还不够短', at: '2026-07-10T00:01:00.000Z' }] };
  const reopened = store.save({ page: '@prose', baseRevision: 4, annotations: [ownerReply] });
  assert.equal(reopened.doc.annotations[0].status, 'open');
});

// 桶在写的途中没了（ppnt remove / prune 删桶，ppnt rename 挪桶，和一次保存撞上）：
// 在 rename 那一刻真的删 / 挪目录，看存储层自己怎么收场。
function renameHook(t, before) {
  const original = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(from).includes('.json.tmp-')) before(from, to);
    return original(from, to);
  });
}

test('桶在保存途中被删：回 503 bucket_gone，不抛、不留临时文件、不留半份账本', (t) => {
  const { dataDir, store } = withStore(t);
  assert.equal(store.save({ page: '@canvas', baseRevision: 0, annotations: [{ content: 'a' }] }).status, 200);

  renameHook(t, () => fs.rmSync(dataDir, { recursive: true, force: true }));
  const gone = store.save({ page: '@canvas', baseRevision: 1, annotations: [{ content: 'a' }, { content: 'b' }] });
  assert.equal(gone.status, 503);
  assert.equal(gone.error, 'bucket_gone');
  assert.match(gone.detail, /在写入途中被删除或移走/);
  assert.equal(gone.doc.revision, 0);
  // 删桶赢了：目录没被这次保存重新建出来，也就没有临时文件或半份账本留下。
  assert.equal(fs.existsSync(dataDir), false);

  // 之后的保存照常建桶（和删桶之后才到的保存一样）。
  t.mock.restoreAll();
  const again = store.save({ page: '@canvas', baseRevision: 0, annotations: [{ content: 'c' }] });
  assert.equal(again.status, 200);
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ['@canvas.json', '_seq.json']);
});

test('桶在状态写入途中被挪走：旧账本原样随桶搬走，临时文件在下次写这个桶时清掉', (t) => {
  const { dataDir, store } = withStore(t);
  const saved = store.save({ page: '@canvas', baseRevision: 0, annotations: [{ id: 'x', content: 'a' }] });
  assert.equal(saved.status, 200);
  const before = fs.readFileSync(path.join(dataDir, '@canvas.json'), 'utf8');
  const moved = `${dataDir}-moved`;
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));

  renameHook(t, () => fs.renameSync(dataDir, moved));
  const gone = store.setStatus({ page: '@canvas', baseRevision: 1, id: 'x', status: 'check' });
  assert.equal(gone.status, 503);
  assert.equal(gone.error, 'bucket_gone');
  t.mock.restoreAll();

  // 搬走的账本是整份旧版本，不是半份新版本。
  assert.equal(fs.readFileSync(path.join(moved, '@canvas.json'), 'utf8'), before);
  // 临时文件跟着桶搬了过去（旧路径上删不到）；新名下的下一次写把它清掉。
  assert.equal(fs.readdirSync(moved).filter((name) => name.includes('.tmp-')).length, 1);
  const movedStore = createAnnotationStore({ dataDir: moved, now: () => new Date('2026-07-10T00:00:00.000Z') });
  assert.equal(movedStore.setStatus({ page: '@canvas', baseRevision: 1, id: 'x', status: 'check' }).status, 200);
  assert.deepEqual(fs.readdirSync(moved).filter((name) => name.includes('.tmp-')), []);
});

test('别的写错误照样抛（不被当成 bucket_gone 吞掉），临时文件同样清掉', (t) => {
  const { dataDir, store } = withStore(t);
  t.mock.method(fs, 'fsyncSync', () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
  assert.throws(() => store.save({ page: 'index', baseRevision: 0, annotations: [] }), /disk full/);
  t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(dataDir).filter((name) => name.includes('.tmp-')), []);
});

test('页已不 live 的桶不新建：桶目录不在、mayCreateBucket 说不行时，save / status / 图片都不写，答 bucket_gone（O）', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-store-gone-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'gone-page');
  const store = createAnnotationStore({ dataDir, mayCreateBucket: () => false });
  const saved = store.save({ page: '@canvas', baseRevision: 0, annotations: [{ id: 'a', content: '迟到的保存' }] });
  assert.equal(saved.status, 503);
  assert.equal(saved.error, 'bucket_gone');
  assert.throws(() => store.writeImage('@canvas', 'png', Buffer.from('x')), { code: 'bucket_gone' });
  assert.ok(!fs.existsSync(dataDir), '桶没有被重建');
  // 桶目录在盘上（整桶孤儿）照样能写；活页的桶不在时照常新建。
  fs.mkdirSync(dataDir);
  assert.equal(store.save({ page: '@canvas', baseRevision: 0, annotations: [{ id: 'a', content: '孤儿照样能写' }] }).status, 200);
  const live = createAnnotationStore({ dataDir: path.join(root, 'live-page'), mayCreateBucket: () => true });
  assert.equal(live.save({ page: '@canvas', baseRevision: 0, annotations: [] }).status, 200);
  assert.ok(fs.existsSync(path.join(root, 'live-page', '@canvas.json')));
});
