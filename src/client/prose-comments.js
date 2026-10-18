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
 * 改自己写的话（2026-10-17）：点线程里 owner 写的话（正文评论的 content、以及 owner 在同一线程里
 * 的后续回复；画布标注改不含目标记号的正文，也改开头全是目标记号时记号后面的文字），原地可编辑，
 * 字号行高与位置不跳。开头全是目标记号时，后面那段仍是原来的行内 span，只是可写，不换成 textarea。
 * ⌘/Ctrl+Enter 或点这张卡外面保存，Esc 取消恢复原文，清空后保存不删评论、恢复原文。开头的
 * `[@t:iN]` 留在这段文字外面，显示成元素文字、只读，保存时原样接回 content。agent 的回复、引文、
 * 记号夹在文字中间的画布标注正文不可编辑。编辑入队 edit
 * 操作（第一句改 content，后续回复只换那条消息的文本），与服务端“owner 改了回 open”同一条规则；
 * 被拒时字放回编辑框。
 *
 * 同步：SSE（/events）断了会自己重连，重连上就重新水合，补上断线期间漏掉的事件；
 * pagehide 时关掉，从 bfcache 回来（pageshow persisted，比如从画布按“返回”）时重开
 * 并重新水合。
 *
 * 这个文件只做组装。文本索引在 prose/text-index.js，高亮在 prose/highlight.js，
 * 右栏 HTML 在 prose/html.js，账本同步在 prose/sync.js，选区在 prose/selection.js，
 * 右栏重画在 prose/rail.js，就地编辑在 prose/edit.js，编辑框的 DOM 读写在 prose/edit-field.js。
 * 对外仍导出 buildTextIndex、rangeToOffsets、unpaint、paintSegments、startProseComments。 */

import { locateQuote } from '../shared/text-quote.js';
import { isProseClosed, isProseRow, newProseRow } from '../shared/prose-thread.js';

import { buildTextIndex, sectionAtFor } from './prose/text-index.js';
import { paintSegments, unpaint } from './prose/highlight.js';
import { createProseSync } from './prose/sync.js';
import { createSelection } from './prose/selection.js';
import { createRail } from './prose/rail.js';
import { createEdit } from './prose/edit.js';
import { cssEscape, railArea } from './prose/edit-field.js';
import { bindProseEvents } from './prose/events.js';

export { buildTextIndex, rangeToOffsets } from './prose/text-index.js';
export { unpaint, paintSegments } from './prose/highlight.js';

var MARK_CLASS = 'pp-hl';

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

  var PATH = (function () { try { return decodeURIComponent(location.pathname); } catch (e) { return location.pathname; } })();

  var state = {
    rows: [],          // 正文评论：盘上 + 还没落盘的操作，界面看到的
    expanded: new Set(), // 展开了的已关闭线程 id（不记盘：每次打开文章都收着）
    replyOpen: new Set(), // 展开了回复框的线程 id
    replyText: {},     // 线程 id -> 回复框里的字（框收起后草稿也留着）
    editingId: null,   // 正在编辑的那句：正文评论 id，'c:' + 画布标注 id，或再加 '/m' + messages 下标
    editText: {},      // 编辑框 key -> 被拒后放回框里的字
    focusedId: null,
    hoverId: null,     // 悬停的线程 id：卡片与正文 mark 互相高亮，比 focused 弱一档
    draft: null,       // { quote, section, start, end }
    anchors: new Map(), // id -> { start, end } | null（null = 失效）
    cardOffsets: new Map(), // 画布卡片的节 id -> 它在规范化文本里的位置（右栏排画布标注用）
    paintSig: '',
    painting: false,
    pendingSel: null,
    selectionChecks: 0, // 判过几次选区（测试用的可观察信号）
    lastOffered: false,
    composingArea: null,
    railDirty: false,
  };

  var paintDirty = false;
  var repaintTimer = 0;
  var observer = new MutationObserver(function () {
    if (state.painting) return;
    paintDirty = true;
    clearTimeout(repaintTimer);
    repaintTimer = setTimeout(function () { paint(); railApi.renderRail(); }, 50);
  });

  function observe() {
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function syncFocusClasses() {
    var marks = root.querySelectorAll('mark.' + MARK_CLASS);
    for (var i = 0; i < marks.length; i++) {
      var ids = (marks[i].getAttribute('data-ids') || '').split(' ');
      marks[i].classList.toggle('on', !!state.focusedId && ids.indexOf(state.focusedId) >= 0);
      marks[i].classList.toggle('pp-hover', !!state.hoverId && ids.indexOf(state.hoverId) >= 0);
    }
    var threads = rail.querySelectorAll('.pp-thread');
    for (var j = 0; j < threads.length; j++) {
      threads[j].classList.toggle('on', threads[j].getAttribute('data-id') === state.focusedId);
      threads[j].classList.toggle('pp-hover', threads[j].getAttribute('data-id') === state.hoverId);
    }
    // 画布标注没有正文 mark：悬停时高亮它所属的画布卡片。
    var canvases = root.querySelectorAll('[data-pp-canvas]');
    var hoverSection = '';
    if (state.hoverId && state.hoverId.indexOf('c:') === 0) {
      var hoverCard = rail.querySelector('.pp-thread[data-id="' + cssEscape(state.hoverId) + '"]');
      hoverSection = hoverCard ? hoverCard.getAttribute('data-section') || '' : '';
    }
    for (var k = 0; k < canvases.length; k++) {
      canvases[k].classList.toggle('pp-hover', !!hoverSection && canvases[k].getAttribute('data-pp-section') === hoverSection);
    }
  }

  // 已关闭的线程收着时不画高亮，展开那一条才画：正文里只剩还要处理的。
  function visible(row) {
    return !isProseClosed(row) || state.expanded.has(row.id);
  }

  function paint() {
    var shown = state.rows.filter(visible);
    var sig = JSON.stringify([
      shown.map(function (r) { return [r.id, r.quote && r.quote.exact, r.quote && r.quote.prefix, r.quote && r.quote.suffix, r.section]; }),
      state.draft ? [state.draft.quote.exact, state.draft.start] : null,
    ]);
    if (sig === state.paintSig && !paintDirty) return;
    state.paintSig = sig;
    paintDirty = false;
    state.painting = true;
    observer.disconnect();
    unpaint(root);
    var index = buildTextIndex(root);
    var sectionAt = sectionAtFor(index);
    state.anchors = new Map();
    state.cardOffsets = new Map();
    index.cards.forEach(function (c) {
      var section = c.el.getAttribute('data-pp-section');
      if (section && !state.cardOffsets.has(section)) state.cardOffsets.set(section, c.offset);
    });
    var items = [];
    state.rows.forEach(function (r) {
      var hit = r.quote ? locateQuote(index.text, r.quote, { section: r.section, sectionAt: sectionAt }) : null;
      state.anchors.set(r.id, hit ? { start: hit.start, end: hit.end } : null);
      if (hit && visible(r)) items.push({ id: r.id, start: hit.start, end: hit.end });
    });
    if (state.draft) {
      var d = locateQuote(index.text, state.draft.quote, { section: state.draft.section, sectionAt: sectionAt });
      if (d) items.push({ id: '__draft', start: d.start, end: d.end, draft: true });
    }
    paintSegments(index, items);
    syncFocusClasses();
    state.painting = false;
    observe();
  }

  function render() {
    paint();
    railApi.renderRail();
  }

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

  function orderKey(row) {
    var a = state.anchors.get(row.id);
    return a ? a.start : Infinity;
  }

  function view() {
    return {
      expanded: state.expanded,
      anchors: state.anchors,
      focusedId: state.focusedId,
      replyOpen: state.replyOpen,
      replyText: state.replyText,
      editingId: state.editingId,
      editText: state.editText,
      SERVER: SERVER,
      ENTRY: ENTRY,
      canvasHref: canvasHref,
      // 窄屏右栏在正文下面，不收成摘要。没 matchMedia（测试环境）按宽屏。
      folded: !(window.matchMedia && window.matchMedia('(max-width: 860px)').matches),
    };
  }

  var sync = createProseSync({
    server: SERVER,
    entry: ENTRY,
    root: root,
    path: PATH,
    hooks: {
      state: function () { return state; },
      recompute: function (prose) {
        state.rows = prose.rows().filter(isProseRow);
        render();
      },
      renderRail: function () { railApi.renderRail(); },
      render: function () { render(); },
      findCanvasRow: function (id) { return sync.findCanvasRow(id); },
    },
  });

  var railApi = createRail({
    rail: rail,
    root: root,
    state: state,
    sync: sync,
    hooks: {
      canvasCards: canvasCards,
      orderKey: orderKey,
      view: view,
      syncFocusClasses: syncFocusClasses,
    },
  });

  var selection = createSelection({
    root: root,
    rail: rail,
    state: state,
    hooks: { render: render, reveal: function (card) { railApi.reveal(card); } },
  });

  var edit = createEdit({
    rail: rail,
    state: state,
    sync: sync,
    hooks: {
      renderRail: function () { railApi.renderRail(); },
      hold: function (id) { railApi.hold(id); },
      reveal: function (card, target, box) { railApi.reveal(card, target, box); },
      enqueue: function (op) { sync.prose.enqueue(op); },
    },
  });

  function sendDraft() {
    var area = rail.querySelector('textarea[data-reply="__draft"]');
    var text = area ? area.value.trim() : '';
    if (!state.draft || !text) { if (area) area.focus(); return; }
    var id = newId();
    var row = newProseRow({ id: id, content: text, quote: state.draft.quote, section: state.draft.section, path: PATH, at: new Date().toISOString() });
    state.draft = null;
    state.focusedId = id;
    sync.prose.enqueue({ op: 'create', row: row });
  }

  function cancelDraft() {
    state.draft = null;
    state.focusedId = null;
    render();
  }

  function sendReply(id) {
    var area = railArea(rail, id);
    var text = area ? area.value.trim() : '';
    if (!text) { if (area) area.focus(); return; }
    area.value = '';
    delete state.replyText[id];
    state.replyOpen.delete(id);
    sync.prose.enqueue({ op: 'reply', id: id, text: text, at: new Date().toISOString() });
  }

  function openReply(id) {
    railApi.hold(id);
    state.replyOpen.add(id);
    state.focusedId = id;
    railApi.renderRail();
    syncFocusClasses();
    var area = railArea(rail, id);
    if (area) {
      // 卡片顶对齐引文，不代表卡片末尾的回复框也在视口里。focus 不许自己滚
      // （长卡片会把页面拽走），框在视口外时只滚到框。
      area.focus({ preventScroll: true });
      try { area.setSelectionRange(area.value.length, area.value.length); } catch (e) { /* */ }
      railApi.reveal(area.closest('.pp-thread'), area);
    }
  }

  /** 收起回复框；框里的字留在 replyText，下次点“回复”放回。 */
  function closeReply(id) {
    var area = railArea(rail, id);
    if (area) {
      if (area.value) state.replyText[id] = area.value;
      else delete state.replyText[id];
    }
    state.replyOpen.delete(id);
  }

  function setExpanded(id, open) {
    if (!open && state.editingId != null && (state.editingId === id || state.editingId.indexOf(id + '/m') === 0)) edit.finishEdit(); // 这张卡要收成一行：先把编辑收掉，别把字跟框一起丢
    if (open) state.expanded.add(id);
    else {
      state.expanded.delete(id);
      if (state.focusedId === id) state.focusedId = null;
    }
    render();
  }

  function setStatus(id, status) {
    if (state.editingId != null && (state.editingId === id || state.editingId.indexOf(id + '/m') === 0 || state.editingId === 'c:' + id)) edit.finishEdit(); // 状态要变、卡要重画：先收编辑
    state.expanded.delete(id); // 点完成就地收起；重新打开后下次再关也从收着开始
    if (id.indexOf('c:') === 0) {
      if (sync.canvas) sync.canvas.enqueue({ op: 'status', id: id.slice(2), status: status });
      return;
    }
    sync.prose.enqueue({ op: 'status', id: id, status: status });
  }

  bindProseEvents({
    root: root,
    rail: rail,
    state: state,
    selection: selection,
    edit: edit,
    railApi: railApi,
    syncFocusClasses: syncFocusClasses,
    actions: {
      closeReply: closeReply,
      cancelDraft: cancelDraft,
      sendDraft: sendDraft,
      sendReply: sendReply,
      openReply: openReply,
      setExpanded: setExpanded,
      setStatus: setStatus,
    },
  });

  render();
  observe();
  sync.hydrate();
  sync.connectEvents();

  function focus(id) {
    state.focusedId = id;
    railApi.renderRail();
    syncFocusClasses();
  }

  var api = {
    entry: ENTRY,
    ledger: sync.ledger,
    rows: function () { return state.rows.slice(); },
    /** 没有在途保存、没有排队的操作、已经从磁盘水合过。 */
    settled: function () { return sync.prose.settled() && (!sync.canvas || sync.canvas.settled()); },
    /** 右栏里穿插的画布标注（@canvas 的行，含还没落盘的状态改动）。 */
    canvasRows: function () { return sync.canvas ? sync.canvas.rows() : []; },
    /** 选区判定的次数与最近一次是否给了“评论”钮。 */
    selection: function () { return { checks: state.selectionChecks, offered: state.lastOffered }; },
    /** 选中一条线程（测试用）：展开它，不滚动、不开画布。 */
    focus: focus,
  };
  window.pinpointProse = api;
  return api;
}
