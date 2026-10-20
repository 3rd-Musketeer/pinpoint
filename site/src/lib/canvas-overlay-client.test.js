import test from 'node:test';
import assert from 'node:assert/strict';
import { boxStarted } from './canvas-overlay-client.js';

// r5 T2：预热门的「已开始装」判据。横着滚出 Chromium 懒加载阈值（实测 ~5400px）的 doc 帧
// 永远停在 about:blank——旧实现只凭「DOM 里有 iframe」就算开始装，预热门永不打开。
const mkBox = (dataset, ...children) => ({
  dataset,
  querySelector: (sel) => children.find((c) => c.matches?.(sel)) ?? null,
});

test('boxStarted：lazy 且还在 about:blank 的 doc 帧不算开始装，不挡预热（r5 T2）', () => {
  const lazyBlank = mkBox({}, {
    matches: (sel) => sel === 'iframe',
    getAttribute: () => 'lazy',
    contentDocument: { URL: 'about:blank' },
  });
  assert.equal(boxStarted(lazyBlank), false);
  // 旧实现（只看 DOM 里有没有 iframe）：同一个盒子被当成「已开始装」，预热门被它永关。
  assert.equal(!!lazyBlank.querySelector('iframe'), true);
});

test('boxStarted：摆好 / 失败、shadow 排队、非 lazy 的 iframe 都算开始装', () => {
  assert.equal(boxStarted({ dataset: { fitted: '1' } }), true);
  assert.equal(boxStarted({ dataset: { failed: '1' } }), true);
  const queuedShadow = { matches: (sel) => sel === '.cc-shadow[data-cc-started]' };
  assert.equal(boxStarted(mkBox({}, queuedShadow)), true);
  const eagerIframe = { matches: (sel) => sel === 'iframe', getAttribute: () => null };
  assert.equal(boxStarted(mkBox({}, eagerIframe)), true);
  const lazyLoaded = {
    matches: (sel) => sel === 'iframe',
    getAttribute: () => 'lazy',
    contentDocument: { URL: 'http://x/api/frame?...' },
  };
  assert.equal(boxStarted(mkBox({}, lazyLoaded)), true);
});

test('boxStarted：跨域读不到 contentDocument 时按开始装算（保守方向：只影响预热时机）', () => {
  const crossOrigin = {
    matches: (sel) => sel === 'iframe',
    getAttribute: () => 'lazy',
    get contentDocument() { throw new Error('cross-origin'); },
  };
  assert.equal(boxStarted(mkBox({}, crossOrigin)), true);
});
