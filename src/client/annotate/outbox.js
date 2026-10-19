// 离页与同步通道：关页时补发未落盘的写、换账本交接 outbox、从磁盘 hydrate、
// SSE /events 连接。导出 bind_outbox、init_outbox、installLeaveHooks、
// hydrateFromDisk、connectEvents 等。
import { normalizeAnnotation } from '../../shared/annotation-indicator.js';
import { rebaseAnnotations } from '../../shared/ledger-rebase.js';
import { newSaveId, onPageLeave } from '../lib/save-request.js';

import { docAnnotations, ensureAllMarkIds } from './marks.js';
import { applyRemoteDoc, deferRemoteDoc, postSave, readLocalMarks, rebaseOnto, requestSync, saveBody, setBase, writeLocalCache } from './persist.js';
import { notify, setStatus } from './ui.js';
export function bind_outbox(c) { ctx = c; }
var ctx;

export function init_outbox() {
  ctx.leaveSentVersion = 0;
  ctx.outboxUnsent = {};
  ctx.parentEventsOff = null;
  ctx.eventsConnected = false;
  ctx.eventsParked = false;
}

export function installLeaveHooks() {
  onPageLeave(flushOnLeave);
  window.addEventListener('pagehide', closeEvents);
  window.addEventListener('pageshow', function (event) {
    if (event.persisted && !ctx.eventSource && !ctx.parentEventsOff) connectEvents();
  });
}

function flushOnLeave() {
  if (!ctx.SERVER) return;
  Object.keys(ctx.outboxUnsent).forEach(function (key) {
    var pending = ctx.outboxUnsent[key];
    delete ctx.outboxUnsent[key];
    var leaving = Object.assign({}, pending.body, { saveId: newSaveId() });
    if (pending.after) leaving.after = pending.after;
    postSave(leaving).catch(function () {});
  });
  if (ctx.mutationVersion <= ctx.syncedMutationVersion) return;
  if (!ctx.syncing) { requestSync(); return; }
  if (ctx.inflightVersion >= ctx.mutationVersion || ctx.leaveSentVersion >= ctx.mutationVersion) return;
  ctx.leaveSentVersion = ctx.mutationVersion;
  postSave(saveBody(ctx.revision, ctx.inflightSaveId)).catch(function () {});
}
// 换账本交给 outbox、还没发出的快照（离开页面时由 flushOnLeave 直接发）。

function ledgerOutboxKey(entry, page) { return entry + '\u0000' + page; }

/** 换账本时旧账本还有没落盘的写（在途 /save 之后又改过、上次保存失败、
    lastRect 的 debounce 还没到点）：快照交给按账本排队的 outbox 写完，
    不跟着 epoch 一起作废。outbox 先等在途那次的应答拿到新 ctx.revision，
    再把快照发出去；ctx.revision 冲突说明别处刚写过，快照接到盘上那版再按
    服务端 ctx.revision 重发（与 requestSync 的 rebaseOnto 同一条规则）。
    切回这本账本的 hydrate 先等它的 outbox 排空，读到的才是写完的盘。 */
export function handOffUnsyncedWrites() {
  if (!ctx.SERVER) return;
  if (ctx.lastRectPersistTimer) {
    clearTimeout(ctx.lastRectPersistTimer);
    ctx.lastRectPersistTimer = null;
    ctx.mutationVersion++;
    writeLocalCache();
  }
  if (ctx.mutationVersion <= ctx.syncedMutationVersion) return;
  var inflight = ctx.syncing ? ctx.inflightSync : null;
  var covered = ctx.syncing ? ctx.inflightVersion : ctx.syncedMutationVersion;
  var snapshotVersion = ctx.mutationVersion;
  var baseRevision = ctx.revision;
  var base = ctx.baseMarks;
  var body = saveBody(ctx.revision);
  var key = ledgerOutboxKey(ctx.ENTRY, ctx.PAGE);
  // 离开页面时这份快照还没发：在途那次可能先到也可能后到，快照带 after 接在它之后（同 flushOnLeave）。
  var unsent = { body: body, after: inflight ? ctx.inflightSaveId : '' };
  ctx.outboxUnsent[key] = unsent;
  var job = Promise.resolve(ctx.ledgerOutbox[key])
    .then(function () { return inflight; })
    .then(function (res) {
      var rev = baseRevision;
      if (res && res.data && Number.isFinite(Number(res.data.revision))) rev = Number(res.data.revision);
      var conflict = res && res.status === 409 && res.data && res.data.error === 'revision_conflict' && Array.isArray(res.data.annotations);
      // 在途那次已带着最新状态：成功就完事。撞 revision 冲突与 requestSync 同口径：接到盘上那版再存。
      if (res && (res.ok || (res.status === 409 && !conflict)) && snapshotVersion <= covered) {
        if (ctx.outboxUnsent[key] === unsent) delete ctx.outboxUnsent[key];
        return null;
      }
      if (res && res.ok && res.data && Array.isArray(res.data.annotations)) base = res.data.annotations;
      if (conflict) rebaseSnapshot(res.data.annotations);
      return sendSnapshot(rev, 3);
    })
    .catch(function () { return null; });
  function rebaseSnapshot(server) {
    body.annotations = rebaseAnnotations(body.annotations, base, server);
    base = server;
  }
  function sendSnapshot(rev, triesLeft) {
    if (ctx.outboxUnsent[key] === unsent) delete ctx.outboxUnsent[key];
    body.baseRevision = rev;
    body.saveId = newSaveId();
    body.updated_at = new Date().toISOString();
    return postSave(body).then(function (res) {
      if (res.ok) return res;
      if (res.status === 409 && res.data && triesLeft > 1) {
        // 同 requestSync：接到盘上那版再存，不拿旧快照盖掉 agent 刚写的状态与回复。
        if (res.data.error === 'revision_conflict' && Array.isArray(res.data.annotations)) rebaseSnapshot(res.data.annotations);
        return sendSnapshot(Number(res.data.revision) || 0, triesLeft - 1);
      }
      return res;
    });
  }
  ctx.ledgerOutbox[key] = job;
  job.then(function () { if (ctx.ledgerOutbox[key] === job) delete ctx.ledgerOutbox[key]; });
}

export function hydrateFromDisk() {
  if (!ctx.SERVER) {
    ctx.marks = readLocalMarks();
    ctx.revision = 0;
    setServerOnline(false);
    return Promise.resolve(false);
  }
  var hydrateEpoch = ctx.syncEpoch; // 路由切换后本份 hydrate 作废
  // 这本账本上次离开时还有没写完的写：等它落盘再读，否则读到的是旧版。
  return Promise.resolve(ctx.ledgerOutbox[ledgerOutboxKey(ctx.ENTRY, ctx.PAGE)])
    .then(function () {
      if (hydrateEpoch !== ctx.syncEpoch) throw new Error('stale');
      return fetch(ctx.SERVER + '/annotations/' + encodeURIComponent(ctx.PAGE) + '?entry=' + encodeURIComponent(ctx.ENTRY));
    })
    .then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(function (doc) {
      if (hydrateEpoch !== ctx.syncEpoch) return false; // 已切账本，整份响应作废
      var diskMarks = docAnnotations(doc) || [];
      var diskRev = Number(doc && doc.revision);
      if (!Number.isFinite(diskRev)) diskRev = diskMarks.length ? 1 : 0;
      if (diskMarks.length || diskRev > 0) {
        ctx.marks = diskMarks.map(function (item) { return normalizeAnnotation(Object.assign({}, item)); });
        ensureAllMarkIds();
        ctx.revision = diskRev;
        setBase(diskMarks);
        writeLocalCache();
        return true;
      }
      // Empty disk: seed from LS cache only into memory (do not POST empty overwrite).
      ctx.marks = readLocalMarks();
      ensureAllMarkIds();
      ctx.revision = 0;
      ctx.baseMarks = [];
      if (ctx.marks.length) {
        // Push cache up once so disk becomes SSOT for other browsers.
        ctx.mutationVersion++;
        requestSync();
      }
      return true;
    })
    .catch(function () {
      if (hydrateEpoch !== ctx.syncEpoch) return false; // 已切账本，失败回调同样作废
      ctx.marks = readLocalMarks();
      ctx.revision = 0;
      setServerOnline(false);
      setStatus('未连接服务', true);
      return false;
    });
}

export function setServerOnline(on) {
  on = !!on;
  if (ctx.serverOnline === on) return;
  ctx.serverOnline = on;
  notify();
}

// 嵌在工作台画布上的 HTML 卡片（iframe 带 data-pp-parent-events，src/workbench/server-events.js）：
// 不自己开 /events，订阅工作台那一条。一张画布十几张卡片各开一条，HTTP/1.1 同源 6 条就堵死了。
function parentEventsHub() {
  try {
    var host = window.frameElement;
    if (!host || !host.hasAttribute('data-pp-parent-events')) return null;
    var wb = window.parent && window.parent.workbench;
    return wb && typeof wb.subscribeEvents === 'function' ? wb : null;
  } catch (e) {
    return null;
  }
}

function onAnnotationsEvent(data) {
  var doc;
  try { doc = JSON.parse(data); } catch (err) { return; }
  if (!doc) return;
  // Payloads without entry predate bucketing; they belong to 'pinpoint'.
  if ((doc.entry || 'pinpoint') !== ctx.ENTRY) return;
  if (doc.page !== ctx.PAGE && doc.page !== ctx.PAGE_KEY) return;
  var rev = Number(doc.revision);
  if (!Number.isFinite(rev) || rev <= ctx.revision) return;
  if (ctx.syncing || ctx.mutationVersion > ctx.syncedMutationVersion) {
    deferRemoteDoc(doc);
    return;
  }
  applyRemoteDoc(doc, '已从其他窗口更新');
}

export function connectEvents(opts) {
  if (!ctx.SERVER) return;
  closeEvents();
  // 停驻中不连：恢复时 setEventsParked(false) 再连并补读。
  if (ctx.eventsParked) return;
  // 服务端不重放 SSE：首次在线由 hydrate 负责，断线后恢复要补读当前账本。
  // 补读沿用 SSE 的 revision / defer / rebase 路径，不能用 hydrate 覆盖本地未保存的改动。
  // catchUp：停驻期间主动断开过，第一次连上就当重连，补读这段时间漏掉的推送。
  var statusSeen = !!(opts && opts.catchUp);
  function eventsStatus(on) {
    var reconnect = statusSeen && on && !ctx.serverOnline;
    statusSeen = true;
    setServerOnline(on);
    if (!reconnect) return;
    var epoch = ctx.syncEpoch;
    var entry = ctx.ENTRY;
    var page = ctx.PAGE;
    fetch(ctx.SERVER + '/annotations/' + encodeURIComponent(page) + '?entry=' + encodeURIComponent(entry))
      .then(function (res) { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
      .then(function (doc) {
        if (epoch !== ctx.syncEpoch || ctx.ledgerSwitching) return;
        onAnnotationsEvent(JSON.stringify(Object.assign({}, doc, { entry: entry, page: page })));
      })
      .catch(function () { /* 下次重连再补读；保留当前账本和未保存的改动。 */ });
  }
  var hub = parentEventsHub();
  if (hub) {
    ctx.parentEventsOff = hub.subscribeEvents(function (msg) {
      if (!msg) return;
      if (msg.type === 'status') eventsStatus(msg.online);
      else if (msg.type === 'annotations') onAnnotationsEvent(msg.data);
    });
    return;
  }
  if (typeof EventSource === 'undefined') return;
  try {
    ctx.eventSource = new EventSource(ctx.SERVER + '/events');
  } catch (e) {
    setServerOnline(false);
    return;
  }
  ctx.eventSource.onopen = function () { eventsStatus(true); };
  ctx.eventSource.onerror = function () {
    // Browser auto-reconnects while CONNECTING; only mark offline when closed or reconnecting.
    if (!ctx.eventSource || ctx.eventSource.readyState !== EventSource.OPEN) eventsStatus(false);
  };
  ctx.eventSource.addEventListener('annotations', function (ev) { onAnnotationsEvent(ev.data); });
}

function closeEvents() {
  if (ctx.parentEventsOff) {
    try { ctx.parentEventsOff(); } catch (e) { /* 工作台已经不在 */ }
    ctx.parentEventsOff = null;
  }
  if (!ctx.eventSource) return;
  try { ctx.eventSource.close(); } catch (e) { /* */ }
  ctx.eventSource = null;
  setServerOnline(false);
}

// 停驻（E2）：嵌入工作台停在文章页的停驻容器里时，这一份实例自己的 /events 先断开，
// 恢复时重连并按重连补读一次账本。HTTP/1.1 同源只有 6 条连接（server-events.js），
// 停驻的工作台不该再占着它们，否则文章页和别的标签页的请求会排队堵住。
// 只断推送：保存、outbox 走 POST，照常落盘。卡片实例走工作台那一条（parentEventsOff），不归这里。
export function setEventsParked(on) {
  on = !!on;
  if (ctx.eventsParked === on) return;
  ctx.eventsParked = on;
  if (ctx.parentEventsOff) return;
  if (on) { closeEvents(); return; }
  if (ctx.eventsConnected) connectEvents({ catchUp: true });
}

// SSE 连接与账本无关（事件按 entry + page 过滤），画布实例在第一次换桶前就
// 可以连上 —— 连接状态指示不等人。
export function connectEventsOnce() {
  if (ctx.eventsConnected) return;
  ctx.eventsConnected = true;
  connectEvents();
}

