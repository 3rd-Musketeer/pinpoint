// 多个 spec 共用的“打开 workbench”：默认页，等 workbench 与 pinpoint 两个全局就绪。
// workbench.spec.js 的版本带深链与板就绪等待，是它自己的，不在这里。
import { expect } from '@playwright/test';

export async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
}

/** 同上，并等左栏 Pages 里的 e2e-mixed 行出现（分组 / 排序 / 内容区用例的起点）。 */
export async function openWorkbenchWithPages(page) {
  await openWorkbench(page);
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
}
