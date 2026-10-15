import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_PORT, E2E_SITE_PORT } from './env.js';
import { ROOT } from './lib/cli.js';
import { proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';

// pp3：文章站点经 pinpoint 服务同源打开（docs/design.md「服务路由（pp3 文章）」）。
// 固件：registry 里常驻的 project 条目 e2e-project → e2e/project-site/（两篇文章、
// 两条 wiki、一个空 ref [[risk-score]]）。站点是真 Astro 开发服务器，由服务在第一个
// 文章请求时按需拉起（端口 E2E_SITE_PORT，playwright.config 设）。
//
// 一个用例走完：冷启动那一下只发生一次，拆成多个用例就只有第一个看得到「启动中」。

const ARTICLE = '/e2e-project/commit-confirm/';
// 这篇的画布页 id（docs/projects.md「画布视图」）：正文的画布卡片与“打开画布”都指向它。
const CANVAS_PAGE = 'e2e-project_commit-confirm';

const PROJECT_ROOT = path.join(ROOT, 'e2e', 'project-site');

const siteState = async (request) => (await (await request.get('/health')).json()).site;

test('文章站点：启动中页 → 文章，/_astro/ 资源、代理边界、[[ ]] popup、画布卡片、wiki 词条页、llms.txt', async ({ page, request }) => {
  // 冷启动 Astro（依赖预构建 + content layer 同步）在高负载机器上要几十秒。
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  // Astro 的 HMR websocket：记下地址和收到的帧（经 pinpoint 端口连上，不走直连站点端口的兜底）。
  const sockets = [];
  page.on('websocket', (ws) => {
    const record = { url: ws.url(), frames: [] };
    sockets.push(record);
    ws.on('framereceived', (frame) => record.frames.push(String(frame.payload)));
  });
  const sameOrigin = [];
  page.on('response', (res) => {
    const url = new URL(res.url());
    // main：文章页自己发的请求；否则是画布卡片 iframe（/api/frame 帧页）里发的。
    if (url.origin === E2E_BASE_URL) sameOrigin.push({ path: url.pathname, search: url.search, status: res.status(), type: res.request().resourceType(), main: res.frame() === page.mainFrame() });
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
    await waitNoReload(page);
    await expect(page.locator('#article .prose h1')).toHaveText('提交前确认');
    const site = await siteState(request);
    expect([site.state, site.external, site.warning]).toEqual(['ready', false, null]);
    // 启动中那几次 503 浏览器会记成「Failed to load resource」；从文章页起才算数。
    consoleErrors.length = 0;
  });

  await test.step('页面资源都在 /_astro/ 下且都成功；样式生效；标注客户端以文章页 id 为桶、只跑正文评论', async () => {
    await proseSettled(page);
    expect(await page.evaluate(() => window.__pinpointEntry)).toBe('e2e-project_commit-confirm');
    const scripts = sameOrigin.filter((r) => r.type === 'script' && r.path.startsWith('/_astro/'));
    expect(scripts.length).toBeGreaterThan(0);
    // 文章页自己：文章 HTML、Astro 内部资源、标注客户端与它的接口（卡片的未处理数也读 /annotations）。
    // 卡片 iframe：只有本篇画布页的帧，annotate=off；帧页里的资源（kit、article.css）只要求都成功。
    // 此外不该有同源请求，也不该有失败。
    const unexpected = sameOrigin.filter((r) => r.main && !(r.path === ARTICLE || r.path.startsWith('/_astro/')
      || /^\/annotate(\.[0-9a-f]+)?\.js$/.test(r.path) || r.path.startsWith('/annotations') || r.path === '/events'));
    expect(unexpected).toEqual([]);
    // 冷启动时 Astro 可能整页重载一次（依赖预构建），帧会请求两遍：比的是请求了哪些帧。
    // 正文里的图（<Figure>）也是 /api/frame：embed=figure（figure.spec.js 测它们的行为）。
    await expect.poll(() => [...new Set(sameOrigin.filter((r) => r.path === '/api/frame').map((r) => r.search))].sort()).toEqual([
      ...['card-plain', 'confirm-done', 'confirm-sheet', 'mixed-bare', 'mixed-phone'].map((f) => `?page=${CANVAS_PAGE}&screen=${f}&annotate=off&embed=card`),
      ...['message-flow', 'wait-sequence'].map((f) => `?page=${CANVAS_PAGE}&figure=${f}&embed=figure`),
    ].sort());
    const failed = sameOrigin.filter((r) => r.status >= 400 && !(r.path === ARTICLE && r.status === 503));
    expect(failed).toEqual([]);
    await expect(page.locator('.cref.empty[data-name="risk-score"]')).toHaveCSS('border-bottom-style', 'dashed');
    // 已有页的芯片只靠左侧圆点和强调字，不画下划线（owner 2026-10-15）；空 ref 的虚线是区分标记。
    const ref = page.locator('.cref:not(.empty)').first();
    await expect(ref).toHaveCSS('box-shadow', 'none');
    await expect(ref).toHaveCSS('text-decoration-line', 'none');
    await expect(ref).toHaveCSS('border-bottom-width', '0px');
  });

  await test.step('代理的来源与文件边界：Astro HMR 经 pinpoint 同源连上；别的网页连不上；docs/pinpoint 外的文件读不到', async () => {
    await expect.poll(() => sockets.some((s) => s.url.startsWith(`ws://127.0.0.1:${E2E_PORT}/_astro/?token=`)
      && s.frames.some((f) => f.includes('"connected"')))).toBe(true);
    expect(sockets.filter((s) => s.url.includes(`:${E2E_SITE_PORT}/`))).toEqual([]);

    // 别的来源（Astro 站点自己的直连端口，另一个 localhost 端口）拿着正确的 token 也连不上：
    // 代理回 403。落在 vite 客户端脚本上（纯文本，不带 CSP），页面自己不开 websocket。
    const client = await (await request.get('/_astro/@vite/client')).text();
    const token = client.match(/wsToken = "([^"]+)"/)[1];
    const other = await page.context().newPage();
    await other.goto(`http://127.0.0.1:${E2E_SITE_PORT}/_astro/@vite/client`);
    const outcome = await other.evaluate((url) => new Promise((resolve) => {
      const ws = new WebSocket(url, 'vite-hmr');
      ws.onopen = () => { ws.close(); resolve('open'); };
      ws.onerror = () => resolve('error');
    }), `ws://127.0.0.1:${E2E_PORT}/_astro/?token=${token}`);
    expect(outcome).toBe('error');
    await other.close();
    const post = await request.post(ARTICLE, { headers: { origin: 'https://evil.example' }, data: 'x' });
    expect(post.status()).toBe(403);

    // fs.allow 只放 project 的 docs/pinpoint/：project 根下的 README、仓库根的文件都是 403。
    expect((await request.get(`/_astro/@fs${PROJECT_ROOT}/docs/pinpoint/project.json`)).status()).toBe(200);
    for (const file of [path.join(PROJECT_ROOT, 'README.md'), path.join(ROOT, 'package.json'), path.join(ROOT, 'README.md')]) {
      expect((await request.get(`/_astro/@fs${file}`)).status(), file).toBe(403);
    }
  });

  await test.step('[[ ]] popup（悬停打开）：concept 显示状态与边界；空 ref 点击打开、显示还没有页；Esc 关闭', async () => {
    await page.locator('.cref[data-kind="concept"][data-name="confirm-card"]').hover();
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

    await page.locator('.cref[data-kind="article"][data-name="takeover"]').hover();
    await expect(page.locator('.pop .k')).toHaveText('用户接手文章');
  });

  // 卡片的 data 属性、节号、“打开画布”与顶栏的链接是构建产物，由 site/build.check.mjs
  // 的卡片断言钉住；链接打开后落到那一节由 article-canvas.spec.js 的 ?page=&section= 测
  // （2026-10-13 测试清理）。这里只留运行时才看得到的：帧加载后量过、尺寸、iframe 里的内容。
  await test.step('画布卡片：有 Canvas 的三节各一张，帧真渲染、加载后量过尺寸', async () => {
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pp-canvas]')).toHaveCount(3);
    await expect(page.locator('[data-pp-canvas-errors], [data-pp-missing], .cc-box .ph, .errors[role="alert"]')).toHaveCount(0);
    // 每帧加载后量过机壳 / 组件台（data-fitted），帧里的内容来自本篇组件。
    await page.locator('[data-pp-canvas][data-pp-section="mixed"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-pp-canvas] .cc-box[data-fitted="1"]')).toHaveCount(5);
    // 混排的一张卡：手机帧按手机缩到 158 宽；帧级 comp 的那一帧按自己的组件台量，不是手机比例。
    const mixed = page.locator('[data-pp-canvas][data-pp-section="mixed"]');
    await expect(mixed.locator('[data-screen="mixed-phone"] .cc-box')).toHaveClass(/\bphone\b/);
    await expect(mixed.locator('[data-screen="mixed-bare"]')).toHaveAttribute('data-shell', 'comp');
    await expect(mixed.locator('[data-screen="mixed-bare"] .cc-box')).toHaveClass(/\bnatural\b/);
    const sizes = await mixed.locator('.cc-box').evaluateAll((els) => els.map((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height]));
    expect(sizes[0][0]).toBe(158);
    expect(sizes[0][1]).toBeGreaterThan(300);
    expect(sizes[1][1]).toBeLessThan(sizes[1][0]); // 卡片比它高的宽：没被当成手机
    await expect(page.frameLocator('[data-pp-canvas] [data-screen="mixed-bare"] iframe').locator('.wb-comp-stage .e2e-confirm-card')).toBeVisible();
    for (const screen of ['confirm-sheet', 'confirm-done', 'card-plain', 'mixed-phone', 'mixed-bare']) {
      await expect(page.frameLocator(`[data-pp-canvas] [data-screen="${screen}"] iframe`).locator('.wb-screen').first()).toBeAttached();
    }
    await expect(page.frameLocator('[data-pp-canvas] [data-screen="card-plain"] iframe').locator('.e2e-confirm-card')).toBeVisible();
  });

  await test.step('从 popup 进 wiki 词条页：/<project>/wiki/<slug>/，列出用到它的文章；旧的 /concepts/ 地址 301 过来（ADR 0045）', async () => {
    await page.locator('.cref[data-kind="concept"][data-name="confirm-card"]').hover();
    await page.locator('.pop a.go').click();
    await expect(page).toHaveURL(`${E2E_BASE_URL}/e2e-project/wiki/confirm-card/`);
    await expect(page.locator('#article .prose h1')).toHaveText('confirm-card');
    await expect(page.locator('#used-by')).toContainText('提交前确认');
    const old = await request.get('/e2e-project/concepts/confirm-card/', { maxRedirects: 0 });
    expect(old.status()).toBe(301);
    expect(old.headers().location).toBe('/e2e-project/wiki/confirm-card/');
    expect((await request.get('/e2e-project/wiki/')).status()).toBe(200);
  });

  // llms.txt 与 project 首页的内容由 site/build.check.mjs 逐条断言；原有路由（registry、
  // /sites/、未登记首段）由 src/server/lib/article-routes.test.js「没登记的首段…」与
  // article-proxy.integration.test.js 测，左栏不列 project 由 article-canvas.spec.js；
  // 画布深链由 section-deeplink.spec.js（2026-10-13 测试清理）。这里只确认代理后的 llms.txt。
  await test.step('/<project>/llms.txt 经代理：200、text/plain', async () => {
    const llms = await request.get('/e2e-project/llms.txt');
    expect(llms.status()).toBe(200);
    expect(llms.headers()['content-type']).toContain('text/plain');
    expect((await llms.text()).startsWith('# E2E Project\n')).toBe(true);
  });

  await test.step('正文宽表：不用阴影提示，溢出时底部一条 6px 细滚动条（::-webkit-scrollbar 生效），不溢出时没有滚动条；首列仍钉在左边', async () => {
    // 固件 takeover 有两张表：六列长格的宽表（1440 下宽过正文栏）和两列短格的窄表。
    // 滚动条高 = offsetHeight − clientHeight；标准 scrollbar-width / scrollbar-color 不是 auto 时 Chromium 忽略 ::-webkit-scrollbar，高度就不是 6。
    // Playwright 默认带 --hide-scrollbars 启动 Chromium（滚动条一律 0 高），这一步单独起一个不带它的浏览器。
    const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
    const page = await browser.newPage({ baseURL: E2E_BASE_URL, viewport: { width: 1440, height: 900 } });
    try {
    await page.goto('/e2e-project/takeover/');
    await proseSettled(page);
    const tables = page.locator('#article .pp-table-scroll');
    await expect(tables).toHaveCount(2);
    const measure = (loc) => loc.evaluate((el) => {
      const cs = getComputedStyle(el);
      const first = getComputedStyle(el.querySelector('tbody td'));
      return {
        overflow: el.scrollWidth > el.clientWidth, bar: el.offsetHeight - el.clientHeight,
        bgImage: cs.backgroundImage, scrollbarWidth: cs.scrollbarWidth, scrollbarColor: cs.scrollbarColor,
        firstPosition: first.position, firstLeft: first.left, firstLine: first.boxShadow,
      };
    });
    const wide = await measure(tables.nth(0));
    expect(wide).toMatchObject({ overflow: true, bar: 6, bgImage: 'none', scrollbarWidth: 'auto', scrollbarColor: 'auto', firstPosition: 'sticky', firstLeft: '0px' });
    expect(wide.firstLine).toMatch(/-1px 0px 0px 0px inset$/);
    const narrow = await measure(tables.nth(1));
    expect(narrow).toMatchObject({ overflow: false, bar: 0, bgImage: 'none' });
    // 滚到最右，首列还在表格左缘。
    const pinned = await tables.nth(0).evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      return Math.round(el.querySelector('tbody td').getBoundingClientRect().left - el.getBoundingClientRect().left);
    });
    expect(pinned).toBe(0);
    } finally {
      await browser.close();
    }
  });

  await test.step('文章页顶栏（ADR 0044）：标签页标题只有文章标题；左边是回首页的“全部文章”，不显示 project 标题；project 是标题下的小标签', async () => {
    await page.goto(ARTICLE);
    await expect(page.locator('#article .prose h1')).toHaveText('提交前确认');
    await expect(page).toHaveTitle('提交前确认');
    const crumb = page.locator('[data-pp-crumb]');
    await expect(crumb.getByRole('link', { name: '全部文章' })).toHaveAttribute('href', '/');
    await expect(crumb).not.toContainText('E2E Project');
    await expect(page.locator('#article .prose .label')).toHaveCount(0);
    await expect(page.locator('#article [data-pp-project-tag]')).toHaveText('E2E Project');
    await expect(page.locator('#article [data-pp-project-tag]')).toHaveAttribute('href', '/e2e-project/');
  });

  await test.step('“画布视图”打开 /workbench/?page=<页 id>，画布装好', async () => {
    await page.locator('#btn-canvas').click();
    await page.waitForFunction((id) => window.workbench && window.workbench.activePageId() === id, CANVAS_PAGE);
    expect(new URL(page.url()).pathname).toBe('/workbench/');
    expect(new URL(page.url()).searchParams.get('page')).toBe(CANVAS_PAGE);
    await expect(page.locator('#wb-board-panel [data-screen="confirm-sheet"]')).toBeVisible();
  });

  await test.step('blog 首页 /：列出登记 project 的文章（标题、summary、project 标签、日期），标签进那个 project 的文章列表', async () => {
    await page.goto('/');
    await expect(page.locator('#article .prose h1')).toHaveText('全部文章');
    const item = page.locator('[data-pp-feed-item="e2e-project/commit-confirm"]');
    await expect(item.locator('.feed-title')).toHaveText('提交前确认');
    await expect(item.locator('.feed-title')).toHaveAttribute('href', ARTICLE);
    await expect(item.locator('.feed-summary')).toHaveText('付款与提交前，agent 停下来请用户确认。');
    await expect(item.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
    await expect(page.locator('[data-pp-feed-item="e2e-project/takeover"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.__pinpointEntry)).toBeUndefined();
    await item.locator('[data-pp-project-tag]').click();
    await expect(page).toHaveURL(`${E2E_BASE_URL}/e2e-project/`);
    await expect(page.locator('#article .prose h1')).toHaveText('E2E Project');
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
