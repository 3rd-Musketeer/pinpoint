import { expect, test } from '@playwright/test';

import { E2E_SITES_DIR } from './env.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// 变体组（2026-10-10 grilling，数据模型 + 编号引用）：screen 条目写 variants 时，
// 每个变体仍是独立屏（自己的源文件、id、标注），组整组占一个位置号 —— 后面的帧顺延，
// 变体派生 a / b / c。画布这一步先把变体全部摊开成普通帧（收起 / 展开是后续切片）。
// e2e-variants 不进共享 registry 固件（多一条页会撞翻断言整份 Pages 清单的 spec）。
const SITE_DIR = `${E2E_SITES_DIR}/variants-site`;

test.beforeEach(async ({ request }) => {
  appendRegistryEntry({ id: 'e2e-variants', title: 'E2E Variants', kind: 'dir', path: SITE_DIR, board: 'ios' });
  await request.post('/registry/reload');
});

test.afterEach(async ({ request }) => {
  await restoreRegistryFixture(request);
});

test('变体各是一帧：图注 A2a / A2b / A2c，后面的帧顺延成 A3', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await page.locator('.wb-page[data-vpage="e2e-variants"]').click();

  const frame = (id) => page.locator(`#wb-board-panel [data-screen="${id}"]`);
  await expect(frame('start')).toContainText('开始');
  for (const id of ['confirm-grant', 'confirm-check', 'confirm-inline', 'done']) {
    await expect(frame(id).locator(`[data-frame="${id}"]`)).toHaveCount(1);
  }

  // 图注里的显示编号：组占 A2，变体 A2a / A2b / A2c，done 是 A3（不是 A5）。
  const capOf = (id) => page.locator(`#wb-board-panel .wb-screen[data-screen="${id}"] .wb-screen-cap`);
  await expect(capOf('start')).toContainText('A1');
  await expect(capOf('confirm-grant')).toContainText('A2a');
  await expect(capOf('confirm-check')).toContainText('A2b');
  await expect(capOf('confirm-inline')).toContainText('A2c');
  await expect(capOf('done')).toContainText('A3');
});
