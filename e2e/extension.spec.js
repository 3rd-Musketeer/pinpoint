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
  await page.waitForFunction(() => window.__pinpoint && window.pinpoint);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-pinpoint-entry')))
    .toBe('e2e-site');

  // 驱动一条标注（同 spa-ledger.spec.js 的方式）。
  await page.evaluate(() => window.pinpoint.setMode(true));
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

/** 扩展的 MV3 service worker（background.js 注册的图标点击入口）。 */
async function extensionServiceWorker(ctx) {
  const existing = ctx.serviceWorkers()[0];
  if (existing) return existing;
  return ctx.waitForEvent('serviceworker');
}

/** 从 SW 里向当前活动 tab 复放 background.js 收到图标点击后发出的那条消息。 */
async function sendIconCommand(sw, message) {
  return sw.evaluate(async (msg) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return 'no-tab';
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
      return 'delivered';
    } catch (e) {
      return 'rejected';
    }
  }, message);
}

test('toolbar icon chain: background wiring plus message delivery toggles the sidebar', async () => {
  const ctx = await launchWithExtension();
  const page = await ctx.newPage();
  await page.goto(`${E2E_BASE_URL}/e2e/ext-fixture.html`);
  await page.waitForFunction(() => window.__pinpoint && window.pinpoint);

  // Playwright 点不到浏览器工具栏图标，链路分两段覆盖：
  // 1. background.js 的接线——action.onClicked 必须挂着 listener（代码评审覆盖
  //    listener 体 = sendMessage，真机点击验证兜底）。
  const sw = await extensionServiceWorker(ctx);
  expect(await sw.evaluate(() => chrome.action.onClicked.hasListeners())).toBe(true);

  // 2. SW → content script → DOM CustomEvent → client：复放同一条消息，面板开合。
  expect(await sendIconCommand(sw, { type: 'pinpoint:toggle-sidebar' })).toBe('delivered');
  await expect(page.locator('#ann-sidebar')).toBeVisible();
  expect(await sendIconCommand(sw, { type: 'pinpoint:toggle-sidebar' })).toBe('delivered');
  await expect(page.locator('#ann-sidebar')).toBeHidden();

  // 非匹配页（无 content script）上图标点击是安静 no-op：sendMessage 无人接收会
  // reject，background 必须 catch 掉——这里验证这个前提成立。
  await page.goto('about:blank');
  expect(await sendIconCommand(sw, { type: 'pinpoint:toggle-sidebar' })).toBe('rejected');
});

test('panel header segmented control switches annotate mode (pure mouse loop)', async () => {
  const ctx = await launchWithExtension();
  const page = await ctx.newPage();
  await page.goto(`${E2E_BASE_URL}/e2e/ext-fixture.html`);
  await page.waitForFunction(() => window.__pinpoint && window.pinpoint);

  // 开合命令的 client 侧契约：DOM CustomEvent（content script 桥发的就是它）。
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('pinpoint:command', { detail: { command: 'toggle-sidebar' } }));
  });
  const sidebar = page.locator('#ann-sidebar');
  await expect(sidebar).toBeVisible();

  // 初始是交互模式：segmented 落在「交互」上。
  const segInteract = sidebar.locator('[data-ann-mode="interact"]');
  const segAnnotate = sidebar.locator('[data-ann-mode="annotate"]');
  await expect(segInteract).toHaveClass(/on/);
  await expect(segAnnotate).not.toHaveClass(/on/);

  // 点「标注」→ client 进入标注模式，segmented 跟着走。
  await segAnnotate.click();
  expect(await page.evaluate(() => window.pinpoint.getState().mode)).toBe(true);
  await expect(segAnnotate).toHaveClass(/on/);
  await expect(segInteract).not.toHaveClass(/on/);

  // 外部 API 改 mode（A 键/工具条）时 segmented 同样反映。
  await page.evaluate(() => window.pinpoint.setMode(false));
  await expect(segInteract).toHaveClass(/on/);

  // 点「交互」回到交互模式。
  await page.evaluate(() => window.pinpoint.setMode(true));
  await segInteract.click();
  expect(await page.evaluate(() => window.pinpoint.getState().mode)).toBe(false);
  await expect(segInteract).toHaveClass(/on/);
});

test('extension stays quiet when no registry is reachable', async () => {
  const ctx = await launchWithExtension();
  // 两个候选 origin 都不可达 = 服务没起 → 安静退出，页面保持干净。
  await ctx.route(`${E2E_BASE_URL}/registry`, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto(`${E2E_BASE_URL}/e2e/ext-fixture.html`);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => Boolean(window.__pinpoint))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-pinpoint-entry'))).toBe(null);
});
