import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './lib/fixtures.js';

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

test('文章画布：工作台 /workbench/?page=&section=、旧地址跳转、混排节、不进 Pages、左上角回正文、嵌入版、ppnt shot', async ({ page }) => {
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
    await page.goto(`/workbench/?page=${PAGE_ID}&section=variants`);
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

  await test.step('旧地址 /?page=…&section= 跳到 /workbench/：参数原样带上，落到那一节，地址栏留在 /workbench/', async () => {
    await page.goto(`/?page=${PAGE_ID}&section=confirm`);
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, PAGE_ID);
    await expect(page.locator('.wb-lib-item[data-ann-section="confirm"]')).toHaveClass(/\bwb-sel\b/);
    await expect(page.locator('#wb-board-panel [data-screen="confirm-sheet"] .e2e-confirm-card')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.has('section')).toBe(false);
    expect(new URL(page.url()).pathname).toBe('/workbench/');
    expect(new URL(page.url()).searchParams.get('page')).toBe(PAGE_ID);
  });

  await test.step('工作台混排节 mixed：手机帧带机壳，帧级 comp 的那一帧是裸组件，没有错误面板', async () => {
    await page.goto(`/workbench/?page=${PAGE_ID}&section=mixed`);
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

  await test.step('横条页名：画布视图显示文章标题（画布页在清单 manifest.articles 里，不在 Pages）', async () => {
    await page.goto(`/workbench/?page=${PAGE_ID}&section=variants`);
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, PAGE_ID);
    await expect(page.locator('#wbstrip-title')).toHaveText('提交前确认');
  });

  await test.step('左上角“← 文章标题”：落点跟着当前节走，跟着左栏挪，帧不摆到它底下；横条上没有“阅读正文”；存量页不出', async () => {
    // 地址怎么拼在单测（lib/article-groups.test.js articleCanvasReadUrl）；这里守钮在左上角、
    // 跟着画布当前节换锚点、点了是同标签页导航。正文页本身是站点（Astro）出的，这个 spec 不拉
    // 站点，所以文章地址用 page.route 接住，只看导航到了哪里。
    await page.goto(`/workbench/?page=${PAGE_ID}&section=variants`);
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, PAGE_ID);
    await expect(page.locator('#wbread-article')).toHaveCount(0);
    await expect(page.locator('#wbstrip')).not.toContainText('阅读正文');
    const back = page.locator('#wbback');
    await expect(back).toHaveText('提交前确认');
    await expect(back).toHaveAttribute('href', '/e2e-project/commit-confirm/#variants');
    await expect(back).not.toHaveAttribute('target', /.+/);
    await expect(back).toHaveCSS('text-decoration-line', 'none');
    // 左上角：在顶上、在左栏右边（左栏展开时），不压左栏。
    const box = await back.boundingBox();
    const side = await page.locator('#wbside').boundingBox();
    expect(box.y).toBeLessThanOrEqual(16);
    expect(box.x).toBeGreaterThanOrEqual(side.x + side.width);
    expect(box.x).toBeLessThan(side.x + side.width + 40);
    // 这一节的帧不在它底下：落点按上方留白算（chromeInsets 把它算进去）。
    await expect.poll(() => page.evaluate(() => window.workbench.whenScrollSettled())).toBeTruthy();
    const frame = await page.locator('#wb-board-panel [data-screen="card-plain"] .e2e-confirm-card').boundingBox();
    expect(frame.y).toBeGreaterThanOrEqual(box.y + box.height);

    await expect.poll(() => page.evaluate(() => window.workbench.focusSection('mixed'))).toBe(true);
    await expect(back).toHaveAttribute('href', '/e2e-project/commit-confirm/#mixed');

    // 收起左栏：贴到左缘。
    await page.locator('#wbside-toggle').click();
    await expect.poll(async () => (await back.boundingBox()).x).toBeLessThan(40);
    await page.locator('#wbside-toggle').click();
    await expect.poll(async () => (await back.boundingBox()).x).toBeGreaterThanOrEqual(side.x + side.width);

    await page.route('**/e2e-project/commit-confirm/', (route) => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>正文</title><section id="mixed">混排</section>',
    }));
    await back.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/e2e-project/commit-confirm/');
    expect(new URL(page.url()).hash).toBe('#mixed');
    await page.unroute('**/e2e-project/commit-confirm/');
    await page.goBack();
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, PAGE_ID);

    await page.goto('/workbench/?page=e2e-ios');
    await page.waitForFunction(() => window.workbench && window.workbench.activePageId() === 'e2e-ios');
    await expect(page.locator('#wbstrip-title')).not.toHaveText('');
    await expect(page.locator('#wbback')).toHaveCount(0);
    // 留在这一页进下一步：预览脚本挂完再走，免得页面关闭时动态 import 半路断掉报 console 错误。
    await expect.poll(() => page.evaluate(() => window.workbench.whenPreviewsSettled())).toBe(true);
  });

  await test.step('嵌入版 ?embed=overlay（文章页画布浮层里那份）：没有左栏、左栏开关和“← 文章标题”，地址同步不丢 embed', async () => {
    await page.goto(`/workbench/?page=${PAGE_ID}&section=confirm&embed=overlay`);
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, PAGE_ID);
    await expect(page.locator('html')).toHaveClass(/\bwb-embed\b/);
    await expect(page.locator('.wb-lib-item[data-ann-section="confirm"]')).toHaveClass(/\bwb-sel\b/);
    await expect(page.locator('#wbside')).toBeHidden();
    await expect(page.locator('#wbsplit')).toBeHidden();
    await expect(page.locator('#wbside-toggle')).toBeHidden();
    await expect(page.locator('#wbback')).toHaveCount(0);
    await expect(page.locator('#wbstrip-title')).toHaveText('提交前确认');
    await expect(page.locator('#wbann-toggle')).toBeVisible(); // 能标注
    await expect.poll(() => new URL(page.url()).searchParams.has('section')).toBe(false);
    expect(new URL(page.url()).searchParams.get('embed')).toBe('overlay');
    await expect.poll(() => page.evaluate(() => window.workbench.whenPreviewsSettled())).toBe(true);
  });

  await test.step('ppnt shot <画布页> B2：帧图落盘', async () => {
    const out = path.join(E2E_DATA_DIR, 'shot', PAGE_ID, 'confirm-done.png');
    const { stdout } = await ppnt(['shot', PAGE_ID, 'B2']);
    expect(stdout).toContain(out);
    const png = fs.readFileSync(out);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  await test.step('ppnt shot C1 C：帧图 / 节图带上 article.css（确认卡的蓝边画进了 PNG）', async () => {
    // 板级装载把帧里的 <style>@import</style> 提到 .wb-library 开头（hoist-imports.js），
    // 帧 / 节的快照里就没有它了：出图要和画布同一套样式。C1 是裸组件帧，蓝色只可能来自
    // article.css 给 .e2e-confirm-card 的 2px 边。
    await ppnt(['shot', PAGE_ID, 'C1', 'C']);
    for (const name of ['card-plain', 'variants']) {
      const png = fs.readFileSync(path.join(E2E_DATA_DIR, 'shot', PAGE_ID, `${name}.png`));
      expect(await countColorPixels(page.context(), png, [10, 132, 255]), name).toBeGreaterThan(100);
    }
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// r5 B5：带裸内联脚本（非 preview-script）的帧走回退 iframe，脚本在 load 后 700ms 才注入
// 12 行内容。量尺只量一次的旧实现把后长出来的内容裁在初始盒子里（或停在没量出的初始尺寸），
// 现在按 0 / 300 / 1200ms 的节奏有界重测（固件帧 e2e/project-site/.../slowinject/late.jsx）。
test('回退 iframe 的卡片：慢注入的帧内容长高后照着重摆，盒子高度跟内容一致', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto('/e2e-project/slowinject/');
  // 冷启动那一下（503「站点启动中」自动刷新）也在等。
  await expect(page.locator('.cc-frame[data-screen="late"]')).toBeVisible({ timeout: 90_000 });
  const box = page.locator('.cc-frame[data-screen="late"] .cc-box');
  // 裸内联脚本归「来路不明」：卡片走回退 iframe。
  await expect(box.locator('iframe')).toHaveAttribute('data-cc-fallback', '1');
  await expect(box).toHaveAttribute('data-fitted', '1', { timeout: 15_000 });
  // 注入完成（脚本 700ms 后补 12 行，加初始的一行文字）。
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('.cc-frame[data-screen="late"] .cc-box iframe').contentDocument
      .querySelectorAll('[data-holder] div').length)), { timeout: 10_000 }).toBe(12);
  // 盒子高度 = 注入后的内容高度 × 卡片缩放：量尺在注入后重测过，内容没有被裁。
  await expect.poll(async () => page.evaluate(() => {
    const b = document.querySelector('.cc-frame[data-screen="late"] .cc-box');
    const stage = b.querySelector('iframe').contentDocument.querySelector('[data-pp-stage]');
    const scale = Number(b.dataset.scale);
    return Math.abs(b.getBoundingClientRect().height - stage.getBoundingClientRect().height * scale);
  }), { timeout: 10_000 }).toBeLessThanOrEqual(2);
  expect(pageErrors).toEqual([]);
});
