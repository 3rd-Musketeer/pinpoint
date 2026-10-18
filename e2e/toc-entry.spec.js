import { expect, test } from './lib/fixtures.js';

import { proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';

// 窄屏目录入口（site/README.md「目录」）：1180px 以下目录栏隐藏，正文顶上一条
// “目录 n / N 标题”，点开复用同一个 #toc。跳转后标题落在顶栏和这条入口下面。

const ARTICLE = '/e2e-project/commit-confirm/';

async function openArticle(page) {
  await page.goto(ARTICLE);
  await expect(page.locator('#article .prose h1')).toHaveText('提交前确认', { timeout: 150_000 });
  await waitNoReload(page);
  await proseSettled(page);
}

const entry = (page) => page.locator('[data-toc-entry]');
const pop = (page) => page.locator('[data-toc-nav]');

/** 标题是否落在粘住的顶栏加目录入口下面。 */
const headingClearance = (page, id) => page.evaluate((sectionId) => {
  const head = document.getElementById(sectionId).querySelector('h2').getBoundingClientRect();
  const bar = document.querySelector('.top').getBoundingClientRect();
  const en = document.querySelector('[data-toc-entry]').getBoundingClientRect();
  return { headTop: head.top, occupiedBottom: Math.max(bar.bottom, en.bottom) };
}, id);

test('窄屏目录入口：1024 与 390 都能跳节，标题不藏在顶栏下', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const [width, height] of [[1024, 768], [390, 844]]) {
    await test.step(`${width} 宽`, async () => {
      await page.setViewportSize({ width, height });
      await openArticle(page);

      await test.step('入口在，目录栏不在；宽屏那条三列不受影响的前提是这里目录确实收起了', async () => {
        await expect(entry(page)).toBeVisible();
        expect(await pop(page).evaluate((el) => getComputedStyle(el).display)).toBe('none');
        const row = await entry(page).locator('.toc-entry-btn').boundingBox();
        expect(row.height).toBeGreaterThanOrEqual(35);
        expect(row.height).toBeLessThanOrEqual(37);
        expect(await entry(page).locator('.toc-entry-btn').evaluate((el) => getComputedStyle(el).fontSize)).toBe('13px');
        await expect(entry(page).locator('[data-toc-pos]')).toHaveText('1 / 4');
      });

      await test.step('点开目录：复用 #toc，行高至少 36', async () => {
        await entry(page).locator('[data-toc-toggle]').click();
        await expect(entry(page).locator('[data-toc-toggle]')).toHaveAttribute('aria-expanded', 'true');
        const item = await pop(page).locator('#toc a').first().boundingBox();
        expect(item.height).toBeGreaterThanOrEqual(36);
        const box = await pop(page).boundingBox();
        if (width <= 600) expect(box.width).toBeGreaterThan(width - 30);
        else expect(box.width).toBeGreaterThanOrEqual(319);
        expect(box.y).toBeGreaterThan(0);
      });

      await test.step('跳到第 3 节：标题落在顶栏和入口下面，入口显示 3 / 4', async () => {
        await pop(page).locator('#toc a[href="#variants"]').click();
        await expect(entry(page).locator('[data-toc-pos]')).toHaveText('3 / 4');
        await expect(entry(page).locator('[data-toc-current]')).toHaveText('卡片做法');
        await expect(entry(page).locator('[data-toc-toggle]')).toHaveAttribute('aria-expanded', 'false');
        const c = await headingClearance(page, 'variants');
        expect(c.headTop, JSON.stringify(c)).toBeGreaterThan(c.occupiedBottom);
        expect(c.headTop - c.occupiedBottom, JSON.stringify(c)).toBeLessThanOrEqual(16);
      });

      await test.step('滚回顶部：入口回到第 1 节', async () => {
        await page.evaluate(() => { scrollTo(0, 400); scrollTo(0, 0); });
        await expect(entry(page).locator('[data-toc-pos]')).toHaveText('1 / 4');
      });
    });
  }
});

test('宽屏没有目录入口，目录栏还在', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArticle(page);
  await expect(entry(page)).toBeHidden();
  await expect(pop(page).locator('#toc a')).toHaveCount(4);
  const nav = await pop(page).boundingBox();
  expect(nav).not.toBeNull();
  expect(nav.width).toBeGreaterThan(100);
});

test('目录 popover：打开 120ms、4px 位移；减少动态效果只淡入', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await openArticle(page);

  const motion = () => page.evaluate(() => {
    const anim = document.querySelector('[data-toc-nav]').getAnimations().find((a) => a.playState !== 'finished');
    if (!anim) return null;
    const frames = anim.effect.getKeyframes().map((f) => ({ opacity: String(f.opacity), transform: f.transform }));
    return { duration: anim.effect.getTiming().duration, frames };
  });

  await test.step('打开', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await entry(page).locator('[data-toc-toggle]').click();
    const m = await motion();
    expect(m.duration).toBe(120);
    expect(m.frames[0].transform).toBe('translateY(-4px)');
    expect(m.frames[1].transform).toBe('translateY(0px)');
    await page.keyboard.press('Escape');
    await expect(entry(page).locator('[data-toc-toggle]')).toHaveAttribute('aria-expanded', 'false');
  });

  await test.step('减少动态效果', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await entry(page).locator('[data-toc-toggle]').click();
    const m = await motion();
    expect(m.duration).toBe(80);
    expect(m.frames.map((f) => f.transform)).toEqual(['none', 'none']);
    expect(m.frames.map((f) => f.opacity)).toEqual(['0', '1']);
  });
});
