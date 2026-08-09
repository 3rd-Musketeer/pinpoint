import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR } from './env.js';

// SPA 前端路由（pushState，不刷新页面）必须切换标注账本：pathname 变 → 标注记到
// 新页面的 key 名下。fixture 是 e2e/spa-fixture.html（不经 previews/，不受
// template-only 影响），初始 pathname /e2e/spa-fixture.html，两个按钮 pushState 到
// /e2e-spa/route-a|b 并换掉 #outlet 内容。

const BUCKET = path.join(E2E_DATA_DIR, 'pinpoint');

function bucketDocs() {
  if (!fs.existsSync(BUCKET)) return {};
  const out = {};
  for (const name of fs.readdirSync(BUCKET)) {
    if (name.endsWith('.json')) out[name] = JSON.parse(fs.readFileSync(path.join(BUCKET, name), 'utf8'));
  }
  return out;
}

function docByPrefix(prefix) {
  const docs = bucketDocs();
  const name = Object.keys(docs).find((n) => n.startsWith(prefix));
  return name ? docs[name] : null;
}

test.afterEach(() => {
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

async function openFixture(page) {
  await page.goto('/e2e/spa-fixture.html');
  await page.waitForFunction(() => window.iOSAnnotate);
}

async function setAnnotateMode(page, on) {
  await page.evaluate((v) => window.iOSAnnotate.setMode(v), on);
}

/** 在标注模式下点选元素、写内容、保存（驱动方式同 workbench.spec.js）。 */
async function annotate(page, selector, text) {
  await page.locator(selector).click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('textarea').fill(text);
  await box.locator('#ann-save').click();
  await expect(box).toBeHidden();
}

/**
 * 等账本切换落地。WP2 之后 getState() 暴露 epoch/routing：epoch 前进且
 * routing 归位才算切换+hydrate 完成；老客户端没有这两个字段时退化为只等
 * URL 变化（后续断言仍会以真实原因失败）。
 */
async function waitRouteSettled(page, pathname, prevEpoch) {
  await page.waitForFunction(([path, epoch]) => {
    const st = window.iOSAnnotate && window.iOSAnnotate.getState ? window.iOSAnnotate.getState() : {};
    if (typeof st.epoch !== 'number') return location.pathname === path;
    return location.pathname === path && st.epoch > epoch && !st.routing;
  }, [pathname, prevEpoch]);
}

async function currentEpoch(page) {
  return page.evaluate(() => {
    const st = window.iOSAnnotate.getState();
    return typeof st.epoch === 'number' ? st.epoch : -1;
  });
}

test('SPA route change splits annotations into per-pathname ledgers', async ({ page }) => {
  await openFixture(page);
  await setAnnotateMode(page, true);
  await annotate(page, '#home-el', 'home ann');
  await expect.poll(() => {
    const doc = docByPrefix('spa-fixture.html_');
    return doc ? doc.annotations.map((a) => a.content) : null;
  }).toEqual(['home ann']);

  const epoch = await currentEpoch(page);
  await setAnnotateMode(page, false); // 标注模式下点击会被拦截为标选，切回交互再导航
  await page.locator('#to-a').click();
  await waitRouteSettled(page, '/e2e-spa/route-a', epoch);

  await setAnnotateMode(page, true);
  await annotate(page, '#route-a-el', 'route-a ann');
  await expect.poll(() => {
    const doc = docByPrefix('route-a_');
    return doc ? doc.annotations.map((a) => a.content) : null;
  }).toEqual(['route-a ann']);

  // 各记各账：两个 key 的文件各自只有自己那条，selector 指向各自路由的元素。
  const docs = bucketDocs();
  expect(Object.keys(docs)).toHaveLength(2);
  const home = docByPrefix('spa-fixture.html_');
  const routeA = docByPrefix('route-a_');
  expect(home.annotations.map((a) => a.content)).toEqual(['home ann']);
  expect(home.annotations[0].selector).toContain('home-el');
  expect(routeA.annotations).toHaveLength(1);
  expect(routeA.annotations[0].selector).toContain('route-a-el');
});

test('in-flight old-ledger save response cannot pollute the new ledger', async ({ page }) => {
  // 拦截所有 /save 并压住响应，手动控制两个账本写盘的先后顺序。
  const held = [];
  await page.route('**/save', (route) => { held.push(route); });

  await openFixture(page);
  await setAnnotateMode(page, true);
  await annotate(page, '#home-el', 'home ann');
  await expect.poll(() => held.length).toBe(1); // 旧账本 save 在途，响应未回

  const epoch = await currentEpoch(page);
  await setAnnotateMode(page, false);
  await page.locator('#to-a').click();
  await waitRouteSettled(page, '/e2e-spa/route-a', epoch);

  await setAnnotateMode(page, true);
  await annotate(page, '#route-a-el', 'route-a ann');
  await expect.poll(() => held.length).toBe(2); // 新账本 save 也在途

  // 旧账本响应后到：不得把旧 doc 写进新账本状态（epoch 护栏）。
  await held.shift().continue();
  await expect.poll(() => {
    const doc = docByPrefix('spa-fixture.html_');
    return doc ? doc.annotations.map((a) => a.content) : null;
  }).toEqual(['home ann']);
  await held.shift().continue();
  await expect.poll(() => {
    const doc = docByPrefix('route-a_');
    return doc ? doc.annotations.map((a) => a.content) : null;
  }).toEqual(['route-a ann']);

  expect(Object.keys(bucketDocs())).toHaveLength(2);
  // 新账本的内存状态只有自己那条（旧响应被丢弃，没有 applyRemoteDoc/deferred 污染）。
  await expect.poll(() => page.evaluate(() => window.iOSAnnotate.getState().countAll)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.iOSAnnotate.marks.map((m) => m.content)))
    .toEqual(['route-a ann']);
});

test('hash-only change keeps the same ledger (no re-hydrate, no new file)', async ({ page }) => {
  const hydrateRequests = [];
  page.on('request', (req) => {
    if (req.method() === 'GET' && req.url().includes('/annotations/')) hydrateRequests.push(req.url());
  });

  await openFixture(page);
  await setAnnotateMode(page, true);
  await annotate(page, '#home-el', 'home ann');
  await expect.poll(() => {
    const doc = docByPrefix('spa-fixture.html_');
    return doc ? doc.annotations.map((a) => a.content) : null;
  }).toEqual(['home ann']);
  const hydratesBeforeHash = hydrateRequests.length;

  await page.evaluate(() => { location.hash = 'x'; });
  // 账本不变：hash 后写的第二条仍落在同一个 key 的文件里。
  await annotate(page, '#home-el', 'home ann 2');
  await expect.poll(() => {
    const doc = docByPrefix('spa-fixture.html_');
    return doc ? doc.annotations.map((a) => a.content) : null;
  }).toEqual(['home ann', 'home ann 2']);

  expect(Object.keys(bucketDocs())).toHaveLength(1);
  expect(hydrateRequests.length).toBe(hydratesBeforeHash);
});
