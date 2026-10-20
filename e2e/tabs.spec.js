import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from './lib/fixtures.js';

import { E2E_DATA_DIR, E2E_SITES_DIR } from './env.js';
import { ppnt } from './lib/cli.js';
import { openOutline } from './lib/workbench.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// 页 tab（ADR 0041，2026-10-10 大纲入口）：同一页里 tab 只是 section 的视图分组。
// 固件 tabs-site 有两个 tab（comps 组件：btn-wall 两帧 + chip-wall 一帧；flow 交互：
// onboard 两帧），tabs-one-site 只有一个 tab，e2e-ios 是不带 tab 的存量画布页，
// tabs-doc-site 是三个 tab 全是文档的页（版本 2 篇、对比 3 篇、单篇 1 篇）。
// 工作台：≥ 2 个 tab 才渲染 #wbtabbar（纯文档页也算）；不到 2 个 tab 不出条，有画布时大纲钮在横条里
//（#wbstrip-outline，owner 2026-10-15“孤儿 tab”）。
// 分享导出仍是单 tab 不出条。切换只挂当前 tab 的 section；序号按 tab 从 A 重来；
// 活动 tab 刷新后保持；focusFrame 指到别的 tab 的帧时先切 tab。
const TABS_DIR = path.join(E2E_SITES_DIR, 'tabs-site');
const ONE_DIR = path.join(E2E_SITES_DIR, 'tabs-one-site');
const DOC_DIR = path.join(E2E_SITES_DIR, 'tabs-doc-site');
const DIST_ENTRIES = ['e2e-tabs', 'e2e-tabs-one'].map((id) => path.join(E2E_DATA_DIR, 'dist', id));

async function openBoard(page, query) {
  await page.goto(`/workbench/?${query}`);
  await page.waitForFunction(() => window.workbench && window.workbench.activeTabId);
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled()), { timeout: 30_000 }).toBe(true);
  // 画布挂完：至少一个帧在 DOM 里
  await expect(page.locator('#wb-board-panel [data-screen]').first()).toBeAttached();
}

const visibleScreens = (page) => page.locator('#wb-board-panel [data-screen]');
const barBox = async (page, id) => page.locator(id).boundingBox();

test.beforeEach(async ({ request }) => {
  appendRegistryEntry({ id: 'e2e-tabs', title: 'E2E Tabs', kind: 'dir', path: TABS_DIR, board: 'ios' });
  appendRegistryEntry({ id: 'e2e-tabs-one', title: 'E2E Tabs One', kind: 'dir', path: ONE_DIR, board: 'ios' });
  appendRegistryEntry({ id: 'e2e-tabs-doc', title: 'E2E Tabs Doc', kind: 'dir', path: DOC_DIR });
  await request.post('/registry/reload');
});

test.afterEach(async ({ request }) => {
  for (const dir of DIST_ENTRIES) fs.rmSync(dir, { recursive: true, force: true });
  await restoreRegistryFixture(request);
});

test('tab 条：不到两个 tab 不出条，大纲钮在横条里；两个 tab 的页叠在横条正上方，切换只挂当前 tab，序号按 tab 从 A 重来，活动 tab 刷新后保持', async ({ page }) => {
  test.setTimeout(90_000);

  // 不带 tab 的存量画布页、单 tab 页：没有 tab 条；大纲钮在横条里（页名之后、‹ n / N › 之前），
  // 打开同一个大纲浮层，从横条向上弹。
  for (const id of ['e2e-ios', 'e2e-tabs-one']) {
    await openBoard(page, `page=${id}`);
    await expect(page.locator('#wbtabbar')).toHaveCount(0);
    const outline = page.locator('#wbstrip #wbstrip-outline');
    await expect(outline).toHaveCount(1);
    await expect(page.getByRole('button', { name: '大纲', exact: true })).toHaveCount(1);
    const order = await page.evaluate(() => {
      const strip = document.getElementById('wbstrip');
      const all = [...strip.querySelectorAll('#wbstrip-title, #wbstrip-outline, #wbsection-nav-position')];
      return all.map((el) => el.id);
    });
    expect(order).toEqual(['wbstrip-title', 'wbstrip-outline', 'wbsection-nav-position']);
    const stripBox = await barBox(page, '#wbstrip');
    const btnBox = await outline.boundingBox();
    expect(btnBox.y).toBeGreaterThanOrEqual(stripBox.y - 0.5);
    expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(stripBox.y + stripBox.height + 0.5);
    await openOutline(page);
    await expect(outline).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#wboutline-pop [data-ol-frame]').first()).toBeVisible();
    const popBox = await barBox(page, '#wboutline-pop');
    expect(popBox.y + popBox.height).toBeLessThanOrEqual(stripBox.y + 0.5);
    await page.keyboard.press('Escape');
    await expect(page.locator('#wboutline-pop')).toHaveCount(0);
  }
  await expect(visibleScreens(page)).toHaveCount(1);

  // 两个 tab 的页
  await openBoard(page, 'page=e2e-tabs');
  const bar = page.locator('#wbtabbar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('[role="tab"]')).toHaveText(['组件', '交互']);
  await expect(bar.locator('[role="tab"][aria-selected="true"]')).toHaveText('组件');
  // 多 tab 页：大纲钮在条上每个 tab 旁，横条里没有
  await expect(page.locator('#wbstrip-outline')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '组件的大纲', exact: true })).toHaveCount(1);

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

test('纯文档的多 tab 页：条照出且不压横条；切 tab 打开该 tab 第一篇，n / N 只数该 tab；刷新留在原 tab 原篇；手机视口的屏不压条', async ({ page }) => {
  test.setTimeout(90_000);
  const shown = page.locator('#wb-board-panel .wb-screen[data-screen]:not([data-doc-hidden])');
  const position = page.locator('#wbentry-position');
  const bar = page.locator('#wbtabbar');
  const selected = bar.locator('[role="tab"][aria-selected="true"]');

  await test.step('条在，三个 tab 标题，起始在第一个 tab 的第一篇', async () => {
    await openBoard(page, 'page=e2e-tabs-doc');
    await expect(bar).toBeVisible();
    await expect(bar.locator('[role="tab"]')).toHaveText(['版本', '对比', '单篇']);
    await expect(selected).toHaveText('版本');
    await expect(shown).toHaveCount(1);
    await expect(shown).toHaveAttribute('data-screen', 'v1');
    await expect(position).toHaveText('1 / 2');
    const tabBox = await barBox(page, '#wbtabbar');
    const stripBox = await barBox(page, '#wbstrip');
    expect(tabBox.y + tabBox.height).toBeLessThanOrEqual(stripBox.y + 0.5);
  });

  await test.step('大纲钮：两篇以上的 tab 有，单篇的 tab 没有；浮层只列这个 tab 的文档', async () => {
    await expect(page.getByRole('button', { name: '版本的大纲', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: '对比的大纲', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: '单篇的大纲', exact: true })).toHaveCount(0);
    await openOutline(page, '对比');
    await expect(page.locator('#wboutline-pop [data-entry]')).toHaveCount(3);
    await expect(page.locator('#wboutline-pop [data-entry="v1"]')).toHaveCount(0);
    // 点另一个 tab 的文档：切过去并打开这一篇
    await page.locator('#wboutline-pop [data-entry="c"]').click();
    await expect(page.locator('#wboutline-pop')).toBeHidden();
    await expect(selected).toHaveText('对比');
    await expect(shown).toHaveAttribute('data-screen', 'c');
    await expect(position).toHaveText('3 / 3');
  });

  await test.step('切 tab 打开该 tab 第一篇，计数只数该 tab', async () => {
    await bar.locator('[role="tab"][data-tab="versions"]').click();
    await expect(selected).toHaveText('版本');
    await expect(shown).toHaveAttribute('data-screen', 'v1');
    await expect(position).toHaveText('1 / 2');
    await bar.locator('[role="tab"][data-tab="compare"]').click();
    await expect(selected).toHaveText('对比');
    await expect(shown).toHaveAttribute('data-screen', 'a');
    await expect(position).toHaveText('1 / 3');
    await expect(page).toHaveURL(/[?&]tab=compare(&|$)/);
    await page.locator('#wbentry-next').click();
    await expect(shown).toHaveAttribute('data-screen', 'b');
    await expect(position).toHaveText('2 / 3');
    // 单篇 tab：只有一篇，横条不出 ‹ n / N ›
    await bar.locator('[role="tab"][data-tab="single"]').click();
    await expect(selected).toHaveText('单篇');
    await expect(shown).toHaveAttribute('data-screen', 'solo');
    await expect(page.locator('#wbentry-nav')).toHaveCount(0);
    await bar.locator('[role="tab"][data-tab="compare"]').click();
    await page.locator('#wbentry-next').click();
    await expect(position).toHaveText('2 / 3');
  });

  await test.step('刷新：留在对比 tab 的第二篇', async () => {
    await page.goto('/workbench/?page=e2e-tabs-doc');
    await page.waitForFunction(() => window.workbench && window.workbench.activeTabId);
    await expect(selected).toHaveText('对比');
    await expect(shown).toHaveAttribute('data-screen', 'b');
    await expect(position).toHaveText('2 / 3');
  });

  await test.step('手机视口：手机屏整块在条的上方', async () => {
    await page.locator('#wbviewport [data-viewport="phone"]').click();
    await expect(page.locator('#wbroot')).toHaveAttribute('data-viewport', 'phone');
    await expect(bar).toBeVisible();
    await expect.poll(async () => {
      const phone = await page.locator('#wb-board-panel .wb-screen:not([data-doc-hidden]) .wb-phone-doc').boundingBox();
      const tabBox = await barBox(page, '#wbtabbar');
      return phone && tabBox ? Math.round(tabBox.y - (phone.y + phone.height)) : -1;
    }).toBeGreaterThanOrEqual(0);
  });
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

test('大纲浮层：左栏没有大纲页签；单 tab 页从横条打开整页；第二个 tab 的浮层只含该 tab 的帧，点帧切过去并聚焦；Esc 与点外面关闭', async ({ page }) => {
  test.setTimeout(90_000);

  await openBoard(page, 'page=e2e-tabs-one');
  await expect(page.getByRole('tab', { name: '大纲', exact: true })).toHaveCount(0);
  await openOutline(page);
  await expect(page.locator('#wboutline [data-ol-frame="solo-a"]')).toBeVisible();
  await expect(page.locator('#wboutline .ol')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#wboutline-pop')).toBeHidden();

  await openBoard(page, 'page=e2e-tabs');
  await expect(page.locator('#wbtabbar [role="tab"]')).toHaveText(['组件', '交互']);
  await openOutline(page, '交互');
  await expect(page.locator('#wboutline [data-ol-frame="ob-welcome"]')).toBeVisible();
  await expect(page.locator('#wboutline [data-ol-frame="ob-done"]')).toBeVisible();
  await expect(page.locator('#wboutline [data-ol-frame="btn-default"]')).toHaveCount(0);
  await expect(page.locator('#wboutline-pop')).toHaveCount(1);
  await page.locator('#wboutline [data-ol-frame="ob-done"]').click();
  await expect(page.locator('#wboutline-pop')).toBeHidden();
  await expect(page.locator('#wbtabbar [role="tab"][aria-selected="true"]')).toHaveText('交互');
  await expect(page.locator('#wb-board-panel [data-screen="ob-done"]')).toBeVisible();
  await expect(page.locator('#wb-board-panel [data-screen="ob-done"]')).toHaveClass(/wb-sel/);

  await openOutline(page, '组件');
  await expect(page.getByRole('button', { name: '交互的大纲', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#wboutline [data-ol-frame="btn-default"]')).toBeVisible();
  await expect(page.locator('#wboutline [data-ol-frame="ob-welcome"]')).toHaveCount(0);
  await page.locator('.wb-wordmark').click();
  await expect(page.locator('#wboutline-pop')).toBeHidden();

  await openOutline(page, '组件');
  await page.keyboard.press('Escape');
  await expect(page.locator('#wboutline-pop')).toBeHidden();

  // 同一时刻只开一个：开着「组件」的浮层再点「交互」的钮，换成交互的，不叠两层。
  await openOutline(page, '组件');
  await page.getByRole('button', { name: '交互的大纲', exact: true }).click();
  await expect(page.locator('#wboutline-pop')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '组件的大纲', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '交互的大纲', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#wboutline [data-ol-frame="ob-welcome"]')).toBeVisible();

  // 几何与层级：宽不超 320，高不超视口 60%，z-index 压过条（--wb-z-strip），在条正上方。
  const geo = await page.evaluate(() => {
    const pop = document.getElementById('wboutline-pop').getBoundingClientRect();
    const bar = document.getElementById('wbtabbar').getBoundingClientRect();
    return {
      width: pop.width, height: pop.height, vh: window.innerHeight,
      gap: bar.top - pop.bottom,
      z: Number(getComputedStyle(document.getElementById('wboutline-pop')).zIndex),
      strip: Number(getComputedStyle(document.getElementById('wbtabbar-root')).zIndex),
    };
  });
  expect(geo.width).toBeLessThanOrEqual(320);
  expect(geo.height).toBeLessThanOrEqual(geo.vh * 0.6 + 1);
  expect(geo.gap).toBeGreaterThanOrEqual(0);
  expect(geo.z).toBeGreaterThan(geo.strip);

  // 键盘：Tab 从触发钮走进浮层里的大纲行；Esc 关闭并把焦点还给触发钮。
  await page.keyboard.press('Escape');
  await expect(page.locator('#wboutline-pop')).toBeHidden();
  await page.getByRole('button', { name: '交互的大纲', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#wboutline-pop')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('#wboutline-pop :focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#wboutline-pop')).toBeHidden();
  await expect(page.getByRole('button', { name: '交互的大纲', exact: true })).toBeFocused();
});

test('旧偏好 sidebarTab=outline 打开后落在页面页签，不崩', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem('pinpoint-wb', JSON.stringify({ sidebarTab: 'outline' }));
  });
  await openBoard(page, 'page=e2e-ios');
  await expect(page.getByRole('tab', { name: '大纲', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '页面', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#wbpages')).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pinpoint-wb')).sidebarTab)).toBe('pages');
});

test('ppnt：list --frames 按 tab 分组，comments --frame <tab>:A1 可用，裸 A1 歧义时报错', async () => {
  test.setTimeout(60_000);
  await ppnt(['build', 'e2e-tabs']);

  const list = await ppnt(['list', 'e2e-tabs', '--frames']);
  expect(list.stdout).toContain('comps:A1');
  expect(list.stdout).toContain('flow:A1');
  expect(list.stdout).toContain('ob-welcome');
  expect(list.stdout).toMatch(/2 个 tab/);

  // flow:A1 解析成 ob-welcome（账本里还没有标注，所以是 0 条而不是报错）
  const checked = await ppnt(['comments', 'e2e-tabs', '--frame', 'flow:A1']);
  expect(checked.stdout).toContain('共 0 条');
  const unknownTab = await ppnt(['comments', 'e2e-tabs', '--frame', 'nope:A1'], { expectFail: true });
  expect(unknownTab.code).not.toBe(0);
  expect(unknownTab.stdout + unknownTab.stderr).toContain('这页没有 tab');

  // 裸 A1 在两个 tab 里都有：给出带 tab 的候选，不猜
  const ambiguous = await ppnt(['comments', 'e2e-tabs', '--frame', 'A1'], { expectFail: true });
  expect(ambiguous.code).not.toBe(0);
  expect(ambiguous.stdout + ambiguous.stderr).toContain('comps:A1');
  expect(ambiguous.stdout + ambiguous.stderr).toContain('flow:A1');
});
