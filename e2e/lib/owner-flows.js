import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect } from './fixtures.js';
import { E2E_DATA_DIR } from '../env.js';
import { closeSettled } from '../ledger-settle.js';
import { waitNoReload } from '../site-settle.js';
import { proseSettled } from './prose.js';
import { OWNER_ARTICLE, OWNER_PAGE, OWNER_FRAMES, frameId, sectionId } from './owner-fixture.js';

export async function seedOwner(request) {
  for (const ledger of ['@canvas', '@prose']) {
    const doc = await (await request.get(`/annotations/${ledger}?entry=${OWNER_PAGE}`)).json();
    const annotations = ledger === '@prose' ? [] : Array.from({ length: 24 }, (_, i) => {
      const screen = frameId(i + 2);
      return { id: `owner-seed-${i}`, screenId: screen, status: 'open', content: `检查流程 ${i + 2}`, messages: [],
        // 全局 selector 与 frame 内 selector 各一半，覆盖 K1 的两个锚点形状。
        targets: [{ ref: 'i1', selector: i % 2 ? '[data-owner-action]' : `[data-screen="${screen}"] [data-owner-action]`, text: `确认流程 ${i + 2}` }] };
    });
    const saved = await request.post('/save', { data: { entry: OWNER_PAGE, page: ledger, path: '/', baseRevision: doc.revision, annotations } });
    expect(saved.ok(), await saved.text()).toBe(true);
  }
}

export async function openOwnerArticle(page) {
  await page.goto(OWNER_ARTICLE);
  await expect(page.locator('#article .prose h1')).toHaveText('Owner 大文章验收', { timeout: 150_000 });
  await waitNoReload(page);
  await proseSettled(page);
  await expect(page.locator('[data-pp-canvas]')).toHaveCount(12);
  await expect(page.locator('.pp-thread[data-kind="canvas"]')).toHaveCount(24);
}

export async function boardReady(scope) {
  await expect(scope.locator('.wb-screen')).toHaveCount(OWNER_FRAMES, { timeout: 30_000 });
  await expect(scope.locator('[data-owner-heading]')).toHaveCount(OWNER_FRAMES);
  await scope.waitForFunction(() => window.workbench?.whenPreviewsSettled() && window.pinpoint?.getState().connected, null, { timeout: 30_000 });
  await expect(scope.locator('.wb-screen-err, .wb-asset-err')).toHaveCount(0);
}

export async function openOwnerBoard(page, overlay = false) {
  if (!overlay) {
    await page.goto(`/workbench/?page=${OWNER_PAGE}`);
    await boardReady(page);
    return page;
  }
  await openOwnerArticle(page);
  await page.locator('[data-pp-section="part-1"] [data-screen="flow-001"] .cc-hit').click();
  await expect(page.locator('dialog[data-pp-overlay]')).toHaveAttribute('open', '');
  const handle = await page.locator('iframe.ov-canvas').elementHandle();
  const scope = await handle.contentFrame();
  await boardReady(scope);
  await expect(scope.locator('.wb-screen[data-screen="flow-001"]')).toHaveClass(/\bwb-sel\b/);
  return scope;
}

export async function focusOwnerFrame(scope, n = 1) {
  await scope.evaluate(([section, frame]) => window.workbench.focusFrame(section, frame, { smooth: false }), [sectionId(n), frameId(n)]);
  const screen = scope.locator(`.wb-screen[data-screen="${frameId(n)}"]`);
  await expect.poll(() => screen.locator('[data-owner-action]').evaluate(el => {
    const a = el.getBoundingClientRect();
    const b = document.querySelector('#wbstage').getBoundingClientRect();
    return a.width > 0 && a.height > 0 && a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
  })).toBe(true);
  return screen;
}

export function ownerLedger(ledger = '@canvas') {
  return JSON.parse(fs.readFileSync(path.join(E2E_DATA_DIR, OWNER_PAGE, `${ledger}.json`), 'utf8')).annotations;
}

export async function ownerCleanup(page) {
  if (page.isClosed()) return;
  // 正文缩略帧 annotate=off，只读且没有保存客户端。断开这些帧后再按现有协议
  // 等正文/工作台的真实写落盘，避免对尚未创建执行上下文的 lazy iframe 逐个等 500 ms。
  await page.locator('[data-pp-canvas] iframe').evaluateAll(frames => {
    for (const frame of frames) if (new URL(frame.src).searchParams.get('annotate') === 'off') frame.remove();
  });
  await closeSettled(page);
}

export async function metric(testInfo, name, values) {
  const data = { name, ...values, loadavg: execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' }).trim() };
  await testInfo.attach(`${name}.json`, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
  const { urls, dispatch, native, ...summary } = data;
  console.log(`OWNER_METRIC ${JSON.stringify(summary)}`);
}

/** 真实鼠标和 CDP IME；scope 可以是整页或文章浮层内的工作台。 */
export async function ownerAnnotation(page, scope) {
  const screen = await focusOwnerFrame(scope);
  await scope.locator('#wbann-toggle').click();
  await screen.locator('[data-owner-action]').click();
  const input = scope.locator('#ann-input');
  await expect(input).toBeFocused();
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.imeSetComposition', { text: '中文组字', selectionStart: 4, selectionEnd: 4 });
    await expect(input).toContainText('中文组字');
    await page.keyboard.press('Enter');
    await expect(scope.locator('#ann-box'), '组字 Enter 留给输入法').toBeVisible();
    await cdp.send('Input.insertText', { text: '中文标注请检查确认条件' });
  } finally { await cdp.detach(); }
  await expect(input).toContainText('中文标注请检查确认条件');
  await input.press('End');
  await input.pressSequentially(' @');
  await expect(scope.locator('#ann-mention')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(scope.locator('#ann-mention')).toHaveCount(0);
  await expect(scope.locator('#ann-box')).toBeVisible();
  await scope.locator('#ann-plus').click();
  await expect(scope.locator('#ann-tools-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(scope.locator('#ann-tools-menu')).toBeHidden();
  await expect(scope.locator('#ann-box')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(scope.locator('#ann-box')).toBeHidden();
  await expect(scope.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => ownerLedger().filter(a => a.content.includes('中文标注请检查确认条件')).length).toBe(1);
  const mark = ownerLedger().find(a => a.content.includes('中文标注请检查确认条件'));
  // 按可见编号查 badge，避免用 openMark 绕过点击。
  const badge = scope.locator('.ann-badge').filter({ hasText: new RegExp(`^${mark.n}$`) }).first();
  await badge.click();
  await expect(scope.locator('#ann-box')).toBeVisible();
  await expect(input).toContainText('中文标注请检查确认条件');
  await page.keyboard.press('Escape');
  await expect(scope.locator('#ann-box')).toBeHidden();
}

export async function ownerEscapeLayers(page, scope) {
  await scope.locator('#wbann-count').click();
  await expect(scope.locator('#wbann-pop')).toBeVisible();
  await scope.getByRole('button', { name: '更多标注操作' }).click();
  await expect(scope.locator('.wb-ann-more-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(scope.locator('.wb-ann-more-menu')).toBeHidden();
  await expect(scope.locator('#wbann-pop')).toBeVisible();
  await expect(scope.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(scope.locator('#wbann-pop')).toHaveCount(0);
  await expect(scope.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(scope.locator('#wbann-toggle')).toHaveAttribute('aria-pressed', 'false');
}
