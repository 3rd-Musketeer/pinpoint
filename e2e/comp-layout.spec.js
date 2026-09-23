import { expect, test } from '@playwright/test';

// comp 段的画布网格（2026-09-23 comp 布局修复）：row 段是三行网格、.wb-screen
// display:contents，comp 屏不出尺寸行 —— 每屏只有两格，隐式按列填充会从第二屏
// 起整体串位（图注落进上一列的空格、卡头上没有图注）。回归锚用范例页
// bean-card 段（三张高度不同的 BeanCard）：图注各在自己那张卡的正上方
// （同列 → 同 x、间距一致），三张卡从左到右、顶端对齐。

test('comp 段三张卡：图注各在其卡正上方，卡从左到右顶端对齐', async ({ page }) => {
  await page.goto('/index.html?page=example');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  const section = page.locator('#wb-board-panel .wb-lib-item[data-ann-section="bean-card"]');
  await expect(section).toBeVisible();
  await expect(section.locator('.wb-comp-stage')).toHaveCount(3);
  await expect(section.locator('.wb-screen-cap')).toHaveCount(3);

  const rows = await section.evaluate((el) => {
    const rect = (n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      caps: [...el.querySelectorAll('.wb-screen-cap')].map(rect),
      cards: [...el.querySelectorAll('.wb-comp-stage')].map(rect),
    };
  });

  // 画布整板套 transform: scale(zoom × 0.5)，统一在 0.6px 容差里比几何。
  const eps = 0.6;
  expect(rows.caps).toHaveLength(3);
  expect(rows.cards).toHaveLength(3);

  for (let i = 0; i < 3; i++) {
    // 图注 x = 卡 x（同一列，左缘对齐）。
    expect(Math.abs(rows.caps[i].left - rows.cards[i].left)).toBeLessThanOrEqual(eps);
    // 图注在卡上方，间距 = 网格 row-gap，三列一致。
    const gap = rows.cards[i].top - rows.caps[i].bottom;
    expect(gap).toBeGreaterThan(0);
    expect(Math.abs(gap - (rows.cards[0].top - rows.caps[0].bottom))).toBeLessThanOrEqual(eps);
  }
  // 三张卡从左到右，顶端对齐（卡高不同也要同一起始行）。
  expect(rows.cards[0].left).toBeLessThan(rows.cards[1].left);
  expect(rows.cards[1].left).toBeLessThan(rows.cards[2].left);
  expect(Math.abs(rows.cards[0].top - rows.cards[1].top)).toBeLessThanOrEqual(eps);
  expect(Math.abs(rows.cards[1].top - rows.cards[2].top)).toBeLessThanOrEqual(eps);
});
