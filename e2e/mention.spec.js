import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';


import { E2E_DATA_DIR } from './env.js';

// 阶段 5：doc 页正文 mention 画布 frame（data-pinpoint-frame）→ 水合为活 DOM；
// frame 内标注与画布同账本（pinpoint 桶的 workbench 账本），两处渲染、实时同步；
// 文档正文标注归文档自己的桶（e2e-mention）—— 两个命名空间共存不打架。
// frame 标注行的锚点 selector 含 stage 段，两端各自归一到 frame 内路径解析。

const CANVAS_BUCKET = path.join(E2E_DATA_DIR, 'pinpoint');
const DOC_BUCKET = path.join(E2E_DATA_DIR, 'e2e-mention');

function bucketDocs(bucket) {
  if (!fs.existsSync(bucket)) return [];
  return fs.readdirSync(bucket).filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(bucket, name), 'utf8')));
}

test.afterEach(() => {
  fs.rmSync(CANVAS_BUCKET, { recursive: true, force: true });
  fs.rmSync(DOC_BUCKET, { recursive: true, force: true });
});

async function openWorkbench(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);
}

// 嵌套 iframe 里的 composer 保存按钮可能落在可视区外（frame 页比视口高）——
// 填词与保存走 DOM 派发（与 workbench.spec.js 的文档标注惯例一致）；点选手势
// 仍是真实点击（命中测试本身是断言语义的一部分）。
async function saveComposerIn(page, scope, text) {
  await page.evaluate(({ scope, text }) => {
    let w = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    if (scope && scope.frameTitle) {
      w = [...w.document.querySelectorAll('iframe[data-pinpoint-frame-iframe]')]
        .find((f) => f.title === scope.frameTitle).contentWindow;
    }
    const d = w.document;
    const ta = d.querySelector('#ann-input');
    ta.value = text;
    ta.dispatchEvent(new w.Event('input', { bubbles: true }));
    d.querySelector('#ann-save').click();
  }, { scope, text });
}

test('doc mention hydrates live frames; mode cascades; annotations sync both ways with the canvas', async ({ page }) => {
  await openWorkbench(page);
  await page.locator('#wbpages [data-vpage="e2e-mention"]').click();

  // 1) mention 水合：doc iframe 里出两个活 frame iframe
  const docFrame = page.frameLocator('#wb-board-panel .wb-doc-frame');
  await expect(docFrame.locator('h1')).toHaveText('冲煮手账 · 评审稿');
  await expect(docFrame.locator('iframe[data-pinpoint-frame-iframe]')).toHaveCount(2);

  const recipeFrame = docFrame.frameLocator('iframe[title="@frame:e2e-ios/recipe"]');
  const timerFrame = docFrame.frameLocator('iframe[title="@frame:e2e-ios/timer"]');
  await expect(recipeFrame.locator('.ios-app')).toBeVisible();
  await expect(timerFrame.locator('[data-timer-toggle]')).toHaveText('开始');

  // 2) 交互模式：frame 里的 fragment 脚本在跑（sidecar mount 生效）
  await timerFrame.locator('[data-timer-toggle]').click();
  await expect(timerFrame.locator('[data-timer-toggle]')).toHaveText('暂停');
  await timerFrame.locator('[data-timer-reset]').click();

  // 3) 侧栏开标注 → doc 实例 → 级联进每个 frame iframe（先等 doc 的 annotate 实例
  //    就绪，否则侧栏切换会落到顶层实例上）
  await expect.poll(async () => page.evaluate(() => {
    const w = document.querySelector('#wb-board-panel .wb-doc-frame');
    return !!(w && w.contentWindow && w.contentWindow.pinpoint);
  })).toBe(true);
  await page.locator('#wbann-toggle').click();
  await expect.poll(async () => page.evaluate(() => {
    const doc = document.querySelector('#wb-board-panel .wb-doc-frame').contentWindow;
    if (!doc.pinpoint || !doc.pinpoint.getState().mode) return false;
    const frames = [...doc.document.querySelectorAll('iframe[data-pinpoint-frame-iframe]')];
    return frames.length === 2 && frames.every((f) => {
      try { return f.contentWindow.pinpoint && f.contentWindow.pinpoint.getState().mode; } catch { return false; }
    });
  })).toBe(true);

  // 4) 标注模式下在文档里标注 frame 内元素（点选 = 标注，不触发交互）
  await recipeFrame.locator('[data-ratio-cycle]').click();
  await expect(recipeFrame.locator('#ann-box')).toBeVisible();
  await saveComposerIn(page, { frameTitle: '@frame:e2e-ios/recipe' }, '文档里标：粉水比控件');
  await expect(recipeFrame.locator('.ann-badge')).toHaveCount(1);

  // 5) 落在画布账本（pinpoint 桶的 /index.html 账本），行带 pageId+screenId+section
  await expect.poll(() => {
    const docs = bucketDocs(CANVAS_BUCKET);
    const canvas = docs.find((d) => d.path === '/index.html');
    return canvas ? canvas.annotations.length : 0;
  }).toBe(1);
  const canvasDoc = bucketDocs(CANVAS_BUCKET).find((d) => d.path === '/index.html');
  const row = canvasDoc.annotations[0];
  expect(row.pageId).toBe('e2e-ios');
  expect(row.screenId).toBe('recipe');
  expect(row.section).toBe('brew-flow');
  expect(row.content).toContain('文档里标');
  expect(row.selector).toContain('ios-stage'); // 锚点携带 stage 段，两端各自归一

  // 6) 画布对应板：同一 frame 上出现同一标注（画布 pin 渲染在 stage 级 overlay 的
  //    #ann-marks 里，不嵌在 frame 元素内 —— 这里按 overlay 计数 + 侧栏文本双断言）
  await page.locator('#wbpages [data-vpage="e2e-ios"]').click();
  await expect(page.locator('#ann-marks .ann-badge')).toHaveCount(1);
  await page.locator('#wbann-count').click();
  await expect(page.locator('#wbann-list')).toContainText('文档里标：粉水比控件');
  await page.locator('#wbann-count').click();

  // 7) 画布上再标一条（同 frame 另一元素）
  await page.locator('#wbann-toggle').click(); // 画布页 = 顶层实例，需单独开
  const canvasTarget = page.locator('#wb-board-panel [data-screen="recipe"] .ios-cell').first();
  await canvasTarget.click();
  await expect(page.locator('#ann-box')).toBeVisible();
  await page.locator('#ann-input').fill('画布上标：这张卡');
  await page.locator('#ann-box').getByRole('button', { name: '发送标注' }).click();
  await expect(page.locator('#ann-marks .ann-badge')).toHaveCount(2);
  // 8) 回文档：画布那条出现在文档里的活 frame 上（切页重建 iframe → 磁盘水合）
  await page.locator('#wbpages [data-vpage="e2e-mention"]').click();
  const docFrame2 = page.frameLocator('#wb-board-panel .wb-doc-frame');
  const recipeFrame2 = docFrame2.frameLocator('iframe[title="@frame:e2e-ios/recipe"]');
  await expect(recipeFrame2.locator('.ann-badge')).toHaveCount(2);

  // 9) 文档正文标注归文档自己的桶（e2e-mention），与 frame 标注两个命名空间
  await page.locator('#wbann-toggle').click();
  await docFrame2.locator('#intro').click();
  await expect(docFrame2.locator('#ann-box')).toBeVisible();
  await saveComposerIn(page, {}, '标文档正文');
  await expect.poll(() => bucketDocs(DOC_BUCKET).length).toBe(1);
  const docLedger = bucketDocs(DOC_BUCKET)[0];
  expect(docLedger.path).toBe('/sites/e2e-mention/index.html');
  expect(docLedger.annotations[0].content).toContain('标文档正文');
  // 画布账本不被文档正文标注污染
  const canvasAfter = bucketDocs(CANVAS_BUCKET).find((d) => d.path === '/index.html');
  expect(canvasAfter.annotations.length).toBe(2);
  expect(canvasAfter.annotations.every((a) => !a.content.includes('标文档正文'))).toBe(true);
});
