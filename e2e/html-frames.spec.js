import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_DATA_DIR } from './env.js';
import { pageKeyFromPathname } from '../src/shared/annotate-page-key.js';
import { closeSettled } from './ledger-settle.js';
import { ppntResult } from './lib/cli.js';
import { diffPixelRatio } from './png-probe.js';
import { openOutline, openWorkbench, stageForm } from './lib/workbench.js';
import { waitNoReload } from './site-settle.js';

// HTML 帧（docs/projects.md“HTML 帧”）：文章画布上放整份 HTML 页面。
// 固件 e2e/html-site/（project e2e-html，文章 pages）：B 节三帧 HTML——本篇目录下的 long-page.html（很长，
// #deep-pill 在 y > 5000 处，宽窄屏各显示一行探针）、project 根下的 shared/catalog.html（{ id, src } 写法，
// 样式和图片按它自己的目录取，里面有一个能点的按钮）、source kit 下的 widget.html（kit:widget.html，
// kit 在 project.json 的 sources 里指 e2e/html-source/）；C 节一帧手机 JSX（phone-card）和一张 HTML 卡片
// catalog-2（同一份 shared/catalog.html，和 catalog 共用一本账本），iOS 帧与 HTML 帧混排。
// project e2e-html 常驻在共享 registry 固件里（e2e/registry-fixture.js），指仓内固件，spec 只读不写。
// 站点：在 e2e-parallel 的 SITE_SPECS 里，和别的拉起站点的 spec 同组。
const PAGE_ID = 'e2e-html_pages';
const ARTICLE_URL = '/e2e-html/pages/';
const BUCKET = path.join(E2E_DATA_DIR, PAGE_ID);
// 文章画布上的 HTML 卡片与它的页面浮层（一篇文章一张画布，2026-10-15）。
const CARD = (id) => `#wb-board-panel .wb-screen[data-html-card][data-screen="${id}"]`;
const PAGE_FRAME = '#wb-board-panel [data-page-screen="long-page"] iframe.wb-doc-frame';
const ppnt = (args) => ppntResult(args, { timeout: 150_000 });

const card = (page) => page.locator('[data-pp-canvas][data-pp-section="pages"]');
const cardFrame = (page, id) => card(page).locator(`.cc-frame[data-screen="${id}"] iframe`);
const overlay = (page) => page.locator('dialog[data-pp-overlay]');
const innerWidth = (locator) => locator.evaluate((el) => el.contentWindow.innerWidth);

test.afterAll(() => {
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

test.afterEach(async ({ page }) => {
  await closeSettled(page);
});

test('文章页：HTML 帧的卡片按手机宽度出第一屏，资源按自己的目录取；切桌面；悬停帧不盖内容；点帧开整张画布', async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  // 站点冷启动时先回 503，等它就绪。
  await expect.poll(async () => (await request.get(ARTICLE_URL)).status(), { timeout: 150_000, intervals: [500] }).toBe(200);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(ARTICLE_URL);
  await expect(page.locator('#article .prose h1')).toHaveText('生成的页面', { timeout: 150_000 });
  await waitNoReload(page);

  await test.step('卡片：HTML 帧都是 402 宽的页面、只露第一屏，卡片头有“手机 / 桌面”，缺省手机', async () => {
    await expect(card(page).locator('[data-pp-width] [aria-pressed="true"]')).toHaveText('手机');
    for (const id of ['long-page', 'catalog', 'widget']) {
      const frame = cardFrame(page, id);
      await expect(frame).toHaveAttribute('scrolling', 'no');
      await expect(frame).toHaveCSS('pointer-events', 'none');
      await expect.poll(() => innerWidth(frame)).toBe(402);
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
    // project.json 登记的 source 下的帧（kit:widget.html）：地址在 @source/kit/ 下，样式按它自己的目录取。
    await expect(cardFrame(page, 'widget')).toHaveAttribute('src', /annotate=off/);
    const widget = page.frameLocator('[data-pp-section="pages"] .cc-frame[data-screen="widget"] iframe');
    await expect(widget.locator('#widget-title')).toHaveText('小组件');
    await expect(widget.locator('body')).toHaveCSS('background-color', 'rgb(236, 244, 250)');
    expect(await cardFrame(page, 'widget').evaluate((el) => el.contentWindow.location.pathname)).toBe('/sites/e2e-html_pages/@source/kit/widget.html');
    // 卡片里只露第一屏：盒子高 = 874 × 卡片缩放。
    const box = await card(page).locator('.cc-frame[data-screen="long-page"] .cc-box').boundingBox();
    expect(Math.abs(box.height / box.width - 874 / 402)).toBeLessThan(0.02);
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
    await expect.poll(() => innerWidth(cardFrame(page, 'long-page'))).toBe(402);
  });

  await test.step('悬停帧：帧内容和帧名照旧画出来，盒子不挪，悬停只多一道描边', async () => {
    // owner 2026-10-15：悬停 project 根下的 HTML 帧，整块变成浅绿空框、帧名不见（正文链接的 hover 底色落在盖满整帧的 .cc-hit 上）。
    // HTML 帧和手机 JSX 帧都查；比的是悬停前后这块区域画出来的像素，不只看样式。
    for (const [section, id] of [['pages', 'catalog'], ['app', 'phone-card']]) {
      const fig = page.locator(`[data-pp-canvas][data-pp-section="${section}"] .cc-frame[data-screen="${id}"]`);
      const box = fig.locator('.cc-box');
      const cap = fig.locator('.cap');
      await expect(box).toHaveAttribute('data-fitted', '1');
      await fig.scrollIntoViewIfNeeded();
      await page.mouse.move(2, 2);
      await expect(box).toHaveCSS('outline-style', 'none');
      const rects = async () => ({ box: await box.boundingBox(), cap: await cap.boundingBox() });
      const pad = (r) => ({ x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 });
      const before = await rects();
      const beforeBox = await page.screenshot({ clip: before.box });
      const beforeCap = await page.screenshot({ clip: before.cap });
      const figRect = await fig.boundingBox();
      fs.writeFileSync(testInfo.outputPath(`card-hover-${id}-before.png`), await page.screenshot({ clip: pad(figRect) }));

      await page.mouse.move(before.box.x + before.box.width / 2, before.box.y + before.box.height / 2);
      await expect(box).toHaveCSS('outline-style', 'solid');
      fs.writeFileSync(testInfo.outputPath(`card-hover-${id}-after.png`), await page.screenshot({ clip: pad(figRect) }));
      expect(await rects()).toEqual(before);
      // 点击层只接点击，不画东西。
      await expect(fig.locator('.cc-hit')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(cap.locator('b')).toHaveText(id);
      expect(await diffPixelRatio(page.context(), beforeBox, await page.screenshot({ clip: before.box }))).toBeLessThan(0.01);
      expect(await diffPixelRatio(page.context(), beforeCap, await page.screenshot({ clip: before.cap }))).toBeLessThan(0.01);
    }
    await page.mouse.move(2, 2);
  });

  await test.step('点卡片里的 HTML 帧：文章上开整张画布（嵌入版工作台），落到这一节；卡片的宽度切换不进浮层', async () => {
    await card(page).locator('.cc-frame[data-screen="long-page"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    expect(decodeURIComponent(new URL(page.url()).hash)).toBe('#canvas=pages&frame=long-page');
    await expect(overlay(page).locator('iframe.ov-canvas')).toHaveAttribute('src', `/workbench/?page=${PAGE_ID}&section=pages&embed=overlay`);
    await expect(overlay(page).locator('[data-ov-width], .ov-frame')).toHaveCount(0);
    const canvas = page.frameLocator('[data-pp-overlay] iframe.ov-canvas');
    await expect(canvas.locator('#wb-board-panel [data-screen="long-page"]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.pinpointOverlay.state()?.landing), { timeout: 60_000 }).toBe('section');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    // 卡片的宽度照旧是卡片自己的。
    await expect(card(page)).toHaveAttribute('data-doc-width', 'phone');
  });

  expect(pageErrors).toEqual([]);
});

test('画布视图：一篇文章一张画布，HTML 帧是白底卡片；双击开页面浮层，手机视口里标注 y > 5000 处的元素，卡片显示本页标注数', async ({ page }) => {
  test.setTimeout(180_000);
  fs.rmSync(BUCKET, { recursive: true, force: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page, `page=${PAGE_ID}`);
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled()), { timeout: 30_000 }).toBe(true);
  const stage = page.locator('#wbstage');
  const scrollOf = () => stage.evaluate((el) => [Math.round(el.scrollLeft), Math.round(el.scrollTop)]);

  await test.step('一张画布：画布条目，没有文档条目的步进和视口两段；四张 HTML 卡片按窗口宽 1280 装第一屏，C 节手机帧和卡片混排，预览不接指针、不带标注客户端', async () => {
    expect(await page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
    expect(await stageForm(page)).toBe('ios');
    await expect(page.locator('#wbentry-nav')).toHaveCount(0);
    await expect(page.locator('#wbviewport')).toHaveCount(0);
    for (const id of ['long-page', 'catalog', 'widget', 'catalog-2']) {
      const frame = page.locator(`${CARD(id)} iframe.wb-html-card-frame`);
      await expect(frame).toHaveCSS('pointer-events', 'none');
      await expect(frame).toHaveAttribute('src', /annotate=off/);
      await expect.poll(() => innerWidth(frame)).toBe(1280);
      const box = await page.locator(`${CARD(id)} .wb-html-card`).boundingBox();
      expect(Math.abs(box.height / box.width - 800 / 1280)).toBeLessThan(0.01);
      // 卡片在画布上看得见（不是收起的文档条目）。
      expect(box.width).toBeGreaterThan(100);
    }
    expect(await page.locator(`${CARD('long-page')} iframe`).evaluate((el) => !!el.contentWindow.pinpoint)).toBe(false);
    await expect(page.frameLocator(`${CARD('long-page')} iframe`).locator('#width-probe-wide')).toBeVisible();
    // 页面浮层先不装：iframe 只有 data-src。
    await expect(page.locator(PAGE_FRAME)).not.toHaveAttribute('src', /./);
    // 混排：C 节里手机帧（C1）和 HTML 卡片（C2）在同一行。
    const phone = await page.locator('.wb-screen[data-screen="phone-card"] .ios-stage').boundingBox();
    const mixed = await page.locator(`${CARD('catalog-2')} .wb-html-card`).boundingBox();
    expect(mixed.x).toBeGreaterThan(phone.x + phone.width - 1);
    expect(Math.abs(mixed.y - phone.y)).toBeLessThan(phone.height);
    // 没有 tab 条（一篇一张、没有 tab；owner 2026-10-15“孤儿 tab”）：大纲钮在横条里。
    await expect(page.locator('#wbtabbar')).toHaveCount(0);
    await expect(page.locator('#wbstrip #wbstrip-outline')).toHaveCount(1);
    // 大纲：HTML 帧和手机帧一起在帧树里（B1–B3、C1–C2），没有文档条目行。
    await openOutline(page);
    await expect(page.locator('#wboutline-pop [data-ol-frame]')).toHaveText([/B1/, /B2/, /B3/, /C1/, /C2/]);
    await expect(page.locator('#wboutline-pop [data-entry]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#wboutline-pop')).toHaveCount(0);
  });

  await test.step('在卡片上拖：平移画布，不打开页面；单击选中这一帧', async () => {
    const box = await page.locator(`${CARD('long-page')} .wb-html-card`).boundingBox();
    const before = await scrollOf();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    const after = await scrollOf();
    expect(after[0] - before[0]).toBeGreaterThan(120);
    expect(after[1] - before[1]).toBeGreaterThan(40);
    expect(await page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
    const card = await page.locator(`${CARD('long-page')} .wb-html-card`).boundingBox();
    await page.mouse.click(card.x + 40, card.y + 40);
    await expect(page.locator(CARD('long-page'))).toHaveClass(/\bwb-sel\b/);
  });

  let canvasAt = null;
  await test.step('双击卡片：开这一页的完整页面（文档形态铺满舞台），左上角“← 画布”；Esc 关，回到双击前的位置', async () => {
    canvasAt = await scrollOf();
    await page.locator(`${CARD('long-page')} .wb-html-card`).dblclick({ position: { x: 40, y: 40 } });
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('long-page');
    expect(await stageForm(page)).toBe('html');
    await expect(page.locator('#wbpage-close')).toBeVisible();
    await expect(page.locator('#wbback')).toHaveCount(0);
    await expect(page.locator(PAGE_FRAME)).toHaveAttribute('src', '/sites/e2e-html_pages/long-page.html');
    await expect(page.frameLocator(PAGE_FRAME).locator('#top-title')).toHaveText('长页面');
    const stageBox = await stage.boundingBox();
    const frame = await page.locator(PAGE_FRAME).boundingBox();
    expect(Math.abs(frame.height - stageBox.height)).toBeLessThan(2);
    // 浮层里能滚：页面自己滚到深处。
    await page.frameLocator(PAGE_FRAME).locator('#deep-pill').scrollIntoViewIfNeeded();
    expect(await page.locator(PAGE_FRAME).evaluate((el) => el.contentWindow.scrollY)).toBeGreaterThan(4000);
    // 焦点在工作台上按 Esc。
    await page.locator('#wbpage-close').focus();
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
    expect(await stageForm(page)).toBe('ios');
    await expect(page.locator('#wbpage-close')).toHaveCount(0);
    await expect.poll(scrollOf).toEqual(canvasAt);
  });

  await test.step('页面浮层里横条也有大纲钮：点另一帧，关页面浮层回画布并聚焦到那一帧', async () => {
    await page.locator(`${CARD('long-page')} .wb-html-card`).dblclick({ position: { x: 40, y: 40 } });
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('long-page');
    await expect(page.locator('#wbtabbar')).toHaveCount(0);
    await expect(page.locator('#wbstrip #wbstrip-outline')).toHaveCount(1);
    await openOutline(page);
    await expect(page.locator('#wboutline-pop [data-ol-frame]')).toHaveText([/B1/, /B2/, /B3/, /C1/, /C2/]);
    await page.locator('#wboutline-pop [data-ol-frame="widget"]').click();
    await expect(page.locator('#wboutline-pop')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
    expect(await stageForm(page)).toBe('ios');
    await expect(page.locator('#wbpage-close')).toHaveCount(0);
    await expect(page.locator(CARD('widget'))).toHaveClass(/\bwb-sel\b/);
    // 聚焦：这张卡片落在舞台里、横条上方。
    await expect.poll(async () => {
      const box = await page.locator(`${CARD('widget')} .wb-html-card`).boundingBox();
      const st = await stage.boundingBox();
      const strip = await page.locator('#wbstrip').boundingBox();
      return !!box && box.x >= st.x && box.x + box.width <= st.x + st.width && box.y >= st.y && box.y + box.height <= strip.y;
    }).toBe(true);
  });

  await test.step('页面浮层切手机：同一份页面装进手机屏、居中；回画布后这张卡片按手机宽 402 摆', async () => {
    await page.locator(`${CARD('long-page')} .wb-html-card`).dblclick({ position: { x: 40, y: 40 } });
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('long-page');
    await expect(page.frameLocator(PAGE_FRAME).locator('html')).toHaveCount(1);
    expect(await page.frameLocator(PAGE_FRAME).locator('html').evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('auto');
    await page.locator('#wbviewport [data-viewport="phone"]').click();
    await expect(page.locator('#wbviewport [data-viewport="phone"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.workbench.activeEntryId())).toBe('long-page');
    await expect(page.frameLocator(PAGE_FRAME).locator('#width-probe-narrow')).toBeVisible();
    // 手机屏里的文档根不出滚动条（phone-doc-scrollbar.js；量宽度的那条在 viewport.spec.js）。
    const rootBarStyle = () => page.frameLocator(PAGE_FRAME).locator('html').evaluate((el) => getComputedStyle(el).scrollbarWidth);
    await expect.poll(rootBarStyle).toBe('none');
    const stageBox = await stage.boundingBox();
    const shell = await page.locator('#wb-board-panel .wb-screen:not([data-doc-hidden]) .wb-phone-doc').boundingBox();
    expect(shell.y).toBeGreaterThan(stageBox.y);
    expect(shell.y + shell.height).toBeLessThan(stageBox.y + stageBox.height);
    expect(Math.abs((shell.x + shell.width / 2) - (stageBox.x + stageBox.width / 2))).toBeLessThan(1);
    await page.locator('#wbpage-close').click();
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
    await expect.poll(() => innerWidth(page.locator(`${CARD('long-page')} iframe.wb-html-card-frame`))).toBe(402);
    const box = await page.locator(`${CARD('long-page')} .wb-html-card`).boundingBox();
    expect(Math.abs(box.height / box.width - 874 / 402)).toBeLessThan(0.01);
    // 别的卡片还是窗口宽。
    await expect.poll(() => innerWidth(page.locator(`${CARD('catalog')} iframe.wb-html-card-frame`))).toBe(1280);
  });

  await test.step('在页面浮层里标注深处的标签（y > 5000）：账本落在这篇的桶、按路径分本；焦点在页面里按 Esc 先退标注模式再关浮层，卡片出“1 条标注”', async () => {
    await page.locator(`${CARD('long-page')} .wb-html-card`).dblclick({ position: { x: 40, y: 40 } });
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('long-page');
    await page.waitForFunction((sel) => {
      const f = document.querySelector(sel);
      return !!(f && f.contentWindow && f.contentWindow.pinpoint);
    }, PAGE_FRAME);
    await page.locator('#wbviewport [data-viewport="phone"]').focus();
    await page.keyboard.press('a');
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
    const doc = page.frameLocator(PAGE_FRAME);
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
    // 焦点在页面的 iframe 里：第一下 Esc 归标注模式，第二下关浮层。
    await doc.locator('#top-title').evaluate((el) => el.ownerDocument.body.focus());
    expect(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), PAGE_FRAME)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window.workbench.activeEntryId())).toBe('long-page');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
    await expect(page.locator(`${CARD('long-page')} [data-html-card-count]`)).toHaveText('1 条标注');
    await expect(page.locator(`${CARD('catalog')} [data-html-card-count]`)).toBeHidden();
    // 画布上的标注客户端不把这一页的标注当成失效。
    expect(await page.evaluate(() => window.pinpoint.getState().countInvalid)).toBe(0);
    // 刷新：卡片的数从账本读回来。
    await page.reload();
    await page.waitForFunction(() => window.workbench && window.pinpoint);
    await expect(page.locator(`${CARD('long-page')} [data-html-card-count]`)).toHaveText('1 条标注');
  });

  await closeSettled(page);

  await test.step('ppnt comments 按帧分组、带编号 B1，摘录指源文件', async () => {
    const res = await ppnt(['comments', 'e2e-html/pages']);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain('## B1 · long-page');
    expect(res.stdout).toMatch(/\[#1\].*标签换成灰色/);
    expect(res.stdout).toMatch(/long-page\.html\n\s+\d+> .*id="deep-pill"/);
  });

  await test.step('ppnt shot B1 --marks：402 宽的整页，比 5000 高', async () => {
    const res = await ppnt(['shot', 'e2e-html/pages', 'B1', '--marks']);
    expect(res.code, res.stderr).toBe(0);
    const out = path.join(E2E_DATA_DIR, 'shot', PAGE_ID, 'long-page.png');
    expect(res.stdout).toContain(`B1 · long-page → ${out} · 402×`);
    const buffer = fs.readFileSync(out);
    expect(buffer.readUInt32BE(16)).toBe(402);
    expect(buffer.readUInt32BE(20)).toBeGreaterThan(5000);
  });
});

test('文章页：HTML 帧上的标注进右栏和卡片头的数；点了开画布、开那一页并定位到钉子；浮层里的画布双击照样开页面，Esc 一层层关', async ({ page, request }) => {
  test.setTimeout(240_000);
  fs.rmSync(BUCKET, { recursive: true, force: true });
  await expect.poll(async () => (await request.get(ARTICLE_URL)).status(), { timeout: 150_000, intervals: [500] }).toBe(200);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  // 一条钉在 long-page 深处标签上的文档页标注：在那一页自己的账本里（同桶，账本名按页面地址）。
  const docPath = `/sites/${PAGE_ID}/long-page.html`;
  const ledgerName = pageKeyFromPathname(docPath);
  const seeded = await request.post('/save', { data: {
    page: ledgerName, entry: PAGE_ID, path: docPath, baseRevision: 0,
    annotations: [{ id: 'h-deep', type: 'element', status: 'open', content: '[@t:i1] 换成灰色',
      targets: [{ ref: 'i1', selector: '#deep-pill', text: '深处的标签' }], selector: '#deep-pill', text: '深处的标签' }],
  } });
  expect(seeded.ok()).toBe(true);
  const n = (await seeded.json()).annotations[0].n;
  const rail = page.locator('#rail .pp-threads');
  const embed = () => page.frames().find((f) => /\/workbench\/\?.*embed=overlay/.test(f.url()));
  const embedEntry = () => page.evaluate(() => window.pinpointOverlay.frame()?.contentWindow?.workbench?.activeEntryId?.() || null);
  const pageDoc = () => page.frameLocator('[data-pp-overlay] iframe.ov-canvas').frameLocator('[data-page-screen="long-page"] iframe.wb-doc-frame');

  try {
    await page.goto(ARTICLE_URL);
    await expect(page.locator('#article .prose h1')).toHaveText('生成的页面', { timeout: 150_000 });
    await waitNoReload(page);

    await test.step('右栏：这条标注排在卡片的位置，标帧名；卡片头“1 条标注”；链接带帧和钉子', async () => {
      const thread = rail.locator(`.pp-thread[data-kind="canvas"][data-n="${n}"]`);
      await expect(thread).toBeVisible({ timeout: 30_000 });
      await expect(thread.locator('.pp-canvas-frame')).toHaveText('帧long-page');
      await expect(thread.locator('.msg .text')).toHaveText('“深处的标签” 换成灰色');
      await expect(thread.locator('a[data-pp-canvas-link]')).toHaveAttribute('href', `#canvas=pages&frame=long-page&ann=${n}`);
      await expect(card(page).locator('[data-pp-badge]')).toHaveText('1 条标注');
    });

    await test.step('点它：文章上开画布，开 long-page 的页面浮层，滚到钉子、打开标注框；Esc 先关框、再关页面、再关画布', async () => {
      await rail.locator(`.pp-thread[data-kind="canvas"][data-n="${n}"] .msg .text`).click();
      await expect(overlay(page)).toHaveAttribute('open', '');
      await expect.poll(() => page.evaluate(() => window.pinpointOverlay.state()?.landing), { timeout: 60_000 }).toBe(`ann:${n}`);
      expect(await embedEntry()).toBe('long-page');
      await expect(pageDoc().locator('#ann-box')).toBeVisible();
      await expect(pageDoc().locator('#ann-input')).toContainText('换成灰色');
      expect(await pageDoc().locator('#deep-pill').evaluate((el) => el.ownerDocument.defaultView.scrollY)).toBeGreaterThan(4000);
      await page.keyboard.press('Escape');
      await expect(pageDoc().locator('#ann-box')).toBeHidden();
      expect(await embedEntry()).toBe('long-page');
      await page.keyboard.press('Escape');
      await expect.poll(embedEntry).toBe('@canvas');
      await expect(overlay(page)).toHaveAttribute('open', '');
      await page.keyboard.press('Escape');
      await expect(overlay(page)).not.toHaveAttribute('open', '');
    });

    await test.step('浮层里的画布：双击 HTML 卡片开页面浮层（嵌入版也有“← 画布”），浮层头报卡片所在的节；Esc 回画布、再 Esc 回文章', async () => {
      await card(page).locator('[data-pp-open]').click();
      await expect(overlay(page)).toHaveAttribute('open', '');
      await expect.poll(() => page.evaluate(() => window.pinpointOverlay.state()?.landing), { timeout: 60_000 }).toBe('section');
      const wb = embed();
      await expect.poll(() => wb.evaluate(() => window.workbench.whenBoardSettled()), { timeout: 30_000 }).toBe(true);
      const canvas = page.frameLocator('[data-pp-overlay] iframe.ov-canvas');
      // C 节的卡片：页面浮层盖住画布后，藏起来的视口不再决定“当前节”，浮层头停在卡片所在的 C 节。
      await canvas.locator('.wb-screen[data-html-card][data-screen="catalog-2"] .wb-html-card').scrollIntoViewIfNeeded();
      await canvas.locator('.wb-screen[data-html-card][data-screen="catalog-2"] .wb-html-card').dblclick({ position: { x: 40, y: 40 } });
      await expect.poll(embedEntry).toBe('catalog-2');
      await expect(canvas.locator('#wbpage-close')).toBeVisible();
      await expect(canvas.frameLocator('[data-page-screen="catalog-2"] iframe.wb-doc-frame').locator('body')).toHaveCSS('background-color', 'rgb(250, 247, 240)');
      await page.waitForTimeout(1000); // 静默窗口：文章页跟节要停稳 300ms（SECTION_SETTLE_MS），等过它再看头部没被带走
      await expect(overlay(page).locator('[data-ov-title]')).toHaveText('手机界面');
      expect(await page.evaluate(() => location.hash)).toBe('#canvas=app');
      await page.keyboard.press('Escape');
      await expect.poll(embedEntry).toBe('@canvas');
      await expect(overlay(page)).toHaveAttribute('open', '');
      await page.keyboard.press('Escape');
      await expect(overlay(page)).not.toHaveAttribute('open', '');
    });

    await test.step('右栏点“完成”：写回那一页的账本，卡片头不再计它', async () => {
      const thread = rail.locator(`.pp-thread[data-kind="canvas"][data-n="${n}"]`);
      await thread.getByRole('button', { name: '完成' }).click();
      await expect(thread).toHaveClass(/\bpp-closed\b/);
      await expect.poll(() => {
        const file = fs.readdirSync(BUCKET).find((f) => f.startsWith('long-page.html'));
        const doc = file ? JSON.parse(fs.readFileSync(path.join(BUCKET, file), 'utf8')) : null;
        return doc && doc.annotations.find((a) => a.n === n)?.status;
      }).toBe('close');
      await expect(card(page).locator('[data-pp-badge]')).toBeHidden();
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeSettled(page);
  }
});
