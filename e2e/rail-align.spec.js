import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './lib/fixtures.js';

import { E2E_DATA_DIR, E2E_SITES_DIR } from './env.js';
import { closeSettled } from './ledger-settle.js';
import { proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';

// 宽屏右栏按锚点排：卡片 top 贴着引用，重叠就往下推；选中的那张回到锚点；没选中的收成摘要；
// 悬停卡片与正文 mark 互相高亮；编辑框里打字时被编辑的卡片不挪。
// 文章写进本轮的 prose-site 副本（不改仓内固件），用完删掉。

const PROJECT = path.join(E2E_SITES_DIR, 'prose-site', 'docs', 'pinpoint', 'articles', 'align');
const SOURCE = path.join(PROJECT, 'index.mdx');
const PAGE_ID = 'e2e-prose_align';
const LEDGER = path.join(E2E_DATA_DIR, PAGE_ID, '@prose.json');
const ARTICLE = '/e2e-prose/align/';

const PARAS = [
  '第一段写付款之前要停下来核对。',
  '第二段写收款方必须是全称。',
  '第三段写扣款时间要写明白。',
  '第四段写确认卡上的按钮文案。',
  '第五段写失败之后怎么退回。',
  '第六段写记录留在哪一本账上。',
];

function articleSource() {
  const body = PARAS.map((text, i) => `<p id="p${i + 1}">${text}</p>`).join('\n\n');
  return `---\ntitle: 对齐固件\nsummary: 右栏卡片按锚点排。\n---\n\n<Section id="body" title="六段正文">\n\n${body}\n\n</Section>\n`;
}

function row(id, n, exact, content, messages) {
  return {
    id, n, type: 'prose', status: 'open', content, section: 'body', path: ARTICLE,
    quote: { exact, prefix: '', suffix: '' }, created_at: '2026-10-18T00:00:00.000Z', messages: messages || [],
  };
}

test('宽屏右栏：卡片按锚点排，选中对齐，没选中折叠，悬停互亮，编辑时不挪', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  fs.mkdirSync(PROJECT, { recursive: true });
  fs.writeFileSync(SOURCE, articleSource());
  try {
    const doc = await (await request.get(`/annotations/@prose?entry=${PAGE_ID}`)).json();
    const longReply = '这是一条很长的回复。'.repeat(40);
    const rows = PARAS.map((text, i) => row('a' + (i + 1), i + 1, text, '第 ' + (i + 1) + ' 条只写一句'));
    // 第二条和第三条引用相邻的两段；第三条再挂一条很长的回复，没选中时收成“还有 1 条回复”。
    rows[2].messages = [{ who: 'agent', text: longReply, at: '2026-10-18T00:01:00.000Z' }];
    const saved = await request.post('/save', {
      data: { entry: PAGE_ID, page: '@prose', path: '/', baseRevision: doc.revision, annotations: rows },
    });
    expect(saved.ok()).toBe(true);

    // 文章是开跑后才写进副本的，内容层要等文件事件才收。等到页面真的出来再往下。
    await expect(async () => {
      const res = await page.goto(ARTICLE);
      expect(res && res.ok()).toBe(true);
      await expect(page.locator('#article .prose h1')).toHaveText('对齐固件', { timeout: 5_000 });
    }).toPass({ timeout: 150_000 });
    await waitNoReload(page);
    await proseSettled(page);
    await expect(page.locator('#rail .pp-thread')).toHaveCount(6);

    // 排版写在 rAF 里，等每张卡都有 top 再量。
    const geometry = () => page.evaluate(() => {
      const rail = document.querySelector('#rail');
      const railTop = rail.getBoundingClientRect().top;
      return [...rail.querySelectorAll('.pp-thread')].map((card) => {
        const id = card.getAttribute('data-id');
        const mark = [...document.querySelectorAll('mark.pp-hl')].find((m) => (m.getAttribute('data-ids') || '').split(' ').includes(id));
        const top = card.getBoundingClientRect().top - railTop;
        const anchor = mark ? mark.getBoundingClientRect().top - railTop : null;
        return { id, top, height: card.offsetHeight, anchor, more: card.querySelector('.pp-more') ? card.querySelector('.pp-more').textContent : '' };
      });
    });
    await expect.poll(async () => (await geometry()).every((card) => Number.isFinite(card.top) && card.anchor != null)).toBe(true);

    await test.step('没选中：互不重叠，top 不小于锚点，不碰撞的贴着锚点', async () => {
      const cards = await geometry();
      expect(cards).toHaveLength(6);
      for (let i = 0; i < cards.length; i++) {
        expect(cards[i].top).toBeGreaterThanOrEqual(cards[i].anchor - 0.5);
        if (i > 0) expect(cards[i].top).toBeGreaterThanOrEqual(cards[i - 1].top + cards[i - 1].height + 14 - 1);
      }
      // 第一张没有上一张，锚点又在栏顶附近，应当贴着锚点。
      expect(Math.abs(cards[0].top - cards[0].anchor)).toBeLessThanOrEqual(2);
    });

    let foldedHeight = 0;
    await test.step('没选中的长卡片是摘要：比展开矮，并显示“还有 1 条回复”', async () => {
      const cards = await geometry();
      const folded = cards.find((card) => card.id === 'a3');
      foldedHeight = folded.height;
      expect(folded.more).toBe('还有 1 条回复');
      await page.locator('mark.pp-hl[data-ids~="a3"]').click();
      await expect(page.locator('.pp-thread[data-id="a3"] .pp-more')).toHaveCount(0);
      await expect.poll(async () => (await geometry()).find((card) => card.id === 'a3').height).toBeGreaterThan(foldedHeight + 40);
    });

    await test.step('点高亮：对应卡片贴着锚点，仍互不重叠，页面不滚', async () => {
      const before = await page.evaluate(() => window.scrollY);
      const cardBox = await page.locator('.pp-thread[data-id="a3"]').boundingBox();
      expect(cardBox.y).toBeGreaterThanOrEqual(0);
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(900);
      const cards = await geometry();
      const focused = cards.find((card) => card.id === 'a3');
      expect(Math.abs(focused.top - focused.anchor)).toBeLessThanOrEqual(2);
      for (let i = 1; i < cards.length; i++) {
        expect(cards[i].top).toBeGreaterThanOrEqual(cards[i - 1].top + cards[i - 1].height + 14 - 1);
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
    });

    await test.step('悬停卡片高亮 mark，悬停 mark 高亮卡片', async () => {
      await page.locator('.pp-thread[data-id="a1"]').hover();
      await expect(page.locator('mark.pp-hl.pp-hover')).toHaveAttribute('data-ids', 'a1');
      await page.locator('mark.pp-hl[data-ids~="a2"]').hover();
      await expect(page.locator('.pp-thread.pp-hover')).toHaveAttribute('data-id', 'a2');
    });

    await test.step('编辑框里连续输入多行，被编辑卡片的 top 不变', async () => {
      await page.locator('.pp-thread[data-id="a3"] .text[data-edit]').click();
      const box = page.locator('.pp-thread[data-id="a3"] textarea.pp-edit');
      await expect(box).toBeFocused();
      const topOf = () => page.locator('.pp-thread[data-id="a3"]').evaluate((el) => el.getBoundingClientRect().top);
      // 进编辑会重画并在下一帧写 top。等连续两帧不动再量，量的是打字本身没把卡片挪走。
      await expect.poll(() => box.evaluate(async (el) => {
        const card = el.closest('.pp-thread');
        const a = card.getBoundingClientRect().top;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const b = card.getBoundingClientRect().top;
        return Math.abs(a - b) < 0.5 ? b : null;
      })).not.toBeNull();
      const before = await topOf();
      await box.fill('第一行\n第二行\n第三行\n第四行');
      await page.waitForTimeout(300); // 静默窗口：过渡 150ms 跑完，top 仍是打字前的
      expect(Math.abs((await topOf()) - before)).toBeLessThanOrEqual(1);
    });
  } finally {
    fs.rmSync(PROJECT, { recursive: true, force: true });
    fs.rmSync(LEDGER, { force: true });
    await closeSettled(page);
  }
});
