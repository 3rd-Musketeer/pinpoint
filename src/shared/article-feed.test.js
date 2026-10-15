import assert from 'node:assert/strict';
import test from 'node:test';

import { articleFeed, articleTime, formatDay, parseArticleDate } from './article-feed.js';

test('parseArticleDate：只认合法的 YYYY-MM-DD，按本地零点', () => {
  assert.equal(parseArticleDate('2026-10-15'), new Date(2026, 9, 15).getTime());
  assert.equal(parseArticleDate(' 2026-10-15 '), new Date(2026, 9, 15).getTime());
  for (const bad of ['', null, undefined, '2026-10', '2026/10/15', '2026-13-01', '2026-02-30', '15 Oct 2026', '2026-10-15T08:00']) {
    assert.equal(parseArticleDate(bad), null, String(bad));
  }
});

test('articleTime：frontmatter 的 date 优先，没有或写错用 index.mdx 的修改时间', () => {
  const mtimeMs = new Date(2026, 9, 14, 21, 30).getTime();
  assert.deepEqual(articleTime({ date: '2026-10-01', mtimeMs }), { at: new Date(2026, 9, 1).getTime(), day: '2026-10-01', source: 'date' });
  assert.deepEqual(articleTime({ mtimeMs }), { at: mtimeMs, day: '2026-10-14', source: 'mtime' });
  assert.deepEqual(articleTime({ date: 'soon', mtimeMs }), { at: mtimeMs, day: '2026-10-14', source: 'mtime' });
  assert.equal(formatDay(new Date(2026, 0, 5).getTime()), '2026-01-05');
});

test('articleFeed：所有 project 的文章混排，新的在前；同一时间按 project id、article id', () => {
  const day = (d) => new Date(2026, 9, d, 12).getTime();
  const feed = articleFeed([
    { id: 'vault', title: 'Vault', articles: [
      { id: 'overview', title: '总览', mtimeMs: day(3) },
      { id: 'sync', title: '同步', date: '2026-10-10', mtimeMs: day(1) },
    ] },
    { id: 'areta', title: 'Areta', articles: [
      { id: 'b', title: 'B', mtimeMs: day(12) },
      { id: 'a', title: 'A', date: '2026-10-12', mtimeMs: day(1) },
    ] },
    { id: 'empty', title: 'Empty', articles: [] },
  ]);
  assert.deepEqual(feed.map((row) => `${row.project.id}/${row.article.id} ${row.time.day}`), [
    'areta/b 2026-10-12',
    'areta/a 2026-10-12',
    'vault/sync 2026-10-10',
    'vault/overview 2026-10-03',
  ]);
  assert.deepEqual(feed[0].project, { id: 'areta', title: 'Areta' });
});
