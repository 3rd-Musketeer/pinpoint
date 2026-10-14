import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR } from './env.js';
import { ppnt } from './lib/cli.js';
import { countColorPixels } from './png-probe.js';

// pp3：每篇文章的画布 = 一个由 index.mdx 派生的页（docs/projects.md「画布视图」）。
// 固件：常驻 project e2e-project（e2e/project-site/）的 commit-confirm：四个 Section，
// 有 Canvas 的三节 confirm（confirm-sheet、confirm-done）、variants（card-plain，shell comp）
// 与 mixed（mixed-phone 手机帧 + mixed-bare：帧文件自己 export const shell = "comp"），
// 帧用到本篇组件、project 共用组件和 kit，本篇有 article.css。
// 不经过 Astro：画布页只靠 pinpoint 服务与编译器。
const PAGE_ID = 'e2e-project_commit-confirm';

test('文章画布：工作台 ?page=&section=、混排节、不进 Pages、ppnt shot', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // 纯 HTTP 的几步在单测里（2026-10-13 测试清理）：/api/frame 的组件三层解析与 article.css
  // 注入 → src/server/lib/article-board.test.js「编译：dist 出帧…」；/sites/ 出 article.css、
  // 未知帧 → src/server/article-canvas-serve.test.js 前两条；画布结构端点的节字母 →
  // article-board.test.js「articleCanvas：节字母 = 正文字母」；帧级 shell 进 board →
  // 「帧级 shell」；混排节的组件台 / 机壳 → article-canvas-serve.test.js「/api/frame 的台子」；
  // 画布页 id 是合法桶 → 同文件「标注桶」与 annotate-api.test.js 的 400；
  // list --frames → bin/pinpoint-cli.test.js「list <文章画布页> --frames」。这里只留要浏览器的。
  await test.step('工作台 ?page=<画布页>&section=variants：落到那一节，帧真渲染，没有错误面板', async () => {
    await page.goto(`/index.html?page=${PAGE_ID}&section=variants`);
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, PAGE_ID);
    await expect.poll(() => new URL(page.url()).searchParams.has('section')).toBe(false);
    expect(new URL(page.url()).searchParams.get('page')).toBe(PAGE_ID);
    await expect(page.locator('.wb-lib-item[data-ann-section="variants"]')).toHaveClass(/\bwb-sel\b/);
    await expect(page.locator('#wb-board-panel [data-screen="confirm-sheet"] .e2e-confirm-card')).toBeVisible();
    await expect(page.locator('#wb-board-panel [data-screen="card-plain"] .e2e-confirm-card')).toBeVisible();
    // article.css 生效：确认卡的蓝边来自本篇的页级样式。
    await expect(page.locator('#wb-board-panel [data-screen="confirm-sheet"] .e2e-confirm-card')).toHaveCSS('border-top-color', 'rgb(10, 132, 255)');
    await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
    await expect(page.getByText('页面不存在')).toHaveCount(0);
    // 画布图注的编号与正文节字母一致。
    await expect(page.locator('#wb-board-panel [data-screen="card-plain"] .wb-cap-ref')).toHaveText('C1');
  });

  await test.step('工作台混排节 mixed：手机帧带机壳，帧级 comp 的那一帧是裸组件，没有错误面板', async () => {
    await page.goto(`/index.html?page=${PAGE_ID}&section=mixed`);
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, PAGE_ID);
    await expect(page.locator('.wb-lib-item[data-ann-section="mixed"]')).toHaveClass(/\bwb-sel\b/);
    const bare = page.locator('#wb-board-panel [data-screen="mixed-bare"]');
    const phone = page.locator('#wb-board-panel [data-screen="mixed-phone"]');
    await expect(bare.locator('.e2e-confirm-card')).toBeVisible();
    await expect(phone.locator('.e2e-confirm-card')).toBeVisible();
    await expect(bare).toHaveClass(/\bwb-screen--comp\b/);
    await expect(phone).not.toHaveClass(/\bwb-screen--comp\b/);
    await expect(bare.locator('.wb-screen-dim')).toHaveCount(0); // comp 画板不出尺寸行
    await expect(phone.locator('.wb-screen-dim')).toHaveCount(1);
    await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
    await expect(page.locator('#wb-board-panel [data-screen="mixed-bare"] .wb-cap-ref')).toHaveText('D2');
  });

  await test.step('左栏 Pages 不列画布页（它属于文章）、也不列 project，别的页照常', async () => {
    await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
    await expect(page.locator(`#wbpages [data-vpage="${PAGE_ID}"]`)).toHaveCount(0);
    await expect(page.locator('#wbpages [data-vpage="e2e-project"]')).toHaveCount(0);
    await expect(page.locator('#wbpages [data-vpage="e2e-project_takeover"]')).toHaveCount(0);
  });

  await test.step('ppnt shot B2 --page <画布页>：帧图落盘', async () => {
    const out = path.join(E2E_DATA_DIR, 'shot', PAGE_ID, 'confirm-done.png');
    const { stdout } = await ppnt(['shot', 'B2', '--page', PAGE_ID]);
    expect(stdout).toContain(out);
    const png = fs.readFileSync(out);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  await test.step('ppnt shot C1 C：帧图 / 节图带上 article.css（确认卡的蓝边画进了 PNG）', async () => {
    // 板级装载把帧里的 <style>@import</style> 提到 .wb-library 开头（hoist-imports.js），
    // 帧 / 节的快照里就没有它了：出图要和画布同一套样式。C1 是裸组件帧，蓝色只可能来自
    // article.css 给 .e2e-confirm-card 的 2px 边。
    await ppnt(['shot', 'C1', 'C', '--page', PAGE_ID]);
    for (const name of ['card-plain', 'variants']) {
      const png = fs.readFileSync(path.join(E2E_DATA_DIR, 'shot', PAGE_ID, `${name}.png`));
      expect(await countColorPixels(page.context(), png, [10, 132, 255]), name).toBeGreaterThan(100);
    }
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
