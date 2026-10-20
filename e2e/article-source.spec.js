import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './lib/fixtures.js';
import { E2E_FIXTURE_DIR } from './env.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';
import { waitNoReload } from './site-settle.js';
import { closeSettled } from './ledger-settle.js';

test('坏 frontmatter 显示本篇错误，健康文章持续可读；修复和删除自动生效', async ({ page, request }) => {
  test.setTimeout(180_000);
  const root = path.join(E2E_FIXTURE_DIR, 'loader-project');
  const dir = path.join(root, 'docs/pinpoint');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ id: 'loader', title: 'loader' }));
  const write = (id, text) => {
    const folder = path.join(dir, 'articles', id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'index.mdx'), text);
  };
  write('a', '---\ntitle: A\n---\n正文 A');
  write('b', '---\ntitle: B\n---\n正文 B');
  appendRegistryEntry({ id: 'loader', kind: 'project', path: root });
  await request.post('/registry/reload');
  try {
    await expect.poll(async () => (await request.get('/loader/b/')).status(), { timeout: 150_000 }).toBe(200);
    await page.goto('/loader/b/');
    await expect(page.locator('#article h1')).toHaveText('B');
    await waitNoReload(page);
    write('a', '---\ntitle: [\n---\n正文 A');
    // 等错误页出现，确保 watcher 已消费这次编辑，再检查健康正文。
    await expect.poll(async () => (await request.get('/loader/a/')).text()).toContain('unexpected end');
    // watcher 消费编辑后还会把开着的页整页重载一次；重载和 goto 撞车时 goto 拿不到响应（返回 null）。
    // 先等开着的 b 页落定再导航。
    await waitNoReload(page);
    expect((await page.goto('/loader/b/')).status()).toBe(200);
    await expect(page.locator('#article h1')).toHaveText('B');
    await expect(page.locator('.article-body')).toContainText('正文 B');
    expect((await page.goto('/loader/a/')).status()).toBe(200);
    await expect(page.locator('body')).toContainText('articles/a/index.mdx');
    await expect(page.locator('body')).toContainText('unexpected end');
    await page.screenshot({ path: test.info().outputPath('bad-article.png') });
    write('a', '---\ntitle: 修复后的 A\n---\n恢复的正文');
    await expect.poll(async () => (await request.get('/loader/a/')).text()).toContain('恢复的正文');
    await page.goto('/loader/a/');
    await expect(page.locator('#article h1')).toHaveText('修复后的 A');
    await expect(page.locator('.article-body')).toContainText('恢复的正文');
    fs.rmSync(path.join(dir, 'articles/a'), { recursive: true });
    await expect.poll(async () => (await request.get('/loader/a/')).status()).toBe(404);
    // 同上：删除也会让开着的一页整页重载，落定后再导航。
    await waitNoReload(page);
    expect((await page.goto('/loader/b/')).status()).toBe(200);
    await expect(page.locator('.article-body')).toContainText('正文 B');
  } finally {
    await closeSettled(page);
    await restoreRegistryFixture(request);
  }
});
