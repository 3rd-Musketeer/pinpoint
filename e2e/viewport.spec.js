import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR } from './env.js';

// 视口（2026-09-05，lib/viewport.js）：文档条目怎么被看 —— 窗口｜手机。owner 裁决：
// 「doc 本身就是要展示的终态，而 prototype app 有多屏，所以 doc 可以只展示 html 本身，
// 而 app 需要 section + frames」；要在手机上看的页面「应该给 html / url 加一个切换
// 不同 viewport 的功能」。
//   · 窗口 = 今天的文档形态：iframe 1:1 铺满舞台，横条中段只剩视口两段；
//   · 手机 = 同一份文档装进一个 402 × 874 的手机 frame 摆上画布，机壳跟设置走，
//     缩放 / 回中 / 导出（画布工具）回来，帧导航 1 / 1；
//   · 偏好按页记在 prefs.viewportByPage，跨 reload 保持；
//   · 标注锚点是元素选择器，窗口里标的在手机里照样在，反过来也一样。
// 固件 = e2e-dir（dir 条目，doc 壳，cards / doc 两屏）与 e2e-proxy（url 条目）。

const BUCKET = path.join(E2E_DATA_DIR, 'e2e-dir');
const DOC_FRAME = '#wb-board-panel [data-screen="doc"] iframe.wb-doc-frame';

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
}

async function openDirDoc(page) {
  await openWorkbench(page);
  await page.locator('.wb-page[data-vpage="e2e-dir"]').click();
  await page.locator('#wbcontents [data-entry="doc"]').click();
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
}

function stageForm(page) {
  return page.locator('#wbroot').evaluate((el) => el.getAttribute('data-page-mode'));
}

function rootViewport(page) {
  return page.locator('#wbroot').evaluate((el) => el.getAttribute('data-viewport'));
}

/** iframe 的布局尺寸（transform 之前的 CSS px）—— 手机视口的真实视口就是它。 */
function frameLayoutSize(page, selector) {
  return page.locator(selector).evaluate((el) => [el.offsetWidth, el.offsetHeight]);
}

async function setViewport(page, key) {
  await page.locator(`#wbviewport [data-viewport="${key}"]`).click();
  await expect(page.locator(`#wbviewport [data-viewport="${key}"]`)).toHaveAttribute('aria-pressed', 'true');
}

/** 在 iframe 里的标注客户端上点选元素、写内容、保存（同 ann-sidebar.spec 的 annotate）。 */
async function annotateInFrame(page, frameSelector, targetSelector, text) {
  const doc = page.frameLocator(frameSelector);
  await doc.locator(targetSelector).click();
  const box = doc.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('textarea').fill(text);
  await box.locator('#ann-save').click();
  await expect(box).toBeHidden();
}

test.afterEach(() => {
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

test('文档条目：横条出「窗口｜手机」两段，默认窗口 = 1:1 铺满，中段只剩视口控件', async ({ page }) => {
  await openDirDoc(page);
  expect(await stageForm(page)).toBe('html');
  expect(await rootViewport(page)).toBe('window');

  const control = page.locator('#wbviewport');
  await expect(control).toBeVisible();
  await expect(control.locator('button')).toHaveText(['窗口', '手机']);
  await expect(control.locator('[data-viewport="window"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#wbstrip-kind')).toHaveText('文档');
  // 窗口视口：画布工具收起（阅读器没有画布可缩放），视口控件在中段独自出现。
  await expect(page.locator('#wbcanvas-tools')).toBeHidden();
  await expect(page.locator('#wbexport-open')).toBeHidden();

  // 1:1 铺满：iframe 的 bounding box 与舞台重合（ADR 0023：几何断言比 box）。
  const stage = await page.locator('#wbstage').boundingBox();
  const frame = await page.locator(DOC_FRAME).boundingBox();
  expect(Math.abs(frame.x - stage.x)).toBeLessThan(1);
  expect(Math.abs(frame.y - stage.y)).toBeLessThan(1);
  expect(Math.abs(frame.width - stage.width)).toBeLessThan(1);
  expect(Math.abs(frame.height - stage.height)).toBeLessThan(1);
  await expect(page.locator('#wb-board-panel .wb-screen--phone-doc')).toHaveCount(0);

  // 画布页没有视口控件：画布条目没有第二种看法。
  await page.locator('.wb-page[data-vpage="e2e-dir-ios"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="cards"] .ios-stage')).toBeVisible();
  await expect(page.locator('#wbviewport')).toHaveCount(0);
});

test('切到手机：同一份文档装进 402 × 874 的机壳摆上画布，画布工具回来，切回即还原', async ({ page }) => {
  await openDirDoc(page);
  await setViewport(page, 'phone');

  // 形态 = 画布：ios + data-viewport=phone；文档 iframe 还是那一个 src。
  expect(await stageForm(page)).toBe('ios');
  expect(await rootViewport(page)).toBe('phone');
  const screen = page.locator('#wb-board-panel [data-screen="doc"]');
  await expect(screen).toHaveClass(/wb-screen--phone-doc/);
  await expect(screen.locator('.ios-stage .ios-device .ios-bezel .ios-screen iframe.wb-doc-frame')).toHaveCount(1);
  await expect(page.locator(DOC_FRAME)).toHaveAttribute('src', /\/sites\/e2e-dir\/doc\.html$/);
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
  expect(await frameLayoutSize(page, DOC_FRAME)).toEqual([402, 874]);
  // 屏幕 chrome 与 iOS frame 同一份：岛 / 状态栏 / home 条；默认「机壳 无」= screen-only。
  await expect(screen.locator('.ios-island')).toHaveCount(1);
  await expect(screen.locator('.ios-statusbar')).toHaveCount(1);
  await expect(screen.locator('.ios-home')).toHaveCount(1);
  await expect(screen.locator('.ios-root')).toHaveClass(/screen-only/);
  expect(await frameLayoutSize(page, '#wb-board-panel [data-screen="doc"] .ios-device')).toEqual([402, 874]);
  // 图注 = 页面标题（screen 的 title），尺寸行 402 × 874。
  await expect(screen.locator('.wb-cap-title')).toHaveText('Doc');
  await expect(screen.locator('.wb-screen-dim')).toHaveText('402 × 874');
  // 另一份文档（cards）仍被条目显隐收起：画布上只有一个 frame。
  await expect(page.locator('#wb-board-panel [data-screen="cards"]')).toBeHidden();
  await expect(page.locator('#wb-board-panel .wb-doc-frame:visible')).toHaveCount(1);

  // 横条中段：视口控件 + 画布工具（缩放 / 回中 / 导出）；帧导航读数 1 / 1。
  await expect(page.locator('#wbviewport')).toBeVisible();
  await expect(page.locator('#wbcanvas-tools')).toBeVisible();
  await expect(page.locator('#wbzoom-label')).toBeVisible();
  await expect(page.locator('#wbrecenter')).toBeVisible();
  await expect(page.locator('#wbexport-open')).toBeVisible();
  await expect(page.locator('#wbsection-nav-position')).toHaveText('1 / 1');
  await expect(page.locator('#wbstrip-kind')).toHaveText('文档');

  // 画布工具是真的：缩放改了画布 zoom；frame 落在可见区（不在 chrome 底下）。
  await page.locator('#wbzoom-in').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-canvas-zoom'))).not.toBe('1');
  await page.locator('#wbrecenter').click();
  const stageBox = await page.locator('#wbstage').boundingBox();
  await expect.poll(async () => {
    const box = await page.locator('#wb-board-panel [data-screen="doc"] .ios-stage').boundingBox();
    return box && box.x >= stageBox.x && box.y >= stageBox.y
      && box.x + box.width <= stageBox.x + stageBox.width + 1;
  }).toBe(true);

  // 切回窗口：1:1 铺满，机壳退场，画布工具收起。
  await setViewport(page, 'window');
  expect(await stageForm(page)).toBe('html');
  expect(await rootViewport(page)).toBe('window');
  await expect(page.locator('#wb-board-panel .wb-screen--phone-doc')).toHaveCount(0);
  await expect(page.locator('#wb-board-panel [data-screen="doc"] .ios-stage')).toHaveCount(0);
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
  const stage = await page.locator('#wbstage').boundingBox();
  const frame = await page.locator(DOC_FRAME).boundingBox();
  expect(Math.abs(frame.width - stage.width)).toBeLessThan(1);
  expect(Math.abs(frame.height - stage.height)).toBeLessThan(1);
  await expect(page.locator('#wbcanvas-tools')).toBeHidden();
  // 选中条目跟着回来（不是掉回默认的 cards）。
  await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('doc');
});

test('机壳「有」时手机视口带 iPhone 机身：设置作用在文档 frame 上', async ({ page }) => {
  await openDirDoc(page);
  await setViewport(page, 'phone');
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('pinpoint-wb') || '{}');
    prefs.frame = 'bezel';
    localStorage.setItem('pinpoint-wb', JSON.stringify(prefs));
  });
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  const screen = page.locator('#wb-board-panel [data-screen="doc"]');
  await expect(screen.locator('.ios-root')).not.toHaveClass(/screen-only/);
  // 机身 = 屏幕 + 2 × (bezel 15 + frame 3)，与 iOS frame 同一份 ios-kit 取值。
  expect(await frameLayoutSize(page, '#wb-board-panel [data-screen="doc"] .ios-device')).toEqual([438, 910]);
  expect(await frameLayoutSize(page, DOC_FRAME)).toEqual([402, 874]);
});

test('视口偏好按页记在 prefs.viewportByPage，跨 reload 保持，别的页不受影响', async ({ page }) => {
  await openDirDoc(page);
  await setViewport(page, 'phone');
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('pinpoint-wb')).viewportByPage
  )).toEqual({ 'e2e-dir': 'phone' });

  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  expect(await stageForm(page)).toBe('ios');
  expect(await rootViewport(page)).toBe('phone');
  await expect(page.locator('#wbviewport [data-viewport="phone"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await frameLayoutSize(page, DOC_FRAME)).toEqual([402, 874]);
  // 条目记忆也带回来：还是 doc，不是默认的 cards。
  await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('doc');

  // 另一页（url 条目）仍是窗口。
  await page.locator('.wb-page[data-vpage="e2e-proxy"]').click();
  await expect(page.frameLocator('#wb-board-panel [data-screen="index"] iframe.wb-doc-frame').locator('#title'))
    .toHaveText('E2E proxy upstream');
  expect(await stageForm(page)).toBe('html');
  await expect(page.locator('#wbviewport [data-viewport="window"]')).toHaveAttribute('aria-pressed', 'true');

  // 回窗口 = 删 key（默认值不积灰）。
  await page.locator('.wb-page[data-vpage="e2e-dir"]').click();
  await expect(page.locator('#wbviewport [data-viewport="phone"]')).toHaveAttribute('aria-pressed', 'true');
  await setViewport(page, 'window');
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('pinpoint-wb')).viewportByPage
  )).toEqual({});
});

test('url 条目在手机视口里照走同源代理：src 不变，活应用在机壳里跑', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('.wb-page[data-vpage="e2e-proxy"]').click();
  const FRAME = '#wb-board-panel [data-screen="index"] iframe.wb-doc-frame';
  await expect(page.frameLocator(FRAME).locator('#title')).toHaveText('E2E proxy upstream');
  await setViewport(page, 'phone');
  await expect(page.locator(FRAME)).toHaveAttribute('src', /^sites\/e2e-proxy\/$/);
  await expect(page.frameLocator(FRAME).locator('#title')).toHaveText('E2E proxy upstream');
  await expect(page.frameLocator(FRAME).locator('#api-result')).toHaveText('api-via-proxy');
  expect(await frameLayoutSize(page, FRAME)).toEqual([402, 874]);
  await expect(page.locator('#wbstrip-kind')).toHaveText('网页');
  // 本用例把 e2e-proxy 记成手机，收尾还原，别影响 url-entry.spec 的断言。
  await setViewport(page, 'window');
  fs.rmSync(path.join(E2E_DATA_DIR, 'e2e-proxy'), { recursive: true, force: true });
});

test('标注跨视口：窗口里标的在手机里照样在，手机里标的回窗口也在（锚点 = 元素选择器）', async ({ page }) => {
  await openDirDoc(page);
  // 文档 1:1 铺满，左栏浮在它上面（design.md 外壳布局）：#doc-target 在页面左上角，
  // 被面板压住的正文靠收起面板来点。
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbroot')).toHaveClass(/wb-side-collapsed/);

  // 窗口视口：横条「标注」驱动的是 iframe 里那个实例；在 #doc-target 上标一条。
  await page.locator('#wbann-toggle').click();
  await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  await annotateInFrame(page, DOC_FRAME, '#doc-target', 'window mark');
  await expect(page.locator('#wbann-count')).toHaveText('1');
  await expect(page.frameLocator(DOC_FRAME).locator('.ann-badge')).toHaveCount(1);

  // 切手机：iframe 重载、客户端从磁盘水合，同一条标注钉在同一个元素上；计数照旧。
  await setViewport(page, 'phone');
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
  await expect(page.locator('#wbann-count')).toHaveText('1');
  const phoneDoc = page.frameLocator(DOC_FRAME);
  await expect(phoneDoc.locator('.ann-badge')).toHaveCount(1);
  // 钉子落在 frame 里、锚点元素旁（iframe 视口坐标：钉在锚点框右上角附近）。
  const badge = await phoneDoc.locator('.ann-badge').first().boundingBox();
  const target = await phoneDoc.locator('#doc-target').boundingBox();
  expect(badge).not.toBeNull();
  expect(Math.abs(badge.y - target.y)).toBeLessThan(target.height + 40);
  const frameBox = await page.locator(DOC_FRAME).boundingBox();
  expect(badge.x).toBeGreaterThanOrEqual(frameBox.x - 1);
  expect(badge.x + badge.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);

  // 手机视口里再标一条（第二个目标），保存到同一个桶。
  await page.locator('#wbann-toggle').click();
  await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  await annotateInFrame(page, DOC_FRAME, '#doc-target-2', 'phone mark');
  await expect(page.locator('#wbann-count')).toHaveText('2');
  await expect(phoneDoc.locator('.ann-badge')).toHaveCount(2);

  // 回窗口：两条都在，序号不变。
  await setViewport(page, 'window');
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
  await expect(page.locator('#wbann-count')).toHaveText('2');
  await expect(page.frameLocator(DOC_FRAME).locator('.ann-badge')).toHaveCount(2);
  await expect(page.frameLocator(DOC_FRAME).locator('.ann-badge')).toHaveText(['1', '2']);
  // 账本落在 e2e-dir 桶（与 /sites/ 直开同一个）。
  expect(fs.readdirSync(BUCKET).filter((n) => n.endsWith('.json')).length).toBe(1);
});

test('手机视口的文档 frame 进导出树，按画布 frame 管线出 PNG', async ({ page }) => {
  await openDirDoc(page);
  await setViewport(page, 'phone');
  // 低清预览档 mock 成 1×1，下载档（scale 2）打真渲染端。
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const requests = [];
  await page.route('**/api/export-image', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (body.scale !== 1) return route.fallback();
    await route.fulfill({
      contentType: 'image/png',
      headers: { 'X-Export-Width': '1', 'X-Export-Height': '1' },
      body: TINY_PNG,
    });
  });
  await page.locator('#wbexport-open').click();
  const picker = page.locator('dialog.wb-export-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: /Frame 图片/ }).click();
  await expect(picker.locator('.wb-pk-fr')).toHaveCount(1);
  await expect(picker.locator('.wb-pk-fr')).toContainText('Doc');
  await expect(picker.locator('.wb-pk-fr')).toContainText('402 × 874');
  // 快照里的 iframe 不带标注面（?annotate=off），与画布 frame 一样干净。
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0].html).toMatch(/iframe[^>]*wb-doc-frame[^>]*src="[^"]*\/sites\/e2e-dir\/doc\.html\?annotate=off"/);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    picker.getByRole('button', { name: /下载 PNG/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const file = await download.path();
  expect(fs.statSync(file).size).toBeGreaterThan(200);
});
