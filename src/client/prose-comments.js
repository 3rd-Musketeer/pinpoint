/* 正文评论（pp3 M2）：article 页上选中正文文字 → 浮出“评论” → 高亮 + 右栏线程。
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
 * 画布卡片（[data-pp-canvas]）、脚本、错误条不进文本，选区落在那里不出“评论”。
 *
 * 写入是操作队列（src/shared/prose-thread.js applyProseOps）：保存撞上 409 时把
 * 没落盘的操作重放到磁盘最新版再存，agent 刚写的回复不会被旧快照盖掉；别的拒绝
 * 把新评论退回草稿、回复退回输入框，右栏写出原因。
 *
 * 同步：SSE（/events）断了会自己重连，重连上就重新水合，补上断线期间漏掉的事件；
 * pagehide 时关掉，从 bfcache 回来（pageshow persisted，比如从画布按“返回”）时重开
 * 并重新水合。 */

import { locateQuote, normalizeWhitespace, quoteFromText } from '../shared/text-quote.js';
import { onPageLeave, postSave } from './lib/save-request.js';
import {
  applyProseOps,
  authorLabel,
  formatWhen,
  isProseRow,
  newProseRow,
  PROSE_LEDGER,
  threadMessages,
} from '../shared/prose-thread.js';
import {
  ANN_FILTERS,
  ANN_STATUS_COLORS,
  annFilterCounts,
  annStatusLabel,
  filterIncludesStatus,
  readAnnFilter,
  writeAnnFilter,
} from '../shared/ann-status.js';

var SKIP_SELECTOR = 'script,style,noscript,template,textarea,[data-pp-canvas],[data-pp-nocomment],.errors';
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
  function walk(el) {
    for (var child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        entries.push({ node: child, at: raw.length });
        raw += child.data;
      } else if (child.nodeType === 1) {
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
  return { text: norm.text, nodes: nodes };
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
  var FILTER_KEY = 'pinpoint:' + ENTRY + ':' + LEDGER + ':stfilter';
  // 筛选记忆只是浏览偏好：隐私模式下 localStorage 访问本身会抛，读写都退回默认。
  var prefs = (function () { try { return window.localStorage; } catch (e) { return null; } })();

  var base = [];          // 磁盘上最新一版的行（服务端发过号）
  var revision = 0;
  var ops = [];           // 还没落盘的操作
  var rows = [];          // base + ops：界面看到的
  var hydrated = false;
  var inflight = false;
  var conflicts = 0;
  var remoteStash = null;
  var retryTimer = 0;
  var connection = 'connecting'; // connecting | online | offline
  var syncError = '';
  var filter = readAnnFilter(prefs, FILTER_KEY);
  var focusedId = null;
  var draft = null;       // { quote, section, start, end }
  var anchors = new Map(); // id -> { start, end } | null（null = 失效）
  var paintSig = '';
  var painting = false;
  var selBtn = null;
  var pendingSel = null;
  var selectionChecks = 0; // 判过几次选区（测试用的可观察信号）
  var lastOffered = false;

  // ---------- 同步 ----------
  function proseOnly(list) {
    return (Array.isArray(list) ? list : []).filter(isProseRow);
  }

  function recompute() {
    rows = proseOnly(applyProseOps(base, ops));
    render();
  }

  function adopt(doc) {
    base = Array.isArray(doc.annotations) ? doc.annotations : [];
    var rev = Number(doc.revision);
    revision = Number.isFinite(rev) ? rev : 0;
  }

  function scheduleRetry(ms) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flush, ms);
  }

  function flush() {
    if (inflight || !ops.length || !hydrated) return;
    inflight = true;
    var sent = ops.length;
    var body = {
      page: LEDGER,
      entry: ENTRY,
      path: PATH,
      updated_at: new Date().toISOString(),
      baseRevision: revision,
      annotations: applyProseOps(base, ops),
    };
    // keepalive（够小时）：在途的保存在关页、导航走之后照样送达（lib/save-request.js）。
    postSave(SERVER, body)
      .then(function (res) {
        inflight = false;
        if (res.ok) {
          base = Array.isArray(res.data.annotations) ? res.data.annotations : body.annotations;
          revision = Number(res.data.revision) || revision + 1;
          ops.splice(0, sent);
          conflicts = 0;
          syncError = '';
        } else if (res.status === 409 && res.data && Array.isArray(res.data.annotations)) {
          // 磁盘上有更新的一版（agent 回复、另一个标签页）：操作留着，重放到新版上再存。
          adopt(res.data);
          conflicts += 1;
        } else {
          // 服务拒了这批操作（非法转换等）：从队列里拿掉、回到磁盘上的样子，但 owner 写的
          // 字不丢 —— 新评论退回草稿，回复退回那条线程的输入框。
          var rejected = ops.splice(0, sent);
          var restored = restoreRejected(rejected);
          syncError = '保存被拒：' + ((res.data && (res.data.detail || res.data.error)) || res.status)
            + (restored ? '。原文已放回输入框' : '');
          if (res.data && Array.isArray(res.data.annotations)) adopt(res.data);
        }
        if (remoteStash && Number(remoteStash.revision) > revision) adopt(remoteStash);
        remoteStash = null;
        recompute();
        if (ops.length) {
          if (conflicts > MAX_CONFLICT_RETRIES) {
            syncError = '保存一直冲突，稍后重试';
            conflicts = 0;
            render();
            scheduleRetry(3000);
          } else {
            flush();
          }
        }
      })
      .catch(function () {
        inflight = false;
        syncError = '同步失败，稍后重试';
        render();
        scheduleRetry(3000);
      });
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
        if (focusedId !== '__draft') focusedId = op.id;
        restored = true;
      }
    });
    return restored;
  }

  /** 离开页面（关标签、导航走、切到后台）：排着的操作现在就发，不等应答。没有在途保存
      → 照常 flush。有在途保存 → base + 全部操作按 revision 和 revision + 1 各发一次：
      在途那次先到，+1 那份接上；这份先到，它直接落盘、在途那次 409。页面没走时，在途
      应答回来照旧，剩下的操作 409 后重放到盘上的新版；reply 按 at 去重，不会回两遍。 */
  var leaveSentOps = null;
  function flushOnLeave() {
    if (!hydrated || !ops.length) return;
    if (!inflight) { clearTimeout(retryTimer); flush(); return; }
    if (leaveSentOps === ops[ops.length - 1]) return;
    leaveSentOps = ops[ops.length - 1];
    var annotations = applyProseOps(base, ops);
    [revision, revision + 1].forEach(function (rev) {
      postSave(SERVER, {
        page: LEDGER,
        entry: ENTRY,
        path: PATH,
        updated_at: new Date().toISOString(),
        baseRevision: rev,
        annotations: annotations,
      }).catch(function () {});
    });
  }

  function enqueue(op) {
    ops.push(op);
    recompute();
    flush();
  }

  function hydrate() {
    return fetch(SERVER + '/annotations/' + encodeURIComponent(LEDGER) + '?entry=' + encodeURIComponent(ENTRY))
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(function (doc) {
        hydrated = true;
        connection = 'online';
        if (inflight) {
          // 保存还在路上：这一版交给保存回来时一起处理（与 SSE 推来的同一条路）。
          if (!remoteStash || Number(doc.revision) > Number(remoteStash.revision)) remoteStash = doc;
          render();
          return;
        }
        adopt(doc);
        recompute();
        flush();
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
      } else if (connection === 'offline' && hydrated) {
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
      if (!doc || doc.entry !== ENTRY || doc.page !== LEDGER) return;
      var rev = Number(doc.revision);
      if (!Number.isFinite(rev) || rev <= revision) return;
      if (inflight) {
        if (!remoteStash || rev > Number(remoteStash.revision)) remoteStash = doc;
        return;
      }
      adopt(doc);
      recompute();
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
  function visible(row) {
    return filterIncludesStatus(filter, row.status || 'open');
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
    var color = ANN_STATUS_COLORS[st] || ANN_STATUS_COLORS.open;
    var n = Number.isInteger(row.n) ? '#' + row.n : '#…';
    var word = st === 'open' ? '' : '<span class="pp-st">' + esc(st) + '</span>';
    return '<span class="pp-n" style="background:' + color + '">' + esc(n) + '</span>' + word;
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

  function threadHtml(row) {
    var anchor = anchors.get(row.id);
    var stale = anchor === null && anchors.has(row.id);
    var closed = (row.status || 'open') === 'close';
    var act = closed
      ? '<button class="pp-act" type="button" data-act="reopen">重新打开</button>'
      : '<button class="pp-act" type="button" data-act="close">完成</button>';
    var focused = row.id === focusedId;
    return '<div class="pp-thread' + (stale ? ' stale' : '') + (focused ? ' on' : '') + '" data-id="' + esc(row.id) + '" data-n="' + esc(row.n) + '" data-status="' + esc(row.status || 'open') + '">'
      + '<div class="pp-meta">' + statusChip(row)
      + (stale ? '<span class="pp-stale" title="正文里找不到这段引文了">失效</span>' : '')
      + '<span class="sp"></span>' + act + '</div>'
      + quoteHtml(row.quote && row.quote.exact)
      + messagesHtml(row)
      + (focused
        ? '<div class="pp-reply"><textarea data-reply="' + esc(row.id) + '" rows="2" placeholder="回复…"></textarea>'
          + '<div class="acts"><button class="btn pri" type="button" data-act="reply">发送</button></div></div>'
        : '')
      + '</div>';
  }

  function draftHtml() {
    return '<div class="pp-thread draft on" data-id="__draft">'
      + quoteHtml(draft.quote.exact)
      + '<textarea data-reply="__draft" rows="3" placeholder="写评论…"></textarea>'
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
      keep[areas[i].getAttribute('data-reply')] = {
        value: areas[i].value,
        focus: areas[i] === active,
        start: areas[i].selectionStart,
        end: areas[i].selectionEnd,
      };
    }
    var counts = annFilterCounts(rows);
    var shown = rows.filter(visible).slice().sort(function (a, b) {
      var d = orderKey(a) - orderKey(b);
      if (d !== 0 && !Number.isNaN(d)) return d;
      return (a.n || Infinity) - (b.n || Infinity);
    });
    var seg = '<div class="pp-seg" role="tablist">' + ANN_FILTERS.map(function (f) {
      return '<button type="button" role="tab" data-filter="' + f + '" aria-selected="' + (f === filter) + '"' + (counts[f] ? '' : ' class="zero"') + '>'
        + esc(annStatusLabel(f)) + ' <span class="c">' + counts[f] + '</span></button>';
    }).join('') + '</div>';
    var list = '';
    var draftPlaced = false;
    var draftKey = draft ? draft.start : Infinity;
    shown.forEach(function (row) {
      if (draft && !draftPlaced && orderKey(row) > draftKey) { list += draftHtml(); draftPlaced = true; }
      list += threadHtml(row);
    });
    if (draft && !draftPlaced) list += draftHtml();
    var empty = !shown.length && !draft
      ? '<p class="empty-rail">' + (filter === 'closed' ? '没有 closed 的评论。' : '选中正文里的一段文字，点“评论”。') + '</p>'
      : '';
    var note = connection === 'offline'
      ? '未连接 pinpoint 服务，评论暂时存不下。'
      : (syncError || '');
    rail.innerHTML = '<div class="pp-rail-head"><div class="label">评论</div>' + seg + '</div>'
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
    if (filter !== 'pending') { filter = 'pending'; writeAnnFilter(prefs, FILTER_KEY, filter); }
    enqueue({ op: 'create', row: row });
    var t = rail.querySelector('.pp-thread[data-id="' + id + '"] textarea');
    if (t) t.focus();
  }

  function cancelDraft() {
    draft = null;
    focusedId = null;
    render();
  }

  function sendReply(id) {
    var area = rail.querySelector('textarea[data-reply="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    var text = area ? area.value.trim() : '';
    if (!text) { if (area) area.focus(); return; }
    area.value = '';
    enqueue({ op: 'reply', id: id, text: text, at: new Date().toISOString() });
  }

  function setStatus(id, status) {
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
  // Esc：别的弹层（文章站点的 [[ ]] popup、画布浮层）处理过的 Esc 带 defaultPrevented，不动这里；
  // 草稿只在焦点就在草稿框里时取消，免得按 Esc 关别的东西时把写了一半的评论扔掉。
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
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
    var filterBtn = e.target.closest('[data-filter]');
    if (filterBtn) {
      filter = filterBtn.getAttribute('data-filter') === 'closed' ? 'closed' : 'pending';
      writeAnnFilter(prefs, FILTER_KEY, filter);
      render();
      return;
    }
    var thread = e.target.closest('.pp-thread');
    if (!thread) return;
    var id = thread.getAttribute('data-id');
    var act = e.target.closest('[data-act]');
    if (act) {
      var what = act.getAttribute('data-act');
      if (what === 'send-draft') sendDraft();
      else if (what === 'cancel-draft') cancelDraft();
      else if (what === 'reply') sendReply(id);
      else if (what === 'close') setStatus(id, 'close');
      else if (what === 'reopen') setStatus(id, 'open');
      return;
    }
    if (id !== '__draft' && id !== focusedId && !e.target.closest('textarea')) focusThread(id, { scroll: false, reveal: true });
  });

  rail.addEventListener('keydown', function (e) {
    var area = e.target.closest && e.target.closest('textarea[data-reply]');
    if (!area) return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
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
    settled: function () { return hydrated && !inflight && !ops.length; },
    /** 选区判定的次数与最近一次是否给了“评论”钮。 */
    selection: function () { return { checks: selectionChecks, offered: lastOffered }; },
  };
  window.pinpointProse = api;
  return api;
}
