import fs from 'node:fs/promises';

import { expect, test } from '@playwright/test';

// 导出 picker（decisions 2026-08-15d）：HUD 单入口 → 两栏对话框（proto tree 任意多选 +
// 实时预览 + 背景三档），单张直出 PNG、多张服务端打包 zip。预览走 /api/export-image
// 低清档（scale 1）——这些用例把低清档 mock 成 1×1 PNG 保持快速；下载动作（scale 2）
// 打真服务端，端到端验证渲染与打包管线。

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
}

// 低清预览档（scale 1）mock 成 1×1 PNG；scale 2 的真实下载请求放行给服务端。
// 返回 requests 数组（已解析的 POST body），供断言请求次数与载荷。
async function stubPreviewRequests(page) {
  const requests = [];
  await page.route('**/api/export-image', async (route) => {
    const body = route.request().postDataJSON();
    if (body.scale !== 1) return route.fallback();
    requests.push(body);
    await route.fulfill({
      contentType: 'image/png',
      headers: { 'X-Export-Width': '1', 'X-Export-Height': '1' },
      body: TINY_PNG,
    });
  });
  return requests;
}

function picker(page) {
  return page.locator('dialog.wb-export-picker');
}

// 模板 Example Library 板面：6 sections / 11 frames（home 1 · brew-flow 3 ·
// msg-flow 3 · lock 1 · ab 2 · settings 1），字母 A-F。
const SECTION_IDS = ['home', 'brew-flow', 'msg-flow', 'lock', 'ab', 'settings'];

async function openPicker(page) {
  await page.locator('#wbexport-open').click();
  await expect(picker(page)).toBeVisible();
  await picker(page).getByRole('button', { name: /Frame 图片/ }).click();
}

async function toggleSectionOff(page, sectionId) {
  await picker(page).locator(`.wb-pk-sec[data-section="${sectionId}"]`).click();
}

test('HUD export produces one offline interactive HTML with outline and spatial structure', async ({ page, context }, testInfo) => {
  await openWorkbench(page);
  await page.locator('.wb-page[data-vpage="e2e-dir-ios"]').click();
  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('e2e-dir-ios');

  await page.locator('#wbexport-open').click();
  const dialog = picker(page);
  await expect(dialog.getByRole('button', { name: /可交互 HTML/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Frame 图片/ })).toBeVisible();
  await dialog.getByRole('button', { name: /可交互 HTML/ }).click();
  await expect(dialog.locator('.wb-offline-summary')).toContainText('1 个 Section · 1 个 Frame');

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
  await offline.goto('file://' + file.replaceAll('\\', '/'));
  await expect(offline.locator('.share-outline-section > a:not(.share-outline-frame)')).toHaveCount(1);
  await expect(offline.locator('.share-outline-frame')).toHaveCount(1);
  await expect(offline.locator('.share-section')).toHaveCount(1);
  await expect(offline.locator('.share-frame-viewport')).toHaveCount(1);
  await offline.getByRole('button', { name: 'Try it' }).click();
  await expect(offline.locator('[data-result]')).toHaveText('Done');

  // Workbench 自身锁 body 滚动；分享壳必须显式解除，才能用鼠标滚轮纵向浏览 Section。
  await offline.setViewportSize({ width: 1280, height: 400 });
  await offline.mouse.move(1000, 350);
  await offline.mouse.wheel(0, 700);
  await expect.poll(() => offline.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await offline.mouse.wheel(0, -700);
  await expect.poll(() => offline.evaluate(() => window.scrollY)).toBe(0);
});

test('interactive HTML requires per-resource approval for an exact HTTPS snapshot', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('.wb-page[data-vpage="e2e-dir-ios"]').click();
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

  await page.locator('#wbexport-open').click();
  const dialog = picker(page);
  await dialog.getByRole('button', { name: /可交互 HTML/ }).click();
  await dialog.getByRole('button', { name: '检查并下载' }).click();
  await expect(dialog.locator('.wb-offline-resource')).toContainText('https://assets.example · image/svg+xml · 321 B');
  await expect(dialog.getByRole('button', { name: '确认并下载' })).toBeDisabled();
  await dialog.locator('.wb-offline-resource input').check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: '确认并下载' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('e2e-dir-ios__interactive.html');
  expect(downloadBody.approvals).toEqual([{
    url: 'https://assets.example/icon.svg', origin: 'https://assets.example', mime: 'image/svg+xml', size: 321, sha256: digest,
  }]);
});

test('HUD export button opens the picker with the full page tree preselected', async ({ page }) => {
  const previews = await stubPreviewRequests(page);
  await openWorkbench(page);
  await expect(page.locator('#wbexport-open')).toBeVisible();

  await openPicker(page);
  const dialog = picker(page);
  await expect(dialog).toHaveAttribute('aria-labelledby', 'wb-export-picker-title');
  await expect(dialog.locator('.wb-export-target')).toHaveText('library');
  await expect(dialog.locator('.wb-pk-sec')).toHaveCount(6);
  await expect(dialog.locator('.wb-pk-fr')).toHaveCount(11);
  await expect(dialog.locator('.wb-pk-sec[data-section="home"] .wb-pk-letter')).toHaveText('A');
  await expect(dialog.locator('.wb-pk-fr[data-screen="recipe"] .wb-pk-no')).toHaveText('B2');
  await expect(dialog.locator('.wb-pk-fr[data-screen="recipe"] .wb-pk-dim')).toHaveText('402 × 874');

  // 默认全选：状态回显 + 多张动作钮 + 每帧一张预览图
  await expect(dialog.locator('.wb-pk-st')).toHaveText('已选 11 帧，PNG 2×，画布背景');
  await expect(dialog.locator('.wb-pk-go')).toHaveText('打包下载 zip');
  await expect(dialog.locator('.wb-pk-pv')).toHaveAttribute('data-bg', 'canvas');
  await expect(dialog.locator('.wb-pk-pv-item img')).toHaveCount(11);
  await expect.poll(() => previews.length).toBe(11);
  expect(previews.every((body) => body.kind === 'frame' && body.format === 'png' && body.scale === 1 && body.background === 'canvas')).toBe(true);

  // Esc 原生关闭
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('picker tree: section select-all, frame toggle, empty state disables download', async ({ page }) => {
  const previews = await stubPreviewRequests(page);
  await openWorkbench(page);
  await openPicker(page);
  const dialog = picker(page);

  // section 行 = 整选开关：关掉 brew-flow（3 帧）
  await toggleSectionOff(page, 'brew-flow');
  await expect(dialog.locator('.wb-pk-st')).toHaveText('已选 8 帧，PNG 2×，画布背景');
  await expect(dialog.locator('.wb-pk-fr[data-screen="recipe"]')).toHaveAttribute('aria-checked', 'false');
  await toggleSectionOff(page, 'brew-flow'); // 再点 = 全选回来
  await expect(dialog.locator('.wb-pk-st')).toHaveText('已选 11 帧，PNG 2×，画布背景');

  // 单帧勾选 → 单张动作钮
  await toggleSectionOff(page, 'ab');
  await dialog.locator('.wb-pk-fr[data-screen="ab-a"]').click();
  await expect(dialog.locator('.wb-pk-st')).toHaveText('已选 10 帧，PNG 2×，画布背景');
  // section 行部分选中 = mixed
  await expect(dialog.locator('.wb-pk-sec[data-section="ab"]')).toHaveAttribute('aria-checked', 'mixed');

  // 全部关光 → 空态提示 + 下载禁用（且不再发预览请求）。
  // ab 当前是 mixed（ab-a on）：点 section 行会整选回来，得点 frame 行关掉。
  for (const id of SECTION_IDS) {
    if (id === 'ab') continue;
    await toggleSectionOff(page, id);
  }
  await dialog.locator('.wb-pk-fr[data-screen="ab-a"]').click();
  const sent = previews.length;
  await expect(dialog.locator('.wb-pk-st')).toHaveText('没有选中的帧');
  await expect(dialog.locator('.wb-pk-go')).toBeDisabled();
  await expect(dialog.locator('.wb-pk-go')).toHaveText('下载 PNG');
  await expect(dialog.locator('.wb-pk-pv-empty')).toHaveText('在左侧勾选要导出的帧');
  await expect(dialog.locator('.wb-pk-pv-item')).toHaveCount(0);
  await page.waitForTimeout(700); // > 300ms debounce：空选不应发任何预览请求
  expect(previews.length).toBe(sent);
});

test('background three-state switches the pane and refreshes previews', async ({ page }) => {
  const previews = await stubPreviewRequests(page);
  await openWorkbench(page);
  await openPicker(page);
  const dialog = picker(page);
  await expect(dialog.locator('.wb-pk-pv-item img')).toHaveCount(11);
  await expect.poll(() => previews.length).toBe(11);

  await dialog.locator('.wb-export-option:has-text("白底")').click();
  await expect(dialog.locator('.wb-pk-pv')).toHaveAttribute('data-bg', 'white');
  await expect(dialog.locator('.wb-pk-st')).toHaveText('已选 11 帧，PNG 2×，白底背景');
  await expect.poll(() => previews.length).toBe(22);
  expect(previews.at(-1).background).toBe('white');

  await dialog.locator('.wb-export-option:has-text("透明")').click();
  await expect(dialog.locator('.wb-pk-pv')).toHaveAttribute('data-bg', 'transparent');
  await expect(dialog.locator('.wb-pk-st')).toHaveText('已选 11 帧，PNG 2×，透明背景');
  await expect.poll(() => previews.length).toBe(33);
  expect(previews.at(-1).background).toBe('transparent');
});

test('single selected frame downloads a PNG directly (real render)', async ({ page }) => {
  await stubPreviewRequests(page);
  await openWorkbench(page);
  await openPicker(page);
  const dialog = picker(page);

  // 只留 home（section A 独帧）：关掉其余 section
  for (const id of ['brew-flow', 'msg-flow', 'lock', 'ab', 'settings']) await toggleSectionOff(page, id);
  await expect(dialog.locator('.wb-pk-st')).toHaveText('已选 1 帧，PNG 2×，画布背景');
  await expect(dialog.locator('.wb-pk-go')).toHaveText('下载 PNG');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.locator('.wb-pk-go').click(),
  ]);
  expect(download.suggestedFilename()).toBe('library__home__home@2x.png');
  const body = await fs.readFile(await download.path());
  expect(body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await expect(dialog.locator('.wb-pk-st')).toContainText('已下载 library__home__home@2x.png');
});

test('multi selection posts snapshots to /api/export-zip and downloads the archive', async ({ page }) => {
  await stubPreviewRequests(page);
  await openWorkbench(page);
  await openPicker(page);
  const dialog = picker(page);

  // 留 home + ab-a 两帧：关 brew-flow/msg-flow/lock/settings，再点掉 ab-b
  for (const id of ['brew-flow', 'msg-flow', 'lock', 'settings']) await toggleSectionOff(page, id);
  await dialog.locator('.wb-pk-fr[data-screen="ab-b"]').click();
  await expect(dialog.locator('.wb-pk-st')).toHaveText('已选 2 帧，PNG 2×，画布背景');
  await expect(dialog.locator('.wb-pk-go')).toHaveText('打包下载 zip');

  const zipRequests = [];
  await page.route('**/api/export-zip', async (route) => {
    zipRequests.push(route.request().postDataJSON());
    await route.fallback();
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.locator('.wb-pk-go').click(),
  ]);
  expect(download.suggestedFilename()).toBe('library__frames@2x.zip');
  expect(zipRequests).toHaveLength(1);
  // zip 内容 = 选中的 2 帧 PNG 2× 快照（顺序 = tree 顺序）
  expect(zipRequests[0].entries.map((entry) => [entry.sectionId, entry.screenId])).toEqual([
    ['home', 'home'],
    ['ab', 'ab-a'],
  ]);
  for (const entry of zipRequests[0].entries) {
    expect(entry.kind).toBe('frame');
    expect(entry.format).toBe('png');
    expect(entry.scale).toBe(2);
    expect(entry.background).toBe('canvas');
  }

  // 真服务端渲染 + 打包：zip 魔数 + 成员名 + EOCD 计数
  const zip = await fs.readFile(await download.path());
  expect(zip.subarray(0, 4).toString('ascii')).toBe('PK\x03\x04');
  expect(zip.includes(Buffer.from('library__home__home@2x.png'))).toBe(true);
  expect(zip.includes(Buffer.from('library__ab__ab-a@2x.png'))).toBe(true);
  expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
});
