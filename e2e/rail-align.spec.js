import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './lib/fixtures.js';

import { E2E_DATA_DIR, E2E_SITES_DIR } from './env.js';
import { closeSettled } from './ledger-settle.js';
import { dragSelect, proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';

// 宽屏右栏按锚点排：卡片 top 贴着引用，重叠就往下推；选中的那张回到锚点；没选中的收成摘要；
// 悬停卡片与正文 mark 互相高亮；编辑框里打字时被编辑的卡片不挪。
// 文章写进本轮的 prose-site 副本（不改仓内固件），用完删掉。

const PROJECT = path.join(E2E_SITES_DIR, 'prose-site', 'docs', 'pinpoint', 'articles', 'align');
const SOURCE = path.join(PROJECT, 'index.mdx');
const PAGE_ID = 'e2e-prose_align';
const LEDGER = path.join(E2E_DATA_DIR, PAGE_ID, '@prose.json');
const ARTICLE = '/e2e-prose/align/';

// 一条用例一个文章目录：spec 串行，但上一条的 finally 删目录和站点的文件监听会撞上下一条的写入。
function articleDir(name) {
  const project = path.join(E2E_SITES_DIR, 'prose-site', 'docs', 'pinpoint', 'articles', 'align-' + name);
  return {
    project,
    source: path.join(project, 'index.mdx'),
    pageId: 'e2e-prose_align-' + name,
    ledger: path.join(E2E_DATA_DIR, 'e2e-prose_align-' + name, '@prose.json'),
    article: '/e2e-prose/align-' + name + '/',
  };
}

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
    await waitNoReload(page, { force: true }); // 同 openArticle：上一条用例删文的重载可能没落完
    await proseSettled(page);
    await expect(page.locator('#rail .pp-thread')).toHaveCount(6);

    // 排版写在 rAF 里。等栏带上对齐类、每张卡都写了 inline top 再量：只看 rect 的话，没写 top 时也有限。
    const geometry = () => page.evaluate(() => {
      const rail = document.querySelector('#rail');
      const railTop = rail.getBoundingClientRect().top;
      return [...rail.querySelectorAll('.pp-thread')].map((card) => {
        const id = card.getAttribute('data-id');
        const mark = [...document.querySelectorAll('mark.pp-hl')].find((m) => (m.getAttribute('data-ids') || '').split(' ').includes(id));
        const top = card.getBoundingClientRect().top - railTop;
        const anchor = mark ? mark.getBoundingClientRect().top - railTop : null;
        return { id, top, height: card.offsetHeight, anchor, styleTop: card.style.top, more: card.querySelector('.pp-more') ? card.querySelector('.pp-more').textContent : '' };
      });
    });
    await expect.poll(async () => {
      const aligned = await page.locator('#rail.pp-rail-aligned').count();
      const cards = await geometry();
      return aligned === 1 && cards.length > 0 && cards.every((card) => card.styleTop !== '' && card.anchor != null);
    }).toBe(true);

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
    let scrollBeforeFocus = 0;
    await test.step('没选中的长卡片是摘要：比展开矮，并显示“还有 1 条回复”', async () => {
      const cards = await geometry();
      const folded = cards.find((card) => card.id === 'a3');
      foldedHeight = folded.height;
      expect(folded.more).toBe('还有 1 条回复');
      scrollBeforeFocus = await page.evaluate(() => window.scrollY);
      await page.locator('mark.pp-hl[data-ids~="a3"]').click();
      await expect(page.locator('.pp-thread[data-id="a3"] .pp-more')).toHaveCount(0);
      await expect.poll(async () => (await geometry()).find((card) => card.id === 'a3').height).toBeGreaterThan(foldedHeight + 40);
    });

    await test.step('点高亮：对应卡片贴着锚点，仍互不重叠，页面不滚', async () => {
      // 展开后的长卡片底部可以超出视口；顶部看得见，页面就不该为它滚动。
      const cardBox = await page.locator('.pp-thread[data-id="a3"]').boundingBox();
      expect(cardBox.y).toBeGreaterThanOrEqual(0);
      expect(cardBox.y).toBeLessThan(900);
      // top 有 150ms 过渡。等它跑完再量，量到的是目标位置，不是半路。
      await expect.poll(() => page.evaluate(() => {
        const cards = [...document.querySelectorAll('#rail .pp-thread')];
        return cards.every((card) => !card.getAnimations().some((anim) => anim.transitionProperty === 'top' && anim.playState === 'running'));
      })).toBe(true);
      const cards = await geometry();
      const focused = cards.find((card) => card.id === 'a3');
      expect(Math.abs(focused.top - focused.anchor)).toBeLessThanOrEqual(2);
      for (let i = 1; i < cards.length; i++) {
        expect(cards[i].top).toBeGreaterThanOrEqual(cards[i - 1].top + cards[i - 1].height + 14 - 1);
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeFocus);
    });

    await test.step('悬停卡片高亮 mark，悬停 mark 高亮卡片', async () => {
      await page.locator('.pp-thread[data-id="a1"]').hover();
      await expect(page.locator('mark.pp-hl.pp-hover')).toHaveAttribute('data-ids', 'a1');
      await page.locator('mark.pp-hl[data-ids~="a2"]').hover();
      await expect(page.locator('.pp-thread.pp-hover')).toHaveAttribute('data-id', 'a2');
    });

    await test.step('页面滚下去后选字点“评论”：页面不跳，焦点落在草稿框，草稿卡贴着选中的文字', async () => {
      // 垫高页面、滚到栏顶已出视口的位置：草稿卡若还没排就聚焦，浏览器会把页面滚回栏顶。
      await page.evaluate(() => { document.body.style.paddingBottom = '2000px'; });
      await page.evaluate(() => {
        const p = document.querySelector('#p6');
        window.scrollTo(0, window.scrollY + p.getBoundingClientRect().top - 300);
      });
      await expect.poll(() => page.evaluate(() => document.querySelector('#rail').getBoundingClientRect().top)).toBeLessThan(0);
      await dragSelect(page, '#p6', '一本账上');
      const before = await page.evaluate(() => window.scrollY);
      await page.locator('.pp-selbtn').click();
      const area = page.locator('.pp-thread.draft textarea');
      await expect(area).toBeFocused();
      await page.waitForTimeout(300); // 静默窗口：过渡和下一帧重排都跑完，页面仍没滚
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
      const gap = await page.evaluate(() => {
        const mark = document.querySelector('mark.pp-hl.draft');
        const card = document.querySelector('.pp-thread.draft');
        return card.getBoundingClientRect().top - mark.getBoundingClientRect().top;
      });
      expect(Math.abs(gap)).toBeLessThanOrEqual(2);
      await page.keyboard.press('Escape');
      await expect(page.locator('.pp-thread.draft')).toHaveCount(0);
      await page.evaluate(() => { document.body.style.paddingBottom = ''; });
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

// 右栏排版的回归：关闭行仍用引文当锚点、进入编辑对齐锚点、编辑期间上方变高往上挤、
// 视口底部露出一行就不滚、重画后 top 有过渡。文章和账本都写进本轮副本，用完删掉。

function rowOf(id, n, exact, content, extra, article) {
  return {
    id, n, type: 'prose', status: 'open', content, section: 'body',
    quote: { exact, prefix: '', suffix: '' }, created_at: '2026-10-18T00:00:00.000Z', messages: [],
    ...extra,
    path: article || ARTICLE,
  };
}

async function openArticle(page, article) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(async () => {
    const res = await page.goto(article);
    expect(res && res.ok()).toBe(true);
    await expect(page.locator('#article .prose h1')).toHaveText('对齐固件', { timeout: 5_000 });
  }).toPass({ timeout: 150_000 });
  // 每条用例的 finally 都删上一篇固件文章且不等同步，这次导航可能撞上删除触发的整页重载
  //（内容变更重载，force 真等，见 site-settle.js）。
  await waitNoReload(page, { force: true });
  await proseSettled(page);
}

/** 等栏对齐、每张卡都写了 inline top，再读几何。top 是相对卡片容器的文档坐标差。 */
async function alignedGeometry(page) {
  await expect.poll(async () => page.evaluate(() => {
    const rail = document.querySelector('#rail');
    if (!rail || !rail.classList.contains('pp-rail-aligned')) return false;
    const cards = [...rail.querySelectorAll('.pp-thread')];
    // inline top 写上了还不够：top 有 150ms 过渡，动画还在跑时 rect 是半路的位置。
    return cards.length > 0 && cards.every((card) => card.style.top !== ''
      && !card.getAnimations().some((anim) => anim.transitionProperty === 'top' && anim.playState === 'running'));
  })).toBe(true);
  return page.evaluate(() => {
    const list = document.querySelector('#rail .pp-threads');
    const railTop = list.getBoundingClientRect().top;
    return [...list.querySelectorAll(':scope > .pp-thread')].map((card) => {
      const id = card.getAttribute('data-id');
      const mark = [...document.querySelectorAll('mark.pp-hl')].find((m) => (m.getAttribute('data-ids') || '').split(' ').includes(id));
      return {
        id,
        top: card.getBoundingClientRect().top - railTop,
        height: card.offsetHeight,
        anchor: mark ? mark.getBoundingClientRect().top - railTop : null,
        styleTop: parseFloat(card.style.top),
      };
    });
  });
}

test('同一段上挤了四条，选中最后一条时它留在锚点上，前面的叠到文档顶部', async ({ page, request }) => {
  test.setTimeout(180_000);
  const art = articleDir('crowd');
  fs.mkdirSync(art.project, { recursive: true });
  fs.writeFileSync(art.source, articleSource());
  try {
    const doc = await (await request.get(`/annotations/@prose?entry=${art.pageId}`)).json();
    const saved = await request.post('/save', {
      data: {
        entry: art.pageId, page: '@prose', path: '/', baseRevision: doc.revision,
        annotations: [0, 1, 2, 3].map((i) => rowOf('c' + (i + 1), i + 1, PARAS[0], '同一段上的第 ' + (i + 1) + ' 条，写得长一些好把上面的挤出去。'.repeat(3), undefined, art.article)),
      },
    });
    expect(saved.ok()).toBe(true);
    await openArticle(page, art.article);
    const before = await alignedGeometry(page);
    const last = before.find((card) => card.id === 'c4');
    // 没选中时第四条被前面三张推开，离锚点超过一张卡片。
    expect(last.top).toBeGreaterThan(last.anchor + last.height);

    // 四条盖在同一处高亮上，点高亮从第一条开始轮换。没选中时后面的卡片压在前面上面，
    // 点卡片中心会点到最上面那张；序号钉露在自己的卡片上，点它才选中第四条。
    await page.locator('.pp-thread[data-id="c4"] .pp-n').click();
    await expect(page.locator('.pp-thread[data-id="c4"]')).toHaveClass(/on/);
    const after = await alignedGeometry(page);
    const selected = after.find((card) => card.id === 'c4');
    const earlier = after.filter((card) => card.id !== 'c4');
    // 选中的留在锚点旁边，不被上面挤不下的卡片拽走。
    expect(Math.abs(selected.top - selected.anchor)).toBeLessThanOrEqual(2);
    // 前面的挤过栏顶，叠在文档顶部，不把选中的往下推。
    const docTop = await page.evaluate(() => {
      const list = document.querySelector('#rail .pp-threads');
      return -(list.getBoundingClientRect().top + window.scrollY);
    });
    expect(earlier.length).toBe(3);
    const tops = earlier.map((card) => Math.round(card.top));
    // 挤不下的叠在文档顶部，选中的那张还在自己的锚点上（上面已经比过）。
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(Math.round(docTop) - 1);
    expect(Math.min(...tops)).toBeLessThanOrEqual(Math.round(docTop) + 2);
    expect(tops.filter((top) => top <= Math.round(docTop) + 2).length).toBeGreaterThanOrEqual(1);
  } finally {
    fs.rmSync(art.project, { recursive: true, force: true });
    fs.rmSync(art.ledger, { force: true });
    await closeSettled(page);
  }
});

test('关闭的评论不画高亮，关闭行仍留在引文旁边', async ({ page, request }) => {
  test.setTimeout(180_000);
  const art = articleDir('closed');
  fs.mkdirSync(art.project, { recursive: true });
  // 第二段掉到第一张卡片底部以下很远。引文还能定位时关闭行停在引文旁边；
  // 锚点缺失时它只能紧跟上一张，两种结果差出一大截。
  const spaced = articleSource().replace('<p id="p2">', '<p id="p2" style="margin-top:700px">');
  fs.writeFileSync(art.source, spaced);
  try {
    const doc = await (await request.get(`/annotations/@prose?entry=${art.pageId}`)).json();
    const saved = await request.post('/save', {
      data: {
        entry: art.pageId, page: '@prose', path: '/', baseRevision: doc.revision,
        annotations: [
          rowOf('a1', 1, PARAS[0], '第一节的评论', undefined, art.article),
          rowOf('a2', 2, PARAS[1], '第二节的评论', undefined, art.article),
        ],
      },
    });
    expect(saved.ok()).toBe(true);
    await openArticle(page, art.article);
    const before = await alignedGeometry(page);
    const openSecond = before.find((card) => card.id === 'a2');
    // 两段隔得远，打开时第二条贴着引文，不被第一条推开。
    expect(Math.abs(openSecond.top - openSecond.anchor)).toBeLessThanOrEqual(2);

    await page.locator('.pp-thread[data-id="a2"] [data-act="close"]').click();
    await proseSettled(page);
    await expect(page.locator('.pp-thread[data-id="a2"]')).toHaveAttribute('data-status', 'close');
    // 已关闭不画 mark：等 mark 消失再量，量到的是关闭行自己的位置。
    await expect(page.locator('mark.pp-hl[data-ids~="a2"]')).toHaveCount(0);
    const after = await alignedGeometry(page);
    const closed = after.find((card) => card.id === 'a2');
    const first = after.find((card) => card.id === 'a1');
    const quoteTop = await page.evaluate(() => {
      const list = document.querySelector('#rail .pp-threads');
      const p = document.querySelector('#p2');
      return p.getBoundingClientRect().top - list.getBoundingClientRect().top;
    });
    // 不画高亮，但引文还能定位：关闭行留在引文旁边。锚点取的是引文第一个字，
    // 段盒子的顶部会高出几个像素，所以容差按一行以内，不按像素对齐。
    // 锚点缺失时只会紧跟上一张（第一张底部加间距），那个位置比引文高出一大截。
    const follow = first.top + first.height + 14;
    expect(quoteTop).toBeGreaterThan(follow + 200);
    expect(Math.abs(closed.top - quoteTop)).toBeLessThanOrEqual(8);
  } finally {
    fs.rmSync(art.project, { recursive: true, force: true });
    fs.rmSync(art.ledger, { force: true });
    await closeSettled(page);
  }
});

test('进入编辑对齐锚点，打字不挪自己；上方变高往上挤，不重叠', async ({ page, request }) => {
  test.setTimeout(180_000);
  const art = articleDir('edit');
  fs.mkdirSync(art.project, { recursive: true });
  // 第一段上面留出空白，上方卡片被往上挤时放得下，编辑卡不该停在碰撞推开的旧位置。
  const padded = articleSource().replace('<p id="p1">', '<p id="p1" style="margin-top:400px">');
  fs.writeFileSync(art.source, padded);
  try {
    const doc = await (await request.get(`/annotations/@prose?entry=${art.pageId}`)).json();
    const saved = await request.post('/save', {
      data: {
        entry: art.pageId, page: '@prose', path: '/', baseRevision: doc.revision,
        annotations: [
          rowOf('a', 1, PARAS[0], '第一条写一句', undefined, art.article),
          rowOf('b', 2, PARAS[0], '第二条写一句', undefined, art.article),
        ],
      },
    });
    expect(saved.ok()).toBe(true);
    await openArticle(page, art.article);
    const before = await alignedGeometry(page);
    // 两条引用同一段：第二条被往下推，离锚点超过一行。
    expect(before.find((card) => card.id === 'b').top - before.find((card) => card.id === 'b').anchor).toBeGreaterThan(40);

    // 400px 空白把第二条推到首屏下面。按它的目标 top 滚到刚好看得见再点：
    // 滚完会重排，卡片贴着引文，视口位置跟着变。点视口外的元素时 Playwright 自己会滚，那不是进入编辑造成的。
    await page.evaluate(() => {
      const list = document.querySelector('#rail .pp-threads');
      const card = document.querySelector('.pp-thread[data-id="b"]');
      const target = list.getBoundingClientRect().top + parseFloat(card.style.top);
      if (target + 40 > window.innerHeight - 24) window.scrollBy(0, target - (window.innerHeight - 160));
    });
    await expect.poll(() => page.evaluate(() => {
      const card = document.querySelector('.pp-thread[data-id="b"]');
      const running = card.getAnimations().some((anim) => anim.transitionProperty === 'top' && anim.playState === 'running');
      return !running && card.getBoundingClientRect().bottom <= window.innerHeight;
    })).toBe(true);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.locator('.pp-thread[data-id="b"] .text[data-edit]').click();
    const box = page.locator('.pp-thread[data-id="b"] textarea.pp-edit');
    await expect(box).toBeFocused();
    await expect.poll(async () => (await alignedGeometry(page)).find((card) => card.id === 'b').styleTop).not.toBeNaN();
    const entered = await alignedGeometry(page);
    const editing = entered.find((card) => card.id === 'b');
    const above = entered.find((card) => card.id === 'a');
    // 进入的那一刻对齐锚点，不再留在被推开的旧位置；上面的不和它重叠。
    expect(Math.abs(editing.top - editing.anchor)).toBeLessThanOrEqual(2);
    expect(above.top + above.height + 14).toBeLessThanOrEqual(editing.top + 1);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    const held = editing.top;
    await box.fill('第一行\n第二行\n第三行\n第四行');
    await page.waitForTimeout(300); // 静默窗口：打字把卡片撑高，过渡跑完后自己的 top 仍是进入时的
    const typed = await alignedGeometry(page);
    expect(Math.abs(typed.find((card) => card.id === 'b').top - held)).toBeLessThanOrEqual(1);

    // 编辑期间上方卡片变高：往上挤，编辑卡留在原地，两张不重叠。
    const fresh = await (await request.get(`/annotations/@prose?entry=${art.pageId}`)).json();
    const reply = await request.post('/annotations/%40prose/a/reply', {
      data: { entry: art.pageId, baseRevision: fresh.revision, text: '新回复让上方卡片多出一行。'.repeat(8) },
    });
    expect(reply.ok()).toBe(true);
    await expect(page.locator('.pp-thread[data-id="a"] .pp-more')).toContainText('还有 1 条回复');
    await expect(box).toHaveValue('第一行\n第二行\n第三行\n第四行');
    const grown = await alignedGeometry(page);
    const grownEdit = grown.find((card) => card.id === 'b');
    const grownAbove = grown.find((card) => card.id === 'a');
    expect(Math.abs(grownEdit.top - held)).toBeLessThanOrEqual(1);
    expect(grownAbove.top + grownAbove.height + 14).toBeLessThanOrEqual(grownEdit.top + 1);
  } finally {
    fs.rmSync(art.project, { recursive: true, force: true });
    fs.rmSync(art.ledger, { force: true });
    await closeSettled(page);
  }
});

// 把卡片顶滚到视口下沿以上 exposed 像素处。滚完右栏会重排一次，所以分两步。
async function exposeCardTop(page, id, exposed) {
  await page.evaluate((cardId) => {
    const card = document.querySelector('.pp-thread[data-id="' + cardId + '"]');
    window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 200);
  }, id);
  await page.evaluate(({ cardId, shown }) => {
    const top = document.querySelector('.pp-thread[data-id="' + cardId + '"]').getBoundingClientRect().top;
    window.scrollBy(0, Math.round(top - (window.innerHeight - shown)));
  }, { cardId: id, shown: exposed });
  await expect.poll(() => page.evaluate(({ cardId, shown }) => {
    const card = document.querySelector('.pp-thread[data-id="' + cardId + '"]');
    const running = card.getAnimations().some((anim) => anim.transitionProperty === 'top' && anim.playState === 'running');
    const top = card.getBoundingClientRect().top;
    return !running && top > window.innerHeight - shown - 4 && top < window.innerHeight - shown + 4;
  }, { cardId: id, shown: exposed })).toBe(true);
}

test('点高亮滚不滚按露出多少定：露出一行不滚、只露约 50px 不滚、不到一行才滚', async ({ page, request }) => {
  test.setTimeout(180_000);
  const art = articleDir('viewport');
  fs.mkdirSync(art.project, { recursive: true });
  // 第六段垫到首屏以下：滚到它时，卡片顶能落在视口底部（旧判定线 innerHeight − 144 以下）。
  const lowered = articleSource().replace('<p id="p6">', '<p id="p6" style="margin-top:1400px">');
  fs.writeFileSync(art.source, lowered);
  try {
    const doc = await (await request.get(`/annotations/@prose?entry=${art.pageId}`)).json();
    const saved = await request.post('/save', {
      data: {
        entry: art.pageId, page: '@prose', path: '/', baseRevision: doc.revision,
        annotations: [rowOf('deep', 1, PARAS[5], '长正文'.repeat(60), undefined, art.article)],
      },
    });
    expect(saved.ok()).toBe(true);
    await openArticle(page, art.article);
    await alignedGeometry(page);

    await test.step('卡片顶部在视口里并且露出一行，点高亮不滚页面', async () => {
      // 卡片跟着引文走。先把引文滚近视口，等右栏重排后再按稳定后的顶部微调到视口底部：
      // 旧判定线（innerHeight − 144）以下，仍露出一行。一次算好目标会被这一次重排打偏。
      await page.evaluate(() => {
        const card = document.querySelector('.pp-thread[data-id="deep"]');
        window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 200);
      });
      await page.evaluate(() => {
        const top = document.querySelector('.pp-thread[data-id="deep"]').getBoundingClientRect().top;
        window.scrollBy(0, Math.round(top - (window.innerHeight - 80)));
      });
      await expect.poll(() => page.evaluate(() => {
        const top = document.querySelector('.pp-thread[data-id="deep"]').getBoundingClientRect().top;
        return top > window.innerHeight - 144 && top + 40 <= window.innerHeight - 24;
      })).toBe(true);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await page.locator('mark.pp-hl[data-ids~="deep"]').click();
      await expect(page.locator('.pp-thread[data-id="deep"]')).toHaveClass(/on/);
      await page.waitForTimeout(300); // 静默窗口：旧条件会在这一拍里滚页，修后 scrollY 不动
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    });

    await test.step('只露出约 50px：比一行多、比旧判定要求的 64px 少，点高亮不该把正在看的正文拉走', async () => {
      await page.keyboard.press('Escape');
      await expect(page.locator('.pp-thread.on')).toHaveCount(0);
      await exposeCardTop(page, 'deep', 50);
      const shown = await page.evaluate(() => {
        const top = document.querySelector('.pp-thread[data-id="deep"]').getBoundingClientRect().top;
        return window.innerHeight - top;
      });
      expect(shown).toBeGreaterThanOrEqual(40);
      expect(shown).toBeLessThan(64);
      const scrollAt50 = await page.evaluate(() => window.scrollY);
      await page.locator('mark.pp-hl[data-ids~="deep"]').click();
      await expect(page.locator('.pp-thread[data-id="deep"]')).toHaveClass(/on/);
      await page.waitForTimeout(300); // 静默窗口：旧的 64px 判定会在这一拍里滚页
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollAt50);
    });

    await test.step('露出不到一行：点高亮才滚，滚完顶部回到视口里', async () => {
      await page.keyboard.press('Escape');
      await expect(page.locator('.pp-thread.on')).toHaveCount(0);
      await exposeCardTop(page, 'deep', 30);
      const short = await page.evaluate(() => {
        const top = document.querySelector('.pp-thread[data-id="deep"]').getBoundingClientRect().top;
        return window.innerHeight - top;
      });
      expect(short).toBeLessThan(40);
      const scrollAt30 = await page.evaluate(() => window.scrollY);
      await page.locator('mark.pp-hl[data-ids~="deep"]').click();
      await expect(page.locator('.pp-thread[data-id="deep"]')).toHaveClass(/on/);
      await expect.poll(() => page.evaluate((before) => {
        const top = document.querySelector('.pp-thread[data-id="deep"]').getBoundingClientRect().top;
        return top < window.innerHeight - 40 && window.scrollY !== before;
      }, scrollAt30), { timeout: 5_000 }).toBe(true);
    });
  } finally {
    fs.rmSync(art.project, { recursive: true, force: true });
    fs.rmSync(art.ledger, { force: true });
    await closeSettled(page);
  }
});

test('长线程折叠着直接点“回复”，输入框滚进视口', async ({ page, request }) => {
  test.setTimeout(180_000);
  const art = articleDir('reply');
  fs.mkdirSync(art.project, { recursive: true });
  fs.writeFileSync(art.source, articleSource());
  try {
    const doc = await (await request.get(`/annotations/@prose?entry=${art.pageId}`)).json();
    const saved = await request.post('/save', {
      data: {
        entry: art.pageId, page: '@prose', path: '/', baseRevision: doc.revision,
        annotations: [
          rowOf('long', 1, PARAS[0], '第一条只写一句', {
            messages: [{ who: 'agent', text: '很长的回复需要逐行阅读。'.repeat(160), at: '2026-10-18T00:00:00.000Z' }],
          }, art.article),
        ],
      },
    });
    expect(saved.ok()).toBe(true);
    await openArticle(page, art.article);
    await alignedGeometry(page);
    const button = page.locator('.pp-thread[data-id="long"] [data-act="open-reply"]');
    const buttonBox = await button.boundingBox();
    expect(buttonBox.y).toBeGreaterThanOrEqual(0);
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(900);
    await button.click();
    const area = page.locator('textarea[data-reply="long"]');
    await expect(area).toBeFocused();
    await expect.poll(() => area.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.top >= 72 && box.bottom <= window.innerHeight;
    })).toBe(true);
  } finally {
    fs.rmSync(art.project, { recursive: true, force: true });
    fs.rmSync(art.ledger, { force: true });
    await closeSettled(page);
  }
});

test('被挤开的评论直接进编辑，过渡结束后编辑框仍看得见', async ({ page, request }) => {
  test.setTimeout(180_000);
  const art = articleDir('pushed');
  fs.mkdirSync(art.project, { recursive: true });
  fs.writeFileSync(art.source, articleSource());
  try {
    const doc = await (await request.get(`/annotations/@prose?entry=${art.pageId}`)).json();
    const saved = await request.post('/save', {
      data: {
        entry: art.pageId, page: '@prose', path: '/', baseRevision: doc.revision,
        annotations: Array.from({ length: 8 }, (_, i) => rowOf(
          'p' + i, i + 1, PARAS[0],
          i === 7 ? '最后一条需要修改' : '占位长评论'.repeat(35),
          undefined, art.article,
        )),
      },
    });
    expect(saved.ok()).toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openArticle(page, art.article);
    await alignedGeometry(page);
    // 最后一条没被选中，被前面七张推到引文以下很远。滚到它再点。
    await page.evaluate(() => {
      document.body.style.paddingBottom = '4000px';
      const body = document.querySelector('.pp-thread[data-id="p7"] .text[data-edit]');
      const box = body.getBoundingClientRect();
      window.scrollTo(0, box.top + window.scrollY - 500);
    });
    await expect.poll(() => page.evaluate(() => {
      const body = document.querySelector('.pp-thread[data-id="p7"] .text[data-edit]');
      const running = body.closest('.pp-thread').getAnimations()
        .some((anim) => anim.transitionProperty === 'top' && anim.playState === 'running');
      const box = body.getBoundingClientRect();
      return !running && box.top > 400 && box.bottom < 700;
    })).toBe(true);
    await page.locator('.pp-thread[data-id="p7"] .text[data-edit]').click();
    const area = page.locator('.pp-thread[data-id="p7"] textarea.pp-edit');
    await expect(area).toBeFocused();
    // 等 top 过渡跑完再量。进编辑时卡片还在旧位置，过渡结束才落到引文旁。
    await expect.poll(() => page.evaluate(() => {
      const card = document.querySelector('.pp-thread[data-id="p7"]');
      return !card.getAnimations().some((anim) => anim.transitionProperty === 'top' && anim.playState === 'running');
    })).toBe(true);
    const seen = await area.evaluate((el) => {
      const box = el.getBoundingClientRect();
      let opacity = 1;
      for (let node = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      const y = (box.top + box.bottom) / 2;
      const hit = document.elementFromPoint(box.left + 20, y);
      return { top: box.top, bottom: box.bottom, opacity, hit: hit === el || el.contains(hit) };
    });
    // 页头占 72px，滚动按它留白；亚像素取整会差一两个像素，框要在视口里。
    expect(seen.top).toBeGreaterThanOrEqual(0);
    expect(seen.bottom).toBeLessThanOrEqual(900);
    expect(seen.opacity).toBe(1);
    expect(seen.hit).toBe(true);
  } finally {
    fs.rmSync(art.project, { recursive: true, force: true });
    fs.rmSync(art.ledger, { force: true });
    await closeSettled(page);
  }
});

test('长评论滚到末尾再进编辑，末尾那一行仍看得见', async ({ page, request }) => {
  test.setTimeout(180_000);
  const art = articleDir('longedit');
  fs.mkdirSync(art.project, { recursive: true });
  fs.writeFileSync(art.source, articleSource());
  const sentence = '这是一条很长的 owner 评论，需要保留最后一句的阅读位置。';
  try {
    const doc = await (await request.get(`/annotations/@prose?entry=${art.pageId}`)).json();
    const saved = await request.post('/save', {
      data: {
        entry: art.pageId, page: '@prose', path: '/', baseRevision: doc.revision,
        annotations: [rowOf('long', 1, PARAS[0], sentence.repeat(100), undefined, art.article)],
      },
    });
    expect(saved.ok()).toBe(true);
    await openArticle(page, art.article);
    await alignedGeometry(page);
    await page.locator('mark.pp-hl[data-ids~="long"]').click();
    await expect(page.locator('.pp-thread[data-id="long"]')).toHaveClass(/on/);
    await alignedGeometry(page);
    // 滚到评论末尾附近再点最后一行。点的是读者正在看的那一行，进编辑不该把它拽走。
    await page.evaluate(() => {
      document.body.style.paddingBottom = '2000px';
      const body = document.querySelector('.pp-thread[data-id="long"] .text[data-edit]');
      const box = body.getBoundingClientRect();
      window.scrollTo(0, box.bottom + window.scrollY - 700);
    });
    await expect.poll(() => page.evaluate(() => {
      const body = document.querySelector('.pp-thread[data-id="long"] .text[data-edit]');
      const running = body.closest('.pp-thread').getAnimations()
        .some((anim) => anim.transitionProperty === 'top' && anim.playState === 'running');
      return !running && body.getBoundingClientRect().bottom > 600 && body.getBoundingClientRect().bottom < 800;
    })).toBe(true);
    const text = page.locator('.pp-thread[data-id="long"] .text[data-edit]');
    const before = await text.boundingBox();
    await page.mouse.click(before.x + 25, before.y + before.height - 10);
    const area = page.locator('.pp-thread[data-id="long"] textarea.pp-edit');
    await expect(area).toBeFocused();
    const seen = await area.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const mirror = document.createElement('div');
      mirror.style.cssText = 'position:fixed;visibility:hidden;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;'
        + 'width:' + el.clientWidth + 'px;font:' + cs.font + ';line-height:' + cs.lineHeight
        + ';padding:' + cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft
        + ';box-sizing:' + cs.boxSizing + ';';
      const at = el.selectionStart;
      mirror.textContent = el.value.slice(0, at);
      const mark = document.createElement('span');
      mark.textContent = el.value.slice(at, at + 1) || ' ';
      mirror.appendChild(mark);
      document.body.appendChild(mirror);
      const top = box.top + (mark.getBoundingClientRect().top - mirror.getBoundingClientRect().top);
      const bottom = top + mark.getBoundingClientRect().height;
      document.body.removeChild(mirror);
      const hit = document.elementFromPoint(box.left + 25, (top + bottom) / 2);
      return {
        top,
        bottom,
        atEnd: el.selectionStart === el.value.length && el.value.length > 0,
        opacity: parseFloat(cs.opacity),
        hit: hit === el || el.contains(hit),
      };
    });
    // 光标在末尾那一行。点之前末尾停在 y≈700，进编辑不该把它拽到视口顶部：
    // 这一行要留在下半屏，不透明，并且点下去点到的是编辑框本身。
    expect(seen.atEnd).toBe(true);
    expect(seen.bottom).toBeGreaterThan(600);
    expect(seen.bottom).toBeLessThanOrEqual(900);
    expect(seen.opacity).toBeGreaterThan(0);
    expect(seen.hit).toBe(true);
  } finally {
    fs.rmSync(art.project, { recursive: true, force: true });
    fs.rmSync(art.ledger, { force: true });
    await closeSettled(page);
  }
});

test('选中后重画的卡片从旧 top 过渡到新 top，新卡片不从 0 飞入', async ({ page, request }) => {
  test.setTimeout(180_000);
  const art = articleDir('motion');
  fs.mkdirSync(art.project, { recursive: true });
  fs.writeFileSync(art.source, articleSource());
  try {
    const doc = await (await request.get(`/annotations/@prose?entry=${art.pageId}`)).json();
    const longReply = '这是一条很长的回复。'.repeat(40);
    const saved = await request.post('/save', {
      data: {
        entry: art.pageId, page: '@prose', path: '/', baseRevision: doc.revision,
        annotations: [
          rowOf('a1', 1, PARAS[0], '第一条只写一句', { messages: [{ who: 'agent', text: longReply, at: '2026-10-18T00:01:00.000Z' }] }, art.article),
          rowOf('a2', 2, PARAS[1], '第二条只写一句', undefined, art.article),
        ],
      },
    });
    expect(saved.ok()).toBe(true);
    await openArticle(page, art.article);
    const before = await alignedGeometry(page);
    const oldTop = before.find((card) => card.id === 'a2').styleTop;

    const motion = await page.evaluate(async (from) => {
      const old = document.querySelector('.pp-thread[data-id="a2"]');
      document.querySelector('mark.pp-hl[data-ids~="a1"]').click();
      const current = document.querySelector('.pp-thread[data-id="a2"]');
      const animations = current.getAnimations().filter((anim) => anim.transitionProperty === 'top');
      const keyframes = animations.length ? animations[0].effect.getKeyframes() : [];
      return {
        sameNode: old === current,
        from,
        target: parseFloat(current.style.top),
        animationCount: animations.length,
        keyframeTop: keyframes.map((frame) => frame.top),
      };
    }, oldTop);
    // 重画换了节点，但 top 从旧位置过渡到新位置，不是直接跳到目标。
    expect(motion.sameNode).toBe(false);
    expect(motion.target - motion.from).toBeGreaterThan(40);
    expect(motion.animationCount).toBeGreaterThan(0);
    expect(motion.keyframeTop[0]).toBe(motion.from + 'px');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.keyboard.press('Escape');
    await expect(page.locator('.pp-thread.on')).toHaveCount(0);
    await alignedGeometry(page);
    const reduced = await page.evaluate(async () => {
      document.querySelector('mark.pp-hl[data-ids~="a1"]').click();
      const current = document.querySelector('.pp-thread[data-id="a2"]');
      return current.getAnimations().filter((anim) => anim.transitionProperty === 'top').length;
    });
    expect(reduced).toBe(0);

    // 新出现的卡片没有旧 top：直接放在目标位置，不从 0 飞过来。
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.keyboard.press('Escape');
    await expect(page.locator('.pp-thread.on')).toHaveCount(0);
    await page.evaluate(() => {
      const p = document.querySelector('#p3');
      p.scrollIntoView({ block: 'center' });
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await expect(page.locator('.pp-selbtn')).toBeVisible();
    await page.locator('.pp-selbtn').click();
    const draft = page.locator('.pp-thread.draft');
    await expect(draft).toHaveCount(1);
    const fresh = await draft.evaluate((card) => {
      const mark = document.querySelector('mark.pp-hl.draft');
      return {
        styleTop: card.style.top,
        gap: Math.abs(card.getBoundingClientRect().top - mark.getBoundingClientRect().top),
        animationCount: card.getAnimations().filter((anim) => anim.transitionProperty === 'top').length,
      };
    });
    expect(fresh.styleTop).not.toBe('');
    expect(fresh.styleTop).not.toBe('0px');
    expect(fresh.gap).toBeLessThanOrEqual(2);
    expect(fresh.animationCount).toBe(0);
  } finally {
    fs.rmSync(art.project, { recursive: true, force: true });
    fs.rmSync(art.ledger, { force: true });
    await closeSettled(page);
  }
});
