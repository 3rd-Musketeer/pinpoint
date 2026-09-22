import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_REGISTRY, E2E_SITES_DIR } from './env.js';
import { writeRegistryFixture } from './registry-fixture.js';

// pp2 切片 1：页是「源码 → 编译 → dist」。e2e/jsx-site/ 固件里 hello.jsx 是
// JSX 帧（编译上画布），ghost 没有源码（500 → 错误面板）。
// e2e-jsx 不进共享 registry 固件（多一条页会撞翻断言整份 Pages 清单的 spec）——
// 这里自己登记、用完恢复（dir-entry.spec.js 的 CLI 登记用例同一条路子）。
// 没赶上启动全量编译的条目由 serve 层的懒编译兜住，正好是这条链路的实测。

function registerJsxSite() {
  const doc = JSON.parse(fs.readFileSync(E2E_REGISTRY, 'utf8'));
  doc.entries.push({ id: 'e2e-jsx', title: 'E2E JSX', kind: 'dir', path: path.join(E2E_SITES_DIR, 'jsx-site'), board: 'ios' });
  fs.writeFileSync(E2E_REGISTRY, JSON.stringify(doc, null, 2));
}

test.beforeEach(async ({ request }) => {
  registerJsxSite();
  await request.post('/registry/reload');
});

test.afterEach(async ({ request }) => {
  writeRegistryFixture();
  await request.post('/registry/reload');
});

test('.jsx 帧编译后出现在工作台画布，DOM 带 data-pp-id', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.workbench && window.pinpoint);

  await page.locator('.wb-page[data-vpage="e2e-jsx"]').click();
  const frame = page.locator('#wb-board-panel [data-screen="hello"]');
  await expect(frame).toContainText('E2E jsx-site hello');

  // 编译期打进去的源码锚点：宿主元素带 文件:行#n；map 出来的同行实例逐个计数。
  await expect(frame.locator('[data-pp-id="hello.jsx:3#1"]')).toHaveCount(1);
  await expect(frame.locator('[data-pp-id="hello.jsx:6#1"]')).toHaveCount(1);
  await expect(frame.locator('[data-pp-id="hello.jsx:6#2"]')).toHaveCount(1);
  // 帧默认导出也是函数组件：根宿主元素带 data-pp-comp。
  await expect(frame.locator('[data-pp-comp="Hello"]')).toHaveCount(1);

  // 缺源码屏：serve 500 → 工作台的错误面板。
  await expect(page.locator('#wb-board-panel [data-screen="ghost"] .wb-screen-err')).toHaveCount(1);
});

test('/sites/ 屏从 dist 出；缺源码屏 500 带错误文本', async ({ page }) => {
  const ok = await page.request.get('/sites/e2e-jsx/hello.html?annotate=off');
  expect(ok.status()).toBe(200);
  const body = await ok.text();
  expect(body).toContain('E2E jsx-site hello');
  expect(body).toContain('data-pp-id="hello.jsx:3#1"');

  const ghost = await page.request.get('/sites/e2e-jsx/ghost.html');
  expect(ghost.status()).toBe(500);
  expect(await ghost.text()).toContain('源码不存在');

  // board.json 响应附带 dist 状态。
  const board = await page.request.get('/sites/e2e-jsx/board.json');
  expect(board.status()).toBe(200);
  const json = await board.json();
  expect(json.dist).toBeTruthy();
  expect(typeof json.dist.builtAt).toBe('number');
  expect(json.dist.stale).toBe(false);
});
