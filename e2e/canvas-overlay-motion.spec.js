import { expect, test } from './lib/fixtures.js';

import { proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';

// 画布浮层的转场和加载态（site/README.md「画布浮层」）。点开后立刻看到头和「正在准备画布…」，
// 面板进入 140ms opacity + scale .985，退出 100ms可打断；就绪信号到了才收起状态。

const ARTICLE = '/e2e-project/commit-confirm/';

const overlay = (page) => page.locator('dialog[data-pp-overlay]');
const panel = (page) => overlay(page).locator('.ov-panel');
const status = (page) => overlay(page).locator('[data-ov-status]');

async function openArticle(page) {
  await page.goto(ARTICLE);
  await expect(page.locator('#article .prose h1')).toHaveText('提交前确认', { timeout: 150_000 });
  await waitNoReload(page);
  await proseSettled(page);
}

const motion = (page) => page.evaluate(() => {
  const anim = document.querySelector('.ov-panel')?.getAnimations().find((a) => a.playState !== 'finished');
  if (!anim) return null;
  const frames = anim.effect.getKeyframes().map((f) => ({
    opacity: String(f.opacity), transform: f.transform,
  }));
  return { duration: anim.effect.getTiming().duration, easing: anim.effect.getTiming().easing, frames };
});

const origin = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.ov-panel')).transformOrigin);

async function openFromTop(page) {
  await page.locator('#btn-canvas').click();
}

async function openFromCard(page) {
  const card = page.locator('[data-pp-canvas][data-pp-section="confirm"]');
  await card.scrollIntoViewIfNeeded();
  await card.locator('[data-pp-open]').click();
}

test('画布浮层：点开立刻有头和准备态，就绪后收起；重开不再装', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArticle(page);

  await test.step('冷开：头和「正在准备画布…」在工作台装好之前就在', async () => {
    await openFromTop(page);
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('[data-ov-title]')).not.toBeEmpty();
    await expect(status(page)).toHaveText('正在准备画布…');
    const box = await status(page).boundingBox();
    expect(box, '准备态要占得见').not.toBeNull();
    expect(box.height).toBeGreaterThan(16);
  });

  await test.step('板和预览都就绪后状态消失', async () => {
    await expect.poll(() => page.evaluate(() => {
      const w = window.pinpointOverlay?.frame()?.contentWindow;
      return w?.workbench?.activePageId?.() || '';
    }), { timeout: 60_000 }).toBe('e2e-project_commit-confirm');
    await expect(status(page)).toBeHidden({ timeout: 30_000 });
    await expect(overlay(page).locator('iframe.ov-canvas')).toBeVisible();
  });

  await test.step('重开：iframe 还是那一个，不再出现准备态', async () => {
    await overlay(page).locator('[data-ov-close]').click();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await openFromTop(page);
    await expect(status(page)).toBeHidden();
    expect(await page.locator('[data-pp-overlay] iframe.ov-canvas').count()).toBe(1);
  });
});

test('画布浮层：进入 140ms scale .985，退出 100ms；途中关闭从当前值反向；连续开关不卡住', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openArticle(page);

  await test.step('顶栏入口：从上方放大', async () => {
    await openFromTop(page);
    const m = await motion(page);
    expect(m.duration).toBe(140);
    expect(m.easing).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
    expect(m.frames[0].transform).toBe('scale(0.985)');
    expect(m.frames[1].transform).toBe('scale(1)');
    const o = await origin(page);
    const [x, y] = o.split(' ').map(parseFloat);
    expect(x, o).toBeGreaterThan(600);
    expect(y, o).toBeLessThan(200);
  });

  await test.step('进入途中关闭：100ms，从当前呈现值走，关闭按钮始终能点', async () => {
    await overlay(page).locator('[data-ov-close]').click();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => page.evaluate(() => document.querySelector('.ov-panel').getAnimations().every((a) => a.playState === 'finished'))).toBe(true);
    const closeBtn = await page.locator('#btn-canvas').boundingBox();
    expect(closeBtn.height).toBeGreaterThan(20);
    const reversed = await page.evaluate(() => new Promise((resolve) => {
      document.querySelector('#btn-canvas').addEventListener('click', () => {
        const panel = document.querySelector('.ov-panel');
        const sample = () => {
          const live = panel.getAnimations().filter((a) => a.playState === 'running');
          const opening = live.find((a) => a.effect.getTiming().duration === 140);
          const at = getComputedStyle(panel).opacity;
          if (!opening || Number(at) === 0) { requestAnimationFrame(sample); return; }
          document.querySelector('[data-ov-close]').click();
          requestAnimationFrame(() => {
            const anim = panel.getAnimations().find((a) => a.playState === 'running');
            resolve({ duration: anim.effect.getTiming().duration, start: anim.effect.getKeyframes()[0].opacity, opacity: at });
          });
        };
        requestAnimationFrame(sample);
      }, { once: true });
      document.querySelector('#btn-canvas').click();
    }));
    expect(reversed.duration, JSON.stringify(reversed)).toBe(100);
    expect(Number(reversed.start), JSON.stringify(reversed)).toBeGreaterThan(0);
    expect(Number(reversed.start)).toBeLessThan(1);
    expect(Number(reversed.opacity)).toBeGreaterThan(0);
    expect(Number(reversed.opacity)).toBeLessThan(1);
    await expect(overlay(page)).not.toHaveAttribute('open', '', { timeout: 2_000 });
  });

  await test.step('连续开关三次：最后一次还是开着的', async () => {
    for (let i = 0; i < 3; i += 1) {
      await openFromTop(page);
      await overlay(page).locator('[data-ov-close]').click();
    }
    await openFromTop(page);
    await expect(overlay(page)).toHaveAttribute('open', '');
    await overlay(page).locator('[data-ov-close]').click();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
  });

  await test.step('origin 跟着入口：上段取顶，下段取底', async () => {
    const opener = page.locator('[data-pp-open]').first();
    const measure = async (y) => {
      await opener.evaluate((el, top) => { el.style.position = 'fixed'; el.style.top = `${top}px`; }, y);
      await opener.click();
      const got = await page.evaluate(() => {
        const panel = document.querySelector('.ov-panel');
        return {
          origin: parseFloat(getComputedStyle(panel).transformOrigin.split(' ')[1]),
          h: panel.getBoundingClientRect().height,
        };
      });
      await overlay(page).locator('[data-ov-close]').click();
      await expect(overlay(page)).not.toHaveAttribute('open', '');
      return got;
    };
    const top = await measure(40);
    const bottom = await measure(860);
    await opener.evaluate((el) => { el.style.position = ''; });
    expect(top.origin).toBeLessThan(top.h * 0.2);
    expect(bottom.origin).toBeGreaterThan(bottom.h * 0.8);
  });
});

test('画布浮层：减少动态效果只做 80ms 淡入淡出', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openArticle(page);
  await openFromTop(page);
  const m = await motion(page);
  expect(m.duration).toBe(80);
  expect(m.frames.map((f) => f.transform)).toEqual(['none', 'none']);
  expect(m.frames.map((f) => f.opacity)).toEqual(['0', '1']);

  await test.step('关闭同样 80ms 淡出', async () => {
    await expect.poll(() => page.evaluate(() => document.querySelector('.ov-panel').getAnimations().every((a) => a.playState === 'finished'))).toBe(true);
    const closing = page.evaluate(() => new Promise((resolve) => {
      document.querySelector('[data-ov-close]').addEventListener('click', () => {
        requestAnimationFrame(() => {
          const anim = document.querySelector('.ov-panel').getAnimations().find((a) => a.playState === 'running');
          resolve(anim ? { duration: anim.effect.getTiming().duration, frames: anim.effect.getKeyframes().map((f) => String(f.opacity)) } : null);
        });
      }, { once: true });
    }));
    await overlay(page).locator('[data-ov-close]').click();
    const got = await closing;
    expect(got.duration).toBe(80);
    expect(got.frames).toEqual(['1', '0']);
  });
});

test('画布浮层：board 慢一拍不算失败，就绪后准备态收起', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/board.json', async (route) => { await held; await route.continue(); });
  await openArticle(page);
  await openFromTop(page);
  await expect(status(page)).toHaveText('正在准备画布…');
  // 扣住期间反复读：超过原先约 0.8 秒的误判线，状态也不能变成重试。
  const stayed = await page.evaluate(() => new Promise((resolve) => {
    const start = performance.now();
    const read = () => {
      const el = document.querySelector('[data-ov-status]');
      const text = el && !el.hidden ? el.textContent : '';
      if (text !== '正在准备画布…') { resolve(text); return; }
      if (performance.now() - start > 1200) { resolve(text); return; }
      setTimeout(read, 100);
    };
    read();
  }));
  expect(stayed).toBe('正在准备画布…');
  release();
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
  const frames = await page.frameLocator('[data-pp-overlay] iframe.ov-canvas').locator('#wb-board-panel [data-screen]');
  await expect(frames).toHaveCount(5);
});

test('画布浮层：没就绪就关，重开后就绪了准备态收起', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/workbench/?*', async (route) => { await held; await route.continue(); });
  await openArticle(page);
  await openFromTop(page);
  await expect(status(page)).toHaveText('正在准备画布…');
  await overlay(page).locator('[data-ov-close]').click();
  await expect(overlay(page)).not.toHaveAttribute('open', '');
  await openFromTop(page);
  await expect(status(page)).toHaveText('正在准备画布…');
  release();
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
});

test('画布浮层：iframe 加载失败显示重试，重试后就绪', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let failed = false;
  await page.route('**/workbench/?*', (route) => {
    if (!failed) { failed = true; return route.abort('failed'); }
    return route.continue();
  });
  await openArticle(page);
  await openFromTop(page);
  await expect(overlay(page).locator('.ov-retry')).toBeVisible({ timeout: 15_000 });
  const box = await overlay(page).locator('.ov-retry').boundingBox();
  expect(box.height).toBeGreaterThan(20);
  await overlay(page).locator('.ov-retry').click();
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
});

test('画布浮层：board 失败时工作台自己的重试按钮点得到', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let fail = true;
  await page.route('**/board.json', (route) => {
    if (fail) return route.fulfill({ status: 503, body: 'temporarily unavailable' });
    return route.continue();
  });
  await openArticle(page);
  await openFromTop(page);
  const inner = overlay(page).frameLocator('iframe.ov-canvas');
  const retry = inner.locator('[data-err-retry="board"]');
  await expect(retry).toBeVisible({ timeout: 30_000 });
  // 父页面每 100ms 才收一次准备态。等它收起，再看按钮中心点到的是 iframe 而不是准备态。
  await expect(status(page)).toBeHidden({ timeout: 5_000 });
  const box = await retry.boundingBox();
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className || '', {
    x: box.x + box.width / 2, y: box.y + box.height / 2,
  });
  expect(hit, '准备态不能盖住工作台的重试').toContain('ov-canvas');
  fail = false;
  await retry.click();
  await expect(inner.locator('#wb-board-panel [data-screen]')).toHaveCount(5, { timeout: 30_000 });
});

test('画布浮层：外壳模块失败显示重试，重试后就绪', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let fail = true;
  await page.route('**/src/workbench/app/main.jsx*', (route) => {
    if (fail) return route.abort('failed');
    return route.continue();
  });
  await openArticle(page);
  await openFromTop(page);
  await expect(overlay(page).locator('.ov-retry')).toBeVisible({ timeout: 15_000 });
  const box = await overlay(page).locator('.ov-retry').boundingBox();
  expect(box.height).toBeGreaterThan(20);
  fail = false;
  await overlay(page).locator('.ov-retry').click();
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
  await expect(overlay(page).frameLocator('iframe.ov-canvas').locator('#wbstrip > *')).not.toHaveCount(0);
});

test('画布浮层：连续两次失败后第三次重试成功', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let requests = 0;
  await page.route('**/workbench/?*', (route) => {
    requests += 1;
    if (requests <= 2) return route.abort('failed');
    return route.continue();
  });
  await openArticle(page);
  await openFromTop(page);
  await expect(overlay(page).locator('.ov-retry')).toBeVisible({ timeout: 15_000 });
  await overlay(page).locator('.ov-retry').click();
  await expect(overlay(page).locator('.ov-retry')).toBeVisible({ timeout: 15_000 });
  await overlay(page).locator('.ov-retry').click();
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
  expect(requests).toBe(3);
});

test('画布浮层：失败后关掉再开，重试还在', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/workbench/?*', (route) => route.abort('failed'));
  await openArticle(page);
  await openFromTop(page);
  await expect(overlay(page).locator('.ov-retry')).toBeVisible({ timeout: 15_000 });
  await overlay(page).locator('[data-ov-close]').click();
  await expect(overlay(page)).not.toHaveAttribute('open', '');
  await openFromTop(page);
  await expect(overlay(page).locator('.ov-retry')).toBeVisible({ timeout: 5_000 });
  const box = await overlay(page).locator('.ov-retry').boundingBox();
  expect(box.height).toBeGreaterThan(20);
});

test('画布浮层：加载中重开，Esc 仍然能关', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/workbench/?*', async (route) => { await held; await route.continue(); });
  await openArticle(page);
  await openFromTop(page);
  await page.keyboard.press('Escape');
  await expect(overlay(page)).not.toHaveAttribute('open', '');
  await openFromTop(page);
  await expect(overlay(page)).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(overlay(page)).not.toHaveAttribute('open', '', { timeout: 2_000 });
  release();
});

test('画布浮层：后退关闭，滚动位置回到打开前', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openArticle(page);
  const card = page.locator('[data-pp-canvas][data-pp-section="confirm"]');
  await card.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(100);
  await card.locator('[data-pp-open]').click();
  await expect(overlay(page)).toHaveAttribute('open', '');
  await page.goBack();
  await expect(overlay(page)).not.toHaveAttribute('open', '');
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});
