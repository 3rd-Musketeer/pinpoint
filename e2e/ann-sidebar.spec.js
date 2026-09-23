import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR } from './env.js';
import { pageKeyFromPathname } from '../src/shared/annotate-page-key.js';

// 标注列表面板（#ann-sidebar）：/sites/ 注入页、SPA 页这些没有 workbench 的页面，
// 靠面板看到当前账本的所有标注并点击跳转。入口 = 浮动工具条「列表」按钮 +
// 快捷键 S；面板顶部有「交互 | 标注」segmented。workbench 页面不提供面板
// （单一控制面）。浏览器扩展（工具栏图标入口、pinpoint:command 桥）已于
// pp2 切片 3 退役。

test.afterEach(async () => {
  // storage-unify：workbench 用例的标注落进 e2e-ios 桶（桶 = 页），不清的话
  // 同组后跑的 mention.spec 会在自己的计数断言上多出别人的行。
  for (const entry of ['e2e-dir', 'e2e-site', 'e2e-ios', 'pinpoint']) {
    fs.rmSync(path.join(E2E_DATA_DIR, entry), { recursive: true, force: true });
  }
});

/** 在标注模式下点选元素、写内容、保存（驱动方式同 spa-ledger.spec.js）。 */
async function annotate(page, selector, text) {
  await page.locator(selector).click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('#ann-input').fill(text);
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
    const st = window.pinpoint && window.pinpoint.getState ? window.pinpoint.getState() : {};
    if (typeof st.epoch !== 'number') return location.pathname === path;
    return location.pathname === path && st.epoch > epoch && !st.routing;
  }, [pathname, prevEpoch]);
}

test('/sites/ page: the floating toolbar carries a way back to the workbench', async ({ page }) => {
  // /sites/ 注入的页面在 workbench 之外（BACKLOG「空态与错误面板」）：
  // 工具条上要有一条走回去的路，不靠用户记住 workbench 的 URL。
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(() => window.pinpoint.setFloatingToolbar(true));

  const entry = page.locator('#ann-workbench');
  await expect(entry).toBeVisible();
  await expect(entry).toHaveText('打开 workbench');

  const [opened] = await Promise.all([page.waitForEvent('popup'), entry.click()]);
  expect(new URL(opened.url()).pathname).toBe('/index.html');
  await opened.close();
});

test('/sites/ page: sidebar lists ledger marks and clicking a row jumps to the target', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await annotate(page, '#doc-target', 'first mark');
  await annotate(page, '#doc-target-2', 'second mark');
  await page.evaluate(() => window.pinpoint.setMode(false));

  // 工具条入口：/sites/ 注入页工具条默认隐藏，先显式调出再点「列表」。
  await page.evaluate(() => window.pinpoint.setFloatingToolbar(true));
  await page.locator('#ann-list').click();
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();

  // 两条标注按 n 列出：序号 + 内容。
  const items = sidebar.locator('.wb-ann-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator('.wb-ann-num')).toHaveText('1');
  await expect(items.nth(0)).toContainText('first mark');
  await expect(items.nth(1).locator('.wb-ann-num')).toHaveText('2');
  await expect(items.nth(1)).toContainText('second mark');

  // 开合状态是 viewer 偏好：刷新后保持打开。
  await page.reload();
  await page.waitForFunction(() => window.pinpoint);
  await expect(page.locator('#ann-sidebar')).toBeVisible();
  await expect(page.locator('#ann-sidebar .wb-ann-item')).toHaveCount(2);

  // 点第二条 → 页面滚到折叠下方的目标，目标闪烁、评论展开。
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await inViewport(page, '#doc-target-2')).toBe(false);
  await page.locator('#ann-sidebar .wb-ann-item[data-ann-n="2"] .wb-ann-item-main').click();
  await expect.poll(() => inViewport(page, '#doc-target-2')).toBe(true);
  await expect(page.locator('.ann-hover-ghost.ann-flash')).toBeVisible();
  await expect(page.locator('#ann-box')).toBeVisible();
  await expect(page.locator('#ann-input')).toContainText('second mark');
  await expect(page.locator('.ann-badge').filter({hasText: /^2$/})).toBeVisible();

  // 列表保持展开，可继续选择另一条。
  await closeComposer(page);
  await expect(sidebar).toBeVisible();
  await page.locator('#ann-sidebar .wb-ann-item[data-ann-n="1"] .wb-ann-item-main').click();
  await expect.poll(() => inViewport(page, '#doc-target')).toBe(true);
  await expect(page.locator('#ann-box')).toBeVisible();
  await expect(page.locator('#ann-input')).toContainText('first mark');
  await expect(page.locator('.ann-badge').filter({hasText: /^1$/})).toBeVisible();
  await closeComposer(page);

  // S 键收起，再次打开。
  await page.keyboard.press('s');
  await expect(sidebar).toBeHidden();
  await page.keyboard.press('s');
  await expect(sidebar).toBeVisible();
});

test('/sites/ page: row shows the broken state after its target leaves the DOM', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await annotate(page, '#doc-target', 'will break');
  await page.evaluate(() => window.pinpoint.setMode(false));

  await page.keyboard.press('s');
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('.wb-ann-item')).toHaveCount(1);
  await expect(sidebar).not.toContainText('锚点失效');

  // 目标元素离开 DOM：内容 MutationObserver → notify → 侧边栏重估锚点状态。
  await page.evaluate(() => document.getElementById('doc-target').remove());
  const row = sidebar.locator('.wb-ann-item[data-ann-n="1"]');
  await expect(row.locator('.wb-ann-broken-tag')).toHaveText('锚点失效');
});

test('SPA: the sidebar follows the active pathname ledger', async ({ page }) => {
  await page.goto('/e2e/spa-fixture.html');
  await page.waitForFunction(() => window.pinpoint);

  let epoch = await page.evaluate(() => window.pinpoint.getState().epoch);
  await page.locator('#to-a').click();
  await waitRouteSettled(page, '/e2e-spa/route-a', epoch);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await annotate(page, '#route-a-el', 'route-a ann');
  await page.evaluate(() => window.pinpoint.setMode(false));

  epoch = await page.evaluate(() => window.pinpoint.getState().epoch);
  await page.locator('#to-b').click();
  await waitRouteSettled(page, '/e2e-spa/route-b', epoch);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await annotate(page, '#route-b-el', 'route-b ann');
  await page.evaluate(() => window.pinpoint.setMode(false));

  await page.keyboard.press('s');
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('.wb-ann-item')).toHaveCount(1);
  await expect(sidebar).toContainText('route-b ann');
  await expect(sidebar).not.toContainText('route-a ann');

  // 账本切换后列表自动换成新账本（侧边栏保持打开）。
  epoch = await page.evaluate(() => window.pinpoint.getState().epoch);
  await page.locator('#to-a').click();
  await waitRouteSettled(page, '/e2e-spa/route-a', epoch);
  await expect(sidebar.locator('.wb-ann-item')).toHaveCount(1);
  await expect(sidebar).toContainText('route-a ann');
  await expect(sidebar).not.toContainText('route-b ann');
});

test('workbench page: no sidebar entry, the workbench annotation list stays the control surface', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);

  // S 键与 API 都被抑制，#ann-sidebar 从不创建。
  await page.keyboard.press('s');
  await page.evaluate(() => {
    if (window.pinpoint.toggleSidebar) window.pinpoint.toggleSidebar();
  });
  await expect(page.locator('#ann-sidebar')).toHaveCount(0);
  expect(await page.evaluate(() => window.pinpoint.getState().sidebar)).toBe(false);

  // 工具条调出后也没有列表入口（其余按钮仍在）。
  await page.evaluate(() => window.pinpoint.setFloatingToolbar(true));
  await expect(page.locator('#ann-toggle')).toBeVisible();
  await expect(page.locator('#ann-list')).toBeHidden();

  // workbench 自己的标注列表正常工作（e2e-ios 的 settings 屏）。
  await page.evaluate(() => window.workbench.setActivePage('e2e-ios'));
  await expect(page.locator('#wb-board-panel [data-screen="settings"]')).toBeVisible();
  await page.evaluate(() => window.pinpoint.setMode(true));
  const target = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell').first();
  await target.scrollIntoViewIfNeeded();
  await annotate(page, '#wb-board-panel [data-screen="settings"] .ios-cell >> nth=0', 'wb list check');
  // 2026-09-04：workbench 的列表不常驻，点横条右端的计数钮才弹出。上面为断言
  // 「没有列表入口」临时调出的浮动工具条钉在同一条底边上，先收掉再点。
  await page.evaluate(() => window.pinpoint.setFloatingToolbar(false));
  await page.locator('#wbann-count').click();
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);
  await expect(page.locator('#wbann-list')).toContainText('wb list check');
  await expect(page.locator('#ann-sidebar')).toHaveCount(0);
});

// 11px/1.45、186px 宽 ≈ 每行 15 个汉字：这条约 140 字 ≈ 9 行，专门越过 6 行滚动线。
const NOTE = '默认温度从 90 改到 92 度：medium 烘焙下 92 度萃取更稳，杯测数据见 8-31 记录第三组，'
  + '同一组里 90 度那杯的 TDS 明显偏低，口感单薄；改完同步设置页文案，'
  + '帮助页的注水建议与研磨刻度提示也要跟着更新，避免两处口径不一致，'
  + '另外记得通知仓库把包装上的建议参数一并换掉。';

test('workbench 列表 note hover 卡：done 行 120 ms 出卡，无 note 的行不出', async ({ page }) => {
  // 切片 5：行上的 agent note 不再走原生 title（工作台侧），hover 出与评论卡
  // 同皮肤的小卡。造两条标注，一条走 open → check（带 note）→ done，一条留 open。
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await page.evaluate(() => window.workbench.setActivePage('e2e-ios'));
  await expect(page.locator('#wb-board-panel [data-screen="settings"]')).toBeVisible();
  await page.evaluate(() => window.pinpoint.setMode(true));
  await page.locator('#wb-board-panel [data-screen="settings"] .ios-cell').first().scrollIntoViewIfNeeded();
  await annotate(page, '#wb-board-panel [data-screen="settings"] .ios-cell >> nth=0', '温度默认值改成 92 度');
  await page.locator('#wb-board-panel [data-screen="settings"] .ios-cell').nth(1).scrollIntoViewIfNeeded();
  await annotate(page, '#wb-board-panel [data-screen="settings"] .ios-cell >> nth=1', '这条没有备注');
  const n1 = await page.evaluate(() => window.pinpoint.marks.at(-2).n);
  const n2 = await page.evaluate(() => window.pinpoint.marks.at(-1).n);

  const ledger = pageKeyFromPathname('/index.html');
  const post = (n, data) => page.request.post(`/annotations/${ledger}/${n}/status`, { data: { entry: 'pinpoint', ...data } });
  let rev = await page.evaluate(() => window.pinpoint.getState().revision);
  expect((await post(n1, { baseRevision: rev, status: 'check', note: NOTE })).status()).toBe(200);
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().syncing)).toBe(false);
  rev = await page.evaluate(() => window.pinpoint.getState().revision);
  expect((await post(n1, { baseRevision: rev, status: 'done' })).status()).toBe(200);
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().syncing)).toBe(false);

  await page.evaluate(() => window.pinpoint.setFloatingToolbar(false));
  await page.locator('#wbann-count').click();
  const row1 = page.locator(`#wbann-list .wb-ann-item[data-ann-n="${n1}"]`);
  const row2 = page.locator(`#wbann-list .wb-ann-item[data-ann-n="${n2}"]`);
  await expect(row1.locator('.wb-ann-status-tag')).toHaveText('done');

  // 原生 title 退役：行上不再有 title 属性。
  expect(await row1.getAttribute('title')).toBeNull();
  expect(await row2.getAttribute('title')).toBeNull();

  // hover done 行 → 卡出，眉标 + note 原文（不截断），贴行右侧且整个在视口内。
  await row1.hover();
  const card = page.locator('.wb-ann-note-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('agent 备注');
  await expect(card).toContainText(NOTE);
  const rowBox = await row1.boundingBox();
  const cardBox = await card.boundingBox();
  const vp = page.viewportSize();
  expect(cardBox.x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width);   // 贴行右侧
  expect(cardBox.y).toBeGreaterThanOrEqual(0);
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(vp.width);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(vp.height);
  // note 超过 6 行：全文在 DOM 里，卡身进入滚动态。
  expect(await card.locator('div').last().evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  // 指针挪到卡上继续读（90 ms 宽限内），挪开才收。
  await card.hover();
  await expect(card).toBeVisible();
  await page.mouse.move(200, 300);
  await expect(card).toBeHidden();

  // 键盘聚焦同样出卡，失焦即收。
  await row1.locator('.wb-ann-item-main').focus();
  await expect(card).toBeVisible();
  await page.evaluate(() => document.activeElement.blur());
  await expect(card).toBeHidden();

  // 无 note 的行：过了出卡窗也不出卡。
  await row2.hover();
  await page.waitForTimeout(300);
  await expect(card).toHaveCount(0);
});
