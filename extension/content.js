/* pinpoint extension content script (isolated world, top frame only).
 *
 * On every matched local-dev page:
 *   1. Probe candidate service origins for a live /registry — the persistent
 *      pinpoint service first, then the page's own origin (a pinpoint-served
 *      page needs no proxy hop). First origin returning JSON wins; if none
 *      responds the service is down and we stay out of the page.
 *   2. Match location.origin against the registry's url entries (exact origin
 *      match). No match → the page is not a registered review target → exit.
 *   3. Hand the entry id to the page's MAIN world through the DOM:
 *      <html data-pinpoint-entry="...">. A content script cannot touch the
 *      main world's window, and an injected inline <script> is blocked
 *      whenever the page ships a strict CSP — the shared DOM attribute is
 *      the reliable bridge (annotate.js reads it before 'pinpoint' default).
 *      Then inject the annotate client itself. annotate.js guards on
 *      window.__pinpoint, so repeat injection is a no-op.
 *
 * Script origin: since Chrome 130, scripts injected by a content script are
 * checked against the extension's own CSP, whose default whitelists only the
 * extension origin and http://localhost:* / http://127.0.0.1:* — a remote
 * https origin (e.g. https://pinpoint.localhost) is refused. The registry
 * payload therefore carries service.directOrigin (the API's actual loopback
 * bind, no TLS proxy); we load annotate.js from there and the client keeps
 * calling the same direct origin. Loopback http is a potentially trustworthy
 * origin, so an https page does not treat it as mixed content, and CORS
 * (Access-Control-Allow-Origin: *, no credentials) covers the cross-origin
 * calls. Older servers without service.directOrigin fall back to the winning
 * candidate origin.
 *
 * Chrome Side Panel 桥（0.3.0 起）：图标点击打开浏览器原生侧边栏（不占页面
 * 视口，见 extension/sidepanel.js）。本脚本是面板与页面之间的桥：
 *   - 'pinpoint:page-info' → 同步应答页面状态（entry/pathname/client 就绪/
 *     抑制/模式/服务源），面板据此渲染列表或对应提示；
 *   - 'pinpoint:panel-cmd' → 把面板命令（jump/edit/del/mode）经共享 DOM
 *     CustomEvent('pinpoint:command') 转发给主世界 client（CSP 安全）。
 */
(function () {
  'use strict';

  // 幂等守卫：面板/background 会对陈旧标签页程序化补注本脚本，补注可能与声明
  // 式注入撞车或重复触发。同一扩展在同一 frame 的多次执行共享隔离世界的
  // window，据此保证只装一份监听/只跑一遍探测，避免命令双发。
  if (window.__pinpointContent) return;
  window.__pinpointContent = true;

  var CANDIDATES = ['https://pinpoint.localhost', location.origin];

  // 'pending' | 'injected' | 'no-match' | 'no-service'
  var clientStatus = 'pending';
  var probePromise = null;      // 在途探测复用；落定后清空，允许需要时重探测
  var serviceOrigin = null;     // client/面板的加载源（service.directOrigin 优先）
  var matchedEntryId = null;    // registry url 条目匹配结果

  function fetchRegistry(origin) {
    return fetch(origin + '/registry').then(function (res) {
      if (!res.ok) throw new Error('registry HTTP ' + res.status);
      return res.json();
    }).then(function (registry) {
      return { origin: origin, registry: registry };
    });
  }

  function matchingEntry(entries) {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry || entry.kind !== 'url' || typeof entry.url !== 'string') continue;
      try {
        if (new URL(entry.url).origin === location.origin) return entry;
      } catch (e) { /* unparseable entry url — skip */ }
    }
    return null;
  }

  function inject(scriptOrigin, entryId) {
    document.documentElement.setAttribute('data-pinpoint-entry', entryId);
    // 页面里已有 client（/sites/ 服务端注入，或陈旧标签页里的旧版注入）就不再
    // 加第二个 script 标签；旧 client 的就绪/陈旧判定见 page-info 应答。
    if (document.querySelector('script[data-pinpoint-extension], script[src*="/annotate.js"]')) return;
    var client = document.createElement('script');
    client.src = scriptOrigin + '/annotate.js';
    client.setAttribute('data-pinpoint-extension', '');
    (document.head || document.documentElement).appendChild(client);
  }

  // 页面主世界是否已有 annotate client（任何来源：扩展注入、/sites/ 服务端
  // 注入、workbench 壳自带）。就绪标记或 script 标签任一即为有。
  function hasClient() {
    return document.documentElement.hasAttribute('data-pinpoint-client') ||
      !!document.querySelector('script[data-pinpoint-extension], script[src*="/annotate.js"]');
  }

  // 探测 + 注入。幂等：已注入短路；在途复用；落定后可被重触发（服务可能后来
  // 起了、entry 可能后来注册了）。
  function probeAndInject() {
    if (clientStatus === 'injected') return Promise.resolve(clientStatus);
    if (probePromise) return probePromise;
    var tried = {};
    var chain = Promise.reject();
    CANDIDATES.forEach(function (origin) {
      if (tried[origin]) return;
      tried[origin] = true;
      chain = chain.catch(function () { return fetchRegistry(origin); });
    });
    probePromise = chain.then(function (winner) {
      var service = winner.registry && winner.registry.service;
      serviceOrigin = (service && service.directOrigin) || winner.origin;
      var entries = (winner.registry && winner.registry.entries) || [];
      var entry = matchingEntry(entries);
      if (entry) {
        matchedEntryId = entry.id;
        inject(serviceOrigin, entry.id);
        clientStatus = 'injected';
      } else {
        clientStatus = 'no-match';
      }
      return clientStatus;
    }).catch(function () {
      clientStatus = 'no-service';
      return clientStatus;
    }).then(function (status) {
      probePromise = null;
      return status;
    });
    return probePromise;
  }

  // 页面状态应答（面板壳据此决定渲染列表还是哪种提示）。
  function pageInfo() {
    return {
      status: clientStatus,
      entry: matchedEntryId || document.documentElement.getAttribute('data-pinpoint-entry'),
      pathname: location.pathname,
      serviceOrigin: serviceOrigin,
      clientReady: document.documentElement.hasAttribute('data-pinpoint-client'),
      hasClient: hasClient(),
      suppressed: document.documentElement.getAttribute('data-pinpoint-sidebar') === 'suppressed',
      mode: document.documentElement.getAttribute('data-pinpoint-mode')
    };
  }

  var PANEL_COMMANDS = { jump: 1, edit: 1, del: 1, mode: 1 };

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'pinpoint:page-info') {
      // 探测还在路上时先等它落定，应答才权威（同步 sendResponse 不够用）。
      probeAndInject().then(function () { sendResponse(pageInfo()); });
      return true;
    }
    if (msg.type === 'pinpoint:panel-cmd' && PANEL_COMMANDS[msg.cmd]) {
      document.dispatchEvent(new CustomEvent('pinpoint:command', {
        detail: { command: msg.cmd, n: msg.n, on: msg.on }
      }));
    }
  });

  probeAndInject();
})();
