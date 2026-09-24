import fs from 'node:fs/promises';

import { expect, test } from '@playwright/test';

// 导出（pp2 切片 3 收敛）：用户面只剩「导出整个画布为离线可交互 HTML」
// （/api/export-page-html，ADR 0033）。横条「导出」钮直接开这个对话框；
// 有 HTTPS 静态资源时逐项批准后才冻结下载。两条用例合一：真下载一次守离线
// 文件全形态，同一页面上 route 两个端点再走一遍批准状态机。

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
}

function picker(page) {
  return page.locator('dialog.wb-export-picker');
}

test('HUD export：离线可交互 HTML 全形态 + 远程资源逐项批准后精确快照', async ({ page, context }, testInfo) => {
  await openWorkbench(page);
  await page.locator('.wb-page[data-vpage="e2e-dir-ios"]').click();
  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('e2e-dir-ios');

  // pp2 切片 3：对话框不再给格式选择，打开就是可交互 HTML。
  await page.locator('#wbexport-open').click();
  const dialog = picker(page);
  await expect(dialog.locator('.wb-offline-summary')).toContainText('1 个 Section · 1 个 Frame');
  await expect(dialog.getByRole('button', { name: '检查并下载' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: '检查并下载' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('e2e-dir-ios__interactive.html');
  const file = testInfo.outputPath('e2e-dir-ios__interactive.html');
  await download.saveAs(file);
  const body = await fs.readFile(file, 'utf8');
  expect(body).not.toMatch(/(?:src|href)=["']\/(?:sites|kits|workbench|api)\//);

  const offline = await context.newPage();
  await offline.setViewportSize({ width: 1280, height: 720 });
  await offline.goto('file://' + file.replaceAll('\\', '/'));
  // 分享壳 = workbench 外壳（ADR 0033）：满铺画布 + 浮动玻璃面板（大纲）+ 底部横条。
  await expect(offline.locator('.wb-stage-wrap > .wb-stage > .wb-panel > .wb-zoom-wrap > .wb-library')).toHaveCount(1);
  await expect(offline.locator('#wboutline .ol-sec')).toHaveCount(1);
  await expect(offline.locator('#wboutline .ol-row')).toHaveCount(1);
  await expect(offline.locator('.wb-library .wb-lib-item[data-ann-section]')).toHaveCount(1);
  await expect(offline.locator('.wb-library .wb-sec-row .wb-screen[id^="frame-"]')).toHaveCount(1);
  await expect(offline.locator('#wbside.wb-side.wb-glass')).toHaveCount(1);
  await expect(offline.locator('#wbstrip.wb-strip.wb-glass')).toBeVisible();
  await expect(offline.locator('#wbsection-nav-position')).toHaveText('1 / 1');
  await expect(offline.locator('.share-frame-viewport, .share-outline, .share-section')).toHaveCount(0);
  await offline.getByRole('button', { name: 'Try it' }).click();
  await expect(offline.locator('[data-result]')).toHaveText('Done');

  // 画布是 #wbstage 这个 scrollport：普通滚轮滚动它、不缩放；ctrl+滚轮缩放（zoom 轴 0.5–5，
  // 写在 .wb-library 的 --wb-board-zoom 上）并改读数；横条最左的钮收起 / 展开面板。
  const stageScroll = () => offline.evaluate(() => {
    const s = document.getElementById('wbstage');
    return { top: s.scrollTop, zoom: document.querySelector('.wb-library').style.getPropertyValue('--wb-board-zoom') };
  });
  const start = await stageScroll();
  expect(start.zoom).toBe('1');
  await offline.mouse.move(900, 300);
  await offline.mouse.wheel(0, 300);
  await expect.poll(async () => (await stageScroll()).top).toBeGreaterThan(start.top);
  expect((await stageScroll()).zoom).toBe('1');
  await offline.keyboard.down('Control');
  await offline.mouse.wheel(0, -100);
  await offline.keyboard.up('Control');
  await expect.poll(async () => (await stageScroll()).zoom).toBe('1.08');
  await expect(offline.locator('#wbzoom-label')).toHaveText('108%');
  await offline.locator('#wbzoom-label').click();
  await expect(offline.locator('#wbzoom-label')).toHaveText('100%');

  const sideBefore = await offline.locator('#wbside').boundingBox();
  await offline.locator('#wbside-toggle').click();
  await expect(offline.locator('#wbroot')).toHaveClass(/wb-side-collapsed/);
  await expect(offline.locator('#wbside-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await offline.locator('#wbside').boundingBox()).width).toBeLessThan(sideBefore.width);
  await offline.locator('#wbside-toggle').click();
  await expect(offline.locator('#wbroot')).not.toHaveClass(/wb-side-collapsed/);

  // 窄屏（≤ 760）：面板收起、帧竖排按视口宽适配，页面与画布都没有横向滚动。
  await offline.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => offline.evaluate(() => {
    const s = document.getElementById('wbstage');
    return document.documentElement.scrollWidth <= window.innerWidth && s.scrollWidth <= s.clientWidth + 1;
  })).toBe(true);
  await expect(offline.locator('#wbzoom-label')).toBeHidden();

  // ── 远程资源逐项批准（原独立用例并入：真下载已走完一次无远程资源的扫描，
  // 这里 route 掉 scan / download 端点，守对话框的批准状态机——不需要第二次
  // 开工作台；重开对话框会重新发 scan，route 正好接住）。服务端 scan /
  // download 的契约在 export-page-html-api.test.js。
  const digest = 'a'.repeat(64);
  let downloadBody = null;
  await page.route('**/api/export-page-html/scan', async (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      pageId: 'e2e-dir-ios', sectionCount: 1, frameCount: 1,
      remoteResources: [{ url: 'https://assets.example/icon.svg', origin: 'https://assets.example', mime: 'image/svg+xml', size: 321, sha256: digest }],
    }),
  }));
  await page.route('**/api/export-page-html', async (route) => {
    downloadBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: 'text/html',
      headers: { 'Content-Disposition': 'attachment; filename="e2e-dir-ios__interactive.html"' },
      body: '<!doctype html><title>approved</title>',
    });
  });

  // 第一次真下载后对话框还开着，先关掉再重开（重开会重新发 scan，route 接得住）。
  await page.locator('.wb-export-close').click();
  await page.locator('#wbexport-open').click();
  const approvalDialog = picker(page);
  await approvalDialog.getByRole('button', { name: '检查并下载' }).click();
  await expect(approvalDialog.locator('.wb-offline-resource')).toContainText('https://assets.example · image/svg+xml · 321 B');
  await expect(approvalDialog.getByRole('button', { name: '确认并下载' })).toBeDisabled();
  await approvalDialog.locator('.wb-offline-resource input').check();
  const [approvedDownload] = await Promise.all([
    page.waitForEvent('download'),
    approvalDialog.getByRole('button', { name: '确认并下载' }).click(),
  ]);
  expect(approvedDownload.suggestedFilename()).toBe('e2e-dir-ios__interactive.html');
  expect(downloadBody.approvals).toEqual([{
    url: 'https://assets.example/icon.svg', origin: 'https://assets.example', mime: 'image/svg+xml', size: 321, sha256: digest,
  }]);
});
