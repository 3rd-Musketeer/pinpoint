import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY } from './env.js';
import { closeSettled } from './ledger-settle.js';
import { waitNoReload } from './site-settle.js';

// HTML 帧（docs/projects.md“HTML 帧”）：文章画布上放整份 HTML 页面。
// 固件 e2e/html-site/（project e2e-html，文章 pages）：B 节两帧 HTML——本篇目录下的 long-page.html（很长，
// #deep-pill 在 y > 5000 处，宽窄屏各显示一行探针）和 project 根下的 shared/catalog.html（{ id, src } 写法，
// 样式和图片按它自己的目录取，里面有一个能点的按钮）；C 节一帧手机 JSX（phone-card）。
// project e2e-html 常驻在共享 registry 固件里（e2e/registry-fixture.js），指仓内固件，spec 只读不写。
// 站点：在 e2e-parallel 的 SITE_SPECS 里，和别的拉起站点的 spec 同组。
const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_ID = 'e2e-html_pages';
const ARTICLE_URL = '/e2e-html/pages/';
const BUCKET = path.join(E2E_DATA_DIR, PAGE_ID);
const DOC_FRAME = '#wb-board-panel [data-screen="long-page"] iframe.wb-doc-frame';

async function ppnt(args) {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY, PINPOINT_ORIGIN: E2E_BASE_URL },
      timeout: 150_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

const card = (page) => page.locator('[data-pp-canvas][data-pp-section="pages"]');
const cardFrame = (page, id) => card(page).locator(`.cc-frame[data-screen="${id}"] iframe`);
const overlay = (page) => page.locator('dialog[data-pp-overlay]');
const ovFrame = (page, id) => overlay(page).locator(`.ov-frame[data-screen="${id}"] iframe`);
/** iframe 的布局宽度（缩放之前的 CSS px，就是页面看到的视口宽）。 */
const layoutWidth = (locator) => locator.evaluate((el) => el.offsetWidth);
const innerWidth = (locator) => locator.evaluate((el) => el.contentWindow.innerWidth);

test.afterAll(() => {
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

test.afterEach(async ({ page }) => {
  await closeSettled(page);
});

test('文章页：HTML 帧的卡片按手机宽度出第一屏，资源按自己的目录取；切桌面；浮层里整页可滚、可交互、可换宽度', async ({ page, request }) => {
  test.setTimeout(240_000);
  // 站点冷启动时先回 503，等它就绪。
  await expect.poll(async () => (await request.get(ARTICLE_URL)).status(), { timeout: 150_000, intervals: [500] }).toBe(200);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(ARTICLE_URL);
  await expect(page.locator('#article .prose h1')).toHaveText('生成的页面', { timeout: 150_000 });
  await waitNoReload(page);

  await test.step('卡片：两帧 HTML 都是 390 宽的页面、只露第一屏，卡片头有“手机 / 桌面”，缺省手机', async () => {
    await expect(card(page).locator('[data-pp-width] [aria-pressed="true"]')).toHaveText('手机');
    for (const id of ['long-page', 'catalog']) {
      const frame = cardFrame(page, id);
      await expect(frame).toHaveAttribute('scrolling', 'no');
      await expect(frame).toHaveCSS('pointer-events', 'none');
      await expect.poll(() => innerWidth(frame)).toBe(390);
      await expect(card(page).locator(`.cc-frame[data-screen="${id}"] .cc-box`)).toHaveAttribute('data-fitted', '1');
    }
    const long = page.frameLocator('[data-pp-section="pages"] .cc-frame[data-screen="long-page"] iframe');
    await expect(long.locator('#width-probe-narrow')).toBeVisible();
    await expect(long.locator('#width-probe-wide')).toBeHidden();
    // 卡片里的帧不带标注客户端。
    expect(await cardFrame(page, 'long-page').evaluate((el) => !!el.contentWindow.pinpoint)).toBe(false);
    // project 根下的帧：样式和图片从 shared/ 自己的目录取到了。
    const cat = page.frameLocator('[data-pp-section="pages"] .cc-frame[data-screen="catalog"] iframe');
    await expect(cat.locator('body')).toHaveCSS('background-color', 'rgb(250, 247, 240)');
    await expect.poll(() => cat.locator('.cat-chip img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    // 卡片里只露第一屏：盒子高 = 844 × 卡片缩放。
    const box = await card(page).locator('.cc-frame[data-screen="long-page"] .cc-box').boundingBox();
    expect(Math.abs(box.height / box.width - 844 / 390)).toBeLessThan(0.02);
    // 同一张卡片外的手机 JSX 帧照旧。
    await expect(page.locator('[data-pp-section="app"] .cc-frame[data-screen="phone-card"] .cc-box')).toHaveClass(/\bphone\b/);
  });

  await test.step('切到桌面：iframe 的视口变成 1280，页面按宽屏排', async () => {
    await card(page).locator('[data-pp-width] [data-width="desktop"]').click();
    await expect(card(page).locator('[data-pp-width] [aria-pressed="true"]')).toHaveText('桌面');
    await expect.poll(() => innerWidth(cardFrame(page, 'long-page'))).toBe(1280);
    const long = page.frameLocator('[data-pp-section="pages"] .cc-frame[data-screen="long-page"] iframe');
    await expect(long.locator('#width-probe-wide')).toBeVisible();
    await card(page).locator('[data-pp-width] [data-width="phone"]').click();
    await expect.poll(() => innerWidth(cardFrame(page, 'long-page'))).toBe(390);
  });

  await test.step('浮层：两帧并排、真实大小、占满高度；页面在帧里整页滚到底', async () => {
    await card(page).locator('.cc-frame[data-screen="long-page"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('[data-ov-width]')).toBeVisible();
    await expect(overlay(page).locator('[data-ov-width] [aria-pressed="true"]')).toHaveText('手机');
    const frame = ovFrame(page, 'long-page');
    await expect(frame).not.toHaveAttribute('scrolling', 'no');
    await expect.poll(() => innerWidth(frame)).toBe(390);
    expect(await page.evaluate(() => window.pinpointOverlay.state().scale)).toBe(1);
    const strip = await overlay(page).locator('[data-ov-strip]').boundingBox();
    const shown = await frame.boundingBox();
    expect(shown.height).toBeGreaterThan(strip.height * 0.6);
    const catBox = await ovFrame(page, 'catalog').boundingBox();
    expect(Math.abs(catBox.y - shown.y)).toBeLessThan(2); // 并排
    const deep = await frame.evaluate((el) => {
      const pill = el.contentDocument.querySelector('#deep-pill');
      pill.scrollIntoView();
      return { scrollY: el.contentWindow.scrollY, top: pill.getBoundingClientRect().top, height: el.contentWindow.innerHeight };
    });
    expect(deep.scrollY).toBeGreaterThan(4000);
    expect(deep.top).toBeGreaterThanOrEqual(0);
    expect(deep.top).toBeLessThan(deep.height);
  });

  await test.step('浮层里的帧可以点；浮层头切桌面，卡片跟着换，iframe 不重载', async () => {
    const cat = page.frameLocator('[data-pp-overlay] .ov-frame[data-screen="catalog"] iframe');
    await cat.locator('.cat-btn').click();
    await expect(cat.locator('.cat-out')).toHaveText('已点');
    await overlay(page).locator('[data-ov-width] [data-width="desktop"]').click();
    await expect(overlay(page).locator('[data-ov-width] [aria-pressed="true"]')).toHaveText('桌面');
    await expect.poll(() => innerWidth(ovFrame(page, 'long-page'))).toBe(1280);
    await expect(cat.locator('.cat-out')).toHaveText('已点');
    // 页面按 1280 排；浮层放得下就真实大小，放不下按宽度缩，横向滚到别的帧。
    const scale = await page.evaluate(() => window.pinpointOverlay.state().scale);
    expect(scale).toBeLessThanOrEqual(1);
    expect(await layoutWidth(ovFrame(page, 'long-page'))).toBe(1280);
    expect(Math.abs((await ovFrame(page, 'long-page').boundingBox()).width - 1280 * scale)).toBeLessThan(2);
    await expect(card(page)).toHaveAttribute('data-doc-width', 'desktop');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => innerWidth(cardFrame(page, 'long-page'))).toBe(1280);
  });

  expect(pageErrors).toEqual([]);
});

test('画布视图：HTML 帧是文档条目，手机视口里标注 y > 5000 处的元素；ppnt comments 带编号列出，ppnt shot 拍得到', async ({ page }) => {
  test.setTimeout(180_000);
  fs.rmSync(BUCKET, { recursive: true, force: true });
  await page.goto(`/index.html?page=${PAGE_ID}&entry=long-page`);
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  const doc = page.frameLocator(DOC_FRAME);
  await expect(doc.locator('#top-title')).toHaveText('长页面');

  await test.step('窗口视口：文档铺满舞台（文章画布的节是 row 布局，文档形态里照样是一块屏）', async () => {
    const stage = await page.locator('#wbstage').boundingBox();
    const frame = await page.locator(DOC_FRAME).boundingBox();
    expect(Math.abs(frame.height - stage.height)).toBeLessThan(2);
  });

  await test.step('切手机视口：同一份文档装进手机屏，在舞台里居中，页面按窄屏排', async () => {
    await page.locator('#wbviewport [data-viewport="phone"]').click();
    await expect(page.locator('#wbviewport [data-viewport="phone"]')).toHaveAttribute('aria-pressed', 'true');
    // 深链打开的条目（不写记忆）在切视口重装后还是它。
    expect(await page.evaluate(() => window.workbench.activeEntryId())).toBe('long-page');
    await expect(page.locator(DOC_FRAME)).toHaveAttribute('src', /\/sites\/e2e-html_pages\/long-page\.html$/);
    await expect(doc.locator('#width-probe-narrow')).toBeVisible();
    const stage = await page.locator('#wbstage').boundingBox();
    const shell = await page.locator('#wb-board-panel .wb-screen:not([data-doc-hidden]) .wb-phone-doc').boundingBox();
    expect(shell.y).toBeGreaterThan(stage.y);
    expect(shell.y + shell.height).toBeLessThan(stage.y + stage.height);
    expect(Math.abs((shell.x + shell.width / 2) - (stage.x + stage.width / 2))).toBeLessThan(1);
  });

  await test.step('A 进标注，点深处的标签（y > 5000），账本落在这篇的桶、按路径分本', async () => {
    await page.waitForFunction((sel) => {
      const f = document.querySelector(sel);
      return !!(f && f.contentWindow && f.contentWindow.pinpoint);
    }, DOC_FRAME);
    await page.locator('#wbviewport [data-viewport="phone"]').focus();
    await page.keyboard.press('a');
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
    const y = await doc.locator('#deep-pill').evaluate((el) => el.getBoundingClientRect().top + scrollY);
    expect(y).toBeGreaterThan(5000);
    await doc.locator('#deep-pill').click();
    const box = doc.locator('#ann-box');
    await expect(box).toBeVisible();
    await box.locator('#ann-input').fill('标签换成灰色');
    await box.locator('#ann-close').click();
    await expect(box).toBeHidden();
    let row = null;
    await expect.poll(() => {
      const files = fs.existsSync(BUCKET) ? fs.readdirSync(BUCKET).filter((n) => n.endsWith('.json') && n !== '_seq.json') : [];
      for (const name of files) {
        const ledger = JSON.parse(fs.readFileSync(path.join(BUCKET, name), 'utf8'));
        const hit = (ledger.annotations || []).find((a) => /标签换成灰色/.test(a.content || ''));
        if (hit) row = { ...hit, path: ledger.path };
      }
      return !!row;
    }).toBe(true);
    expect(row.path).toBe(`/sites/${PAGE_ID}/long-page.html`);
    expect(row.targets[0].selector).toMatch(/#deep-pill$/);
    expect(row.targets[0].text).toBe('深处的标签');
    expect(row.rect[1]).toBeGreaterThan(5000);
  });

  await closeSettled(page);

  await test.step('ppnt comments 按帧分组、带编号 B1，摘录指源文件', async () => {
    const res = await ppnt(['comments', 'e2e-html/pages']);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain('## B1 · long-page');
    expect(res.stdout).toMatch(/\[#1\].*标签换成灰色/);
    expect(res.stdout).toMatch(/long-page\.html\n\s+\d+> .*id="deep-pill"/);
  });

  await test.step('ppnt shot B1 --marks：390 宽的整页，比 5000 高', async () => {
    const res = await ppnt(['shot', 'e2e-html/pages', 'B1', '--marks']);
    expect(res.code, res.stderr).toBe(0);
    const out = path.join(E2E_DATA_DIR, 'shot', PAGE_ID, 'long-page.png');
    expect(res.stdout).toContain(`B1 · long-page → ${out} · 390×`);
    const buffer = fs.readFileSync(out);
    expect(buffer.readUInt32BE(16)).toBe(390);
    expect(buffer.readUInt32BE(20)).toBeGreaterThan(5000);
  });
});
