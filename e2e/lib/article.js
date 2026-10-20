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
}
