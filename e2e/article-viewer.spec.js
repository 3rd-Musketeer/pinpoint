import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { POP_CLOSE_MS } from '../site/src/lib/client.js';
import { E2E_BASE_URL, E2E_DATA_DIR } from './env.js';
import { annotate } from './lib/annotate.js';
import { ppnt } from './lib/cli.js';
import { proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';
import { closeSettled } from './ledger-settle.js';

// pp3：正文里的画布浮层（文章上开整张画布）、右栏里穿插的画布标注与 [[ ]] 悬停 popup
// （site/README.md「画布浮层」「[[ ]] 引用」，docs/annotation.md「正文评论」）。
// 固件：常驻 project e2e-project 的 commit-confirm（e2e/project-site/）。有画布的三节：
// 2 confirm（confirm-sheet 带一个能点的按钮、confirm-done）、3 variants（card-plain，comp）、
// 4 mixed（手机帧 + 帧级 comp）。1 why 是纯文字。
// 文章页只显示节号；画布上同样这几节是字母 B、C、D（A 是 why），只在画布、ppnt、标注里出现。
//
// 文件名排在 article-site 后面：那个 spec 要看站点冷启动（idle → 503 → 文章），同组时得先跑它。
// 单独成组时这里也可能撞上冷启动，所以第一次打开文章等得久一些。

const ARTICLE = '/e2e-project/commit-confirm/';
const CANVAS_PAGE = 'e2e-project_commit-confirm';

const overlay = (page) => page.locator('dialog[data-pp-overlay]');
const canvasFrame = (page) => page.frameLocator('[data-pp-overlay] iframe.ov-canvas');
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
const scrollOf = (page) => page.evaluate(() => [window.scrollX, window.scrollY]);
const activeInfo = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return {
    inOverlay: !!a?.closest?.('[data-pp-overlay]'),
    tag: a?.tagName || '',
    frame: a?.closest?.('.cc-frame')?.dataset.screen || '',
    hit: !!a?.matches?.('.cc-hit'),
    id: a?.id || '',
  };
});

/** 浮层里的工作台装好、板落定。 */
async function canvasReady(page) {
  const frame = page.frame({ url: /\/workbench\/\?.*embed=overlay/ });
  await expect.poll(() => page.evaluate(() => {
    const w = window.pinpointOverlay?.frame()?.contentWindow;
    return !!(w && w.workbench && w.workbench.activePageId() === 'e2e-project_commit-confirm');
  }), { timeout: 60_000 }).toBe(true);
  const wb = page.frames().find((f) => /\/workbench\/\?.*embed=overlay/.test(f.url())) || frame;
  await expect.poll(() => wb.evaluate(() => window.workbench.whenBoardSettled()), { timeout: 30_000 }).toBe(true);
  return wb;
}

/** 浮层停在了哪一节、最后一次定位落到了哪里。 */
const overlayState = (page) => page.evaluate(() => window.pinpointOverlay?.state() || null);

async function openArticle(page, url = ARTICLE) {
  await page.goto(url);
  await expect(page.locator('#article .prose h1')).toHaveText('提交前确认', { timeout: 150_000 });
  await waitNoReload(page);
  await expect(page.locator('#article .prose h1')).toHaveText('提交前确认');
}

test('画布浮层：从文章进画布不跳页，整张画布可交互 / 标注 / 缩放，关掉回原位；hash、后退、刷新、换节', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await openArticle(page);
  consoleErrors.length = 0; // 冷启动那几次 503 记成 Failed to load resource
  await proseSettled(page);
  let before = null;

  await test.step('卡片缩略图仍不可交互；点卡片里的 confirm-done → 文章上开整张画布，不导航，定位到这一帧', async () => {
    const thumb = page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-screen="confirm-sheet"] iframe');
    await expect(thumb).toHaveCSS('pointer-events', 'none');
    await expect(thumb).toHaveAttribute('tabindex', '-1');
    await page.evaluate(() => { window.__sameDoc = true; });
    await page.locator('[data-pp-canvas][data-pp-section="confirm"]').scrollIntoViewIfNeeded();
    before = await scrollOf(page);
    expect(before[1]).toBeGreaterThan(100);
    await page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-screen="confirm-done"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    expect(new URL(page.url()).pathname).toBe(ARTICLE);
    expect(hashOf(page)).toBe('#canvas=confirm&frame=confirm-done');
    expect(await page.evaluate(() => window.__sameDoc)).toBe(true);
    await expect(page.locator('html')).toHaveClass(/\bpp-ov-lock\b/);
    // 里面是嵌入版工作台：整张画布（四节都在），落在这一节。
    const src = await overlay(page).locator('iframe.ov-canvas').getAttribute('src');
    expect(src).toBe(`/workbench/?page=${CANVAS_PAGE}&section=confirm&embed=overlay`);
    const wb = await canvasReady(page);
    await expect(canvasFrame(page).locator('#wb-board-panel [data-screen]')).toHaveCount(5);
    await expect(canvasFrame(page).locator('#wbside')).toBeHidden();
    await expect(canvasFrame(page).locator('#wbback')).toHaveCount(0);
    await expect.poll(() => overlayState(page).then((st) => st && st.landing)).toBe('section');
    await expect.poll(() => wb.evaluate(() => window.workbench.whenScrollSettled())).toBeTruthy();
    // 点的那一帧在画布可见区里。
    const panel = await overlay(page).locator('.ov-body').boundingBox();
    const done = await canvasFrame(page).locator('#wb-board-panel [data-screen="confirm-done"] .e2e-project-banner').boundingBox();
    expect(done.x).toBeGreaterThanOrEqual(panel.x);
    expect(done.x + done.width).toBeLessThanOrEqual(panel.x + panel.width);
    expect(done.y).toBeGreaterThanOrEqual(panel.y);
  });

  await test.step('头部：节号、标题、整页打开；页面上的正文不动', async () => {
    const ov = overlay(page);
    await expect(ov.locator('[data-ov-num]')).toHaveText('2');
    await expect(ov.locator('[data-ov-title]')).toHaveText('确认卡');
    await expect(ov.locator('[data-ov-canvas]')).toHaveAttribute('href', `/workbench/?page=${CANVAS_PAGE}&section=confirm`);
    expect(await scrollOf(page)).toEqual(before);
  });

  await test.step('画布可交互、可缩放、可进标注模式', async () => {
    const f = canvasFrame(page);
    await expect(f.locator('#wb-board-panel [data-screen="confirm-sheet"] .e2e-tap-out')).toHaveText('未确认');
    await f.locator('#wb-board-panel [data-screen="confirm-sheet"] .e2e-tap').click();
    await expect(f.locator('#wb-board-panel [data-screen="confirm-sheet"] .e2e-tap-out')).toHaveText('已确认');
    const zoom = await f.locator('#wbzoom-label').innerText();
    await f.locator('#wbzoom-in').click();
    await expect(f.locator('#wbzoom-label')).not.toHaveText(zoom);
    await f.locator('#wbann-toggle').click();
    await expect(f.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('浮层里选字不出正文“评论”', async () => {
    await proseSettled(page);
    const before = await page.evaluate(() => window.pinpointProse.selection().checks);
    const t = await page.locator('[data-ov-title]').boundingBox();
    await page.mouse.move(t.x + 1, t.y + t.height / 2);
    await page.mouse.down();
    await page.mouse.move(t.x + t.width - 1, t.y + t.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => String(window.getSelection()))).toBe('确认卡');
    await expect.poll(() => page.evaluate(() => window.pinpointProse.selection().checks)).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.pinpointProse.selection().offered)).toBe(false);
    await expect(page.locator('.pp-selbtn')).toHaveCount(0);
    await page.evaluate(() => window.getSelection().removeAllRanges());
  });

  await test.step('画布里的 Esc：先退出标注模式（浮层还开着），再按一下才关浮层；关了回原滚动位置，焦点回到点的那一帧', async () => {
    const f = canvasFrame(page);
    await f.locator('#wbstrip-title').click(); // 焦点进画布
    expect((await activeInfo(page)).tag).toBe('IFRAME');
    await page.keyboard.press('Escape');
    await expect(f.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay(page)).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => hashOf(page)).toBe('');
    await expect.poll(() => scrollOf(page)).toEqual(before);
    expect(await activeInfo(page)).toMatchObject({ inOverlay: false, hit: true, frame: 'confirm-done' });
    await expect(page.locator('html')).not.toHaveClass(/\bpp-ov-lock\b/);
    expect(new URL(page.url()).pathname).toBe(ARTICLE);
  });

  await test.step('卡片“打开画布”：同一个浮层，再开不重装工作台，直接定位到那一节；后退关、前进开；关闭按钮；点暗色区域', async () => {
    const generation = await page.evaluate(() => window.pinpointOverlay.frame().contentWindow.workbench.mountGeneration());
    await page.locator('[data-pp-canvas][data-pp-section="variants"]').scrollIntoViewIfNeeded();
    const at = await scrollOf(page);
    await page.locator('[data-pp-canvas][data-pp-section="variants"] [data-pp-open]').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    expect(hashOf(page)).toBe('#canvas=variants');
    expect(new URL(page.url()).pathname).toBe(ARTICLE);
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('3');
    await expect(canvasFrame(page).locator('.wb-lib-item[data-ann-section="variants"]')).toHaveClass(/\bwb-sel\b/);
    expect(await page.evaluate(() => window.pinpointOverlay.frame().contentWindow.workbench.mountGeneration())).toBe(generation);
    await page.goBack();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    expect(hashOf(page)).toBe('');
    await expect.poll(() => scrollOf(page)).toEqual(at);
    await page.goForward();
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('3');
    await overlay(page).locator('[data-ov-close]').click();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => hashOf(page)).toBe('');
    await expect.poll(() => scrollOf(page)).toEqual(at);
    expect(await page.evaluate(() => window.__sameDoc)).toBe(true);

    await page.locator('[data-pp-canvas][data-pp-section="variants"] [data-screen="card-plain"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    await page.mouse.click(8, 450); // 面板外 24 px 的暗色边
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => hashOf(page)).toBe('');
  });

  await test.step('画布里换节：头部和 #canvas= 跟着换，不多压历史', async () => {
    await page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-pp-open]').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    const wb = await canvasReady(page);
    const length = await page.evaluate(() => history.length);
    await expect.poll(() => wb.evaluate(() => window.workbench.focusSection('mixed'))).toBe(true);
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('4');
    await expect(overlay(page).locator('[data-ov-title]')).toHaveText('手机和裸卡片');
    await expect.poll(() => hashOf(page)).toBe('#canvas=mixed');
    await expect(overlay(page).locator('[data-ov-canvas]')).toHaveAttribute('href', `/workbench/?page=${CANVAS_PAGE}&section=mixed`);
    expect(await page.evaluate(() => history.length)).toBe(length);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
  });

  await test.step('顶栏“画布视图”：从正在读的那一节开，关掉正文一点没挪', async () => {
    await page.evaluate(() => document.getElementById('mixed').scrollIntoView({ block: 'start' }));
    const at = await scrollOf(page);
    await page.locator('#btn-canvas').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    expect(hashOf(page)).toBe('#canvas=mixed');
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('4');
    await expect(canvasFrame(page).locator('.wb-lib-item[data-ann-section="mixed"]')).toHaveClass(/\bwb-sel\b/);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => scrollOf(page)).toEqual(at);
    expect(await activeInfo(page)).toMatchObject({ id: 'btn-canvas' });
  });

  await test.step('直接带 #canvas= 打开（刷新、分享）：浮层打开；关闭只去掉 hash，留在文章上；旧的 #overlay= 照样开', async () => {
    await page.goto('/e2e-project/');
    await openArticle(page, `${ARTICLE}#canvas=variants`);
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('[data-ov-title]')).toHaveText('卡片做法');
    await canvasReady(page);
    await expect(canvasFrame(page).locator('.wb-lib-item[data-ann-section="variants"]')).toHaveClass(/\bwb-sel\b/);
    await overlay(page).locator('[data-ov-close]').click();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    expect(page.url()).toBe(`${E2E_BASE_URL}${ARTICLE}`);

    await page.goto('/e2e-project/');
    await openArticle(page, `${ARTICLE}#overlay=mixed&frame=mixed-bare`);
    await expect(overlay(page)).toHaveAttribute('open', '');
    expect(hashOf(page)).toBe('#canvas=mixed&frame=mixed-bare');
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('4');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
  });

  await test.step('390 宽：整屏 sheet，页面不横向溢出', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-pp-canvas][data-pp-section="confirm"]').scrollIntoViewIfNeeded();
    await page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-screen="confirm-sheet"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    const panel = await overlay(page).locator('.ov-panel').boundingBox();
    expect([panel.x, panel.y, panel.width, panel.height]).toEqual([0, 0, 390, 844]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await closeSettled(page);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('[[ ]] popup：悬停打开、移进 popup 不关、离开后关；点有目标的 ref 跳转，空 ref 点开 popup；键盘聚焦打开', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await openArticle(page);

  const concept = page.locator('.cref[data-kind="concept"][data-name="confirm-card"]');
  const pop = page.locator('.pop');

  await test.step('悬停打开；移进 popup 留着；离开两者后关', async () => {
    await concept.hover();
    await expect(pop).toBeVisible();
    await expect(pop.locator('.k')).toHaveText('confirm-card收敛中');
    const b = await pop.boundingBox();
    // 先停在 ref 与 popup 之间的空隙（popup 在 ref 下方 8px）：移出 ref，排上一次 POP_CLOSE_MS 的关闭；
    // 再移进 popup，它要把这次关闭取消。页面里排一个同样时长的定时器：它晚于那次关闭排上，
    // 回调时那次关闭若没取消就已经执行了。
    await page.mouse.move(b.x + b.width / 2, b.y - 4);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.evaluate((ms) => new Promise((resolve) => setTimeout(resolve, ms)), POP_CLOSE_MS);
    await expect(pop).toBeVisible();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height + 160, { steps: 4 });
    await expect(pop).toHaveCount(0);
  });

  await test.step('同时只有一个 popup；Esc 关闭', async () => {
    await concept.hover();
    await expect(pop).toBeVisible();
    await page.locator('.cref[data-kind="article"][data-name="takeover"]').hover();
    await expect(pop.locator('.k')).toHaveText('用户接手文章');
    await expect(pop).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  });

  await test.step('空 ref：点击打开 popup，不跳转', async () => {
    await page.locator('.cref.empty[data-name="risk-score"]').click();
    await expect(pop.locator('.k')).toHaveText('risk-score空 ref');
    expect(new URL(page.url()).pathname).toBe(ARTICLE);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  });

  await test.step('键盘 Tab 到 ref 上打开 popup', async () => {
    await page.locator('#article .prose h1').click();
    let onRef = false;
    for (let i = 0; i < 40 && !onRef; i += 1) {
      await page.keyboard.press('Tab');
      onRef = await page.evaluate(() => !!document.activeElement?.classList.contains('cref'));
    }
    expect(onRef).toBe(true);
    await expect(pop).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  });

  await test.step('写评论时悬停 ref 再按 Esc：只关 popup，草稿和已打的字都在；焦点在草稿框里再按 Esc 才取消草稿', async () => {
    await proseSettled(page);
    const box = await page.evaluate((text) => {
      const el = document.querySelector('#why');
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.data.indexOf(text);
        if (at < 0) continue;
        node.parentElement.scrollIntoView({ block: 'center' });
        const a = document.createRange(); a.setStart(node, at); a.setEnd(node, at + 1);
        const b = document.createRange(); b.setStart(node, at + text.length - 1); b.setEnd(node, at + text.length);
        const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
        return { x1: ra.left + 1, y1: ra.top + ra.height / 2, x2: rb.right - 1, y2: rb.top + rb.height / 2 };
      }
      return null;
    }, '不可撤销的动作');
    expect(box).not.toBeNull();
    await page.mouse.move(box.x1, box.y1);
    await page.mouse.down();
    await page.mouse.move(box.x2, box.y2, { steps: 6 });
    await page.mouse.up();
    await page.locator('.pp-selbtn').click();
    const area = page.locator('.pp-thread.draft textarea');
    await area.fill('写到一半');
    await expect(area).toBeFocused();
    await concept.scrollIntoViewIfNeeded();
    await concept.hover();
    await expect(pop).toBeVisible();
    await expect(area).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(page.locator('.pp-thread.draft textarea')).toHaveValue('写到一半');
    await page.keyboard.press('Escape');
    await expect(page.locator('.pp-thread.draft')).toHaveCount(0);
  });

  await test.step('点 wiki ref：去 wiki 词条页', async () => {
    await concept.click();
    await expect(page).toHaveURL(`${E2E_BASE_URL}/e2e-project/wiki/confirm-card/`);
    await expect(page.locator('#article .prose h1')).toHaveText('confirm-card');
  });

  expect(pageErrors).toEqual([]);
});

test('文章页只显示节号，不出画布字母；画布接口仍带 letter / ref', async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArticle(page);
  const FRAME_REF = /\b[A-Z]{1,3}\d+\b/; // 画布帧号 B1、AA2……

  await test.step('目录、节标题、卡片头是 1、2、3…；图注只有帧 id；页面上没有字母编号', async () => {
    await expect(page.locator('#toc .n')).toHaveText(['1', '2', '3', '4']);
    await expect(page.locator('#article .sechead .ref')).toHaveText(['1', '2', '3', '4']);
    await expect(page.locator('[data-pp-canvas] .cc-head .ref')).toHaveText(['2', '3', '4']);
    await expect(page.locator('[data-pp-canvas] .cc-head .meta')).toHaveText(['2 帧', '1 帧', '2 帧']);
    await expect(page.locator('[data-pp-canvas] .cc-frame .cap')).toHaveText(['confirm-sheet', 'confirm-done', 'card-plain', 'mixed-phone', 'mixed-bare']);
    await expect(page.locator('[data-letter], [data-ref], [data-ov-letter]')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(FRAME_REF);
    // 卡片的“打开画布”仍按节 id 定位到画布上的那一节（画布那边是字母 B）。
    await expect(page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-pp-open]')).toHaveAttribute('href', `/workbench/?page=${CANVAS_PAGE}&section=confirm`);
  });

  await test.step('浮层头只有节号，不出字母（字母是画布里的，属于工作台）', async () => {
    await page.locator('[data-pp-canvas][data-pp-section="variants"] [data-screen="card-plain"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('3');
    expect(await overlay(page).locator('.ov-head').innerText()).not.toMatch(FRAME_REF);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
  });

  await test.step('GET /api/projects/<project>/articles/<article>/canvas 仍带画布字母（A1 是画布契约）', async () => {
    const res = await request.get('/api/projects/e2e-project/articles/commit-confirm/canvas');
    expect(res.status()).toBe(200);
    const canvas = await res.json();
    expect(canvas.sections.map((s) => [s.id, s.letter, s.frames.map((f) => f.ref)])).toEqual([
      ['confirm', 'B', ['B1', 'B2']],
      ['variants', 'C', ['C1']],
      ['mixed', 'D', ['D1', 'D2']],
    ]);
  });
});

test('右栏：画布标注按位置穿插在正文评论之间，四态、原地收起，点了开画布定位到钉子；卡片头显示本节标注数', async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const bucket = path.join(E2E_DATA_DIR, CANVAS_PAGE);
  const canvasLedger = path.join(bucket, '@canvas.json');
  const proseLedger = path.join(bucket, '@prose.json');
  const clear = () => { for (const f of [canvasLedger, proseLedger]) fs.rmSync(f, { force: true }); };
  const diskRows = () => (fs.existsSync(canvasLedger) ? JSON.parse(fs.readFileSync(canvasLedger, 'utf8')).annotations : []);
  const rail = page.locator('#rail .pp-threads');
  const kinds = () => rail.locator('> .pp-thread').evaluateAll((els) => els.map((el) => `${el.dataset.kind || 'prose'}:${el.dataset.n}`));
  clear();

  // 两条正文评论：一条在第 1 节（画布卡片之前），一条在第 4 节的正文里（第 2、3 节的卡片之后）。
  const proseRow = (id, exact, section) => ({
    id, type: 'prose', status: 'open', content: `评论 ${id}`, quote: { exact, prefix: '', suffix: '' },
    section, path: ARTICLE, created_at: new Date().toISOString(), messages: [],
  });
  const saved = await request.post('/save', { data: {
    page: '@prose', entry: CANVAS_PAGE, path: ARTICLE, baseRevision: 0,
    annotations: [proseRow('p-why', '不可撤销的动作之前', 'why'), proseRow('p-mixed', '同一节里既有手机帧', 'mixed')],
  } });
  expect(saved.ok()).toBe(true);
  const proseN = Object.fromEntries((await saved.json()).annotations.map((r) => [r.id, r.n]));

  // 一条带截图的画布标注，钉在第 3 节 card-plain 上（截图直接放进桶的 images/，行里引用它）。
  fs.mkdirSync(path.join(bucket, 'images'), { recursive: true });
  fs.writeFileSync(path.join(bucket, 'images', 'e2e-rail-shot.png'), Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mNk+M9Qz0AEYBxVSF+FAP0lBHHc0sQUAAAAAElFTkSuQmCC', 'base64'));
  const seeded = await request.post('/save', { data: {
    page: '@canvas', entry: CANVAS_PAGE, path: '/workbench/', baseRevision: 0,
    annotations: [{
      id: 'c-plain', pageId: CANVAS_PAGE, section: 'variants', screenId: 'card-plain', status: 'open',
      content: '[@t:i1] 太挤', targets: [{ ref: 'i1', selector: '.e2e-confirm-card', text: '确认卡' }],
      selector: '.e2e-confirm-card', text: '确认卡', images: [{ file: 'e2e-rail-shot.png' }],
    }],
  } });
  expect(seeded.ok()).toBe(true);
  const plainN = (await seeded.json()).annotations[0].n;

  try {
    await openArticle(page);
    await proseSettled(page);

    await test.step('一列：第 1 节的评论 → 第 3 节卡片位置的画布标注 → 第 4 节的评论；卡片标明画布标注、帧名、截图', async () => {
      await expect.poll(kinds).toEqual([`prose:${proseN['p-why']}`, `canvas:${plainN}`, `prose:${proseN['p-mixed']}`]);
      const card = rail.locator(`.pp-thread[data-kind="canvas"][data-n="${plainN}"]`);
      await expect(card.locator('.pp-kind')).toHaveText('画布标注');
      await expect(card.locator('.pp-canvas-frame')).toHaveText('帧card-plain');
      await expect(card.locator('.msg .text')).toHaveText('“确认卡” 太挤');
      await expect(card.locator('.pp-n')).toHaveText(`#${plainN}`);
      await expect(card.locator('img.pp-canvas-shot')).toHaveJSProperty('naturalWidth', 2);
      await expect(card.locator('a[data-pp-canvas-link]')).toHaveAttribute('href', `#canvas=variants&ann=${plainN}`);
    });

    await test.step('卡片头的标注数：有标注的节显示，没有的不显示', async () => {
      await expect(page.locator('[data-pp-canvas][data-pp-section="variants"] [data-pp-badge]')).toHaveText('1 条标注');
      await expect(page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-pp-badge]')).toBeHidden();
    });

    let doneN = 0;
    await test.step('在浮层里标一条：右栏实时出现在第 2 节卡片的位置，那张卡片的标注数跟着变', async () => {
      await page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-pp-open]').click();
      await expect(overlay(page)).toHaveAttribute('open', '');
      const wb = await canvasReady(page);
      const f = canvasFrame(page);
      await f.locator('#wbann-toggle').click();
      await expect(f.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
      await annotate(f, '#wb-board-panel [data-screen="confirm-done"] .e2e-project-banner', '横幅换成成功色');
      await expect.poll(() => wb.evaluate(() => window.pinpoint.getState().syncing)).toBe(false);
      await expect.poll(() => diskRows().filter((r) => r.screenId === 'confirm-done').length).toBe(1);
      doneN = diskRows().find((r) => r.screenId === 'confirm-done').n;
      await expect.poll(kinds).toEqual([`prose:${proseN['p-why']}`, `canvas:${doneN}`, `canvas:${plainN}`, `prose:${proseN['p-mixed']}`]);
      await expect(rail.locator(`.pp-thread[data-n="${doneN}"] .pp-canvas-frame`)).toHaveText('帧confirm-done');
      await expect(rail.locator(`.pp-thread[data-n="${doneN}"] img`)).toHaveCount(0); // 没截图就不放
      await expect(page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-pp-badge]')).toHaveText('1 条标注');
      await page.keyboard.press('Escape'); // 退出标注模式
      await page.keyboard.press('Escape'); // 关浮层
      await expect(overlay(page)).not.toHaveAttribute('open', '');
    });

    await test.step('ppnt mark check --note：右栏的状态与 agent 回复实时跟上', async () => {
      await ppnt(['mark', 'e2e-project/commit-confirm', `#${plainN}`, 'check', '--note', '间距放大了']);
      const card = rail.locator(`.pp-thread[data-kind="canvas"][data-n="${plainN}"]`);
      await expect(card.locator('.pp-n')).toHaveAttribute('data-st', 'check');
      await expect(card.locator('.pp-st')).toHaveText('check');
      await expect(card.locator('.msg[data-who="agent"] .text')).toHaveText('间距放大了');
      await expect(page.locator('[data-pp-canvas][data-pp-section="variants"] [data-pp-badge]')).toHaveText('1 条标注');
    });

    await test.step('点右栏的画布标注：开画布浮层，定位到那颗钉子并打开它', async () => {
      const at = await scrollOf(page);
      await rail.locator(`.pp-thread[data-kind="canvas"][data-n="${plainN}"] .msg .text`).first().click();
      await expect(overlay(page)).toHaveAttribute('open', '');
      expect(hashOf(page)).toBe(`#canvas=variants&ann=${plainN}`);
      await expect.poll(() => overlayState(page).then((st) => st && st.landing), { timeout: 30_000 }).toBe(`ann:${plainN}`);
      await expect(canvasFrame(page).locator('#ann-box')).toBeVisible();
      await expect(canvasFrame(page).locator('#ann-input')).toContainText('太挤');
      await page.keyboard.press('Escape'); // 先关标注框
      await expect(canvasFrame(page).locator('#ann-box')).toBeHidden();
      await expect(overlay(page)).toHaveAttribute('open', '');
      await page.keyboard.press('Escape');
      await expect(overlay(page)).not.toHaveAttribute('open', '');
      await expect.poll(() => scrollOf(page)).toEqual(at);
    });

    await test.step('完成：原地收成一行（仍在两条评论之间），盘上 close，卡片头不再计它；展开、重新打开', async () => {
      const card = rail.locator(`.pp-thread[data-kind="canvas"][data-n="${plainN}"]`);
      await card.getByRole('button', { name: '完成' }).click();
      await expect(card).toHaveClass(/\bpp-closed\b/);
      await expect(card.locator('.pp-closed-word')).toHaveText('已关闭');
      await expect(card.locator('.pp-closed-peek')).toHaveText('“确认卡” 太挤');
      await expect.poll(kinds).toEqual([`prose:${proseN['p-why']}`, `canvas:${doneN}`, `canvas:${plainN}`, `prose:${proseN['p-mixed']}`]);
      await expect.poll(() => diskRows().find((r) => r.n === plainN).status).toBe('close');
      await expect(page.locator('[data-pp-canvas][data-pp-section="variants"] [data-pp-badge]')).toBeHidden();
      // agent 的回复和行上的其他字段原样留着。
      const row = diskRows().find((r) => r.n === plainN);
      expect(row.messages.map((m) => m.text)).toEqual(['间距放大了']);
      expect(row.images).toEqual([{ file: 'e2e-rail-shot.png' }]);

      await card.locator('[data-act="expand"]').click();
      await expect(card.getByRole('button', { name: '重新打开' })).toBeVisible();
      await card.getByRole('button', { name: '重新打开' }).click();
      await expect(card.locator('.pp-n')).toHaveAttribute('data-st', 'open');
      await expect.poll(() => diskRows().find((r) => r.n === plainN).status).toBe('open');
      await expect(page.locator('[data-pp-canvas][data-pp-section="variants"] [data-pp-badge]')).toHaveText('1 条标注');
    });

    await test.step('刷新：右栏照样穿插，已关闭的收着', async () => {
      await rail.locator(`.pp-thread[data-kind="canvas"][data-n="${doneN}"]`).getByRole('button', { name: '完成' }).click();
      await proseSettled(page);
      await page.reload();
      await expect(page.locator('#article .prose h1')).toHaveText('提交前确认');
      await proseSettled(page);
      await expect.poll(kinds).toEqual([`prose:${proseN['p-why']}`, `canvas:${doneN}`, `canvas:${plainN}`, `prose:${proseN['p-mixed']}`]);
      await expect(rail.locator(`.pp-thread[data-n="${doneN}"]`)).toHaveClass(/\bpp-closed\b/);
      await expect(page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-pp-badge]')).toBeHidden();
    });
  } finally {
    await closeSettled(page);
    clear();
  }
  expect(pageErrors).toEqual([]);
});
