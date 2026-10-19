import { expect, test } from './lib/fixtures.js';
import { buildAnnotateBundle } from '../src/server/lib/annotate-bundle.js';
import { ownerCleanup, seedOwner, openOwnerBoard, openOwnerArticle, openOwnerStaticArticle, focusOwnerFrame, boardReady, metric } from './lib/owner-flows.js';
import { OWNER_PAGE, OWNER_FRAMES } from './lib/owner-fixture.js';

test('owner 性能输入：浮层中文组字和连续输入的 inputDelay p90 最多 150 ms', async ({ page }, testInfo) => {
  const scope = await openOwnerBoard(page, true);
  const screen = await focusOwnerFrame(scope);
  await scope.locator('#wbann-toggle').click();
  await screen.locator('[data-owner-action]').click();
  await expect(scope.locator('#ann-input')).toBeFocused();
  await scope.evaluate(() => {
    if (!PerformanceObserver.supportedEntryTypes.includes('event')) throw new Error('浏览器不支持 Event Timing');
    window.__ownerInput = { dispatch: [], native: [], keys: 0, active: true };
    for (const name of ['keydown', 'keyup', 'beforeinput', 'input', 'compositionupdate']) {
      window.addEventListener(name, event => {
        if (!window.__ownerInput.active || event.target.id !== 'ann-input' || !event.isTrusted) return;
        const time = event.timeStamp > performance.timeOrigin ? event.timeStamp - performance.timeOrigin : event.timeStamp;
        window.__ownerInput.dispatch.push({ name, inputDelay: Math.max(0, performance.now() - time) });
        if (name === 'keydown' || name === 'keyup') window.__ownerInput.keys++;
      }, true);
    }
    const collect = entries => {
      for (const e of entries) if (e.target?.id === 'ann-input' && ['keydown', 'keyup'].includes(e.name)) {
        window.__ownerInput.native.push({ name: e.name, inputDelay: e.processingStart - e.startTime, duration: e.duration });
      }
    };
    window.__ownerInputObserver = new PerformanceObserver(list => collect(list.getEntries()));
    window.__ownerInputCollect = collect;
    window.__ownerInputObserver.observe({ type: 'event', durationThreshold: 16 });
  });
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const text of ['请', '请检查', '请检查确认', '请检查确认条件']) {
      await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      await expect(scope.locator('#ann-input')).toContainText(text);
    }
    await cdp.send('Input.insertText', { text: '请检查确认条件' });
    await scope.locator('#ann-input').pressSequentially(' owner checks the confirmation flow');
    await expect(scope.locator('#ann-input')).toContainText('owner checks the confirmation flow');
    await scope.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const samples = await scope.evaluate(() => {
      window.__ownerInputCollect(window.__ownerInputObserver.takeRecords());
      window.__ownerInputObserver.disconnect();
      window.__ownerInput.active = false;
      return window.__ownerInput;
    });
    expect(samples.keys).toBeGreaterThanOrEqual(60);
    expect(samples.dispatch.filter(e => e.name === 'compositionupdate').length).toBeGreaterThanOrEqual(4);
    const p90 = values => values.sort((a, b) => a - b)[Math.ceil(values.length * 0.9) - 1];
    // Event Timing 省略低于 16 ms 的事件；考虑 8 ms 量化，用 24 ms 补成保守上界。
    const nativeUpper = samples.native.map(e => e.inputDelay);
    while (nativeUpper.length < samples.keys) nativeUpper.push(24);
    const nativeP90UpperMs = p90(nativeUpper);
    const dispatchP90Ms = p90(samples.dispatch.map(e => e.inputDelay));
    await metric(testInfo, 'input', { nativeP90UpperMs, dispatchP90Ms, budgetMs: 150, ...samples });
    expect.soft(nativeP90UpperMs, '原生 Event Timing 的 inputDelay p90 上界').toBeLessThanOrEqual(150);
    expect.soft(dispatchP90Ms, '含中文组字事件的捕获监听延迟 p90').toBeLessThanOrEqual(150);
  } finally { await cdp.detach(); }
});

test('owner 性能首开画布：97 帧挂齐最多 15 秒', async ({ page }, testInfo) => {
  const started = performance.now();
  await page.goto(`/workbench/?page=${OWNER_PAGE}`);
  await boardReady(page);
  const elapsedMs = performance.now() - started;
  await metric(testInfo, 'canvas-open', { elapsedMs, frames: await page.locator('.wb-screen').count(), budgetMs: 15_000 });
  expect(elapsedMs).toBeLessThanOrEqual(15_000);
});

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
      // overview 每帧带预览脚本：卡片全部退回 iframe（静态挂载的门在下面的静态大文章用例）。
      await expect(page.locator('[data-pp-canvas] iframe[data-cc-fallback="1"]')).toHaveCount(OWNER_FRAMES);
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

test('owner 性能静态卡片：97 帧全挂 shadow root，活动文档 ≤ 6、GC 后 JS 堆 ≤ 16 MiB', async ({ page }, testInfo) => {
  // 夹具 static 是 overview 去掉预览脚本的 97 帧（owner 真实文章的形状）。
  const frameResponses = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/frame') frameResponses.push(response.status());
  });
  await test.step('首开静态大文章并读到最后一节，每张卡片实际渲染', async () => {
    await openOwnerStaticArticle(page);
    for (let n = 1; n <= 12; n++) {
      const card = page.locator(`[data-pp-section="part-${n}"]`);
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator('.cc-box[data-fitted="1"]')).toHaveCount(n === 12 ? 9 : 8, { timeout: 30_000 });
    }
    await expect(page.locator('.cc-box[data-fitted="1"]')).toHaveCount(OWNER_FRAMES);
  });
  // 计数门（E1，2026-10-19）：静态帧不建 iframe，97 帧的卡片只剩文章页自己 1 个活动文档。
  // 旧实现每帧一个 iframe，98 个（r3 在 owner 真实文章上实测 100）；上限 6 给浏览器内部临时文档留余量，
  // 离旧实现一个数量级。GC 后 JS 堆：r3 实测 shadow 3.3 MiB、iframe 39.6 MiB；上限 16 MiB 约为
  // 新实现的 4 倍余量、旧实现的 40%。
  // 画布浮层预热（E2）：卡片都摆好后，文章页空闲时把整张画布的工作台预建在停驻容器里。
  // 它是同源 iframe，和文章页共用一个 JS 堆（实测约 20 MiB）。这道门量的是卡片：先等预热
  // 停驻（不等的话量到的时刻有没有它不确定），整页的堆连同工作台记成指标，再摘掉停驻的
  // iframe 量卡片的堆。活动文档数把工作台算在内。
  await expect.poll(() => page.evaluate(() => window.pinpointOverlay?.phase()), { timeout: 60_000 }).toBe('parked');
  const shadows = await page.locator('.cc-shadow[data-cc-mounted="1"]').count();
  const cardIframes = await page.locator('[data-pp-canvas] iframe').count();
  const docs = page.frames().length;
  const cdp = await page.context().newCDPSession(page);
  const usedHeap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value || 0;
  };
  let heapBytes = 0;
  let pageHeapBytes = 0;
  try {
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    pageHeapBytes = await usedHeap();
    await page.evaluate(() => document.querySelector('[data-ov-park] iframe')?.remove());
    heapBytes = await usedHeap();
  } finally { await cdp.detach(); }
  const mib = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;
  const heapMiB = mib(heapBytes);
  await metric(testInfo, 'static-cards', { shadows, cardIframes, docs, heapMiB, pageHeapMiB: mib(pageHeapBytes), frameRequests: frameResponses.length });
  expect(frameResponses.filter(s => s < 200 || s >= 300), '帧请求全为 2xx').toEqual([]);
  expect(shadows, '静态帧全部挂 shadow root').toBe(OWNER_FRAMES);
  expect(cardIframes, '静态大文章的卡片不建 iframe').toBe(0);
  expect(docs, '活动文档数').toBeLessThanOrEqual(6);
  expect(heapBytes, 'GC 后 JS 堆').toBeGreaterThan(0);
  expect(heapBytes, 'GC 后 JS 堆').toBeLessThanOrEqual(16 * 1024 * 1024);
});

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
    await expect.poll(() => page.evaluate(() => window.pinpoint.getState().countLive)).toBe(24);
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
