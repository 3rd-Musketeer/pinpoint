import { expect, test } from './lib/fixtures.js';

// r5 B5：带裸内联脚本（非 preview-script）的帧走回退 iframe，脚本在 load 后 700ms 才注入
// 12 行内容。量尺只量一次的旧实现把后长出来的内容裁在初始盒子里（或停在没量出的初始尺寸），
// 现在按 0 / 300 / 1200ms 的节奏有界重测（固件帧 e2e/cardfallback-site/.../slowinject/late.jsx）。
// 单独一个文件且排在 article-site 之后（字母序）：打开文章页会把站点拉起来，
// article-site.spec 的「服务刚起：站点 idle」断言要求它之前没人开过文章。
test('回退 iframe 的卡片：慢注入的帧内容长高后照着重摆，盒子高度跟内容一致', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto('/cardfallback/slowinject/');
  // 冷启动那一下（503「站点启动中」自动刷新）也在等。
  await expect(page.locator('.cc-frame[data-screen="late"]')).toBeVisible({ timeout: 90_000 });
  const box = page.locator('.cc-frame[data-screen="late"] .cc-box');
  // 裸内联脚本归「来路不明」：卡片走回退 iframe。
  await expect(box.locator('iframe')).toHaveAttribute('data-cc-fallback', '1');
  await expect(box).toHaveAttribute('data-fitted', '1', { timeout: 15_000 });
  // 注入完成（脚本 700ms 后补 12 行，加初始的一行文字）。
  await expect.poll(() => page.evaluate(() => (
    document.querySelector('.cc-frame[data-screen="late"] .cc-box iframe').contentDocument
      .querySelectorAll('[data-holder] div').length)), { timeout: 10_000 }).toBe(12);
  // 盒子高度 = 注入后的内容高度 × 卡片缩放：量尺在注入后重测过，内容没有被裁。
  await expect.poll(async () => page.evaluate(() => {
    const b = document.querySelector('.cc-frame[data-screen="late"] .cc-box');
    const stage = b.querySelector('iframe').contentDocument.querySelector('[data-pp-stage]');
    const scale = Number(b.dataset.scale);
    return Math.abs(b.getBoundingClientRect().height - stage.getBoundingClientRect().height * scale);
  }), { timeout: 10_000 }).toBeLessThanOrEqual(2);
  expect(pageErrors).toEqual([]);
});
