import fs from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';
import { expect, test } from './lib/fixtures.js';

import { E2E_BASE_URL, E2E_DATA_DIR } from './env.js';
import { closeSettled } from './ledger-settle.js';
import { annotate } from './lib/annotate.js';
import { openWorkbench, stageForm } from './lib/workbench.js';

// 视口（2026-09-05，lib/viewport.js）：文档条目怎么被看 —— 窗口｜手机。owner 裁决：
// 「doc 本身就是要展示的终态，而 prototype app 有多屏，所以 doc 可以只展示 html 本身，
// 而 app 需要 section + frames」；要在手机上看的页面「应该给 html / url 加一个切换
// 不同 viewport 的功能」；用过第一版（文档摆上画布）之后：「html doc 的手机视图就
// 不需要画布了，直接就是一个自适应大小（大约 viewport 高度 90%）的手机 screen，
// 不需要状态栏和灵动岛；在画布上容易乱跑」。
//   · 窗口 = 文档形态：iframe 1:1 铺满舞台，横条中段只剩视口两段；
//   · 手机 = 同一个形态的第二种布局：iframe 的 CSS 视口恒为 402 × 874，整块屏缩到
//     可用区（舞台减掉横条那一带）高度的九成、居中；没有网格 / 缩放 / 图注 / 帧导航 /
//     导出，也没有状态栏 / 岛 / home 条；机壳跟设置走；
//   · 偏好按页记在 prefs.viewportByPage，跨 reload 保持；
//   · 标注锚点是元素选择器，窗口里标的在手机里照样在，反过来也一样。
// 固件 = e2e-dir（dir 条目，doc 壳，cards / doc 两屏）与 e2e-doc（dir 条目，单 doc 屏）。

const BUCKET = path.join(E2E_DATA_DIR, 'e2e-dir');
const DOC_FRAME = '#wb-board-panel [data-screen="doc"] iframe.wb-doc-frame';
const PHONE_SHELL = '#wb-board-panel [data-screen="doc"] .wb-phone-doc';
// 横条那一带 = gap × 2 + strip-h（wb-tokens.css：12 × 2 + 38）
const STRIP_BAND = 62;
const FILL = 0.9;

async function openDirDoc(page) {
  await openWorkbench(page);
  await page.locator('.wb-page[data-vpage="e2e-dir"]').click();
  // 纯文档页没有画布，条不渲染；条目顺序是 Cards → Doc，步进一次到 doc。
  await expect(page.locator('#wbtabbar')).toHaveCount(0);
  await page.locator('#wbentry-next').click();
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
}

function rootViewport(page) {
  return page.locator('#wbroot').evaluate((el) => el.getAttribute('data-viewport'));
}

/** 元素的布局尺寸（transform 之前的 CSS px）—— 手机视口里 iframe 的真实视口就是它。 */
function layoutSize(page, selector) {
  return page.locator(selector).evaluate((el) => [el.offsetWidth, el.offsetHeight]);
}

async function setViewport(page, key) {
  const generation = await page.evaluate(() => window.workbench.mountGeneration());
  await page.locator(`#wbviewport [data-viewport="${key}"]`).click();
  await expect(page.locator(`#wbviewport [data-viewport="${key}"]`)).toHaveAttribute('aria-pressed', 'true');
  // aria-pressed 来自偏好更新，早于异步装板；先确认新会话已开始，不能等到旧板的完成信号。
  await expect.poll(() => page.evaluate(() => window.workbench.mountGeneration())).toBeGreaterThan(generation);
  await boardSettled(page);
}

async function boardSettled(page) {
  await expect.poll(() => page.evaluate(() => window.workbench.whenBoardSettled())).toBe(true);
}

/** 手机屏的几何断言（ADR 0023：比 bounding box）：整块屏高 = 可用高 × 0.9（±1px），
    横向在整个舞台宽度里居中（左栏浮着，不让位），纵向在可用区里居中。 */
async function expectPhoneFit(page, shellSelector) {
  const stage = await page.locator('#wbstage').boundingBox();
  const shell = await page.locator(shellSelector).boundingBox();
  const usableH = stage.height - STRIP_BAND;
  expect(Math.abs(shell.height - usableH * FILL)).toBeLessThan(1);
  expect(Math.abs((shell.x + shell.width / 2) - (stage.x + stage.width / 2))).toBeLessThan(1);
  expect(Math.abs((shell.y + shell.height / 2) - (stage.y + usableH / 2))).toBeLessThan(1);
  return shell;
}

test.afterEach(async ({ page }) => {
  await closeSettled(page);
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

test('文档条目：默认窗口 1:1 铺满，切手机缩到可用高九成居中，没有画布也没有系统 chrome，切回即还原', async ({ page }) => {
  await openDirDoc(page);

  // 默认窗口态（原独立用例）：横条出「窗口｜手机」两段，1:1 铺满 = iframe 与
  // 舞台 bounding box 重合（ADR 0023：几何断言比 box）。
  // 允许装板中的过渡；几何批完成后形态必须已经生效，不能再轮询形态本身。
  await boardSettled(page);
  expect(await stageForm(page)).toBe('html');
  expect(await rootViewport(page)).toBe('window');
  const control = page.locator('#wbviewport');
  await expect(control).toBeVisible();
  await expect(control.locator('button')).toHaveText(['窗口', '手机']);
  await expect(control.locator('[data-viewport="window"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#wbstrip-kind')).toHaveText('文档');
  // 窗口视口：画布工具收起（阅读器没有画布可缩放），视口控件在中段独自出现。
  await expect(page.locator('#wbcanvas-tools')).toBeHidden();
  await expect(page.locator('#wbexport-open')).toBeHidden();
  const stage0 = await page.locator('#wbstage').boundingBox();
  const frame0 = await page.locator(DOC_FRAME).boundingBox();
  expect(Math.abs(frame0.x - stage0.x)).toBeLessThan(1);
  expect(Math.abs(frame0.y - stage0.y)).toBeLessThan(1);
  expect(Math.abs(frame0.width - stage0.width)).toBeLessThan(1);
  expect(Math.abs(frame0.height - stage0.height)).toBeLessThan(1);
  await expect(page.locator('#wb-board-panel .wb-screen--phone-doc')).toHaveCount(0);

  await setViewport(page, 'phone');

  // 还是文档形态（html），只是 data-viewport=phone；iframe 还是那一个 src。
  // setViewport 已等新一代板的几何批完成；此刻即时检查 CSS 钩，不给迟应用的形态宽限。
  expect(await stageForm(page)).toBe('html');
  expect(await rootViewport(page)).toBe('phone');
  const screen = page.locator('#wb-board-panel [data-screen="doc"]');
  await expect(screen).toHaveClass(/wb-screen--phone-doc/);
  await expect(screen.locator('.wb-phone-doc .ios-root .ios-device .ios-bezel .ios-screen > iframe.wb-doc-frame')).toHaveCount(1);
  await expect(page.locator(DOC_FRAME)).toHaveAttribute('src', /\/sites\/e2e-dir\/doc\.html$/);
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
  // iframe 的 CSS 视口恒为 402 × 874（页面按真实手机排版），渲染尺寸是它 × k。
  expect(await layoutSize(page, DOC_FRAME)).toEqual([402, 874]);
  const shell = await expectPhoneFit(page, PHONE_SHELL);
  const frame = await page.locator(DOC_FRAME).boundingBox();
  expect(Math.abs(frame.height - shell.height)).toBeLessThan(1);  // 机壳 无：屏就是整块
  expect(Math.abs(frame.width / 402 - frame.height / 874)).toBeLessThan(0.01);  // 等比
  expect(frame.height).toBeLessThan(874);  // 720 高的测试视口装不下 1:1，必然缩过

  // 没有系统 chrome：状态栏 / 岛 / home 条一个都没有；默认「机壳 无」= screen-only。
  await expect(screen.locator('.ios-island, .ios-statusbar, .ios-home')).toHaveCount(0);
  await expect(screen.locator('.ios-root')).toHaveClass(/screen-only/);
  // 没有画布：网格纹理关掉、zoom-wrap 不 transform、图注 / 尺寸行 / .ios-stage 都没有。
  expect(await page.locator('.wb-stage-wrap').evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  expect(await page.locator('#wb-board-panel .wb-zoom-wrap').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  await expect(page.locator('#wb-board-panel .ios-stage')).toHaveCount(0);
  await expect(page.locator('#wb-board-panel .wb-screen-dim')).toHaveCount(0);
  await expect(screen.locator('.wb-screen-cap')).toBeHidden();
  await expect(page.locator('#wb-board-panel .wb-lib-cap')).toBeHidden();
  // 另一份文档（cards）仍被条目显隐收起：舞台上只有一块屏。
  await expect(page.locator('#wb-board-panel [data-screen="cards"]')).toBeHidden();
  await expect(page.locator('#wb-board-panel .wb-doc-frame:visible')).toHaveCount(1);

  // 横条中段：只有视口两段；缩放 / 回中 / 导出 / 帧导航 / dock 都是画布工具，收起。
  await expect(page.locator('#wbviewport')).toBeVisible();
  await expect(page.locator('#wbcanvas-tools')).toBeHidden();
  await expect(page.locator('#wbzoom-label')).toBeHidden();
  await expect(page.locator('#wbrecenter')).toBeHidden();
  await expect(page.locator('#wbexport-open')).toBeHidden();
  await expect(page.locator('#wbsection-nav-position')).toBeHidden();
  await expect(page.locator('#wbstrip-kind')).toHaveText('文档');

  // 窗口尺寸变了 k 跟着重算：舞台变矮，屏跟着缩，仍然是可用高的九成、仍居中。
  await page.setViewportSize({ width: 1000, height: 560 });
  await expect.poll(async () => (await page.locator(PHONE_SHELL).boundingBox()).height).toBeLessThan(shell.height);
  await expectPhoneFit(page, PHONE_SHELL);
  expect(await layoutSize(page, DOC_FRAME)).toEqual([402, 874]);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(async () => Math.round((await page.locator(PHONE_SHELL).boundingBox()).height)).toBe(Math.round(shell.height));

  // 切回窗口：1:1 铺满，手机屏退场。
  await setViewport(page, 'window');
  // 新一代板已完成，切回也必须即时恢复文档形态。
  expect(await stageForm(page)).toBe('html');
  expect(await rootViewport(page)).toBe('window');
  await expect(page.locator('#wb-board-panel .wb-screen--phone-doc')).toHaveCount(0);
  await expect(page.locator('#wb-board-panel .wb-phone-doc')).toHaveCount(0);
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
  const stage = await page.locator('#wbstage').boundingBox();
  const back = await page.locator(DOC_FRAME).boundingBox();
  expect(Math.abs(back.width - stage.width)).toBeLessThan(1);
  expect(Math.abs(back.height - stage.height)).toBeLessThan(1);
  await expect(page.locator('#wbcanvas-tools')).toBeHidden();
  // 选中条目跟着回来（不是掉回默认的 cards）。
  await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('doc');

  // 画布页没有视口控件：画布条目没有第二种看法。
  await page.getByRole('tab', {name:'页面', exact:true}).click();
  await page.locator('.wb-page[data-vpage="e2e-dir-ios"]').click();
  await expect(page.locator('#wb-board-panel [data-screen="cards"] .ios-stage')).toBeVisible();
  await expect(page.locator('#wbviewport')).toHaveCount(0);
});

test('机壳「有」时手机屏带 iPhone 机身（仍无状态栏 / 岛 / home 条），整块机身装进可用高九成', async ({ page }) => {
  await openDirDoc(page);
  await setViewport(page, 'phone');
  await page.evaluate(() => {
    const prefs = JSON.parse(localStorage.getItem('pinpoint-wb') || '{}');
    prefs.frame = 'bezel';
    localStorage.setItem('pinpoint-wb', JSON.stringify(prefs));
  });
  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  const screen = page.locator('#wb-board-panel [data-screen="doc"]');
  await expect(screen.locator('.ios-root')).not.toHaveClass(/screen-only/);
  // 机身 = 屏幕 + 2 × (bezel 15 + frame 3)，与 iOS frame 同一份 ios-kit 取值；iframe 不变。
  expect(await layoutSize(page, '#wb-board-panel [data-screen="doc"] .ios-device')).toEqual([438, 910]);
  expect(await layoutSize(page, DOC_FRAME)).toEqual([402, 874]);
  await expect(screen.locator('.ios-island, .ios-statusbar, .ios-home')).toHaveCount(0);
  // 装进九成的是整块机身，屏在机身里等比缩。
  const shell = await expectPhoneFit(page, PHONE_SHELL);
  const frame = await page.locator(DOC_FRAME).boundingBox();
  expect(Math.abs(frame.height / 874 - shell.height / 910)).toBeLessThan(0.01);
  expect(frame.x).toBeGreaterThan(shell.x);
  expect(frame.x + frame.width).toBeLessThan(shell.x + shell.width);

  // 设置里切回「无」：屏当场重算（ResizeObserver 盯着屏的布局尺寸），不用重载。
  await page.evaluate(() => {
    document.querySelectorAll('#wb-board-panel .ios-root').forEach((r) => r.classList.add('screen-only'));
  });
  await expect.poll(async () => Math.round((await page.locator(DOC_FRAME).boundingBox()).height))
    .toBe(Math.round(shell.height));
});

test('视口偏好按页记在 prefs.viewportByPage 跨 reload 保持；手机视口不改文档 src', async ({ page }) => {
  // 偏好写入 / 删除的规则在 viewport.test.js（withViewportPref）已守，这里守
  // 集成行为：reload 保持、别的页不受影响、回窗口删 key、手机视口不改 src。
  await openDirDoc(page);
  await setViewport(page, 'phone');
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('pinpoint-wb')).viewportByPage
  )).toEqual({ 'e2e-dir': 'phone' });

  await page.reload();
  await page.waitForFunction(() => window.workbench && window.pinpoint);
  await page.waitForFunction(() => Boolean(document.querySelector('#wbroot')?.getAttribute('data-page-mode')));
  expect(await stageForm(page)).toBe('html');
  expect(await rootViewport(page)).toBe('phone');
  await expect(page.locator('#wbviewport [data-viewport="phone"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await layoutSize(page, DOC_FRAME)).toEqual([402, 874]);
  await expectPhoneFit(page, PHONE_SHELL);
  // 条目记忆也带回来：还是 doc，不是默认的 cards。
  await expect.poll(() => page.evaluate(() => window.workbench.activeEntryId())).toBe('doc');

  // 切到另一页：仍是窗口 —— 偏好按页记，互不沾染。
  const FRAME = '#wb-board-panel [data-screen="report"] iframe.wb-doc-frame';
  await page.locator('.wb-page[data-vpage="e2e-doc"]').click();
  await expect(page.frameLocator(FRAME).locator('h1')).toHaveText('Sample Report');
  expect(await rootViewport(page)).toBe('window');
  await expect(page.locator('#wbviewport [data-viewport="window"]')).toHaveAttribute('aria-pressed', 'true');

  // 切手机：src 不变，同一份文档在手机屏里跑。
  const src = await page.locator(FRAME).getAttribute('src');
  await setViewport(page, 'phone');
  await expect(page.locator(FRAME)).toHaveAttribute('src', src);
  await expect(page.frameLocator(FRAME).locator('h1')).toHaveText('Sample Report');
  expect(await layoutSize(page, FRAME)).toEqual([402, 874]);
  await expectPhoneFit(page, '#wb-board-panel [data-screen="report"] .wb-phone-doc');
  await expect(page.locator('#wbstrip-kind')).toHaveText('文档');

  // 两页各切回窗口，key 删净（默认值不积灰）。
  await page.locator('.wb-page[data-vpage="e2e-dir"]').click();
  await expect(page.locator('#wbviewport [data-viewport="phone"]')).toHaveAttribute('aria-pressed', 'true');
  await setViewport(page, 'window');
  await page.locator('.wb-page[data-vpage="e2e-doc"]').click();
  await setViewport(page, 'window');
  await expect.poll(() => page.evaluate(
    () => JSON.parse(localStorage.getItem('pinpoint-wb')).viewportByPage
  )).toEqual({});
});

test('标注跨视口：窗口里标的在手机里钉在缩过的同一元素上，手机里标的回窗口也在', async ({ page }) => {
  await openDirDoc(page);
  // 文档 1:1 铺满，左栏浮在它上面（design.md 外壳布局）：#doc-target 在页面左上角，
  // 被面板压住的正文靠收起面板来点。
  await page.locator('#wbside-toggle').click();
  await expect(page.locator('#wbroot')).toHaveClass(/wb-side-collapsed/);

  // 窗口视口：横条「标注」驱动的是 iframe 里那个实例；在 #doc-target 上标一条。
  await page.locator('#wbann-toggle').click();
  await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  await annotate(page.frameLocator(DOC_FRAME), '#doc-target', 'window mark');
  await expect(page.locator('#wbann-count')).toHaveText('1');
  await expect(page.frameLocator(DOC_FRAME).locator('.ann-badge')).toHaveCount(1);

  // 切手机：iframe 重载、客户端从磁盘水合，同一条标注钉在同一个元素上；计数照旧。
  await setViewport(page, 'phone');
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
  await expect(page.locator('#wbann-count')).toHaveText('1');
  const phoneDoc = page.frameLocator(DOC_FRAME);
  await expect(phoneDoc.locator('.ann-badge')).toHaveCount(1);
  // 钉子落在缩过的屏里、锚点元素旁：钉子与锚点的 box 都在 iframe 自己的坐标系里
  // （Playwright 给的是页面坐标，已经含 scale k），钉子必须落在 iframe 的显示矩形内、
  // 与锚点同一高度带，且锚点的显示宽 = 布局宽 × k（k = 显示宽 / 402）。
  const frameBox = await page.locator(DOC_FRAME).boundingBox();
  const k = frameBox.width / 402;
  expect(k).toBeLessThan(1);
  const badge = await phoneDoc.locator('.ann-badge').first().boundingBox();
  const target = await phoneDoc.locator('#doc-target').boundingBox();
  const targetLayoutW = await phoneDoc.locator('#doc-target').evaluate((el) => el.offsetWidth);
  expect(Math.abs(target.width - targetLayoutW * k)).toBeLessThan(1.5);
  expect(badge).not.toBeNull();
  expect(Math.abs(badge.y - target.y)).toBeLessThan(target.height + 40 * k);
  expect(badge.x).toBeGreaterThanOrEqual(frameBox.x - 1);
  expect(badge.x + badge.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);
  expect(badge.y).toBeGreaterThanOrEqual(frameBox.y - 1);

  // 手机视口里再标一条（第二个目标），保存到同一个桶。
  await page.locator('#wbann-toggle').click();
  await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  await annotate(page.frameLocator(DOC_FRAME), '#doc-target-2', 'phone mark');
  await expect(page.locator('#wbann-count')).toHaveText('2');
  await expect(phoneDoc.locator('.ann-badge')).toHaveCount(2);

  // 回窗口：两条都在，序号不变。
  await setViewport(page, 'window');
  await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
  await expect(page.locator('#wbann-count')).toHaveText('2');
  await expect(page.frameLocator(DOC_FRAME).locator('.ann-badge')).toHaveCount(2);
  await expect(page.frameLocator(DOC_FRAME).locator('.ann-badge')).toHaveText(['1', '2']);
  // 账本落在 e2e-dir 桶（与 /sites/ 直开同一个）。
  expect(fs.readdirSync(BUCKET).filter((n) => n.endsWith('.json') && n !== '_seq.json').length).toBe(1); // _seq.json 是桶级计数器不是账本（M1）
});

// 2026-10-14 owner：「我在手机视图下标注，出来的是整个页面」。文档条目的标注归 iframe 里
// 那个实例；父窗口（工作台）实例若还开着标注（画布页上开的没关就切过来，或焦点在工作台上
// 按了 A），手机视口里舞台露在手机屏四周，它的命中落到整节（框 = 整个舞台）或 iframe 元素
// （整份文档）。窗口视口里 iframe 盖满舞台，父实例碰不到东西，所以只在手机里出事。
test('手机视口标注：父实例停在交互态、A 键驱动文档实例，标出来的是点中的元素不是整页', async ({ page }) => {
  await test.step('画布页上开的标注不跟到文档条目上', async () => {
    await openWorkbench(page, 'page=e2e-ios');
    await expect(page.locator('#wb-board-panel .wb-lib-item').first()).toBeVisible();
    await page.locator('#wbann-toggle').click();
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.pinpoint.getState().mode)).toBe(true);
    await page.locator('.wb-page[data-vpage="e2e-dir"]').click();
    await page.locator('#wbentry-next').click();
    await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
    await setViewport(page, 'phone');
    await expect(page.frameLocator(DOC_FRAME).locator('#doc-title')).toHaveText('E2E dir-site doc');
    await expect.poll(() => page.evaluate(() => window.pinpoint.getState().mode)).toBe(false);
  });

  const doc = page.frameLocator(DOC_FRAME);
  await test.step('焦点在工作台上按 A：开的是文档实例（横条跟着亮），父实例不动', async () => {
    await page.locator(`#wbviewport [data-viewport="phone"]`).focus();
    await page.waitForFunction((sel) => {
      const f = document.querySelector(sel);
      return !!(f && f.contentWindow && f.contentWindow.pinpoint);
    }, DOC_FRAME);
    await page.keyboard.press('a');
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.pinpoint.getState().mode)).toBe(false);
  });

  await test.step('手机屏外的舞台不可标：没有整舞台的高亮框，点了也不开输入框', async () => {
    const frameBox = await page.locator(DOC_FRAME).boundingBox();
    const outside = { x: frameBox.x - 40, y: frameBox.y + frameBox.height / 2 };
    await page.mouse.move(outside.x, outside.y);
    await page.mouse.move(outside.x + 4, outside.y + 4);
    await expect(page.locator('.ann-hover-ghost:not([hidden])')).toHaveCount(0);
    await page.mouse.click(outside.x, outside.y);
    await expect(page.locator('#ann-box')).toHaveCount(0);
    expect(await page.evaluate(() => (window.pinpoint.pageMarks || []).length)).toBe(0);
  });

  await test.step('点中的元素：账本行的目标与 rect 就是它（iframe 自己的 CSS px），不是整页', async () => {
    await annotate(page.frameLocator(DOC_FRAME), '#doc-target', 'phone pick');
    await expect(page.locator('#wbann-count')).toHaveText('1');
    const el = await doc.locator('#doc-target').evaluate((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, docW: document.documentElement.clientWidth, docH: document.documentElement.scrollHeight };
    });
    expect(el.docW).toBe(402);
    let row = null;
    await expect.poll(() => {
      const files = fs.existsSync(BUCKET) ? fs.readdirSync(BUCKET).filter((n) => n.endsWith('.json') && n !== '_seq.json') : [];
      const rows = files.flatMap((n) => JSON.parse(fs.readFileSync(path.join(BUCKET, n), 'utf8')).annotations || []);
      row = rows.find((m) => /phone pick/.test(m.content || '')) || null;
      return !!row;
    }).toBe(true);
    expect(row.type).toBe('element');
    expect(row.targets[0].selector).toMatch(/#doc-target$|p:nth-of-type\(1\)$/);
    expect(row.targets[0].text).toContain('A standalone document');
    const [x, y, w, h] = row.rect;
    expect(Math.abs(x - el.x)).toBeLessThan(2);
    expect(Math.abs(y - el.y)).toBeLessThan(2);
    expect(Math.abs(w - el.w)).toBeLessThan(2);
    expect(Math.abs(h - el.h)).toBeLessThan(2);
    expect(h).toBeLessThan(el.docH / 4);
    // 工作台自己的账本里没有任何一条（整节 / 整个 iframe 那种）。
    expect(await page.evaluate(() => (window.pinpoint.pageMarks || []).length)).toBe(0);
  });
});

// 2026-10-15 owner：「html 页面手机视图把滚动条去掉，另外标注气泡会被遮住」。
// 手机屏里的 iframe 文档根有一条 15px 的常显竖条（经典滚动条），手机上没有；贴视口右边的块上的钉子
// 默认落在框的右上角外侧（框外扩 4px 再出去半个钉子），被 #ann-overlay 的 overflow 裁掉一截。
// 两件事无关：没有滚动条时钉子照样被裁（视口边换了个位置而已）。
// Playwright 默认带 --hide-scrollbars 启动 Chromium（滚动条一律 0 宽），这条单独起一个不带它的浏览器。
test('手机视口：文档根没有滚动条但照样能滚，内容自己的横滑条还在；贴右边的钉子整枚落在视口内（窗口视口同样）', async () => {
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  const page = await browser.newPage({ baseURL: E2E_BASE_URL, viewport: { width: 1280, height: 900 } });
  const doc = page.frameLocator(DOC_FRAME);
  const measure = () => doc.locator('html').evaluate(() => {
    const de = document.documentElement;
    const wrap = document.getElementById('doc-table-wrap');
    const ov = document.getElementById('ann-overlay').getBoundingClientRect();
    const b = document.querySelector('.ann-badge').getBoundingClientRect();
    return {
      rootBar: innerWidth - de.clientWidth, rootBarStyle: getComputedStyle(de).scrollbarWidth,
      tableBar: wrap.offsetHeight - wrap.clientHeight, wrapRight: wrap.getBoundingClientRect().right,
      overlay: [ov.left, ov.top, ov.right, ov.bottom], badge: [b.left, b.top, b.right, b.bottom],
    };
  });
  /** 整枚钉子（22px）在 overlay 的可见区里，离边至少 2px（白环）。 */
  const expectBadgeInside = (m) => {
    expect(m.badge[0]).toBeGreaterThanOrEqual(m.overlay[0] + 2);
    expect(m.badge[1]).toBeGreaterThanOrEqual(m.overlay[1] + 2);
    expect(m.badge[2]).toBeLessThanOrEqual(m.overlay[2] - 2);
    expect(m.badge[3]).toBeLessThanOrEqual(m.overlay[3] - 2);
  };
  try {
    await openDirDoc(page);
    await page.locator('#wbside-toggle').click();
    await page.locator('#wbann-toggle').click();
    await expect(page.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
    await annotate(doc, '#doc-table-title', 'edge mark');
    await expect(doc.locator('.ann-badge')).toHaveCount(1);

    await test.step('窗口视口照旧：文档根的竖条还在；钉子收进视口', async () => {
      const m = await measure();
      expect(m.rootBar).toBeGreaterThan(0);
      expect(m.rootBarStyle).toBe('auto');
      expect(Math.abs(m.wrapRight - m.overlay[2])).toBeLessThan(1); // 块贴着视口右边
      expectBadgeInside(m);
    });

    await test.step('手机视口：文档根滚动条宽 0、表格自己的横滑条还在；钉子整枚在屏内', async () => {
      await setViewport(page, 'phone');
      await expect(doc.locator('#doc-title')).toHaveText('E2E dir-site doc');
      await expect(doc.locator('.ann-badge')).toHaveCount(1);
      await expect.poll(async () => (await measure()).rootBar).toBe(0);
      const m = await measure();
      expect(m.rootBarStyle).toBe('none');
      expect(m.tableBar).toBeGreaterThan(0);
      expect(m.overlay[2] - m.overlay[0]).toBe(402);
      expect(Math.abs(m.wrapRight - 402)).toBeLessThan(1);
      expectBadgeInside(m);
      // 父页面坐标里也一样：钉子在 iframe 的显示矩形内（含缩放 k）。
      const frameBox = await page.locator(DOC_FRAME).boundingBox();
      const badge = await doc.locator('.ann-badge').first().boundingBox();
      expect(badge.x + badge.width).toBeLessThanOrEqual(frameBox.x + frameBox.width);
    });

    await test.step('没有滚动条也照样能滚：滚轮滚动文档根', async () => {
      const frameBox = await page.locator(DOC_FRAME).boundingBox();
      await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
      await page.mouse.wheel(0, 600);
      await expect.poll(() => doc.locator('html').evaluate(() => scrollY)).toBeGreaterThan(0);
    });
    await closeSettled(page);
  } finally {
    await browser.close();
  }
});
