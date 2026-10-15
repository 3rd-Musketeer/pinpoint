import test from 'node:test';
import assert from 'node:assert/strict';

import { createCanvasLedgers } from './canvas-ledgers.js';
import { pageKeyFromPathname } from '../../shared/annotate-page-key.js';
import { annotationSlug } from '../../shared/annotation-slug.js';
import { pendingCount } from '../../../site/src/lib/canvas-card.js';

test('共享 HTML 账本在每个别名上计数，同节只计一次，右栏与状态写入只有一份', () => {
  const log = [];
  const url = '/sites/p_a/shared.html';
  const key = pageKeyFromPathname(url);
  const books = createCanvasLedgers({ entry: 'p_a', make: fakeMake(log), pages: [{ id: 'a', url }, { id: 'b', url }] });
  const check = (n) => {
    const doc = { annotations: books.rows() };
    assert.equal(pendingCount(doc, 'p_a', ['a']), n);
    assert.equal(pendingCount(doc, 'p_a', ['b']), n);
    assert.equal(pendingCount(doc, 'p_a', ['a', 'b']), n);
    assert.equal(books.rows().length, 1);
  };
  books.accept(key, { revision: 1, annotations: [{ id: 'h', status: 'open' }] });
  check(1);
  for (const [revision, status] of [[2, 'done'], [3, 'close'], [4, 'open']]) {
    books.remote({ page: annotationSlug(key), revision, annotations: [{ id: 'h', status }] });
    check(status === 'close' ? 0 : 1);
  }
  books.enqueue({ op: 'status', id: 'h', status: 'close' });
  assert.deepEqual(log.filter((x) => x[0] === 'enqueue'), [['enqueue', key, 'h', 'close']]);
});

// 假账本：记下收到的东西，rows 就是最近一次 accept / remote 的行。
function fakeMake(log) {
  return (options) => {
    let rows = [];
    const book = {
      name: options.ledger,
      rows: () => rows,
      accept: (doc) => { rows = doc.annotations; log.push(['accept', options.ledger]); },
      remote: (doc) => { rows = doc.annotations; log.push(['remote', options.ledger]); },
      enqueue: (op) => log.push(['enqueue', options.ledger, op.id, op.status]),
      flushOnLeave: () => log.push(['flush', options.ledger]),
      settled: () => true,
      error: () => '',
    };
    return book;
  };
}

test('画布账本 + 每个 HTML 帧一本：名字按页面地址，行补上那一帧，状态回到行所在的那本，推送按原名或 slug 分', () => {
  const log = [];
  const url = '/sites/p_a/long-page.html';
  const key = pageKeyFromPathname(url);
  const books = createCanvasLedgers({
    server: '', entry: 'p_a', make: fakeMake(log),
    pages: [{ id: 'long-page', url }, { id: 'same', url }, { id: '', url: '/x.html' }],
  });
  assert.deepEqual(books.names(), ['@canvas', key]);

  books.accept('@canvas', { annotations: [{ id: 'c1', screenId: 'phone-card', n: 1 }] });
  books.accept(key, { annotations: [{ id: 'h1', n: 2 }, { id: 'h2', n: 3, screenId: 'kept' }] });
  assert.deepEqual(books.rows().map((r) => [r.id, r.screenId]), [['c1', 'phone-card'], ['h1', 'long-page'], ['h2', 'kept']]);

  assert.equal(books.enqueue({ op: 'status', id: 'h1', status: 'close' }), true);
  assert.equal(books.enqueue({ op: 'status', id: 'c1', status: 'close' }), true);
  assert.equal(books.enqueue({ op: 'status', id: 'nope', status: 'close' }), false);
  assert.deepEqual(log.filter((e) => e[0] === 'enqueue'), [['enqueue', key, 'h1', 'close'], ['enqueue', '@canvas', 'c1', 'close']]);

  assert.equal(books.remote({ page: annotationSlug(key), revision: 2, annotations: [] }), true);
  assert.equal(books.remote({ page: '@prose', revision: 2, annotations: [] }), false);
  assert.deepEqual(log.filter((e) => e[0] === 'remote'), [['remote', key]]);
  // 盘上的行不被改：补 screenId 的是拷贝。
  books.accept(key, { annotations: [{ id: 'h3' }] });
  const row = books.rows().find((r) => r.id === 'h3');
  assert.equal(row.screenId, 'long-page');
});
