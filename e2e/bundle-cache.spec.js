import { expect, test } from '@playwright/test';

// 审计 B3 的缓存契约在真浏览器里走一遍（perf-bundle）：注入页引用构建产物的
// 内容哈希地址，immutable 永久缓存 —— 第二次打开同一页哈希地址零网络传输
// （磁盘缓存直接回，Playwright network 断言）。这是只能发生在真浏览器里的
// 一层；响应头与老地址 ETag 协商的 HTTP 层在 annotate-api.test.js 与
// annotate-bundle.test.js（未知哈希 404 在那条 stale-hash rebuild 用例里）。

const PAGE = '/sites/e2e-dir/doc.html';
const HASHED_SRC = '/annotate\\.[0-9a-f]{10}\\.js$';
const HASHED_RE = new RegExp(HASHED_SRC);

async function annotateTransfer(page) {
  return page.evaluate((src) => {
    const entry = performance.getEntriesByType('resource').find((e) => new RegExp(src).test(e.name));
    return entry ? { name: entry.name, transfer: entry.transferSize, encoded: entry.encodedBodySize } : null;
  }, HASHED_SRC);
}

test('injected pages reference the hashed bundle; second load is zero-transfer', async ({ page }) => {
  const scriptTag = page.waitForResponse((r) => HASHED_RE.test(r.url()));
  await page.goto(PAGE);
  const resp = await scriptTag;
  expect(resp.status()).toBe(200);

  // 客户端真的从哈希地址起来（注入契约没被换地址破坏）。
  await expect.poll(() => page.evaluate(() => !!window.pinpoint)).toBe(true);

  const first = await annotateTransfer(page);
  expect(first).not.toBeNull();
  expect(first.transfer).toBeGreaterThan(0);

  await page.reload();
  const second = await annotateTransfer(page);
  expect(second).not.toBeNull();
  expect(second.name).toBe(first.name);
  expect(second.transfer).toBe(0, '第二次打开同一页：哈希地址命中缓存，零传输');
  expect(second.encoded).toBeGreaterThan(0);
});
