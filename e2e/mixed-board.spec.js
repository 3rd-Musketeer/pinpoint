import { expect, test } from '@playwright/test';

// 阶段 6（2026-08-16f 产物与草稿模型）：混合板 = 一个 Page 的 board.json 里同时有
// app/lock 屏（画布条目）与 doc 屏（文档/草稿条目）。stage 形态由选中条目派生：
// 画布条目 → 画布（只摆 app/lock 屏）；文档条目 → 既有 doc 阅读器管线。
// 固件 = e2e/mixed-site（registry dir 条目 e2e-mixed，board:'ios' 页级缺省壳）：
// 原型 section（home/detail 两个 app 屏）+ 文稿 section（spec 产物文档 +
// draft-variants 草稿文档，role:"draft"）。

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
}

async function openMixed(page) {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="e2e-mixed"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"] .ios-stage')).toBeVisible();
}

function stageForm(page) {
  return page.locator('#wbroot').evaluate((el) => el.getAttribute('data-page-mode'));
}

test('混合板：画布条目只摆 app 屏，临时条目列表出「画布」+ 两个文档行', async ({ page }) => {
  await openMixed(page);

  // 画布上只有 app/lock 屏；doc 屏在场但被条目显隐收起，绝不进画布。
  await expect(page.locator('#wb-board-panel [data-screen="detail"] .ios-stage')).toBeVisible();
  await expect(page.locator('#wb-board-panel [data-screen="spec"]')).toBeHidden();
  await expect(page.locator('#wb-board-panel [data-screen="draft-variants"]')).toBeHidden();
  await expect(page.locator('#wb-board-panel .wb-doc-frame:visible')).toHaveCount(0);
  expect(await stageForm(page)).toBe('ios');

  // 临时条目列表（阶段 7 重做第二层）：「画布」行 + 文稿 section 分组 + 两个 doc 行。
  const canvasRow = page.locator('#wbdoc-versions [data-entry-canvas]');
  await expect(canvasRow).toHaveCount(1);
  await expect(canvasRow).toHaveText('画布');
  await expect(canvasRow).toHaveAttribute('data-state', 'on');
  await expect(page.locator('#wbdoc-versions .wb-doc-ver-sec')).toHaveText(['文稿']);
  await expect(page.locator('#wbdoc-versions [data-doc-screen]')).toHaveText(['设计说明', '气泡三手感']);

  // 大纲是画布语汇：只覆盖画布屏，doc 屏不进树（行文本 = 引用号 + 屏名，断言屏名）。
  await expect(page.locator('#wboutline [data-ol-frame] .nm')).toHaveText(['首页', '详情']);
});

test('混合板：点文档行 stage 变阅读器，点「画布」回画布', async ({ page }) => {
  await openMixed(page);

  // 选中产物文档条目 → 阅读器：doc iframe 1:1 铺满，画布 chrome 退场。
  await page.locator('#wbdoc-versions [data-doc-screen="spec"]').click();
  expect(await stageForm(page)).toBe('html');
  const specFrame = page.locator('#wb-board-panel [data-screen="spec"] .wb-doc-frame');
  await expect(specFrame).toBeVisible();
  await expect(page.frameLocator('#wb-board-panel [data-screen="spec"] .wb-doc-frame').locator('#spec-title'))
    .toHaveText('E2E mixed spec');
  await expect(page.locator('#wb-board-panel [data-screen="home"]')).toBeHidden();
  await expect(page.locator('#wbcanvas-hud')).toBeHidden();
  await expect(page.locator('#wboutline')).toBeHidden();
  await expect(page.locator('#wbdoc-versions [data-doc-screen="spec"]')).toHaveAttribute('data-state', 'on');

  // 选中草稿条目 → 同一阅读器管线，换文档。
  await page.locator('#wbdoc-versions [data-doc-screen="draft-variants"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="spec"]')).toBeHidden();
  await expect(page.frameLocator('#wb-board-panel [data-screen="draft-variants"] .wb-doc-frame').locator('#draft-title'))
    .toHaveText('E2E mixed draft');
  // 非默认条目镜像进 URL（深链可直接复制）。
  await expect.poll(() => page.url()).toContain('entry=draft-variants');

  // 点「画布」回画布：两帧回来、阅读器退场、URL 收掉 entry（默认条目不写）。
  await page.locator('#wbdoc-versions [data-entry-canvas]').click();
  expect(await stageForm(page)).toBe('ios');
  await expect(page.locator('#wb-board-panel [data-screen="home"] .ios-stage')).toBeVisible();
  await expect(page.locator('#wb-board-panel [data-screen="detail"] .ios-stage')).toBeVisible();
  await expect(page.locator('#wb-board-panel .wb-doc-frame:visible')).toHaveCount(0);
  await expect(page.locator('#wbcanvas-hud')).toBeVisible();
  await expect(page.locator('#wboutline')).toBeVisible();
  await expect.poll(() => page.url()).not.toContain('entry=');
});

test('混合板：?entry= 深链直达文档条目，非法 entry 落默认画布', async ({ page }) => {
  await page.goto('/index.html?page=e2e-mixed&entry=spec');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  expect(await stageForm(page)).toBe('html');
  await expect(page.frameLocator('#wb-board-panel [data-screen="spec"] .wb-doc-frame').locator('#spec-title'))
    .toHaveText('E2E mixed spec');
  await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('spec');

  // 未知条目 id → 选中解析落默认条目（画布），URL 被重写为真实值。
  await page.goto('/index.html?page=e2e-mixed&entry=nope');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wb-board-panel [data-screen="home"] .ios-stage')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
  await expect.poll(() => page.url()).not.toContain('entry=');
});

test('混合板：条目选择跨 reload 保持（prefs.activeEntryIdByPage）', async ({ page }) => {
  await openMixed(page);
  await page.locator('#wbdoc-versions [data-doc-screen="draft-variants"]').click();
  await expect(page.frameLocator('#wb-board-panel [data-screen="draft-variants"] .wb-doc-frame').locator('#draft-title'))
    .toHaveText('E2E mixed draft');
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('pinpoint-wb')).activeEntryIdByPage
  )).toEqual({ 'e2e-mixed': 'draft-variants' });

  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  // activePageId + 条目双重记忆：reload 直接回到草稿阅读器。
  expect(await stageForm(page)).toBe('html');
  await expect(page.frameLocator('#wb-board-panel [data-screen="draft-variants"] .wb-doc-frame').locator('#draft-title'))
    .toHaveText('E2E mixed draft');
  await expect(page.locator('#wbdoc-versions [data-doc-screen="draft-variants"]')).toHaveAttribute('data-state', 'on');

  // 切回画布条目后 reload：回到画布。
  await page.locator('#wbdoc-versions [data-entry-canvas]').click();
  await expect(page.locator('#wb-board-panel [data-screen="home"] .ios-stage')).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  expect(await stageForm(page)).toBe('ios');
  await expect(page.locator('#wb-board-panel [data-screen="home"] .ios-stage')).toBeVisible();
});
