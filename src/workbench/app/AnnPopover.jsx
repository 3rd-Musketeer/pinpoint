// 「这页的标注」弹出列表（2026-09-04 评审板 H2）—— 取代 2026-08-15 起的常驻右栏
// 标注工作台（app/AnnPanel.jsx，本刀删除）。owner 的话是判据：「大部分时候只需要
// 看画布上的标注气泡」「只有当我要浏览『这页还剩什么』时才需要打开列表」——
// 所以列表不常驻：点横条右端的计数钮（#wbann-count）开，再点或 Esc 关。
//
// 结构照 H2：头「这页的标注」+ 总数 + 「···」溢出（清空标注收在里面，两段确认
// 沿用 08-14 的 armed 红字 3s）；行 = 序号钉 → 引用号 10.5 mono → 正文一行截断，
// hover 出「定位」。分组 eyebrow 随右栏一起退役 —— 引用号已经在每一行上。
//
// 数据与逻辑整段沿用旧右栏：状态源 = app/store.js 的 annSnap（ann-bridge 汇总的
// 纯数据快照），行模型走共享 src/shared/ann-row.js，引用号 / 屏名从 activeBoard
// 纯派生（lib/board-refs.js）。定位仍走 client 的 goToMark（页面切换 + frame
// 聚焦 + 锚点 flash 都在那条既有链路里）。
//
// owner 在评审板上的第二条批注（列表不能盖住被定位的气泡）两头落实：
//  · 高亮气泡的层级在列表之上 —— #ann-overlay 在「有钉子被聚焦 / 悬停卡在显示」
//    时升到列表之上（规则在 client/annotate.js 的 :has 选择器，见那里的注释）；
//  · 「定位」时把列表挡住的那块从可用区里减掉 —— board-nav 的 chromeInsets 之外，
//    goToMark 之后再补一次 nudgeAwayFromPopover：目标若落在列表矩形里就横向让开。
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useWorkbenchStore, wbSet } from './store.js';
import { annotateApi } from '../ann-bridge.js';
import { boardRefs } from '../lib/board-refs.js';
import { canvasBoard } from '../lib/board-entries.js';
import { WbIcon } from './WbIcon.jsx';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';

var SNAP_OFF = { available: false, rows: [] };

// 画布批注三态（decisions 08-14）：右栏底栏退役后收进「···」溢出 —— 值 ↔ client
// 状态映射不变。off = 不渲染评论卡；inline = 卡跟着钉子（2026-09-04 起 hover 才
// 出，是默认档）；chan = 右侧通道（文档形态：iframe 收窄、卡在父级 gutter 里）。
var BUBBLE_MODES = [
  ['off', '隐藏批注'],
  ['inline', '叠在页面'],
  ['chan', '右侧通道']
];

/* 定位后的让位（owner 批注 2）：列表锚在右下角，被定位的气泡如果正好落在它
   后面，人就看不见自己刚定位到的东西。goToMark 把 frame 摆好之后，量一次列表
   矩形与目标 frame 矩形，重叠就把画布横向推开，让目标落到列表左边。 */
function nudgeAwayFromPopover() {
  var stage = document.getElementById('wbstage');
  var pop = document.getElementById('wbann-pop');
  if (!stage || !pop) return;
  var popRect = pop.getBoundingClientRect();
  var focused = document.querySelector('#wb-board-panel .wb-frame-flash, #wb-board-panel .wb-sel');
  if (!focused) return;
  var r = focused.getBoundingClientRect();
  var gap = 16;
  var overlapX = r.right - (popRect.left - gap);
  var overlapY = r.bottom - popRect.top;
  if (overlapX <= 0 || overlapY <= 0) return;   // 不在列表那一块里，不用动
  // 目标比可用区还宽时推到底就够了（clamp 交给 scrollLeft 自身的边界）。
  stage.scrollTo({ left: stage.scrollLeft + overlapX, top: stage.scrollTop, behavior: 'smooth' });
}

function AnnRow(props) {
  var r = props.row;
  return (
    <div className={cn('wb-ann-item group flex flex-col', r.broken && 'wb-ann-item--broken', props.on && 'wb-ann-item--on')} data-ann-n={r.n}>
      <div className="wb-ann-item-row flex w-full items-stretch gap-0.5">
        <button type="button" className="wb-ann-item-main rounded-md" data-ann-n={r.n}
          onClick={function () { props.onGoTo(r.n); }}>
          <span className={cn('wb-ann-num', r.broken && 'opacity-80')}>{r.n}</span>
          <span className="wb-ann-body">
            <span className="wb-ann-cap">{r.cap}</span>
            <span className="wb-ann-text">{r.preview}</span>
            {r.tags ? <span className="wb-ann-tags">{r.tags}</span> : null}
          </span>
        </button>
        <button type="button" className="wb-ann-go" data-ann-go={r.n}
          title={'定位到标注 ' + r.n} aria-label={'定位到标注 ' + r.n}
          onClick={function () { props.onGoTo(r.n); }}>定位</button>
      </div>
    </div>
  );
}

export function AnnPopover() {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; }) || SNAP_OFF;
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var active = useWorkbenchStore(function (s) { return s.activeBoard; });
  var focusAnnN = useWorkbenchStore(function (s) { return s.focusAnnN; });
  var listRef = useRef(null);
  var [clearArmed, setClearArmed] = useState(false);
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

  function onClear() {
    // 两段确认（decisions 08-14）：首击 armed 红字 3s，再击才执行
    if (!clearArmed) {
      setClearArmed(true);
      clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(function () { setClearArmed(false); }, 3000);
      return;
    }
    clearTimeout(clearTimer.current);
    setClearArmed(false);
    var a = annotateApi(); if (a) a.clear();
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
    // 与 frame 树行的焦点双向同步（decisions 08-15c）：定位走 client goToMark，
    // 这里只回写选中态，再补一次「别被列表挡住」的让位。
    var row = rows.find(function (r) { return r.n === n; });
    a.goToMark(n).then(function () {
      wbSet({
        focusAnnN: n,
        focusFrameKey: row && row.screenId ? row.group + '\0' + row.screenId : null,
        focusSectionId: null
      });
      var item = listRef.current && listRef.current.querySelector('.wb-ann-item[data-ann-n="' + n + '"]');
      if (item) item.scrollIntoView({ block: 'nearest' });
      requestAnimationFrame(nudgeAwayFromPopover);
    });
  }

  var renderComments = snap.available && snap.renderComments;
  var bubbleMode = !renderComments ? 'off' : (snap.bubbleLayout === 'sidebar' ? 'chan' : 'inline');
  var bubbleLabel = (BUBBLE_MODES.find(function (m) { return m[0] === bubbleMode; }) || BUBBLE_MODES[0])[1];

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
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <Button type="button" variant="tool" size="icon" id="wbann-more"
                aria-label="更多标注操作" title="更多">
                <WbIcon name="ellipsis" size={14} className="size-3.5" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content asChild align="end" sideOffset={4}>
              <div className="wb-ann-more-menu z-50 min-w-[148px] rounded-lg bg-card p-1 shadow-[var(--wb-sh-3)]">
                {/* 画布批注三态：文案单独一行 + 当前值，右侧通道只对文档形态有意义 */}
                <div className="px-2 pb-1 pt-1.5 font-[var(--wb-font-mono)] text-[9px] font-semibold uppercase tracking-[0.1em] text-[color:var(--wb-faint)]"
                  id="wbann-bubble" data-bubble-mode={bubbleMode}>
                  画布批注<span className="ms-1 normal-case text-[var(--wb-accent)]" id="wbann-bubble-v">{bubbleLabel}</span>
                </div>
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
                <DropdownMenu.Item asChild onSelect={function (e) { e.preventDefault(); onClear(); }}>
                  <button type="button" id="wbann-clear" title="清空当前页全部标注"
                    className={cn(
                      'wb-ann-clear flex w-full cursor-pointer items-center gap-[7px] rounded-md border-0 bg-transparent px-2 py-[6px] text-left font-sans text-[12px] font-medium transition-colors duration-150',
                      clearArmed
                        ? 'bg-[color-mix(in_srgb,var(--wb-danger)_8%,transparent)] font-semibold text-destructive'
                        : 'text-foreground hover:bg-[color-mix(in_srgb,var(--wb-danger)_7%,transparent)] hover:text-destructive'
                    )}>
                    <WbIcon name="trash" size={13} className="size-[13px]" />
                    {clearArmed ? '确认清空' : '清空标注'}
                  </button>
                </DropdownMenu.Item>
              </div>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        ) : null}
      </div>

      <div className="wb-ann-list flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-[7px] pb-2" id="wbann-list" ref={listRef}>
        {items.length ? items.map(function (r) {
          return <AnnRow key={r.key} row={r} on={focusAnnN === r.n} onGoTo={onGoTo} />;
        }) : (
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
