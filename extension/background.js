/* pinpoint extension background service worker (MV3).
 *
 * 主入口：点击浏览器工具栏的 pinpoint 图标 → 开合当前标签页的标注面板
 * （#ann-sidebar）。面板由页面主世界的 annotate client 渲染；SW 只把点击转成
 * 一条 tab 消息，content script 再经共享 DOM CustomEvent 桥进主世界（内联
 * script 会被严格 CSP 拦掉，见 content.js 头注）。
 *
 * 当前 tab 没有 content script（非 localhost 匹配页、chrome:// 等）时
 * sendMessage 会 reject —— 安静 no-op，不报错、不开新页。
 */
chrome.action.onClicked.addListener(function (tab) {
  if (!tab || typeof tab.id !== 'number') return;
  try {
    var sent = chrome.tabs.sendMessage(tab.id, { type: 'pinpoint:toggle-sidebar' });
    if (sent && typeof sent.catch === 'function') {
      sent.catch(function () { /* no receiver on this tab — quiet no-op */ });
    }
  } catch (e) { /* no receiver on this tab — quiet no-op */ }
});
