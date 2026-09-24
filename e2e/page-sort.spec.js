import fs from 'node:fs';
import path from 'node:path';
import { E2E_SITES_DIR } from './env.js';

import { expect, test } from '@playwright/test';

import { sortPages } from '../src/workbench/lib/page-sort.js';

// Each server owns a copy; sorting never changes source fixture timestamps.

// ios-site 刻意不压：它带 .js sidecar（timer.js），utimes 会被 preview-hmr 认成
// 源码变更发 full-reload 广播，把几秒后开板的下一条 spec 的页面整个刷掉
// （2026-09-24 实测，pp-id-anchor 连挂）。本用例的断言也用不到它的时间。
const FIXTURE_MTIMES = [
  ['dir-site', Date.parse('2026-01-01T00:00:00Z')],
  ['mention-site', Date.parse('2026-02-01T00:00:00Z')],
  ['dir-site-ios', Date.parse('2026-03-01T00:00:00Z')],
  ['doc-site', Date.parse('2026-05-01T00:00:00Z')],
  ['mixed-site', Date.now()],
];

const ORIGINAL_MTIMES = new Map();

function setMtime(target, date) {
  if (!ORIGINAL_MTIMES.has(target)) {
    const stat = fs.statSync(target);
    ORIGINAL_MTIMES.set(target, { atime: stat.atime, mtime: stat.mtime });
  }
  fs.utimesSync(target, date, date);
}

function pressMtimes() {
  for (const [rel, ms] of FIXTURE_MTIMES) {
    const dir = path.join(E2E_SITES_DIR, rel);
    const date = new Date(ms);
    for (const name of fs.readdirSync(dir)) setMtime(path.join(dir, name), date);
    setMtime(dir, date);
  }
}

test.beforeAll(pressMtimes);

// 压旧的 mtime 必须恢复原值：同轮后面的 spec（sidebar-content 等）还在用这些
// 固件目录，不该看到被压旧的假时间。恢复放回用例末尾而不是 afterAll ——
// utimes 一批固件会触发 preview-hmr 的 watch 风暴（六个登记页重编 + 广播），
// afterAll 紧贴下一条 spec 的启动，风暴正好砸在它的 annotate 客户端上；
// 收进用例内，用末尾的 reload + 断言给风暴留出落定窗口。

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
}

function pageOrder(page) {
  return page.locator('#wbpages .wb-page').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-vpage')),
  );
}

// 范例页回归后（_index.json 重新有页）：清单 = manifest 行（范例页）+ 全部
// registry 行，书写顺序（_index 在前）。
const DEFAULT_ORDER = [
  'example', 'e2e-ios', 'e2e-site', 'e2e-proxy', 'e2e-dir', 'e2e-dir-ios', 'e2e-mention', 'e2e-mixed', 'e2e-doc',
];

// 期望顺序直接用产品的比较器算（sortPages），不再在用例里重写一遍 ——
// 比较器与格式化档位的纯逻辑在 page-sort.test.js / page-times.test.js。
test('Pages 排序：时间渲染、菜单形态、依据接线与持久化', async ({ page, request }) => {
  await openWorkbench(page);

  // 行内时间：mtime = now 的固件渲染「刚刚」；2026-01-01 的渲染「1-1」（同年
  // 超 7 天，M-D 不补零）；url 条目无 mtime，不出时间元素。
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"] .wb-page-time')).toHaveText('刚刚');
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"] .wb-page-time')).toHaveText('1-1');
  await expect(page.locator('#wbpages [data-vpage="e2e-site"] .wb-page-time')).toHaveCount(0);

  const button = page.locator('.wb-page-sort');
  const menu = page.getByRole('menu', { name: /^Pages 排序：/ });
  const { pageTimes } = await (await request.get('/registry')).json();
  const readRecent = () => page.locator('#wbrecent [data-recent-page]').evaluateAll(els => els.map(el => el.dataset.recentPage));
  const recent = await readRecent();

  // 菜单形态：9 个依据都在，开在视口内；Esc 关菜单回焦按钮。
  // 负载下清单可能在点击瞬间重渲染把点击吞掉：开不来就重试（不依赖时序）。
  await expect(async () => {
    await button.click();
    await expect(menu).toBeVisible();
  }).toPass();
  await expect(menu.getByRole('menuitemradio')).toHaveCount(9);
  const box = await menu.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();

  // 行清单（默认序）：拿标题与 /registry 的 pageTimes 喂给 sortPages 算期望。
  const rows = await page.locator('#wbpages [data-vpage]').evaluateAll((els, times) => els.map(el => ({
    id: el.dataset.vpage,
    title: el.querySelector('.wb-page-t').textContent,
    addedAt: times[el.dataset.vpage]?.addedAt,
    mtime: times[el.dataset.vpage]?.mtime,
    annotatedAt: times[el.dataset.vpage]?.annotatedAt,
  })), pageTimes);
  const expectedOrder = (sort) => sortPages(rows, sort).map((row) => row.id);

  // 非默认依据各验一档：updated（mtime 接线，顺序必须真的变）与 annotated
  // （pageTimes 从 /registry 到左栏的接线）。每档选完断言顺序、最近区不动，
  // reload 一次验持久化与勾选，Esc 关菜单回焦按钮。
  for (const [sort, label, changesOrder] of [
    ['updated', '最后修改时间（从新到旧）', true],
    ['annotated', '最后标注时间（从新到旧）', false],
  ]) {
    await button.click();
    await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(button).toHaveAttribute('data-page-sort', sort);
    const order = await pageOrder(page);
    expect(order).toEqual(expectedOrder(sort));
    if (changesOrder) expect(order).not.toEqual(DEFAULT_ORDER);
    expect(await readRecent()).toEqual(recent);

    await page.reload();
    await expect(button).toHaveAttribute('data-page-sort', sort);
    await button.click();
    await expect(menu.getByRole('menuitemradio', { name: label, exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
  }

  // 收尾：恢复固件原 mtime（B 组报告：压旧的值不许漏给同组后面的 spec 用例）。
  // 恢复后时间渲染回到真实值，「刚刚」那类断言只在压住期间成立，不再复验。
  for (const [target, times] of ORIGINAL_MTIMES) fs.utimesSync(target, times.atime, times.mtime);
});
