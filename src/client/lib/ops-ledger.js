/* 文章页的一本账本：磁盘上最新一版 + 还没落盘的操作（src/shared/prose-thread.js applyProseOps）。
 * 正文评论客户端（src/client/prose-comments.js）用两本：@prose（正文评论）和 @canvas（右栏里穿插的
 * 画布标注，只改状态）。写入是“操作”而不是整份快照：保存撞上 409（agent 刚回了一句、工作台或另一个
 * 标签页刚存过）时，把还没落盘的操作重放到磁盘上的最新版本再存，别人的改动不会被这一边的旧快照盖掉。
 * 水合与 SSE 由调用方做（一页只开一条 /events），拿到的文档交给 accept（水合）/ remote（推送）。
 * 离开页面不丢写：flushOnLeave 与画布 annotate.js 同一套（docs/annotation.md“离开页面不丢写”）。 */

import { newSaveId, postSave } from './save-request.js';
import { applyProseOps } from '../../shared/prose-thread.js';

/**
 * options:
 *   server, entry, ledger            POST /save 的目标（账本 = ledger，桶 = entry）
 *   path()                           这次保存带的 path（正文评论 = 文章地址；画布 = 盘上原来的 path）
 *   onChange()                       看得见的行变了（重画）
 *   onRejected(ops)                  服务拒了这批操作（非法转换等）：返回 true = 字已放回输入框
 *   maxConflicts                     连续 409 超过这个数就停一会儿再试
 */
export function createOpsLedger(options) {
  var SERVER = options.server || '';
  var MAX_CONFLICTS = options.maxConflicts || 5;
  var onChange = options.onChange || function () {};
  var onRejected = options.onRejected || function () { return false; };
  var pathOf = options.path || function () { return ''; };

  var base = [];          // 磁盘上最新一版的行（服务端发过号）
  var revision = 0;
  var diskPath = '';
  var ops = [];           // 还没落盘的操作
  var hydrated = false;
  var inflight = false;
  var inflightSaveId = '';  // 在途保存的 saveId：离开页面时的那份带 after 接在它之后
  var conflicts = 0;
  var remoteStash = null;
  var retryTimer = 0;
  var error = '';

  function adopt(doc) {
    base = Array.isArray(doc.annotations) ? doc.annotations : [];
    var rev = Number(doc.revision);
    revision = Number.isFinite(rev) ? rev : 0;
    if (typeof doc.path === 'string') diskPath = doc.path;
  }

  function stash(doc) {
    if (!remoteStash || Number(doc.revision) > Number(remoteStash.revision)) remoteStash = doc;
  }

  function scheduleRetry(ms) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flush, ms);
  }

  function body(extra) {
    var out = {
      page: options.ledger,
      entry: options.entry,
      path: pathOf(diskPath),
      updated_at: new Date().toISOString(),
      baseRevision: revision,
      saveId: newSaveId(),
      annotations: applyProseOps(base, ops),
    };
    return extra ? Object.assign(out, extra) : out;
  }

  function flush() {
    if (inflight || !ops.length || !hydrated) return;
    inflight = true;
    var sent = ops.length;
    var req = body();
    inflightSaveId = req.saveId;
    // keepalive（够小时）：在途的保存在关页、导航走之后照样送达（lib/save-request.js）。
    postSave(SERVER, req)
      .then(function (res) {
        inflight = false;
        if (res.ok) {
          base = Array.isArray(res.data.annotations) ? res.data.annotations : req.annotations;
          revision = Number(res.data.revision) || revision + 1;
          ops.splice(0, sent);
          conflicts = 0;
          error = '';
        } else if (res.status === 409 && res.data && Array.isArray(res.data.annotations)) {
          // 磁盘上有更新的一版：操作留着，重放到新版上再存。
          adopt(res.data);
          conflicts += 1;
        } else {
          // 服务拒了这批操作：从队列里拿掉、回到磁盘上的样子；调用方把 owner 写的字放回输入框。
          var rejected = ops.splice(0, sent);
          var restored = onRejected(rejected);
          error = '保存被拒：' + ((res.data && (res.data.detail || res.data.error)) || res.status)
            + (restored ? '。原文已放回输入框' : '');
          if (res.data && Array.isArray(res.data.annotations)) adopt(res.data);
        }
        if (remoteStash && Number(remoteStash.revision) > revision) adopt(remoteStash);
        remoteStash = null;
        onChange();
        if (ops.length) {
          if (conflicts > MAX_CONFLICTS) {
            error = '保存一直冲突，稍后重试';
            conflicts = 0;
            onChange();
            scheduleRetry(3000);
          } else {
            flush();
          }
        }
      })
      .catch(function () {
        inflight = false;
        error = '同步失败，稍后重试';
        onChange();
        scheduleRetry(3000);
      });
  }

  /** 离开页面（关标签、导航走、切到后台）：排着的操作现在就发，不等应答。没有在途保存
      → 照常 flush。有在途保存 → base + 全部操作以 revision 为底发一次，带 after = 在途那次
      的 saveId：在途那次先到，服务端认出盘上那版是它写的，这份接上；这份先到，它直接落盘、
      在途那次 409。谁先到盘上都是这份（与画布 annotate.js 同一套）。页面没走时，在途
      应答回来照旧，剩下的操作 409 后重放到盘上的新版；reply 按 at 去重，不会回两遍。 */
  var leaveSentOps = null;
  function flushOnLeave() {
    if (!hydrated || !ops.length) return;
    if (!inflight) { clearTimeout(retryTimer); flush(); return; }
    if (leaveSentOps === ops[ops.length - 1]) return;
    leaveSentOps = ops[ops.length - 1];
    postSave(SERVER, body({ after: inflightSaveId })).catch(function () {});
  }

  return {
    /** base + ops：界面看到的行。 */
    rows: function () { return applyProseOps(base, ops); },
    /** 水合拿到的文档（GET /annotations）。保存在途时先存着，等应答回来一起处理。 */
    accept: function (doc) {
      hydrated = true;
      if (inflight) { stash(doc); onChange(); return; }
      adopt(doc);
      onChange();
      flush();
    },
    /** SSE 推来的文档：比手上的新才用。 */
    remote: function (doc) {
      var rev = Number(doc.revision);
      if (!Number.isFinite(rev) || rev <= revision) return;
      if (inflight) { stash(doc); return; }
      adopt(doc);
      onChange();
    },
    enqueue: function (op) {
      ops.push(op);
      onChange();
      flush();
    },
    flushOnLeave: flushOnLeave,
    hydrated: function () { return hydrated; },
    settled: function () { return hydrated && !inflight && !ops.length; },
    error: function () { return error; },
  };
}
