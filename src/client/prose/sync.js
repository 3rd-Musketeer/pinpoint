/* 正文评论与画布标注的同步。两本账本同一个桶：@prose 是正文评论，@canvas（及 HTML 帧自己的账本）是画布标注。
 * 管水合、SSE 断线重连、pagehide 补发、bfcache 回来重开。导出 createProseSync，返回 prose/canvas 账本和连接状态。 */

import { onPageLeave } from '../lib/save-request.js';
import { createOpsLedger } from '../lib/ops-ledger.js';
import { createCanvasLedgers } from '../lib/canvas-ledgers.js';
import { readLedgerDocument, rememberLedgerDocument } from '../lib/ledger-reader.js';
import { annotationSlug } from '../../shared/annotation-slug.js';
import { canvasBodyFromStored, isProseRow, PROSE_LEDGER } from '../../shared/prose-thread.js';

var MAX_CONFLICT_RETRIES = 5;
var RECONNECT_MS = 2000;

export function createProseSync(opts) {
  var SERVER = opts.server;
  var ENTRY = opts.entry;
  var root = opts.root;
  var PATH = opts.path;
  var hooks = opts.hooks;

  var LEDGER = PROSE_LEDGER;
  var connection = 'connecting'; // connecting | online | offline
  var restoreText = {};   // textarea data-reply id -> 下次画右栏时放回的字

  // 两本账本，同一个桶：@prose 是正文评论；@canvas 是这篇画布上的标注，右栏按卡片位置穿插进来、
  // 只在这里改状态（完成 / 重新打开），别的都在画布上改。正文里没有画布卡片就不读 @canvas。
  var hasCanvas = !!root.querySelector('[data-pp-canvas]');
  var prose = createOpsLedger({
    server: SERVER, entry: ENTRY, ledger: LEDGER, maxConflicts: MAX_CONFLICT_RETRIES,
    path: function () { return PATH; },
    onChange: function () { hooks.recompute(prose); },
    onRejected: function (list) { return restoreRejected(list); },
  });
  // 画布上的 HTML 帧（一篇文章一张画布，2026-10-15）：那一页的标注在同桶里它自己的账本里，一起读进来
  // （lib/canvas-ledgers.js），右栏和卡片标注数都含它们。
  var canvas = hasCanvas ? createCanvasLedgers({
    server: SERVER, entry: ENTRY, maxConflicts: MAX_CONFLICT_RETRIES,
    pages: Array.prototype.map.call(root.querySelectorAll('[data-pp-canvas] .cc-frame[data-doc-url]'), function (fig) {
      return { id: fig.getAttribute('data-screen') || '', url: fig.getAttribute('data-doc-url') || '' };
    }),
    onChange: function () { announceCanvas(); hooks.renderRail(); },
    onRejected: restoreCanvasRejected,
  }) : null;

  function announceCanvas() {
    document.dispatchEvent(new CustomEvent('pp:canvas-ledger', { detail: { entry: ENTRY, doc: { annotations: canvas.rows() } } }));
  }

  // 被拒的操作里 owner 写的字：新评论 → 草稿（已有草稿时不顶掉它），回复 → 输入框，编辑 → 编辑框。
  function restoreRejected(list) {
    var state = hooks.state();
    var restored = false;
    list.forEach(function (op) {
      if (op.op === 'create' && op.row && op.row.quote && !state.draft) {
        var q = op.row.quote;
        state.draft = { quote: q, section: op.row.section || '', start: Number.isInteger(q.start) ? q.start : Infinity };
        restoreText.__draft = op.row.content || '';
        state.focusedId = '__draft';
        restored = true;
      } else if (op.op === 'reply' && op.text) {
        restoreText[op.id] = restoreText[op.id] ? restoreText[op.id] + '\n' + op.text : op.text;
        state.replyOpen.add(op.id);
        if (state.focusedId !== '__draft') state.focusedId = op.id;
        restored = true;
      } else if (op.op === 'edit' && (op.content || op.text)) {
        var key = Number.isInteger(op.index) ? op.id + '/m' + op.index : op.id;
        state.editText[key] = op.content || op.text;
        state.editingId = key;
        restored = true;
      }
    });
    return restored;
  }

  /** 画布账本被拒的编辑：字放回右栏那张卡的编辑框（状态操作没有字，不用放）。 */
  function restoreCanvasRejected(list) {
    var state = hooks.state();
    var restored = false;
    list.forEach(function (op) {
      if (op.op === 'edit' && op.content) {
        var row = hooks.findCanvasRow(op.id);
        state.editText['c:' + op.id] = row ? canvasBodyFromStored(row.content, op.content) : op.content;
        state.editingId = 'c:' + op.id;
        restored = true;
      }
    });
    return restored;
  }

  function flushOnLeave() {
    prose.flushOnLeave();
    if (canvas) canvas.flushOnLeave();
  }

  var hydrateStarted = false;
  var started = false;
  function hydrate() {
    if (!started) return;
    var refresh = hydrateStarted;
    hydrateStarted = true;
    // 画布账本读不到（还没人标过时它也在：服务给空账本）不影响正文评论，下次重连再读。
    if (canvas) {
      canvas.names().forEach(function (name) {
        readLedgerDocument(SERVER, ENTRY, name, refresh).then(function (doc) { canvas.accept(name, doc); }).catch(function () {});
      });
    }
    return readLedgerDocument(SERVER, ENTRY, LEDGER, refresh)
      .then(function (doc) {
        connection = 'online';
        prose.accept(doc);
      })
      .catch(function () {
        connection = 'offline';
        hooks.render();
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
        document.dispatchEvent(new CustomEvent('pp:preview-update', { detail: { id: ENTRY } }));
      } else if (connection === 'offline' && prose.hydrated()) {
        connection = 'online';
        hooks.render();
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
      if (doc.page === LEDGER) {
        rememberLedgerDocument(SERVER, ENTRY, LEDGER, doc);
        prose.remote(doc);
      } else if (canvas) {
        canvas.names().forEach(function (name) {
          if (doc.page === name || doc.page === annotationSlug(name)) rememberLedgerDocument(SERVER, ENTRY, name, doc);
        });
        canvas.remote(doc);
      }
    });
    es.addEventListener('preview:update', function (ev) {
      if (es !== events) return;
      var data;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (data?.id === ENTRY) document.dispatchEvent(new CustomEvent('pp:preview-update', { detail: data }));
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
    document.dispatchEvent(new CustomEvent('pp:preview-update', { detail: { id: ENTRY } }));
  });

  return {
    prose: prose,
    canvas: canvas,
    ledger: LEDGER,
    connection: function () { return connection; },
    restoreText: restoreText,
    announceCanvas: announceCanvas,
    hydrate: function () { started = true; return hydrate(); },
    connectEvents: connectEvents,
    findCanvasRow: function (id) {
      if (!canvas) return null;
      var list = canvas.rows();
      for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(id)) return list[i];
      return null;
    },
    rows: function () { return prose.rows().filter(isProseRow); },
  };
}
