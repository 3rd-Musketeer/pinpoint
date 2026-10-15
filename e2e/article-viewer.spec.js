import { expect, test } from '@playwright/test';

import { POP_CLOSE_MS } from '../site/src/lib/client.js';
import { E2E_BASE_URL } from './env.js';
import { proseSettled } from './lib/prose.js';
import { waitNoReload } from './site-settle.js';

// pp3：正文里的画布浮层与 [[ ]] 悬停 popup（site/README.md「画布浮层」「[[ ]] 引用」）。
// 固件：常驻 project e2e-project 的 commit-confirm（e2e/project-site/）。有画布的三节：
// 2 confirm（confirm-sheet 带一个能点的按钮、confirm-done）、3 variants（card-plain，comp）、
// 4 mixed（手机帧 + 帧级 comp）。纯文字的 1 why 不进浮层的上一节 / 下一节。
// 文章页只显示节号；画布上同样这几节是字母 B、C、D（A 是 why），只在画布、ppnt、标注里出现。
//
// 文件名排在 article-site 后面：那个 spec 要看站点冷启动（idle → 503 → 文章），同组时得先跑它。
// 单独成组时这里也可能撞上冷启动，所以第一次打开文章等得久一些。

const ARTICLE = '/e2e-project/commit-confirm/';
const CANVAS_PAGE = 'e2e-project_commit-confirm';
// 浮层里手机帧量的是机身，组件帧量组件台（canvas-card-client.js measureStage device）。
const STAGE = '.ios-device, .wb-comp-stage, .wb-doc-stage';

const overlay = (page) => page.locator('dialog[data-pp-overlay]');
const hashOf = (page) => decodeURIComponent(new URL(page.url()).hash);
const activeInfo = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return {
    inOverlay: !!a?.closest?.('[data-pp-overlay]'),
    tag: a?.tagName || '',
    frame: a?.closest?.('.cc-frame')?.dataset.screen || '',
    hit: !!a?.matches?.('.cc-hit'),
  };
});

/** 每一帧的 box 宽 ÷ 帧里机身 / 组件台的原始宽：浮层里所有帧应当是同一个数（= strip 的 data-scale）。 */
const frameScales = (page) => page.locator('[data-pp-overlay] .ov-box').evaluateAll((boxes, sel) => boxes.map((box) => {
  const iframe = box.querySelector('iframe');
  const stage = iframe?.contentDocument?.querySelector(sel);
  if (!stage) return null;
  return box.getBoundingClientRect().width / stage.getBoundingClientRect().width;
}), STAGE);

async function openArticle(page, url = ARTICLE) {
  await page.goto(url);
  await expect(page.locator('#article .prose h1')).toHaveText('提交前确认', { timeout: 150_000 });
  await waitNoReload(page);
  await expect(page.locator('#article .prose h1')).toHaveText('提交前确认');
}

test('画布浮层：点帧打开不跳转、帧可交互、同一缩放、焦点 / hash / 后退 / 换节、手机全屏', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await openArticle(page);
  consoleErrors.length = 0; // 冷启动那几次 503 记成 Failed to load resource
  await proseSettled(page);

  await test.step('卡片缩略图仍不可交互；点卡片里的 confirm-done → 浮层，不导航', async () => {
    const thumb = page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-screen="confirm-sheet"] iframe');
    await expect(thumb).toHaveCSS('pointer-events', 'none');
    await expect(thumb).toHaveAttribute('tabindex', '-1');
    await page.evaluate(() => { window.__sameDoc = true; });
    await page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-screen="confirm-done"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    expect(new URL(page.url()).pathname).toBe(ARTICLE);
    expect(hashOf(page)).toBe('#overlay=confirm&frame=confirm-done');
    expect(await page.evaluate(() => window.__sameDoc)).toBe(true);
    await expect(page.locator('html')).toHaveClass(/\bpp-ov-lock\b/);
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  });

  await test.step('头部：节号、标题、帧数、打开画布；两帧并排，图注只有帧 id，点的那一帧高亮', async () => {
    const ov = overlay(page);
    await expect(ov.locator('[data-ov-num]')).toHaveText('2');
    await expect(ov.locator('[data-ov-title]')).toHaveText('确认卡');
    await expect(ov.locator('[data-ov-meta]')).toHaveText('2 帧');
    await expect(ov.locator('[data-ov-canvas]')).toHaveAttribute('href', `/workbench/?page=${CANVAS_PAGE}&section=confirm`);
    await expect(ov.locator('.ov-frame .cap')).toHaveText(['confirm-sheet', 'confirm-done']);
    await expect(ov.locator('.ov-frame[data-screen="confirm-done"]')).toHaveClass(/\bflash\b/);
    await expect(ov.locator('.ov-frame iframe')).toHaveCount(2);
    expect(await ov.locator('.ov-frame iframe').evaluateAll((els) => els.map((el) => new URL(el.src).search))).toEqual(
      ['confirm-sheet', 'confirm-done'].map((f) => `?page=${CANVAS_PAGE}&screen=${f}&annotate=off&embed=card`));
    await expect(ov.locator('.ov-box[data-fitted="1"]')).toHaveCount(2);
    await expect(ov.locator('[data-ov-prev]')).toBeDisabled(); // 1 是纯文字，2 是第一个有画布的节
    await expect(ov.locator('[data-ov-next]')).toBeEnabled();
  });

  await test.step('尺寸：手机按真实比例，按视口高度放到最大、不超过真实大小，两帧同一缩放', async () => {
    const scale = Number(await page.locator('[data-ov-strip]').getAttribute('data-scale'));
    expect(scale).toBeGreaterThan(0.5);
    expect(scale).toBeLessThanOrEqual(1);
    const boxes = await page.locator('[data-pp-overlay] .ov-box').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    const strip = await page.locator('[data-ov-strip]').boundingBox();
    for (const b of boxes) {
      expect(b.width / b.height).toBeCloseTo(402 / 874, 2); // 机身 .ios-device
      expect(b.bottom).toBeLessThanOrEqual(strip.y + strip.height); // 不用竖向滚动
    }
    for (const s of await frameScales(page)) expect(s).toBeCloseTo(scale, 2);
  });

  await test.step('帧可交互：点帧里的按钮，帧里的字变了', async () => {
    const frame = page.frameLocator('[data-pp-overlay] [data-screen="confirm-sheet"] iframe');
    await expect(frame.locator('.e2e-tap-out')).toHaveText('未确认');
    await frame.locator('.e2e-tap').click();
    await expect(frame.locator('.e2e-tap-out')).toHaveText('已确认');
    // 卡片里的同一帧没有跟着变（浮层是新开的 iframe）。
    await expect(page.frameLocator('[data-pp-canvas] [data-screen="confirm-sheet"] iframe').locator('.e2e-tap-out')).toHaveText('未确认');
  });

  await test.step('浮层里选字不出正文“评论”', async () => {
    // 等正文评论客户端判过这次选区（松开鼠标就判，selection().checks 加一），再看它没给“评论”。
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

  await test.step('焦点困在浮层里（含帧里的按钮）；Esc（焦点在帧里也行）关闭，焦点回到点的那一帧', async () => {
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      expect((await activeInfo(page)).inOverlay, `Tab ${i + 1}`).toBe(true);
    }
    // 把焦点放进帧里的按钮，再按 Esc：帧把 Esc 转给文章页。
    await page.frameLocator('[data-pp-overlay] [data-screen="confirm-sheet"] iframe').locator('.e2e-tap').focus();
    expect((await activeInfo(page)).tag).toBe('IFRAME');
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => hashOf(page)).toBe('');
    expect(await activeInfo(page)).toMatchObject({ inOverlay: false, hit: true, frame: 'confirm-done' });
    await expect(page.locator('html')).not.toHaveClass(/\bpp-ov-lock\b/);
    await expect(page.locator('[data-pp-overlay] iframe')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(ARTICLE);
  });

  await test.step('后退关浮层、前进再打开；关闭按钮；点暗色区域关闭', async () => {
    await page.locator('[data-pp-canvas][data-pp-section="variants"] [data-screen="card-plain"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    expect(hashOf(page)).toBe('#overlay=variants&frame=card-plain');
    await page.goBack();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    expect(hashOf(page)).toBe('');
    await expect(page.locator('#article .prose h1')).toHaveText('提交前确认');
    await page.goForward();
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('3');
    await overlay(page).locator('[data-ov-close]').click();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => hashOf(page)).toBe('');
    expect(new URL(page.url()).pathname).toBe(ARTICLE);
    expect(await page.evaluate(() => window.__sameDoc)).toBe(true);

    await page.locator('[data-pp-canvas][data-pp-section="variants"] [data-screen="card-plain"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    await page.mouse.click(8, 450); // 面板外 24 px 的暗色边
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => hashOf(page)).toBe('');
  });

  await test.step('直接带 #overlay= 打开文章：浮层打开；关闭只去掉 hash，留在文章上', async () => {
    await page.goto('/e2e-project/');
    await openArticle(page, `${ARTICLE}#overlay=variants`);
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('[data-ov-title]')).toHaveText('卡片做法');
    await overlay(page).locator('[data-ov-close]').click();
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    expect(page.url()).toBe(`${E2E_BASE_URL}${ARTICLE}`);
    expect((await activeInfo(page)).frame).toBe('card-plain');
  });

  await test.step('换节：→ / ← 与按钮，只在有画布的节之间走，hash 跟着换', async () => {
    await page.locator('[data-pp-canvas][data-pp-section="variants"] [data-screen="card-plain"] .cc-hit').click();
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('3');
    await page.keyboard.press('ArrowRight');
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('4');
    await expect(overlay(page).locator('[data-ov-title]')).toHaveText('手机和裸卡片');
    await expect(overlay(page).locator('.ov-frame .cap')).toHaveText(['mixed-phone', 'mixed-bare']);
    expect(hashOf(page)).toBe('#overlay=mixed');
    await expect(overlay(page).locator('[data-ov-next]')).toBeDisabled();
    await page.keyboard.press('ArrowRight');
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('4');
    // 混排：手机帧与裸组件同一缩放（裸组件比手机矮，不被当成手机）。
    await expect(overlay(page).locator('.ov-box[data-fitted="1"]')).toHaveCount(2);
    const scale = Number(await page.locator('[data-ov-strip]').getAttribute('data-scale'));
    for (const s of await frameScales(page)) expect(s).toBeCloseTo(scale, 2);
    await expect(overlay(page).locator('[data-screen="mixed-bare"] .ov-box')).toHaveClass(/\bnatural\b/);
    await overlay(page).locator('[data-ov-prev]').click();
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('3');
    await page.keyboard.press('ArrowLeft');
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('2');
    expect(hashOf(page)).toBe('#overlay=confirm');
    // 换过节：关闭后焦点落在当前节（2 confirm）卡片的帧上。
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await expect.poll(() => hashOf(page)).toBe('');
    expect(await activeInfo(page)).toMatchObject({ hit: true, frame: 'confirm-sheet' });
    await expect(page.locator('[data-pp-canvas][data-pp-section="confirm"]')).toBeInViewport();
  });

  await test.step('390 宽：整屏 sheet，帧按宽度缩，横向滑，页面不横向溢出', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-pp-canvas][data-pp-section="confirm"]').scrollIntoViewIfNeeded();
    await page.locator('[data-pp-canvas][data-pp-section="confirm"] [data-screen="confirm-sheet"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('.ov-box[data-fitted="1"]')).toHaveCount(2);
    const panel = await overlay(page).locator('.ov-panel').boundingBox();
    expect([panel.x, panel.y, panel.width, panel.height]).toEqual([0, 0, 390, 844]);
    const geo = await page.evaluate(() => {
      const strip = document.querySelector('[data-ov-strip]');
      return {
        docW: document.documentElement.scrollWidth,
        stripScroll: strip.scrollWidth > strip.clientWidth,
        boxes: [...document.querySelectorAll('[data-pp-overlay] .ov-box')].map((b) => b.getBoundingClientRect().width),
      };
    });
    expect(geo.docW).toBeLessThanOrEqual(390);
    expect(geo.stripScroll).toBe(true);
    for (const w of geo.boxes) expect(w).toBeLessThanOrEqual(390 - 32);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveAttribute('open', '');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

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

  await test.step('浮层：头部节号、上一节 / 下一节的提示、图注都不出字母', async () => {
    await page.locator('[data-pp-canvas][data-pp-section="variants"] [data-screen="card-plain"] .cc-hit').click();
    await expect(overlay(page)).toHaveAttribute('open', '');
    await expect(overlay(page).locator('[data-ov-num]')).toHaveText('3');
    await expect(overlay(page).locator('[data-ov-prev]')).toHaveAttribute('aria-label', '上一节：2 确认卡');
    await expect(overlay(page).locator('[data-ov-next]')).toHaveAttribute('aria-label', '下一节：4 手机和裸卡片');
    await expect(overlay(page).locator('.ov-frame .cap')).toHaveText(['card-plain']);
    expect(await overlay(page).innerText()).not.toMatch(FRAME_REF);
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
