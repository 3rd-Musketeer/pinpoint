// 文章页共用的打开落定：h1 冷启动帽、整页重载落定（site-settle.js）、正文评论客户端就位。
// 改过内容/登记再开的调用方传 { force: true }（waitNoReload 的去重见 site-settle.js 头注）。
import { expect } from './fixtures.js';
import { proseSettled } from './prose.js';
import { waitNoReload } from '../site-settle.js';

export async function openProseArticle(page, url, h1, { force = false } = {}) {
  await page.goto(url);
  await expect(page.locator('#article .prose h1')).toHaveText(h1, { timeout: 150_000 });
  await waitNoReload(page, { force });
  await proseSettled(page);
  // 浮层客户端（带画布的文章都会装）不等的话，开页后立刻点 [data-pp-open]/#btn-canvas
  // 会穿透 JS 拦截、顺 href 导航走（layer-stack 首跑实证）。
  await page.waitForFunction(() => window.pinpointOverlay);
}
