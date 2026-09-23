import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useWorkbenchStore, wbSet } from './store.js';
import { annotateApi } from '../ann-bridge.js';
import { boardRefs } from '../lib/board-refs.js';
import { canvasBoard } from '../lib/board-entries.js';
import { NOTE_CARD_W, noteCardPosition } from '../lib/note-card-pos.js';
import { ANN_FILTERS, annFilterCounts, annFilterRows, annStatusLabel } from '../../shared/ann-status.js';
import { WbIcon } from './WbIcon.jsx';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';

// agent 备注 hover 卡的节律 = 评论卡（docs/design.md「钉子与评论卡」）：hover
// 120ms 才出（扫过不闪），离开给 90ms 宽限，指针可以挪到卡上继续读。
var NOTE_SHOW_MS = 120;
var NOTE_HIDE_MS = 90;

/* 卡的皮肤逐项抄 .ann-bubble（src/shared/annotate-bubble.js，H1）：186 宽白面
   --wb-surface + 圆角 --wb-r-3 + 影 --wb-sh-2，11px/1.45 正文，眉标一行 11px
   mono muted。只换层级档：portal 到 body，走 --wb-z-float（tooltip 档）。
   最多 6 行（6 × 1.45em），超出卡内滚动，note 原文不截断。 */
function NoteCard(props) {
  var ref = useRef(null);
  var [pos, setPos] = useState(null);
  // 行里的滚动守卫（cardRef）与这里量测用的 ref 指向同一个节点。
  function setNode(el) {
    ref.current = el;
    if (props.cardRef) props.cardRef.current = el;
  }
  useLayoutEffect(function () {
    var el = ref.current;
    if (!el) return;
    var r = props.anchor.getBoundingClientRect();
    var box = noteCardPosition(r, NOTE_CARD_W, el.offsetHeight, window.innerWidth, window.innerHeight);
    setPos({ left: box.left + 'px', top: box.top + 'px' });
  }, [props.anchor, props.text]);
  return createPortal(
    <div ref={setNode} role="tooltip" id={props.id} data-ann-n={props.n}
      className="wb-ann-note-card fixed z-(--wb-z-float) w-[186px] rounded-[var(--wb-r-3)] bg-[var(--wb-surface)] px-[9px] pt-[7px] pb-[8px] text-[11px] leading-[1.45] text-[var(--wb-fg)] shadow-[var(--wb-sh-2)]"
      style={pos || { visibility: 'hidden', left: 0, top: 0 }}
      onMouseEnter={props.onEnter} onMouseLeave={props.onLeave}>
      <div className="mb-[3px] font-[var(--wb-font-mono)] text-[11px] leading-[1.3] text-[var(--wb-muted)]">agent 备注</div>
      <div className="max-h-[8.7em] overflow-y-auto whitespace-pre-wrap break-words">{props.text}</div>
    </div>,
    document.body
  );
}

var SNAP_OFF = { available: false, rows: [] };

// 画布批注三态（decisions 08-14）：右栏底栏退役后收进「···」溢出 —— 值 ↔ client
// 状态映射不变。off = 不渲染评论卡；inline = 卡跟着钉子（2026-09-04 起 hover 才
// 出，是默认档）；chan = 右侧通道（文档形态：iframe 收窄、卡在父级 gutter 里）。
var BUBBLE_MODES = [
  ['off', '隐藏批注'],
  ['inline', '叠在页面'],
  ['chan', '右侧通道']
];

function AnnRow(props) {
  var r = props.row;
  var rowRef = useRef(null);
  var cardRef = useRef(null);
  var showT = useRef(0);
  var hideT = useRef(0);
  var [noteOpen, setNoteOpen] = useState(false);
  useEffect(function () {
    return function () { clearTimeout(showT.current); clearTimeout(hideT.current); };
  }, []);

  // 卡开着时，任何不在卡里的滚动（列表滚走行、画布滚动）都立刻收卡，
  // 免得 fixed 卡留在原地指着别的行。卡自己 body 的滚动除外（6 行后可滚）。
  useEffect(function () {
    if (!noteOpen) return;
    function onScroll(e) {
      if (cardRef.current && cardRef.current.contains(e.target)) return;
      closeNow();
    }
    window.addEventListener('scroll', onScroll, true);
    return function () { window.removeEventListener('scroll', onScroll, true); };
  }, [noteOpen]);

  function openSoon() {
    if (!r.note) return;
    clearTimeout(hideT.current);
    clearTimeout(showT.current);
    showT.current = setTimeout(function () { setNoteOpen(true); }, NOTE_SHOW_MS);
  }
  // 指针从卡上回到行（宽限期内）：不再重计 120ms。
  function openNow() {
    if (!r.note) return;
    clearTimeout(hideT.current);
    clearTimeout(showT.current);
    setNoteOpen(true);
  }
  function closeSoon() {
    clearTimeout(showT.current);
    clearTimeout(hideT.current);
    hideT.current = setTimeout(function () { setNoteOpen(false); }, NOTE_HIDE_MS);
  }
  function closeNow() {
    clearTimeout(showT.current);
    clearTimeout(hideT.current);
    setNoteOpen(false);
  }

  return (
    <div className={cn('wb-ann-item group flex flex-col', r.broken && 'wb-ann-item--broken', props.on && 'wb-ann-item--on',
      props.dim && 'wb-ann-item--closed')}
      ref={rowRef} data-ann-n={r.n} data-ann-status={r.status || 'open'}
      onMouseEnter={openSoon} onMouseLeave={closeSoon}
      onFocus={openSoon} onBlur={closeSoon}
      aria-describedby={noteOpen ? 'wb-ann-note-card-' + r.n : undefined}>
      <div className="wb-ann-item-row flex w-full items-stretch gap-0.5">
        <button type="button" className="wb-ann-item-main rounded-md" data-ann-n={r.n}
          onClick={function () { props.onGoTo(r.n); }}>
          <span className={cn('wb-ann-num', r.broken && 'opacity-80')}>{r.n}</span>
          <span className="wb-ann-body">
            <span className="wb-ann-cap">{r.cap}</span>
            <span className="wb-ann-text">{r.preview}</span>
            {r.status !== 'open'
              ? <span className="wb-ann-status-tag">{r.status}</span>
              : null}
            {r.tags ? <span className="wb-ann-tags">{r.tags}</span> : null}
          </span>
        </button>
        {/* 状态机（决定 #11）：删除退役，open / check / done 行的收尾动作都是
            「完成」= close，单击即关不二次确认，toast 出「撤销」回关前原态；
            close 行（展开后）给「重新打开」= open。 */}
        {r.status !== 'close' ? (
          <button type="button" className="wb-ann-done" aria-label={'完成 #' + r.n} title={'完成 #' + r.n}
            onClick={function () { var api = annotateApi(); if (api && typeof api.closeAnnotation === 'function') api.closeAnnotation(r.n); }}>
            <WbIcon name="check" size={14} />
          </button>
        ) : (
          <button type="button" className="wb-ann-reopen" aria-label={'重新打开标注 ' + r.n}
            onClick={function () { var api = annotateApi(); if (api && typeof api.reopenAnnotation === 'function') api.reopenAnnotation(r.n); }}>
            重新打开
          </button>
        )}
      </div>
      {noteOpen ? <NoteCard n={r.n} text={r.note} anchor={rowRef.current}
        id={'wb-ann-note-card-' + r.n} cardRef={cardRef}
        onEnter={openNow} onLeave={closeSoon} /> : null}
    </div>
  );
}

export function AnnPopover() {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; }) || SNAP_OFF;
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var active = useWorkbenchStore(function (s) { return s.activeBoard; });
  var focusAnnN = useWorkbenchStore(function (s) { return s.focusAnnN; });
  var listRef = useRef(null);
  var [clearArmed, setClearArmed] = useState(null);
  var clearTimer = useRef(0);

  useEffect(function () {
    return function () { clearTimeout(clearTimer.current); };
  }, []);

  var rows = snap.rows;

  // 引用号 / 屏名全部从画布视图纯派生（lib/board-refs.js over board-entries.js
  // canvasBoard，2026-08-16f 阶段 6：doc 屏不进引用体系）；板切换途中 activeBoard
  // 可能还停在上一页 —— 不匹配就退回行自带的分组标签。
  var boardMeta = useMemo(function () {
    var out = { frames: {}, sections: {} };
    if (!active || active.pageId !== activePageId) return out;
    var refs = boardRefs(canvasBoard(active.board));
    refs.outline.forEach(function (sec, si) {
      out.sections[sec.id] = { letter: sec.letter, order: si };
      sec.frames.forEach(function (f, fi) {
        out.frames[sec.id + '\0' + f.id] = { ref: f.ref, title: f.title, order: si * 1000 + fi };
      });
    });
    return out;
  }, [active, activePageId]);

  /* 行序与 cap（H2）：一行一条，cap = 引用号 + 屏名（板上的「A1 Today」）。
     无 screenId 的行（框选 / doc 板标注）退回 section 字母 + 组名。 */
  var items = useMemo(function () {
    return rows.map(function (r) {
      var meta = r.screenId ? boardMeta.frames[r.group + '\0' + r.screenId] : null;
      var sec = boardMeta.sections[r.group];
      var cap = meta ? (meta.ref + ' ' + meta.title)
        : r.group === '_' ? '未分组'
        : (sec ? sec.letter + ' ' : '') + r.groupLabel;
      return Object.assign({}, r, {
        cap: cap,
        order: meta ? meta.order : (sec ? 5000 + sec.order : 9000)
      });
    }).sort(function (a, b) { return a.order - b.order || a.n - b.n; });
  }, [rows, boardMeta]);

  function onClear(kind) {
    // 两段确认（decisions 08-14）：首击 armed 红字 3s，再击才执行
    if (clearArmed !== kind) {
      setClearArmed(kind);
      clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(function () { setClearArmed(false); }, 3000);
      return;
    }
    clearTimeout(clearTimer.current);
    setClearArmed(false);
    var a = annotateApi(); if (a) { if (kind === 'invalid') a.clearInvalid(); else a.clear(); }
  }

  function onBubblePick(value) {
    var a = annotateApi();
    if (!a) return;
    if (value === 'off') {
      if (typeof a.setRenderComments === 'function') a.setRenderComments(false);
      return;
    }
    if (typeof a.setRenderComments === 'function') a.setRenderComments(true);
    if (typeof a.setBubbleLayout === 'function') a.setBubbleLayout(value === 'chan' ? 'sidebar' : 'inline');
  }

  function onGoTo(n) {
    var a = annotateApi();
    if (!a || typeof a.goToMark !== 'function') return;
    // Client navigation opens the composer; keep the list pinned and mirror its focus.
    var row = rows.find(function (r) { return r.n === n; });
    a.goToMark(n).then(function (completed) {
      if (completed === false) return;
      wbSet({
        focusAnnN: n,
        focusFrameKey: row && row.screenId ? row.group + '\0' + row.screenId : null,
        focusSectionId: null
      });
      var item = listRef.current && listRef.current.querySelector('.wb-ann-item[data-ann-n="' + n + '"]');
      if (item) item.scrollIntoView({ block: 'nearest' });
    });
  }

  var renderComments = snap.available && snap.renderComments;
  var bubbleMode = !renderComments ? 'off' : (snap.bubbleLayout === 'sidebar' ? 'chan' : 'inline');

  // 状态筛选：SSOT 在 annotate 实例里（setStatusFilter 落账本侧 LS，按页保留，
  // iframe 重载 / 切页后 annSnap 把值带回来）。列表与画布钉子吃同一个值。
  var statusFilter = snap.statusFilter || 'all';
  var counts = annFilterCounts(items);
  var visibleItems = annFilterRows(items, statusFilter);
  function onFilterPick(value) {
    var a = annotateApi();
    if (a && typeof a.setStatusFilter === 'function') a.setStatusFilter(value);
  }


  var statusText = '';
  if (snap.available && snap.count) {
    statusText = '共 ' + snap.count + ' 条' + (snap.countBroken ? '，' + snap.countBroken + ' 锚点失效' : '');
  }

  return (
    <Fragment>
      <div className="wb-ann-pop-head flex flex-none items-center gap-2 px-[11px] pb-[7px] pt-2.5">
        <span className="wb-ann-pop-title text-[13px] font-semibold leading-none tracking-[-0.01em]">这页的标注</span>
        <span id="wbann-status" aria-live="polite" title={statusText}
          className="wb-ann-pop-count inline-flex min-w-[17px] items-center justify-center rounded-full bg-[var(--wb-fill)] px-[5px] font-[var(--wb-font-mono)] text-[10.5px] font-semibold leading-[17px] tabular-nums text-muted-foreground">
          {snap.count || 0}
        </span>
        <span className="flex-1"></span>
        {/* 「···」只在有标注时出现 —— 里面唯一的一项是清空，没有标注就没有动作 */}
        {snap.count ? (
          <DropdownMenu.Root modal={false} onOpenChange={function () { setClearArmed(null); }}>
            <DropdownMenu.Trigger asChild>
              <Button type="button" variant="tool" size="icon" id="wbann-more"
                aria-label="更多标注操作" title="更多">
                <WbIcon name="ellipsis" size={14} className="size-3.5" />
              </Button>
            </DropdownMenu.Trigger>
            {/* Portal 到 body 是必须的：这块卡是 .wb-glass（backdrop-filter 给
                position:fixed 的后代造了包含块）+ overflow:hidden，菜单留在卡里
                会被卡的下沿裁掉 —— 卡越短裁得越多，最后一项「清空未关闭标注」首当其冲
                （DOM 断言全绿、人点不到，与 2026-08-17 ScrollArea 同形）。 */}
            <DropdownMenu.Portal>
            <DropdownMenu.Content asChild align="end" sideOffset={4} collisionPadding={12}>
              <div className="wb-ann-more-menu z-(--wb-z-float-2) min-w-[148px] rounded-lg bg-card p-1 shadow-[var(--wb-sh-3)]">
                {BUBBLE_MODES.map(function (m) {
                  var sel = bubbleMode === m[0];
                  return (
                    <DropdownMenu.Item asChild key={m[0]} onSelect={function () { onBubblePick(m[0]); }}>
                      <button type="button" data-bubble={m[0]} id={'wbann-bubble-' + m[0]}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-[7px] rounded-md border-0 bg-transparent px-2 py-[6px] text-left font-sans text-[12px] font-medium text-foreground transition-colors duration-150 hover:bg-accent',
                          sel && 'font-semibold text-[var(--wb-accent)]'
                        )}>
                        <span className="w-3 flex-none text-center text-[11px] text-[var(--wb-accent)]" aria-hidden="true">{sel ? '✓' : ''}</span>
                        {m[1]}
                      </button>
                    </DropdownMenu.Item>
                  );
                })}
                <div className="my-1 h-px bg-[var(--wb-seam)]" role="separator"></div>
                {['all', 'invalid'].map(function (kind) {
                  // 决定 #11：清空不删已关闭（close 是执行历史）—— 计数与可点性
                  // 只看未关闭的行；页内工具条的「清空标记」同一份口径。
                  var count = kind === 'all' ? snap.count - (snap.countClosed || 0) : (snap.countInvalid || 0);
                  var label = kind === 'all' ? '清空未关闭标注' : '清空无效标注';
                  return <DropdownMenu.Item key={kind} asChild disabled={!count} onSelect={function (e) { e.preventDefault(); onClear(kind); }}>
                    <button type="button" id={kind === 'all' ? 'wbann-clear' : 'wbann-clear-invalid'} disabled={!count}
                      className={cn('wb-ann-clear flex w-full cursor-pointer items-center gap-[7px] rounded-md border-0 bg-transparent px-2 py-[6px] text-left font-sans text-[12px] font-medium text-foreground outline-none transition-colors duration-150 hover:bg-accent data-[highlighted]:bg-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent', clearArmed === kind && 'text-destructive')}>
                      <WbIcon name="trash" size={13} />{clearArmed === kind ? '确认' + label + '（' + count + '）' : label}
                    </button>
                  </DropdownMenu.Item>;
                })}
              </div>
            </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : null}
      </div>

      {/* 状态筛选分段（2026-09-23，取代「已关闭 N」折叠段）：全部 · open · check ·
          done · closed，各带计数；0 计数弱化但可点（点了就是空态，见列表主体）。 */}
      {snap.available && items.length ? (
        <div className="mx-[9px] mb-1.5 flex flex-none gap-0.5 rounded-[var(--wb-r-2)] bg-[var(--wb-fill)] p-0.5"
          role="group" aria-label="按状态筛选" id="wbann-filters">
          {ANN_FILTERS.map(function (f) {
            return (
              <button key={f} type="button" data-ann-filter={f} aria-pressed={statusFilter === f}
                onClick={function () { onFilterPick(f); }}
                className={cn(
                  'min-w-0 flex-1 truncate rounded-[4px] px-1 py-[3px] text-[10.5px] font-semibold leading-none tabular-nums transition-colors duration-150',
                  statusFilter === f
                    ? 'bg-[var(--wb-surface)] text-[var(--wb-fg)] shadow-[var(--wb-sh-1)]'
                    : 'text-muted-foreground hover:text-foreground',
                  !counts[f] && 'opacity-45'
                )}>
                {annStatusLabel(f) + ' ' + counts[f]}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="wb-ann-list flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-[7px] pb-2" id="wbann-list" ref={listRef}>
        {items.length ? (
          visibleItems.length ? visibleItems.map(function (r) {
            return <AnnRow key={r.key} row={r} on={focusAnnN === r.n} onGoTo={onGoTo}
              dim={statusFilter === 'all' && r.status === 'close'} />;
          }) : (
            <div className="wb-ann-filter-empty m-auto py-4 text-center text-[11.5px]">
              没有 {annStatusLabel(statusFilter)} 的标注
            </div>
          )
        ) : (
          <div className="wb-ann-empty m-auto flex flex-col items-center justify-center gap-1.5 py-6">
            <WbIcon name="empty-ann" size={22} className="wb-ann-empty-ico block size-[22px] text-[color:var(--wb-faint)] opacity-75" />
            <p className="wb-ann-empty-title m-0">暂无标注</p>
            <p className="wb-ann-empty-hint max-w-[16em]">切换到「标注」后，在画布上点选或框选元素</p>
          </div>
        )}
      </div>
    </Fragment>
  );
}
