import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR, E2E_UPSTREAM_ORIGIN } from './env.js';

// 阶段 4：registry `url` 条目经同源路径前缀代理（/sites/<id>/ → 目标 origin）
// 以 doc 壳内嵌进 workbench —— 绝对路径资源/API 由「HTML 重写 + 运行时重基
// bootstrap」兜底，侧栏直接驱动标注，bucket = entry id（与扩展注入同一个桶）。
// 上游 fixture：e2e/proxy-upstream.js（playwright.config.js 模块作用域起服）。

const BUCKET = path.join(E2E_DATA_DIR, 'e2e-proxy');
const FRAME = '#wb-board-panel [data-screen="index"] iframe.wb-doc-frame';

function bucketDocs() {
  if (!fs.existsSync(BUCKET)) return [];
  return fs.readdirSync(BUCKET).filter((name) => name.endsWith('.json'));
}

test.afterEach(() => {
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

test('url entry appears as a workbench page and renders live through the proxy', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);

  // Pages 单一列表：url 条目与 dir/file/模板页同列。阶段 7（Page 去类型化）：
  // 行不再有壳标/类型属性；类型信息下移到「内容」区产物条目的 tag —— url 条目
  // 的单屏合成板是「网页」产物（单网页条目页不坍缩，tag 照常显示）。
  const navBtn = page.locator('.wb-page[data-vpage="e2e-proxy"]');
  await expect(navBtn).toBeVisible();
  await navBtn.click();

  await page.getByRole('tab', {name:'大纲', exact:true}).click();
  const webRow = page.locator('#wbcontents [data-entry="index"]');
  await expect(webRow).toBeVisible();
  await expect(webRow.locator('.wb-entry-tag')).toHaveText('网页');

  // 合成单屏 doc 板：iframe 直指代理根 sites/e2e-proxy/（相对形，从 /index.html 解析）。
  const frame = page.locator(FRAME);
  await expect(frame).toHaveAttribute('src', /^sites\/e2e-proxy\/$/);
  const doc = page.frameLocator(FRAME);
  await expect(doc.locator('#title')).toHaveText('E2E proxy upstream');

  // URL 虚拟化：SPA 路由直读 location.pathname（无法 patch），bootstrap 在
  // 页面脚本之前把代理前缀改回应用路径（'/'）；运行时装机仍走重基。
  await expect.poll(() => page.evaluate((sel) => {
    const f = document.querySelector(sel);
    return f && f.contentWindow ? f.contentWindow.location.pathname : null;
  }, FRAME)).toBe('/');

  // 绝对路径形态全覆盖：HTML 重写（asset link/script）+ 运行时重基
  // （fetch/XHR/POST/EventSource/WebSocket）都打到上游。
  await expect(doc.locator('#api-result')).toHaveText('api-via-proxy');
  await expect(doc.locator('#xhr-result')).toHaveText('xhr-via-proxy');
  await expect(doc.locator('#post-result')).toHaveText('1');
  await expect(doc.locator('#sse-result')).toHaveText('sse-via-proxy');
  await expect(doc.locator('#ws-result')).toHaveText('ws-echo:hello');

  // CSS 里 url(/…) 也经代理（背景图地址被重写到前缀下）。
  await expect.poll(async () => doc.locator('#bg-probe').evaluate(
    (el) => el.ownerDocument.defaultView.getComputedStyle(el).backgroundImage,
  )).toContain('/sites/e2e-proxy/assets/bg.png');

  // 交互活着：按钮点击走页面自己的 JS。文档 1:1 满铺、左栏浮在文档上
  // （owner 2026-09-05 裁决），fixture 的按钮在左上角正好压在面板底下 ——
  // 被压住的正文靠收起面板来看，这里也照这条规则先收起再点。
  await page.locator('#wbside-toggle').click();
  await expect.poll(() => page.locator('#wbside').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(0);
  await doc.locator('#btn').click();
  await expect(doc.locator('#btn')).toHaveText('clicked');

  // 交叉验证：上游确实收到了这些请求（请求只可能经代理到达）。
  await expect.poll(async () => {
    const res = await page.request.get(`${E2E_UPSTREAM_ORIGIN}/__hits`);
    const hits = await res.json();
    return ['GET /assets/app.js', 'GET /api/data', 'GET /api/xhr', 'POST /api/echo']
      .every((h) => hits.includes(h));
  }).toBe(true);
});

test('proxied page annotates into the entry bucket, driven by the sidebar', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await page.locator('.wb-page[data-vpage="e2e-proxy"]').click();

  const frame = page.locator(FRAME);
  await expect(frame).toHaveAttribute('src', /^sites\/e2e-proxy\/$/);
  await expect(page.frameLocator(FRAME).locator('#title')).toHaveText('E2E proxy upstream');
  // 注：iframe 元素在装载/重绑间隙可能被瞬态替换，poll 回调一律 null 保护
  // （expect.poll 回调抛错不重试，直接失败）。
  const inFrame = (fn) => page.evaluate(({ sel, code }) => {
    const f = document.querySelector(sel);
    const w = f && f.contentWindow;
    if (!w || !w.pinpoint) return null;
    return Function('w', `return (${code})(w)`)(w);
  }, { sel: FRAME, code: fn });
  await expect.poll(() => inFrame('(w) => !!w.pinpoint')).toBe(true);

  // 注入确认：entry 标记 + 重基 bootstrap 都在 iframe 里。
  await expect.poll(() => inFrame(
    '(w) => [w.__pinpointEntry, w.__pinpointProxy && w.__pinpointProxy.prefix]',
  )).toEqual(['e2e-proxy', '/sites/e2e-proxy']);

  // 侧栏是唯一控制面（嵌入态藏起文档自己的浮条）：模式由侧栏开关驱动。
  await page.locator('#wbann-toggle').click();
  await expect.poll(() => inFrame('(w) => w.pinpoint.getState().mode')).toBe(true);

  // 点选 h1 标注（与 dir 条目同一套 ann-bridge 驱动）。
  expect(await inFrame(`(w) => {
    const d = w.document;
    const el = d.querySelector('#title');
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: Math.round(r.x + 8), clientY: Math.round(r.y + 8), button: 0 };
    el.dispatchEvent(new w.MouseEvent('mousedown', at));
    el.dispatchEvent(new w.MouseEvent('mouseup', at));
    const ta = d.querySelector('#ann-input');
    ta.value = 'url entry mark';
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    d.querySelector('#ann-save').click();
    return true;
  }`)).toBe(true);

  // bucket = entry id：与扩展注入同一个桶；URL 虚拟化后账本 path = 应用路径
  // （'/'），与扩展在目标 origin 上注入出的账本逐字节同 key。
  await expect.poll(() => bucketDocs().length).toBe(1);
  const doc = JSON.parse(fs.readFileSync(path.join(BUCKET, bucketDocs()[0]), 'utf8'));
  expect(doc.path).toBe('/');
  expect(doc.annotations.map((a) => a.content)).toContainEqual(expect.stringContaining('url entry mark'));

  // 弹出的标注列表能看到这条标注（2026-09-04：右栏取消常驻，点横条计数钮弹出）。
  await page.locator('#wbann-count').click();
  await expect(page.locator('#wbann-list .wb-ann-item')).toHaveCount(1);
  await expect(page.locator('#wbann-list')).toContainText('url entry mark');
});

test('annotate=off on a proxied page drops the annotate client but keeps proxy mechanics', async ({ page }) => {
  await page.goto('/sites/e2e-proxy/?annotate=off');
  await expect(page.locator('#title')).toHaveText('E2E proxy upstream');
  expect(await page.evaluate(() => !!window.__pinpoint)).toBe(false);
  expect(await page.evaluate(() => window.__pinpointEntry || null)).toBe(null);
  // bootstrap 与 URL 重写是代理机制的一部分：关掉它们会让运行时 API 指错 origin。
  expect(await page.evaluate(() => (window.__pinpointProxy && window.__pinpointProxy.prefix) || null)).toBe('/sites/e2e-proxy');
  // URL 虚拟化后地址栏是应用路径，annotate 参数不透给应用。
  await expect.poll(() => page.evaluate(() => location.pathname + location.search)).toBe('/');
  await expect(page.locator('#api-result')).toHaveText('api-via-proxy');
});

test('proxy rewrites 302 Location and Set-Cookie back under the prefix', async ({ page }) => {
  const redirect = await page.request.get('/sites/e2e-proxy/redirect', { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toBe('/sites/e2e-proxy/final');

  const cookie = await page.request.get('/sites/e2e-proxy/cookie');
  const setCookie = cookie.headers()['set-cookie'] || '';
  expect(setCookie).toContain('Path=/sites/e2e-proxy');
  expect(setCookie).not.toMatch(/Domain=/i);

  // 上游 404 与未知条目 404 都如实回传。
  expect((await page.request.get('/sites/e2e-proxy/nope')).status()).toBe(404);
  expect((await page.request.get('/sites/ghost-url/')).status()).toBe(404);
});
