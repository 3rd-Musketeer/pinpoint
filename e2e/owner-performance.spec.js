import { expect, test } from './lib/fixtures.js';
import { buildAnnotateBundle } from '../src/server/lib/annotate-bundle.js';
import { ownerCleanup, seedOwner, openOwnerBoard, openOwnerArticle, focusOwnerFrame, boardReady, metric } from './lib/owner-flows.js';
import { OWNER_PAGE, OWNER_FRAMES } from './lib/owner-fixture.js';

test('owner 性能首开文章：帧请求全为 2xx，请求数最多 206', async ({ page }, testInfo) => {
  const requests = [];
  const pending = new Set();
  const watched = request => /^\/(api\/frame|sites\/)/.test(new URL(request.url()).pathname);
  page.on('request', request => { if (watched(request)) pending.add(request); });
  page.on('response', response => {
    if (watched(response.request())) requests.push({ url: response.url(), status: response.status() });
  });
  const failed = [];
  page.on('requestfailed', request => { if (watched(request)) { failed.push({ url: request.url(), error: request.failure() }); pending.delete(request); } });
  page.on('requestfinished', request => pending.delete(request));
  const started = performance.now();
  try {
    await test.step('首开文章并读到最后一节，每张卡片实际渲染', async () => {
      await openOwnerArticle(page);
      for (let n = 1; n <= 12; n++) {
        const card = page.locator(`[data-pp-section="part-${n}"]`);
        await card.scrollIntoViewIfNeeded();
        await expect(card.locator('.cc-box[data-fitted="1"]')).toHaveCount(n === 12 ? 9 : 8, { timeout: 30_000 });
      }
      await expect(page.locator('.cc-box[data-fitted="1"]')).toHaveCount(OWNER_FRAMES);
      await expect.poll(() => pending.size).toBe(0);
    });
  } finally {
    await metric(testInfo, 'article-open', { elapsedMs: performance.now() - started, requests: requests.length, failures: failed, badResponses: requests.filter(r => r.status < 200 || r.status >= 300), urls: requests });
  }
  expect.soft(failed).toEqual([]);
  expect.soft(requests.filter(r => r.status < 200 || r.status >= 300), '包含 502 在内的非 2xx 一律失败').toEqual([]);
  expect(requests.length, '确实加载了 97 帧').toBeGreaterThanOrEqual(OWNER_FRAMES);
  expect(requests.length).toBeLessThanOrEqual(OWNER_FRAMES * 2 + 12);
});

test.beforeEach(async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedOwner(request);
});
test.afterEach(async ({ page }) => { await ownerCleanup(page); });

test('owner 性能 K1：选中一帧关标注框后，静息 3 秒零测量零 renderAll', async ({ page }, testInfo) => {
  // 只在此计数用例替换成同源码的未压缩 bundle；函数入口加计数，磁盘实现不变。
  const artifact = await buildAnnotateBundle({ minify: false });
  const marker = 'function renderAll() {';
  expect(artifact.js.split(marker)).toHaveLength(2);
  const js = artifact.js.replace(marker, `${marker} window.__ownerPerf.renders++;`);
  await page.route(/\/annotate(?:\.[0-9a-f]{10})?\.js(?:\?|$)/, route => route.fulfill({ contentType: 'text/javascript', body: js }));
  await page.addInitScript(() => {
    window.__ownerPerf = { rects: 0, renders: 0 };
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (...args) {
      if (/\/annotate(?:\.[0-9a-f]{10})?\.js/.test(new Error().stack)) window.__ownerPerf.rects++;
      return original.apply(this, args);
    };
  });
  await test.step('校验计数器能看到真实 renderAll 和标注测量', async () => {
    await openOwnerBoard(page);
    const control = await page.evaluate(() => {
      window.__ownerPerf = { rects: 0, renders: 0 };
      window.pinpoint.render();
      return { ...window.__ownerPerf };
    });
    expect(control.renders).toBe(1);
    expect(control.rects).toBeGreaterThan(0);
  });
  await test.step('选中首帧，打开已有标注再关框，观测静息窗口', async () => {
    await focusOwnerFrame(page, 2);
    await page.locator('#wbann-toggle').click();
    const mark = await page.evaluate(() => window.pinpoint.marks.find(m => m.id === 'owner-seed-0').n);
    await page.locator('.ann-badge').filter({ hasText: new RegExp(`^${mark}$`) }).first().click();
    await expect(page.locator('#ann-box')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ann-box')).toBeHidden();
    await page.waitForFunction(() => {
      const s = window.pinpoint.getState();
      return !s.syncing && !s.unsynced && !s.lastRectPending;
    });
    // 关框的 rAF 是活动的一部分，等它完成；不靠等待循环停止来排除 K1。
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => { window.__ownerPerf = { rects: 0, renders: 0 }; });
    await page.waitForTimeout(3000); // 静默窗口：静息 3 秒应无标注层布局读取或全量重画
    const counts = await page.evaluate(() => ({ ...window.__ownerPerf }));
    await metric(testInfo, 'idle', counts);
    expect.soft(counts.rects, '静息时标注层 getBoundingClientRect').toBe(0);
    expect.soft(counts.renders, '静息时 renderAll').toBe(0);
  });
});
