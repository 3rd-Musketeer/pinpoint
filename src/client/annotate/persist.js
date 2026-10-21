// 落盘：localStorage 缓存、/save 请求、409 三方合并（rebaseOnto）与服务端
// 编号认领。导出 bind_persist、persist、requestSync、applyRemoteDoc、saveBody 等。
import { normalizeAnnotation } from '../../shared/annotation-indicator.js';
import { rebaseAnnotations } from '../../shared/ledger-rebase.js';
import { newSaveId, postSave as postSaveTo } from '../lib/save-request.js';
import { renderLedgerChange } from './bubbles.js';
import { nextN } from './create.js';
import { docAnnotations, ensureAllMarkIds } from './marks.js';
import { notify, setStatus } from './ui.js';
export function bind_persist(c) { ctx = c; }
var ctx;

// ---------- 持久化（磁盘 SSOT；LS 仅缓存）----------
export function readLocalMarks() {
  try {
    var value = JSON.parse(localStorage.getItem(ctx.LS_KEY) || '[]');
    return Array.isArray(value) ? value.map(normalizeAnnotation) : [];
  } catch (e) {
    return [];
  }
}

export function writeLocalCache() {
  try {
    if (ctx.marks.length) localStorage.setItem(ctx.LS_KEY, JSON.stringify(ctx.marks));
    else localStorage.removeItem(ctx.LS_KEY);
  } catch (e) { /* quota */ }
}

export function applyRemoteDoc(doc, statusMsg) {
  var list = docAnnotations(doc);
  if (!list) return;
  var rev = Number(doc.revision);
  if (!Number.isFinite(rev)) rev = 0;
  if (rev < ctx.revision && ctx.marks.length) return;
  ctx.marks = list.map(function (item) { return normalizeAnnotation(Object.assign({}, item)); });
  ensureAllMarkIds();
  ctx.revision = rev;
  setBase(list);
  ctx.syncedMutationVersion = ctx.mutationVersion;
  writeLocalCache();
  ctx.structureDirty = true;
  renderLedgerChange();
  notify();
  if (statusMsg) {
    setStatus(statusMsg);
    setTimeout(function () { setStatus(''); }, 2000);
  }
}

/** M1：#n 的取号权在服务端。保存应答把带号的行带回来，按 id 认领覆盖本地
    的临时号（nextN 只管应答前的显示）；不在应答里的行（在途新草稿）不动。
    只改 n，不 bump ctx.mutationVersion —— 认领不触发再保存。 */
function adoptServerNumbers(data) {
  var list = data && Array.isArray(data.annotations) ? data.annotations : null;
  if (!list) return;
  var serverN = Object.create(null);
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    if (a && a.id && Number.isInteger(a.n)) serverN[a.id] = a.n;
  }
  var changed = false;
  for (var j = 0; j < ctx.marks.length; j++) {
    var m = ctx.marks[j];
    if (serverN[m.id] !== undefined && serverN[m.id] !== m.n) { m.n = serverN[m.id]; changed = true; }
  }
  if (!changed) return;
  ctx.structureDirty = true;
  renderLedgerChange();
  notify();
}

export function persist() {
  ctx.mutationVersion++;
  writeLocalCache();
  requestSync();
  ctx.structureDirty = true;
  renderLedgerChange();
  notify();
}

/** 记下盘上那一版的行（深拷贝：marks 的行会被就地改）。 */
export function setBase(list) {
  ctx.baseMarks = (Array.isArray(list) ? list : []).map(function (item) {
    return normalizeAnnotation(JSON.parse(JSON.stringify(item)));
  });
}

/** 本窗口有没落盘的改动、盘上又有了更新的一版（409 带回的、或保存在途时经 SSE 先到的）：
    把本窗口的改动接到那一版上（src/shared/ledger-rebase.js），agent 写的状态与回复、
    别处的改动都留下，然后以那一版的 ctx.revision 为底再存。不重发整份旧快照：那样会把
    agent 刚写的状态盖回去，服务端判非法转换，owner 这一边的改动也跟着丢。 */
export function rebaseOnto(doc) {
  var list = docAnnotations(doc);
  var rev = Number(doc && doc.revision);
  if (!list || !Number.isFinite(rev)) return false;
  var server = list.map(function (item) { return normalizeAnnotation(Object.assign({}, item)); });
  ctx.marks = rebaseAnnotations(ctx.marks, ctx.baseMarks, server).map(normalizeAnnotation);
  ensureAllMarkIds();
  ctx.revision = rev;
  setBase(list);
  writeLocalCache();
  ctx.structureDirty = true;
  renderLedgerChange();
  notify();
  return true;
}

export function deferRemoteDoc(doc) {
  var rev = Number(doc && doc.revision);
  if (!Number.isFinite(rev)) return;
  if (!ctx.deferredRemoteDoc || rev > Number(ctx.deferredRemoteDoc.revision)) ctx.deferredRemoteDoc = doc;
}

function settleDeferredRemote(sentVersion) {
  if (!ctx.deferredRemoteDoc) return false;
  var doc = ctx.deferredRemoteDoc;
  ctx.deferredRemoteDoc = null;
  var rev = Number(doc.revision);
  if (!Number.isFinite(rev) || rev <= ctx.revision) return false;
  if (ctx.mutationVersion > sentVersion) return rebaseOnto(doc);
  applyRemoteDoc(doc, '已从其他窗口更新');
  return false;
}

export function requestSync() {
  if (!ctx.SERVER || ctx.syncing || ctx.mutationVersion <= ctx.syncedMutationVersion) return;
  ctx.syncing = true;
  notify();
  var sentVersion = ctx.mutationVersion;
  ctx.inflightVersion = sentVersion;
  var sentEpoch = ctx.syncEpoch; // 路由切换后本响应作废（数据属于旧 pathname 的账本）
  var body = saveBody(ctx.revision);
  // saveBody 只浅拷贝数组；行与嵌套目标会被就地编辑。合并 ack 时只把发送后的
  // 新改动接回去，必须保留实际发送那一版，不能再拿上一次盘上版本作底。
  var sentMarks = JSON.parse(JSON.stringify(body.annotations));
  ctx.inflightSaveId = body.saveId;
  var sent = postSave(body);
  ctx.inflightSync = sent.catch(function () { return null; });
  sent
    .then(function (res) {
      if (sentEpoch !== ctx.syncEpoch) return; // 陈旧响应：不得碰 syncing 或新账本状态
      ctx.syncing = false;
      if (res.ok) {
        if (res.data && Number.isFinite(Number(res.data.revision)) && Number(res.data.revision) >= ctx.revision) {
          if (Array.isArray(res.data.annotations)) {
            if (ctx.mutationVersion > sentVersion) {
              setBase(sentMarks);
              rebaseOnto(res.data);
            } else {
              // 无在途新编辑：服务端归一的 status、回复等就是当前权威版本。
              applyRemoteDoc(res.data);
            }
          } else {
            ctx.revision = Number(res.data.revision);
          }
          adoptServerNumbers(res.data);
        }
        ctx.syncedMutationVersion = Math.max(ctx.syncedMutationVersion, sentVersion);
        var shouldRetry = settleDeferredRemote(sentVersion);
        ctx.syncError = false;
        setStatus('已同步');
        setTimeout(function () { setStatus(''); }, 1500);
        if (shouldRetry || ctx.mutationVersion > ctx.syncedMutationVersion) requestSync();
        notify();
        return;
      }
      if (res.status === 409 && res.data) {
        ctx.deferredRemoteDoc = null;
        // 盘上比本窗口的底新（agent 写了状态或回复、另一个窗口存过）：接到盘上那版再存。
        if (res.data.error === 'revision_conflict' && rebaseOnto(res.data)) {
          requestSync();
        } else if (ctx.mutationVersion > sentVersion) {
          ctx.revision = Number(res.data.revision) || 0;
          requestSync();
        } else {
          applyRemoteDoc(res.data, '已从其他窗口更新');
        }
        return;
      }
      ctx.syncError = true;
      notify();
      setStatus('同步失败', true);
    })
    .catch(function () {
      if (sentEpoch !== ctx.syncEpoch) return; // 同上：切账本后的失败回调一并丢弃
      ctx.syncing = false;
      // POST failed — SSE may still be open, so don't flip connected.
      ctx.syncError = true;
      notify();
      setStatus('同步失败', true);
    });
}

// keepalive（够小时）：在途的保存在关页、导航走之后照样送达（lib/save-request.js）。
export function postSave(body) {
  return postSaveTo(ctx.SERVER, body);
}

/** 每次 /save 一个 saveId；after = 这份快照接在哪次在途保存之后（离开页面时用，见 flushOnLeave）。 */
export function saveBody(baseRevision, after) {
  var body = {
    page: ctx.PAGE,
    entry: ctx.ENTRY,
    path: decodeURIComponent(ctx.LEDGER_PATHNAME),
    updated_at: new Date().toISOString(),
    baseRevision: baseRevision,
    saveId: newSaveId(),
    annotations: ctx.marks.slice()
  };
  if (after) body.after = after;
  return body;
}

/** 离开页面（关标签、导航走、切到后台）：还没落盘的写现在就发，不等应答。
    没有在途保存 → 走 requestSync（页面还在的话应答照常处理）。有在途保存、
    它之后又改过 → 整份快照以 ctx.revision 为底发一次，带 after = 在途那次的 saveId：
    在途那次先到，服务端认出盘上那版是它写的，快照接上；快照先到，它直接落盘、
    在途那次 409。两份请求走各自的连接，到达顺序不定，这样谁先到盘上都是快照
    （2026-10-14 之前按 ctx.revision 和 ctx.revision + 1 各发一份：+1 那份抢在在途那次
    之前到、本底那份落在它之后时，最后一稿丢了）。页面没走（只是切到后台）时，
    在途应答回来照旧：本地更新就重发，409 接到盘上那版再重发，结果一致。换账本时交给 outbox、还没发出去的快照
    也在这里发。还在防抖里的 lastRect 不发：它是锚点几何的缓存，不是 owner 的改动，
    丢一次无害；离开时补发它只会在关页之后多一次写盘。 */
