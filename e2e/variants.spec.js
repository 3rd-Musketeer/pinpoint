import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY, E2E_SITES_DIR } from './env.js';
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

const frame = (page, id) => page.locator(`#wb-board-panel .wb-screen[data-screen="${id}"]`);
const rectOf = (page, id) => frame(page, id).locator('.ios-stage').evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, width: r.width };
});

async function openVariantsPage(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await page.locator('.wb-page[data-vpage="e2e-variants"]').click();
  await expect(frame(page, 'start')).toContainText('开始');
}

test('默认收起：只摆第一个变体，后面的帧紧挨着补位；图注是 A1 / A2a / A3', async ({ page }) => {
  await openVariantsPage(page);
  await expect(frame(page, 'confirm-grant')).not.toHaveClass(/wb-var-off/);
  for (const id of ['confirm-check', 'confirm-inline']) await expect(frame(page, id)).toHaveClass(/wb-var-off/);

  const cap = (id) => frame(page, id).locator('.wb-screen-cap .wb-cap-ref');
  await expect(cap('start')).toHaveText('A1');
  await expect(cap('confirm-grant')).toHaveText('A2a');
  await expect(cap('done')).toHaveText('A3');

  // 收起的变体挪出了画布；done 补到第三列，和前两列的间距一致（没有空列）。
  const [a, b, c] = [await rectOf(page, 'start'), await rectOf(page, 'confirm-grant'), await rectOf(page, 'done')];
  expect(Math.abs((c.left - b.right) - (b.left - a.right))).toBeLessThan(1);
  expect((await rectOf(page, 'confirm-check')).left).toBeLessThan(-40000);
});

test('展开后每个变体图注有 tickbox：勾哪个哪个选中并高亮；收起只剩勾选的；偏好跨刷新保持', async ({ page }) => {
  await openVariantsPage(page);
  const tick = (id) => frame(page, id).locator('[data-var-pick]');
  // 画布是自己的滚动容器：控件在视口外时先用导航把那一帧带进来（帧已在画布上，不改选中）再点。
  const click = async (id, locator) => {
    await page.evaluate((screen) => window.workbench.focusFrame('flow', screen, { smooth: false }), id);
    await locator.click();
  };
  const toggleOf = (id) => frame(page, id).locator('[data-var-toggle]');
  const collapse = page.locator('#wb-board-panel .wb-var-collapse');

  // 收起态没有 tickbox，也没有外部的 a / b / c。
  await expect(tick('confirm-grant')).toBeHidden();
  await expect(page.locator('.wb-var-chip')).toHaveCount(0);

  // 展开：三个并排，每个图注前一个 tickbox，勾的是第一个；高亮环也在第一个上。
  await click('confirm-grant', toggleOf('confirm-grant'));
  for (const id of ['confirm-grant', 'confirm-check', 'confirm-inline']) await expect(tick(id)).toBeVisible();
  await expect(tick('confirm-grant')).toHaveAttribute('aria-checked', 'true');
  await expect(tick('confirm-check')).toHaveAttribute('aria-checked', 'false');
  await expect(frame(page, 'confirm-grant')).toHaveClass(/wb-var-sel/);
  expect(await frame(page, 'confirm-grant').locator('.ios-stage').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  // 展开后图注上没有展开 / 收起钮；“收起”在组底框的上沿，不占图注的位置。
  for (const id of ['confirm-grant', 'confirm-check', 'confirm-inline']) await expect(frame(page, id).locator('.wb-var-ctl')).toBeHidden();
  await expect(page.locator('#wb-board-panel .wb-var-collapse')).toBeVisible();

  // 勾第三个：勾和环移到它，三个仍都在；组底框跟着在。
  await click('confirm-inline', tick('confirm-inline'));
  await expect(tick('confirm-inline')).toHaveAttribute('aria-checked', 'true');
  await expect(tick('confirm-grant')).toHaveAttribute('aria-checked', 'false');
  await expect(frame(page, 'confirm-inline')).toHaveClass(/wb-var-sel/);
  await expect(frame(page, 'confirm-grant')).not.toHaveClass(/wb-var-sel/);
  await expect(frame(page, 'confirm-grant')).not.toHaveClass(/wb-var-off/);

  // 刷新后仍是展开 + 勾第三个（本机偏好，不进 board.json）。
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(tick('confirm-inline')).toHaveAttribute('aria-checked', 'true');

  // 收起：只剩勾选的第三个，tickbox 不再出现。
  await click('confirm-grant', collapse);
  await expect(frame(page, 'confirm-inline')).not.toHaveClass(/wb-var-off/);
  await expect(frame(page, 'confirm-grant')).toHaveClass(/wb-var-off/);
  await expect(frame(page, 'confirm-check')).toHaveClass(/wb-var-off/);
  await expect(tick('confirm-inline')).toBeHidden();

  // 回到缺省（收起 + 选第一个）时偏好键被清掉，不积灰：展开、勾第一个、收起。
  await click('confirm-inline', toggleOf('confirm-inline'));
  await click('confirm-grant', tick('confirm-grant'));
  await click('confirm-grant', collapse);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('pinpoint-wb') || '{}').variantsByPage || {}))).toEqual([]);
});

test('定位到被收起的变体：先把它请出来；导航不把收起的变体当落点', async ({ page }) => {
  await openVariantsPage(page);
  await expect(frame(page, 'confirm-inline')).toHaveClass(/wb-var-off/);
  expect(await page.evaluate(() => window.workbench.focusFrame('flow', 'confirm-inline', { smooth: false }))).toBe(true);
  await expect(frame(page, 'confirm-inline')).not.toHaveClass(/wb-var-off/);
  await expect(frame(page, 'confirm-grant')).toHaveClass(/wb-var-off/);
  // 大纲（左栏）里三个变体各有一行，编号 A2a / A2b / A2c。
  await expect(page.locator('#wboutline')).toContainText('A2c');
});

// ppnt shot：一张图要把变体组整组拍进去（headless 工作台不写偏好，临时全部展开）。
const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pngWidth = (file) => fs.readFileSync(file).readUInt32BE(16);

test('ppnt shot：组 = 每个变体一张图；整段一张图里变体并排（比单帧宽得多）', async () => {
  const run = (args) => execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
    cwd: ROOT,
    env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY, PINPOINT_ORIGIN: E2E_BASE_URL },
  });
  const dir = path.join(E2E_DATA_DIR, 'shot', 'e2e-variants');
  fs.rmSync(dir, { recursive: true, force: true });

  const group = await run(['shot', 'A2', '--page', 'e2e-variants']);
  for (const id of ['confirm-grant', 'confirm-check', 'confirm-inline']) {
    expect(group.stdout).toContain(path.join(dir, `${id}.png`));
    expect(fs.statSync(path.join(dir, `${id}.png`)).size).toBeGreaterThan(2000);
  }
  const single = pngWidth(path.join(dir, 'confirm-grant.png'));

  // 变体各拍各的：收起态下隐藏的变体不能是空图（宽度与选中的那张一样）。
  expect(pngWidth(path.join(dir, 'confirm-inline.png'))).toBe(single);

  const section = await run(['shot', 'flow', '--page', 'e2e-variants']);
  const sectionPng = (section.stdout.match(/(\S+\.png)/) || [])[1];
  expect(sectionPng).toBeTruthy();
  // 开始 + 三个变体 + 完成 = 5 屏并排，宽度远大于单帧的 3 倍。
  expect(pngWidth(sectionPng)).toBeGreaterThan(single * 3);
});

test('分享页导出：变体全部展开，评审者选中的高亮', async ({ request }) => {
  const exported = async (variantSelection) => {
    const res = await request.post('/api/export-page-html', { data: { pageId: 'e2e-variants', approvals: [], variantSelection } });
    expect(res.ok()).toBe(true);
    return res.text();
  };
  const sel = (html, id) => /wb-var-sel/.test((html.match(new RegExp(`<div class="([^"]*)" id="frame-${id}"`)) || [])[1] || '');

  const dflt = await exported({});
  expect([sel(dflt, 'confirm-grant'), sel(dflt, 'confirm-check'), sel(dflt, 'confirm-inline')]).toEqual([true, false, false]);
  const picked = await exported({ 'flow\0confirm': 'confirm-inline' });
  expect([sel(picked, 'confirm-grant'), sel(picked, 'confirm-check'), sel(picked, 'confirm-inline')]).toEqual([false, false, true]);
  expect(sel(picked, 'start')).toBe(false);
});

test('展开的组有组底框，收起没有；框圈住组里全部变体', async ({ page }) => {
  await openVariantsPage(page);
  await expect(page.locator('#wb-board-panel .wb-var-box')).toHaveCount(0);
  await frame(page, 'confirm-grant').locator('[data-var-toggle]').click();
  const box = page.locator('#wb-board-panel .wb-var-box');
  await expect(box).toHaveCount(1);
  // 展开会带动画把视窗移到选中的变体：等位置不再变再量。
  await expect.poll(async () => { const a = (await rectOf(page, 'confirm-grant')).left; await page.waitForTimeout(150); return a === (await rectOf(page, 'confirm-grant')).left; }).toBe(true);
  const b = await box.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
  const first = await rectOf(page, 'confirm-grant');
  const last = await rectOf(page, 'confirm-inline');
  const next = await rectOf(page, 'done');
  expect(b.left).toBeLessThan(first.left);
  expect(b.right).toBeGreaterThan(last.right);
  expect(b.right).toBeLessThan(next.left);
  await page.evaluate(() => window.workbench.focusFrame('flow', 'confirm-grant', { smooth: false }));
  await page.locator('#wb-board-panel .wb-var-collapse').click();
  await expect(page.locator('#wb-board-panel .wb-var-box')).toHaveCount(0);
});

test('展开时视窗带到选中的变体身上，不被挤出去', async ({ page }) => {
  await openVariantsPage(page);
  const toggle = frame(page, 'confirm-grant').locator('[data-var-toggle]');
  await toggle.click();
  await frame(page, 'confirm-inline').locator('[data-var-pick]').click();
  await page.locator('#wb-board-panel .wb-var-collapse').click();
  await page.setViewportSize({ width: 900, height: 800 });
  await page.evaluate(() => window.workbench.focusFrame('flow', 'confirm-inline', { smooth: false }));
  await frame(page, 'confirm-inline').locator('[data-var-toggle]').click();
  await expect.poll(async () => {
    const r = await rectOf(page, 'confirm-inline');
    return r.left >= 0 && r.right <= 900;
  }).toBe(true);
});
