/* 正文与右栏的事件。选区出“评论”、点卡外面收回复框或保存编辑、Esc、点高亮、点右栏按钮、Enter 发送。
 * 导出 bindProseEvents。动作（发送、展开、改状态、编辑）由入口经 actions 传进来。 */

import { isSendKey } from '../../shared/prose-thread.js';
import { cssEscape, growEdit, railArea } from './edit-field.js';

var MARK_CLASS = 'pp-hl';

export function bindProseEvents(opts) {
  var root = opts.root;
  var rail = opts.rail;
  var state = opts.state;
  var selection = opts.selection;
  var edit = opts.edit;
  var railApi = opts.railApi;
  var syncFocusClasses = opts.syncFocusClasses;
  var actions = opts.actions;

  rail.addEventListener('compositionstart', function (e) {
    if (e.target.matches('textarea[data-reply], textarea[data-edit], .pp-body.pp-edit')) state.composingArea = e.target;
  });
  rail.addEventListener('compositionend', function (e) {
    if (e.target !== state.composingArea) return;
    state.composingArea = null;
    // 浏览器在 compositionend 后才提交最后一次 input；等这批输入事件完成再保存 value 与光标。
    setTimeout(function () { if (state.railDirty) railApi.renderRail(); }, 0);
  });
  // 鼠标松开、Shift+方向键立即判；触屏拖选手柄没有 mouseup，靠 selectionchange 停下来之后再判。
  var pointerDown = false;
  var selTimer = 0;
  document.addEventListener('pointerdown', function () { pointerDown = true; }, true);
  document.addEventListener('pointerup', function () { pointerDown = false; }, true);
  document.addEventListener('selectionchange', function () {
    clearTimeout(selTimer);
    selTimer = setTimeout(function () { if (!pointerDown) selection.onSelectionDone(null); }, 400);
  });
  document.addEventListener('mouseup', selection.onSelectionDone);
  document.addEventListener('keyup', function (e) {
    if (e.shiftKey || e.key === 'Shift' || e.key.indexOf('Arrow') === 0) selection.onSelectionDone(e);
  });
  document.addEventListener('mousedown', function (e) {
    if (selection.hasSelBtn() && !(e.target.closest && e.target.closest('.pp-selbtn'))) selection.hideSelBtn();
  });
  // 点那张卡外面：空着的回复框收起，写了字的留着（字不丢，也不打断）。用 click 而不是
  // mousedown：mousedown 时重画右栏会换掉正要点的按钮，这一下 click 就落空了。右栏自己的
  // click 先跑完（可能已重画），这里按被点的元素所在线程判断，元素已脱离文档也认得出。
  document.addEventListener('click', function (e) {
    if (!state.replyOpen.size) return;
    var hit = e.target && e.target.closest ? e.target.closest('.pp-thread') : null;
    var hitId = hit ? hit.getAttribute('data-id') : null;
    var changed = false;
    state.replyOpen.forEach(function (id) {
      if (id === hitId) return;
      var area = railArea(rail, id);
      if (area && area.value.trim()) return;
      actions.closeReply(id);
      changed = true;
    });
    if (changed) railApi.renderRail();
  });
  // 点正在编辑的这张卡外面：保存（写了新字入队，清空或没改恢复原文）。点同一张卡里别处不收。
  // 编辑键比卡片 id 长一截（后续回复带 /m 下标），按卡片 id 认，不拿整条键对。
  document.addEventListener('click', function (e) {
    if (state.editingId == null) return;
    var hit = e.target && e.target.closest ? e.target.closest('.pp-thread') : null;
    var hitId = hit ? hit.getAttribute('data-id') : null;
    // 正文评论的编辑键是卡片 id，或卡片 id 加 /m 下标；画布标注的编辑键就是卡片 id（c: 前缀）。
    var cardId = state.editingId.indexOf('c:') === 0 ? state.editingId : edit.parseEditKey(state.editingId).id;
    if (hitId != null && hitId === cardId) return;
    edit.finishEdit();
  });
  // 编辑框里打字：跟着内容长高。
  rail.addEventListener('input', function (e) {
    if (e.target && e.target.matches && e.target.matches('textarea[data-edit]')) growEdit(e.target);
  });
  // Esc：别的弹层（文章站点的 [[ ]] popup、画布浮层）处理过的 Esc 带 defaultPrevented，不动这里；
  // 草稿只在焦点就在草稿框里时取消，免得按 Esc 关别的东西时把写了一半的评论扔掉。
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || state.composingArea) return;
    // 焦点在回复框里：Esc 只收起这个框，写了一半的字留作草稿。
    var replyArea = document.activeElement && document.activeElement.closest
      && document.activeElement.closest('textarea[data-reply]:not([data-reply="__draft"])');
    if (replyArea && rail.contains(replyArea)) {
      var replyId = replyArea.getAttribute('data-reply');
      actions.closeReply(replyId);
      railApi.renderRail();
      var again = rail.querySelector('.pp-thread[data-id="' + cssEscape(replyId) + '"] [data-act="open-reply"]');
      if (again) again.focus();
      return;
    }
    if (state.draft) {
      var active = document.activeElement;
      if (active && active.matches && active.matches('textarea[data-reply="__draft"]')) actions.cancelDraft();
      return;
    }
    if (state.focusedId) { state.focusedId = null; railApi.renderRail(); syncFocusClasses(); }
    selection.hideSelBtn();
  });

  root.addEventListener('click', function (e) {
    var mark = e.target.closest && e.target.closest('mark.' + MARK_CLASS);
    if (!mark) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // 拖选结束在高亮上：是在选字，不是点评论
    var ids = (mark.getAttribute('data-ids') || '').split(' ').filter(function (id) { return id && id !== '__draft'; });
    if (!ids.length) return;
    var next = ids.indexOf(state.focusedId) >= 0 ? ids[(ids.indexOf(state.focusedId) + 1) % ids.length] : ids[0];
    railApi.focusThread(next);
  });

  rail.addEventListener('click', function (e) {
    var thread = e.target.closest('.pp-thread');
    if (!thread) return;
    var id = thread.getAttribute('data-id');
    // 点 owner 写的第一句：原地编辑（画布标注卡也要在这里接住，不落到下面“开画布”的分支）。
    var editTarget = e.target.closest ? e.target.closest('.text[data-edit], .pp-body[data-edit]') : null;
    if (editTarget) {
      var sel = window.getSelection();
      // 选区没收起、而且盖住了这句：是在选字，不是要编辑。别的地方留下的选区不挡这次点击。
      if (sel && !sel.isCollapsed && sel.containsNode(editTarget, true)) return;
      edit.startEdit(editTarget.getAttribute('data-edit'));
      return;
    }
    var act = e.target.closest('[data-act]');
    if (act) {
      var what = act.getAttribute('data-act');
      if (what === 'send-draft') actions.sendDraft();
      else if (what === 'cancel-draft') actions.cancelDraft();
      else if (what === 'reply') actions.sendReply(id);
      else if (what === 'open-reply') actions.openReply(id);
      else if (what === 'expand') actions.setExpanded(id, true);
      else if (what === 'collapse') actions.setExpanded(id, false);
      else if (what === 'close') actions.setStatus(id, 'close');
      else if (what === 'reopen') actions.setStatus(id, 'open');
      return;
    }
    // 画布标注：点卡片（链接以外的地方也算）就在文章上开画布、定位到这颗钉子，与点链接同一条路。
    if (thread.getAttribute('data-kind') === 'canvas') {
      var link = thread.querySelector('a[data-pp-canvas-link]');
      if (link && !e.target.closest('a')) link.click();
      return;
    }
    if (id !== '__draft' && id !== state.focusedId && !e.target.closest('textarea')) railApi.focusThread(id, { scroll: false, reveal: true });
  });

  rail.addEventListener('keydown', function (e) {
    // 编辑第一句：⌘/Ctrl+Enter 保存，Esc 取消恢复原文；单独 Enter 是换行。
    var editing = e.target.closest && e.target.closest('textarea[data-edit], .pp-body.pp-edit');
    if (editing) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        edit.finishEdit();
      } else if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        edit.cancelEdit();
      }
      return;
    }
    var area = e.target.closest && e.target.closest('textarea[data-reply]');
    if (!area) return;
    // Enter 发送，Shift+Enter 换行；输入法组字中的 Enter 留给输入法（isSendKey）。
    if (isSendKey(e)) {
      e.preventDefault();
      var id = area.getAttribute('data-reply');
      if (id === '__draft') actions.sendDraft();
      else actions.sendReply(id);
    }
  });
}
