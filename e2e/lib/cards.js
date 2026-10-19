/**
 * 文章页画布卡片帧内容的定位器：留 iframe 的帧（运行时脚本回退 / doc 壳 / 挂载失败）读
 * iframe 文档；静态帧的内容在 shadow root 里，Playwright 的 css 选择器直接穿透。
 * 返回 Promise：iframe 与否要在页面上查。
 */
export async function cardInner(page, screen, selector) {
  const fig = page.locator(`[data-pp-canvas] .cc-frame[data-screen="${screen}"]`);
  const iframed = (await fig.locator('iframe').count()) > 0;
  return iframed
    ? page.frameLocator(`[data-pp-canvas] .cc-frame[data-screen="${screen}"] iframe`).locator(selector)
    : fig.locator(selector);
}
