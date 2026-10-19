import { expect, test } from './lib/fixtures.js';

// 重置一帧（frame-reset.js，owner 2026-10-19）：帧图注“⋯”菜单的“重置这一帧”把这一帧放回刚挂载时的样子，
// 别的帧不动；预览脚本重新挂上，帧照样能点。HTML 卡片重载它的 iframe。
// 帧被交互改过时图注上出红点（[data-frame-dirty-dot]），点红点也是重置。

async function resetFromMenu(page, screen) {
  await screen.hover();
  await screen.locator('.wb-frame-menu-trigger').click();
  await screen.locator('[data-frame-reset]').click();
}

test('帧菜单“重置这一帧”：iOS 帧放回初始状态、脚本重挂，旁边的帧不动', async ({ page }) => {
  await page.goto('/workbench/?page=e2e-project_commit-confirm');
  await page.waitForFunction(() => window.workbench && window.workbench.activePageId() === 'e2e-project_commit-confirm');
  await expect.poll(() => page.evaluate(() => window.workbench.whenPreviewsSettled()), { timeout: 15_000 }).toBe(true);
  const sheet = page.locator('.wb-screen[data-screen="confirm-sheet"]');
  const other = page.locator('.wb-screen[data-screen="confirm-done"]');
  await page.evaluate(() => window.workbench.focusFrame('confirm', 'confirm-sheet', { smooth: false }));

  const dot = sheet.locator('[data-frame-dirty-dot]');
  await expect(dot).toHaveCount(0);
  await sheet.locator('.e2e-tap').click();
  await expect(sheet.locator('.e2e-tap-out')).toHaveText('已确认');
  await expect(dot).toBeVisible();
  await expect(other.locator('[data-frame-dirty-dot]')).toHaveCount(0);
  await other.locator('.ios-app').evaluate((el) => { el.dataset.e2eMarker = 'kept'; });

  await resetFromMenu(page, sheet);
  await expect(sheet.locator('.e2e-tap-out')).toHaveText('未确认');
  await expect(dot).toHaveCount(0);
  await expect(other.locator('.ios-app')).toHaveAttribute('data-e2e-marker', 'kept');
  await expect(sheet.locator('.wb-frame-menu-trigger')).toHaveCount(1);

  await sheet.locator('.e2e-tap').click();
  await expect(sheet.locator('.e2e-tap-out')).toHaveText('已确认');
  await expect(dot).toBeVisible();
  await dot.click();
  await expect(sheet.locator('.e2e-tap-out')).toHaveText('未确认');
  await expect(dot).toHaveCount(0);

  // 标注模式下的点击不算改动
  await page.locator('#wbann-toggle').click();
  await sheet.locator('.e2e-tap').click();
  await page.keyboard.press('Escape'); // 关掉点出来的标注框
  await page.keyboard.press('Escape'); // 退出标注模式
  await page.waitForTimeout(700); // 静默窗口：比改动判据的 600 ms 长，红点一直不出
  await expect(dot).toHaveCount(0);
});

test('帧菜单“重置这一帧”：HTML 卡片重载页面', async ({ page, request }) => {
  test.setTimeout(180_000);
  await expect.poll(async () => (await request.get('/e2e-html/pages/')).status(), { timeout: 150_000 }).toBe(200);
  await page.goto('/workbench/?page=e2e-html_pages');
  await page.waitForFunction(() => window.workbench && window.workbench.activePageId() === 'e2e-html_pages');
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled())).toBe(true);
  await page.evaluate(() => window.workbench.focusFrame('pages', 'catalog', { smooth: false }));
  const screen = page.locator('.wb-screen[data-screen="catalog"]');
  const card = page.frameLocator('[data-html-card][data-screen="catalog"] iframe');

  await card.locator('.cat-btn').click();
  await expect(card.locator('.cat-out')).toHaveText('已点');
  await expect(screen.locator('[data-frame-dirty-dot]')).toBeVisible();
  await resetFromMenu(page, screen);
  await expect(card.locator('.cat-out')).not.toHaveText('已点');
  await expect(screen.locator('[data-frame-dirty-dot]')).toHaveCount(0);
  await card.locator('.cat-btn').click();
  await expect(card.locator('.cat-out')).toHaveText('已点');
});
