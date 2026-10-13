import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_SITE_PORT } from './env.js';

// pp3 M0：文章站点经 pinpoint 服务同源打开（docs/design.md「服务路由（pp3 文章）」）。
// 固件：registry 里常驻的 project 条目 e2e-project → e2e/project-site/（两篇文章、
// 两个概念、一个空 ref [[risk-score]]）。站点是真 Astro 开发服务器，由服务在第一个
// 文章请求时按需拉起（端口 E2E_SITE_PORT，playwright.config 设）。
//
// 一个用例走完：冷启动那一下只发生一次，拆成多个用例就只有第一个看得到「启动中」。

const ARTICLE = '/e2e-project/commit-confirm/';

const siteState = async (request) => (await (await request.get('/health')).json()).site;

test('文章站点：启动中页 → 文章，/_astro/ 资源、[[ ]] popup、概念页、llms.txt，工作台与深链照旧', async ({ page, request }) => {
  // 冷启动 Astro（依赖预构建 + content layer 同步）在高负载机器上要几十秒。
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const sameOrigin = [];
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (url.origin === E2E_BASE_URL) sameOrigin.push({ path: url.pathname, search: url.search, status: res.status(), type: res.request().resourceType() });
  });

  await test.step('服务刚起：站点没拉起过（idle），端口是本轮的', async () => {
    const site = await siteState(request);
    expect(site.state).toBe('idle');
    expect(site.port).toBe(E2E_SITE_PORT);
    expect(site.command).toContain('--ignore-lock');
  });

  await test.step('第一次打开文章：先是 503「站点启动中」，自动刷新后是文章', async () => {
    const first = await page.goto(ARTICLE);
    expect(first.status()).toBe(503);
    await expect(page.locator('main[data-site-state="starting"]')).toBeVisible();
    await expect(page.locator('#article .prose h1')).toHaveText('提交前确认', { timeout: 150_000 });
    await expect(page.locator('#article .lede')).toHaveText('付款与提交前，agent 停下来请用户确认。');
    const site = await siteState(request);
    expect([site.state, site.external, site.warning]).toEqual(['ready', false, null]);
    // 启动中那几次 503 浏览器会记成「Failed to load resource」；从文章页起才算数。
    consoleErrors.length = 0;
  });

  await test.step('页面资源都在 /_astro/ 下且都成功；样式生效；标注客户端以这篇的画布页 id 为桶', async () => {
    await page.waitForFunction(() => window.pinpoint);
    // common-m1.md §2：一篇文章的正文评论与画布标注共用一个桶 = articlePageId。
    expect(await page.evaluate(() => window.__pinpointEntry)).toBe('e2e-project_commit-confirm');
    const scripts = sameOrigin.filter((r) => r.type === 'script' && r.path.startsWith('/_astro/'));
    expect(scripts.length).toBeGreaterThan(0);
    // 文章 HTML、Astro 内部资源、标注客户端与它的接口：此外不该有同源请求，也不该有失败。
    const unexpected = sameOrigin.filter((r) => !(r.path === ARTICLE || r.path.startsWith('/_astro/')
      || /^\/annotate(\.[0-9a-f]+)?\.js$/.test(r.path) || r.path.startsWith('/annotations') || r.path === '/events'));
    expect(unexpected).toEqual([]);
    const failed = sameOrigin.filter((r) => r.status >= 400 && !(r.path === ARTICLE && r.status === 503));
    expect(failed).toEqual([]);
    await expect(page.locator('.cref.empty[data-name="risk-score"]')).toHaveCSS('border-bottom-style', 'dashed');
  });

  await test.step('[[ ]] popup：concept 显示状态与边界；空 ref 显示还没有页；Esc 关闭', async () => {
    await page.locator('.cref[data-kind="concept"][data-name="confirm-card"]').click();
    const pop = page.locator('.pop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.k')).toHaveText('confirm-card收敛中');
    await expect(pop).toContainText('只在不可撤销的动作之前出现');
    await expect(pop).toContainText('用到它的文章：提交前确认');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);

    await page.locator('.cref.empty[data-name="risk-score"]').click();
    await expect(page.locator('.pop .k')).toHaveText('risk-score空 ref');
    await page.keyboard.press('Escape');

    await page.locator('.cref[data-kind="article"][data-name="takeover"]').click();
    await expect(page.locator('.pop .k')).toHaveText('用户接手文章');
  });

  await test.step('从 popup 进概念页：/<project>/concepts/<slug>/，列出用到它的文章', async () => {
    await page.locator('.cref[data-kind="concept"][data-name="confirm-card"]').click();
    await page.locator('.pop a.go').click();
    await expect(page).toHaveURL(`${E2E_BASE_URL}/e2e-project/concepts/confirm-card/`);
    await expect(page.locator('#article .prose h1')).toHaveText('confirm-card');
    await expect(page.locator('#used-by')).toContainText('提交前确认');
  });

  await test.step('/<project>/llms.txt 与 project 首页', async () => {
    const llms = await request.get('/e2e-project/llms.txt');
    expect(llms.status()).toBe(200);
    expect(llms.headers()['content-type']).toContain('text/plain');
    const text = await llms.text();
    expect(text.startsWith('# E2E Project\n')).toBe(true);
    expect(text).toContain('- [[commit-confirm]] 提交前确认（/e2e-project/commit-confirm/）');
    expect(text).toContain('- risk-score：提交前确认');

    await page.goto('/e2e-project/');
    await expect(page.locator('#empty-refs [data-empty-ref]')).toHaveText(['risk-score提交前确认']);
  });

  await test.step('原有路由不受影响：registry、/sites/、未登记首段、工作台', async () => {
    const registry = await (await request.get('/registry')).json();
    expect(registry.entries.map((e) => e.id)).not.toContain('e2e-project');
    expect((await request.get('/sites/e2e-dir/doc.html')).status()).toBe(200);
    const stray = await request.get('/not-a-project/x/', { headers: { accept: 'text/html' } });
    expect(stray.status()).not.toBe(503);
    expect(await stray.text()).not.toContain('data-site-state');

    await page.goto('/index.html');
    await page.waitForFunction(() => window.workbench && window.pinpoint);
    await expect(page.locator('#wbpages [data-vpage="e2e-mixed"]')).toBeVisible();
    await expect(page.locator('#wbpages [data-vpage="e2e-project"]')).toHaveCount(0);
  });

  await test.step('画布深链 /?page=&section= 照旧落到那个 section', async () => {
    await page.goto('/index.html?page=e2e-ios&section=settings');
    await page.waitForFunction(() => window.workbench && window.workbench.activePageId() === 'e2e-ios');
    await expect.poll(() => new URL(page.url()).searchParams.has('section')).toBe(false);
    await expect(page.locator('.wb-lib-item[data-ann-section="settings"]')).toHaveClass(/\bwb-sel\b/);
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
