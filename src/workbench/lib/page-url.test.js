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

test('deep link carries the page tab only when given (ADR 0041)', () => {
  assert.deepEqual(parseDeepLink('?page=ui&tab=flow'), { pageId: 'ui', mode: null, entry: null, tab: 'flow' });
  assert.equal('tab' in parseDeepLink('?page=ui'), false);
  assert.equal(deepLinkQuery('ui', 'ios', null, 'flow'), 'page=ui&mode=ios&tab=flow');
  assert.equal(deepLinkQuery('ui', 'ios', '@canvas', 'flow'), 'page=ui&mode=ios&entry=%40canvas&tab=flow');
  assert.equal(deepLinkQuery('ui', 'ios', null, null), 'page=ui&mode=ios');
});

test('deep link carries the landing section only when given (2026-10-13)', () => {
  assert.deepEqual(
    parseDeepLink('?page=browser-e2e-flow&section=browser'),
    { pageId: 'browser-e2e-flow', mode: null, entry: null, section: 'browser' },
  );
  assert.deepEqual(
    parseDeepLink('?page=ui&tab=comps&section=onboard'),
    { pageId: 'ui', mode: null, entry: null, tab: 'comps', section: 'onboard' },
  );
  assert.equal('section' in parseDeepLink('?page=ui'), false);
  assert.equal('section' in parseDeepLink('?page=ui&section='), false);
  assert.equal(deepLinkQuery('browser-e2e-flow', null, null, null, 'browser'), 'page=browser-e2e-flow&section=browser');
  assert.equal(deepLinkQuery('ui', 'ios', null, 'flow', 'on board'), 'page=ui&mode=ios&tab=flow&section=on+board');
  assert.equal(deepLinkQuery('ui', 'ios', null, null, null), 'page=ui&mode=ios');
  assert.equal(deepLinkQuery('', 'ios', null, null, 'browser'), '');
  assert.deepEqual(
    parseDeepLink('?' + deepLinkQuery('ui', null, null, null, 'on board')),
    { pageId: 'ui', mode: null, entry: null, section: 'on board' },
  );
});
