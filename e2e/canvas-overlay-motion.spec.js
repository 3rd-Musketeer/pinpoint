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

// 预热之后点开只剩把 iframe 移进来，140ms 的进入动画可能在下一次采样前就播完。
// 等它出现再读（fill:both，播完仍留在元素上），不改要验的时长。
const motion = (page) => page.evaluate(() => new Promise((resolve) => {
  const read = () => {
    const anim = document.querySelector('.ov-panel')?.getAnimations().find((a) => a.effect?.getTiming);
    if (!anim) return false;
    const frames = anim.effect.getKeyframes().map((f) => ({
      opacity: String(f.opacity), transform: f.transform,
    }));
    resolve({ duration: anim.effect.getTiming().duration, easing: anim.effect.getTiming().easing, frames });
    return true;
  };
  if (read()) return;
  const obs = new MutationObserver(() => { if (read()) obs.disconnect(); });
  obs.observe(document.querySelector('.ov-panel'), { attributes: true });
}));

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
  // 冷开要真的冷：卡片帧扣住，卡片摆不好，空闲预热（E2）就不开始。不扣的话预热可能已经
  // 把工作台装好停着，点开后准备态一闪就收，量不到它的盒子。扣到点开之后再放行。
  const held = [];
  let holding = true;
  await page.route('**/api/frame?*embed=card*', (route) => (holding ? held.push(route) : route.continue()));
  await openArticle(page);

  await test.step('冷开：头和「正在准备画布…」在工作台装好之前就在', async () => {
    expect(await page.evaluate(() => window.pinpointOverlay.phase())).toBe('absent');
    await openFromTop(page);
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('[data-ov-title]')).not.toBeEmpty();
    await expect(status(page)).toHaveText('正在准备画布…');
    const box = await status(page).boundingBox();
    expect(box, '准备态要占得见').not.toBeNull();
    expect(box.height).toBeGreaterThan(16);
    holding = false;
    for (const route of held.splice(0)) await route.continue();
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

// 代次是文档常量（C1 修复轮）：工作台 boot 后 url-sync 会把 ?gen= 从地址里改写掉。
// board 失败、点工作台自己的重试恢复后，同一文档再报的 ready 必须还带原来的代次，
// 否则文章页把它当旧文档的消息丢掉，此后再开浮层都不再定位。
test('画布浮层：board 失败后点工作台自己的重试，再开浮层照常定位', async ({ page }) => {
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
  await expect(status(page)).toBeHidden({ timeout: 5_000 });
  fail = false;
  await retry.click();
  await expect(inner.locator('#wb-board-panel [data-screen]')).toHaveCount(5, { timeout: 30_000 });
  await overlay(page).locator('[data-ov-close]').click();
  await expect(overlay(page)).not.toHaveAttribute('open', '');
  await openFromCard(page);
  await expect(overlay(page)).toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => window.pinpointOverlay.state()?.landing), { timeout: 30_000 }).toBe('section');
  await expect(status(page)).toBeHidden();
});

// 文档被换掉（C1 修复轮）：iframe 里的工作台就绪后又被重新加载（dev 下 full-reload、
// 右键重新加载框架），旧文档报过的 ready 不能替新文档作数。
const landing = (page) => page.evaluate(() => window.pinpointOverlay.state()?.landing);
const reloadCanvas = (page) => page.evaluate(() => window.pinpointOverlay.frame().contentWindow.location.reload());

test('画布浮层：就绪后工作台被重新加载且装不上，再开显示重试、不抛错，点了恢复', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openArticle(page);
  await openFromTop(page);
  await expect.poll(() => landing(page), { timeout: 60_000 }).toBe('section');
  await overlay(page).locator('[data-ov-close]').click();
  await expect(overlay(page)).not.toHaveAttribute('open', '');
  let gone = true;
  await page.route((url) => url.pathname === '/workbench/', (route) => {
    if (gone) return route.fulfill({ status: 500, contentType: 'text/html', body: 'gone' });
    return route.continue();
  });
  await reloadCanvas(page);
  await openFromCard(page);
  await expect(overlay(page)).toHaveAttribute('open', '');
  await expect(status(page)).toContainText('画布没有准备好', { timeout: 30_000 });
  gone = false;
  await status(page).locator('.ov-retry').click();
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => landing(page), { timeout: 30_000 }).toBe('section');
  expect(errors).toEqual([]);
});

test('画布浮层：就绪后工作台被重新加载，新文档装好之前再开出准备态，装好后照常定位', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArticle(page);
  await openFromTop(page);
  await expect.poll(() => landing(page), { timeout: 60_000 }).toBe('section');
  await overlay(page).locator('[data-ov-close]').click();
  await expect(overlay(page)).not.toHaveAttribute('open', '');
  // 扣住新文档的外壳模块：它的请求到了，说明旧文档已经被换掉、新文档在装。
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let requested;
  const started = new Promise((resolve) => { requested = resolve; });
  await page.route('**/src/workbench/app/main.jsx*', async (route) => {
    requested();
    await held;
    await route.continue();
  });
  await reloadCanvas(page);
  await started;
  await openFromCard(page);
  await expect(overlay(page)).toHaveAttribute('open', '');
  await expect(status(page)).toHaveText('正在准备画布…');
  release();
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => landing(page), { timeout: 30_000 }).toBe('section');
});

test('画布浮层：外壳模块慢四秒后放行，准备态收起，画布点得到', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/src/workbench/app/main.jsx*', async (route) => { await held; await route.continue(); });
  await openArticle(page);
  await openFromTop(page);
  await expect(status(page)).toHaveText('正在准备画布…');
  // 扣住超过 4 秒：模块没报失败，不能被当成失败。
  const stayed = await page.evaluate(() => new Promise((resolve) => {
    const start = performance.now();
    const read = () => {
      const el = document.querySelector('[data-ov-status]');
      const text = el && !el.hidden ? el.textContent : '';
      if (text !== '正在准备画布…') { resolve(text); return; }
      if (performance.now() - start > 4200) { resolve(text); return; }
      setTimeout(read, 200);
    };
    read();
  }));
  expect(stayed).toBe('正在准备画布…');
  release();
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
  const frame = overlay(page).frameLocator('iframe.ov-canvas');
  await expect(frame.locator('#wb-board-panel [data-screen]')).toHaveCount(5);
  const box = await overlay(page).locator('.ov-body').boundingBox();
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className || '', {
    x: box.x + box.width / 2, y: box.y + box.height / 2,
  });
  expect(hit).toContain('ov-canvas');
});

test('画布浮层：启动脚本没起来显示重试，重试后就绪', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let fail = true;
  await page.route('**/src/workbench/stage.js*', (route) => {
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
  await expect(overlay(page).frameLocator('iframe.ov-canvas').locator('#wb-board-panel [data-screen]')).toHaveCount(5);
});

test('画布浮层：重试按钮聚焦后按 Enter 发起新请求', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let requests = 0;
  let fail = true;
  await page.route('**/src/workbench/stage.js*', (route) => {
    requests += 1;
    if (fail) return route.abort('failed');
    return route.continue();
  });
  await openArticle(page);
  await openFromTop(page);
  const retry = overlay(page).locator('.ov-retry');
  await expect(retry).toBeVisible({ timeout: 15_000 });
  await retry.focus();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 700)));
  expect(await page.evaluate(() => document.activeElement?.className || '')).toContain('ov-retry');
  fail = false;
  await page.keyboard.press('Enter');
  await expect.poll(() => requests).toBeGreaterThan(1);
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
});

test('画布浮层：外壳入口明确失败显示重试，点了恢复', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const how of ['abort', '503']) {
    let fail = true;
    await page.route('**/src/workbench/app/main.jsx*', (route) => {
      if (!fail) return route.continue();
      return how === 'abort' ? route.abort('failed') : route.fulfill({ status: 503, body: 'no' });
    });
    await openArticle(page);
    await openFromTop(page);
    const retry = overlay(page).locator('.ov-retry');
    await expect(retry, how).toBeVisible({ timeout: 15_000 });
    const box = await retry.boundingBox();
    expect(box.height, how).toBeGreaterThan(20);
    fail = false;
    await retry.click();
    await expect(status(page)).toBeHidden({ timeout: 30_000 });
    await page.unroute('**/src/workbench/app/main.jsx*');
    await overlay(page).locator('[data-ov-close]').click();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
  }
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

test('画布浮层：入口模块在等待就绪期间才失败，也给出重试；重试时入口慢也能收起', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let mode = 'hold-then-fail';
  let release = null;
  await page.route('**/src/workbench/app/main.jsx*', async (route) => {
    if (mode === 'hold-then-fail') {
      // 扣住，等父页面已经进入“等就绪”再失败：失败发生在 watchReady 的等待里面。
      await new Promise((resolve) => { release = resolve; });
      return route.abort('failed');
    }
    // 重试这次入口慢 3 秒才回：旧文档的 workbench 在新文档装好前还读得到，不能拿它卡住观察。
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return route.continue();
  });
  await openArticle(page);
  await openFromTop(page);
  const frame = overlay(page).locator('iframe.ov-canvas');
  // 帧已经挂上，父页面卡在 whenBoardSettled 的等待里（板要等 main.jsx 放行 chrome-ready）。
  await expect.poll(() => frame.evaluate((el) => el.contentWindow.document.querySelectorAll('[data-screen]').length), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(status(page)).toHaveText(/正在准备画布/);
  await expect.poll(() => release !== null).toBe(true);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500))); // 静默窗口：让父页面确实进入等待
  release();
  const retry = overlay(page).locator('.ov-retry');
  await expect(retry).toBeVisible({ timeout: 15_000 });
  mode = 'slow-ok';
  await retry.click();
  await expect(status(page)).toBeHidden({ timeout: 30_000 });
  const box = await frame.boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className || '', [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toContain('ov-canvas');
});

// 预热与停驻（E2）。iframe 不移动，停驻的就是打开时那一份文档：点开只剩恢复与收起准备态。
// 2026-10-19 实测（loadavg 约 4）：停驻后第一次点开 25ms、关掉再开 4ms；main 的再开 4ms；
// 修前（每次开关挪 iframe、文档重装）176–256ms。上限 120ms：实测的约 4 倍，低于修前最快的一次。
// 文档身份另有标记断言，不只靠计时。
const OPEN_BUDGET_MS = 120;

test('画布浮层：预热停驻后点开在预算内可交互，停驻 3 秒工作台不再排回调', async ({ page }) => {
  test.setTimeout(180_000);
  let parkedBody = null;
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArticle(page);

  await test.step('正文和可见卡片完成后才预热，停驻容器按打开时的尺寸', async () => {
    await expect.poll(() => page.evaluate(() => window.pinpointOverlay?.settled() && window.pinpointOverlay?.phase()), { timeout: 60_000 }).toBe('parked');
    const parked = await page.evaluate(() => {
      const dlg = document.querySelector('[data-pp-overlay]');
      const cs = getComputedStyle(dlg);
      // 布局尺寸（offset*），不看 transform：开合动画会缩放面板。
      const el = dlg.querySelector('[data-ov-body]');
      const body = { width: el.offsetWidth, height: el.offsetHeight };
      return {
        open: dlg.hasAttribute('open'),
        held: dlg.hasAttribute('data-ov-held'),
        inert: dlg.inert,
        hidden: cs.visibility,
        display: cs.display,
        pointer: cs.pointerEvents,
        inDialog: !!dlg.querySelector('[data-ov-body] iframe.ov-canvas'),
        body: [Math.round(body.width), Math.round(body.height)],
      };
    });
    expect(parked).toMatchObject({ open: false, held: true, inert: true, hidden: 'hidden', display: 'flex', pointer: 'none', inDialog: true });
    // 停驻态按打开时的布局排版：画布区的尺寸与打开后一致（打开后再比一次）。
    parkedBody = parked.body;
    expect(parkedBody[0]).toBeGreaterThan(100);
    expect(parkedBody[1]).toBeGreaterThan(100);
    // 关着的浮层不挡正文：视口中心点到的是正文，不是 dialog。
    const hit = await page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-pp-overlay]'));
    expect(hit).toBe(false);
    // 文档身份：停驻时挂上标记，打开、关、再开都应还在（iframe 不移动就不重装）。
    await page.evaluate(() => { window.pinpointOverlay.frame().contentWindow.__docMark = 'parked-doc'; });
  });

  await test.step('停驻 3 秒：工作台不再排定时器与动画帧', async () => {
    await page.evaluate(() => {
      const win = window.pinpointOverlay.frame().contentWindow;
      const counts = { timeout: 0, interval: 0, raf: 0 };
      const orig = { timeout: win.setTimeout, interval: win.setInterval, raf: win.requestAnimationFrame };
      win.setTimeout = function (...args) { counts.timeout += 1; return orig.timeout.apply(this, args); };
      win.setInterval = function (...args) { counts.interval += 1; return orig.interval.apply(this, args); };
      win.requestAnimationFrame = function (...args) { counts.raf += 1; return orig.raf.apply(this, args); };
      win.__parkProbe = {
        counts,
        restore: () => { win.setTimeout = orig.timeout; win.setInterval = orig.interval; win.requestAnimationFrame = orig.raf; },
      };
    });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 3000))); // 静默窗口：停驻期间不该有新回调
    const counts = await page.evaluate(() => {
      const probe = window.pinpointOverlay.frame().contentWindow.__parkProbe;
      const out = { ...probe.counts };
      probe.restore();
      return out;
    });
    expect(counts).toEqual({ timeout: 0, interval: 0, raf: 0 });
  });

  // 点开到可交互：舞台有真实尺寸、帧挂上了、准备态收起。不等落点（落点是定位，预热省下的是装载）。
  const timedOpen = () => page.evaluate(async () => {
    const start = performance.now();
    document.querySelector('#btn-canvas').click();
    const deadline = start + 20000;
    for (;;) {
      const win = window.pinpointOverlay?.frame()?.contentWindow;
      const stage = win?.document?.querySelector('#wbstage');
      const box = stage?.getBoundingClientRect();
      const ready = window.pinpointOverlay?.phase() === 'open'
        && box && box.width > 100 && box.height > 100
        && win.document.querySelector('.wb-screen')
        && document.querySelector('[data-ov-status]')?.hidden;
      if (ready || performance.now() > deadline) return performance.now() - start;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
  const docMark = () => page.evaluate(() => window.pinpointOverlay.frame().contentWindow.__docMark || null);

  await test.step('点开到可交互在预算内，文档还是停驻的那一份', async () => {
    const elapsed = await timedOpen();
    console.log(`[E2] 停驻后点开 ${Math.round(elapsed)}ms`);
    expect(elapsed).toBeLessThanOrEqual(OPEN_BUDGET_MS);
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(status(page)).toBeHidden();
    expect(await docMark()).toBe('parked-doc');
    const opened = await page.evaluate(() => {
      const dlg = document.querySelector('[data-pp-overlay]');
      const el = dlg.querySelector('[data-ov-body]');
      return { held: dlg.hasAttribute('data-ov-held'), inert: dlg.inert, body: [el.offsetWidth, el.offsetHeight] };
    });
    expect(opened).toEqual({ held: false, inert: false, body: parkedBody });
    const hit = await page.evaluate(() => {
      const frame = document.querySelector('[data-pp-overlay] iframe.ov-canvas');
      const r = frame.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.className || '';
    });
    expect(hit).toContain('ov-canvas');
  });

  await test.step('关掉再开：仍在预算内，文档没重装', async () => {
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => page.evaluate(() => window.pinpointOverlay.phase())).toBe('parked');
    expect(await docMark()).toBe('parked-doc');
    const elapsed = await timedOpen();
    console.log(`[E2] 关掉再开 ${Math.round(elapsed)}ms`);
    expect(elapsed).toBeLessThanOrEqual(OPEN_BUDGET_MS);
    expect(await docMark()).toBe('parked-doc');
  });
});

// 停驻的工作台不占 /events（HTTP/1.1 同源 6 条连接，src/workbench/server-events.js）：
// 预热前文章页自己两条，预热后不该变成四条，否则多开一两个标签页请求就排队堵住
// （2026-10-19 owner-flows「改稿」：看板 2 + 文章 2 + 停驻工作台 2 + 静态文章 = 7，静态卡片取样式卡死）。
// 断开期间的推送不丢：打开时重连并补读，停驻时别处写进账本的那一条要在画布上。
test('画布浮层：停驻的工作台断开 /events，打开后重连并补上停驻期间的标注', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const open = new Set();
  const inWorkbench = (frame) => { for (let f = frame; f; f = f.parentFrame()) if (new URL(f.url()).pathname.startsWith('/workbench/')) return true; return false; };
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/events' && inWorkbench(r.frame())) open.add(r); });
  page.on('requestfinished', (r) => open.delete(r));
  page.on('requestfailed', (r) => open.delete(r));
  await openArticle(page);
  await expect.poll(() => page.evaluate(() => window.pinpointOverlay?.phase()), { timeout: 60_000 }).toBe('parked');
  // 标注实例装上之后再数：它的 /events 在就绪前后才开。
  await expect.poll(() => page.evaluate(() => !!window.pinpointOverlay.frame()?.contentWindow?.pinpoint?.whenReady), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => open.size, { timeout: 10_000 }).toBe(0);
  // 文档身份：补上的那一条要靠恢复时的补读，不是文档重装后的首次 hydrate。
  await page.evaluate(() => { window.pinpointOverlay.frame().contentWindow.__docMark = 'parked-doc'; });

  const { pageId, screen } = await page.evaluate(() => ({
    pageId: document.querySelector('[data-pp-canvas]').dataset.page,
    screen: document.querySelector('[data-pp-canvas] .cc-frame[data-screen]').dataset.screen,
  }));
  const endpoint = `/annotations/${encodeURIComponent('@canvas')}?entry=${encodeURIComponent(pageId)}`;
  const before = await (await request.get(endpoint)).json();
  const row = { id: 'e2-parked-row', screenId: screen, status: 'open', content: '停驻期间写进来的', messages: [], targets: [] };
  try {
    const saved = await request.post('/save', { data: { entry: pageId, page: '@canvas', path: '/', baseRevision: before.revision, annotations: [...(before.annotations || []), row] } });
    expect(saved.ok(), await saved.text()).toBe(true);
    await openFromTop(page);
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect.poll(() => open.size, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => {
      const ann = window.pinpointOverlay.frame().contentWindow.pinpoint;
      return !!ann && ann.getState().connected && ann.marks.some((m) => m.id === 'e2-parked-row');
    }), { timeout: 30_000 }).toBe(true);
    expect(await page.evaluate(() => window.pinpointOverlay.frame().contentWindow.__docMark)).toBe('parked-doc');
  } finally {
    const now = await (await request.get(endpoint)).json();
    await request.post('/save', { data: { entry: pageId, page: '@canvas', path: '/', baseRevision: now.revision, annotations: (now.annotations || []).filter((a) => a.id !== row.id) } });
  }
});


// 停驻跨过整分钟：ios-kit 的状态栏时钟此前在停驻里照样到点排定时器，诊断上传也照样续排，
// 3 秒窗口碰上整分钟就挂。用假时钟快进 65 秒，确定性地跨过一次整分钟。
test('画布浮层：停驻跨过整分钟，工作台不再排定时器', async ({ page }) => {
  test.setTimeout(180_000);
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArticle(page);
  await expect.poll(() => page.evaluate(() => window.pinpointOverlay?.settled() && window.pinpointOverlay?.phase()), { timeout: 60_000 }).toBe('parked');
  await page.evaluate(() => {
    const win = window.pinpointOverlay.frame().contentWindow;
    const counts = { timeout: 0, interval: 0 };
    const orig = { timeout: win.setTimeout, interval: win.setInterval };
    win.setTimeout = function (...args) { counts.timeout += 1; return orig.timeout.apply(this, args); };
    win.setInterval = function (...args) { counts.interval += 1; return orig.interval.apply(this, args); };
    win.__minuteProbe = { counts, restore: () => { win.setTimeout = orig.timeout; win.setInterval = orig.interval; } };
  });
  await page.clock.runFor(65_000);
  const counts = await page.evaluate(() => {
    const probe = window.pinpointOverlay.frame().contentWindow.__minuteProbe;
    const out = { ...probe.counts };
    probe.restore();
    return out;
  });
  expect(counts).toEqual({ timeout: 0, interval: 0 });
});
