import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

// 2026-08-17g：Pages 时间显示与排序切换。四个 dir 固件的 mtime 在 beforeAll
// 压成受控值（git 不追踪 mtime，utimes 不污染工作区；workers=1 串行，无并发
// 竞争），「最近更新」档的顺序因此是确定的。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FIXTURE_MTIMES = [
  ['e2e/dir-site', Date.parse('2026-01-01T00:00:00Z')],
  ['e2e/mention-site', Date.parse('2026-02-01T00:00:00Z')],
  ['e2e/dir-site-ios', Date.parse('2026-03-01T00:00:00Z')],
  ['e2e/mixed-site', Date.now()],
];

function pressMtimes() {
  for (const [rel, ms] of FIXTURE_MTIMES) {
    const dir = path.join(ROOT, rel);
    const date = new Date(ms);
    for (const name of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, name), date, date);
    fs.utimesSync(dir, date, date);
  }
}

// 模板页（Component Library / Example Library / Example HTML）2026-09-04 起默认
// 不显示（ADR 0032，开关在预览设置）。本文件的断言就落在那三页上，所以进
// workbench 之前先把开关打开——init script 在页面脚本之前跑，合并写进同一份
// prefs，不动其它偏好。
async function seedTemplatePagesVisible(page) {
  await page.addInitScript(() => {
    try {
      const key = 'pinpoint-wb';
      const prefs = JSON.parse(localStorage.getItem(key) || '{}');
      prefs.showTemplatePages = true;
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch { /* 读不到 localStorage 时让断言自己失败，不在这里吞 */ }
  });
}

async function openWorkbench(page) {
  await seedTemplatePagesVisible(page);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
}

function pageOrder(page) {
  return page.locator('#wbpages .wb-page').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-vpage')),
  );
}

const DEFAULT_ORDER = [
  'components', 'library', 'doc-library',
  'e2e-site', 'e2e-proxy', 'e2e-dir', 'e2e-dir-ios', 'e2e-mention', 'e2e-mixed',
];

test.beforeAll(pressMtimes);

test('Pages 行内时间显示：dir 条目出相对时间，url 条目不出', async ({ page }) => {
  await openWorkbench(page);

  // mtime = now 的固件渲染「刚刚」；2026-01-01 的固件渲染「01-01」（同年超 7 天）。
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"] .wb-page-time')).toHaveText('刚刚');
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"] .wb-page-time')).toHaveText('01-01');
  // url 条目与本地示例页无 mtime，不出时间元素。
  await expect(page.locator('#wbpages [data-vpage="e2e-site"] .wb-page-time')).toHaveCount(0);
  await expect(page.locator('#wbpages [data-vpage="library"] .wb-page-time')).toHaveCount(0);
});

test('排序切换循环三档并持久化', async ({ page }) => {
  await openWorkbench(page);

  const sortBtn = page.locator('.wb-page-sort');
  await expect(sortBtn).toHaveAttribute('data-page-sort', 'default');
  expect(await pageOrder(page)).toEqual(DEFAULT_ORDER);

  // 最近更新：mtime 倒序；无 mtime 的页（本地示例 + url 条目）按原相对顺序沉底。
  // 2026-09-04 起 Component Library 也走同一趟排序（切片 ② 把它并进了分组模型，
  // 不再是钉在表头的系统行）—— 它没有 mtime，所以跟着其它无 mtime 的页沉底。
  await sortBtn.click();
  await expect(sortBtn).toHaveAttribute('data-page-sort', 'updated');
  expect(await pageOrder(page)).toEqual([
    'e2e-mixed', 'e2e-dir-ios', 'e2e-mention', 'e2e-dir',
    'components', 'library', 'doc-library', 'e2e-site', 'e2e-proxy',
  ]);

  // 名称：zh locale 排序（此处全 Latin 标题，E2E* 先于 Example*）。
  await sortBtn.click();
  await expect(sortBtn).toHaveAttribute('data-page-sort', 'name');
  expect(await pageOrder(page)).toEqual([
    'components',
    'e2e-dir', 'e2e-dir-ios', 'e2e-mention', 'e2e-mixed', 'e2e-proxy', 'e2e-site',
    'doc-library', 'library',
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
    'e2e-mixed', 'e2e-dir-ios', 'e2e-mention', 'e2e-dir',
    'components', 'library', 'doc-library', 'e2e-site', 'e2e-proxy',
  ]);
});
