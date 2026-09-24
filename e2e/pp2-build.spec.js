import { expect, test } from '@playwright/test';

import { E2E_SITES_DIR } from './env.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// pp2 切片 1：页是「源码 → 编译 → dist」。e2e-jsx 不进共享 registry 固件
// （多一条页会撞翻断言整份 Pages 清单的 spec），这里用共用的临时登记 helper
// 自己登记、用完恢复。没赶上启动全量编译的条目由 serve 层的懒编译兜住，
// 正好是这条链路的实测。
// /sites/ 出 dist 与缺源码 500 的 HTTP 层在 src/server/sites-api.test.js
// （已编译态下沉用例 + frame-doc.test.js 的「源码不存在」）。
const SITE_DIR = `${E2E_SITES_DIR}/jsx-site`;

test.beforeEach(async ({ request }) => {
  appendRegistryEntry({ id: 'e2e-jsx', title: 'E2E JSX', kind: 'dir', path: SITE_DIR, board: 'ios' });
  await request.post('/registry/reload');
});

test.afterEach(async ({ request }) => {
  await restoreRegistryFixture(request);
});

test('.jsx 帧编译后出现在工作台画布，DOM 带 data-pp-id', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);

  await page.locator('.wb-page[data-vpage="e2e-jsx"]').click();
  const frame = page.locator('#wb-board-panel [data-screen="hello"]');
  await expect(frame).toContainText('E2E jsx-site hello');

  // 编译期打进去的源码锚点接进了 DOM（编号规则本身由 page-compiler.test.js 守）。
  await expect(frame.locator('[data-pp-id]').first()).toHaveAttribute('data-pp-id', /.+/);
  // 帧默认导出也是函数组件：根宿主元素带 data-pp-comp。
  await expect(frame.locator('[data-pp-comp="Hello"]')).toHaveCount(1);

  // 缺源码屏：serve 500 → 工作台的错误面板。
  await expect(page.locator('#wb-board-panel [data-screen="ghost"] .wb-screen-err')).toHaveCount(1);

  // .jsx 帧 import pinpoint/kit：kit 的 JSX 印章渲染进 dist。
  const kitFrame = page.locator('#wb-board-panel [data-screen="kit-frame"]');
  await expect(kitFrame.locator('.ios-bubble')).toContainText('kit 气泡');
  await expect(kitFrame.locator('[data-pp-comp="Bubble"]')).toHaveCount(1);

  // comp section（variants 墙）：两格页内组件，无机壳 comp 画板、不出尺寸行。
  const badgeNew = page.locator('#wb-board-panel [data-screen="badge-new"]');
  await expect(badgeNew).toHaveClass(/wb-screen--comp/);
  await expect(badgeNew.locator('.wb-comp-stage')).toHaveCount(1);
  await expect(badgeNew.locator('.ios-stage')).toHaveCount(0);
  await expect(badgeNew.locator('.e2e-badge')).toHaveText('新');
  await expect(badgeNew.locator('[data-pp-comp="Badge"]')).toHaveCount(1);
  await expect(badgeNew.locator('.wb-screen-dim')).toHaveCount(0);
  await expect(page.locator('#wb-board-panel [data-screen="badge-hot"] .e2e-badge')).toHaveText('热');
});
