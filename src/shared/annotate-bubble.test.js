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

test('bubbleInnerHtml appends a collapsed note head only when the mark carries a note', () => {
  const withNote = bubbleInnerHtml({ n: 5, content: 'x', note: '先看这条' });
  assert.ok(withNote.includes('class="ann-bubble-note-head"'), '折叠头');
  assert.ok(withNote.includes('agent 备注 ▸'));
  assert.equal(withNote.includes('ann-bubble-note-body'), false, '折叠时不渲染原文');
  assert.equal(withNote.includes('先看这条'), false);
  // 没有 note（或只有空白）的标注不出这一行
  assert.equal(bubbleInnerHtml({ n: 5, content: 'x' }).includes('ann-bubble-note-head'), false);
  assert.equal(bubbleInnerHtml({ n: 5, content: 'x', note: '  \n ' }).includes('ann-bubble-note-head'), false);
});

test('bubbleInnerHtml expands the note body on demand, keeping newlines and escaping', () => {
  const html = bubbleInnerHtml({ n: 5, content: 'x', note: '第一行\n改到 <b>92</b> 度' }, { noteExpanded: true });
  assert.ok(html.includes('agent 备注 ▾'));
  assert.ok(html.includes('class="ann-bubble-note-body"'));
  assert.ok(html.includes('第一行\n改到 &lt;b&gt;92&lt;/b&gt; 度'), 'pre-wrap 的换行留在原文里，HTML 特殊字符转义');
});

test('bubbleHtml strips the note: the static export bake has no fold head to click', () => {
  const full = bubbleHtml({ n: 7, content: 'x', note: '只给 live 卡的折叠段' });
  assert.equal(full.includes('ann-bubble-note-head'), false);
  assert.equal(full.includes('只给 live 卡的折叠段'), false);
});
