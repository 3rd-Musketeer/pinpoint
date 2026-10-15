import { expect, test } from '@playwright/test';

import { E2E_BASE_URL } from './env.js';
import { dragSelect, proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';

// pp3：正文里的图（<Figure>，docs/projects.md“图”）。固件：常驻 project e2e-project 的 commit-confirm
// （e2e/project-site/）：节外一张静态时序图 wait-sequence，第 1 节 why 里一个逐步演示 message-flow
// （sidecar 用 pinpoint/figure 的 steps()）。图是同源 iframe（/api/frame?…&embed=figure），高度由图页报上来。
//
// 文件名排在 article-site 后面：那个 spec 要看站点冷启动，同组时得先跑它（scripts/e2e-parallel.mjs SITE_SPECS）。

const ARTICLE = '/e2e-project/commit-confirm/';
const PAGE = 'e2e-project_commit-confirm';

const figure = (page, id) => page.locator(`[data-pp-figure="${id}"]`);
const inner = (page, id) => page.frameLocator(`[data-pp-figure="${id}"] iframe`);

/** iframe 的高度与图页根元素的高度，以及图页有没有滚动余量（应当没有）。 */
const fit = (page, id) => figure(page, id).locator('iframe').evaluate((iframe) => {
  const doc = iframe.contentDocument;
  const root = doc.querySelector('[data-pp-figure-root]');
  return {
    iframe: iframe.clientHeight, // 内容高度（不含 1px 边框）
    root: Math.ceil(root.getBoundingClientRect().height),
    overflow: doc.documentElement.scrollHeight - doc.documentElement.clientHeight,
  };
});

test('正文里的图：同源 iframe 渲染、高度随内容、iframe 里能逐步点、跟着切深浅色、选字不出评论', async ({ page }) => {
  test.setTimeout(180_000);
  // 减少动态效果：演示不自动播放、圆点不走，状态只随点击变。
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const responses = [];
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (url.origin === E2E_BASE_URL) responses.push({ path: url.pathname, search: url.search, status: res.status() });
  });

  await page.goto(ARTICLE);
  await expect(page.locator('#article .prose h1')).toHaveText('提交前确认', { timeout: 150_000 });
  await waitNoReload(page);
  consoleErrors.length = 0; // 冷启动时的 503 记成 Failed to load resource
  await proseSettled(page);

  await test.step('两个图都渲染出来：图页 200，iframe 占满正文栏宽，高度等于图的内容，没有滚动余量', async () => {
    for (const id of ['wait-sequence', 'message-flow']) {
      await figure(page, id).scrollIntoViewIfNeeded();
      await expect(figure(page, id)).toHaveAttribute('data-state', 'ready');
      await expect(figure(page, id)).toHaveAttribute('data-sized', '1');
      await expect.poll(async () => { const f = await fit(page, id); return f.iframe - f.root; }).toBe(0);
      expect((await fit(page, id)).overflow).toBe(0);
      const widths = await figure(page, id).evaluate((el) => [Math.round(el.querySelector('iframe').getBoundingClientRect().width), Math.round(el.closest('.sec-body, .article-body').getBoundingClientRect().width)]);
      expect(widths[0]).toBe(widths[1]);
    }
    await expect(inner(page, 'wait-sequence').locator('svg text', { hasText: '停在提交前，等用户点头' })).toBeVisible();
    await expect(figure(page, 'wait-sequence').locator('figcaption')).toHaveText('提交前谁在等谁');
    const figurePages = responses.filter((r) => r.path === '/api/frame' && r.search.includes('&figure='));
    expect([...new Set(figurePages.map((r) => `${r.search} ${r.status}`))].sort()).toEqual(
      ['message-flow', 'wait-sequence'].map((id) => `?page=${PAGE}&figure=${id}&embed=figure 200`));
    // 演示的 sidecar 与 pinpoint/figure（import map 指到 /kits/figure/figure.js）都取到了。
    expect(responses.filter((r) => r.path === '/kits/figure/figure.js' || r.path === `/sites/${PAGE}/figures/message-flow.js`).map((r) => [r.path, r.status]))
      .toEqual(expect.arrayContaining([['/kits/figure/figure.js', 200], [`/sites/${PAGE}/figures/message-flow.js`, 200]]));
  });

  await test.step('iframe 里逐步点：下一步两次到第 2 步（走过的变淡、没到的隐藏、说明换成这一步的），上一步回到第 1 步', async () => {
    const demo = inner(page, 'message-flow');
    const root = demo.locator('[data-pp-figure-root]');
    await expect(root).toHaveAttribute('data-step', '0');
    await expect(demo.locator('.fig-count')).toHaveText('共 9 步');
    const before = (await fit(page, 'message-flow')).iframe;
    await demo.getByRole('button', { name: '下一步' }).click();
    await demo.getByRole('button', { name: '下一步' }).click();
    await expect(root).toHaveAttribute('data-step', '2');
    await expect(demo.locator('.fig-count')).toHaveText('2 / 9');
    await expect(demo.locator('.fig-note')).toHaveText('前台把任务交给后台，自己继续陪用户聊。');
    await expect(demo.locator('.mf-msg[data-step="1"]')).toHaveClass(/is-past/);
    await expect(demo.locator('.mf-msg[data-step="2"]')).toHaveClass(/is-now/);
    await expect(demo.locator('.mf-msg[data-step="3"]')).toHaveCSS('opacity', '0');
    await expect(demo.locator('.mf-msg[data-step="2"] line')).toHaveCSS('stroke', 'rgb(14, 143, 108)');
    await demo.getByRole('button', { name: '上一步' }).click();
    await expect(root).toHaveAttribute('data-step', '1');
    await expect(demo.locator('.fig-note')).toHaveText('用户只跟前台说话。');
    // 内容变了高度照样贴合（说明行一直占位，高度不跳）。
    await expect.poll(async () => { const f = await fit(page, 'message-flow'); return f.iframe - f.root; }).toBe(0);
    expect((await fit(page, 'message-flow')).iframe).toBe(before);
  });

  await test.step('切深浅色：图页跟着文章页的 data-theme 换调色板，切回来也跟', async () => {
    const bg = () => inner(page, 'message-flow').locator('body').evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(await bg()).toBe('rgb(255, 255, 255)');
    await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(inner(page, 'message-flow').locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(bg).toBe('rgb(17, 17, 17)');
    await expect(inner(page, 'wait-sequence').locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#btn-theme').click();
    await expect(inner(page, 'message-flow').locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(bg).toBe('rgb(255, 255, 255)');
  });

  await test.step('窗口变窄：图跟着变矮，iframe 高度照样贴合', async () => {
    const wide = (await fit(page, 'wait-sequence')).iframe;
    await page.setViewportSize({ width: 900, height: 900 });
    await expect.poll(async () => (await fit(page, 'wait-sequence')).iframe).toBeLessThan(wide);
    await expect.poll(async () => { const f = await fit(page, 'wait-sequence'); return f.iframe - f.root; }).toBe(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    // 变宽后图页重报高度，下面的正文会跟着移：等两个图都贴合了再往下（下一步要按坐标拖选）。
    for (const id of ['wait-sequence', 'message-flow']) {
      await expect.poll(async () => { const f = await fit(page, id); return f.iframe - f.root; }).toBe(0);
    }
  });

  await test.step('图注里选字不出“评论”', async () => {
    const before = await page.evaluate(() => window.pinpointProse.selection().checks);
    await dragSelect(page, '[data-pp-figure="message-flow"] figcaption', '消息怎么走');
    await expect.poll(() => page.evaluate(() => window.pinpointProse.selection().checks)).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.pinpointProse.selection().offered)).toBe(false);
    await expect(page.locator('.pp-selbtn')).toHaveCount(0);
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
