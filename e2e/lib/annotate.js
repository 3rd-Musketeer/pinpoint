// 多个 spec 共用的标注客户端 helper：开带标注客户端的页、写一条标注、等保存。
import { expect } from '@playwright/test';

/** 打开一个注入了标注客户端的页面（站点页），等 window.pinpoint 出现。 */
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

