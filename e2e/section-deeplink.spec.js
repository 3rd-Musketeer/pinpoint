import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_SITES_DIR } from './env.js';
import { openOutline } from './open-workbench.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// ?section=<id> 落点（2026-10-13）：打开页的画布条目，即时定位并选中这个 section；多 tab 页
// （ADR 0041）先切到它所在的 tab；显式 section 赢过这一页的存档视口；落地后地址栏不再带 section；
// 未知 id 照常打开、只 console.warn。固件：e2e-ios（存量页，home … settings 六个 section）、
// tabs-site（comps：btn-wall / chip-wall；flow：onboard）。
const TABS_DIR = path.join(E2E_SITES_DIR, 'tabs-site');

test.beforeEach(async ({ request }) => {
  appendRegistryEntry({ id: 'e2e-tabs', title: 'E2E Tabs', kind: 'dir', path: TABS_DIR, board: 'ios' });
  await request.post('/registry/reload');
});

test.afterEach(async ({ request }) => {
  await restoreRegistryFixture(request);
});

/** 读 / 写这一页的视口存档（prefs.pageViewports[key]）。 */
const readViewport = (page, key) => page.evaluate((key) => {
  const prefs = JSON.parse(localStorage.getItem('pinpoint-wb') || '{}');
  return (prefs.pageViewports || {})[key] || null;
}, key);
const writeViewport = (page, key, vp) => page.evaluate(({ key, vp }) => {
  const prefs = JSON.parse(localStorage.getItem('pinpoint-wb') || '{}');
  prefs.pageViewports = Object.assign({}, prefs.pageViewports, { [key]: vp });
  localStorage.setItem('pinpoint-wb', JSON.stringify(prefs));
}, { key, vp });
const stageScroll = (page) => page.locator('#wbstage').evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
/** 与落点相差不过 1px：板带缩放，section 矩形是小数，从不同滚动位置量出来的取整会差 1。 */
const offBy = (a, b) => Math.max(Math.abs(a.top - b.top), Math.abs(a.left - b.left));
const boardZoom = (page) => page.locator('.wb-library').evaluate((el) => el.style.getPropertyValue('--wb-board-zoom'));

/** 落地完成的可观察信号：url-sync 在落点之后才启动，第一次写地址栏就把 section 去掉。 */
async function openAndLand(page, query) {
  await page.goto(`/index.html?${query}`);
  await page.waitForFunction(() => window.workbench && window.workbench.activePageId());
  await expect.poll(() => new URL(page.url()).searchParams.has('section')).toBe(false);
}

/** section 左上角落在舞台可视区里（toBeVisible 不查视口，见 AGENTS.md）。 */
async function sectionInStage(page, sectionId) {
  const stage = await page.locator('#wbstage').boundingBox();
  const box = await page.locator(`.wb-lib-item[data-ann-section="${sectionId}"]`).boundingBox();
  if (!stage || !box) return false;
  return box.x >= stage.x && box.y >= stage.y
    && box.x < stage.x + stage.width && box.y < stage.y + stage.height;
}

test('存量页：?section= 即时落到那个 section、赢过存档视口；未知 id 照常打开', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error));
  const warnings = [];
  page.on('console', (msg) => { if (msg.type() === 'warning') warnings.push(msg.text()); });

  // 先留一份存档视口：首访落在第一个 section（home），滚动存档随之写下
  let saved;
  await test.step('首访留下停在 home 的存档视口', async () => {
    await openAndLand(page, 'page=e2e-ios');
    await expect.poll(() => sectionInStage(page, 'home')).toBe(true);
    await expect.poll(async () => (await readViewport(page, 'e2e-ios'))?.scrollTop != null).toBe(true);
    saved = await readViewport(page, 'e2e-ios');
  });
  const savedZoom = await boardZoom(page);

  await test.step('section=settings：落到最后一个 section，地址栏去掉 section', async () => {
    await openAndLand(page, 'page=e2e-ios&section=settings');
    // 即时：落地信号一到就已在视口里，不等滚动动画
    expect(await sectionInStage(page, 'settings')).toBe(true);
    const scrolled = await page.locator('#wbstage').evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
    expect(scrolled).not.toEqual({ top: saved.scrollTop, left: saved.scrollLeft });
    await expect(page.locator('.wb-lib-item[data-ann-section="settings"]')).toHaveClass(/\bwb-sel\b/);
    expect(new URL(page.url()).searchParams.get('page')).toBe('e2e-ios');
    // 缩放沿用存档值（导航器点 section 也不改缩放）
    expect(await boardZoom(page)).toBe(savedZoom);
  });

  await test.step('未知 section id：不抛错、warn 一条，按存档视口正常打开', async () => {
    await writeViewport(page, 'e2e-ios', saved);
    await openAndLand(page, 'page=e2e-ios&section=no-such-section');
    expect(await page.evaluate(() => window.workbench.activePageId())).toBe('e2e-ios');
    await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeAttached();
    await expect.poll(() => page.locator('#wbstage').evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft })))
      .toEqual({ top: saved.scrollTop, left: saved.scrollLeft });
    await expect(page.locator('#wb-board-panel .wb-sel')).toHaveCount(0);
    expect(warnings.some((text) => text.includes('no-such-section'))).toBe(true);
  });

  expect(errors).toEqual([]);
});

test('多 tab 页：section 在别的 tab 时先切 tab 再落点；section 赢过 ?tab=；不写 tab 偏好', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const activeTab = page.locator('#wbtabbar [role="tab"][aria-selected="true"]');

  await test.step('默认 tab 是 comps，section=onboard 在 flow：切过去并落点', async () => {
    await openAndLand(page, 'page=e2e-tabs&section=onboard');
    await expect(activeTab).toHaveText('交互');
    await expect(page.locator('#wb-board-panel [data-screen="ob-welcome"]')).toBeAttached();
    await expect(page.locator('#wb-board-panel [data-screen="btn-default"]')).toHaveCount(0);
    expect(await sectionInStage(page, 'onboard')).toBe(true);
    await expect(page.locator('.wb-lib-item[data-ann-section="onboard"]')).toHaveClass(/\bwb-sel\b/);
    // 地址栏只剩状态：非第一个 tab 照常写 ?tab=
    expect(new URL(page.url()).searchParams.get('tab')).toBe('flow');
  });

  await test.step('?tab=flow 与 section=chip-wall（在 comps）并给：section 赢', async () => {
    await openAndLand(page, 'page=e2e-tabs&tab=flow&section=chip-wall');
    await expect(activeTab).toHaveText('组件');
    expect(await sectionInStage(page, 'chip-wall')).toBe(true);
    await expect(page.locator('.wb-lib-item[data-ann-section="chip-wall"]')).toHaveClass(/\bwb-sel\b/);
    expect(new URL(page.url()).searchParams.has('tab')).toBe(false);
  });

  await test.step('落点切 tab 不写偏好：不带参数打开仍是第一个 tab', async () => {
    await openAndLand(page, 'page=e2e-tabs&section=onboard');
    await expect(activeTab).toHaveText('交互');
    await openAndLand(page, 'page=e2e-tabs');
    await expect(activeTab).toHaveText('组件');
  });
});

// 大纲浮层点 section 与 ?section= 走同一条路（stage.js focusSection）：即时、选中、跨 tab 先切，
// 所以落到同一个滚动位置。先用深链量出落点，换到别处后从大纲点同一个 section 对照。
test('大纲点 section 与 ?section= 落点一致：同 tab 与跨 tab', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const activeTab = page.locator('#wbtabbar [role="tab"][aria-selected="true"]');

  await test.step('存量页：大纲点「设置」落到深链 section=settings 的位置并选中', async () => {
    await openAndLand(page, 'page=e2e-ios&section=settings');
    const landed = await stageScroll(page);
    await openAndLand(page, 'page=e2e-ios&section=home');
    expect(offBy(await stageScroll(page), landed)).toBeGreaterThan(100);
    await openOutline(page);
    await page.locator('#wboutline [data-ol-section="settings"] > .ol-sec').click();
    await expect(page.locator('#wboutline-pop')).toHaveCount(0);
    await expect.poll(async () => offBy(await stageScroll(page), landed)).toBeLessThanOrEqual(1);
    await expect(page.locator('.wb-lib-item[data-ann-section="settings"]')).toHaveClass(/\bwb-sel\b/);
    await expect(page.locator('.wb-lib-item[data-ann-section="home"]')).not.toHaveClass(/\bwb-sel\b/);
  });

  await test.step('多 tab 页：从「交互的大纲」点 onboard，先切 tab 再落到深链的位置并选中', async () => {
    await openAndLand(page, 'page=e2e-tabs&section=onboard');
    const landed = await stageScroll(page);
    await openAndLand(page, 'page=e2e-tabs&section=btn-wall');
    await expect(activeTab).toHaveText('组件');
    await openOutline(page, '交互');
    await page.locator('#wboutline [data-ol-section="onboard"] > .ol-sec').click();
    await expect(activeTab).toHaveText('交互');
    await expect(page.locator('.wb-lib-item[data-ann-section="onboard"]')).toHaveClass(/\bwb-sel\b/);
    await expect.poll(async () => offBy(await stageScroll(page), landed)).toBeLessThanOrEqual(1);
  });
});
