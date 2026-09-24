import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_DATA_DIR } from './env.js';

// storage-unify：画布账本 = 活动页桶的 @canvas.json（e2e-ios）。
const ledger = path.join(E2E_DATA_DIR, 'e2e-ios', '@canvas.json');

test.beforeEach(() => {
  // Start this fixture empty; UI clear now affects only the active page's bucket,
  // so leftover marks from other specs on this page are the only collision left.
  fs.rmSync(ledger, { force: true });
});

test.afterEach(async ({ page }) => {
  await page.close();
  fs.rmSync(ledger, { force: true });
});

async function saveMark(page) {
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/save' && response.request().method() === 'POST' && response.ok()),
    page.locator('#ann-save').click(),
  ]);
}

// 250% 档退役（2026-09-24 审计）：修复前它也过 —— 放大态 zoom-wrap 没有内部
// 可滚空间，是阴性对照，守不住回归；真失败档是 75% / 117%，留这两档。
for (const zoom of ['0.75', '1.17']) {
  test(`annotation navigation preserves earlier sections at zoom ${zoom}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript((zoom) => {
      const prefs = JSON.parse(localStorage.getItem('pinpoint-wb') || '{}');
      Object.assign(prefs, { zoomAxis: 2, sideCollapsed: true, pageViewports: { 'e2e-ios': { canvasZoom: zoom } } });
      localStorage.setItem('pinpoint-wb', JSON.stringify(prefs));
    }, zoom);
    await page.goto('/index.html?page=e2e-ios&mode=ios');
    await page.waitForFunction(() => window.workbench && window.pinpoint);
    await expect(page.locator('[data-screen="settings"] .ios-cell').first()).toBeVisible();
    await page.evaluate(() => window.pinpoint.clear());
    await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
    const first = page.locator('.wb-lib-item').first();
    const firstId = await first.getAttribute('data-ann-section');
    await page.evaluate((id) => window.workbench.focusFrame(id, 'home', { smooth: false }), firstId);
    const initial = await page.locator('#wbstage').evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }));
    const initialBox = await first.boundingBox();
    const count = await page.locator('.wb-lib-item').count();
    const lastSection = await page.locator('[data-screen="settings"]').evaluate(el => el.closest('.wb-lib-item').dataset.annSection);
    await page.evaluate(id => window.workbench.focusFrame(id, 'settings', { smooth: false }), lastSection);
    await page.evaluate(() => window.pinpoint.setMode(true));
    await page.locator('[data-screen="settings"] .ios-cell').first().click();
    await page.locator('#ann-input').fill('section scroll regression');
    await saveMark(page);
    await expect(page.locator('#ann-box')).toBeHidden();
    await page.evaluate((id) => window.workbench.focusFrame(id, 'home', { smooth: false }), firstId);
    await page.locator('#wbann-count').click();
    await page.locator('.wb-ann-item-main').click();
    await expect(page.locator('#ann-box')).toBeVisible();
    // A node can remain in the DOM but be clipped by a nested scroll container.
    await expect.poll(() => page.locator('.wb-zoom-wrap').evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }))).toEqual({ top: 0, left: 0 });
    await page.keyboard.press('Escape');
    if (await page.locator('#wbann-count').getAttribute('aria-expanded') === 'true') await page.locator('#wbann-count').click();
    await page.locator('#wbstage').evaluate((el, pos) => el.scrollTo({ ...pos, behavior: 'instant' }), initial);
    await expect.poll(async () => Math.abs((await first.boundingBox()).y - initialBox.y)).toBeLessThan(1);
    await expect(page.locator('.wb-lib-item')).toHaveCount(count);
    const hit = await page.locator('[data-screen="home"] .ios-device').evaluate(el => {
      const r = el.getBoundingClientRect();
      const x = Math.min(innerWidth - 100, Math.max(100, r.left + r.width / 2));
      const y = Math.min(innerHeight - 150, Math.max(100, r.top + r.height / 2));
      return { visible: el.contains(document.elementFromPoint(x, y)), x, y };
    });
    expect(hit.visible).toBe(true);
    await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(1);
    await page.evaluate(() => window.pinpoint.setMode(true));
    await page.mouse.click(hit.x, hit.y);
    await page.locator('#ann-input').fill('new mark after returning to earlier section');
    await saveMark(page);
    await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(2);
    await expect(page.locator('.wb-zoom-wrap')).toHaveJSProperty('scrollTop', 0);
  });
}
