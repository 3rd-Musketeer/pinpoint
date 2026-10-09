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

test('chips 换选中的变体，展开并排、选中的高亮，收起回到只剩选中的；偏好跨刷新保持', async ({ page }) => {
  await openVariantsPage(page);
  const chip = (id, pick) => frame(page, id).locator(`[data-var-pick="${pick}"]`);
  // 画布是自己的滚动容器：控件在视口外时先用导航把那一帧带进来（帧已在画布上，不改选中）再点。
  const click = async (id, pick) => {
    await page.evaluate((screen) => window.workbench.focusFrame('flow', screen, { smooth: false }), id);
    await chip(id, pick).click();
  };

  // 收起态点 b：画布上换成 b。
  await click('confirm-grant', 'confirm-check');
  await expect(frame(page, 'confirm-check')).not.toHaveClass(/wb-var-off/);
  await expect(frame(page, 'confirm-grant')).toHaveClass(/wb-var-off/);
  await expect(chip('confirm-check', 'confirm-check')).toHaveAttribute('aria-pressed', 'true');

  // 刷新后仍是 b（本机偏好，不进 board.json）。
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(frame(page, 'confirm-check')).not.toHaveClass(/wb-var-off/);
  await expect(frame(page, 'confirm-grant')).toHaveClass(/wb-var-off/);

  // 展开：三个并排，只有选中的 b 带高亮环。
  // 收起态控件在选中那一帧的图注上（b）；展开后控件只留在组里第一个变体（a）的图注上。
  await frame(page, 'confirm-check').locator('[data-var-toggle]').click();
  await expect(frame(page, 'confirm-check').locator('.wb-var-ctl')).toBeHidden();
  await expect(frame(page, 'confirm-grant').locator('.wb-var-ctl')).toBeVisible();
  for (const id of ['confirm-grant', 'confirm-check', 'confirm-inline']) {
    await expect(frame(page, id)).not.toHaveClass(/wb-var-off/);
  }
  await expect(frame(page, 'confirm-check')).toHaveClass(/wb-var-sel/);
  await expect(frame(page, 'confirm-grant')).not.toHaveClass(/wb-var-sel/);
  expect(await frame(page, 'confirm-check').locator('.ios-stage').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  const [g, k, n, d] = await Promise.all(['confirm-grant', 'confirm-check', 'confirm-inline', 'done'].map((id) => rectOf(page, id)));
  expect(g.left).toBeLessThan(k.left);
  expect(k.left).toBeLessThan(n.left);
  expect(n.right).toBeLessThan(d.left);

  // 展开态点 c：高亮移到 c，三个仍都在；收起后只剩 c。（c 在视口外：先用导航把它带进来，展开态下不改选中。）
  await click('confirm-grant', 'confirm-inline');
  await expect(frame(page, 'confirm-inline')).toHaveClass(/wb-var-sel/);
  await expect(frame(page, 'confirm-check')).not.toHaveClass(/wb-var-sel/);
  await expect(frame(page, 'confirm-grant')).not.toHaveClass(/wb-var-off/);
  await page.evaluate(() => window.workbench.focusFrame('flow', 'confirm-grant', { smooth: false }));
  await frame(page, 'confirm-grant').locator('[data-var-toggle]').click();
  await expect(frame(page, 'confirm-inline')).not.toHaveClass(/wb-var-off/);
  await expect(frame(page, 'confirm-grant')).toHaveClass(/wb-var-off/);
  await expect(frame(page, 'confirm-check')).toHaveClass(/wb-var-off/);

  // 回到缺省（收起 + 选第一个）时偏好键被清掉，不积灰。
  await click('confirm-inline', 'confirm-grant');
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
