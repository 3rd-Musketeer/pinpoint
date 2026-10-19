// 弹层栈全覆盖（C2）：每一类能被 Esc 关掉的东西开着时按 Esc，只关它自己。
// 栈的次序语义也在这里钉住：标注草稿（mention → 工具菜单 → 标注框）先于工作台
// 的菜单 / 列表 / 浮层，菜单与大纲先于标注列表，chrome 先于标注模式，导出对话框是自己的层。
// 跨文档两类（页面浮层 iframe、活卡片）在第二条用例里：没接住的 Esc 交给外层，
// 有层时只关自己的那一层。
import { expect, test } from './lib/fixtures.js';
import { closeSettled } from './ledger-settle.js';
import { openOutline } from './lib/workbench.js';
import { waitNoReload } from './site-settle.js';

test.afterEach(async ({ page }) => { await closeSettled(page); });

test('跨文档的层：页面浮层 iframe 与活卡片各自接住自己的 Esc，没接住交给外层', async ({ page, request }) => {
  test.setTimeout(180_000);
  await expect.poll(async () => (await request.get('/e2e-html/pages/')).status(), { timeout: 150_000 }).toBe(200);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/e2e-html/pages/');
  await waitNoReload(page);
  const overlay = page.locator('dialog[data-pp-overlay]');
  const canvas = page.frameLocator('iframe.ov-canvas');
  const card = canvas.frameLocator('[data-html-card][data-screen="catalog"] iframe');
  const wb = () => page.frames().find(f => /workbench.*embed=overlay/.test(f.url()));
  const open = async () => {
    await page.locator('[data-pp-section="pages"] [data-pp-open]').click();
    await expect(overlay).toHaveAttribute('open', '');
    await expect.poll(() => wb()?.evaluate(() => window.workbench?.whenBoardSettled?.())).toBe(true);
    await wb().evaluate(() => window.workbench.focusFrame('pages', 'catalog', { smooth: false }));
    await expect(card.locator('.cat-btn')).toBeVisible();
  };

  await test.step('活卡片空闲：Esc 穿过卡片回文章（外层浮层关）', async () => {
    await open();
    await card.locator('.cat-btn').click();
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveAttribute('open', '');
  });

  await test.step('活卡片焦点、工作台开着标注列表：Esc 交给工作台的栈，只关列表，浮层留着', async () => {
    await open();
    await card.locator('.cat-btn').focus();
    await wb().evaluate(() => document.getElementById('wbann-count').click());
    await expect(canvas.locator('#wbann-pop')).toBeVisible();
    await card.locator('.cat-btn').focus();
    await page.keyboard.press('Escape');
    await expect(canvas.locator('#wbann-pop')).toHaveCount(0);
    await expect(overlay).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveAttribute('open', '');
  });

  await test.step('活卡片里标注框开着：Esc 只关卡片自己的框，浮层留着', async () => {
    await open();
    await canvas.locator('#wbann-toggle').click();
    await card.locator('.cat-btn').click();
    await expect(card.locator('#ann-box')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card.locator('#ann-box')).toBeHidden();
    await expect(overlay).toHaveAttribute('open', '');
    await card.locator('.cat-btn').focus();
    await page.keyboard.press('Escape');
    await expect(canvas.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveAttribute('open', '');
  });

  await test.step('页面浮层 iframe 空闲：Esc 先关页面浮层，再关文章浮层', async () => {
    await open();
    await wb().evaluate(() => window.workbench.openPage('catalog'));
    await canvas.frameLocator('[data-page-screen="catalog"] iframe').locator('.cat-btn').click();
    await page.keyboard.press('Escape');
    await expect.poll(() => wb().evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
    await expect(overlay).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveAttribute('open', '');
  });
});

test('工作台弹层栈：每类层 Esc 只关自己，次序草稿 → chrome → 模式', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/workbench/?page=e2e-mixed');
  await page.waitForFunction(() => window.workbench && window.pinpoint?.getState().connected);
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled()), { timeout: 25_000 }).toBe(true);

  await test.step('frame ⋯ 菜单：Esc 只关菜单，焦点回触发钮', async () => {
    const trigger = page.locator('[data-screen="home"] .wb-frame-menu-trigger');
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();
    const menu = page.locator('[data-screen="home"] [role="menu"]');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  await test.step('标注列表：Esc 只关列表，焦点回计数钮', async () => {
    await page.locator('#wbann-count').click();
    await expect(page.locator('#wbann-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#wbann-pop')).toHaveCount(0);
    await expect(page.locator('#wbann-count')).toBeFocused();
  });

  await test.step('大纲里的右键菜单：Esc 先关菜单、大纲留着；再按关大纲，焦点回触发钮', async () => {
    await openOutline(page);
    await page.locator('#wboutline [data-ol-frame="home"]').click({ button: 'right' });
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
    await expect(page.locator('#wboutline-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#wboutline-pop')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '大纲', exact: true })).toBeFocused();
  });

  await test.step('标注框开着时先开列表：Esc 先关标注框，再关列表；标注模式都留着', async () => {
    await page.locator('#wbann-toggle').click();
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#wb-board-panel [data-screen="home"] h1').scrollIntoViewIfNeeded();
    await page.locator('#wb-board-panel [data-screen="home"] h1').click();
    const box = page.locator('#ann-box');
    await expect(box).toBeVisible();
    // 写上内容再关：空的新草稿关框即丢弃，后面两步要用这条标注的钉子。
    await box.locator('#ann-input').fill('层栈用例');
    await page.evaluate(() => document.getElementById('wbann-count').click());
    await expect(page.locator('#wbann-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(page.locator('#wbann-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#wbann-pop')).toHaveCount(0);
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('大纲开着时点标注钉子：钉子 stopPropagation，大纲仍收起', async () => {
    await openOutline(page);
    const pin = page.locator('#ann-marks .ann-badge').first();
    await expect(pin).toBeVisible();
    await pin.click();
    await expect(page.locator('#wboutline-pop')).toHaveCount(0);
    await expect(page.locator('#ann-box')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ann-box')).toHaveCount(0);
  });

  await test.step('工具菜单开着时 Esc 只关菜单，标注框留着', async () => {
    await page.locator('#ann-marks .ann-badge').first().click();
    const box = page.locator('#ann-box');
    await expect(box).toBeVisible();
    await box.locator('#ann-plus').click();
    await expect(box.locator('#ann-tools-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box.locator('#ann-tools-menu')).toBeHidden();
    await expect(box).toBeVisible();
  });

  await test.step('提及列表开着时 Esc 先关提及，标注框留着', async () => {
    // 标注模式还开着：点同一个元素开一条新草稿（空输入框，@ 才能唤出提及）。
    await page.locator('#wb-board-panel [data-screen="home"] h1').click();
    const box = page.locator('#ann-box');
    await expect(box).toBeVisible();
    await box.locator('#ann-input').fill('@');
    await expect(page.locator('#ann-mention')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ann-mention')).toHaveCount(0);
    await expect(box).toBeVisible();
    // 这条草稿就到这里：再一下 Esc 关框。
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
  });

  await test.step('chrome（大纲）开着时 Esc 先关 chrome，标注模式留着', async () => {
    await openOutline(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#wboutline-pop')).toHaveCount(0);
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  await test.step('大纲与标注列表同时开着：Esc 先关大纲，再关列表（旧 Dock 让大纲先关）', async () => {
    await openOutline(page);
    await page.locator('#wbann-count').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#wbann-pop')).toBeVisible();
    await expect(page.locator('#wboutline-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#wboutline-pop')).toHaveCount(0);
    await expect(page.locator('#wbann-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#wbann-pop')).toHaveCount(0);
  });

  await test.step('导出对话框：Esc 关对话框（换到能导出的页）', async () => {
    await page.evaluate(() => window.workbench.setActivePage('e2e-dir-ios'));
    await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('e2e-dir-ios');
    await expect(page.locator('#wbexport-open')).toBeVisible();
    await page.locator('#wbexport-open').click();
    await expect(page.locator('.wb-export-dialog')).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(page.locator('.wb-export-dialog')).not.toHaveAttribute('open', '');
  });
});
