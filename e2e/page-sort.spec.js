import fs from 'node:fs';
import path from 'node:path';
import { E2E_SITES_DIR } from './env.js';

import { expect, test } from '@playwright/test';

import { sortPages } from '../src/workbench/lib/page-sort.js';

// Each server owns a copy; sorting never changes source fixture timestamps.
// 压旧的 mtime 在 afterAll 恢复原值：同轮后面的 spec（sidebar-content 等）
// 还在用这些固件目录，不该看到被压旧的假时间。

const FIXTURE_MTIMES = [
  ['dir-site', Date.parse('2026-01-01T00:00:00Z')],
  ['mention-site', Date.parse('2026-02-01T00:00:00Z')],
  ['dir-site-ios', Date.parse('2026-03-01T00:00:00Z')],
  ['ios-site', Date.parse('2026-04-01T00:00:00Z')],
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

test.afterAll(() => {
  for (const [target, times] of ORIGINAL_MTIMES) fs.utimesSync(target, times.atime, times.mtime);
});

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
  await button.click();
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
});
