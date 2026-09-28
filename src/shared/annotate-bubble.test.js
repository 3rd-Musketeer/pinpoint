import { test } from 'node:test';
import assert from 'node:assert';
import { bubbleCss, bubbleInnerHtml, bubbleHtml } from './annotate-bubble.js';

test('bubbleCss returns a non-empty CSS string with the bubble rules', () => {
  const css = bubbleCss();
  assert.ok(css.includes('.ann-bubble{'));
  assert.ok(css.includes('.ann-bubble-cap'));
  assert.equal(css.includes('.ann-connector'), false);
});

test('bubbleInnerHtml renders number and content with escaping', () => {
  const html = bubbleInnerHtml({
    n: 14,
    content: '这里用了 <b>强调</b>',
  });
  assert.ok(html.includes('class="ann-bubble-n">14<'));
  assert.ok(html.includes('&lt;b&gt;强调&lt;/b&gt;'));
  assert.equal(html.includes('评论'), false, 'no 「评论」 author label');
});

test('bubbleInnerHtml puts the cap in a mono eyebrow, and skips it when absent', () => {
  const withCap = bubbleInnerHtml({ n: 2, cap: '框选区域', content: 'x' });
  assert.ok(withCap.includes('class="ann-bubble-ref">框选区域<'));
  const withoutCap = bubbleInnerHtml({ n: 2, content: 'x' });
  assert.equal(withoutCap.includes('ann-bubble-ref'), false);
  assert.ok(withoutCap.includes('class="ann-bubble-n">2<'));
});

test('bubbleInnerHtml shows an empty placeholder for no content', () => {
  const noContent = bubbleInnerHtml({ n: 3, content: '' });
  assert.ok(noContent.includes('ann-bubble-empty'));
});

test('bubbleHtml wraps the inner markup with a data-n bubble div', () => {
  const full = bubbleHtml({ n: 7, content: 'x' });
  assert.ok(full.startsWith('<div class="ann-bubble" data-n="7">'));
  assert.ok(full.endsWith('</div>'));
});
