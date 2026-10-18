// 标注框的附件与自动保存：贴图、输入停下后落盘。导出 bind_composer_images、
// attachComposerImages、attachComposerAutosave。
import { backfillTargetPpIds, markElementTargets, normalizeElementTargets } from './anchor.js';
import { contentToStorage, ensureMarkId, extractMentionIds } from './marks.js';
import { persist, requestSync } from './persist.js';
import { setStatus } from './ui.js';
export function bind_composer_images(c) { ctx = c; }
var ctx;

export function attachComposerImages(box, ta, m) {
var images = (m.images || []).slice();
var imgWrap = box.querySelector('#ann-imgs');
function renderImgs() {
  imgWrap.innerHTML = '';
  images.forEach(function (im, i) {
    var d = document.createElement('div');
    d.className = 'im'; d.setAttribute('data-ann-ui', '');
    d.innerHTML = '<img src="' + ctx.SERVER + '/images/' + encodeURIComponent(im.file) + '?entry=' + encodeURIComponent(ctx.ENTRY) + '"><span class="x">×</span>';
    d.querySelector('.x').addEventListener('click', function () { images.splice(i, 1); renderImgs(); });
    imgWrap.appendChild(d);
  });
}
renderImgs();
function addImageFile(file) {
  var rd = new FileReader();
  rd.onload = function () {
    setStatus('上传截图…');
    fetch(ctx.SERVER + '/image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: ctx.PAGE, entry: ctx.ENTRY, data: rd.result })
    }).then(function (r) { return r.json(); })
      .then(function (j) { images.push({ file: j.file, path: j.path }); renderImgs(); setStatus(''); })
      .catch(function () { setStatus('截图上传失败', true); });
  };
  rd.readAsDataURL(file);
}
ta.addEventListener('paste', function (e) {
  var items = (e.clipboardData || {}).items || [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image/') === 0) { e.preventDefault(); addImageFile(items[i].getAsFile()); }
  }
});
  return images;
}

// 自动保存与存盘：把框里的草稿（正文、改文案开关、截图、箭头、目标）按 editSnapshot 判脏，
// 输入停 AUTOSAVE_MS 存一次，关框时由 closeComposer 立即 commit。草稿状态在 draft 上，共享给 UI 侧的改动。
export function attachComposerAutosave(composer, ta, m, draft) {
  // 自动保存：没有保存按钮。输入停 AUTOSAVE_MS 存一次，关框（Esc / X /
  // Enter / 换钉子 / 切页 / 退出标注模式）时立即存。只在和上次存的不一样时
  // 写账本 —— 打开再关掉不改状态；一改就按状态机回 open。
  function editSnapshot() {
    return JSON.stringify([ta.value, draft.changeOn, !!draft.research, draft.images.length, m.move || null,
      markElementTargets(m).map(function (t) { return t.selector; })]);
  }
  var lastCommitted = null; // 打开设置全部完成后再取（见 openComposer 末尾）
  var autosaveT = null;
  composer.isDirty = function () { return editSnapshot() !== lastCommitted; };
  composer.scheduleAutosave = function () {
    clearTimeout(autosaveT);
    autosaveT = setTimeout(function () { if (ctx.activeComposer === composer) commit(); }, ctx.AUTOSAVE_MS);
  };
  composer.cancelAutosave = function () { clearTimeout(autosaveT); };
  composer.commit = commit;
  composer.takeSnapshot = function () { lastCommitted = editSnapshot(); };

  // 框内自动保存状态。字由现有保存世代驱动（persist.js 的 mutationVersion /
  // syncedMutationVersion / syncing / syncError），不另发请求。旧请求成功后如果
  // 又有输入，世代已经往前走，仍显示待保存或正在保存，不把较早的成功当成当前全文已保存。
  var stateEl = (composer.box || document.getElementById('ann-box'))
    ? (composer.box || document.getElementById('ann-box')).querySelector('#ann-save-state') : null;
  var stateText = '';
  var announced = '';
  function paintState() {
    if (!stateEl) return;
    var dirty = composer.isDirty();
    var pending = ctx.mutationVersion > ctx.syncedMutationVersion;
    var next = '';
    var tone = '';
    var live = '';
    if (ctx.syncError && pending) {
      next = 'fail';
      tone = 'fail';
      live = '保存失败';
    } else if (ctx.syncing && pending) {
      next = 'saving';
      live = '正在保存';
    } else if (dirty || pending) {
      next = 'dirty';
      live = '尚未保存';
    } else if (ctx.syncedMutationVersion > 0 && ctx.mutationVersion === ctx.syncedMutationVersion) {
      next = 'saved';
      live = '已保存';
    }
    if (next === stateText) return;
    stateText = next;
    stateEl.dataset.tone = tone;
    stateEl.textContent = '';
    if (next === 'fail') {
      stateEl.appendChild(document.createTextNode('保存失败，'));
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'ann-save-retry';
      retry.textContent = '重试';
      retry.addEventListener('click', function () {
        // 重试期间允许继续输入：先把框里最新的改动交进现有队列，再重发没确认的那次。
        if (composer.isDirty()) commit();
        requestSync();
      });
      stateEl.appendChild(retry);
    } else if (next === 'saving') {
      stateEl.textContent = '正在保存…';
    } else if (next === 'dirty') {
      stateEl.textContent = '尚未保存';
    } else if (next === 'saved') {
      stateEl.textContent = '已保存';
    }
    // 连续输入不逐字播报：同一句只在第一次出现时进 aria-live。
    if (live !== announced) {
      announced = live;
      stateEl.setAttribute('aria-live', live ? 'polite' : 'off');
    }
  }
  composer.noteSaveState = paintState;
  ctx.updateListeners.push(paintState);
  composer.dropSaveState = function () {
    var at = ctx.updateListeners.indexOf(paintState);
    if (at >= 0) ctx.updateListeners.splice(at, 1);
  };

  function commit() {
    if (!composer.isDirty()) return false;
    if (ctx.arrowFrom === m) return false; // 正在拖箭头：拖完回弹后再存
    // storage-unify：画布实例 boot 占位期（活动页未定、ENTRY 还是 pinpoint）
    // 不保存——占位账本上的行没有归属，换桶不带它走。占位窗口毫秒级
    // （workbench 启动即报活动页），真出现就是在等一个还没就绪的页面。
    if (ctx.CANVAS_MODE && !ctx.canvasLedgerApplied) return false;
    ensureMarkId(m);
    var stored = contentToStorage(ta.value.trim(), markElementTargets(m));
    m.content = stored;
    delete m.comment;
    var mentionIds = extractMentionIds(stored);
    if (mentionIds.length) m.mentions = mentionIds; else delete m.mentions;
    if (draft.research) {
      m.research = draft.research;
    } else {
      delete m.research;
    }
    if (draft.changeOn) m.changeTo = true; else delete m.changeTo;
    if (draft.images.length) m.images = draft.images; else delete m.images;
    normalizeElementTargets(m);
    backfillTargetPpIds(m);
    delete m._draft;
    delete m._targetMode;
    delete m._anchor;
    // 空内容不存：新建的不落账本（关框即丢），已有的保留上次存的正文；要删走垃圾桶。
    if (!m.content.replace(/\[@t:i[1-9][0-9]*\]/g, '').trim() && !m.move && !m.research && !m.changeTo && !m.images) return false;
    // 按 id 认领：#n 的取号权在服务端，自动保存之间 n 可能已被改写。
    var idx = ctx.marks.findIndex(function (k) { return k.id === m.id; });
    // pp2 状态机：新标注恒 open；owner 编辑正文或目标 → 保存时状态回 open
    // （服务端同样强制，客户端先把生效态带上看得到）。
    m.status = 'open';
    if (idx < 0) ctx.marks.push(m); else {
      ctx.marks[idx] = m;
    }
    composer.isNew = false;
    lastCommitted = editSnapshot();
    persist();
    return true;
  }
}

