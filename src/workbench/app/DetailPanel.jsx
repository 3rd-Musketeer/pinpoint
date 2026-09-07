// Detail 面板（2026-08-17 选中模型）— 2026-09-04 外壳重设计起住在右下按需浮层槽
// （app/Dock.jsx，与「这页的标注」列表同一块 280 玻璃卡、二选一显示），不再是
// 右栏上段。选中源 = store.focusFrameKey / focusSectionId
// （互斥；画布点选 / frame 树 / 标注卡都写这两个字段）。展示选中 frame/section
// 的引用号、标题与 note；note 编辑走 note-api（GET 拉 revision → PUT 带
// baseRevision，409 保留草稿），保存后 SSE 失效 board 自动回填。
// Frame Note 从画布收编到这里（decisions 2026-08-17）：画布只留图注 + 机身，
// 说明文字的读/写都归本面板；section note 随本面板首次落地（整组共用说明）。
import { useEffect, useMemo, useState } from 'react';
import { useWorkbenchStore, wbSet } from './store.js';
import { queryClient } from './query-client.js';
import { boardRefs } from '../lib/board-refs.js';
import { canvasBoard } from '../lib/board-entries.js';
import { COMPONENTS_ID } from '../lib/page-url.js';
import { fetchNote, frameNoteUrl, saveNote, sectionNoteUrl } from '../lib/note-api.js';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';

function noteTargetUrl(target, pageId) {
  return target.kind === 'frame'
    ? frameNoteUrl(pageId, target.screenId)
    : sectionNoteUrl(pageId, target.sectionId);
}

function noteQueryKey(target, pageId) {
  return target.kind === 'frame'
    ? ['frame-note', pageId, target.screenId]
    : ['section-note', pageId, target.sectionId];
}

function NoteCard(props) {
  var target = props.target;
  var pageId = props.pageId;
  // savedNote = 保存成功后的本地展示值；board 经 SSE 重载回填（target.note 变化）
  // 后override 清除，展示回到 board 派生值 —— 两个来源不会互相覆盖。
  var [savedNote, setSavedNote] = useState(null);
  var [editing, setEditing] = useState(false);
  var [draft, setDraft] = useState('');
  var [revision, setRevision] = useState('');
  var [busy, setBusy] = useState(false);
  var [status, setStatus] = useState('');
  var [statusError, setStatusError] = useState(false);

  useEffect(function () {
    setSavedNote(null);
  }, [target.note]);

  var liveNote = savedNote != null ? savedNote : target.note;

  function openEditor() {
    setBusy(true);
    setStatus('');
    setStatusError(false);
    queryClient.fetchQuery({
      queryKey: noteQueryKey(target, pageId),
      queryFn: function () { return fetchNote(noteTargetUrl(target, pageId)); }
    }).then(function (data) {
      setRevision(data.revision);
      setDraft(data.note || '');
      setEditing(true);
      setStatus('⌘/Ctrl + Enter 保存');
    }).catch(function (error) {
      setStatus(error.message);
      setStatusError(true);
    }).finally(function () {
      setBusy(false);
    });
  }

  function closeEditor() {
    setEditing(false);
    setDraft('');
    setRevision('');
    setStatus('');
    setStatusError(false);
  }

  function save() {
    if (!revision) return;
    setBusy(true);
    setStatus('正在保存…');
    setStatusError(false);
    saveNote(noteTargetUrl(target, pageId), draft, revision).then(function (data) {
      queryClient.setQueryData(noteQueryKey(target, pageId), data);
      setSavedNote(data.note || '');
      closeEditor();
    }).catch(function (error) {
      setStatus(error.status === 409
        ? 'board.json 已被修改；请保留当前文字，取消后重新打开再保存。'
        : error.message);
      setStatusError(true);
    }).finally(function () {
      setBusy(false);
    });
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeEditor();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  }

  if (target.kind === 'frame') {
    return liveNote ? <div className="wb-detail-note" data-detail-note><div className="wb-detail-note-text" data-detail-note-text>{liveNote}</div></div> : null;
  }

  return (
    <div className="wb-detail-note" data-detail-note>
      {editing ? (
        <div className="wb-detail-note-editor flex flex-col gap-[9px]">
          <textarea
            className="wb-note-input"
            data-detail-note-input
            maxLength={12000}
            aria-label="说明"
            value={draft}
            disabled={busy}
            autoFocus
            onChange={function (event) { setDraft(event.target.value); }}
            onKeyDown={onKeyDown}
          />
          <div className="flex items-center gap-1.5">
            <span className={cn('wb-note-status', statusError && 'is-error')} data-detail-note-status>{status}</span>
            <button type="button" className="wb-note-action" data-detail-note-cancel disabled={busy} onClick={closeEditor}>取消</button>
            <button type="button" className="wb-note-action wb-note-action--save" data-detail-note-save disabled={busy} onClick={save}>保存</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2.5">
          <div className={cn('wb-detail-note-text', !liveNote && 'wb-detail-note-placeholder')} data-detail-note-text>
            {liveNote || '添加场景、交互或能力说明。'}
          </div>
          <button type="button" className="wb-note-action" data-detail-note-edit disabled={busy} onClick={openEditor}>
            {liveNote ? '编辑' : '＋ 说明'}
          </button>
        </div>
      )}
    </div>
  );
}

/** 选中对象（frame / section）的派生视图 —— Dock 用它决定这个槽给谁。 */
export function useDetailTarget() {
  var focusFrameKey = useWorkbenchStore(function (s) { return s.focusFrameKey; });
  var focusSectionId = useWorkbenchStore(function (s) { return s.focusSectionId; });
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var active = useWorkbenchStore(function (s) { return s.activeBoard; });

  // 引用号/标题/note 全部从画布视图纯派生（与 AnnPopover 的 boardMeta 同写法）；
  // 板切换途中 activeBoard 可能还停在上一页 —— 不匹配就不展示。
  var target = useMemo(function () {
    if (!active || active.pageId !== activePageId) return null;
    var board = canvasBoard(active.board);
    var refs = boardRefs(board);
    if (focusFrameKey) {
      var parts = focusFrameKey.split('\0');
      for (var i = 0; i < board.sections.length; i++) {
        var sec = board.sections[i];
        if (sec.id !== parts[0]) continue;
        var screen = (sec.screens || []).find(function (sc) { return sc.id === parts[1]; });
        if (!screen) return null;
        return {
          kind: 'frame',
          sectionId: sec.id,
          screenId: screen.id,
          ref: refs.byFrame[focusFrameKey] || '',
          title: screen.title || screen.id,
          note: screen.note || ''
        };
      }
      return null;
    }
    if (focusSectionId) {
      for (var j = 0; j < board.sections.length; j++) {
        var section = board.sections[j];
        if (section.id !== focusSectionId) continue;
        return {
          kind: 'section',
          sectionId: section.id,
          ref: refs.bySection[section.id] || '',
          title: section.title || section.id,
          note: section.note || ''
        };
      }
      return null;
    }
    return null;
  }, [active, activePageId, focusFrameKey, focusSectionId]);

  return target;
}

export function DetailPanel(props) {
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var target = props.target;

  if (!target) return null;

  return (
    <div className="wb-detail flex min-h-0 flex-col gap-1.5 overflow-y-auto px-[11px] py-2.5" id="wbdetail" data-detail-kind={target.kind}>
      <div className="flex items-center gap-2">
        <span className="wb-detail-ref inline-flex min-w-[18px] flex-none items-center justify-center rounded-[5px] bg-[color-mix(in_srgb,var(--wb-accent)_12%,var(--wb-surface))] px-1 font-[var(--wb-font-mono)] text-[10px] font-bold leading-[18px] tabular-nums text-[var(--wb-accent)]">
          {target.ref || '—'}
        </span>
        <b className="min-w-0 flex-1 truncate text-[12.5px] font-bold leading-none" title={target.title} data-detail-title>{target.title}</b>
        <Button type="button" variant="tool" size="icon"
          className="wb-detail-close ml-auto flex-none text-[14px] font-normal leading-none"
          aria-label="取消选中" title="取消选中"
          onClick={function () { wbSet({ focusFrameKey: null, focusSectionId: null, focusAnnN: null }); }}>
          ×
        </Button>
      </div>
      {activePageId === COMPONENTS_ID ? null : (
        <NoteCard
          key={target.kind + ':' + target.sectionId + ':' + (target.screenId || '')}
          target={target}
          pageId={activePageId}
        />
      )}
    </div>
  );
}
