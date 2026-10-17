import { expect, test } from './lib/fixtures.js';

// ppnt shot 的换页竞争（2026-10-17）：bin/ppnt-shot.js 一等到 window.workbench 就
// window.workbench.setActivePage(pageId)，而 boot 的页面清单（previews/_index.json +
// /registry，文章画布页的清单行在 /registry 的 articles 里）还在路上 —— 文章越多
// /registry 越慢，窗口越大。清单没到时 pageBaseUrl 退回 /previews/<id>/，文章画布页
// 在那里不存在，board.json 打 404 进失败面板；清单到了也没人重装板，shot 等
// .wb-lib-item 30 秒超时。boot 随后的兜底激活还会用默认页把这次显式换页盖掉。
// 修法在根因处（src/workbench/stage.js）：loadBoard 先等清单到位再取 board；
// boot 的默认页激活让位给清单在途期间已发生的显式换页。
// 这条用例照抄 shot 的调用序：拦第一次 /registry 拖慢清单，workbench 一出现就换页。
// 路由里的 600ms 是复现竞争的固件延迟（静默窗口式的固定时长，只用来保证
// setActivePage 落在清单在途的窗口里，断言等的仍是可观察信号）。

const CANVAS_PAGE = 'e2e-project_commit-confirm';

test('清单慢到货时 setActivePage（ppnt shot 的调用序）：等清单后再取 board，boot 不盖显式换页', async ({ page }) => {
  test.setTimeout(60_000);
  let registryHits = 0;
  await page.route('**/registry', async (route) => {
    registryHits += 1;
    if (registryHits === 1) await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fallback();
  });
  // 缺省路径的请求一张都不许有：拦到就是拿 /previews/ 硬取文章画布页（修复前正是它 404）。
  let fallbackHits = 0;
  await page.route(`**/previews/${CANVAS_PAGE}/**`, async (route) => {
    fallbackHits += 1;
    await route.fallback();
  });

  await page.goto('/workbench/');
  await page.waitForFunction(() => !!window.workbench);
  // 与 bin/ppnt-shot.js:67-69 同一调用序：workbench 一出现就换页，等活动页对上且板挂出条目。
  await page.evaluate((id) => window.workbench.setActivePage(id), CANVAS_PAGE);
  await page.waitForFunction(
    (id) => window.workbench.activePageId() === id && document.querySelector('#wb-board-panel .wb-lib-item'),
    CANVAS_PAGE,
    { timeout: 20_000 },
  );
  await expect(page.locator('#wb-board-panel .wb-screen-err')).toHaveCount(0);
  await expect(page.locator('#wb-board-panel [data-screen="confirm-sheet"] .e2e-confirm-card')).toBeVisible();
  expect(fallbackHits).toBe(0);
});
