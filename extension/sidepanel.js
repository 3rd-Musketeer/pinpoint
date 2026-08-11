/* pinpoint side panel 壳（extension page）。
 *
 * 职责：
 *   1. 锁定目标标签页（?tab=<id> 覆盖，否则当前窗口的活动 tab），并跟随
 *      切换标签页 / URL 变化（SPA pushState 也触发 onUpdated）重新绑定；
 *   2. 向目标 tab 的 content script 要 page-info；陈旧标签页（扩展重载前就
 *      开着的）先用 chrome.scripting 幂等补注 content.js 再重试；
 *   3. 快乐路径：iframe 加载 pinpoint 服务的 /panel 页（entry/page/tab/mode
 *      参数），列表数据与实时同步由面板页自己走 annotate API + SSE；
 *   4. 死法分层提示（本地渲染，不依赖服务可达）：服务没起 / 页面不支持 /
 *      桥没响应 / 页面组件过旧 / 未注册 / workbench 壳页；
 *   5. 转发面板页 postMessage 来的命令（jump/edit/del/mode）给目标 tab 的
 *      content script（校验 event.origin 必须是当前 iframe 源）。
 */
(function () {
  'use strict';

  var frame = document.getElementById('panel-frame');
  var hint = document.getElementById('hint');

  var tabIdOverride = (function () {
    var m = /[?&]tab=(\d+)/.exec(location.search);
    return m ? parseInt(m[1], 10) : null;
  })();

  var currentKey = null;   // 防止重复设置 iframe src / 重复渲染提示

  function showHint(text) {
    if (currentKey !== 'hint:' + text) {
      frame.hidden = true;
      frame.src = 'about:blank';
      hint.textContent = text;
      hint.hidden = false;
      currentKey = 'hint:' + text;
    }
  }

  function showPanel(serviceOrigin, params) {
    var url = serviceOrigin + '/panel.html?' + params;
    if (currentKey === url) return;
    currentKey = url;
    hint.hidden = true;
    frame.hidden = false;
    frame.src = url;
  }

  function currentTab() {
    if (tabIdOverride !== null) return Promise.resolve(tabIdOverride);
    return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      return tabs && tabs[0] && typeof tabs[0].id === 'number' ? tabs[0].id : null;
    });
  }

  function pageInfo(tabId) {
    return chrome.tabs.sendMessage(tabId, { type: 'pinpoint:page-info' });
  }

  function apply(tabId, info) {
    if (!info) { showHint('标注桥没响应：按 ⌘R 刷新本页后重试'); return; }
    if (info.hasClient && !info.clientReady) {
      showHint('pinpoint 页面组件过旧：按 ⌘R 刷新本页即可标注');
      return;
    }
    if (info.suppressed) {
      showHint('这是 pinpoint 工作台：标注在页面左侧的列表里');
      return;
    }
    if (!info.entry || !info.serviceOrigin) {
      if (info.status === 'no-service' || (info.entry && !info.serviceOrigin)) {
        showHint('pinpoint 服务未运行：到 pinpoint 仓库执行 just dev');
      } else {
        showHint('此页面不在 pinpoint registry 里，只有注册的 url 条目可以标注');
      }
      return;
    }
    showPanel(info.serviceOrigin,
      'entry=' + encodeURIComponent(info.entry) +
      '&page=' + encodeURIComponent(info.pathname || '/') +
      '&tab=' + tabId +
      (info.mode ? '&mode=' + encodeURIComponent(info.mode) : ''));
  }

  function bind(tabId) {
    if (typeof tabId !== 'number') { showHint('找不到目标标签页'); return; }
    chrome.tabs.get(tabId).then(function (tab) {
      // 非 localhost 页面（含 url 不可见的站点，host 权限限 localhost 域时
      // tab.url 为空串）直接提示，不做无谓的补注重试。
      var url = (tab && tab.url) || '';
      if (!/^https?:\/\/(localhost|127\.0\.0\.1|[^/:@]+\.localhost)([:/]|$)/.test(url)) {
        showHint('此页面不支持标注（仅 localhost 开发页）');
        return;
      }
      pageInfo(tabId).then(function (info) {
        apply(tabId, info);
      }, function () {
        // 无 content script（陈旧标签页）：程序化补注（幂等）后重试一次。
        chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] })
          .then(function () { return pageInfo(tabId); })
          .then(function (info) { apply(tabId, info); }, function () {
            showHint('标注桥没响应：按 ⌘R 刷新本页后重试');
          });
      });
    }, function () { showHint('找不到目标标签页'); });
  }

  function rebind() {
    currentTab().then(function (tabId) { bind(tabId); });
  }

  if (tabIdOverride === null) {
    chrome.tabs.onActivated.addListener(function () { rebind(); });
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
      if (!changeInfo) return;
      if (changeInfo.url || changeInfo.status === 'complete') rebind();
    });
  }

  // 面板页（iframe）→ 壳 → 目标 tab 的命令通道。origin 必须等于当前 iframe 源。
  window.addEventListener('message', function (event) {
    var d = event.data || {};
    if (d.source !== 'pinpoint-panel') return;
    var frameOrigin = null;
    try { frameOrigin = new URL(frame.src).origin; } catch (e) { return; }
    if (!frameOrigin || event.origin !== frameOrigin) return;
    if (['jump', 'edit', 'del', 'mode'].indexOf(d.cmd) < 0) return;
    currentTab().then(function (tabId) {
      if (typeof tabId !== 'number') return;
      var sent = chrome.tabs.sendMessage(tabId, {
        type: 'pinpoint:panel-cmd', cmd: d.cmd, n: d.n, on: d.on
      });
      if (sent && typeof sent.catch === 'function') sent.catch(function () {});
    });
  });

  rebind();
})();
