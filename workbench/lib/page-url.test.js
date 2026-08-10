import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDeepLink, deepLinkQuery } from './page-url.js';

test('parseDeepLink reads ?page=&mode= and rejects invalid values', () => {
  assert.deepEqual(parseDeepLink('?page=library&mode=web'), { pageId: 'library', mode: 'web' });
  assert.deepEqual(parseDeepLink('?page=library'), { pageId: 'library', mode: null });
  assert.deepEqual(parseDeepLink('?mode=html'), { pageId: null, mode: 'html' });
  assert.deepEqual(parseDeepLink(''), { pageId: null, mode: null });
  assert.deepEqual(parseDeepLink('?page=&mode=vt100'), { pageId: null, mode: null });
  assert.deepEqual(parseDeepLink('?page=a&page=b'), { pageId: 'a', mode: null });
});

test('deepLinkQuery encodes, omits invalid mode, round-trips', () => {
  assert.equal(deepLinkQuery('library', 'ios'), 'page=library&mode=ios');
  assert.equal(deepLinkQuery('my page', 'web'), 'page=my+page&mode=web');
  assert.equal(deepLinkQuery('library', null), 'page=library');
  assert.equal(deepLinkQuery('library', 'vt100'), 'page=library');
  assert.equal(deepLinkQuery('', 'ios'), '');
  assert.deepEqual(parseDeepLink('?' + deepLinkQuery('x', 'html')), { pageId: 'x', mode: 'html' });
});
