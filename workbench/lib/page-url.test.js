import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDeepLink, deepLinkQuery } from './page-url.js';

test('parseDeepLink reads ?page=&mode= and rejects invalid values', () => {
  assert.deepEqual(parseDeepLink('?page=library&mode=ios'), { pageId: 'library', mode: 'ios', entry: null });
  assert.deepEqual(parseDeepLink('?page=library'), { pageId: 'library', mode: null, entry: null });
  assert.deepEqual(parseDeepLink('?mode=html'), { pageId: null, mode: 'html', entry: null });
  assert.deepEqual(parseDeepLink(''), { pageId: null, mode: null, entry: null });
  assert.deepEqual(parseDeepLink('?page=&mode=vt100'), { pageId: null, mode: null, entry: null });
  assert.deepEqual(parseDeepLink('?page=a&page=b'), { pageId: 'a', mode: null, entry: null });
});

test('parseDeepLink normalizes the retired web mode to html (2026-08-16 阶段 2)', () => {
  assert.deepEqual(parseDeepLink('?page=library&mode=web'), { pageId: 'library', mode: 'html', entry: null });
  assert.deepEqual(parseDeepLink('?mode=web'), { pageId: null, mode: 'html', entry: null });
});

test('deep link carries the entry id (2026-08-16f 阶段 6)', () => {
  assert.deepEqual(parseDeepLink('?page=weekly&entry=polish'), { pageId: 'weekly', mode: null, entry: 'polish' });
  assert.deepEqual(parseDeepLink('?entry=polish'), { pageId: null, mode: null, entry: 'polish' });
  assert.deepEqual(parseDeepLink('?page=weekly&entry='), { pageId: 'weekly', mode: null, entry: null });
  assert.equal(deepLinkQuery('weekly', 'ios', 'polish'), 'page=weekly&mode=ios&entry=polish');
  assert.equal(deepLinkQuery('weekly', 'ios'), 'page=weekly&mode=ios');
  assert.equal(deepLinkQuery('weekly', null, '@canvas'), 'page=weekly&entry=%40canvas');
  assert.deepEqual(
    parseDeepLink('?' + deepLinkQuery('weekly', 'ios', 'polish')),
    { pageId: 'weekly', mode: 'ios', entry: 'polish' },
  );
});

test('deepLinkQuery encodes, omits invalid mode, round-trips', () => {
  assert.equal(deepLinkQuery('library', 'ios'), 'page=library&mode=ios');
  assert.equal(deepLinkQuery('my page', 'html'), 'page=my+page&mode=html');
  assert.equal(deepLinkQuery('library', null), 'page=library');
  assert.equal(deepLinkQuery('library', 'web'), 'page=library');
  assert.equal(deepLinkQuery('library', 'vt100'), 'page=library');
  assert.equal(deepLinkQuery('', 'ios'), '');
  assert.deepEqual(parseDeepLink('?' + deepLinkQuery('x', 'html')), { pageId: 'x', mode: 'html', entry: null });
});
