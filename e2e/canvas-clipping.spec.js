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
  const counts = await stageRenderCounts(page);
  await metric(testInfo, 'canvas-clipping', counts);
  // 裁剪是渲染层面的：DOM 一个不卸，远处帧的锚点测量、导航几何全靠这一点。
  expect(counts.total).toBe(97);
  // 视口里的帧照常渲染（cv 邻域含视口外 ~50% 边距，1440×1000 下实测 ~24）。
  expect(counts.rendering).toBeGreaterThan(0);
  // 计数门：未跳过渲染的 stage 上限。放回裁剪前的代码时 97 帧全在渲染，必挂。
  expect(counts.rendering).toBeLessThanOrEqual(40);
});

test('视口裁剪不破坏几何消费：远处帧真实尺寸，focusFrame 带帧进来即恢复渲染', async ({ page }) => {
  await page.goto(`/workbench/?page=${OWNER_PAGE}`);
  await boardReady(page);
  // 视口存档按页恢复（pageViewports），先显式回顶拿到确定的起点。
  await page.evaluate(() => window.workbench.scrollTo({ left: 0, top: 0 }, { smooth: false }));
  await page.evaluate(() => window.workbench.whenScrollSettled());
  const farStage = page.locator('[data-screen="flow-090"] > .ios-stage');

  await test.step('跳过渲染的远处帧，几何仍是真实值（导航 / minimap / 标注锚点测量的共同前提）', async () => {
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
