import { expect, test } from '@playwright/test';

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.iOSAnnotate);
}

async function saveAnnotation(page, target, comment) {
  await target.click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('textarea').fill(comment);
  await box.locator('#ann-save').click();
}

async function expectFocusedTarget(page, selector) {
  await expect.poll(() => page.evaluate((targetSelector) => {
    const stage = document.querySelector('#wbstage');
    const target = document.querySelector(targetSelector);
    if (!stage || !target) return Infinity;
    const stageRect = stage.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width < 1 || targetRect.height < 1) return Infinity;
    const inset = 24;
    const expectedLeft = targetRect.width + inset * 2 <= stage.clientWidth
      ? (stage.clientWidth - targetRect.width) / 2
      : inset;
    const expectedTop = targetRect.height + inset * 2 <= stage.clientHeight
      ? (stage.clientHeight - targetRect.height) / 2
      : inset;
    return Math.max(
      Math.abs(targetRect.left - stageRect.left - expectedLeft),
      Math.abs(targetRect.top - stageRect.top - expectedTop),
    );
  }, selector)).toBeLessThan(4);
}

test('manifest navigation survives rapid page switches and persists the winner', async ({ page }) => {
  await openWorkbench(page);

  await expect(page.locator('#wbpages .wb-page')).toHaveText([
    'Component Library',
    'Example Library',
    'GTD · 核心两屏',
    'Time Insight',
    'Goal 周报卡',
  ]);

  for (const [pageId, screenId] of [
    ['components', 'button/catalog'],
    ['library', 'msg-lock'],
    ['smart-todo', 'today'],
    ['time-insight', 'tear-calendar'],
  ]) {
    await page.locator(`#wbpages [data-vpage="${pageId}"]`).click();
    await expect(page.locator(`#wb-board-panel [data-screen="${screenId}"]`)).toBeVisible();
    await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  }

  await page.evaluate(() => {
    window.workbench.setActivePage('time-insight');
    window.workbench.setActivePage('smart-todo');
  });

  await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('smart-todo');
  await expect(page.locator('#wb-board-panel [data-screen="today"]')).toBeVisible();
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ios-preview-wb')).activePageId)).toBe('smart-todo');
});

test('persistent canvas toolbar supports continuous section nav and layered minimap', async ({ page }) => {
  await openWorkbench(page);
  await expect(page.locator('#wb-board-panel [data-screen="msg-lock"]')).toBeVisible();

  const toolbar = page.locator('#wbcanvas-hud');
  const minimapTool = page.locator('#wbminimap-wrap');
  const minimapToggle = page.locator('#wbminimap-toggle');
  const minimap = page.locator('#wbminimap');
  const navigatorToggle = page.locator('#wbsection-nav-toggle');
  const navigator = page.locator('#wbsection-nav');

  await expect(toolbar).toBeVisible();
  await expect(minimapTool).toBeVisible();
  await expect(minimap).toBeHidden();
  await expect(navigatorToggle).toBeVisible();
  await expect(navigatorToggle).toContainText('1 / 5');

  await navigatorToggle.click();
  await expect(navigator).toBeVisible();
  await expect(navigator.locator('.wb-section-nav-item')).toHaveCount(5);
  await expect(navigator.locator('.wb-section-nav-label')).toHaveText([
    '锁屏 → 消息 → 回复',
    '锁屏 · 通知',
    '设置 · 分组列表',
    'Today · Feed',
    'AB · 主按钮',
  ]);
  await expect(minimap).toBeHidden();

  // Row screens use display:contents; navigation must target their concrete frame box.
  await navigator.locator('[data-nav-screen="msg-thread"]').click();
  await expectFocusedTarget(page, '[data-screen="msg-thread"] .ios-stage');
  await navigator.locator('[data-nav-screen="ab-b"]').click();
  await expectFocusedTarget(page, '[data-screen="ab-b"] .ios-stage');

  await navigator.locator('[data-nav-screen="settings"]').click();
  await expect(navigator).toBeVisible();
  await expectFocusedTarget(page, '[data-screen="settings"] .ios-stage');
  await expect.poll(() => page.locator('.wb-section-nav-item.on').getAttribute('data-nav-group')).toBe('settings');
  await expect.poll(() => page.locator('#wbstage').evaluate((stage) => stage.scrollTop)).toBeGreaterThan(4000);

  await navigator.locator('.wb-section-nav-section[data-nav-group="feed"]').click();
  await expect(navigator).toBeVisible();
  await expectFocusedTarget(page, '#lib-feed');
  await expect.poll(() => page.locator('.wb-section-nav-item.on').getAttribute('data-nav-group')).toBe('feed');

  for (let i = 0; i < 4; i++) await page.locator('#wbzoom-out').click();
  await navigator.locator('[data-nav-screen="msg-reply"]').click();
  await expectFocusedTarget(page, '[data-screen="msg-reply"] .ios-stage');

  await minimapToggle.click();
  await expect(navigator).toBeVisible();
  await expect(minimap).toBeVisible();
  await expect(minimap).toHaveAttribute('data-minimap-levels', 'canvas section frame');
  await expect(minimap).toHaveAttribute('data-minimap-section-count', '5');
  await expect(minimap).toHaveAttribute('data-minimap-frame-count', '8');
  await expect(minimap.locator('canvas')).toBeVisible();
  await minimap.locator('canvas').click({ position: { x: 104, y: 66 } });
  await expect(minimap).toBeVisible();
  await expect(navigator).toBeVisible();

  const dockLayout = await page.evaluate(() => {
    const navigatorRect = document.querySelector('#wbsection-nav').getBoundingClientRect();
    const minimapRect = document.querySelector('#wbminimap').getBoundingClientRect();
    const toolbarRect = document.querySelector('#wbcanvas-hud').getBoundingClientRect();
    return {
      navigatorBottom: navigatorRect.bottom,
      navigatorRight: navigatorRect.right,
      navigatorWidth: navigatorRect.width,
      minimapTop: minimapRect.top,
      minimapRight: minimapRect.right,
      minimapWidth: minimapRect.width,
      toolbarRight: toolbarRect.right,
      toolOrder: [...document.querySelectorAll('#wbcanvas-hud .wb-toolbar-tool-btn')].map((button) => button.id),
    };
  });
  expect(dockLayout.navigatorBottom).toBeLessThanOrEqual(dockLayout.minimapTop);
  expect(dockLayout.navigatorRight).toBeCloseTo(dockLayout.minimapRight, 0);
  expect(dockLayout.navigatorWidth).toBeCloseTo(dockLayout.minimapWidth, 1);
  expect(dockLayout.minimapRight).toBeCloseTo(dockLayout.toolbarRight, 0);
  expect(dockLayout.toolOrder).toEqual(['wbsection-nav-toggle', 'wbminimap-toggle']);

  await page.locator('#wbzoom-label').click();
  await expect(navigator).toBeVisible();
  await expect(minimap).toBeVisible();

  await page.locator('#wbpages [data-vpage="components"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="button/catalog"]')).toBeVisible();
  await expect(navigator).toBeVisible();
  await expect(minimap).toBeVisible();
  await expect(page.locator('.wb-section-nav-item')).toHaveCount(12);
  await expect(navigatorToggle).toContainText('1 / 12');
  await expect(minimap).toHaveAttribute('data-minimap-section-count', '12');
  await expect(minimap).toHaveAttribute('data-minimap-frame-count', '15');
  await expect(toolbar).toBeVisible();

  await navigator.locator('[data-nav-screen="nav/large"]').click();
  await expectFocusedTarget(page, '[data-screen="nav/large"] .wb-comp-stage');

  for (const [pageId, screenId] of [
    ['smart-todo', 'today-evening'],
    ['time-insight', 'detail-feed'],
  ]) {
    await page.locator(`#wbpages [data-vpage="${pageId}"]`).click();
    await expect(page.locator(`#wb-board-panel [data-screen="${screenId}"]`)).toBeVisible();
    const navTarget = navigator.locator(`[data-nav-screen="${screenId}"]`);
    await navTarget.scrollIntoViewIfNeeded();
    await navTarget.click();
    await expectFocusedTarget(page, `[data-screen="${screenId}"] .ios-stage`);
    await expect(navigator).toBeVisible();
    await expect(minimap).toBeVisible();
  }

  await navigatorToggle.click();
  await expect(navigator).toBeHidden();
  await expect(minimap).toBeVisible();
  await minimapToggle.click();
  await expect(minimap).toBeHidden();
});

test('queued annotation saves survive own SSE, sync to another window, and clear through save', async ({ browser }) => {
  const context = await browser.newContext();
  const writer = await context.newPage();
  const observer = await context.newPage();
  await openWorkbench(writer);
  await openWorkbench(observer);

  let releaseFirstSave;
  let signalFirstSave;
  const firstSaveStarted = new Promise((resolve) => { signalFirstSave = resolve; });
  const releaseFirst = new Promise((resolve) => { releaseFirstSave = resolve; });
  let saveCount = 0;
  await writer.route('**/save', async (route) => {
    saveCount++;
    if (saveCount === 1) {
      signalFirstSave();
      await releaseFirst;
    }
    await route.continue();
  });

  await writer.evaluate(() => window.iOSAnnotate.setMode(true));
  const cells = writer.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await saveAnnotation(writer, cells.nth(0), 'first queued mark');
  await firstSaveStarted;
  await saveAnnotation(writer, cells.nth(1), 'second queued mark');
  releaseFirstSave();

  await expect.poll(() => writer.evaluate(() => window.iOSAnnotate.marks.length)).toBe(2);
  await expect.poll(() => observer.evaluate(() => window.iOSAnnotate.marks.length)).toBe(2);

  await writer.reload();
  await writer.waitForFunction(() => window.iOSAnnotate);
  await expect.poll(() => writer.evaluate(() => window.iOSAnnotate.marks.length)).toBe(2);

  await writer.evaluate(() => window.iOSAnnotate.clear());
  await expect.poll(() => observer.evaluate(() => window.iOSAnnotate.marks.length)).toBe(0);
  const removedEndpoint = await writer.request.post('/clear', { data: { page: 'index' } });
  expect(removedEndpoint.status()).toBe(404);

  await context.close();
});

test('bottom composer keeps focus while canvas clicks attach and inline targets', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.iOSAnnotate.clear());
  await expect.poll(() => page.evaluate(() => window.iOSAnnotate.marks.length)).toBe(0);
  await page.evaluate(() => window.iOSAnnotate.setMode(true));

  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).click();

  const box = page.locator('#ann-box');
  const textarea = box.locator('textarea');
  await expect(box).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(box.locator('.ann-target-pill')).toHaveCount(1);
  await expect(box.locator('#ann-target-mode-reference')).toHaveClass(/on/);

  const composerLayout = await page.evaluate(() => {
    const wrap = document.querySelector('.wb-stage-wrap').getBoundingClientRect();
    const composer = document.querySelector('#ann-box').getBoundingClientRect();
    const hud = document.querySelector('#wbcanvas-hud').getBoundingClientRect();
    const stage = document.querySelector('#wbstage');
    return {
      insideBottom: composer.bottom <= wrap.bottom,
      aboveHud: composer.bottom <= hud.top,
      scrollPaddingBottom: parseFloat(getComputedStyle(stage).scrollPaddingBottom),
      composerHeight: composer.height,
    };
  });
  expect(composerLayout.insideBottom).toBe(true);
  expect(composerLayout.aboveHud).toBe(true);
  expect(composerLayout.scrollPaddingBottom).toBeGreaterThan(composerLayout.composerHeight);

  await page.locator('#wbsection-nav-toggle').click();
  await expect(page.locator('#wbsection-nav')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const composer = document.querySelector('#ann-box').getBoundingClientRect();
    const dock = document.querySelector('#wbcanvas-dock').getBoundingClientRect();
    return composer.right <= dock.left;
  })).toBe(true);

  await textarea.fill('把颜色对齐');
  await textarea.evaluate((el) => el.setSelectionRange(0, 0));
  await cells.nth(1).click();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue('把颜色对齐');
  await expect(box.locator('.ann-target-pill')).toHaveCount(2);

  await box.locator('#ann-target-mode-inline').click();
  await expect(textarea).toBeFocused();
  await textarea.dispatchEvent('compositionstart');
  await cells.nth(2).click();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue('把颜色对齐');
  await textarea.dispatchEvent('compositionend');
  await expect(textarea).toHaveValue('[indicator 3] 把颜色对齐');
  await expect(box.locator('.ann-target-pill')).toHaveCount(3);

  await box.locator('#ann-save').click();
  await expect(box).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.iOSAnnotate.marks[0])).toMatchObject({
    content: '[@t:i3] 把颜色对齐',
    selector: expect.any(String),
    targets: [
      { ref: 'i1', selector: expect.any(String), text: expect.any(String) },
      { ref: 'i2', selector: expect.any(String), text: expect.any(String) },
      { ref: 'i3', selector: expect.any(String), text: expect.any(String) },
    ],
  });

  await page.locator('.ann-badge').first().click();
  await expect(box).toBeVisible();
  await expect(textarea).toHaveValue('[indicator 3] 把颜色对齐');
  await expect(box.locator('#ann-target-mode-inline')).toHaveClass(/on/);
  await expect(box.locator('.ann-target-pill')).toHaveCount(3);
});

test('composer moves only from its drag handle and stays fixed in the viewport', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.iOSAnnotate.clear());
  await page.evaluate(() => window.iOSAnnotate.setMode(true));

  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).click();
  const box = page.locator('#ann-box');
  const textarea = box.locator('textarea');
  const handle = box.locator('.ann-drag-handle');
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute('aria-label', '拖动标注框');

  const before = await box.boundingBox();
  const handleRect = await handle.boundingBox();
  await page.mouse.move(handleRect.x + handleRect.width / 2, handleRect.y + handleRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleRect.x - 150, handleRect.y - 110, { steps: 6 });
  await page.mouse.up();

  const moved = await box.boundingBox();
  expect(Math.abs(moved.x - before.x)).toBeGreaterThan(80);
  expect(Math.abs(moved.y - before.y)).toBeGreaterThan(60);
  await expect(textarea).toBeFocused();

  const textareaRect = await textarea.boundingBox();
  await page.mouse.move(textareaRect.x + 30, textareaRect.y + 24);
  await page.mouse.down();
  await page.mouse.move(textareaRect.x + 100, textareaRect.y + 24, { steps: 4 });
  await page.mouse.up();
  const afterTextareaDrag = await box.boundingBox();
  expect(afterTextareaDrag.x).toBeCloseTo(moved.x, 0);
  expect(afterTextareaDrag.y).toBeCloseTo(moved.y, 0);

  await page.locator('#wbstage').evaluate((stage) => { stage.scrollTop += 300; });
  const afterCanvasScroll = await box.boundingBox();
  expect(afterCanvasScroll.x).toBeCloseTo(moved.x, 0);
  expect(afterCanvasScroll.y).toBeCloseTo(moved.y, 0);

  await textarea.fill('记住这个位置');
  await box.locator('#ann-save').click();
  await page.evaluate(() => window.iOSAnnotate.openMark(window.iOSAnnotate.marks[0].n));
  const reopened = await box.boundingBox();
  expect(reopened.x).toBeCloseTo(moved.x, 0);
  expect(reopened.y).toBeCloseTo(moved.y, 0);

  await page.setViewportSize({ width: 820, height: 700 });
  await expect.poll(() => page.evaluate(() => {
    const wrap = document.querySelector('.wb-stage-wrap').getBoundingClientRect();
    const composer = document.querySelector('#ann-box').getBoundingClientRect();
    return composer.left >= wrap.left + 11
      && composer.right <= wrap.right - 11
      && composer.top >= wrap.top + 11
      && composer.bottom <= wrap.bottom - 11;
  })).toBe(true);
  const narrow = await box.boundingBox();

  await page.setViewportSize({ width: 1280, height: 700 });
  await expect.poll(async () => (await box.boundingBox()).width).toBeGreaterThan(narrow.width + 100);
});

test('target pills locate, remove inline refs, and cancel existing edits', async ({ page }) => {
  await openWorkbench(page);
  await page.evaluate(() => window.iOSAnnotate.clear());
  await expect.poll(() => page.evaluate(() => window.iOSAnnotate.marks.length)).toBe(0);
  await page.evaluate(() => window.iOSAnnotate.setMode(true));

  const cells = page.locator('#wb-board-panel [data-screen="settings"] .ios-cell');
  await cells.nth(0).click();
  const box = page.locator('#ann-box');
  const textarea = box.locator('textarea');
  await box.locator('.ann-target-pill').hover();
  await box.locator('.ann-target-remove').click();
  await expect(box).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.iOSAnnotate.marks.length)).toBe(0);

  await cells.nth(0).click();
  await box.locator('#ann-target-mode-inline').click();
  await textarea.fill('参考 ');
  await textarea.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await cells.nth(1).click();
  await expect(textarea).toHaveValue('参考 [indicator 2] ');

  const secondPill = box.locator('.ann-target-pill[data-target-ref="i2"]');
  await secondPill.hover();
  await expect(page.locator('.ann-hover-ghost')).not.toHaveAttribute('hidden', '');
  await secondPill.click();
  await expect(textarea).toBeFocused();
  await secondPill.locator('.ann-target-remove').click();
  await expect(textarea).toHaveValue('参考 ');
  await expect(box.locator('.ann-target-pill')).toHaveCount(1);

  await cells.nth(2).click();
  await expect(box.locator('.ann-target-pill[data-target-ref="i3"]')).toHaveCount(1);
  await expect(textarea).toHaveValue('参考 [indicator 3] ');
  await box.locator('.ann-target-pill[data-target-ref="i3"]').hover();
  await box.locator('.ann-target-pill[data-target-ref="i3"] .ann-target-remove').click();
  await expect(textarea).toHaveValue('参考 ');

  await textarea.fill('已保存');
  await box.locator('#ann-save').click();
  await page.locator('.ann-badge').first().click();
  await box.locator('.ann-target-pill').hover();
  await box.locator('.ann-target-remove').click();
  await expect(box).toBeVisible();
  await expect(box.locator('.ann-target-pill')).toHaveCount(1);
  await textarea.fill('不应保存');
  await box.locator('#ann-cancel').click();
  await expect(box).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.iOSAnnotate.marks[0].content)).toBe('已保存');

  await page.locator('.ann-badge').first().click();
  await textarea.fill('换页也不应保存');
  await page.evaluate(() => window.workbench.setActivePage('smart-todo'));
  await expect(box).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.iOSAnnotate.marks[0].content)).toBe('已保存');
});
