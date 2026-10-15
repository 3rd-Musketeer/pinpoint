import test from 'node:test';
import assert from 'node:assert/strict';

import { htmlCardCountText, htmlFrameLedgerKey, htmlFramePending, ledgerMatches } from './html-card-counts.js';
import { pageKeyFromPathname } from '../../shared/annotate-page-key.js';
import { annotationSlug } from '../../shared/annotation-slug.js';

test('HTML 卡片的账本名 = 那一页里标注客户端用的名字（location.pathname 的 pageKeyFromPathname），查询串不算', () => {
  const base = 'http://127.0.0.1:5299/workbench/';
  assert.equal(htmlFrameLedgerKey('sites/p_a/long-page.html?annotate=off', 'http://127.0.0.1:5299/'), pageKeyFromPathname('/sites/p_a/long-page.html'));
  assert.equal(htmlFrameLedgerKey('/sites/p_a/@source/kit/w%20x.html', base), pageKeyFromPathname('/sites/p_a/@source/kit/w%20x.html'));
  assert.equal(htmlFrameLedgerKey('', base), '');
});

test('待验收条数：open / check / done 算，close 与正文评论不算，没有 status 的算 open', () => {
  const doc = { annotations: [{ status: 'open' }, { status: 'check' }, { status: 'done' }, { status: 'close' }, {}, { type: 'prose', status: 'open' }, null] };
  assert.equal(htmlFramePending(doc), 4);
  assert.equal(htmlFramePending(null), 0);
  assert.equal(htmlCardCountText(4), '4 条标注');
  assert.equal(htmlCardCountText(0), '');
});

test('SSE 的 doc.page 原名或落盘 slug 都认', () => {
  const key = pageKeyFromPathname('/sites/p_a/long-page.html');
  assert.equal(ledgerMatches(key, key), true);
  assert.equal(ledgerMatches(annotationSlug(key), key), true);
  assert.equal(ledgerMatches('@canvas', key), false);
  assert.equal(ledgerMatches('x', ''), false);
});
