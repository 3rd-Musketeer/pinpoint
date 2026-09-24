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

  // board:"ios" 的 dir 条目走画布壳：fragment 以 annotate=off 抓取内联进机壳，
  // 注入的客户端因此进不了板（原独立用例并入 —— 同一次开页，只多点一条 Page）。
  await page.getByRole('tab', { name: '页面', exact: true }).click();
  await page.locator('.wb-page[data-vpage="e2e-dir-ios"]').click();
  const cards = page.locator('#wb-board-panel [data-screen="cards"]');
  await expect(cards).toContainText('ios fragment served from /sites/');
  await expect(cards.locator('script')).toHaveCount(0);
  await expect(cards.locator('.ios-stage')).toHaveCount(1);

  // 真实 vite 中间件栈没有把 %2e%2e 先解出来服务掉：raw 路径穿越必须 404。
  // HTTP 客户端会把 ../（和 %2e%2e）在上线前归一化，得用 curl --path-as-is 发。
  // （handler 语义本身在 sites-api.test.js；/sites/ghost 与 missing.html 的
  // 404 也在那里，e2e 只留中间件顺序这一层。）
  for (const p of [
    '/sites/e2e-dir/%2e%2e/%2e%2e/etc/passwd',
    '/sites/e2e-dir/%2e%2e/env.js',
    '/sites/e2e-dir/../../etc/passwd',
  ]) {
    expect(await rawStatus(E2E_BASE_URL + p), p).toBe(404);
  }
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
  await box.locator('#ann-close').click();

  await expect.poll(() => bucketDocs().length).toBe(1);
  const doc = JSON.parse(fs.readFileSync(path.join(BUCKET, bucketDocs()[0]), 'utf8'));
  expect(doc.path).toBe('/sites/e2e-dir/doc.html');
  expect(doc.annotations.map((a) => a.content)).toContainEqual(expect.stringContaining('dir entry mark'));
});

// 阶段 3：CLI 登记入口的端到端闭环 —— 真实跑 bin/pinpoint.mjs 写 registry
// （--registry 指向 e2e fixture，PINPOINT_ORIGIN 指向 e2e server，由 CLI 自己
// 探活并触发 POST /registry/reload），新条目不重开服务即出现在 Pages。
// CLI 侧与合成板的纯逻辑单测在 bin/pinpoint-cli.test.js / synth-board.test.js，
// 这里守的是「CLI → reload → 浏览器」整链。
test('pinpoint add (CLI)：dir 条目 reload 后进 Pages，单文件条目开成合成 doc 板', async ({ page }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-e2e-cli-'));
  const site = path.join(tmp, 'clisite');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body><h1 id="cli-title">E2E CLI-added site</h1></body></html>');
  fs.writeFileSync(path.join(site, 'board.json'), JSON.stringify({
    sections: [{ id: 'main', title: 'Main', layout: 'column', screens: [{ id: 'index', title: 'Index' }] }],
  }));
  const file = path.join(tmp, 'Weekly Report.html');
  fs.writeFileSync(file, '<!doctype html><html><body><h1 id="report-title">E2E CLI single file</h1></body></html>');
  try {
    // 两次真实 CLI add：dir（自带 board.json）与 file（无板 → 服务合成单屏 doc 板）。
    // CLI 自己探活并 POST /registry/reload，工作台经 HMR registry:update 重拉 Pages。
    await execFileP('node', [
      path.join(ROOT, 'bin', 'pinpoint.mjs'), 'add', site,
      '--id', 'e2e-cli-add', '--title', 'E2E CLI Add', '--registry', E2E_REGISTRY,
    ], { env: { ...process.env, PINPOINT_ORIGIN: E2E_BASE_URL } });
    await execFileP('node', [
      path.join(ROOT, 'bin', 'pinpoint.mjs'), 'add', file,
      '--id', 'e2e-cli-file', '--registry', E2E_REGISTRY,
    ], { env: { ...process.env, PINPOINT_ORIGIN: E2E_BASE_URL } });

    await page.goto('/index.html');
    await page.waitForFunction(() => window.workbench && window.pinpoint);

    // dir 行：单屏 index → iframe 从 /sites/e2e-cli-add/ 渲染。
    const dirBtn = page.locator('.wb-page[data-vpage="e2e-cli-add"]');
    await expect(dirBtn).toBeVisible();
    await dirBtn.click();
    const dirFrame = page.locator('#wb-board-panel [data-screen="index"] iframe.wb-doc-frame');
    await expect(dirFrame).toHaveAttribute('src', /\/sites\/e2e-cli-add\/index\.html$/);
    await expect(
      page.frameLocator('#wb-board-panel [data-screen="index"] iframe.wb-doc-frame').locator('#cli-title')
    ).toHaveText('E2E CLI-added site');

    // file 行：合成板 src = sites/<id>/<percent-encoded 文件名>（契约规范形，
    // 无前导斜杠；iframe 从 /index.html 相对解析到 /sites/…）。
    const fileBtn = page.locator('.wb-page[data-vpage="e2e-cli-file"]');
    await expect(fileBtn).toBeVisible();
    await fileBtn.click();
    const fileFrame = page.locator('#wb-board-panel [data-screen="index"] iframe.wb-doc-frame');
    await expect(fileFrame).toHaveAttribute('src', /^sites\/e2e-cli-file\/Weekly%20Report\.html$/);
    await expect(
      page.frameLocator('#wb-board-panel [data-screen="index"] iframe.wb-doc-frame').locator('#report-title')
    ).toHaveText('E2E CLI single file');
  } finally {
    // 恢复共享 registry fixture 并让服务忘掉这两条，不能影响后续 spec。
    writeRegistryFixture();
    fs.rmSync(tmp, { recursive: true, force: true });
    await page.request.post('/registry/reload');
  }
});
