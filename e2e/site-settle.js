// 冷启动的 Astro 开发服务器：第一个页面的 HMR socket 一连上，vite 就发一条 full-reload，
// 页面整页重载一次（2026-10-13 实测，没有画布卡片的文章也一样；页面越重，重载落得越晚，
// 带卡片的文章在出页后约 250 ms）。重载途中点 [[ ]]、跑 page.evaluate 会落空或报
// “Execution context was destroyed”。等到 800 ms 内主框架不再导航、且已 load，再往下走。
export async function waitNoReload(page, quietMs = 800) {
  let navs = 0;
  const onNav = (frame) => { if (frame === page.mainFrame()) navs += 1; };
  page.on('framenavigated', onNav);
  try {
    for (let seen = -1; seen !== navs;) {
      seen = navs;
      await page.waitForTimeout(quietMs);
      await page.waitForLoadState('load');
    }
  } finally {
    page.off('framenavigated', onNav);
  }
}
