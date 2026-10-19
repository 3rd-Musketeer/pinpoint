import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from './lib/fixtures.js';

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

test('文章页：HTML 帧的卡片按手机宽度出第一屏，资源按自己的目录取；切桌面；悬停帧不盖内容；点帧打开整张画布并选中', async ({ page, request }, testInfo) => {
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

  await test.step('点 HTML 帧打开整张画布、选中并定位；Esc 回正文原位；旧 view=frame 地址同样打开画布', async () => {
    await card(page).locator('.cc-frame[data-screen="catalog"]').scrollIntoViewIfNeeded();
    const at = await page.evaluate(() => [window.scrollX, window.scrollY]);
    await card(page).locator('.cc-frame[data-screen="catalog"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    expect(decodeURIComponent(new URL(page.url()).hash)).toBe('#canvas=pages&frame=catalog');
    await expect.poll(() => page.evaluate(() => window.pinpointOverlay.state()?.landing), { timeout: 60_000 }).toBe('frame:catalog');
    const canvas = page.frameLocator('[data-pp-overlay] iframe.ov-canvas');
    expect(await page.evaluate(() => window.pinpointOverlay.frame().contentWindow.workbench.activeEntryId())).toBe('@canvas');
    await expect(overlay(page).locator('[data-ov-kind]')).toHaveText('画布');
    await expect(overlay(page).locator('[data-ov-full], [data-ov-frame]')).toHaveCount(0);
    await expect(canvas.locator(CARD('catalog'))).toHaveClass(/\bwb-sel\b/);
    for (const id of ['long-page', 'catalog', 'widget']) await expect(canvas.locator(`${CARD(id)} .wb-html-card`)).toBeVisible();
    const wb = page.frames().find((f) => /\/workbench\/\?.*embed=overlay/.test(f.url()));
    await expect.poll(() => wb.evaluate(() => window.workbench.whenScrollSettled())).toBeTruthy();
    const body = await overlay(page).locator('.ov-body').boundingBox();
    const hit = await canvas.locator(`${CARD('catalog')} .wb-html-card`).boundingBox();
    expect(hit.x).toBeGreaterThanOrEqual(body.x);
    expect(hit.x + hit.width).toBeLessThanOrEqual(body.x + body.width);
    expect(hit.y).toBeGreaterThanOrEqual(body.y);
    expect(hit.y + hit.height).toBeLessThanOrEqual(body.y + body.height);
    await expect(canvas.frameLocator(`${CARD('catalog')} iframe`).locator('.cat-btn')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('F-html-canvas-overlay.png') });
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => page.evaluate(() => [window.scrollX, window.scrollY])).toEqual(at);

    await page.goto(`${ARTICLE_URL}#canvas=pages&frame=widget&view=frame`);
    await page.reload();
    await expect(page.locator('#article .prose h1')).toHaveText('生成的页面', { timeout: 150_000 });
    await expect.poll(() => page.evaluate(() => window.pinpointOverlay?.state()?.landing), { timeout: 60_000 }).toBe('frame:widget');
    expect(await page.evaluate(() => window.pinpointOverlay.frame().contentWindow.workbench.activeEntryId())).toBe('@canvas');
    await expect(canvas.locator(CARD('widget'))).toHaveClass(/\bwb-sel\b/);
    await overlay(page).locator('[data-ov-close]').click();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    expect(new URL(page.url()).hash).toBe('');
  });

  expect(pageErrors).toEqual([]);
});

test('画布视图：一篇文章一张画布，HTML 帧是活的白底卡片；“全页”开页面浮层，手机视口里标注 y > 5000 处的元素，卡片显示本页标注数', async ({ page }) => {
  test.setTimeout(180_000);
  fs.rmSync(BUCKET, { recursive: true, force: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page, `page=${PAGE_ID}`);
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled()), { timeout: 30_000 }).toBe(true);
  const stage = page.locator('#wbstage');
  const scrollOf = () => stage.evaluate((el) => [Math.round(el.scrollLeft), Math.round(el.scrollTop)]);

  await test.step('一张画布：画布条目，没有文档条目的步进和视口两段；四张 HTML 卡片是 1280 × 800 的窗口，正常加载、带标注客户端，C 节手机帧和卡片混排', async () => {
    expect(await page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');
    expect(await stageForm(page)).toBe('ios');
    await expect(page.locator('#wbentry-nav')).toHaveCount(0);
    await expect(page.locator('#wbviewport')).toHaveCount(0);
    for (const id of ['long-page', 'catalog', 'widget', 'catalog-2']) {
      const frame = page.locator(`${CARD(id)} iframe.wb-html-card-frame`);
      await expect(frame).toHaveCSS('pointer-events', 'auto');
      await expect(frame).toHaveAttribute('data-live', 'on');
      await expect(frame).not.toHaveAttribute('src', /annotate=off/);
      await expect.poll(() => innerWidth(frame)).toBe(1280);
      const box = await page.locator(`${CARD(id)} .wb-html-card`).boundingBox();
      expect(Math.abs(box.height / box.width - 800 / 1280)).toBeLessThan(0.01);
      // 卡片在画布上看得见（不是收起的文档条目）。
      expect(box.width).toBeGreaterThan(100);
    }
    // 活的页面：带标注客户端，不出底部淡出；客户端借工作台的 SSE，不自己开连接。
    await expect.poll(() => page.locator(`${CARD('long-page')} iframe`).evaluate((el) => !!el.contentWindow.pinpoint)).toBe(true);
    await expect(page.locator('.wb-html-card-fade')).toHaveCount(0);
    expect(await page.locator(`${CARD('long-page')} iframe`).evaluate((el) => el.hasAttribute('data-pp-parent-events'))).toBe(true);
    await expect.poll(() => page.locator(`${CARD('long-page')} iframe`).evaluate((el) => el.contentWindow.pinpoint.getState().connected)).toBe(true);
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

  await test.step('交互模式：卡片里滚轮滚页面、画布不动；卡片外滚轮平移画布；卡片里能点；捏合与空格拖照旧归画布；点图注选中', async () => {
    const long = page.locator(`${CARD('long-page')} iframe.wb-html-card-frame`);
    const box = await page.locator(`${CARD('long-page')} .wb-html-card`).boundingBox();
    const before = await scrollOf();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => long.evaluate((el) => el.contentWindow.scrollY)).toBeGreaterThan(100);
    await page.waitForTimeout(300); // 静默窗口：滚轮停下后画布不跟着动
    expect(await scrollOf()).toEqual(before);

    // 卡片外（节标题那一行的空白）滚轮：平移画布。
    const cap = await page.locator('#lib-pages .wb-lib-cap').boundingBox();
    await page.mouse.move(cap.x + cap.width + 40, cap.y + cap.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => (await scrollOf())[1]).toBeGreaterThan(before[1] + 100);

    // 卡片里能点：按钮的脚本照常跑。
    const cat = page.frameLocator(`${CARD('catalog')} iframe`);
    await cat.locator('.cat-btn').click();
    await expect(cat.locator('.cat-out')).toHaveText('已点');

    // 捏合（ctrl + 滚轮）落在卡片上：画布缩放，页面自己不缩。
    const zoomOf = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wb-board-zoom')) || 1);
    const z0 = await zoomOf();
    // 卡片在画布上可能伸出视口右缘，点位取卡片左上角附近。
    const catBox = await page.locator(`${CARD('catalog')} .wb-html-card`).boundingBox();
    await page.mouse.move(catBox.x + 60, catBox.y + 60);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(zoomOf).toBeGreaterThan(z0);
    expect(await page.locator(`${CARD('catalog')} iframe`).evaluate((el) => el.contentWindow.visualViewport.scale)).toBe(1);

    // 焦点在卡片里（刚点过按钮）按住空格拖：平移画布。
    const s0 = await scrollOf();
    const cb = await page.locator(`${CARD('catalog')} .wb-html-card`).boundingBox();
    await page.keyboard.down(' ');
    await expect(stage).toHaveClass(/\bwb-space-held\b/);
    await page.mouse.move(cb.x + 200, cb.y + 120);
    await page.mouse.down();
    await page.mouse.move(cb.x + 60, cb.y + 70, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up(' ');
    const s1 = await scrollOf();
    expect(s1[0] - s0[0]).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.workbench.activeEntryId())).toBe('@canvas');

    // 点图注选中这一帧（卡片里面是页面，点了不动选中）。
    await page.locator(`${CARD('long-page')} .wb-cap-ref`).click();
    await expect(page.locator(CARD('long-page'))).toHaveClass(/\bwb-sel\b/);
  });

  let canvasAt = null;
  await test.step('点图注行的“全页”：开这一页的完整页面（文档形态铺满舞台），左上角“← 画布”；Esc 关，回到打开前的位置', async () => {
    canvasAt = await scrollOf();
    await page.locator(`${CARD('long-page')} [data-html-card-open]`).click();
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
    await page.locator(`${CARD('long-page')} [data-html-card-open]`).click();
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
    await page.locator(`${CARD('long-page')} [data-html-card-open]`).click();
    await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('long-page');
    await expect(page.frameLocator(PAGE_FRAME).locator('html')).toHaveCount(1);
    expect(await page.frameLocator(PAGE_FRAME).locator('html').evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe('auto');
    await page.locator('#wbviewport [data-viewport="phone"]').click();
    await expect(page.locator('#wbviewport [data-viewport="phone"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.workbench.activeEntryId())).toBe('long-page');
    await expect(page.frameLocator(PAGE_FRAME).locator('#width-probe-narrow')).toBeVisible();
    // 手机屏里的文档根不出滚动条（overlay-scrollbar.js 的 hidePhoneDocScrollbar；量宽度的那条在 viewport.spec.js）。
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
    await page.locator(`${CARD('long-page')} [data-html-card-open]`).click();
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

test('画布视图：标注模式下直接在卡片里标，标注进那一页的账本，卡片里按 Esc 退标注模式；视野外的 HTML 卡片先不装、进了视野才装', async ({ page }) => {
  test.setTimeout(120_000);
  fs.rmSync(BUCKET, { recursive: true, force: true });
  const live = (id) => page.locator(`${CARD(id)} iframe.wb-html-card-frame`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page, `page=${PAGE_ID}`);
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled()), { timeout: 30_000 }).toBe(true);

  await test.step('横条“标注”：卡片里那一页的客户端一起进标注模式；点卡片里的元素出标注框，存进那一页的账本，卡片计上', async () => {
    await expect(live('long-page')).toHaveAttribute('data-live', 'on');
    await page.waitForFunction((sel) => !!document.querySelector(sel)?.contentWindow?.pinpoint, `${CARD('long-page')} iframe`);
    await page.locator('#wbann-toggle').click();
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => live('long-page').evaluate((el) => el.contentWindow.pinpoint.getState().mode)).toBe(true);
    const doc = page.frameLocator(`${CARD('long-page')} iframe`);
    await doc.locator('#top-title').click();
    const box = doc.locator('#ann-box');
    await expect(box).toBeVisible();
    await box.locator('#ann-input').fill('标题换成宋体');
    await box.locator('#ann-close').click();
    await expect(box).toBeHidden();
    let row = null;
    await expect.poll(() => {
      const files = fs.existsSync(BUCKET) ? fs.readdirSync(BUCKET).filter((n) => n.endsWith('.json') && n !== '_seq.json') : [];
      for (const name of files) {
        const ledger = JSON.parse(fs.readFileSync(path.join(BUCKET, name), 'utf8'));
        const hit = (ledger.annotations || []).find((a) => /标题换成宋体/.test(a.content || ''));
        if (hit) row = { ...hit, path: ledger.path };
      }
      return !!row;
    }).toBe(true);
    expect(row.path).toBe(`/sites/${PAGE_ID}/long-page.html`);
    expect(row.targets[0].selector).toMatch(/#top-title$/);
    await expect(page.locator(`${CARD('long-page')} [data-html-card-count]`)).toHaveText('1 条标注');
    // 画布自己的账本里没有它。
    expect(await page.evaluate(() => window.pinpoint.getState().count)).toBe(0);
  });

  await test.step('焦点在卡片里按 Esc：卡片退出标注模式，横条跟着回交互；卡片里照常能点', async () => {
    await live('long-page').evaluate((el) => el.contentWindow.document.body.focus());
    await page.keyboard.press('Escape');
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'false');
    expect(await live('long-page').evaluate((el) => el.contentWindow.pinpoint.getState().mode)).toBe(false);
    const cat = page.frameLocator(`${CARD('catalog')} iframe`);
    await cat.locator('.cat-btn').click();
    await expect(cat.locator('.cat-out')).toHaveText('已点');
  });

  await test.step('小窗口：视野（四周各留半个舞台）外的卡片只有 data-src；聚焦过去才装', async () => {
    await page.setViewportSize({ width: 640, height: 480 });
    await openWorkbench(page, `page=${PAGE_ID}`);
    await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled()), { timeout: 30_000 }).toBe(true);
    const far = [];
    const stage = await page.locator('#wbstage').boundingBox();
    for (const id of ['long-page', 'catalog', 'widget', 'catalog-2']) {
      const box = await page.locator(`${CARD(id)} .wb-html-card`).boundingBox();
      const outside = box.x > stage.x + stage.width * 1.5 || box.y > stage.y + stage.height * 1.5 ||
        box.x + box.width < stage.x - stage.width * 0.5 || box.y + box.height < stage.y - stage.height * 0.5;
      if (outside) far.push(id);
    }
    expect(far.length).toBeGreaterThan(0);
    for (const id of far) {
      await expect(live(id)).not.toHaveAttribute('src', /./);
      await expect(live(id)).toHaveAttribute('data-src', /\.html$/);
    }
    const target = far[far.length - 1];
    const section = target === 'catalog-2' ? 'app' : 'pages';
    await page.evaluate(([sec, id]) => window.workbench.focusFrame(sec, id), [section, target]);
    await expect(live(target)).toHaveAttribute('data-live', 'on');
    await expect(page.frameLocator(`${CARD(target)} iframe`).locator('body')).not.toBeEmpty();
  });
  await closeSettled(page);
});

test('文章页：HTML 帧上的标注进右栏和卡片头的数；点了开整张画布并定位到活卡片里的钉子；浮层里的画布点“全页”照样开页面，Esc 一层层关', async ({ page, request }) => {
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
  const pageDoc = () => page.frameLocator('[data-pp-overlay] iframe.ov-canvas').frameLocator(`${CARD('long-page')} iframe.wb-html-card-frame`);

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

    await test.step('点它：整张画布定位到活卡片里的钉子、打开标注框；Esc 先关框，再回文章', async () => {
      // 点卡片上链接以外的地方（“画布标注”字样）也开画布；正文那句现在点着是编辑。
      await rail.locator(`.pp-thread[data-kind="canvas"][data-n="${n}"] .pp-kind`).click();
      await expect(overlay(page)).toHaveAttribute('open', '');
      await expect.poll(() => page.evaluate(() => window.pinpointOverlay.state()?.landing), { timeout: 60_000 }).toBe(`ann:${n}`);
      expect(await embedEntry()).toBe('@canvas');
      await expect(pageDoc().locator('#ann-box')).toBeVisible();
      await expect(pageDoc().locator('#ann-input')).toContainText('换成灰色');
      expect(await pageDoc().locator('#deep-pill').evaluate((el) => el.ownerDocument.defaultView.scrollY)).toBeGreaterThan(4000);
      // 钉子必须在活卡片的可见区域里；toBeVisible 本身不检查 iframe 裁切。
      await expect.poll(async () => {
        const pin = await pageDoc().locator('.ann-badge').first().boundingBox();
        const card = await page.frameLocator('[data-pp-overlay] iframe.ov-canvas').locator(`${CARD('long-page')} iframe.wb-html-card-frame`).boundingBox();
        const body = await overlay(page).locator('.ov-body').boundingBox();
        return !!pin && pin.x >= Math.max(card.x, body.x) && pin.y >= Math.max(card.y, body.y)
          && pin.x + pin.width <= Math.min(card.x + card.width, body.x + body.width)
          && pin.y + pin.height <= Math.min(card.y + card.height, body.y + body.height);
      }).toBe(true);
      await page.keyboard.press('Escape');
      await expect(pageDoc().locator('#ann-box')).toBeHidden();
      expect(await embedEntry()).toBe('@canvas');
      await expect(overlay(page)).toHaveAttribute('open', '');
      await page.keyboard.press('Escape');
      await expect(overlay(page)).not.toHaveAttribute('open', '');
    });

    await test.step('浮层里的画布：点 HTML 卡片的“全页”开页面浮层（嵌入版也有“← 画布”），浮层头报卡片所在的节；Esc 回画布、再 Esc 回文章', async () => {
      await card(page).locator('[data-pp-open]').click();
      await expect(overlay(page)).toHaveAttribute('open', '');
      await expect.poll(() => page.evaluate(() => window.pinpointOverlay.state()?.landing), { timeout: 60_000 }).toBe('section');
      const wb = embed();
      await expect.poll(() => wb.evaluate(() => window.workbench.whenBoardSettled()), { timeout: 30_000 }).toBe(true);
      const canvas = page.frameLocator('[data-pp-overlay] iframe.ov-canvas');
      // C 节的卡片：页面浮层盖住画布后，藏起来的视口不再决定“当前节”，浮层头停在卡片所在的 C 节。
      await canvas.locator('.wb-screen[data-html-card][data-screen="catalog-2"] [data-html-card-open]').scrollIntoViewIfNeeded();
      await canvas.locator('.wb-screen[data-html-card][data-screen="catalog-2"] [data-html-card-open]').click();
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


test('HTML 活卡片：空格拖（两种焦点）与中键拖都平移，页面不收按下、点击和选中，松开恢复', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page, `page=${PAGE_ID}`);
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled())).toBe(true);
  const frame = page.locator(`${CARD('catalog')} iframe.wb-html-card-frame`);
  const content = page.frameLocator(`${CARD('catalog')} iframe.wb-html-card-frame`);
  const stage = page.locator('#wbstage');
  for (const gesture of ['space-parent', 'space-card', 'middle']) {
    await test.step(gesture, async () => {
      await page.evaluate(() => window.workbench.focusFrame('pages', 'catalog', { smooth: false }));
      await expect(frame).toHaveAttribute('data-live', 'on');
      await expect(content.locator('.cat-btn')).toBeVisible();
      await frame.evaluate(el => {
        const w = el.contentWindow;
        w.__panEvents = [];
        for (const type of ['pointerdown', 'mousedown', 'click', 'auxclick']) {
          w.document.addEventListener(type, e => w.__panEvents.push(e.type), { once: true });
        }
        w.getSelection().removeAllRanges();
      });
      if (gesture === 'space-card') await content.locator('.cat-btn').focus();
      else await page.locator('#wbzoom-in').focus();
      const box = await content.locator('.cat-btn').boundingBox();
      const before = await stage.evaluate(el => [el.scrollLeft, el.scrollTop]);
      const transformBefore = await page.locator('.wb-zoom-wrap').evaluate(el => el.getBoundingClientRect().x);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      if (gesture.startsWith('space')) await page.keyboard.down('Space');
      const button = gesture === 'middle' ? 'middle' : 'left';
      await page.mouse.down({ button });
      await expect(stage).toHaveClass(/\bwb-pan-held\b/);
      await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 60, { steps: 8 });
      await page.mouse.up({ button });
      if (gesture.startsWith('space')) await page.keyboard.up('Space');
      await expect.poll(() => stage.evaluate(el => [el.scrollLeft, el.scrollTop])).toEqual([before[0] + 100, before[1] + 60]);
      // 画布通过 stage scroll 平移，缩放 transform 不变；量渲染后画布的实际位移。
      expect(await page.locator('.wb-zoom-wrap').evaluate(el => el.getBoundingClientRect().x)).toBeCloseTo(transformBefore - 100, 0);
      expect(await frame.evaluate(el => el.contentWindow.__panEvents)).toEqual([]);
      expect(await frame.evaluate(el => el.contentWindow.getSelection().toString())).toBe('');
      await expect(stage).not.toHaveClass(/wb-space-held|wb-pan-held|wb-panning/);
      await expect(content.locator('.cat-out')).toHaveText('未点');
      await content.locator('.cat-btn').click();
      await expect(content.locator('.cat-out')).toHaveText('已点');
      await content.locator('.cat-out').evaluate(el => { el.textContent = '未点'; });
    });
  }
});
