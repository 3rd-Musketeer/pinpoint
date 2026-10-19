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

test('parseDeepLink only knows ios and html modes', () => {
  assert.deepEqual(parseDeepLink('?page=library&mode=html'), { pageId: 'library', mode: 'html', entry: null });
  assert.deepEqual(parseDeepLink('?mode=web'), { pageId: null, mode: null, entry: null });
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

test('嵌入标记：?embed=overlay 才认，url-sync 写回时接上（2026-10-15 画布浮层）', async () => {
  const { isEmbedded, withEmbed } = await import('./page-url.js');
  assert.deepEqual(
    parseDeepLink('?page=demo_flow&section=ask&embed=overlay'),
    { pageId: 'demo_flow', mode: null, entry: null, section: 'ask', embed: 'overlay' },
  );
  assert.equal('embed' in parseDeepLink('?page=demo_flow&embed=card'), false);
  assert.equal('embed' in parseDeepLink('?page=demo_flow'), false);
  assert.equal(isEmbedded('?page=demo_flow&embed=overlay'), true);
  assert.equal(isEmbedded('?page=demo_flow'), false);
  assert.equal(withEmbed('page=demo_flow&entry=x', 'overlay'), 'page=demo_flow&entry=x&embed=overlay');
  assert.equal(withEmbed('page=demo_flow', undefined), 'page=demo_flow');
  assert.equal(withEmbed('', 'overlay'), '');
  // 文档代次随嵌入标记接回；没有代次（直接打开、0）就不写；非嵌入不写。
  assert.equal(withEmbed('page=demo_flow', 'overlay', 3), 'page=demo_flow&embed=overlay&gen=3');
  assert.equal(withEmbed('page=demo_flow', 'overlay', 0), 'page=demo_flow&embed=overlay');
  assert.equal(withEmbed('page=demo_flow', undefined, 3), 'page=demo_flow');
  assert.equal(isEmbedded('?' + withEmbed(deepLinkQuery('demo_flow', null, null, 'flow'), 'overlay')), true);
});
