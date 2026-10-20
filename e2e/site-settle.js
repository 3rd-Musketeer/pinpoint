// 冷启动的 Astro 开发服务器：第一个页面的 HMR socket 一连上，vite 就发一条 full-reload，
// 页面整页重载一次（2026-10-13 实测，没有画布卡片的文章也一样；页面越重，重载落得越晚，
// 带卡片的文章在出页后约 250 ms）。重载途中点 [[ ]]、跑 page.evaluate 会落空或报
// “Execution context was destroyed”。等到 quietMs 内主框架不再导航、且已 load，再往下走。
//
// 冷启动重载每个 Astro 进程只发一次（vite 依赖重优化由首个 HMR 客户端连接触发，站点浏览器端
// 的裸依赖只有 @floating-ui/dom 一个），一组 e2e 一个 worker 进程，所以本 worker 等过一次之后
// 后续调用直接返回（实测约半数调用是纯死等）。它兜不住的是另一种重载：内容 / 登记变更会把
// 开着的页整页重载——改过内容或登记后再导航的调用方传 { force: true } 真等
//（article-source、prose-comments 的两处跨用例护栏、rail-align 的全部）。
// 若「Execution context was destroyed」类偶发重现，第一 suspect 就是这个跳过。
let coldReloadSettled = false;

export async function waitNoReload(page, { force = false, quietMs = 800 } = {}) {
  if (coldReloadSettled && !force) return;
  coldReloadSettled = true;
  let navs = 0;
  const onNav = (frame) => { if (frame === page.mainFrame()) navs += 1; };
  page.on('framenavigated', onNav);
  try {
    for (let seen = -1; seen !== navs;) {
      seen = navs;
      await page.waitForTimeout(quietMs); // 静默窗口：quietMs 内主框架不再导航
      await page.waitForLoadState('load');
    }
  } finally {
    page.off('framenavigated', onNav);
  }
}
