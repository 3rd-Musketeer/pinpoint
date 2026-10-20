import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from './lib/fixtures.js';
import { boardReady, focusOwnerFrame, metric, ownerCleanup, seedOwner } from './lib/owner-flows.js';
import { OWNER_PAGE } from './lib/owner-fixture.js';

// E3 视口裁剪（2026-10-19）：画布上的固定尺寸手机 stage（.wb-screen > .ios-stage）
// 用 content-visibility:auto 跳过视口外子树渲染。跳过与否只有浏览器答得上来
// （checkVisibility 要看跳过根「子树内」的元素——跳过根自己的盒子恒算可见），
// 所以这组行为全是 e2e；离线分享页的显式退回在 offline-page-export.test.js 单测守。

/** 画布上手机 stage 的 { 总数, 未跳过渲染数 }。 */
function stageRenderCounts(scope) {
  return scope.evaluate(() => {
    const stages = [...document.querySelectorAll('.wb-screen > .ios-stage')];
    return {
      total: stages.length,
      rendering: stages.filter((el) => {
        const probe = el.querySelector('.ios-device') || el.firstElementChild;
        return probe && probe.checkVisibility({ contentVisibilityAuto: true });
      }).length,
    };
  });
}

test('owner 大画布性能门：打开后视口外的手机 stage 跳过渲染，帧照旧全量挂载', async ({ page }, testInfo) => {
  await page.goto(`/workbench/?page=${OWNER_PAGE}`);
  await boardReady(page);
  // 视口存档按页恢复，落点一变未跳过数就变。先点 HUD 读数回到 100%
  // （视觉 scale 0.5），再滚回首访定位：内容在视口左上，不在留白里。
  // scrollTo(0, 0) 会滚进画布四周的 pad，一帧都看不见。场中或缩到 50%
  // 时未跳过数贴到旧上限 40，首访位置才有余量。
  await page.locator('#wbzoom-label').click();
  await expect(page.locator('#wbzoom-label')).toHaveText('100%');
  await page.evaluate(() => {
    // 与 board-nav.frameBoardInView 同一套：pad 减去 40，再让开左栏和顶部返回条。
    const stage = document.getElementById('wbstage');
    const panel = document.getElementById('wb-board-panel');
    const cs = getComputedStyle(panel);
    const stageRect = stage.getBoundingClientRect();
    const gap = 12;
    const side = document.getElementById('wbside');
    const leftInset = side && side.getBoundingClientRect().width > 1
      ? Math.max(0, side.getBoundingClientRect().right - stageRect.left + gap) : 0;
    const back = document.getElementById('wbback');
    const topInset = back && back.getBoundingClientRect().height > 1
      ? Math.max(0, back.getBoundingClientRect().bottom - stageRect.top + gap) : 0;
    const left = Math.max(0, (parseFloat(cs.paddingLeft) || 0) - 40 - leftInset);
    const top = Math.max(0, (parseFloat(cs.paddingTop) || 0) - 40 - topInset);
    return window.workbench.scrollTo({ left, top }, { smooth: false });
  });
  await page.evaluate(() => window.workbench.whenScrollSettled());
  // 程序跳转先给落点打 data-cv-keep，两帧后摘掉，cv 再自己接管。
  // 摘掉的那一帧计数会掉到 0，所以等到场上真有帧在渲染再数。
  await expect.poll(() => stageRenderCounts(page).then((c) => c.rendering)).toBeGreaterThan(0);
  const counts = await stageRenderCounts(page);
  const visible = await page.evaluate(() => {
    const view = document.getElementById('wbstage').getBoundingClientRect();
    return [...document.querySelectorAll('.wb-screen > .ios-stage')].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.right > view.left && rect.left < view.right && rect.bottom > view.top && rect.top < view.bottom;
    }).length;
  });
  await metric(testInfo, 'canvas-clipping', { ...counts, visible });
  // 裁剪是渲染层面的：DOM 一个不卸，远处帧的锚点测量、导航几何全靠这一点。
  expect(counts.total).toBe(97);
  // cv 邻域约含视口外 50% 边距，渲染数随视口涨。1440×1000、首访位置、
  // HUD 100% 实测看得见 10 帧、渲染 32（上下各多出约一排）。门不跟视口绑死：
  // 未跳过数不超过「场上看得见的帧 × 4」，32 ≤ 40，留一排余量；视口更大时
  // 看得见的帧同比例变多。放回裁剪前 97 帧全在渲染，看得见的仍是十几帧，必挂。
  expect(visible).toBeGreaterThan(0);
  expect(counts.rendering).toBeGreaterThan(0);
  expect(counts.rendering).toBeLessThanOrEqual(visible * 4);
});

test('视口裁剪不破坏几何消费：远处帧真实尺寸，focusFrame 带帧进来即恢复渲染', async ({ page }) => {
  await page.goto(`/workbench/?page=${OWNER_PAGE}`);
  await boardReady(page);
  // 视口存档按页恢复（pageViewports），先显式回顶拿到确定的起点。
  await page.evaluate(() => window.workbench.scrollTo({ left: 0, top: 0 }, { smooth: false }));
  await page.evaluate(() => window.workbench.whenScrollSettled());
  const farStage = page.locator('[data-screen="flow-090"] > .ios-stage');

  await test.step('跳过渲染的远处帧，几何仍是真实值（定位 / 标注锚点测量的共同前提）', async () => {
    const probe = await farStage.evaluate((el) => {
      const inner = el.querySelector('.ios-device') || el.firstElementChild;
      const r = el.getBoundingClientRect();
      return {
        skipped: !inner.checkVisibility({ contentVisibilityAuto: true }),
        width: r.width,
        height: r.height,
      };
    });
    // 前提本身要成立：开在场顶时 flow-090 确实在视口外被跳过。
    expect(probe.skipped).toBe(true);
    // 缩放基准 0.5 下 438×910 → 219×455；contain-intrinsic-size 兜住这个尺寸。
    expect(probe.width).toBeGreaterThanOrEqual(218);
    expect(probe.width).toBeLessThanOrEqual(220);
    expect(probe.height).toBeGreaterThanOrEqual(454);
    expect(probe.height).toBeLessThanOrEqual(456);
  });

  await test.step('focusFrame 到远处帧：跳过解除，帧完整落进舞台视口', async () => {
    const screen = await focusOwnerFrame(page, 90);
    // cv 的相关性随滚动在渲染管线里更新；满载机器上给足轮询余量。
    await expect.poll(() => farStage.evaluate((el) => {
      const inner = el.querySelector('.ios-device') || el.firstElementChild;
      return inner.checkVisibility({ contentVisibilityAuto: true });
    }), { timeout: 15_000 }).toBe(true);
    await expect(screen.locator('[data-owner-result]')).toHaveText('尚未确认');
  });
});

test('程序跳转的落点没有空白帧：相交的 stage 在滚动期间一直在渲染', async ({ page }) => {
  await page.goto(`/workbench/?page=${OWNER_PAGE}`);
  await boardReady(page);
  await page.evaluate(() => window.workbench.scrollTo({ left: 0, top: 0 }, { smooth: false }));
  await page.evaluate(() => window.workbench.whenScrollSettled());
  // 每个 rAF 数“与舞台视口相交、但仍被 content-visibility 跳过”的 stage。
  // 跳转前的预渲染（data-cv-keep）没接上时，远距离 focusFrame 的头几帧必大于 0。
  await page.evaluate(() => {
    const stageEl = document.getElementById('wbstage');
    const stages = [...document.querySelectorAll('.wb-screen > .ios-stage')];
    window.__cvBlank = { frames: 0, blankFrames: 0, maxBlank: 0, run: true };
    const tick = () => {
      if (!window.__cvBlank.run) return;
      const view = stageEl.getBoundingClientRect();
      let blank = 0;
      for (const el of stages) {
        const rect = el.getBoundingClientRect();
        if (rect.right < view.left || rect.left > view.right || rect.bottom < view.top || rect.top > view.bottom) continue;
        const probe = el.querySelector('.ios-device') || el.firstElementChild;
        if (probe && !probe.checkVisibility({ contentVisibilityAuto: true })) blank += 1;
      }
      const probeState = window.__cvBlank;
      probeState.frames += 1;
      if (blank) {
        probeState.blankFrames += 1;
        probeState.maxBlank = Math.max(probeState.maxBlank, blank);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const jumps = [
    ['part-12', 'flow-097', false],
    ['part-1', 'flow-001', false],
    ['part-6', 'flow-044', true],
    ['part-9', 'flow-070', true],
  ];
  for (const [section, frame, smooth] of jumps) {
    await page.evaluate(([sectionId, frameId, smoothJump]) => {
      return window.workbench.focusFrame(sectionId, frameId, { smooth: smoothJump });
    }, [section, frame, smooth]);
    await page.evaluate(() => window.workbench.whenScrollSettled());
  }
  // goToMark 经 focusFrame 进同一条滚动；种子标注一半是全局 selector，落点帧不随
  // 标注走，但跳转本身仍会经过 scrollStageTo。
  await page.evaluate(() => window.pinpoint.goToMark(window.pinpoint.marks[0].n));
  await page.evaluate(() => window.workbench.whenScrollSettled());

  const probe = await page.evaluate(() => {
    window.__cvBlank.run = false;
    return window.__cvBlank;
  });
  expect(probe.frames).toBeGreaterThan(0);
  expect(probe.blankFrames).toBe(0);
  expect(probe.maxBlank).toBe(0);
});

test('导出的离线 HTML 不带视口裁剪：分享页的 stage 全量渲染', async ({ request, page }) => {
  const response = await request.post('/api/export-page-html', { data: { pageId: 'e2e-dir-ios' } });
  expect(response.ok(), await response.text()).toBe(true);
  // 分享页与画布同名同构（.wb-zoom-wrap > .wb-library），会吃到 index.html 的裁剪
  // 规则；SHARE_CSS 的退回规则必须真赢——computed contentVisibility 是唯一铁证。
  const html = await response.text();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppnt-e3-offline-'));
  try {
    const file = path.join(dir, 'offline.html');
    fs.writeFileSync(file, html);
    await page.goto(`file://${file}`);
    const cv = await page.evaluate(() => {
      const stage = document.querySelector('.wb-zoom-wrap .wb-screen > .ios-stage');
      return stage ? getComputedStyle(stage).contentVisibility : null;
    });
    expect(cv).toBe('visible');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test.beforeEach(async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedOwner(request);
});
test.afterEach(async ({ page }) => { await ownerCleanup(page); });
