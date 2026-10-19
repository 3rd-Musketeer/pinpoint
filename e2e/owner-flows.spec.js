import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from './lib/fixtures.js';
import { dragSelect, proseSettled } from './lib/prose.js';
import { ownerCleanup, ownerLedger, seedOwner, openOwnerArticle } from './lib/owner-flows.js';
import { OWNER_SOURCE } from './lib/owner-fixture.js';

test.beforeEach(async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedOwner(request);
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
    const thread = page.locator('.pp-thread[data-kind="prose"]');
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
    const thread = page.locator('.pp-thread[data-kind="prose"]');
    await thread.locator('.q').click();
    await expect(thread.locator('.msg .text')).toHaveText(['请补上取消条件', '取消以后回到正文']);
  });
});
