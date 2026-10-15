import { expect, test } from './lib/fixtures.js';

// 正文评论的文本索引与高亮（src/client/prose-comments.js 的 buildTextIndex、rangeToOffsets、
// paintSegments、unpaint）在真 DOM 上的单测。prose-comments.spec.js 走完整条链路，但被评的
// 引文都落在一个文本节点里；这里测跨节点（**粗体**、[[ref]] 链接）、多条重叠、块边界与
// CJK 软换行、卡片不进文本。不起 Astro：开一个服务自己的轻页面，setContent 换成静态正文，
// 再从 vite 直接 import 模块（源码路径 /src/…）。

async function load(page, html) {
  await page.goto('/health');
  await page.setContent(`<main id="root">${html}</main>`);
  await page.evaluate(async () => {
    window.__prose = await import('/src/client/prose-comments.js');
  });
}

test('跨节点的引文：索引连成一条文本，选区换算回同一段偏移，高亮拆在各节点里、结构不动', async ({ page }) => {
  await load(page, '<p>先停下，<strong>确认卡</strong>写清<a class="cref" href="#">收款方</a>。</p>');
  const out = await page.evaluate(() => {
    const { buildTextIndex, rangeToOffsets, paintSegments } = window.__prose;
    const root = document.getElementById('root');
    const index = buildTextIndex(root);
    const exact = '确认卡写清收款方';
    const start = index.text.indexOf(exact);
    // 真鼠标选区的形状：从 <strong> 里的第一个字到 <a> 里的最后一个字。
    const range = document.createRange();
    range.setStart(root.querySelector('strong').firstChild, 0);
    range.setEnd(root.querySelector('a').firstChild, 3);
    const offsets = rangeToOffsets(range, index);
    paintSegments(index, [{ id: 'c1', start, end: start + exact.length }]);
    const marks = [...root.querySelectorAll('mark.pp-hl')];
    return {
      text: index.text,
      start,
      offsets,
      marks: marks.map((m) => [m.parentElement.tagName, m.textContent, m.dataset.ids]),
      html: root.innerHTML,
    };
  });
  expect(out.text).toBe('先停下，确认卡写清收款方。');
  expect(out.offsets).toEqual({ start: out.start, end: out.start + 8 });
  expect(out.marks).toEqual([['STRONG', '确认卡', 'c1'], ['P', '写清', 'c1'], ['A', '收款方', 'c1']]);
  // 原来的元素还在原处，只是文字外面多了一层 mark。
  expect(out.html).toBe('<p>先停下，<strong><mark class="pp-hl" data-ids="c1">确认卡</mark></strong><mark class="pp-hl" data-ids="c1">写清</mark>'
    + '<a class="cref" href="#"><mark class="pp-hl" data-ids="c1">收款方</mark></a>。</p>');
});

test('多条重叠：重叠那段的 mark 列出全部 id，草稿那条带 draft；unpaint 后文本节点合回原样', async ({ page }) => {
  await load(page, '<p>付款前<em>先确认</em>收款方与金额</p>');
  const out = await page.evaluate(() => {
    const { buildTextIndex, paintSegments, unpaint } = window.__prose;
    const root = document.getElementById('root');
    const before = root.innerHTML;
    const index = buildTextIndex(root);
    const at = (s) => index.text.indexOf(s);
    paintSegments(index, [
      { id: 'a', start: at('前先确认'), end: at('前先确认') + 4 },
      { id: 'b', start: at('确认收款方'), end: at('确认收款方') + 5, draft: true },
    ]);
    const marks = [...root.querySelectorAll('mark.pp-hl')].map((m) => [m.textContent, m.dataset.ids, m.classList.contains('draft')]);
    unpaint(root);
    return { marks, restored: root.innerHTML === before, textNodes: [...root.querySelector('p').childNodes].map((n) => n.nodeType) };
  });
  expect(out.marks).toEqual([
    ['前', 'a', false],
    ['先', 'a', false],
    ['确认', 'a b', true],
    ['收款方', 'b', true],
  ]);
  expect(out.restored).toBe(true);
  // normalize 把拆开的文本节点合回去：p 下仍是 文本、em、文本 三个节点。
  expect(out.textNodes).toEqual([3, 1, 3]);
});

test('块边界与 CJK 软换行：两个中文字之间的段界、源码换行不算空白，其余段界算一个空格；卡片与脚本不进文本', async ({ page }) => {
  await load(page, '<p>第一段结尾</p><p>第二段开头</p><p>确认卡\n写清收款方</p><p>pay</p><p>now</p>'
    + '<div data-pp-canvas><p>卡片里的字</p></div><script>var x = 1;</script><p>尾句</p>');
  const out = await page.evaluate(() => {
    const { buildTextIndex, paintSegments } = window.__prose;
    const root = document.getElementById('root');
    const index = buildTextIndex(root);
    const exact = '确认卡写清收款方';
    const start = index.text.indexOf(exact);
    paintSegments(index, [{ id: 'w', start, end: start + exact.length }]);
    return {
      text: index.text,
      marks: [...root.querySelectorAll('mark.pp-hl')].map((m) => m.textContent),
    };
  });
  expect(out.text).toBe('第一段结尾第二段开头确认卡写清收款方 pay now 尾句');
  // 源码里的换行留在原文里：高亮覆盖它，规范化文本里它不占位置。
  expect(out.marks).toEqual(['确认卡\n写清收款方']);
});
