import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './lib/fixtures.js';
import { openOwnerArticle, openOwnerStaticArticle, ownerCleanup, seedOwner } from './lib/owner-flows.js';
import { OWNER_SOURCE, OWNER_STATIC_SOURCE } from './lib/owner-fixture.js';

test('R1：文章以编译完成信号更新 shadow 与 iframe，停用 Astro reload 仍取得后继稿', async ({ page, context, request }) => {
  test.setTimeout(180_000);
  const other = await context.newPage();
  const files = [OWNER_SOURCE, OWNER_STATIC_SOURCE].map(dir => path.join(dir, 'flow-001.jsx'));
  const originals = files.map(file => fs.readFileSync(file, 'utf8'));
  try {
    await seedOwner(request);
    for (const tab of [page, other]) await tab.routeWebSocket(/\/_astro\//, () => {});
    const ready = [page, other].map(tab => tab.waitForResponse(res => new URL(res.url()).pathname === '/events', { timeout: 150_000 }));
    await openOwnerArticle(page);
    await openOwnerStaticArticle(other);
    await Promise.all(ready);
    const live = page.frameLocator('[data-screen="flow-001"] iframe').locator('[data-owner-heading]');
    const shadow = other.locator('.cc-frame[data-screen="flow-001"] .cc-shadow [data-owner-heading]');
    await expect(live).toHaveText('流程 1 初稿');
    await expect(shadow).toHaveText('流程 1 初稿');
    await page.evaluate(() => { window.__frameUpdateDocument = 'same'; });
    for (const revision of ['后继一稿', '后继二稿']) {
      files.forEach((file, i) => fs.writeFileSync(file, originals[i].replace('流程 1 初稿', `流程 1 ${revision}`)));
      await expect(live).toHaveText(`流程 1 ${revision}`, { timeout: 30_000 });
      await expect(shadow).toHaveText(`流程 1 ${revision}`, { timeout: 30_000 });
    }
    expect(await page.evaluate(() => window.__frameUpdateDocument)).toBe('same');
  } finally {
    await ownerCleanup(other);
    await ownerCleanup(page);
    files.forEach((file, i) => fs.writeFileSync(file, originals[i]));
  }
});
