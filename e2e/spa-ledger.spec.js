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
    // _seq.json 是 #n 的桶级计数器，不是账本（与服务端 listDocs 同一条规则），
    // 泄进来会把「恰好这些账本」的断言数多一个。
    if (!name.endsWith('.json') || name === '_seq.json') continue;
    out[name] = JSON.parse(fs.readFileSync(path.join(BUCKET, name), 'utf8'));
  }
  return out;
}

// 别的 spec（ppnt-cli 等）也在 bucket pinpoint 里落账本；这里先清一次再开跑，
// 否则「整个 bucket 恰好这两个文件」的断言数到别人的残余。
test.beforeEach(() => fs.rmSync(BUCKET, { recursive: true, force: true }));

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
  await page.waitForFunction(() => window.pinpoint);
}

async function setAnnotateMode(page, on) {
  await page.evaluate((v) => window.pinpoint.setMode(v), on);
}

/** 在标注模式下点选元素、写内容、保存（驱动方式同 workbench.spec.js）。 */
async function annotate(page, selector, text) {
  await page.locator(selector).click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('#ann-input').fill(text);
  await box.locator('#ann-close').click();
  await expect(box).toBeHidden();
}

/**
 * 等账本切换落地。WP2 之后 getState() 暴露 epoch/routing：epoch 前进且
 * routing 归位才算切换+hydrate 完成；老客户端没有这两个字段时退化为只等
 * URL 变化（后续断言仍会以真实原因失败）。
 */
async function waitRouteSettled(page, pathname, prevEpoch) {
  await page.waitForFunction(([path, epoch]) => {
    const st = window.pinpoint && window.pinpoint.getState ? window.pinpoint.getState() : {};
    if (typeof st.epoch !== 'number') return location.pathname === path;
    return location.pathname === path && st.epoch > epoch && !st.routing;
  }, [pathname, prevEpoch]);
}

async function currentEpoch(page) {
  return page.evaluate(() => {
    const st = window.pinpoint.getState();
    return typeof st.epoch === 'number' ? st.epoch : -1;
  });
}

test('SPA route change splits ledgers per pathname; hash-only change keeps the same ledger', async ({ page }) => {
  // hydrate 计数要从开页前挂上：hash 一拍靠「请求数不增」守不换账本。
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
  }).toEqual(['[@t:i1] home ann']);

  const epoch = await currentEpoch(page);
  await setAnnotateMode(page, false); // 标注模式下点击会被拦截为标选，切回交互再导航
  await page.locator('#to-a').click();
  await waitRouteSettled(page, '/e2e-spa/route-a', epoch);

  await setAnnotateMode(page, true);
  await annotate(page, '#route-a-el', 'route-a ann');
  await expect.poll(() => {
    const doc = docByPrefix('route-a_');
    return doc ? doc.annotations.map((a) => a.content) : null;
  }).toEqual(['[@t:i1] route-a ann']);

  // 各记各账：两个 key 的文件各自只有自己那条，selector 指向各自路由的元素。
  const docs = bucketDocs();
  expect(Object.keys(docs)).toHaveLength(2);
  const home = docByPrefix('spa-fixture.html_');
  const routeA = docByPrefix('route-a_');
  expect(home.annotations.map((a) => a.content)).toEqual(['[@t:i1] home ann']);
  expect(home.annotations[0].selector).toContain('home-el');
  expect(routeA.annotations).toHaveLength(1);
  expect(routeA.annotations[0].selector).toContain('route-a-el');

  // 只改 hash 不换路由：账本 key 不变，第二条仍进 route-a 那份文件，也不发新的
  // hydrate GET（原独立用例并入 —— 同一开页同一路由状态，只多标一条）。
  const hydratesBeforeHash = hydrateRequests.length;
  await page.evaluate(() => { location.hash = 'x'; });
  await annotate(page, '#route-a-el', 'route-a ann 2');
  await expect.poll(() => {
    const doc = docByPrefix('route-a_');
    return doc ? doc.annotations.map((a) => a.content) : null;
  }).toEqual(['[@t:i1] route-a ann', '[@t:i1] route-a ann 2']);
  expect(Object.keys(bucketDocs())).toHaveLength(2);
  expect(hydrateRequests.length).toBe(hydratesBeforeHash);
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
  }).toEqual(['[@t:i1] home ann']);
  await held.shift().continue();
  await expect.poll(() => {
    const doc = docByPrefix('route-a_');
    return doc ? doc.annotations.map((a) => a.content) : null;
  }).toEqual(['[@t:i1] route-a ann']);

  expect(Object.keys(bucketDocs())).toHaveLength(2);
  // 新账本的内存状态只有自己那条（旧响应被丢弃，没有 applyRemoteDoc/deferred 污染）。
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().countAll)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.map((m) => m.content)))
    .toEqual(['[@t:i1] route-a ann']);
});
