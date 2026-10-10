import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR, E2E_REGISTRY, E2E_SITES_DIR } from './env.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// 页 tab（ADR 0041）：同一页里 tab 只是 section 的视图分组。固件 tabs-site 有两个 tab
// （comps 组件：btn-wall 两帧 + chip-wall 一帧；flow 交互：onboard 两帧），
// tabs-one-site 只有一个 tab，e2e-ios 是不带 tab 的存量页。
// 覆盖：条只在 ≥ 2 个 tab 时出现、叠在底部横条正上方；切换只挂当前 tab 的 section；
// 序号按 tab 从 A 重来；活动 tab 刷新后保持；focusFrame 指到别的 tab 的帧时先切 tab；
// 分享导出带全部 tab、有能用的切换条；ppnt list --frames / check --frame <tab>:A1。
const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABS_DIR = path.join(E2E_SITES_DIR, 'tabs-site');
const ONE_DIR = path.join(E2E_SITES_DIR, 'tabs-one-site');
const DIST_ENTRIES = ['e2e-tabs', 'e2e-tabs-one'].map((id) => path.join(E2E_DATA_DIR, 'dist', id));

async function ppnt(args, { expectFail = false } = {}) {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (!expectFail) throw error;
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

async function openBoard(page, query) {
  await page.goto(`/index.html?${query}`);
  await page.waitForFunction(() => window.workbench && window.workbench.activeTabId);
  // 画布挂完：至少一个帧在 DOM 里
  await expect(page.locator('#wb-board-panel [data-screen]').first()).toBeAttached();
}

const visibleScreens = (page) => page.locator('#wb-board-panel [data-screen]');
const barBox = async (page, id) => page.locator(id).boundingBox();

test.beforeEach(async ({ request }) => {
  appendRegistryEntry({ id: 'e2e-tabs', title: 'E2E Tabs', kind: 'dir', path: TABS_DIR, board: 'ios' });
  appendRegistryEntry({ id: 'e2e-tabs-one', title: 'E2E Tabs One', kind: 'dir', path: ONE_DIR, board: 'ios' });
  await request.post('/registry/reload');
});

test.afterEach(async ({ request }) => {
  for (const dir of DIST_ENTRIES) fs.rmSync(dir, { recursive: true, force: true });
  await restoreRegistryFixture(request);
});

test('tab 条：存量页与单 tab 页没有；两个 tab 的页叠在横条正上方，切换只挂当前 tab，序号按 tab 从 A 重来，活动 tab 刷新后保持', async ({ page }) => {
  test.setTimeout(90_000);

  // 存量页（无 tabs）：条整个不存在
  await openBoard(page, 'page=e2e-ios');
  await expect(page.locator('#wbtabbar')).toHaveCount(0);

  // 单 tab 页：同样没有条，画布正常
  await openBoard(page, 'page=e2e-tabs-one');
  await expect(page.locator('#wbtabbar')).toHaveCount(0);
  await expect(visibleScreens(page)).toHaveCount(1);

  // 两个 tab 的页
  await openBoard(page, 'page=e2e-tabs');
  const bar = page.locator('#wbtabbar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('[role="tab"]')).toHaveText(['组件', '交互']);
  await expect(bar.locator('[role="tab"][aria-selected="true"]')).toHaveText('组件');

  // 位置：与横条平行 —— 水平居中对齐，底边在横条顶边之上
  const tabBox = await barBox(page, '#wbtabbar');
  const stripBox = await barBox(page, '#wbstrip');
  expect(tabBox.y + tabBox.height).toBeLessThanOrEqual(stripBox.y + 0.5);
  expect(stripBox.y - (tabBox.y + tabBox.height)).toBeLessThan(24);
  expect(Math.abs((tabBox.x + tabBox.width / 2) - (stripBox.x + stripBox.width / 2))).toBeLessThan(2);

  // 第一个 tab：只挂 comps 的三帧；序号 A、B 两段
  await expect(visibleScreens(page)).toHaveCount(3);
  await expect(page.locator('[data-screen="btn-default"]')).toBeAttached();
  await expect(page.locator('[data-screen="ob-welcome"]')).toHaveCount(0);
  await expect(page.locator('[data-ann-section="btn-wall"] .wb-cap-ref--section')).toHaveText('A');
  await expect(page.locator('[data-ann-section="chip-wall"] .wb-cap-ref--section')).toHaveText('B');

  // 切到 flow：换成 onboard 的两帧；序号从 A 重来
  await bar.locator('[role="tab"][data-tab="flow"]').click();
  await expect(bar.locator('[role="tab"][aria-selected="true"]')).toHaveText('交互');
  await expect(visibleScreens(page)).toHaveCount(2);
  await expect(page.locator('[data-screen="btn-default"]')).toHaveCount(0);
  await expect(page.locator('[data-ann-section="onboard"] .wb-cap-ref--section')).toHaveText('A');
  await expect(page.locator('[data-screen="ob-welcome"] .wb-cap-ref')).toHaveText('A1');
  expect(await page.evaluate(() => window.workbench.activeTabId())).toBe('flow');

  // 刷新后还在 flow（本机偏好 activeTabByPage）
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.workbench.activeTabId);
  await expect(page.locator('#wbtabbar [role="tab"][aria-selected="true"]')).toHaveText('交互');
  await expect(visibleScreens(page)).toHaveCount(2);
});

test('focusFrame 指到别的 tab 的帧时先切 tab 再定位', async ({ page }) => {
  test.setTimeout(60_000);
  await openBoard(page, 'page=e2e-tabs');
  await expect(page.locator('#wbtabbar [role="tab"][aria-selected="true"]')).toHaveText('组件');
  await expect(page.locator('[data-screen="ob-done"]')).toHaveCount(0);

  const focused = await page.evaluate(() => window.workbench.focusFrame('onboard', 'ob-done'));
  expect(focused).toBeTruthy();
  await expect(page.locator('#wbtabbar [role="tab"][aria-selected="true"]')).toHaveText('交互');
  await expect(page.locator('[data-screen="ob-done"]')).toBeAttached();
  expect(await page.evaluate(() => window.workbench.activeTabId())).toBe('flow');
});

test('分享导出带全部 tab，切换条能用；单 tab 页导出没有条', async ({ page, request }) => {
  test.setTimeout(90_000);
  await ppnt(['build', 'e2e-tabs']);
  await ppnt(['build', 'e2e-tabs-one']);

  const exportTo = async (pageId) => {
    const res = await request.post('/api/export-page-html', { data: { pageId, approvals: [] } });
    expect(res.ok()).toBeTruthy();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-tabs-share-')), `${pageId}.html`);
    fs.writeFileSync(file, await res.text());
    return file;
  };

  const sharePath = await exportTo('e2e-tabs');
  await page.goto(`file://${sharePath}`);
  const bar = page.locator('#wbtabbar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('[role="tab"]')).toHaveText(['组件', '交互']);
  // 起始：第一个 tab 的段落可见，第二个 tab 的藏着，但都在文档里
  await expect(page.locator('#section-btn-wall')).toBeVisible();
  await expect(page.locator('#section-onboard')).toBeHidden();
  await expect(page.locator('#section-onboard')).toBeAttached();
  await expect(page.locator('#wboutline .ol[data-tab="flow"]')).toBeHidden();
  // 横条在 tab 条下面
  const tabBox = await bar.boundingBox();
  const stripBox = await page.locator('#wbstrip').boundingBox();
  expect(tabBox.y + tabBox.height).toBeLessThanOrEqual(stripBox.y + 0.5);

  await bar.locator('[role="tab"][data-tab="flow"]').click();
  await expect(bar.locator('[role="tab"][aria-selected="true"]')).toHaveText('交互');
  await expect(page.locator('#section-onboard')).toBeVisible();
  await expect(page.locator('#section-btn-wall')).toBeHidden();
  await expect(page.locator('#wboutline .ol[data-tab="flow"]')).toBeVisible();
  // 序号按 tab 从 A 重来
  await expect(page.locator('#section-onboard .wb-cap-ref--section')).toHaveText('A');
  await expect(page.locator('#wbsection-nav-position')).toHaveText('1 / 2');

  // 深链指到另一个 tab 的帧：先切 tab 再定位
  await page.goto(`file://${sharePath}#frame-ob-done`);
  await expect(page.locator('#wbtabbar [role="tab"][aria-selected="true"]')).toHaveText('交互');
  await expect(page.locator('#frame-ob-done')).toBeVisible();
  await expect(page.locator('#section-btn-wall')).toBeHidden();

  // 单 tab 页：没有条
  await page.goto(`file://${await exportTo('e2e-tabs-one')}`);
  await expect(page.locator('#wbtabbar')).toHaveCount(0);
  await expect(page.locator('#section-solo')).toBeVisible();
});

test('ppnt：list --frames 按 tab 分组，check --frame <tab>:A1 可用，裸 A1 歧义时报错', async () => {
  test.setTimeout(60_000);
  await ppnt(['build', 'e2e-tabs']);

  const list = await ppnt(['list', 'e2e-tabs', '--frames']);
  expect(list.stdout).toContain('comps:A1');
  expect(list.stdout).toContain('flow:A1');
  expect(list.stdout).toContain('ob-welcome');
  expect(list.stdout).toMatch(/2 个 tab/);

  // flow:A1 解析成 ob-welcome（账本里还没有标注，所以是 0 条而不是报错）
  const checked = await ppnt(['check', 'e2e-tabs', '--frame', 'flow:A1']);
  expect(checked.stdout).toContain('共 0 条');
  const unknownTab = await ppnt(['check', 'e2e-tabs', '--frame', 'nope:A1'], { expectFail: true });
  expect(unknownTab.code).not.toBe(0);
  expect(unknownTab.stdout + unknownTab.stderr).toContain('这页没有 tab');

  // 裸 A1 在两个 tab 里都有：给出带 tab 的候选，不猜
  const ambiguous = await ppnt(['check', 'e2e-tabs', '--frame', 'A1'], { expectFail: true });
  expect(ambiguous.code).not.toBe(0);
  expect(ambiguous.stdout + ambiguous.stderr).toContain('comps:A1');
  expect(ambiguous.stdout + ambiguous.stderr).toContain('flow:A1');
});
