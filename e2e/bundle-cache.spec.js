import { expect, test } from '@playwright/test';

// 审计 B3 的缓存契约在真浏览器里走一遍（perf-bundle）：
// - /sites/ 注入页引用构建产物的内容哈希地址，immutable 永久缓存 —— 第二次
//   打开同一页哈希地址零网络传输（磁盘缓存直接回，Playwright network 断言）；
// - 老地址 /annotate.js 发同一份产物，ETag + no-cache，先探后取的客户端拿 304。

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
  expect(resp.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(resp.headers()['vary']).toContain('Accept-Encoding');
  // 压缩是真的在发（Chromium 声明 br / gzip 都行，协商器优先 br）。
  expect(['br', 'gzip']).toContain(resp.headers()['content-encoding']);

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

test('legacy /annotate.js serves the same artifact with ETag revalidation', async ({ request }) => {
  const first = await request.get('/annotate.js');
  expect(first.status()).toBe(200);
  expect(first.headers()['cache-control']).toBe('no-cache');
  const etag = first.headers()['etag'];
  expect(etag).toMatch(/^"[0-9a-f]{10}"$/);

  // 同一份产物：ETag 里的哈希就是当前哈希地址，identity 字节逐位相同。
  const hashed = await request.get(`/annotate.${etag.slice(1, -1)}.js`);
  expect(hashed.status()).toBe(200);
  expect(await hashed.body()).toEqual(await first.body());

  const revalidate = await request.get('/annotate.js', { headers: { 'if-none-match': etag } });
  expect(revalidate.status()).toBe(304);

  // 不认识的哈希是响亮的 404（不是静默回落旧产物）。
  const unknown = await request.get('/annotate.0000000000.js');
  expect(unknown.status()).toBe(404);
});
