import { test } from 'node:test';
import assert from 'node:assert';
import { bubbleCss, bubbleInnerHtml, bubbleHtml, exportBadgeHtml } from './annotate-bubble.js';

test('bubbleCss returns a non-empty CSS string with the bubble + export badge rules', () => {
  const css = bubbleCss();
  assert.ok(css.includes('.ann-bubble{'));
  assert.ok(css.includes('.ann-export-badge'));
  assert.ok(css.includes('.ann-bubble-num'));
  assert.equal(css.includes('.ann-connector'), false);
});

test('bubbleInnerHtml renders number and content with escaping', () => {
  const html = bubbleInnerHtml({
    n: 14,
    content: '这里用了 <b>强调</b>',
  });
  assert.ok(html.includes('class="ann-bubble-num">14<'));
  assert.ok(html.includes('&lt;b&gt;强调&lt;/b&gt;'));
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

test('exportBadgeHtml renders a soft numbered corner badge', () => {
  const html = exportBadgeHtml(3);
  assert.ok(html.includes('class="ann-export-badge"'));
  assert.ok(html.includes('data-n="3"'));
  assert.ok(html.includes('>3<'));
});

test('badgePositionForRect top-right matches export badge half-size', async () => {
  const { badgePositionForRect } = await import('./annotate-clip.js');
  const { EXPORT_BADGE_SIZE } = await import('./annotate-bubble.js');
  const rect = [100, 200, 80, 40];
  const pos = badgePositionForRect(rect, EXPORT_BADGE_SIZE / 2);
  // Top-right of the selected box: left = x + w - half, top = y - half
  assert.equal(pos.left, 100 + 80 - EXPORT_BADGE_SIZE / 2);
  assert.equal(pos.top, 200 - EXPORT_BADGE_SIZE / 2);
});
