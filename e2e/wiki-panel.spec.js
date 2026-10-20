import { expect, test } from './lib/fixtures.js';

import { E2E_BASE_URL } from './env.js';
import { proseSettled } from './lib/prose.js';
import { captureMotion } from './lib/motion.js';
import { waitNoReload } from './site-settle.js';

// wiki 面板（site/README.md「弹层与 Esc」）：从顶栏 wiki 按钮右下角展开，
// Esc、点外部、关闭按钮都能关，关闭后焦点回按钮；打开 140 ms、关闭 100 ms，可反向。
// 固件与 article-site 同一篇：e2e-project/commit-confirm，有两条 wiki、一个空 ref。

const ARTICLE = '/e2e-project/commit-confirm/';

async function openArticle(page) {
  await page.goto(ARTICLE);
  await expect(page.locator('#article .prose h1')).toHaveText('提交前确认', { timeout: 150_000 });
  await waitNoReload(page);
  await proseSettled(page);
}

const wikiBtn = (page) => page.locator('#btn-wiki');
const panel = (page) => page.locator('#drawer');

/** 面板当前这条动画的时长、缓动、位移关键帧。已经播完还挂着的不算（fill: both 会留到下一条开始），没有动画时返回 null。 */
const motion = (page) => page.evaluate(() => {
  const running = document.getElementById('drawer')?.getAnimations().find((a) => a.playState !== 'finished');
  if (!running) return null;
  const effect = running.effect;
  const frames = effect.getKeyframes().map((f) => ({ opacity: f.opacity, transform: f.transform }));
  return { duration: effect.getTiming().duration, easing: effect.getTiming().easing, frames, playState: running.playState };
});

test('wiki 面板：锚在按钮右下角，Esc、点外部、关闭按钮都能关，焦点回去，不扔草稿', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await openArticle(page);

  await test.step('打开：面板右缘对齐按钮右缘，顶在按钮下 8px，宽 320，带标题和 28px 关闭按钮', async () => {
    await wikiBtn(page).click();
    await expect(wikiBtn(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page)).toBeVisible();
    // 打开动画把面板上移 6px，fill: both 落定后仍算在 getBoundingClientRect 里：等它播完，量的时候扣掉这段位移。
    await expect.poll(() => motion(page)).toBeNull();
    const placed = await page.evaluate(() => {
      const b = document.getElementById('btn-wiki').getBoundingClientRect();
      const el = document.getElementById('drawer');
      const p = el.getBoundingClientRect();
      // fill: both 的终点 translateY 还在，布局位置要扣掉它。
      const shift = new DOMMatrix(getComputedStyle(el).transform).m42 || 0;
      const x = document.querySelector('#drawer [data-drawer-close]').getBoundingClientRect();
      const top = document.querySelector('.top').getBoundingClientRect();
      return {
        // 间距相对顶栏底边：按钮比顶栏矮，锚在按钮下沿会压住同一行的关闭入口。
        gap: p.top - top.bottom,
        rightDelta: p.right - b.right, width: p.width,
        close: { w: x.width, h: x.height },
        belowBar: p.top >= top.bottom,
        title: document.querySelector('#drawer .drawer-title')?.textContent || '',
      };
    });
    expect(placed.gap).toBeGreaterThanOrEqual(7);
    expect(placed.gap).toBeLessThanOrEqual(9);
    expect(Math.abs(placed.rightDelta)).toBeLessThanOrEqual(1);
    expect(placed.width).toBeGreaterThanOrEqual(319);
    expect(placed.width).toBeLessThanOrEqual(321);
    expect(placed.close).toEqual({ w: 28, h: 28 });
    expect(placed.belowBar).toBe(true);
    expect(placed.title).toBe('wiki');
    // 空 ref 仍是说明，不是错误。
    await expect(panel(page).locator('h3').nth(1)).toHaveText('空 ref（还没有页）');
    await expect(panel(page).locator('li', { hasText: 'risk-score' })).toContainText('引用 1 次');
  });

  await test.step('打开动画：140 ms、cubic-bezier(.2,.8,.2,1)、translateY(-6px)→0', async () => {
    const m = await page.evaluate(() => {
      const anim = document.getElementById('drawer').getAnimations().at(-1);
      const frames = anim.effect.getKeyframes().map((f) => ({ opacity: f.opacity, transform: f.transform }));
      return { duration: anim.effect.getTiming().duration, easing: anim.effect.getTiming().easing, frames };
    });
    expect(m.duration).toBe(140);
    expect(m.easing).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
    expect(m.frames[0].transform).toBe('translateY(-6px)');
    expect(m.frames[1].transform).toBe('translateY(0px)');
  });

  await test.step('点外部关闭，焦点回 wiki 按钮', async () => {
    await page.locator('#article .prose h1').click();
    await expect(panel(page)).toBeHidden();
    await expect(wikiBtn(page)).toBeFocused();
    await expect(wikiBtn(page)).toHaveAttribute('aria-expanded', 'false');
  });

  await test.step('关闭按钮关闭，焦点回 wiki 按钮', async () => {
    await wikiBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await panel(page).locator('[data-drawer-close]').click();
    await expect(panel(page)).toBeHidden();
    await expect(wikiBtn(page)).toBeFocused();
  });

  await test.step('Esc 关面板；popup 在上面时 Esc 只关 popup', async () => {
    await wikiBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await page.locator('.cref.empty[data-name="risk-score"]').click();
    await expect(page.locator('.pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.pop')).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(wikiBtn(page)).toBeFocused();
  });

  await test.step('Tab 从按钮进面板，Shift+Tab 从面板首项回到按钮', async () => {
    await wikiBtn(page).focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    // 打开动画从 opacity 0 起，没落定前面板不在 Tab 顺序里。
    await expect.poll(() => motion(page)).toBeNull();
    await page.keyboard.press('Tab');
    await expect(panel(page).locator('[data-drawer-close]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(wikiBtn(page)).toBeFocused();
  });

  await test.step('关面板不取消正在写的正文草稿', async () => {
    await page.locator('#article .prose p').first().evaluate((el) => {
      const range = document.createRange();
      const node = el.firstChild;
      range.setStart(node, 0);
      range.setEnd(node, Math.min(4, node.textContent.length));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const draftBtn = page.locator('.pp-selbtn');
    await expect(draftBtn).toBeVisible();
    await draftBtn.click();
    const draft = page.locator('textarea[data-reply="__draft"]');
    await expect(draft).toBeVisible();
    await draft.fill('先记一笔');
    await wikiBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(draft).toHaveValue('先记一笔');
  });

  expect(pageErrors).toEqual([]);
});

test('wiki 面板：途中再点从当前值反向；减少动态效果只淡入淡出', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openArticle(page);

  await test.step('打开途中再点关闭：新动画从当前呈现值开始，100 ms', async () => {
    // 采样和反向点击放在同一次调用里：两次往返之间 140ms 的动画就播完了，读到的是终点。
    const { motion: back, value: mid } = await captureMotion(panel(page), () => page.evaluate(() => new Promise((resolve) => {
      document.getElementById('btn-wiki').click();
      const el = document.getElementById('drawer');
      const watch = () => {
        const opacity = Number(getComputedStyle(el).opacity);
        if (opacity <= 0.05) { requestAnimationFrame(watch); return; }
        const cs = getComputedStyle(el);
        document.getElementById('btn-wiki').click();
        resolve({ opacity: cs.opacity, transform: cs.transform });
      };
      requestAnimationFrame(watch);
    })));
    expect(Number(mid.opacity)).toBeGreaterThan(0);
    expect(Number(mid.opacity)).toBeLessThan(1);
    expect(back.duration).toBe(100);
    const startOpacity = Number(back.frames[0].opacity);
    expect(startOpacity).toBeGreaterThan(0);
    expect(startOpacity).toBeLessThan(1);
    expect(back.frames[0].transform).not.toBe('translateY(0px)');
    await expect(panel(page)).toBeHidden();
  });

  await test.step('关闭途中再点打开：从当前不透明度往回走，不从 0 重播', async () => {
    await wikiBtn(page).click();
    await expect.poll(() => motion(page)).toBeNull();
    const { motion: again } = await captureMotion(panel(page), () => page.evaluate(() => new Promise((resolve) => {
      document.getElementById('btn-wiki').click();
      const el = document.getElementById('drawer');
      const watch = () => {
        const opacity = Number(getComputedStyle(el).opacity);
        if (opacity >= 0.95) { requestAnimationFrame(watch); return; }
        document.getElementById('btn-wiki').click();
        resolve(opacity);
      };
      requestAnimationFrame(watch);
    })));
    expect(again?.duration).toBe(140);
    const startOpacity = Number(again.frames[0].opacity);
    expect(startOpacity).toBeGreaterThan(0);
    expect(startOpacity).toBeLessThan(1);
    await expect.poll(() => motion(page)).toBeNull();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
  });

  await test.step('减少动态效果：打开和关闭都是 80 ms 淡入淡出，没有位移', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { motion: open } = await captureMotion(panel(page), () => wikiBtn(page).click());
    expect(open.duration).toBe(80);
    expect(open.frames.map((f) => f.transform)).toEqual(['none', 'none']);
    expect(open.frames.map((f) => String(f.opacity))).toEqual(['0', '1']);
    await expect.poll(() => motion(page)).toBeNull();
    const { motion: close } = await captureMotion(panel(page), () => wikiBtn(page).click());
    expect(close.duration).toBe(80);
    expect(close.frames.map((f) => f.transform)).toEqual(['none', 'none']);
    await expect(panel(page)).toBeHidden();
  });
});

test('wiki 面板：390 宽贴左缘、不盖顶栏，宽是视口减 24', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openArticle(page);
  await wikiBtn(page).click();
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => motion(page)).toBeNull();
  const placed = await page.evaluate(() => {
    const p = document.getElementById('drawer').getBoundingClientRect();
    const top = document.querySelector('.top').getBoundingClientRect();
    const x = document.querySelector('#drawer [data-drawer-close]').getBoundingClientRect();
    return { left: p.left, right: p.right, top: p.top, barBottom: top.bottom, closeRight: x.right, vw: innerWidth };
  });
  expect(placed.left).toBeGreaterThanOrEqual(11);
  expect(placed.left).toBeLessThanOrEqual(13);
  expect(placed.right).toBeLessThanOrEqual(placed.vw - 11);
  expect(Math.abs((placed.right - placed.left) - (placed.vw - 24))).toBeLessThanOrEqual(1);
  expect(placed.top).toBeGreaterThanOrEqual(placed.barBottom);
  expect(placed.closeRight).toBeLessThanOrEqual(placed.vw - 11);
  expect(page.url().startsWith(E2E_BASE_URL)).toBe(true);
});
