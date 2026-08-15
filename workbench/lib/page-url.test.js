import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDeepLink, deepLinkQuery } from './page-url.js';

test('parseDeepLink reads ?page=&mode= and rejects invalid values', () => {
  assert.deepEqual(parseDeepLink('?page=library&mode=ios'), { pageId: 'library', mode: 'ios' });
  assert.deepEqual(parseDeepLink('?page=library'), { pageId: 'library', mode: null });
  assert.deepEqual(parseDeepLink('?mode=html'), { pageId: null, mode: 'html' });
  assert.deepEqual(parseDeepLink(''), { pageId: null, mode: null });
  assert.deepEqual(parseDeepLink('?page=&mode=vt100'), { pageId: null, mode: null });
  assert.deepEqual(parseDeepLink('?page=a&page=b'), { pageId: 'a', mode: null });
});

test('parseDeepLink normalizes the retired web mode to html (2026-08-16 阶段 2)', () => {
  assert.deepEqual(parseDeepLink('?page=library&mode=web'), { pageId: 'library', mode: 'html' });
  assert.deepEqual(parseDeepLink('?mode=web'), { pageId: null, mode: 'html' });
});

test('deepLinkQuery encodes, omits invalid mode, round-trips', () => {
  assert.equal(deepLinkQuery('library', 'ios'), 'page=library&mode=ios');
  assert.equal(deepLinkQuery('my page', 'html'), 'page=my+page&mode=html');
  assert.equal(deepLinkQuery('library', null), 'page=library');
  assert.equal(deepLinkQuery('library', 'web'), 'page=library');
  assert.equal(deepLinkQuery('library', 'vt100'), 'page=library');
  assert.equal(deepLinkQuery('', 'ios'), '');
  assert.deepEqual(parseDeepLink('?' + deepLinkQuery('x', 'html')), { pageId: 'x', mode: 'html' });
});
