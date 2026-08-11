import fs from 'node:fs';
import http from 'node:http';
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
// 侧边栏面板（0.3.0 起）：图标点击 → chrome.sidePanel.open（原生分屏，不占
// 页面视口）→ sidepanel.html 壳 → iframe 指向服务的 /panel.html。Playwright
// 点不了工具栏图标也开不了真 side panel，测试把壳作为普通标签页打开
// （chrome.tabs.create from SW；?tab=<id> 覆盖锁定目标 tab）——面板数据与
// 命令桥走的就是这条生产路径。action.onClicked 只断言接线。
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

/** 扩展的 MV3 service worker（background.js 注册的图标点击入口）。 */
async function extensionServiceWorker(ctx) {
  const existing = ctx.serviceWorkers()[0];
  if (existing) return existing;
  return ctx.waitForEvent('serviceworker');
}

async function tabIdByUrl(sw, part) {
  return sw.evaluate(async (p) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => (x.url || '').includes(p));
    return t ? t.id : null;
  }, part);
}

/** 把 side panel 壳作为普通标签页打开，?tab= 锁定目标 tab（生产路径同款）。 */
async function openPanelShell(ctx, targetTabId) {
  const sw = await extensionServiceWorker(ctx);
  const pageEvent = ctx.waitForEvent('page', { timeout: 8000 });
  await sw.evaluate(async (tabId) => {
    await chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel.html?tab=' + tabId), active: true });
  }, targetTabId);
  return pageEvent;
}

/** 起一个裸 origin：/registry 应答可控（entries/directOrigin 由调用方给）。 */
async function startBareServer(registryPayload) {
  const server = http.createServer((req, res) => {
    if (registryPayload && (req.url || '').startsWith('/registry')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(registryPayload));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>bare</title>bare');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
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

test('action click opens the side panel (wiring)', async () => {
  const ctx = await launchWithExtension();
  const sw = await extensionServiceWorker(ctx);
  // 真机点击 → onClicked → chrome.sidePanel.open：自动化调不了 open（要用户
  // 手势），覆盖接线本身。
  expect(await sw.evaluate(() => chrome.action.onClicked.hasListeners())).toBe(true);
  expect(await sw.evaluate(() => chrome.runtime.getManifest().side_panel.default_path))
    .toBe('sidepanel.html');
  expect(await sw.evaluate(() => typeof chrome.sidePanel.open)).toBe('function');
});

test('programmatic re-injection stays idempotent (single command bridge)', async () => {
  const ctx = await launchWithExtension();
  const page = await ctx.newPage();
  await page.goto(`${E2E_BASE_URL}/e2e/ext-fixture.html`);
  await page.waitForFunction(() => window.__pinpoint && window.pinpoint);

  await page.evaluate(() => {
    window.__cmdCount = 0;
    document.addEventListener('pinpoint:command', () => { window.__cmdCount += 1; });
  });

  const sw = await extensionServiceWorker(ctx);
  const tabId = await tabIdByUrl(sw, 'ext-fixture.html');

  // 陈旧标签页自愈 = 程序化补注 content.js（真正的陈旧页签 Playwright 构造不
  // 了：Chrome 不会把 content script 补注进扩展加载前就开着的页签，扩展也无
  // 法在会话中重载）。这里验证补注的幂等性——这是自愈安全的前提：守卫挡住
  // 第二份监听，一条面板命令只能在页面里产生一个 DOM 事件。
  await sw.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
  }, tabId);
  await sw.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] });
  }, tabId);
  expect(await page.evaluate(() => document.querySelectorAll('script[data-pinpoint-extension]').length)).toBe(1);

  await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'pinpoint:panel-cmd', cmd: 'mode', on: true }), tabId);
  await expect.poll(() => page.evaluate(() => window.__cmdCount)).toBe(1);
  // 命令真正到达 client：mode 生效。
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().mode)).toBe(true);
});

test('side panel shell renders the ledger and bridges commands to the page client', async () => {
  const ctx = await launchWithExtension();
  const page = await ctx.newPage();
  await page.goto(`${E2E_BASE_URL}/e2e/ext-fixture.html`);
  await page.waitForFunction(() => window.__pinpoint && window.pinpoint);

  // 造一条标注，再切回交互模式（面板分段从 page-info 的初始模式起）。
  await page.evaluate(() => window.pinpoint.setMode(true));
  await page.locator('#target-el').click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('textarea').fill('panel ann');
  await box.locator('#ann-save').click();
  await expect(box).toBeHidden();
  await page.evaluate(() => window.pinpoint.setMode(false));

  const sw = await extensionServiceWorker(ctx);
  const tabId = await tabIdByUrl(sw, 'ext-fixture.html');
  const shell = await openPanelShell(ctx, tabId);

  // 壳 → iframe 指向服务的 /panel.html（entry/page 参数来自 page-info）。
  const frame = shell.locator('#panel-frame');
  await expect(frame).toBeVisible({ timeout: 10000 });
  await expect(frame).toHaveAttribute('src', /\/panel\.html\?entry=e2e-site/);
  const panel = shell.frameLocator('#panel-frame');
  const row = panel.locator('.wb-ann-item[data-ann-n="1"]');
  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(row).toContainText('panel ann');

  // 跳转：面板行 → 壳 → content script → client goToMark → 页面闪烁反馈。
  await row.locator('.wb-ann-item-main').click();
  await expect(page.locator('.ann-hover-ghost.ann-flash')).toBeVisible({ timeout: 5000 });

  // 模式：面板切「标注」→ client mode（乐观分段 + 桥命令）。
  await panel.locator('#panel-mode [data-ann-mode="annotate"]').click();
  await expect.poll(() => page.evaluate(() => window.pinpoint.getState().mode)).toBe(true);

  // 删除：面板 del → client removeMark → 落盘 → SSE 回面板 → 行消失。
  await row.hover();
  await row.locator('[data-ann-act="del"]').click();
  await expect(panel.locator('.wb-ann-item')).toHaveCount(0, { timeout: 8000 });
  await expect.poll(() => {
    if (!fs.existsSync(BUCKET)) return null;
    const name = fs.readdirSync(BUCKET).find((n) => n.endsWith('.json'));
    return name ? JSON.parse(fs.readFileSync(path.join(BUCKET, name), 'utf8')).annotations.length : null;
  }).toBe(0);
});

test('shell hints a page reload when the tab client is too old', async () => {
  const ctx = await launchWithExtension();
  await ctx.route('**/annotate.js', (route) => route.abort()); // 注入痕迹在、client 没起来、无就绪标记
  const page = await ctx.newPage();
  await page.goto(`${E2E_BASE_URL}/e2e/ext-fixture.html`);
  await page.waitForSelector('script[data-pinpoint-extension]', { state: 'attached' });

  const sw = await extensionServiceWorker(ctx);
  const tabId = await tabIdByUrl(sw, 'ext-fixture.html');
  const shell = await openPanelShell(ctx, tabId);
  await expect(shell.locator('#hint')).toBeVisible({ timeout: 8000 });
  await expect(shell.locator('#hint')).toContainText('刷新本页');
});

test('shell re-probes and hints on an unregistered page', async () => {
  const ctx = await launchWithExtension();
  let registryHits = 0;
  const bare = await startBareServer({ ok: true, entries: [] });
  bare.on('request', (req) => { if ((req.url || '').startsWith('/registry')) registryHits += 1; });
  try {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${bare.address().port}/`);
    await expect.poll(() => registryHits, { timeout: 5000 }).toBe(1); // 初次探测（no-match）

    const sw = await extensionServiceWorker(ctx);
    const tabId = await tabIdByUrl(sw, '127.0.0.1');
    const shell = await openPanelShell(ctx, tabId);
    await expect(shell.locator('#hint')).toBeVisible({ timeout: 8000 });
    await expect(shell.locator('#hint')).toContainText('registry');
    expect(registryHits).toBeGreaterThanOrEqual(2); // page-info 触发了一次重探测
  } finally {
    bare.close();
  }
});

test('shell hints when the pinpoint service is down', async () => {
  const ctx = await launchWithExtension();
  const bare = await startBareServer(null); // 无 /registry → 探测失败
  try {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${bare.address().port}/`);
    await page.waitForTimeout(1200); // 探测落定（no-service）

    const sw = await extensionServiceWorker(ctx);
    const tabId = await tabIdByUrl(sw, '127.0.0.1');
    const shell = await openPanelShell(ctx, tabId);
    await expect(shell.locator('#hint')).toBeVisible({ timeout: 8000 });
    await expect(shell.locator('#hint')).toContainText('服务未运行');
  } finally {
    bare.close();
  }
});

test('shell hints on tabs the content script cannot run on', async () => {
  const ctx = await launchWithExtension();
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const sw = await extensionServiceWorker(ctx);
  const tabId = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && tab.id;
  });
  const shell = await openPanelShell(ctx, tabId);
  await expect(shell.locator('#hint')).toBeVisible({ timeout: 8000 });
  await expect(shell.locator('#hint')).toContainText('不支持标注');
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
