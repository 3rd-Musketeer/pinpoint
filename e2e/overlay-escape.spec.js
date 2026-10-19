import { expect, test } from './lib/fixtures.js';
import { closeSettled } from './ledger-settle.js';
import { waitNoReload } from './site-settle.js';

test.afterEach(async ({ page }) => { await closeSettled(page); });

test('文章画布内的活卡片：Esc 依次处理输入、提及、标注框、模式，空闲时回文章；页面浮层先回画布', async ({ page, request }, testInfo) => {
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
  await test.step('卡片内按钮获得焦点，Esc 回文章', async () => {
    await open();
    await card.locator('.cat-btn').click();
    await expect(card.locator('.cat-out')).toHaveText('已点');
    await page.screenshot({ path: testInfo.outputPath('article-canvas.png') });
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-pp-section="pages"] [data-pp-open]')).toBeFocused();
  });
  await test.step('输入框和菜单占着 Esc 时不回文章', async () => {
    await open();
    await card.locator('body').evaluate(el => { const input = el.ownerDocument.createElement('input'); input.id = 'p3-input'; el.append(input); input.focus(); });
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('open', '');
    await card.locator('.cat-btn').focus();
    await wb().evaluate(() => { const menu = document.createElement('div'); menu.role = 'menu'; menu.id = 'p3-menu'; document.body.append(menu); });
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveAttribute('open', '');
    await wb().evaluate(() => document.getElementById('p3-menu').remove());
  });
  await test.step('提及、标注框、标注模式逐层退出，最后回文章；页面自己注册的 Esc 排在标注层之后', async () => {
    // 原型自己的 Esc（例如关表单）挂在 document 冒泡段：标注层退完之前一次都不该收到。
    await card.locator('body').evaluate(el => { const d = el.ownerDocument; d.defaultView.__pageEsc = 0; d.addEventListener('keydown', e => { if (e.key === 'Escape') d.defaultView.__pageEsc++; }); });
    const pageEsc = () => card.locator('body').evaluate(el => el.ownerDocument.defaultView.__pageEsc);
    await canvas.locator('#wbann-toggle').click();
    await card.locator('.cat-btn').click();
    await expect(card.locator('#ann-box')).toBeVisible();
    await card.locator('#ann-input').fill('@');
    await expect(card.locator('#ann-mention')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card.locator('#ann-mention')).toBeHidden();
    await expect(card.locator('#ann-box')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card.locator('#ann-box')).toBeHidden();
    await expect(overlay).toHaveAttribute('open', '');
    await card.locator('.cat-btn').focus();
    await page.keyboard.press('Escape');
    await expect(canvas.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(await pageEsc()).toBe(0);
    await expect(overlay).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveAttribute('open', '');
  });
  await test.step('页面浮层获得焦点，Esc 先回画布，再回文章', async () => {
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
