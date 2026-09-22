import fs from 'node:fs';
import path from 'node:path';
import { E2E_SITES_DIR } from './env.js';

import { expect, test } from '@playwright/test';

// Each server owns a copy; sorting never changes source fixture timestamps.

const FIXTURE_MTIMES = [
  ['dir-site', Date.parse('2026-01-01T00:00:00Z')],
  ['mention-site', Date.parse('2026-02-01T00:00:00Z')],
  ['dir-site-ios', Date.parse('2026-03-01T00:00:00Z')],
  ['ios-site', Date.parse('2026-04-01T00:00:00Z')],
  ['doc-site', Date.parse('2026-05-01T00:00:00Z')],
  ['mixed-site', Date.now()],
];

function pressMtimes() {
  for (const [rel, ms] of FIXTURE_MTIMES) {
    const dir = path.join(E2E_SITES_DIR, rel);
    const date = new Date(ms);
    for (const name of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, name), date, date);
    fs.utimesSync(dir, date, date);
  }
}

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

// 模板页退役后（pp2 切片 3）：清单 = 全部 registry 行，书写顺序。
const DEFAULT_ORDER = [
  'e2e-ios', 'e2e-site', 'e2e-proxy', 'e2e-dir', 'e2e-dir-ios', 'e2e-mention', 'e2e-mixed', 'e2e-doc',
];

test.beforeAll(pressMtimes);

test('Pages 行内时间显示：dir 条目出相对时间，url 条目不出', async ({ page }) => {
  await openWorkbench(page);

  // mtime = now 的固件渲染「刚刚」；2026-01-01 的固件渲染「1-1」（同年超 7 天，M-D 不补零）。
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"] .wb-page-time')).toHaveText('刚刚');
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"] .wb-page-time')).toHaveText('1-1');
  // url 条目无 mtime，不出时间元素。
  await expect(page.locator('#wbpages [data-vpage="e2e-site"] .wb-page-time')).toHaveCount(0);
});

test('排序切换循环三档并持久化', async ({ page }) => {
  await openWorkbench(page);

  const sortBtn = page.locator('.wb-page-sort');
  await expect(sortBtn).toHaveAttribute('data-page-sort', 'default');
  expect(await pageOrder(page)).toEqual(DEFAULT_ORDER);

  // 最近更新：mtime 倒序；无 mtime 的页（url 条目）按原相对顺序沉底。
  await sortBtn.click();
  await expect(sortBtn).toHaveAttribute('data-page-sort', 'updated');
  expect(await pageOrder(page)).toEqual([
    'e2e-mixed', 'e2e-doc', 'e2e-ios', 'e2e-dir-ios', 'e2e-mention', 'e2e-dir',
    'e2e-site', 'e2e-proxy',
  ]);

  // 名称：zh locale 排序（此处全 Latin 标题，E2E* 字典序）。
  await sortBtn.click();
  await expect(sortBtn).toHaveAttribute('data-page-sort', 'name');
  expect(await pageOrder(page)).toEqual([
    'e2e-dir', 'e2e-dir-ios', 'e2e-doc', 'e2e-ios', 'e2e-mention', 'e2e-mixed', 'e2e-proxy', 'e2e-site',
  ]);

  // 第三击回到默认；选择写进 prefs。
  await sortBtn.click();
  await expect(sortBtn).toHaveAttribute('data-page-sort', 'default');
  expect(await pageOrder(page)).toEqual(DEFAULT_ORDER);
  await expect.poll(() =>
    page.evaluate(() => JSON.parse(localStorage.getItem('pinpoint-wb')).pageSort),
  ).toBe('default');

  // 持久化：切到 updated 后 reload，排序档与顺序都保持。
  await sortBtn.click();
  await expect(sortBtn).toHaveAttribute('data-page-sort', 'updated');
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('.wb-page-sort')).toHaveAttribute('data-page-sort', 'updated');
  expect(await pageOrder(page)).toEqual([
    'e2e-mixed', 'e2e-doc', 'e2e-ios', 'e2e-dir-ios', 'e2e-mention', 'e2e-dir',
    'e2e-site', 'e2e-proxy',
  ]);
});
