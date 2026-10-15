// 文章画布上 HTML 卡片的标注数（纯计算在 lib/html-card-counts.js）：板装好后按每张卡片的地址读那一页的
// 账本，之后跟着 SSE 的 annotations 事件变（Sidebar 收到后在 window 上转发 wb:annotations，不另开连接）。
// 关掉页面浮层回画布时数已经是新的：浮层里每存一次，服务就推一次。
import { htmlCardCountText, htmlFrameLedgerKey, htmlFramePending, ledgerMatches } from './lib/html-card-counts.js';

var current = { pageId: '', keys: new Map() };   // 账本名 → [卡片的计数节点]
var lastCounts = new Map();                        // pageId + '\0' + 账本名 → 条数（重装板时先画上次的数）

function paint(key, n) {
  var nodes = current.keys.get(key) || [];
  lastCounts.set(current.pageId + '\0' + key, n);
  nodes.forEach(function (node) {
    var text = htmlCardCountText(n);
    node.textContent = text;
    node.toggleAttribute('hidden', !text);
    var card = node.closest('.wb-screen[data-html-card]');
    if (card) card.setAttribute('data-ann-count', String(n));
  });
}

function readLedger(pageId, key) {
  return fetch('/annotations/' + encodeURIComponent(key) + '?entry=' + encodeURIComponent(pageId), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
}

/** 板装好后调（stage.js loadBoard）：不是文章画布的板也调，清掉上一页的登记。 */
export function syncHtmlCardCounts(panel, pageId) {
  current = { pageId: pageId || '', keys: new Map() };
  if (!panel || !pageId) return;
  panel.querySelectorAll('.wb-screen[data-html-card]').forEach(function (card) {
    var frame = card.querySelector('iframe.wb-html-card-frame');
    var node = card.querySelector('[data-html-card-count]');
    // 相对地址按文档的 <base href="/"> 解析，和 iframe 自己一样（按 location.href 会多出 /workbench/，{ id, src } 帧的账本名就对不上）。
    var key = frame ? htmlFrameLedgerKey(frame.getAttribute('data-src'), document.baseURI) : '';
    if (!key || !node) return;
    card.setAttribute('data-ledger', key);
    if (!current.keys.has(key)) current.keys.set(key, []);
    current.keys.get(key).push(node);
  });
  var mine = current;
  current.keys.forEach(function (_, key) {
    var cached = lastCounts.get(pageId + '\0' + key);
    if (cached != null) paint(key, cached);
    readLedger(pageId, key).then(function (doc) {
      if (current === mine) paint(key, htmlFramePending(doc));
    }).catch(function () { /* 读不到：留着上次的数，下一次推送再画 */ });
  });
}

window.addEventListener('wb:annotations', function (e) {
  var doc = e.detail;
  if (!doc || doc.entry !== current.pageId) return;
  current.keys.forEach(function (_, key) {
    if (ledgerMatches(doc.page, key)) paint(key, htmlFramePending(doc));
  });
});
