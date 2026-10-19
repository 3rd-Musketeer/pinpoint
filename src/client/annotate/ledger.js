// 账本切换与启动收尾：画布切页时换桶重 hydrate，并在水合落定后放行等待者。
// 导出 bind_ledger、startAnnotate、whenSettled、whenLedgerReady。
import { annotationSlug } from '../../shared/annotation-slug.js';
import { readAnnFilter } from '../../shared/ann-status.js';
import { removeTempArrow } from './arrow.js';
import { renderAll } from './bubbles.js';
import { closeComposer, removeTip } from './composer.js';
import { currentWorkbenchPageId, resolve } from './dom.js';
import { statusFilterKey } from './marks.js';
import { connectEvents, connectEventsOnce, handOffUnsyncedWrites, hydrateFromDisk, setServerOnline } from './outbox.js';
import { hideGhost, mountOverlay, notify, setStatus } from './ui.js';
export function bind_ledger(c) { ctx = c; }
var ctx;

export function startAnnotate() {
  if (ctx.CANVAS_MODE) {
    // 画布实例：活动页定了才有桶（storage-unify）。SSE 先连（连接指示与事件流
    // 都与桶无关），账本由 watchWorkbenchPages 的第一次换页带入。
    renderAll();
    notify();
    watchWorkbenchPages();
  } else {
    hydrateFromDisk().then(function (online) {
      readyResolve();
      renderAll();
      notify();
      if (online) {
        // connected is set by SSE onopen, not by hydrate success.
        setStatus('已连接');
        setTimeout(function () { setStatus(''); }, 2000);
        connectEvents();
        ctx.eventsConnected = true;
      } else {
        setServerOnline(false);
      }
    });
  }
}

// ---------- 就绪（C1）----------
// 实例的账本第一次落定：画布实例 = 第一次换页 hydrate 完（boot 占位桶的 marks
// 是空的）；其余实例 = 首次 hydrate 完。whenReady 挂在 window.pinpoint 上，绑定方
// （工作台 ann-bridge / live-cards、文章浮层的钉子定位）等它替掉 marks 轮询 ——
// 落定之后行不在就是真不在。实例重载（iframe 换文档）拿到的是新实例、新 promise。
var readyResolve;
var ledgerReady = new Promise(function (resolve) { readyResolve = resolve; });
export function whenLedgerReady() { return ledgerReady; }

// ---------- 账本切换（画布切页） ----------
// 工作台画布切活动页 = 换桶（ENTRY = 新页 id、账本 @canvas）并重新 hydrate，
// 走 switchLedgerTo 管线：会话收尾 → 旧账本未落盘的写交 outbox → epoch 护栏 →
// 清渲染 → 重算 key → hydrate（先等目标账本的 outbox 排空）→ 落定放行。

function finishSessionForLedgerSwitch(pristineBoot) {
  // 打开中的草稿：有实质内容先走现有 save() 存回旧账本（save → persist → POST 带
  // 旧 PAGE，服务端落旧账本）；空草稿丢弃。这一切都必须发生在重算 key 之前。
  // 例外：boot 占位账本（画布实例还没落到第一个页桶）上的草稿跟着人走 ——
  // 用户看着的已经是目标页的板，草稿属于它；不关不存，PAGE 同步切过去后由
  // 用户正常保存。
  if (ctx.activeComposer && !pristineBoot) {
    var draft = ctx.activeComposer.ta ? ctx.activeComposer.ta.value.trim() : '';
    if (draft && typeof ctx.activeComposer.save === 'function') ctx.activeComposer.save();
    else closeComposer({ silentRender: true });
  }
  // 参照 setPaused(true) 的打包收掉剩余会话态（closeComposer 已覆盖大部分）。
  ctx.drag = null;
  if (ctx.arrowFrom) { ctx.arrowFrom = null; removeTempArrow(); removeTip(); }
  if (ctx.pinned) ctx.pinned = null;
  if (ctx.lasso) { ctx.lasso.remove(); ctx.lasso = null; }
  ctx.hoverEl = null;
  ctx.hoverSuppress = null;
  hideGhost();
}

/** 换账本的统一入口：next = { entry, ledgerPathname, page }。
    切换途中再来的请求 coalesce 到最新一个；目标与当前同账本则不动。 */
function requestSwitch(next) {
  if (!next) return;
  if (ctx.ledgerSwitching) { ctx.queuedSwitch = next; return; }
  if (next.entry === ctx.ENTRY && next.page === ctx.PAGE) return;
  switchLedgerTo(next);
}

function switchLedgerTo(next) {
  ctx.ledgerSwitching = true;
  // 1. 会话态收尾（草稿存回旧账本；boot 占位账本例外，见函数注释）
  var pristineBoot = ctx.CANVAS_MODE && !ctx.canvasLedgerApplied && ctx.marks.length === 0 && ctx.mutationVersion === 0;
  finishSessionForLedgerSwitch(pristineBoot);
  // 1b. 旧账本没落盘的写交给 outbox（必须在 epoch 作废在途应答之前取快照）
  handOffUnsyncedWrites();
  if (ctx.CANVAS_MODE) ctx.canvasLedgerApplied = true;
  // 2. epoch 护栏：在途 sync/hydrate 响应全部作废；deferred 属于旧账本
  ctx.syncEpoch++;
  ctx.deferredRemoteDoc = null;
  ctx.syncing = false; // 旧响应已被 epoch 拦下不会污染；放行新账本立即 persist
  // 3. 同一帧清掉旧账本渲染——hydrate 是异步的，绝不能让旧 selector 在新 DOM 上短暂命中
  ctx.marks = [];
  ctx.baseMarks = [];
  ctx.structureDirty = true;
  renderAll();
  // 4. 重算账本（闭包 var 重赋值即全局生效）
  ctx.ENTRY = next.entry;
  ctx.LEDGER_PATHNAME = next.ledgerPathname;
  ctx.PAGE = next.page;
  ctx.PAGE_KEY = annotationSlug(ctx.PAGE);
  ctx.LS_KEY = 'pinpoint:' + ctx.ENTRY + ':' + ctx.LEDGER_PATHNAME;
  // 筛选按页记忆：换账本即换槽（画布实例切活动页时弹层筛选跟着换页）。
  ctx.statusFilter = readAnnFilter(localStorage, statusFilterKey());
  ctx.revision = 0;
  ctx.mutationVersion = 0;
  ctx.syncedMutationVersion = 0;
  ctx.syncError = false;
  // 5. 挂载点掉出文档则按原逻辑重挂（data-ann-viewport 两种
  //    模式的定位差异与 _originCache 失效由 mountOverlay 处理）
  if (!ctx.overlay.isConnected || !ctx.chromeLayer.isConnected) mountOverlay();
  if (!ctx.toolbar.isConnected) document.body.appendChild(ctx.toolbar);
  if (ctx.sidebar && !ctx.sidebar.isConnected) document.body.appendChild(ctx.sidebar);
  // 6. hydrate 新账本
  hydrateFromDisk().then(function () {
    readyResolve();
    ctx.structureDirty = true;
    renderAll();
    notify();
    ctx.ledgerSwitching = false;
    var waiters = ctx.settleWaiters;
    ctx.settleWaiters = [];
    for (var i = 0; i < waiters.length; i++) waiters[i](true);
    if (ctx.queuedSwitch) {
      var queued = ctx.queuedSwitch;
      ctx.queuedSwitch = null;
      requestSwitch(queued);
    }
  });
}

/** 账本切换是否已落定（hydrate 完成）。跨页跳转（goToMark）先切页再定位，
    定位必须等新页的账本水合完，否则旧 ctx.marks 里找不到行。 */
export function whenSettled() {
  if (!ctx.ledgerSwitching) return Promise.resolve(true);
  return new Promise(function (resolve) { ctx.settleWaiters.push(resolve); });
}

// ---------- 画布切页换桶（storage-unify） ----------
// 工作台的活动页由 stage.js 持有；这里经 window.workbench.onPageChange 订阅
// （boot 早于订阅时直接读 activePageId 兜底）。活动页一定 → 桶一定，
// 账本恒 @canvas。workbench 一直不出现就没有活动页可言：账本留在 boot 占位，
// 不再「落 pinpoint 兜底桶」——那是个空转承诺（requestSwitch 同账本短路，
// 永不 hydrate），且占位期保存的行没有归属（保存已被拦下，见 save 的占位判断）。

function canvasSwitchFor(pageId) {
  return { entry: pageId, ledgerPathname: ctx.CANVAS_PAGE, page: ctx.CANVAS_PAGE };
}

function watchWorkbenchPages() {
  var applied = null;
  var apply = function (id) {
    if (!id || id === applied) return;
    applied = id;
    requestSwitch(canvasSwitchFor(id));
  };
  connectEventsOnce();
  // 工作台还没接管时先用 URL 把桶切对（?page= 深链），一次就够 —— 画布实例的页
  // 固定在地址里，不会中途变。workbench 出现（stage.js 挂上 window.workbench 时
  // dispatch 'workbench:ready'）换成 onPageChange 驱动。检查与挂监听之间没有
  // await：事件在同一同步块里、赋值之后发出，先后两种时序都不会漏（C1：替掉
  // 25ms 轮询）。
  apply(currentWorkbenchPageId());
  if (window.workbench && typeof window.workbench.onPageChange === 'function') {
    window.workbench.onPageChange(apply);
    apply(typeof window.workbench.activePageId === 'function' ? window.workbench.activePageId() : null);
    return;
  }
  window.addEventListener('workbench:ready', function () {
    window.workbench.onPageChange(apply);
    apply(typeof window.workbench.activePageId === 'function' ? window.workbench.activePageId() : null);
  }, { once: true });
}

// ---------- 启动：磁盘 hydrate → 渲染 → SSE ----------
