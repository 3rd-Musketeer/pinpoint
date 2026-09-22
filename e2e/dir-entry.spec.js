import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY } from './env.js';
import { writeRegistryFixture } from './registry-fixture.js';

// Registry `dir` entries are served read-only under /sites/<id>/ with the
// annotate client injected, and aggregate into the workbench as pages.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = path.join(E2E_DATA_DIR, 'e2e-dir');
const execFileP = promisify(execFile);

function bucketDocs() {
  if (!fs.existsSync(BUCKET)) return [];
  // _seq.json 是 #n 的桶级计数器（M1 起 save 落号必写），不是账本，不计进名单。
  return fs.readdirSync(BUCKET).filter((name) => name.endsWith('.json') && name !== '_seq.json');
}

async function rawStatus(url) {
  const { stdout } = await execFileP('curl', ['-s', '--path-as-is', '-o', '/dev/null', '-w', '%{http_code}', url]);
  return Number(stdout.trim());
}

test.afterEach(() => {
  fs.rmSync(BUCKET, { recursive: true, force: true });
});

test('registry dir entry appears as a workbench page and renders from /sites/', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);

  // Pages 单一列表（2026-08-16 阶段 2）：dir 条目与模板页同列，无模式 Seg。
  await expect(page.locator('#wbboard-mode')).toHaveCount(0);
  const navBtn = page.locator('.wb-page[data-vpage="e2e-dir"]');
  await expect(navBtn).toBeVisible();
  await navBtn.click();

  // dir 条目默认 doc 壳：每屏一个 iframe 文档（保留文档自己注入的 annotate
  // 客户端），侧栏「内容」区出产物条目行；board.json 里残留的 shell:"web" 归一到 doc。
  await page.getByRole('tab', { name: '大纲', exact: true }).click();
  const entries = page.locator('#wbcontents [data-group="product"] [data-entry]');
  await expect(entries).toHaveCount(2);
  await expect(entries.locator('.wb-entry-t')).toHaveText(['Cards', 'Doc']);
  await expect(entries.locator('.wb-entry-tag')).toHaveText(['文档', '文档']);
  const cardsFrame = page.locator('#wb-board-panel [data-screen="cards"] iframe.wb-doc-frame');
  await expect(cardsFrame).toHaveAttribute('src', /\/sites\/e2e-dir\/cards\.html$/);
  await expect(
    page.frameLocator('#wb-board-panel [data-screen="cards"] iframe.wb-doc-frame').locator('h1')
  ).toHaveText('E2E dir-site cards');

  // 条目切换：第二屏（doc.html）成为当前文档。
  await page.locator('#wbcontents [data-entry="doc"]').click();
  const docFrame = page.locator('#wb-board-panel [data-screen="doc"] iframe.wb-doc-frame');
  await expect(docFrame).toHaveAttribute('src', /\/sites\/e2e-dir\/doc\.html$/);
  await expect(
    page.frameLocator('#wb-board-panel [data-screen="doc"] iframe.wb-doc-frame').locator('#doc-title')
  ).toHaveText('E2E dir-site doc');
});

test('registry dir entry with board "ios" inlines fragments fetched with annotate=off', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);

  await page.locator('.wb-page[data-vpage="e2e-dir-ios"]').click();
  // Fragment inlined into phone chrome: fetched from /sites/ with annotate=off,
  // so the injected client never enters the board.
  const cards = page.locator('#wb-board-panel [data-screen="cards"]');
  await expect(cards).toContainText('ios fragment served from /sites/');
  await expect(cards.locator('script')).toHaveCount(0);
  await expect(cards.locator('.ios-stage')).toHaveCount(1);
});

test('/sites/<id>/ HTML injects the annotate client and saves into the entry bucket', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html');
  await page.waitForFunction(() => window.pinpoint);
  expect(await page.evaluate(() => window.__pinpointEntry)).toBe('e2e-dir');
  expect(await page.evaluate(() => !!window.__pinpoint)).toBe(true);

  await page.evaluate(() => window.pinpoint.setMode(true));
  await page.locator('#doc-target').click();
  const box = page.locator('#ann-box');
  await expect(box).toBeVisible();
  await box.locator('#ann-input').fill('dir entry mark');
  await box.locator('#ann-save').click();

  await expect.poll(() => bucketDocs().length).toBe(1);
  const doc = JSON.parse(fs.readFileSync(path.join(BUCKET, bucketDocs()[0]), 'utf8'));
  expect(doc.path).toBe('/sites/e2e-dir/doc.html');
  expect(doc.annotations.map((a) => a.content)).toContainEqual(expect.stringContaining('dir entry mark'));
});

// 注入端的材质与卡片皮肤（ADR 0031「注入端 #ann-sidebar 换同一档玻璃，两端材质
// 一致」+ 评审板 H1 的评论卡）。client 是注进任意页面的单文件，读不到 workbench
// 的 --wb-*，所以 F2 的四个数在它自己的规则里是字面量 —— 这条用例是那份字面量
// 与 wb-tokens.css 之间唯一的对账。

test('?annotate=off serves the same page with zero annotation surface', async ({ page }) => {
  await page.goto('/sites/e2e-dir/doc.html?annotate=off');
  await expect(page.locator('#doc-title')).toHaveText('E2E dir-site doc');
  expect(await page.evaluate(() => !!window.__pinpoint)).toBe(false);
  expect(await page.evaluate(() => window.__pinpointEntry || null)).toBe(null);
});

test('path traversal and unknown entries are rejected', async ({ page }) => {
  // Raw-path probes: HTTP clients normalize ../ (and %2e%2e) away before it
  // hits the wire, so traversal attempts must be sent with curl --path-as-is.
  for (const p of [
    '/sites/e2e-dir/%2e%2e/%2e%2e/etc/passwd',
    '/sites/e2e-dir/%2e%2e/env.js',
    '/sites/e2e-dir/../../etc/passwd',
  ]) {
    expect(await rawStatus(E2E_BASE_URL + p), p).toBe(404);
  }
  // Semantic rejections go through the normal client.（e2e-site 是 url 条目，
  // 阶段 4 起 /sites/e2e-site/ 走代理而不再是 404 —— 代理行为见 url-entry.spec.js。）
  for (const url of [
    '/sites/ghost/doc.html',
    '/sites/e2e-dir/missing.html',
  ]) {
    const res = await page.request.get(url);
    expect(res.status(), url).toBe(404);
  }
});

// 阶段 3：CLI 登记入口的端到端闭环 —— 真实跑 bin/pinpoint.mjs 写 registry
// （--registry 指向 e2e fixture，PINPOINT_ORIGIN 指向 e2e server，由 CLI 自己
// 探活并触发 POST /registry/reload），新 dir 条目不重开服务即出现在 Pages。
test('pinpoint add (CLI) registers a dir that appears in Pages after reload', async ({ page }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-e2e-cli-'));
  const site = path.join(tmp, 'clisite');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body><h1 id="cli-title">E2E CLI-added site</h1></body></html>');
  fs.writeFileSync(path.join(site, 'board.json'), JSON.stringify({
    sections: [{ id: 'main', title: 'Main', layout: 'column', screens: [{ id: 'index', title: 'Index' }] }],
  }));
  try {
    await execFileP('node', [
      path.join(ROOT, 'bin', 'pinpoint.mjs'), 'add', site,
      '--id', 'e2e-cli-add', '--title', 'E2E CLI Add', '--registry', E2E_REGISTRY,
    ], { env: { ...process.env, PINPOINT_ORIGIN: E2E_BASE_URL } });

    await page.goto('/index.html');
    await page.waitForFunction(() => window.workbench && window.pinpoint);
    const navBtn = page.locator('.wb-page[data-vpage="e2e-cli-add"]');
    await expect(navBtn).toBeVisible();
    await navBtn.click();

    // dir 条目默认 doc 壳：单屏 index → iframe 从 /sites/e2e-cli-add/ 渲染。
    const frame = page.locator('#wb-board-panel [data-screen="index"] iframe.wb-doc-frame');
    await expect(frame).toHaveAttribute('src', /\/sites\/e2e-cli-add\/index\.html$/);
    await expect(
      page.frameLocator('#wb-board-panel [data-screen="index"] iframe.wb-doc-frame').locator('#cli-title')
    ).toHaveText('E2E CLI-added site');
  } finally {
    // 恢复共享 registry fixture 并让服务忘掉该条目，不能影响后续 spec。
    writeRegistryFixture();
    fs.rmSync(tmp, { recursive: true, force: true });
    await page.request.post('/registry/reload');
  }
});

// 阶段 3 收尾：单文件 entry 没有 board.json —— 服务合成单屏 doc 板，
// Pages 出现、打开即读、导出走 file 条目的 src 映射。
test('pinpoint add (CLI) of a single HTML file opens as a synthesized doc page', async ({ page }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-e2e-cli-file-'));
  const file = path.join(tmp, 'Weekly Report.html');
  fs.writeFileSync(file, '<!doctype html><html><body><h1 id="report-title">E2E CLI single file</h1></body></html>');
  try {
    await execFileP('node', [
      path.join(ROOT, 'bin', 'pinpoint.mjs'), 'add', file,
      '--id', 'e2e-cli-file', '--registry', E2E_REGISTRY,
    ], { env: { ...process.env, PINPOINT_ORIGIN: E2E_BASE_URL } });

    await page.goto('/index.html');
    await page.waitForFunction(() => window.workbench && window.pinpoint);
    const navBtn = page.locator('.wb-page[data-vpage="e2e-cli-file"]');
    await expect(navBtn).toBeVisible();
    await navBtn.click();

    // 合成板：单屏 index，src = sites/<id>/<percent-encoded 文件名>（契约规范形，
    // 无前导斜杠；iframe 从 /index.html 相对解析到 /sites/…）。
    const frame = page.locator('#wb-board-panel [data-screen="index"] iframe.wb-doc-frame');
    await expect(frame).toHaveAttribute('src', /^sites\/e2e-cli-file\/Weekly%20Report\.html$/);
    await expect(
      page.frameLocator('#wb-board-panel [data-screen="index"] iframe.wb-doc-frame').locator('#report-title')
    ).toHaveText('E2E CLI single file');
  } finally {
    writeRegistryFixture();
    fs.rmSync(tmp, { recursive: true, force: true });
    await page.request.post('/registry/reload');
  }
});
