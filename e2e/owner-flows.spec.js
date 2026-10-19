import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './lib/fixtures.js';
import { dragSelect, proseSettled } from './lib/prose.js';
import { ownerCleanup, ownerLedger, seedOwner, openOwnerArticle, openOwnerStaticArticle, openOwnerBoard, ownerAnnotation, ownerEscapeLayers, focusOwnerFrame, boardReady, metric } from './lib/owner-flows.js';
import { OWNER_SOURCE, OWNER_STATIC_SOURCE } from './lib/owner-fixture.js';

test('owner 改稿：修改一个帧源码，工作台和文章卡片自动更新', async ({ page, context }, testInfo) => {
  const source = path.join(OWNER_SOURCE, 'flow-001.jsx');
  const original = fs.readFileSync(source, 'utf8');
  const staticSource = path.join(OWNER_STATIC_SOURCE, 'flow-001.jsx');
  const staticOriginal = fs.readFileSync(staticSource, 'utf8');
  const article = await context.newPage();
  const staticArticle = await context.newPage();
  try {
    await test.step('工作台和文章各打开同一帧', async () => {
      await openOwnerBoard(page);
      await focusOwnerFrame(page);
      await openOwnerArticle(article);
      await expect(article.frameLocator('[data-screen="flow-001"] iframe').locator('[data-owner-heading]')).toHaveText('流程 1 初稿');
      // 静态大文章的同号帧：卡片是 shadow root，Playwright 的 css 选择器直接穿透。
      await openOwnerStaticArticle(staticArticle);
      await expect(staticArticle.locator('.cc-frame[data-screen="flow-001"] .cc-shadow[data-cc-mounted="1"] [data-owner-heading]')).toHaveText('流程 1 初稿');
    });
    await test.step('写源文件，两个页面不手动刷新就看到新稿', async () => {
      const started = performance.now();
      fs.writeFileSync(source, original.replace('流程 1 初稿', '流程 1 修订稿'));
      await expect(page.locator('[data-screen="flow-001"] [data-owner-heading]')).toHaveText('流程 1 修订稿', { timeout: 30_000 });
      await expect(article.frameLocator('[data-screen="flow-001"] iframe').locator('[data-owner-heading]')).toHaveText('流程 1 修订稿', { timeout: 30_000 });
      await boardReady(page);
      await metric(testInfo, 'source-update', { elapsedMs: performance.now() - started });
    });
    // 静态帧单独一个「写 → 看」阶段：文章卡片的更新链路是 Astro 内容库重读 → 整页 reload
    // → 卡片重新取帧 HTML，比 pinpoint 的重编译快；同一 step 里连写两个帧时，页面 reload
    // 会抢在第二个帧编译完之前，取回旧稿后就没有下一次 reload 了（2026-10-19 实测）。
    await test.step('写静态帧的源文件，shadow 卡片照旧更新', async () => {
      fs.writeFileSync(staticSource, staticOriginal.replace('流程 1 初稿', '流程 1 修订稿'));
      await expect(staticArticle.locator('.cc-frame[data-screen="flow-001"] .cc-shadow[data-cc-mounted="1"] [data-owner-heading]')).toHaveText('流程 1 修订稿', { timeout: 30_000 });
    });
  } finally {
    await ownerCleanup(staticArticle);
    await ownerCleanup(article);
    fs.writeFileSync(source, original);
    fs.writeFileSync(staticSource, staticOriginal);
  }
});

// 停驻（E2）：iframe 不移动，关着的浮层里一直是同一份工作台文档。停驻期间来了 HMR，重摆先记账
// （看不见的画布上不重装），打开时补做：内容是新的，文档身份不变（不是靠重装拿到新稿）。
// 文章页自己也会因为同一次改稿整页 reload（Astro 内容库重读，site/src/lib/loaders.js），那会连
// 停驻的工作台一起换掉，这条路径就验不到了：文章页的 Astro HMR 通道接住不转发，只留工作台自己的。
// 重编完、HMR 已发出的信号取另一个标签页里直接打开的工作台。
test('owner 停驻：停驻中改稿，打开后画布是新稿，文档没重装', async ({ page, context }) => {
  const source = path.join(OWNER_SOURCE, 'flow-001.jsx');
  const original = fs.readFileSync(source, 'utf8');
  const board = await context.newPage();
  try {
    await page.routeWebSocket(/\/_astro\//, () => { /* 接住不连服务端：文章页不因改稿整页 reload */ });
    await openOwnerBoard(board);
    await openOwnerArticle(page);
    await expect.poll(() => page.evaluate(() => window.pinpointOverlay?.phase()), { timeout: 90_000 }).toBe('parked');
    const heading = page.frameLocator('[data-pp-overlay] iframe.ov-canvas').locator('.wb-screen[data-screen="flow-001"] [data-owner-heading]');
    await expect(heading).toHaveText('流程 1 初稿', { timeout: 60_000 });
    await page.evaluate(() => { window.pinpointOverlay.frame().contentWindow.__docMark = 'parked-doc'; });
    fs.writeFileSync(source, original.replace('流程 1 初稿', '流程 1 修订稿'));
    await expect(board.locator('[data-screen="flow-001"] [data-owner-heading]')).toHaveText('流程 1 修订稿', { timeout: 30_000 });
    // 停驻的画布这时还是旧稿：重摆记了账，没在看不见的地方做。
    await expect(heading).toHaveText('流程 1 初稿');
    await page.locator('#btn-canvas').click();
    await expect(page.locator('dialog[data-pp-overlay]')).toHaveAttribute('open', '');
    await expect(heading).toHaveText('流程 1 修订稿', { timeout: 30_000 });
    expect(await page.evaluate(() => window.pinpointOverlay.frame().contentWindow.__docMark)).toBe('parked-doc');
  } finally {
    await ownerCleanup(board);
    await ownerCleanup(page);
    fs.writeFileSync(source, original);
  }
});

test('owner 静态卡片：缩略帧不接焦点，点帧在原位打开画布浮层并选中这一帧', async ({ page }) => {
  await openOwnerStaticArticle(page);
  const fig = page.locator('[data-pp-section="part-2"] .cc-frame[data-screen="flow-010"]');
  await fig.scrollIntoViewIfNeeded();
  // 与性能门同一个等法：滚进视口后取帧、挂载、量完（高负载下要十几秒）。
  await expect(fig.locator('.cc-box[data-fitted="1"]')).toHaveCount(1, { timeout: 30_000 });
  const action = fig.locator('.cc-shadow[data-cc-mounted="1"] [data-owner-action]');
  await expect(action).toHaveText('确认流程 10');
  // iframe 缩略帧是 tabindex -1；shadow 里的按钮属于文章页，必须同样拿不到焦点。
  await action.evaluate(el => el.focus());
  await expect(action).not.toBeFocused();
  const before = await page.evaluate(() => [window.scrollX, window.scrollY]);
  await fig.locator('.cc-hit').click();
  await expect(page.locator('dialog[data-pp-overlay]')).toHaveAttribute('open', '');
  const scope = await (await page.locator('iframe.ov-canvas').elementHandle()).contentFrame();
  await boardReady(scope);
  // 浮层落点的就绪信号（article-viewer 同款）：落到这一帧后才选中。
  await expect.poll(() => page.evaluate(() => window.pinpointOverlay?.state()?.landing), { timeout: 30_000 }).toBe('frame:flow-010');
  await expect(scope.locator('.wb-screen[data-screen="flow-010"]')).toHaveClass(/\bwb-sel\b/);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[data-pp-overlay]')).not.toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => [window.scrollX, window.scrollY])).toEqual(before);
});

test('owner 工作台：中文标注、钉子、Esc，帧菜单和红点重置', async ({ page }) => {
  const scope = await openOwnerBoard(page);
  await test.step('直接打开工作台做标注并逐层退出', async () => {
    await ownerAnnotation(page, scope);
    await ownerEscapeLayers(page, scope);
  });
  await test.step('交互后出现红点，菜单重置只改当前帧，红点也能重置', async () => {
    const screen = await focusOwnerFrame(scope);
    const other = scope.locator('.wb-screen[data-screen="flow-002"]');
    const dot = screen.locator('[data-frame-dirty-dot]');
    await expect(dot).toHaveCount(0);
    await screen.locator('[data-owner-action]').click();
    await expect(screen.locator('[data-owner-result]')).toHaveText('已经确认');
    await expect(dot).toBeVisible();
    await other.locator('[data-owner-result]').evaluate(el => { el.textContent = '相邻帧保留'; });
    await screen.hover();
    await screen.locator('.wb-frame-menu-trigger').click();
    await screen.locator('[data-frame-reset]').click();
    await expect(screen.locator('[data-owner-result]')).toHaveText('尚未确认');
    await expect(dot).toHaveCount(0);
    await expect(other.locator('[data-owner-result]')).toHaveText('相邻帧保留');
    await screen.locator('[data-owner-action]').click();
    await expect(dot).toBeVisible();
    await dot.click();
    await expect(screen.locator('[data-owner-result]')).toHaveText('尚未确认');
    await expect(dot).toHaveCount(0);
    await screen.locator('[data-owner-action]').click();
    await expect(screen.locator('[data-owner-result]')).toHaveText('已经确认');
  });
});

test.beforeEach(async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedOwner(request);
});

test('owner 浮层：中文组字、保存、点钉子，Esc 按层回正文', async ({ page }) => {
  const scope = await openOwnerBoard(page, true);
  await test.step('定位到帧，输入法组字后保存，点击已有钉子重新打开', async () => {
    await ownerAnnotation(page, scope);
  });
  await test.step('Esc 依次关闭菜单、标注列表、标注模式、浮层', async () => {
    await ownerEscapeLayers(page, scope);
    await expect(page.locator('dialog[data-pp-overlay]')).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[data-pp-overlay]')).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-pp-section="part-1"] [data-screen="flow-001"] .cc-hit')).toBeFocused();
  });
});
test.afterEach(async ({ page }) => { await ownerCleanup(page); });

test('owner 正文：读 97 帧文章、选字评论、编辑、回复，刷新后保留', async ({ page }) => {
  await test.step('读正文和已有 24 条画布标注', async () => {
    await openOwnerArticle(page);
    await expect(page.locator('#part-1')).toContainText('确认操作之前先看清结果');
  });
  await test.step('选正文写评论，编辑第一句，再回复', async () => {
    await dragSelect(page, '#part-1', '确认操作之前先看清结果');
    await page.locator('.pp-selbtn').click();
    const draft = page.locator('.pp-thread.draft');
    await draft.locator('textarea').fill('请补上确认条件');
    await draft.getByRole('button', { name: '发送' }).click();
    await proseSettled(page);
    const thread = page.locator('.pp-thread:not([data-kind="canvas"]):not(.draft)');
    await expect(thread).toHaveCount(1);
    await thread.locator('.msg .text').click();
    await thread.locator('textarea.pp-edit').fill('请补上取消条件');
    await thread.locator('textarea.pp-edit').press('ControlOrMeta+Enter');
    await expect(thread.locator('.msg .text')).toHaveText('请补上取消条件');
    await thread.getByRole('button', { name: '回复', exact: true }).click();
    await thread.locator('textarea[data-reply]').fill('取消以后回到正文');
    await thread.locator('textarea[data-reply]').press('Enter');
    await proseSettled(page);
    expect(ownerLedger('@prose').map(a => [a.content, a.messages.map(m => m.text)])).toEqual([['请补上取消条件', ['取消以后回到正文']]]);
  });
  await test.step('刷新后仍能读到评论和回复', async () => {
    await page.reload();
    await proseSettled(page);
    const thread = page.locator('.pp-thread:not([data-kind="canvas"]):not(.draft)');
    await thread.locator('.q').click();
    await expect(thread.locator('.msg .text')).toHaveText(['请补上取消条件', '取消以后回到正文']);
  });
});
