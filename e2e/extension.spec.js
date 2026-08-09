import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR } from './env.js';

// 浏览器扩展注入回路：ext-fixture.html 自己不带 annotate script，由扩展的
// content script 探测 /registry → 命中 url entry（e2e-site）→ 注入页面主世界
// → 标注落盘到 e2e-site 桶。persistent context + --load-extension 是
// Playwright 加载已解压扩展的唯一方式；channel 'chromium' 用完整 Chromium
// 构建，其 headless 模式支持扩展（headless shell 不支持）。
//
// Hermetic 关键：content script 的第一个候选 origin 是 https://pinpoint.localhost
// （真机常驻服务，可能正在跑）。这里把它整体 abort，强制 fallback 到
// location.origin（e2e webServer 自身，serve fixture registry），与真机
// pinpoint 服务是否在跑无关。

const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const BUCKET = path.join(E2E_DATA_DIR, 'e2e-site');

let context = null;
let userDataDir = null;

test.afterEach(async () => {
  if (context) await context.close();
  context = null;
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  userDataDir = null;
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

async function launchWithExtension() {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-ext-profile-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });
  await context.route('https://pinpoint.localhost/**', (route) => route.abort());
  return context;
}

test('extension injects annotate client and annotations land in the url entry bucket', async () => {
  const ctx = await launchWithExtension();
  const page = await ctx.newPage();
  await page.goto(`${E2E_BASE_URL}/e2e/ext-fixture.html`);

  // 注入生效：annotate.js 的防重入标记在页面主世界；账本归属经共享 DOM 属性
  // 传递（CSP 下内联 <script> 注不进去，见 content.js 头注）。
  await page.waitForFunction(() => window.__htmlAnnotate && window.iOSAnnotate);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-pinpoint-entry')))
    .toBe('e2e-site');

  // 驱动一条标注（同 spa-ledger.spec.js 的方式）。
  await page.evaluate(() => window.iOSAnnotate.setMode(true));
  await page.locator('#target-el').click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('textarea').fill('ext ann');
  await box.locator('#ann-save').click();
  await expect(box).toBeHidden();

  // 落盘到 e2e-site 桶（而不是 pinpoint 默认桶）。
  await expect.poll(() => {
    if (!fs.existsSync(BUCKET)) return null;
    const name = fs.readdirSync(BUCKET).find((n) => n.startsWith('ext-fixture.html_') && n.endsWith('.json'));
    return name ? JSON.parse(fs.readFileSync(path.join(BUCKET, name), 'utf8')) : null;
  }).toMatchObject({ annotations: [{ content: 'ext ann' }] });
  const name = fs.readdirSync(BUCKET).find((n) => n.endsWith('.json'));
  const doc = JSON.parse(fs.readFileSync(path.join(BUCKET, name), 'utf8'));
  expect(doc.annotations).toHaveLength(1);
  expect(doc.annotations[0].selector).toContain('target-el');
});

test('extension stays quiet when no registry is reachable', async () => {
  const ctx = await launchWithExtension();
  // 两个候选 origin 都不可达 = 服务没起 → 安静退出，页面保持干净。
  await ctx.route(`${E2E_BASE_URL}/registry`, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto(`${E2E_BASE_URL}/e2e/ext-fixture.html`);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => Boolean(window.__htmlAnnotate))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-pinpoint-entry'))).toBe(null);
});
