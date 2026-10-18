import { test } from 'node:test';
import assert from 'node:assert';
import { bubbleCss, bubbleInnerHtml, readingBodyHtml } from './annotate-bubble.js';

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

test('bubbleInnerHtml 阅读态：目标引用画成 pill，失效引用留着，文字转义', () => {
  const html = bubbleInnerHtml({
    n: 1,
    cap: 'A1',
    content: '把[indicator 1]改成继续登录',
    segments: [
      { type: 'text', text: '把<' },
      { type: 'pill', ref: 'i1', label: '打开浏览器', title: '打开浏览器 · today.jsx:4@1', missing: false },
      { type: 'text', text: '改成' },
      { type: 'pill', ref: 'i9', label: '失效目标 9', title: '失效目标 9（[@t:i9]）', missing: true },
    ],
  });
  assert.ok(html.includes('class="ann-read-pill" title="打开浏览器 · today.jsx:4@1">打开浏览器<'));
  assert.ok(html.includes('class="ann-read-pill ann-read-pill--missing"'));
  assert.ok(html.includes('失效目标 9'));
  // 正文中间的引用留在原位：打开浏览器在「把」和「改成」之间，不抽到顶部再把文字拼起来。
  const body = html.slice(html.indexOf('ann-bubble-body'));
  const first = body.indexOf('打开浏览器');
  const second = body.indexOf('改成');
  assert.ok(body.indexOf('把&lt;') < first && first < second, body);
  assert.equal(html.includes('[indicator'), false, '阅读态不出现机器名');
  assert.ok(html.includes('class="ann-bubble-ref">A1<'), '眉标仍是引用号');
});

test('readingBodyHtml：开头连续的目标引用单独成行，正文中间的引用留在原位', () => {
  const html = readingBodyHtml({
    segments: [
      { type: 'pill', ref: 'i1', label: '登录', title: '登录', missing: false },
      { type: 'text', text: '把' },
      { type: 'pill', ref: 'i2', label: '退出', title: '退出', missing: false },
      { type: 'text', text: '改成离开' },
    ],
  });
  assert.ok(html.startsWith('<span class="ann-bubble-refs">'));
  assert.ok(html.includes('>登录<'));
  const copy = html.slice(html.indexOf('ann-bubble-copy'));
  assert.ok(copy.includes('把'));
  assert.ok(copy.indexOf('把') < copy.indexOf('>退出<') && copy.indexOf('>退出<') < copy.indexOf('改成离开'), copy);
  assert.equal(copy.includes('登录'), false, '开头的引用不进正文');
});

test('bubbleInnerHtml shows an empty placeholder for no content', () => {
  const noContent = bubbleInnerHtml({ n: 3, content: '' });
  assert.ok(noContent.includes('ann-bubble-empty'));
});
