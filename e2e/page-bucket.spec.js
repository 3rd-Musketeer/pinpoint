import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY } from './env.js';

// storage-unify 的核心不变量：一页一个桶。两页各标一条 → 各自的 @canvas 各自
// 编号（两个 #1，#n 按页）；清空只作用当前页的账本，另一页的标注原样；
// 切页 = 换桶重新 hydrate，回到旧页标注照常显示。

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANVAS_PAGES = ['e2e-ios', 'e2e-mixed'];

test.afterEach(() => {
  for (const vpage of CANVAS_PAGES) {
    fs.rmSync(path.join(E2E_DATA_DIR, vpage), { recursive: true, force: true });
  }
});

function readCanvas(vpage) {
  const file = path.join(E2E_DATA_DIR, vpage, '@canvas.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** 切到指定页并等画布账本换桶落定（桶 id 到位且 routing 结束）。boot 页
    （点击不换桶）同样成立：等的是「账本已在这一页」，不是「发生了一次切换」。 */
async function switchPageSettled(page, vpage) {
  await page.locator('#wbpages [data-vpage="' + vpage + '"]').click();
  await expect.poll(() => page.evaluate((want) => {
    const st = window.pinpoint.getState();
    return !st.routing && window.pinpoint.entry === want;
  }, vpage)).toBe(true);
}

async function annotateOn(page, vpage, selector, text) {
  await switchPageSettled(page, vpage);
  await page.evaluate(() => window.pinpoint.setMode(true));
  await page.locator(selector).first().click();
  await expect(page.locator('#ann-box')).toBeVisible();
  await page.locator('#ann-input').fill(text);
  await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/save' && r.request().method() === 'POST' && r.ok()),
    page.locator('#ann-save').click(),
  ]);
  await expect(page.locator('#ann-box')).toBeHidden();
  // 保存应答把带号行带回；等侧栏计数跟上再继续（#n 由服务端发）。
  await expect.poll(() => page.evaluate(() => window.pinpoint.pageMarks.length)).toBe(1);
  await page.evaluate(() => window.pinpoint.setMode(false));
}

test('一页一桶：两页各自标注各自编号，清空当前页不动另一页', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint?.getState().connected);

  await annotateOn(page, 'e2e-ios', '[data-screen="settings"] .ios-cell', 'iOS 页的标注');
  await annotateOn(page, 'e2e-mixed', '[data-screen="home"] h1', 'mixed 页的标注');

  // 两页各有一本 @canvas，行都拿 #1 —— #n 按页（桶）编号，不再共享一套序列。
  expect(readCanvas('e2e-ios').annotations.map(r => [r.n, r.pageId])).toEqual([[1, 'e2e-ios']]);
  expect(readCanvas('e2e-mixed').annotations.map(r => [r.n, r.pageId])).toEqual([[1, 'e2e-mixed']]);

  // 清空当前页（mixed）：只有它的账本空了。清空是异步保存，等盘上落定再断言。
  await page.evaluate(() => window.pinpoint.clear());
  await expect.poll(() => page.evaluate(() => window.pinpoint.marks.length)).toBe(0);
  await expect.poll(() => readCanvas('e2e-mixed') && readCanvas('e2e-mixed').annotations).toEqual([]);
  // 磁盘形态：正文带 target pill 引用 [@t:i1]。
  expect(readCanvas('e2e-ios').annotations.map(r => r.content)).toEqual(['[@t:i1] iOS 页的标注']);

  // 切回 e2e-ios：换桶重新 hydrate，标注照常显示。
  await switchPageSettled(page, 'e2e-ios');
  await expect(page.locator('#ann-marks .ann-badge')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.pinpoint.pageMarks.length)).toBe(1);
});

test('rename 后点标注：行带旧 pageId，按本页行定位，不跳错误面板不报未连接', async ({ page }) => {
  test.setTimeout(60000);
  let renamed = false;
  const ppnt = (...args) => execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
    cwd: ROOT,
    env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY, PINPOINT_ORIGIN: E2E_BASE_URL },
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html');
    await page.waitForFunction(() => window.workbench && window.pinpoint?.getState().connected);
    await annotateOn(page, 'e2e-ios', '[data-screen="settings"] .ios-cell', 'rename 前的标注');

    // rename：登记表 + 标注桶一起改名，行上的 pageId 留着旧 id（桶 = 页，
    // 行不随 rename 改写）。改完服务 reload，页清单里从此只有新 id。
    await ppnt('rename', 'e2e-ios', 'e2e-ios-r');
    renamed = true;

    await page.goto('/index.html?page=e2e-ios-r');
    await page.waitForFunction(() => window.workbench && window.pinpoint);
    await expect.poll(() => page.evaluate(() => window.pinpoint.entry)).toBe('e2e-ios-r');
    await expect.poll(() => page.evaluate(() => window.pinpoint.getState().connected)).toBe(true);

    // 点这条标注：旧 pageId 不在页清单里 → 不许 setActivePage 到不存在的页
    // （那会落到「页面不存在」面板，并把画布换到不存在的桶、误报未连接），
    // 按本页账本里的行直接定位。
    await page.evaluate(() => window.pinpoint.goToMark(1));
    await expect(page.locator('#ann-box')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.workbench.activePageId())).toBe('e2e-ios-r');
    await expect.poll(() => page.evaluate(() => {
      const st = window.pinpoint.getState();
      return st.connected && !st.syncError && !st.routing;
    })).toBe(true);
  } finally {
    if (renamed) await ppnt('rename', 'e2e-ios-r', 'e2e-ios');
  }
});
