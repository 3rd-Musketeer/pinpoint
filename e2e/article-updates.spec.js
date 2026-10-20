import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { test, expect } from './lib/fixtures.js';
import { openOwnerArticle, openOwnerStaticArticle, ownerCleanup, seedOwner } from './lib/owner-flows.js';
import { OWNER_SOURCE, OWNER_STATIC_SOURCE, OWNER_UPDATE_SOURCE } from './lib/owner-fixture.js';
import { E2E_BASE_URL, E2E_DATA_DIR } from './env.js';

for (const recovery of ['SSE 重连', 'persisted pageshow']) test(`R3：${recovery} 补取断流期间的稿，文章文档不重装`, async ({ page }) => {
  test.setTimeout(180_000);
  let blocked = false;
  const streams = new Set();
  const proxy = http.createServer((req, res) => {
    if (blocked) { res.writeHead(503); res.end(); return; }
    const upstream = http.get(`${E2E_BASE_URL}/events`, incoming => {
      res.writeHead(incoming.statusCode, { ...incoming.headers, 'access-control-allow-origin': '*' });
      incoming.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    streams.add(res);
    res.on('close', () => { streams.delete(res); upstream.destroy(); });
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const files = ['s', 'd'].map(id => path.join(OWNER_UPDATE_SOURCE, `${id}.jsx`));
  const originals = files.map(file => fs.readFileSync(file, 'utf8'));
  try {
    await page.routeWebSocket(/\/_astro\//, () => {});
    await page.route('**/events', route => route.continue({ url: `http://127.0.0.1:${proxy.address().port}/events` }));
    await page.addInitScript(() => {
      window.__opens = window.__errors = 0;
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(...args) {
          super(...args);
          this.addEventListener('open', () => window.__opens++);
          this.addEventListener('error', () => window.__errors++);
        }
      };
    });
    await page.goto('/e2e-owner/updates/');
    await expect(page.locator('#article h1')).toHaveText('更新通知验收', { timeout: 150_000 });
    const shadow = page.locator('[data-screen="s"] .cc-shadow [data-update]');
    const fallback = page.frameLocator('[data-screen="d"] iframe').locator('[data-update]');
    await expect(shadow).toHaveText('s OLD', { timeout: 30_000 });
    await expect(fallback).toHaveText('d OLD');
    await page.waitForFunction(() => window.__opens > 0);
    await page.evaluate(() => { window.__sameDocument = true; });
    const opens = await page.evaluate(() => window.__opens);
    blocked = true;
    if (recovery === 'persisted pageshow') {
      // 检验 persisted 事件处理路径；不冒充浏览器真实进入了 bfcache。
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    } else {
      for (const stream of streams) stream.destroy();
      await page.waitForFunction(() => window.__errors > 0);
    }
    files.forEach((file, i) => fs.writeFileSync(file, originals[i].replace('OLD', 'RECOVERED')));
    for (const id of ['s', 'd']) await expect.poll(() => {
      try { return fs.readFileSync(path.join(E2E_DATA_DIR, 'dist/e2e-owner_updates', `${id}.html`), 'utf8'); }
      catch { return ''; }
    }, { timeout: 30_000 }).toContain(`${id} RECOVERED`);
    blocked = false;
    if (recovery === 'persisted pageshow') await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(n => window.__opens > n, opens, { timeout: 30_000 });
    await expect(shadow).toHaveText('s RECOVERED', { timeout: 30_000 });
    await expect(fallback).toHaveText('d RECOVERED', { timeout: 30_000 });
    expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  } finally {
    await ownerCleanup(page);
    files.forEach((file, i) => fs.writeFileSync(file, originals[i]));
    for (const stream of streams) stream.destroy();
    await new Promise(resolve => proxy.close(resolve));
  }
});

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

test('R5：完成通知更新原生 HTML iframe，保留桌面宽度与未加载帧的懒加载', async ({ page }) => {
  test.setTimeout(180_000);
  const files = ['h', 'late'].map(id => path.join(OWNER_UPDATE_SOURCE, `${id}.html`));
  const originals = files.map(file => fs.readFileSync(file, 'utf8'));
  let lateRequests = 0;
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.searchParams.get('screen') === 'late' || url.pathname.endsWith('/late.html')) lateRequests++;
  });
  try {
    await page.routeWebSocket(/\/_astro\//, () => {});
    await page.addInitScript(() => {
      window.__updates = [];
      document.addEventListener('pp:preview-update', e => window.__updates.push(e.detail));
    });
    await page.goto('/e2e-owner/updates/');
    await expect(page.locator('#article h1')).toHaveText('更新通知验收', { timeout: 150_000 });
    const frame = page.locator('[data-screen="h"] iframe');
    const text = frame.contentFrame().locator('[data-update]');
    await expect(text).toHaveText('h OLD', { timeout: 30_000 });
    await page.locator('[data-pp-section="live"] [data-width="desktop"]').click();
    await expect(frame).toHaveCSS('width', '1280px');
    await page.evaluate(() => { window.__sameDocument = true; });
    expect(lateRequests).toBe(0);
    files.forEach((file, i) => fs.writeFileSync(file, originals[i].replace('OLD', 'LIVE')));
    await page.waitForFunction(() => window.__updates.some(data => data.screens?.includes('h')), null, { timeout: 30_000 });
    await expect(text).toHaveText('h LIVE', { timeout: 30_000 });
    await expect(frame).toHaveCSS('width', '1280px');
    await expect(frame).toHaveAttribute('loading', 'lazy');
    expect(lateRequests).toBe(0);
    await page.locator('[data-screen="late"]').scrollIntoViewIfNeeded();
    await expect(page.frameLocator('[data-screen="late"] iframe').locator('[data-update]')).toHaveText('late LIVE');
    expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  } finally {
    await ownerCleanup(page);
    files.forEach((file, i) => fs.writeFileSync(file, originals[i]));
  }
});
