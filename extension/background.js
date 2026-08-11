/* pinpoint extension background service worker (MV3).
 *
 * 主入口：点击工具栏 pinpoint 图标 → 打开 Chrome 原生侧边栏（side panel）。
 * 原生分屏不占页面视口（页面按更窄视口正常 reflow）——这是 0.3.0 起取代
 * 页面内 #ann-sidebar 浮层的面板形态（owner 2026-08-11：浮层恒压页面右侧
 * 280px，与高保真评审冲突）。面板本体是 sidepanel.html/js 壳 + iframe 指向
 * pinpoint 服务的 /panel 页；页面内 #ann-sidebar 仍保留给无扩展场景
 * （/sites/ 直开、S 键、工具条「列表」按钮）。
 */
chrome.action.onClicked.addListener(function (tab) {
  if (!tab || typeof tab.id !== 'number') return;
  if (!chrome.sidePanel || typeof chrome.sidePanel.open !== 'function') return;
  var opened = chrome.sidePanel.open({ tabId: tab.id });
  if (opened && typeof opened.catch === 'function') {
    opened.catch(function () { /* 打不开的页面（chrome:// 等）安静略过 */ });
  }
});
