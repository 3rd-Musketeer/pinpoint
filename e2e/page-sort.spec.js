import fs from 'node:fs';
import path from 'node:path';
import { E2E_SITES_DIR } from './env.js';

import { expect, test } from '@playwright/test';

import { seedTemplatePagesVisible } from './workbench-helpers.js';

// Each server owns a copy; sorting never changes source fixture timestamps.

const FIXTURE_MTIMES = [
  ['dir-site', Date.parse('2026-01-01T00:00:00Z')],
  ['mention-site', Date.parse('2026-02-01T00:00:00Z')],
  ['dir-site-ios', Date.parse('2026-03-01T00:00:00Z')],
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

  // mtime = now 的固件渲染「刚刚」；2026-01-01 的固件渲染「1-1」（同年超 7 天，M-D 不补零）。
  await expect(page.locator('#wbpages [data-vpage="e2e-mixed"] .wb-page-time')).toHaveText('刚刚');
  await expect(page.locator('#wbpages [data-vpage="e2e-dir"] .wb-page-time')).toHaveText('1-1');
  // url 条目与本地示例页无 mtime，不出时间元素。
  await expect(page.locator('#wbpages [data-vpage="e2e-site"] .wb-page-time')).toHaveCount(0);
  await expect(page.locator('#wbpages [data-vpage="library"] .wb-page-time')).toHaveCount(1);
});

test('排序菜单选择依据与方向，勾选、关闭、持久化且最近不变', async ({ page, request }) => {
  await openWorkbench(page);
  const button = page.locator('.wb-page-sort');
  const menu = page.getByRole('menu', { name: /^Pages 排序：/ });
  const data = await (await request.get('/registry')).json();
  const readRecent = () => page.locator('#wbrecent [data-recent-page]').evaluateAll(els => els.map(el => el.dataset.recentPage));
  const recent = await readRecent();
  const choices = [
    ['name', '名称（A–Z）'], ['name-desc', '名称（Z–A）'],
    ['added', '添加时间（从新到旧）', 'addedAt'], ['added-asc', '添加时间（从旧到新）', 'addedAt'],
    ['updated', '最后修改时间（从新到旧）', 'mtime'], ['updated-asc', '最后修改时间（从旧到新）', 'mtime'],
    ['annotated', '最后标注时间（从新到旧）', 'annotatedAt'], ['annotated-asc', '最后标注时间（从旧到新）', 'annotatedAt'],
    ['default', '手动排序']
  ];
  const titles = await page.locator('#wbpages [data-vpage]').evaluateAll(els => Object.fromEntries(els.map(el => [el.dataset.vpage, el.querySelector('.wb-page-t').textContent])));
  for (const [sort, label, key] of choices) {
    await button.click();
    await expect(menu.getByRole('menuitemradio')).toHaveCount(9);
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
    await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(button).toHaveAttribute('data-page-sort', sort);
    const expected = DEFAULT_ORDER.slice().sort((a, b) => {
      if (key) {
        const at = data.pageTimes[a]?.[key] || 0, bt = data.pageTimes[b]?.[key] || 0;
        if (!at || !bt) return at ? -1 : bt ? 1 : 0;
        return sort.endsWith('-asc') ? at - bt : bt - at;
      }
      if (sort.startsWith('name')) return titles[a].localeCompare(titles[b], 'zh') * (sort === 'name-desc' ? -1 : 1);
      return 0;
    });
    expect(await pageOrder(page)).toEqual(expected);
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
