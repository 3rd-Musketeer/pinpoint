import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR } from './env.js';

// 标注列表面板（#ann-sidebar）：/sites/ 注入页、扩展注入页、SPA 页这些没有
// workbench 的页面，靠面板看到当前账本的所有标注并点击跳转。入口 = 浏览器工具栏
// pinpoint 扩展图标（主入口，链路见 extension.spec.js）+ 浮动工具条「列表」按钮
// + 快捷键 S；面板顶部有「交互 | 标注」segmented。workbench 页面不提供面板
// （单一控制面）。
//
// 扩展用例与 extension.spec.js 共用同一份 persistent-context 驱动（hermetic：
// abort 真机 origin 候选，强制 fallback 到 e2e webServer）。

const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');

let context = null;
let userDataDir = null;

test.afterEach(async () => {
  if (context) await context.close();
  context = null;
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  userDataDir = null;
  for (const entry of ['e2e-dir', 'e2e-site', 'pinpoint']) {
    fs.rmSync(path.join(E2E_DATA_DIR, entry), { recursive: true, force: true });
  }
});

async function launchWithExtension() {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-ext-profile-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });
  await context.route('https://pinpoint.localhost/**', (route) => route.abort());
  return context;
}

/** 在标注模式下点选元素、写内容、保存（驱动方式同 spa-ledger.spec.js）。 */
async function annotate(page, selector, text) {
  await page.locator(selector).click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('textarea').fill(text);
  await box.locator('#ann-save').click();
  await expect(box).toBeHidden();
}

async function closeComposer(page) {
  const box = page.locator('#ann-box');
  if (await box.isVisible()) await box.locator('#ann-cancel').click();
  await expect(box).toBeHidden();
}

/** 元素是否完整落在视口内（跳转滚动断言）。 */
function inViewport(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0;
  }, selector);
}

async function waitRouteSettled(page, pathname, prevEpoch) {
  await page.waitForFunction(([path, epoch]) => {
    const st = window.iOSAnnotate && window.iOSAnnotate.getState ? window.iOSAnnotate.getState() : {};
    if (typeof st.epoch !== 'number') return location.pathname === path;
    return location.pathname === path && st.epoch > epoch && !st.routing;
  }, [pathname, prevEpoch]);
}

test('/sites/ page: sidebar lists ledger marks and clicking a row jumps to the target', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.iOSAnnotate);
  await page.evaluate(() => window.iOSAnnotate.setMode(true));
  await annotate(page, '#doc-target', 'first mark');
  await annotate(page, '#doc-target-2', 'second mark');
  await page.evaluate(() => window.iOSAnnotate.setMode(false));

  // 工具条入口：/sites/ 注入页工具条默认隐藏，先显式调出再点「列表」。
  await page.evaluate(() => window.iOSAnnotate.setFloatingToolbar(true));
  await page.locator('#ann-list').click();
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();

  // 两条标注按 n 列出：序号 + 内容。
  const items = sidebar.locator('.ann-sb-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator('.ann-sb-num')).toHaveText('1');
  await expect(items.nth(0)).toContainText('first mark');
  await expect(items.nth(1).locator('.ann-sb-num')).toHaveText('2');
  await expect(items.nth(1)).toContainText('second mark');

  // 开合状态是 viewer 偏好：刷新后保持打开。
  await page.reload();
  await page.waitForFunction(() => window.iOSAnnotate);
  await expect(page.locator('#ann-sidebar')).toBeVisible();
  await expect(page.locator('#ann-sidebar .ann-sb-item')).toHaveCount(2);

  // 点第二条 → 页面滚到折叠下方的目标，目标闪烁、评论展开。
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await inViewport(page, '#doc-target-2')).toBe(false);
  await page.locator('#ann-sidebar .ann-sb-item[data-ann-n="2"] .ann-sb-item-main').click();
  await expect.poll(() => inViewport(page, '#doc-target-2')).toBe(true);
  await expect(page.locator('.ann-hover-ghost.ann-flash')).toBeVisible();
  await expect(page.locator('#ann-box')).toBeVisible();
  await expect(page.locator('#ann-box .head .t')).toContainText('#2');

  // 回到第一条（composer 占用时不换目标，先关掉）。
  await closeComposer(page);
  await page.locator('#ann-sidebar .ann-sb-item[data-ann-n="1"] .ann-sb-item-main').click();
  await expect.poll(() => inViewport(page, '#doc-target')).toBe(true);
  await expect(page.locator('#ann-box')).toBeVisible();
  await expect(page.locator('#ann-box .head .t')).toContainText('#1');
  await closeComposer(page);

  // S 键开合。
  await page.keyboard.press('s');
  await expect(page.locator('#ann-sidebar')).toBeHidden();
  await page.keyboard.press('s');
  await expect(page.locator('#ann-sidebar')).toBeVisible();
});

test('/sites/ page: row shows the broken state after its target leaves the DOM', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.iOSAnnotate);
  await page.evaluate(() => window.iOSAnnotate.setMode(true));
  await annotate(page, '#doc-target', 'will break');
  await page.evaluate(() => window.iOSAnnotate.setMode(false));

  await page.keyboard.press('s');
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('.ann-sb-item')).toHaveCount(1);
  await expect(sidebar).not.toContainText('锚点失效');

  // 目标元素离开 DOM：内容 MutationObserver → notify → 侧边栏重估锚点状态。
  await page.evaluate(() => document.getElementById('doc-target').remove());
  const row = sidebar.locator('.ann-sb-item[data-ann-n="1"]');
  await expect(row.locator('.ann-sb-broken-tag')).toHaveText('锚点失效');
});

test('SPA: the sidebar follows the active pathname ledger', async ({ page }) => {
  await page.goto('/e2e/spa-fixture.html');
  await page.waitForFunction(() => window.iOSAnnotate);

  let epoch = await page.evaluate(() => window.iOSAnnotate.getState().epoch);
  await page.locator('#to-a').click();
  await waitRouteSettled(page, '/e2e-spa/route-a', epoch);
  await page.evaluate(() => window.iOSAnnotate.setMode(true));
  await annotate(page, '#route-a-el', 'route-a ann');
  await page.evaluate(() => window.iOSAnnotate.setMode(false));

  epoch = await page.evaluate(() => window.iOSAnnotate.getState().epoch);
  await page.locator('#to-b').click();
  await waitRouteSettled(page, '/e2e-spa/route-b', epoch);
  await page.evaluate(() => window.iOSAnnotate.setMode(true));
  await annotate(page, '#route-b-el', 'route-b ann');
  await page.evaluate(() => window.iOSAnnotate.setMode(false));

  await page.keyboard.press('s');
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('.ann-sb-item')).toHaveCount(1);
  await expect(sidebar).toContainText('route-b ann');
  await expect(sidebar).not.toContainText('route-a ann');

  // 账本切换后列表自动换成新账本（侧边栏保持打开）。
  epoch = await page.evaluate(() => window.iOSAnnotate.getState().epoch);
  await page.locator('#to-a').click();
  await waitRouteSettled(page, '/e2e-spa/route-a', epoch);
  await expect(sidebar.locator('.ann-sb-item')).toHaveCount(1);
  await expect(sidebar).toContainText('route-a ann');
  await expect(sidebar).not.toContainText('route-b ann');
});

test('workbench page: no sidebar entry, the workbench annotation list stays the control surface', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.iOSAnnotate);

  // S 键与 API 都被抑制，#ann-sidebar 从不创建。
  await page.keyboard.press('s');
  await page.evaluate(() => {
    if (window.iOSAnnotate.toggleSidebar) window.iOSAnnotate.toggleSidebar();
  });
  await expect(page.locator('#ann-sidebar')).toHaveCount(0);
  expect(await page.evaluate(() => window.iOSAnnotate.getState().sidebar)).toBe(false);

  // 工具条调出后也没有列表入口（其余按钮仍在）。
  await page.evaluate(() => window.iOSAnnotate.setFloatingToolbar(true));
  await expect(page.locator('#ann-toggle')).toBeVisible();
  await expect(page.locator('#ann-list')).toBeHidden();

  // workbench 自己的标注列表正常工作。
  await page.evaluate(() => window.iOSAnnotate.setMode(true));
  const target = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell').first();
  await target.scrollIntoViewIfNeeded();
  await annotate(page, '#wb-board-panel [data-screen="settings"] .ios-cell >> nth=0', 'wb list check');
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);
  await expect(page.locator('#wbann-list')).toContainText('wb list check');
  await expect(page.locator('#ann-sidebar')).toHaveCount(0);
});

test('extension-injected page: sidebar is available', async () => {
  const ctx = await launchWithExtension();
  const page = await ctx.newPage();
  await page.goto(`${E2E_BASE_URL}/e2e/ext-fixture.html`);
  await page.waitForFunction(() => window.__htmlAnnotate && window.iOSAnnotate);

  await page.evaluate(() => window.iOSAnnotate.setMode(true));
  await annotate(page, '#target-el', 'ext ann');
  await page.evaluate(() => window.iOSAnnotate.setMode(false));

  await page.keyboard.press('s');
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('.ann-sb-item')).toHaveCount(1);
  await expect(sidebar).toContainText('ext ann');
  await expect(sidebar).toContainText('extension target text');
});
