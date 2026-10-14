// 多个 spec 共用的标注客户端 helper：开带标注客户端的页、写一条标注、等保存、等 SPA 换路由落定。
import { expect } from '@playwright/test';

/** 打开一个注入了标注客户端的页面（站点页、SPA 固件），等 window.pinpoint 出现。 */
export async function openAnnotated(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.pinpoint);
}

/** 点目标 → 标注框出现 → 填字 → 关框，等框收起。
 *  scope 是 page 或 frameLocator（框在哪个文档里就传哪个）；target 是选择器或 Locator。 */
export async function annotate(scope, target, text) {
  await (typeof target === 'string' ? scope.locator(target) : target).click();
  const box = scope.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('#ann-input').fill(text);
  await box.locator('#ann-close').click();
  await expect(box).toBeHidden();
}

/** 等下一次成功的 POST /save 应答。和触发保存的动作放进同一个 Promise.all，先挂监听再动手。 */
export function waitForSave(page) {
  return page.waitForResponse((r) => new URL(r.url()).pathname === '/save' && r.request().method() === 'POST' && r.ok());
}

/** SPA 换路由后等标注客户端换完账本：路径到位、epoch 比 prevEpoch 新、routing 结束，
 *  才算切换加 hydrate 完成。getState() 没有 epoch 的客户端只等路径变（后面的断言仍会以真实原因失败）。 */
export async function waitRouteSettled(page, pathname, prevEpoch) {
  await page.waitForFunction(([path, epoch]) => {
    const st = window.pinpoint && window.pinpoint.getState ? window.pinpoint.getState() : {};
    if (typeof st.epoch !== 'number') return location.pathname === path;
    return location.pathname === path && st.epoch > epoch && !st.routing;
  }, [pathname, prevEpoch]);
}
