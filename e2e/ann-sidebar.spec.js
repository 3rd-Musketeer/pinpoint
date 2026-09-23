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

test('pp2 侧栏状态筛选：open 行点完成 → 撤销回 open → 再完成沉底弱化 → closed 筛选可见 → 重新打开', async ({ page }) => {
  // 与 workbench.spec 的面板筛选全流程同一条链，跑在注入侧栏上：行尾完成勾
  // 单击即 close，toast 撤销回关前原态；「已关闭 N」折叠段由状态筛选取代 ——
  // 全部视图里 close 行沉底弱化仍可见，closed 段只看关闭行，close 行可重开。
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await annotate(page, '#doc-target', '走完侧栏关闭流程的意见');
  const n = await page.evaluate(() => window.pinpoint.marks.at(-1).n);
  await page.keyboard.press('s');
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(page.locator('.ann-badge')).toHaveCount(1);

  const filters = sidebar.locator('.ann-sb-filters');
  const closedSeg = filters.locator('[data-ann-filter="closed"]');
  // 分段常驻：还没有关闭行时 closed 计 0，弱化但仍可点 —— 点了是空态，不是消失
  await expect(closedSeg).toHaveText('closed 0');
  await expect(closedSeg).toHaveClass(/dim/);
  await closedSeg.click();
  await expect(sidebar.locator('.wb-ann-filter-empty')).toHaveText('没有 closed 的标注');
  // 画布跟随筛选：closed 视图里 open 钉子不画
  await expect(page.locator('.ann-badge')).toHaveCount(0);
  await filters.locator('[data-ann-filter="all"]').click();
  await expect(page.locator('.ann-badge')).toHaveCount(1);

  // open 行点「完成」：单击即关（不二次确认），toast「已完成 #n」带撤销
  // （acts 列 hover 才 pointer-events:auto，先 hover 行再点）
  const row = sidebar.locator('.wb-ann-item[data-ann-n="' + n + '"]');
  await row.hover();
  await row.getByRole('button', { name: '完成 #' + n, exact: true }).click();
  const toast = page.locator('#ann-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('已完成 #' + n);
  // 取代「收进折叠段」：行留在全部视图里 —— 沉底、整行弱化、closed 计数 +1
  await expect(row).toHaveCount(1);
  await expect(row).toHaveClass(/wb-ann-item--closed/);
  await expect(closedSeg).toHaveText('closed 1');
  await expect(page.locator('.ann-badge')).toHaveCount(0);

  // 撤销 → 回关闭前的原态（这行是 open），行回正常态，toast 收起
  await toast.locator('button').click();
  await expect.poll(() => page.evaluate((n) => window.pinpoint.marks.find((m) => m.n === n).status, n)).toBe('open');
  await expect(row).not.toHaveClass(/wb-ann-item--closed/);
  await expect(toast).toBeHidden();
  // 撤销触发的 save 回包落定、revision 归位后再做下一步写状态动作。
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().syncing)).toBe(false);

  // 再点完成，这次不撤销：切到 closed 筛选才看这行 —— 正常亮度、状态标 +「重新打开」
  await row.hover();
  await row.getByRole('button', { name: '完成 #' + n, exact: true }).click();
  await expect(closedSeg).toHaveText('closed 1');
  await closedSeg.click();
  await expect(row).toHaveCount(1);
  await expect(row).not.toHaveClass(/wb-ann-item--closed/);
  await expect(row.locator('.wb-ann-status-tag')).toHaveText('close');
  await row.hover();
  await expect(row.getByRole('button', { name: '重新打开标注 ' + n, exact: true })).toBeVisible();

  // 重新打开 → closed 计数回 0（空态），切回「全部」行回正常亮度
  await row.getByRole('button', { name: '重新打开标注 ' + n, exact: true }).click();
  await expect.poll(() => page.evaluate((n) => window.pinpoint.marks.find((m) => m.n === n).status, n)).toBe('open');
  await expect(closedSeg).toHaveText('closed 0');
  await expect(sidebar.locator('.wb-ann-filter-empty')).toHaveText('没有 closed 的标注');
  await filters.locator('[data-ann-filter="all"]').click();
  await expect(row).toHaveCount(1);
  await expect(row).not.toHaveClass(/wb-ann-item--closed/);
  await expect(page.locator('.ann-badge')).toHaveCount(1);
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

  // 存储统一（ADR 0036）：画布标注住活动页自己的桶，账本固定 @canvas。
  const post = (n, data) => page.request.post(`/annotations/@canvas/${n}/status`, { data: { entry: 'e2e-ios', ...data } });
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

test('pp2 状态筛选：四种状态各一条 → check 只剩一行一琥珀钉 → closed 见灰钉 → 刷新保留', async ({ page }) => {
  // owner 2026-09-23：颜色即状态 + filter 切换查看。这条把三件事串起来 ——
  // 分段筛选驱动列表行数、画布钉子跟着筛选出没、钉色随状态（琥珀 check /
  // 灰 closed），筛选选择按页记 LS，刷新后原样回来。
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  // fixture 只有三个锚点目标，第四个动态补
  await page.evaluate(() => {
    const el = document.createElement('p');
    el.id = 'doc-target-3';
    el.textContent = 'A fourth anchor for the status filter test.';
    document.getElementById('doc-target-2').after(el);
  });
  await page.evaluate(() => window.pinpoint.setMode(true));
  await annotate(page, '#doc-target', 'open 状态意见');
  await annotate(page, '#doc-title', 'check 状态意见');
  await annotate(page, '#doc-target-3', 'done 状态意见');
  await annotate(page, '#doc-target-2', 'close 状态意见');
  const nOpen = await page.evaluate(() => window.pinpoint.marks.at(-4).n);
  const nCheck = await page.evaluate(() => window.pinpoint.marks.at(-3).n);
  const nDone = await page.evaluate(() => window.pinpoint.marks.at(-2).n);
  const nClose = await page.evaluate(() => window.pinpoint.marks.at(-1).n);

  // check / done 升档只经 mark 端点（revision 用回包里的，不等 SSE）；
  // close 是 owner 动作，端点不收 —— 走行上的「完成」勾。
  const ledger = pageKeyFromPathname('/sites/e2e-dir/doc.html');
  const postStatus = async (n, status, baseRev) => {
    const res = await page.request.post(`/annotations/${ledger}/${n}/status`, { data: { entry: 'e2e-dir', baseRevision: baseRev, status } });
    expect(res.status()).toBe(200);
    return (await res.json()).revision;
  };
  // 起点 revision 取服务端的：客户端第四条的保存可能还在路上，拿客户端
  // revision 会和那次落盘抢跑成 409。等服务端账本里出现第四条再读它的 revision。
  const serverDoc = async () => (await page.request.get(`/annotations/${ledger}?entry=e2e-dir`)).json();
  await expect.poll(async () => ((await serverDoc()).annotations || []).some((a) => a.n === nClose)).toBe(true);
  let rev = (await serverDoc()).revision;
  rev = await postStatus(nCheck, 'check', rev);
  rev = await postStatus(nDone, 'done', rev);
  await expect.poll(() => page.evaluate((n) => window.pinpoint.marks.find((m) => m.n === n).status, nDone)).toBe('done');

  await page.keyboard.press('s');
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();
  const filters = sidebar.locator('.ann-sb-filters');
  const closeRow = sidebar.locator('.wb-ann-item[data-ann-n="' + nClose + '"]');
  await closeRow.hover();
  await closeRow.getByRole('button', { name: '完成 #' + nClose, exact: true }).click();
  await expect(closeRow).toHaveClass(/wb-ann-item--closed/);

  // 全部：四行都在（closed 沉底），钉子只画非 closed 的三枚（现行为不变）
  await expect(sidebar.locator('.wb-ann-item')).toHaveCount(4);
  await expect(filters.locator('[data-ann-filter="all"]')).toHaveText('全部 4');
  await expect(filters.locator('[data-ann-filter="closed"]')).toHaveText('closed 1');
  await expect(page.locator('.ann-badge')).toHaveCount(3);

  // 切到 check：只剩一行、画布只剩一枚琥珀钉
  await filters.locator('[data-ann-filter="check"]').click();
  const rows = sidebar.locator('.wb-ann-item');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.wb-ann-num')).toHaveText(String(nCheck));
  const pins = page.locator('.ann-badge');
  await expect(pins).toHaveCount(1);
  await expect(pins).toHaveCSS('background-color', 'rgb(184, 124, 20)');

  // 切到 closed：closed 行（带「重新打开」）+ 一枚灰钉
  await filters.locator('[data-ann-filter="closed"]').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.wb-ann-num')).toHaveText(String(nClose));
  await expect(rows.first().locator('.wb-ann-status-tag')).toHaveText('close');
  await expect(rows.first().getByRole('button', { name: '重新打开标注 ' + nClose, exact: true })).toBeVisible();
  await expect(pins).toHaveCount(1);
  await expect(pins).toHaveCSS('background-color', 'rgb(133, 142, 153)');

  // 刷新：筛选按页记在 LS，closed 视图与灰钉原样回来
  await page.reload();
  await page.waitForFunction(() => window.pinpoint);
  await expect(sidebar).toBeVisible();
  await expect(sidebar.locator('[data-ann-filter="closed"]')).toHaveClass(/on/);
  await expect(sidebar.locator('.wb-ann-item')).toHaveCount(1);
  await expect(sidebar.locator('.wb-ann-status-tag')).toHaveText('close');
  await expect(page.locator('.ann-badge')).toHaveCount(1);
  await expect(page.locator('.ann-badge')).toHaveCSS('background-color', 'rgb(133, 142, 153)');
});
