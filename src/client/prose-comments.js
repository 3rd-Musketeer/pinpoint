/* 正文评论（pp3）：article 页上选中正文文字 → 浮出“评论” → 高亮 + 右栏线程。
 *
 * 只在注入方写了 window.__pinpointProse 的页面上跑（article-proxy 给文章页注入），
 * 由 annotate.js 在最前面分流过来；这时不起画布标注的工具条、侧栏与元素标注。
 * 数据走标注客户端的同一条路：桶 = window.__pinpointEntry（文章页 id
 * `<project>_<article>`），账本固定 @prose，与这篇画布的 @canvas 同桶、同一套 #n
 * 和状态机；GET /annotations 水合、POST /save 带 baseRevision、/events 同步。
 *
 * 锚点：src/shared/text-quote.js（exact + prefix / suffix + section 与 start 提示）。
 * 正文被抽成一条规范化文本（buildTextIndex：块元素边界算一处空白，再交给
 * normalizeWhitespace —— 两个 CJK 字之间的空白算没有，其余连成一个空格），每次重画
 * 都重新定位；定位不到的线程留在右栏，标“失效”，显示存下的引文。
 * 画布卡片（[data-pp-canvas]）、正文里的图（[data-pp-figure]）、脚本、错误条不进文本，选区落在那里不出“评论”。
 *
 * 右栏里还穿插这篇的画布标注（同桶的 @canvas 账本）：按帧归到所在的画布卡片，排在卡片的位置；
 * 这里只改它们的状态（完成 / 重新打开），点卡片在文章上开画布浮层并定位到那颗钉子
 * （site/src/lib/canvas-overlay-client.js 接住 a[data-pp-canvas-link]）。每拿到一版画布账本就发
 * pp:canvas-ledger，画布卡片头的标注数跟着变（site/src/lib/canvas-card-client.js）。
 *
 * 写入是操作队列（src/client/lib/ops-ledger.js，两本账本各一个）：保存撞上 409 时把
 * 没落盘的操作重放到磁盘最新版再存，agent 刚写的回复不会被旧快照盖掉；别的拒绝
 * 把新评论退回草稿、回复退回输入框，右栏写出原因。
 *
 * 同步：SSE（/events）断了会自己重连，重连上就重新水合，补上断线期间漏掉的事件；
 * pagehide 时关掉，从 bfcache 回来（pageshow persisted，比如从画布按“返回”）时重开
 * 并重新水合。 */

import { locateQuote, normalizeWhitespace, quoteFromText } from '../shared/text-quote.js';
import { onPageLeave } from './lib/save-request.js';
import { createOpsLedger } from './lib/ops-ledger.js';
import { createCanvasLedgers } from './lib/canvas-ledgers.js';
import {
  authorLabel,
  canvasContentText,
  canvasRailItems,
  formatWhen,
  isProseClosed,
  isProseRow,
  isSendKey,
  newProseRow,
  PROSE_LEDGER,
  railOrder,
  threadMessages,
} from '../shared/prose-thread.js';
import { ANN_STATUS_COLORS } from '../shared/ann-status.js';

var SKIP_SELECTOR = 'script,style,noscript,template,textarea,[data-pp-canvas],[data-pp-figure],[data-pp-nocomment],.errors';
var BLOCK_TAGS = /^(P|H[1-6]|LI|UL|OL|DL|DT|DD|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|FIGURE|FIGCAPTION|HR|BR)$/;
var MARK_CLASS = 'pp-hl';
var MAX_CONFLICT_RETRIES = 5;

function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/** 正文 → 规范化文本 + 每个文本节点的偏移表（map[k] = 该节点第 k 个字符在规范化文本里的位置）。 */
export function buildTextIndex(root) {
  var raw = '';
  var entries = [];
  var cards = [];
  function walk(el) {
    for (var child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        entries.push({ node: child, at: raw.length });
        raw += child.data;
      } else if (child.nodeType === 1) {
        // 画布卡片不进文本，但记下它在文本里的位置：右栏把这一节的画布标注排在这里。
        if (child.matches('[data-pp-canvas]')) cards.push({ el: child, at: raw.length });
        if (child.matches(SKIP_SELECTOR)) continue;
        var block = BLOCK_TAGS.test(child.tagName);
        if (block) raw += ' ';
        walk(child);
        if (block) raw += ' ';
      }
    }
  }
  walk(root);
  var norm = normalizeWhitespace(raw);
  var nodes = entries.map(function (e) {
    var len = e.node.data.length;
    var map = norm.map.slice(e.at, e.at + len + 1);
    return { node: e.node, start: map[0], end: map[len], map: map };
  });
  return {
    text: norm.text,
    nodes: nodes,
    cards: cards.map(function (c) { return { el: c.el, offset: norm.map[Math.min(c.at, norm.map.length - 1)] }; }),
  };
}

function sectionOfNode(node) {
  var el = node.parentElement && node.parentElement.closest('[data-section]');
  return el ? el.getAttribute('data-section') || '' : '';
}

function sectionAtFor(index) {
  return function (offset) {
    for (var i = 0; i < index.nodes.length; i++) {
      var n = index.nodes[i];
      if (offset < n.end) return sectionOfNode(n.node);
    }
    return '';
  };
}

/** DOM 选区 → 规范化文本上的 [start, end)；选区不碰正文返回 null。导出只给 e2e/prose-text-index.spec.js。 */
export function rangeToOffsets(range, index) {
  var start = null;
  var end = null;
  for (var i = 0; i < index.nodes.length; i++) {
    var n = index.nodes[i];
    if (!range.intersectsNode(n.node)) continue;
    var a = n.node === range.startContainer ? n.map[Math.min(range.startOffset, n.map.length - 1)] : n.map[0];
    var b = n.node === range.endContainer ? n.map[Math.min(range.endOffset, n.map.length - 1)] : n.map[n.map.length - 1];
    if (start === null) start = a;
    end = b;
  }
  return start === null || end === null || end <= start ? null : { start: start, end: end };
}

/** 规范化区间 → 各文本节点上的原文区间 [{ entry, from, to }]。 */
function offsetsToSegments(start, end, index) {
  var out = [];
  for (var i = 0; i < index.nodes.length; i++) {
    var n = index.nodes[i];
    if (n.end <= start || n.start >= end) continue;
    var s = Math.max(start, n.start);
    var e = Math.min(end, n.end);
    if (s >= e) continue;
    var len = n.map.length - 1;
    var from = 0;
    while (from < len && n.map[from + 1] <= s) from += 1;
    var to = from + 1;
    while (to < len && n.map[to] < e) to += 1;
    if (to > from) out.push({ entry: n, from: from, to: to });
  }
  return out;
}

export function unpaint(root) {
  var marks = root.querySelectorAll('mark.' + MARK_CLASS);
  var parents = new Set();
  for (var i = 0; i < marks.length; i++) {
    var m = marks[i];
    var parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parents.add(parent);
  }
  parents.forEach(function (p) { p.normalize(); });
}

/** items: [{ id, start, end, draft? }]，同一段文字可被多条覆盖（data-ids 列全部）。 */
export function paintSegments(index, items) {
  var byNode = new Map();
  items.forEach(function (item) {
    offsetsToSegments(item.start, item.end, index).forEach(function (seg) {
      if (!byNode.has(seg.entry)) byNode.set(seg.entry, []);
      byNode.get(seg.entry).push({ from: seg.from, to: seg.to, id: item.id, draft: !!item.draft });
    });
  });
  byNode.forEach(function (spans, entry) {
    var node = entry.node;
    var raw = node.data;
    var cuts = new Set([0, raw.length]);
    spans.forEach(function (s) { cuts.add(s.from); cuts.add(s.to); });
    var points = Array.from(cuts).sort(function (a, b) { return a - b; });
    var frag = document.createDocumentFragment();
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i];
      var b = points[i + 1];
      if (a === b) continue;
      var piece = raw.slice(a, b);
      var covering = spans.filter(function (s) { return s.from <= a && s.to >= b; });
      if (!covering.length) {
        frag.appendChild(document.createTextNode(piece));
        continue;
      }
      var mark = document.createElement('mark');
      mark.className = MARK_CLASS + (covering.some(function (s) { return s.draft; }) ? ' draft' : '');
      mark.setAttribute('data-ids', covering.map(function (s) { return s.id; }).join(' '));
      mark.textContent = piece;
      frag.appendChild(mark);
    }
    node.parentNode.replaceChild(frag, node);
  });
}

function newId() {
  var rand = Math.random().toString(36).slice(2, 10);
  return 'p' + Date.now().toString(36) + rand;
}

export function startProseComments(options) {
  var SERVER = options.server || '';
  var ENTRY = options.entry;
  var root = document.getElementById('article');
  var rail = document.querySelector('[data-pp-rail]');
  if (!root || !rail || !ENTRY) return null;

  var LEDGER = PROSE_LEDGER;
  var PATH = (function () { try { return decodeURIComponent(location.pathname); } catch (e) { return location.pathname; } })();

  var rows = [];          // 正文评论：盘上 + 还没落盘的操作，界面看到的
  var connection = 'connecting'; // connecting | online | offline
  var expanded = new Set(); // 展开了的已关闭线程 id（不记盘：每次打开文章都收着）
  var replyOpen = new Set(); // 展开了回复框的线程 id
  var replyText = {};     // 线程 id -> 回复框里的字（框收起后草稿也留着）
  var focusedId = null;
  var draft = null;       // { quote, section, start, end }
  var anchors = new Map(); // id -> { start, end } | null（null = 失效）
  var cardOffsets = new Map(); // 画布卡片的节 id -> 它在规范化文本里的位置（右栏排画布标注用）
  var paintSig = '';
  var painting = false;
  var selBtn = null;
  var pendingSel = null;
  var selectionChecks = 0; // 判过几次选区（测试用的可观察信号）
  var lastOffered = false;

  // ---------- 同步 ----------
  // 两本账本，同一个桶：@prose 是正文评论；@canvas 是这篇画布上的标注，右栏按卡片位置穿插进来、
  // 只在这里改状态（完成 / 重新打开），别的都在画布上改。正文里没有画布卡片就不读 @canvas。
  var hasCanvas = !!root.querySelector('[data-pp-canvas]');
  var prose = createOpsLedger({
    server: SERVER, entry: ENTRY, ledger: LEDGER, maxConflicts: MAX_CONFLICT_RETRIES,
    path: function () { return PATH; },
    onChange: recompute,
    onRejected: function (list) { return restoreRejected(list); },
  });
  // 画布上的 HTML 帧（一篇文章一张画布，2026-10-15）：那一页的标注在同桶里它自己的账本里，一起读进来
  // （lib/canvas-ledgers.js），右栏和卡片标注数都含它们。
  var canvas = hasCanvas ? createCanvasLedgers({
    server: SERVER, entry: ENTRY, maxConflicts: MAX_CONFLICT_RETRIES,
    pages: Array.prototype.map.call(root.querySelectorAll('[data-pp-canvas] .cc-frame[data-doc-url]'), function (fig) {
      return { id: fig.getAttribute('data-screen') || '', url: fig.getAttribute('data-doc-url') || '' };
    }),
    onChange: function () { announceCanvas(); renderRail(); },
  }) : null;

  function recompute() {
    rows = prose.rows().filter(isProseRow);
    render();
  }

  // 画布卡片头的标注数跟着这本账本走（site/src/lib/canvas-card-client.js 听这个事件）。
  function announceCanvas() {
    document.dispatchEvent(new CustomEvent('pp:canvas-ledger', { detail: { entry: ENTRY, doc: { annotations: canvas.rows() } } }));
  }

  // 被拒的操作里 owner 写的字：新评论 → 草稿（已有草稿时不顶掉它），回复 → 输入框。
  var restoreText = {};   // textarea data-reply id -> 下次画右栏时放回的字
  function restoreRejected(list) {
    var restored = false;
    list.forEach(function (op) {
      if (op.op === 'create' && op.row && op.row.quote && !draft) {
        var q = op.row.quote;
        draft = { quote: q, section: op.row.section || '', start: Number.isInteger(q.start) ? q.start : Infinity };
        restoreText.__draft = op.row.content || '';
        focusedId = '__draft';
        restored = true;
      } else if (op.op === 'reply' && op.text) {
        restoreText[op.id] = restoreText[op.id] ? restoreText[op.id] + '\n' + op.text : op.text;
        replyOpen.add(op.id);
        if (focusedId !== '__draft') focusedId = op.id;
        restored = true;
      }
    });
    return restored;
  }

  function flushOnLeave() {
    prose.flushOnLeave();
    if (canvas) canvas.flushOnLeave();
  }

  function enqueue(op) {
    prose.enqueue(op);
  }

  function readLedger(name) {
    return fetch(SERVER + '/annotations/' + encodeURIComponent(name) + '?entry=' + encodeURIComponent(ENTRY))
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
  }

  function hydrate() {
    // 画布账本读不到（还没人标过时它也在：服务给空账本）不影响正文评论，下次重连再读。
    if (canvas) {
      canvas.names().forEach(function (name) {
        readLedger(name).then(function (doc) { canvas.accept(name, doc); }).catch(function () {});
      });
    }
    return readLedger(LEDGER)
      .then(function (doc) {
        connection = 'online';
        prose.accept(doc);
      })
      .catch(function () {
        connection = 'offline';
        render();
        scheduleHydrateRetry();
      });
  }

  var hydrateTimer = 0;
  function scheduleHydrateRetry() {
    clearTimeout(hydrateTimer);
    hydrateTimer = setTimeout(hydrate, 3000);
  }

  var events = null;
  var eventsBroken = false;   // 断过一次：下次连上要重新水合
  var reconnectTimer = 0;
  var RECONNECT_MS = 2000;
  function connectEvents() {
    if (typeof EventSource === 'undefined') return;
    closeEvents();
    var es;
    try { es = new EventSource(SERVER + '/events'); } catch (e) { return; }
    events = es;
    es.onopen = function () {
      if (es !== events) return;
      if (eventsBroken) {
        // 断线期间推的事件都丢了：从磁盘补一次。
        eventsBroken = false;
        hydrate();
      } else if (connection === 'offline' && prose.hydrated()) {
        connection = 'online';
        render();
      }
    };
    es.onerror = function () {
      if (es !== events) return;
      eventsBroken = true;
      // CONNECTING：浏览器自己在重连，连上走 onopen。CLOSED：浏览器放弃了，自己再开一条。
      if (es.readyState === 2) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(function () { if (es === events) connectEvents(); }, RECONNECT_MS);
      }
    };
    es.addEventListener('annotations', function (ev) {
      if (es !== events) return;
      var doc;
      try { doc = JSON.parse(ev.data); } catch (e) { return; }
      if (!doc || doc.entry !== ENTRY) return;
      if (doc.page === LEDGER) prose.remote(doc);
      else if (canvas) canvas.remote(doc);
    });
  }

  function closeEvents() {
    clearTimeout(reconnectTimer);
    if (!events) return;
    try { events.close(); } catch (e) { /* */ }
    events = null;
  }

  onPageLeave(flushOnLeave);
  window.addEventListener('pagehide', closeEvents);
  // 从 bfcache 回来（从画布按“返回”）：页面原样恢复，但 SSE 在 pagehide 时关了，
  // 离开期间的改动也没收到。重开 SSE，再从磁盘水合一次。
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    eventsBroken = false;
    connectEvents();
    hydrate();
  });

  // ---------- 锚点与高亮 ----------
  // 已关闭的线程收着时不画高亮，展开那一条才画：正文里只剩还要处理的。
  function visible(row) {
    return !isProseClosed(row) || expanded.has(row.id);
  }

  function paint() {
    var shown = rows.filter(visible);
    var sig = JSON.stringify([
      shown.map(function (r) { return [r.id, r.quote && r.quote.exact, r.quote && r.quote.prefix, r.quote && r.quote.suffix, r.section]; }),
      draft ? [draft.quote.exact, draft.start] : null,
    ]);
    if (sig === paintSig && !paintDirty) return;
    paintSig = sig;
    paintDirty = false;
    painting = true;
    observer.disconnect();
    unpaint(root);
    var index = buildTextIndex(root);
    var sectionAt = sectionAtFor(index);
    anchors = new Map();
    cardOffsets = new Map();
    index.cards.forEach(function (c) {
      var section = c.el.getAttribute('data-pp-section');
      if (section && !cardOffsets.has(section)) cardOffsets.set(section, c.offset);
    });
    var items = [];
    rows.forEach(function (r) {
      var hit = r.quote ? locateQuote(index.text, r.quote, { section: r.section, sectionAt: sectionAt }) : null;
      anchors.set(r.id, hit ? { start: hit.start, end: hit.end } : null);
      if (hit && visible(r)) items.push({ id: r.id, start: hit.start, end: hit.end });
    });
    if (draft) {
      var d = locateQuote(index.text, draft.quote, { section: draft.section, sectionAt: sectionAt });
      if (d) items.push({ id: '__draft', start: d.start, end: d.end, draft: true });
    }
    paintSegments(index, items);
    syncFocusClasses();
    painting = false;
    observe();
  }

  // 正文被别人换掉（站点热更新）：重画一次，重新定位。
  var paintDirty = false;
  var repaintTimer = 0;
  var observer = new MutationObserver(function () {
    if (painting) return;
    paintDirty = true;
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(function () { paint(); renderRail(); }, 50);
  });
  function observe() {
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function syncFocusClasses() {
    var marks = root.querySelectorAll('mark.' + MARK_CLASS);
    for (var i = 0; i < marks.length; i++) {
      var ids = (marks[i].getAttribute('data-ids') || '').split(' ');
      marks[i].classList.toggle('on', !!focusedId && ids.indexOf(focusedId) >= 0);
    }
    var threads = rail.querySelectorAll('.pp-thread');
    for (var j = 0; j < threads.length; j++) {
      threads[j].classList.toggle('on', threads[j].getAttribute('data-id') === focusedId);
    }
  }

  // ---------- 右栏 ----------
  function statusChip(row) {
    var st = row.status || 'open';
    var known = Object.prototype.hasOwnProperty.call(ANN_STATUS_COLORS, st) ? st : 'open';
    var n = Number.isInteger(row.n) ? '#' + row.n : '#…';
    var word = st === 'open' ? '' : '<span class="pp-st">' + esc(st) + '</span>';
    // 钉子颜色归站点样式（.pp-n[data-st]，--pp-status-*，亮暗都对）。
    return '<span class="pp-n" data-st="' + known + '">' + esc(n) + '</span>' + word;
  }

  function quoteHtml(exact) {
    var text = String(exact || '');
    if (text.length > 160) text = text.slice(0, 157) + '…';
    return '<div class="q">' + esc(text) + '</div>';
  }

  function messagesHtml(row) {
    return '<div class="msgs">' + threadMessages(row).map(function (m) {
      return '<div class="msg" data-who="' + esc(m.who) + '"><span class="who' + (m.who === 'agent' ? ' agent' : '') + '">' + esc(authorLabel(m.who)) + '</span>'
        + '<span class="when">' + esc(formatWhen(m.at)) + '</span><div class="text">' + esc(m.text) + '</div></div>';
    }).join('') + '</div>';
  }

  // 已关闭的线程留在原位收成一行：序号钉 + “已关闭” + 引文开头，点开成完整卡片，再点收回。
  function collapsedHtml(row) {
    var n = Number.isInteger(row.n) ? '#' + row.n : '#…';
    return '<div class="pp-thread pp-closed" data-id="' + esc(row.id) + '" data-n="' + esc(row.n) + '" data-status="close">'
      + '<button type="button" class="pp-closed-row" data-act="expand" aria-expanded="false">'
      + '<span class="pp-n" data-st="close">' + esc(n) + '</span>'
      + '<span class="pp-closed-word">已关闭</span>'
      + '<span class="pp-closed-peek">' + esc(String((row.quote && row.quote.exact) || '')) + '</span>'
      + '<span class="pp-chev" aria-hidden="true"></span></button></div>';
  }

  function threadHtml(row) {
    if (isProseClosed(row) && !expanded.has(row.id)) return collapsedHtml(row);
    var anchor = anchors.get(row.id);
    var stale = anchor === null && anchors.has(row.id);
    var closed = (row.status || 'open') === 'close';
    var act = closed
      ? '<button class="pp-act" type="button" data-act="reopen">重新打开</button>'
      : '<button class="pp-act" type="button" data-act="close">完成</button>';
    var focused = row.id === focusedId;
    // 回复框默认不出现：点“回复”才展开，发送后收起。框收起时留着的草稿在按钮上标出来。
    var reply = replyOpen.has(row.id)
      ? '<div class="pp-reply"><textarea data-reply="' + esc(row.id) + '" rows="2" placeholder="回复…" aria-label="回复 #' + esc(row.n) + '"></textarea>'
        + '<div class="acts"><button class="btn pri" type="button" data-act="reply">发送</button></div></div>'
      : '<div class="pp-foot"><button class="pp-act" type="button" data-act="open-reply">回复</button>'
        + (replyText[row.id] ? '<span class="pp-draft-tag">有草稿</span>' : '') + '</div>';
    return '<div class="pp-thread' + (stale ? ' stale' : '') + (focused ? ' on' : '') + '" data-id="' + esc(row.id) + '" data-n="' + esc(row.n) + '" data-status="' + esc(row.status || 'open') + '">'
      + '<div class="pp-meta">' + statusChip(row)
      + (stale ? '<span class="pp-stale" title="正文里找不到这段引文了">失效</span>' : '')
      + '<span class="sp"></span>' + act
      + (isProseClosed(row) ? '<button class="pp-act pp-fold" type="button" data-act="collapse" aria-expanded="true" aria-label="收起"><span class="pp-chev up" aria-hidden="true"></span></button>' : '')
      + '</div>'
      + quoteHtml(row.quote && row.quote.exact)
      + messagesHtml(row)
      + reply
      + '</div>';
  }

  // 画布标注（@canvas）在右栏里的卡片：标明是画布标注和帧名，有截图放缩略图；点了在文章上开画布浮层、
  // 定位到这颗钉子（a[data-pp-canvas-link]，site/src/lib/canvas-overlay-client.js 接住）。四态与已关闭
  // 原地收起同正文评论；这里只改状态，回复和改正文在画布上。线程 id 带 c: 前缀，和正文评论分开。
  function canvasCards() {
    return Array.prototype.map.call(root.querySelectorAll('[data-pp-canvas]'), function (card) {
      return {
        section: card.getAttribute('data-pp-section') || '',
        page: card.getAttribute('data-page') || '',
        frames: Array.prototype.map.call(card.querySelectorAll('.cc-frame[data-screen]'), function (fig) {
          return { id: fig.getAttribute('data-screen'), title: fig.getAttribute('data-title') || fig.getAttribute('data-screen') };
        }),
      };
    });
  }

  // HTML 帧带帧 id，以便在整张画布上的活卡片里找到对应账本。
  function cssEscape(v) { return window.CSS && CSS.escape ? CSS.escape(String(v)) : String(v); }

  function isHtmlFrame(section, frameId) {
    return !!root.querySelector('[data-pp-canvas][data-pp-section="' + cssEscape(section) + '"] .cc-frame[data-doc-url][data-screen="' + cssEscape(frameId) + '"]');
  }

  function canvasHref(item) {
    var q = new URLSearchParams({ canvas: item.section });
    var html = isHtmlFrame(item.section, item.frameId);
    if (!Number.isInteger(item.row.n) || html) q.set('frame', item.frameId);
    if (Number.isInteger(item.row.n)) q.set('ann', String(item.row.n));
    return '#' + q.toString();
  }

  function canvasThreadHtml(item) {
    var row = item.row;
    var key = 'c:' + row.id;
    var text = canvasContentText(row);
    var n = Number.isInteger(row.n) ? '#' + row.n : '#…';
    var attrs = ' data-kind="canvas" data-id="' + esc(key) + '" data-n="' + esc(row.n) + '" data-section="' + esc(item.section) + '" data-frame="' + esc(item.frameId) + '"';
    if (isProseClosed(row) && !expanded.has(key)) {
      return '<div class="pp-thread pp-closed pp-canvas-ann"' + attrs + ' data-status="close">'
        + '<button type="button" class="pp-closed-row" data-act="expand" aria-expanded="false">'
        + '<span class="pp-n" data-st="close">' + esc(n) + '</span>'
        + '<span class="pp-closed-word">已关闭</span>'
        + '<span class="pp-kind">画布</span>'
        + '<span class="pp-closed-peek">' + esc(text) + '</span>'
        + '<span class="pp-chev" aria-hidden="true"></span></button></div>';
    }
    var closed = isProseClosed(row);
    var act = closed
      ? '<button class="pp-act" type="button" data-act="reopen">重新打开</button>'
      : '<button class="pp-act" type="button" data-act="close">完成</button>';
    var image = Array.isArray(row.images) && row.images[0] && row.images[0].file
      ? '<img class="pp-canvas-shot" alt="" loading="lazy" src="' + esc(SERVER + '/images/' + encodeURIComponent(row.images[0].file) + '?entry=' + encodeURIComponent(ENTRY)) + '">'
      : '';
    return '<div class="pp-thread pp-canvas-ann"' + attrs + ' data-status="' + esc(row.status || 'open') + '">'
      + '<div class="pp-meta">' + statusChip(row) + '<span class="pp-kind">画布标注</span>'
      + '<span class="sp"></span>' + act
      + (closed ? '<button class="pp-act pp-fold" type="button" data-act="collapse" aria-expanded="true" aria-label="收起"><span class="pp-chev up" aria-hidden="true"></span></button>' : '')
      + '</div>'
      + '<a class="pp-canvas-open" data-pp-canvas-link href="' + esc(canvasHref(item)) + '" title="在画布上打开这条标注">'
      + image + '<span class="pp-canvas-frame">帧<b>' + esc(item.frameTitle) + '</b></span></a>'
      + messagesHtml({ content: text, created_at: row.created_at || '', messages: row.messages })
      + '</div>';
  }

  function draftHtml() {
    return '<div class="pp-thread draft on" data-id="__draft">'
      + quoteHtml(draft.quote.exact)
      + '<textarea data-reply="__draft" rows="3" placeholder="写评论…" aria-label="写评论"></textarea>'
      + '<div class="acts"><button class="btn" type="button" data-act="cancel-draft">取消</button>'
      + '<button class="btn pri" type="button" data-act="send-draft">发送</button></div></div>';
  }

  function orderKey(row) {
    var a = anchors.get(row.id);
    return a ? a.start : Infinity;
  }

  function renderRail() {
    // 重画前记下输入框的内容与光标，重画后放回（SSE 推来 agent 回复时正在打字）。
    var keep = {};
    var active = document.activeElement;
    var areas = rail.querySelectorAll('textarea[data-reply]');
    for (var i = 0; i < areas.length; i++) {
      var key = areas[i].getAttribute('data-reply');
      keep[key] = {
        value: areas[i].value,
        focus: areas[i] === active,
        start: areas[i].selectionStart,
        end: areas[i].selectionEnd,
      };
      if (key !== '__draft') {
        if (areas[i].value) replyText[key] = areas[i].value;
        else delete replyText[key];
      }
    }
    // 一列：正文评论按引文位置，画布标注按所属卡片的位置（排在紧跟卡片的那段正文之前），同位按 #n。
    var canvasItems = canvas ? canvasRailItems(canvas.rows(), canvasCards()) : [];
    var entries = rows.map(function (row) { return { kind: 'prose', row: row, n: row.n, key: orderKey(row) }; })
      .concat(canvasItems.map(function (item) {
        var at = cardOffsets.has(item.section) ? cardOffsets.get(item.section) - 0.5 : Infinity;
        return { kind: 'canvas', item: item, n: item.row.n, key: at };
      }));
    var ordered = railOrder(entries, function (e) { return e.key; });
    var list = '';
    var draftPlaced = false;
    var draftKey = draft ? draft.start : Infinity;
    ordered.forEach(function (e) {
      if (draft && !draftPlaced && e.key > draftKey) { list += draftHtml(); draftPlaced = true; }
      list += e.kind === 'canvas' ? canvasThreadHtml(e.item) : threadHtml(e.row);
    });
    if (draft && !draftPlaced) list += draftHtml();
    var empty = !ordered.length && !draft
      ? '<p class="empty-rail">选中正文里的一段文字，点“评论”。</p>'
      : '';
    var note = connection === 'offline'
      ? '未连接 pinpoint 服务，评论暂时存不下。'
      : (prose.error() || (canvas && canvas.error()) || '');
    rail.innerHTML = '<div class="pp-rail-head"><div class="label">评论</div></div>'
      + '<div class="pp-threads">' + list + '</div>' + empty
      + '<p class="pp-rail-note" role="status">' + esc(note) + '</p>';
    Object.keys(keep).forEach(function (id) {
      var area = railArea(id);
      if (!area) return;
      area.value = keep[id].value;
      if (keep[id].focus) {
        area.focus();
        try { area.setSelectionRange(keep[id].start, keep[id].end); } catch (e) { /* */ }
      }
    });
    // 刚展开的回复框：放回框收起前留下的草稿。
    replyOpen.forEach(function (id) {
      var area = railArea(id);
      if (area && !area.value && replyText[id]) area.value = replyText[id];
    });
    Object.keys(restoreText).forEach(function (id) {
      var area = railArea(id);
      if (!area) return;
      area.value = area.value ? area.value + '\n' + restoreText[id] : restoreText[id];
      delete restoreText[id];
    });
  }

  function railArea(id) {
    return rail.querySelector('textarea[data-reply="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  }

  function render() {
    paint();
    renderRail();
  }

  function focusThread(id, opts) {
    focusedId = id;
    renderRail();
    syncFocusClasses();
    var t = rail.querySelector('.pp-thread[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (t && (!opts || opts.scroll !== false)) t.scrollIntoView({ block: 'nearest' });
    if (opts && opts.reveal) {
      var mark = root.querySelector('mark.' + MARK_CLASS + '.on');
      if (mark) mark.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---------- 选区 → 评论 ----------
  function hideSelBtn() {
    if (selBtn) { selBtn.remove(); selBtn = null; }
    pendingSel = null;
  }

  function selectionQuote() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    var startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    var endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    if ((startEl && startEl.closest(SKIP_SELECTOR)) || (endEl && endEl.closest(SKIP_SELECTOR))) return null;
    var index = buildTextIndex(root);
    var offsets = rangeToOffsets(range, index);
    if (!offsets) return null;
    var quote = quoteFromText(index.text, offsets.start, offsets.end);
    if (!quote) return null;
    return {
      quote: { exact: quote.exact, prefix: quote.prefix, suffix: quote.suffix, start: quote.start },
      start: quote.start,
      end: quote.end,
      section: sectionAtFor(index)(quote.start),
      rect: range.getBoundingClientRect(),
    };
  }

  function onSelectionDone(e) {
    if (e && e.target && e.target.closest && (e.target.closest('.pp-selbtn') || rail.contains(e.target))) return;
    setTimeout(function () {
      var picked = selectionQuote();
      selectionChecks += 1;
      lastOffered = !!picked;
      if (!picked) { hideSelBtn(); return; }
      if (selBtn && pendingSel && pendingSel.start === picked.start && pendingSel.end === picked.end) return;
      hideSelBtn();
      pendingSel = picked;
      selBtn = document.createElement('button');
      selBtn.type = 'button';
      selBtn.className = 'btn pri pp-selbtn';
      selBtn.textContent = '评论';
      var r = picked.rect;
      var left = Math.min(r.right + window.scrollX - 24, window.scrollX + document.documentElement.clientWidth - 72);
      selBtn.style.left = Math.max(window.scrollX + 8, left) + 'px';
      selBtn.style.top = Math.max(window.scrollY + 8, r.top + window.scrollY - 42) + 'px';
      selBtn.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
      selBtn.addEventListener('click', startDraft);
      document.body.appendChild(selBtn);
    }, 0);
  }

  function startDraft() {
    if (!pendingSel) return;
    draft = { quote: pendingSel.quote, section: pendingSel.section, start: pendingSel.start, end: pendingSel.end };
    hideSelBtn();
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    focusedId = '__draft';
    render();
    var area = rail.querySelector('textarea[data-reply="__draft"]');
    if (area) { area.scrollIntoView({ block: 'nearest' }); area.focus(); }
  }

  function sendDraft() {
    var area = rail.querySelector('textarea[data-reply="__draft"]');
    var text = area ? area.value.trim() : '';
    if (!draft || !text) { if (area) area.focus(); return; }
    var id = newId();
    var row = newProseRow({ id: id, content: text, quote: draft.quote, section: draft.section, path: PATH, at: new Date().toISOString() });
    draft = null;
    focusedId = id;
    enqueue({ op: 'create', row: row });
  }

  function cancelDraft() {
    draft = null;
    focusedId = null;
    render();
  }

  function sendReply(id) {
    var area = railArea(id);
    var text = area ? area.value.trim() : '';
    if (!text) { if (area) area.focus(); return; }
    area.value = '';
    delete replyText[id];
    replyOpen.delete(id);
    enqueue({ op: 'reply', id: id, text: text, at: new Date().toISOString() });
  }

  function openReply(id) {
    replyOpen.add(id);
    focusedId = id;
    renderRail();
    syncFocusClasses();
    var area = railArea(id);
    if (area) {
      area.focus();
      try { area.setSelectionRange(area.value.length, area.value.length); } catch (e) { /* */ }
    }
  }

  /** 收起回复框；框里的字留在 replyText，下次点“回复”放回。 */
  function closeReply(id) {
    var area = railArea(id);
    if (area) {
      if (area.value) replyText[id] = area.value;
      else delete replyText[id];
    }
    replyOpen.delete(id);
  }

  function setExpanded(id, open) {
    if (open) expanded.add(id);
    else {
      expanded.delete(id);
      if (focusedId === id) focusedId = null;
    }
    render();
  }

  function setStatus(id, status) {
    expanded.delete(id); // 点完成就地收起；重新打开后下次再关也从收着开始
    if (id.indexOf('c:') === 0) {
      if (canvas) canvas.enqueue({ op: 'status', id: id.slice(2), status: status });
      return;
    }
    enqueue({ op: 'status', id: id, status: status });
  }

  // ---------- 事件 ----------
  // 鼠标松开、Shift+方向键立即判；触屏拖选手柄没有 mouseup，靠 selectionchange 停下来之后再判。
  var pointerDown = false;
  var selTimer = 0;
  document.addEventListener('pointerdown', function () { pointerDown = true; }, true);
  document.addEventListener('pointerup', function () { pointerDown = false; }, true);
  document.addEventListener('selectionchange', function () {
    clearTimeout(selTimer);
    selTimer = setTimeout(function () { if (!pointerDown) onSelectionDone(null); }, 400);
  });
  document.addEventListener('mouseup', onSelectionDone);
  document.addEventListener('keyup', function (e) {
    if (e.shiftKey || e.key === 'Shift' || e.key.indexOf('Arrow') === 0) onSelectionDone(e);
  });
  document.addEventListener('mousedown', function (e) {
    if (selBtn && !(e.target.closest && e.target.closest('.pp-selbtn'))) hideSelBtn();
  });
  // 点那张卡外面：空着的回复框收起，写了字的留着（字不丢，也不打断）。用 click 而不是
  // mousedown：mousedown 时重画右栏会换掉正要点的按钮，这一下 click 就落空了。右栏自己的
  // click 先跑完（可能已重画），这里按被点的元素所在线程判断，元素已脱离文档也认得出。
  document.addEventListener('click', function (e) {
    if (!replyOpen.size) return;
    var hit = e.target && e.target.closest ? e.target.closest('.pp-thread') : null;
    var hitId = hit ? hit.getAttribute('data-id') : null;
    var changed = false;
    replyOpen.forEach(function (id) {
      if (id === hitId) return;
      var area = railArea(id);
      if (area && area.value.trim()) return;
      closeReply(id);
      changed = true;
    });
    if (changed) renderRail();
  });
  // Esc：别的弹层（文章站点的 [[ ]] popup、画布浮层）处理过的 Esc 带 defaultPrevented，不动这里；
  // 草稿只在焦点就在草稿框里时取消，免得按 Esc 关别的东西时把写了一半的评论扔掉。
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // 焦点在回复框里：Esc 只收起这个框，写了一半的字留作草稿。
    var replyArea = document.activeElement && document.activeElement.closest
      && document.activeElement.closest('textarea[data-reply]:not([data-reply="__draft"])');
    if (replyArea && rail.contains(replyArea)) {
      var replyId = replyArea.getAttribute('data-reply');
      closeReply(replyId);
      renderRail();
      var again = rail.querySelector('.pp-thread[data-id="' + (window.CSS && CSS.escape ? CSS.escape(replyId) : replyId) + '"] [data-act="open-reply"]');
      if (again) again.focus();
      return;
    }
    if (draft) {
      var active = document.activeElement;
      if (active && active.matches && active.matches('textarea[data-reply="__draft"]')) cancelDraft();
      return;
    }
    if (focusedId) { focusedId = null; renderRail(); syncFocusClasses(); }
    hideSelBtn();
  });

  root.addEventListener('click', function (e) {
    var mark = e.target.closest && e.target.closest('mark.' + MARK_CLASS);
    if (!mark) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // 拖选结束在高亮上：是在选字，不是点评论
    var ids = (mark.getAttribute('data-ids') || '').split(' ').filter(function (id) { return id && id !== '__draft'; });
    if (!ids.length) return;
    var next = ids.indexOf(focusedId) >= 0 ? ids[(ids.indexOf(focusedId) + 1) % ids.length] : ids[0];
    focusThread(next);
  });

  rail.addEventListener('click', function (e) {
    var thread = e.target.closest('.pp-thread');
    if (!thread) return;
    var id = thread.getAttribute('data-id');
    var act = e.target.closest('[data-act]');
    if (act) {
      var what = act.getAttribute('data-act');
      if (what === 'send-draft') sendDraft();
      else if (what === 'cancel-draft') cancelDraft();
      else if (what === 'reply') sendReply(id);
      else if (what === 'open-reply') openReply(id);
      else if (what === 'expand') setExpanded(id, true);
      else if (what === 'collapse') setExpanded(id, false);
      else if (what === 'close') setStatus(id, 'close');
      else if (what === 'reopen') setStatus(id, 'open');
      return;
    }
    // 画布标注：点卡片（链接以外的地方也算）就在文章上开画布、定位到这颗钉子，与点链接同一条路。
    if (thread.getAttribute('data-kind') === 'canvas') {
      var link = thread.querySelector('a[data-pp-canvas-link]');
      if (link && !e.target.closest('a')) link.click();
      return;
    }
    if (id !== '__draft' && id !== focusedId && !e.target.closest('textarea')) focusThread(id, { scroll: false, reveal: true });
  });

  rail.addEventListener('keydown', function (e) {
    var area = e.target.closest && e.target.closest('textarea[data-reply]');
    if (!area) return;
    // Enter 发送，Shift+Enter 换行；输入法组字中的 Enter 留给输入法（isSendKey）。
    if (isSendKey(e)) {
      e.preventDefault();
      var id = area.getAttribute('data-reply');
      if (id === '__draft') sendDraft();
      else sendReply(id);
    }
  });

  render();
  observe();
  hydrate();
  connectEvents();

  var api = {
    entry: ENTRY,
    ledger: LEDGER,
    rows: function () { return rows.slice(); },
    /** 没有在途保存、没有排队的操作、已经从磁盘水合过。 */
    settled: function () { return prose.settled() && (!canvas || canvas.settled()); },
    /** 右栏里穿插的画布标注（@canvas 的行，含还没落盘的状态改动）。 */
    canvasRows: function () { return canvas ? canvas.rows() : []; },
    /** 选区判定的次数与最近一次是否给了“评论”钮。 */
    selection: function () { return { checks: selectionChecks, offered: lastOffered }; },
  };
  window.pinpointProse = api;
  return api;
}
