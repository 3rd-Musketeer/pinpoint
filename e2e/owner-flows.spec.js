import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './lib/fixtures.js';
import { dragSelect, proseSettled } from './lib/prose.js';
import { ownerCleanup, ownerLedger, seedOwner, openOwnerArticle, openOwnerBoard, ownerAnnotation, ownerEscapeLayers, focusOwnerFrame } from './lib/owner-flows.js';
import { OWNER_SOURCE } from './lib/owner-fixture.js';

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
    await expect(page.locator('[data-pp-section="part-1"] [data-pp-open]')).toBeFocused();
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
