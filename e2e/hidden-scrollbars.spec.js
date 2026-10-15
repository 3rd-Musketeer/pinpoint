import { expect, test } from './lib/fixtures.js';

import { E2E_BASE_URL } from './env.js';
import { openWorkbenchWithPages } from './lib/workbench.js';
import { expectHiddenScrollbar, launchWithScrollbars, scrollbarState } from './lib/scrollbars.js';

// 隐藏式滚动条（docs/design.md“滚动条”，owner 2026-10-15）：工作台的滚动容器平时不画滚动条、不占宽，
// 指针停上去才浮出 6px 条。文章站点（评论栏、正文宽表）的同一套断言在 article-site.spec.js。

test('工作台：左栏平时没有滚动条也不占宽，悬停浮出 6px 条、仍可滚；画布悬停不出条', async () => {
  const browser = await launchWithScrollbars();
  const page = await browser.newPage({ baseURL: E2E_BASE_URL, viewport: { width: 1280, height: 720 } });
  const shots = process.env.E2E_SHOTS_DIR;
  try {
    await openWorkbenchWithPages(page);
    const away = await page.locator('#wbstage').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width * 0.6), y: Math.round(r.y + r.height * 0.4) };
    });

    await test.step('左栏：塞一段高内容让列表溢出，量同一套', async () => {
      await page.locator('#wbside-scroll [data-slot="scroll-area-viewport"]').evaluate((el) => {
        el.id = 'e2e-side-viewport';
        const pad = document.createElement('div');
        pad.style.height = '2400px';
        el.firstElementChild.append(pad);
      });
      await expectHiddenScrollbar(page, '#e2e-side-viewport', 'y', { away, shot: shots && { idle: `${shots}/hidden-scrollbar-sidebar-idle.png`, hover: `${shots}/hidden-scrollbar-sidebar-hover.png` } });
    });

    await test.step('画布（#wbstage，data-pp-scrollbar="scroll"）：原生条不占宽，指针在画布中间不出条', async () => {
      const stage = await page.locator('#wbstage').evaluate((el) => ({ w: el.offsetWidth - el.clientWidth, h: el.offsetHeight - el.clientHeight }));
      expect(stage).toEqual({ w: 0, h: 0 });
      await page.mouse.move(away.x, away.y);
      await page.mouse.move(away.x + 5, away.y + 5);
      await page.waitForTimeout(300); // 静默窗口：指针停在画布中间一会儿，两根条都不出
      expect((await scrollbarState(page, '#wbstage', 'y')).hidden).toBe(true);
      expect((await scrollbarState(page, '#wbstage', 'x')).hidden).toBe(true);
    });
  } finally {
    await browser.close();
  }
});
