import { expect, test } from './lib/fixtures.js';
import { E2E_BASE_URL } from './env.js';
import { launchWithScrollbars } from './lib/scrollbars.js';
import { closeSettled } from './ledger-settle.js';
import { openWorkbench } from './lib/workbench.js';

test('全页切手机再回画布：手机卡片根滚动条不占宽，内容仍能滚；桌面卡片保留原生条', async () => {
  const browser = await launchWithScrollbars();
  const page = await browser.newPage({ baseURL: E2E_BASE_URL, viewport: { width: 1440, height: 900 } });
  const selector = '[data-html-card][data-screen="long-page"] iframe';
  const root = () => page.locator(selector).evaluate(el => {
    const w = el.contentWindow;
    return { native: w.innerWidth - w.document.documentElement.clientWidth, overflow: w.document.documentElement.scrollHeight > w.innerHeight };
  });
  try {
    await openWorkbench(page, 'page=e2e-html_pages');
    await expect(page.locator(selector)).toHaveAttribute('data-live', 'on');
    expect(await root()).toEqual({ native: 15, overflow: true });
    await page.evaluate(() => window.workbench.openPage('long-page'));
    await page.locator('#wbviewport [data-viewport="phone"]').click();
    const full = page.locator('[data-page-screen="long-page"] iframe');
    await expect.poll(() => full.evaluate(el => !!el.contentDocument.querySelector('style[data-pp-phone-scrollbar]'))).toBe(true);
    await page.locator('#wbpage-close').click();
    await expect(page.locator(selector)).toHaveAttribute('data-live', 'on');
    expect(await root()).toEqual({ native: 0, overflow: true });
    await page.evaluate(() => window.workbench.focusFrame('pages', 'long-page', { smooth: false }));
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.locator(selector).evaluate(el => el.contentWindow.scrollY)).toBeGreaterThan(0);
    // 页面自己的横滑块继续用原生滚动条。
    expect(await page.locator(selector).evaluate(el => {
      const d = el.contentDocument, table = d.createElement('div');
      table.style.cssText = 'width:100px;height:50px;overflow:scroll';
      table.innerHTML = '<div style="width:500px;height:5px"></div>';
      d.body.append(table);
      return table.offsetHeight - table.clientHeight;
    })).toBe(15);
  } finally { await closeSettled(page); await browser.close(); }
});
