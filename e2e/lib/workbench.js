// 多个 spec 共用的工作台 helper：开工作台、开大纲、读舞台形态。
// workbench.spec.js 的 openWorkbench 还等板就绪（whenBoardSettled），是它自己的，不在这里。
import { expect } from '@playwright/test';

const workbenchUrl = (query) => (query ? `/workbench/?${query}` : '/workbench/');

/** 打开工作台，等 workbench 与 pinpoint 两个全局就绪。query 是 `?` 后面那段（如 `page=e2e-ios`），空 = 默认页。 */
export async function openWorkbench(page, query = '') {
  await page.goto(workbenchUrl(query));
  await page.waitForFunction(() => window.workbench && window.pinpoint);
}

/** 同 openWorkbench，再等标注客户端连上服务（hydrate 完、能存）。 */
export async function openWorkbenchConnected(page, query = '') {
  await page.goto(workbenchUrl(query));
  await page.waitForFunction(() => window.workbench && window.pinpoint?.getState().connected);
}

/** 打开默认页，并等左栏 Pages 里的 e2e-mixed 行出现（分组 / 排序 / 内容区用例的起点）。 */
export async function openWorkbenchWithPages(page) {
  await openWorkbench(page);
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
}

/** 打开页 tab 条上的大纲浮层。tabTitle 空 = 不到两个 tab 时那一个「大纲」钮。
 *  已经由这个钮开着时不再点（再点会把它关掉）。 */
export async function openOutline(page, tabTitle) {
  const name = tabTitle ? tabTitle + '的大纲' : '大纲';
  const pop = page.locator('#wboutline-pop');
  const button = page.getByRole('button', { name, exact: true });
  if (await pop.isVisible() && (await button.getAttribute('aria-expanded')) === 'true') return;
  await button.click();
  await expect(pop).toBeVisible();
}

/** 当前舞台形态（#wbroot 的 data-page-mode）。 */
export function stageForm(page) {
  return page.locator('#wbroot').evaluate((el) => el.getAttribute('data-page-mode'));
}
