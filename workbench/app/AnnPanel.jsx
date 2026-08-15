// 标注面板 — 2026-08-15 起 = 独立右栏「标注工作台」（decisions 08-14 左右分工），
// 挂 #wbann-side（app/main.jsx 单独 root），不再是左栏 Annotations 段。
// 结构照体验板 mock（previews/sidebar-variants/sidebar.html 的 .sb-r）：
//   head（「标注」+ 计数钉 #wbann-count + 收起钮 #wbann-side-toggle）
//   → meta（status 行 #wbann-status + 「清空标注」两段确认 #wbann-clear，armed 红字 3s）
//   → 卡片列表 #wbann-list（按 frame 分组，eyebrow 组头 = 引用号 + 屏名）
//   → 底栏（模式单钮 #wbann-toggle「标注中/交互」点按切换 + 画布批注 dropdown
//     #wbann-bubble 三态：隐藏批注 / 叠在页面 / 右侧通道）。
// 移除项（decisions 08-14 逐条核准）：暂停、Pin、通道钮（并入批注 dropdown）、
// 全部/当前筛选（annFilter 机制同删）、设置常驻格（进左栏齿轮）。
// 锚点失效 = 整卡红描边 + 红浅面 + 文本退灰 + 序号钉转红，不用 tag（08-14）。
// 状态源：app/store.js 的 annSnap（ann-bridge 汇总的纯数据快照）；行模型仍走
// 共享 lib/ann-row.js；引用号/屏名从 activeBoard 纯派生（lib/board-refs.js）。
// 卡片皮肤（白卡 + accent 淡描边 + r-3）叠在 index.html 的 #wbann-list 规则 —
// 共享行视觉留在 lib/ann-list.css（client 侧栏 / 扩展 panel 消费端不动）。
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useWorkbenchStore, wbSet } from './store.js';
import { annotateApi } from '../ann-bridge.js';
import { toggleAnnPanelCollapsed } from '../boot-prefs.js';
import { boardRefs } from '../lib/board-refs.js';
import { WbIcon } from './WbIcon.jsx';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';

var SNAP_OFF = { available: false, rows: [] };

// 画布批注三态（decisions 08-14）：值 ↔ client 状态映射
// off = 不渲染评论；inline = 叠在页面；chan = 右侧通道（client 侧叫 sidebar）
var BUBBLE_MODES = [
  ['off', '隐藏批注'],
  ['inline', '叠在页面'],
  ['chan', '右侧通道']
];

function AnnRow(props) {
  var r = props.row;
  return (
    <div className={cn('wb-ann-item group flex flex-col', r.broken && 'wb-ann-item--broken', props.on && 'wb-ann-item--on')} data-ann-n={r.n}>
      <div className="wb-ann-item-row flex w-full items-stretch gap-0.5">
        <button type="button" className="wb-ann-item-main rounded-md" data-ann-n={r.n}
          onClick={function () { props.onGoTo(r.n); }}>
          <span className={cn('wb-ann-num w-[18px]', r.broken && 'opacity-50')}>{r.n}</span>
          <span className="wb-ann-body">
            <span className="wb-ann-cap">{r.cap}</span>
            <span className="wb-ann-text">{r.preview}</span>
            {r.tags ? <span className="wb-ann-tags">{r.tags}</span> : null}
          </span>
        </button>
        <Button type="button" variant="ghost" size="icon" data-ann-del={r.n}
          className="wb-ann-del size-5 rounded-lg text-[16px] font-normal leading-none text-[color:var(--wb-faint)] opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--wb-danger)_10%,transparent)] hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={'删除标注 ' + r.n} title="删除" onClick={props.onDelete(r.n)}>×</Button>
      </div>
    </div>
  );
}

export function AnnPanel() {
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

  // 引用号 / 屏名 / 组序全部从 board 顺序纯派生（lib/board-refs.js）；板切换
  // 途中 activeBoard 可能还停在上一页 —— 不匹配就退回行自带的分组标签。
  var boardMeta = useMemo(function () {
    var out = { frames: {}, sections: {} };
    if (!active || active.pageId !== activePageId) return out;
    var refs = boardRefs(active.board);
    refs.outline.forEach(function (sec, si) {
      out.sections[sec.id] = { letter: sec.letter, order: si };
      sec.frames.forEach(function (f, fi) {
        out.frames[sec.id + '\0' + f.id] = { ref: f.ref, title: f.title, order: si * 1000 + fi };
      });
    });
    return out;
  }, [active, activePageId]);

  // 分组（mock：按 frame，eyebrow = 引用号 + 屏名）；无 screenId 的行（框选 /
  // doc 板标注）退回 section 组（可派生时带 section 字母），'_' 组头保持隐藏。
  // cap 行 = 引用号 + 元素路径（mock .acap：'A2 / 错误提示'）。
  var groups = useMemo(function () {
    var out = [];
    var byKey = {};
    rows.forEach(function (r) {
      var meta = r.screenId ? boardMeta.frames[r.group + '\0' + r.screenId] : null;
      var key = r.screenId ? 'f:' + r.group + ' ' + r.screenId : 's:' + r.group;
      if (!byKey[key]) {
        var sec = boardMeta.sections[r.group];
        byKey[key] = {
          key: key,
          order: meta ? meta.order : (sec ? 5000 + sec.order : 9000 + out.length),
          label: meta ? (meta.ref + ' ' + meta.title)
            : r.group === '_' ? '未分组'
            : (sec ? sec.letter + ' ' : '') + r.groupLabel,
          items: []
        };
        out.push(byKey[key]);
      }
      byKey[key].items.push(meta ? Object.assign({}, r, { cap: meta.ref + ' / ' + r.cap }) : r);
    });
    out.sort(function (a, b) { return a.order - b.order; });
    return out;
  }, [rows, boardMeta]);

  // 每次点击重新解析：HTML 板下要驱动的是 iframe 里那个实例，不能闭包捕获
  function onToggle() { var a = annotateApi(); if (a) a.toggle(); }
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
    // 与大纲行的焦点双向同步（decisions 08-15c）：定位走 client goToMark
    // （页面切换 + frame 聚焦 + 锚点 flash 都在那条既有链路里），这里只回写选中态
    var row = rows.find(function (r) { return r.n === n; });
    a.goToMark(n).then(function () {
      wbSet({
        focusAnnN: n,
        focusFrameKey: row && row.screenId ? row.group + '\0' + row.screenId : null
      });
      var item = listRef.current && listRef.current.querySelector('.wb-ann-item[data-ann-n="' + n + '"]');
      if (item) item.scrollIntoView({ block: 'nearest' });
    });
  }
  function onDelete(n) {
    return function (e) {
      e.preventDefault();
      e.stopPropagation();
      var a = annotateApi();
      if (a && a.removeMark) a.removeMark(n);
    };
  }

  var available = !!snap.available;
  var mode = available && snap.mode;
  var renderComments = available && snap.renderComments;
  var layout = snap.bubbleLayout || 'inline';
  var bubbleMode = !renderComments ? 'off' : (layout === 'sidebar' ? 'chan' : 'inline');
  var bubbleLabel = (BUBBLE_MODES.find(function (m) { return m[0] === bubbleMode; }) || BUBBLE_MODES[0])[1];

  var statusText = '';
  if (available && snap.count) {
    statusText = '共 ' + snap.count + ' 条' + (snap.countBroken ? '，' + snap.countBroken + ' 锚点失效' : '');
  }

  return (
    <Fragment>
      <div className="wb-ann-head flex flex-none items-center gap-2 border-b border-[color:color-mix(in_srgb,var(--wb-accent)_16%,transparent)] px-[var(--wb-pad)] pb-2 pt-2.5">
        <b className="flex-none text-[12.5px] font-bold leading-none">标注</b>
        <span id="wbann-count"
          className={cn(
            'wb-ann-hcount inline-flex min-w-[18px] items-center justify-center rounded-[5px] px-1 font-[var(--wb-font-mono)] text-[10px] font-bold leading-[18px] tabular-nums',
            'bg-[color-mix(in_srgb,var(--wb-accent)_12%,var(--wb-surface))] text-[var(--wb-accent)]',
            !snap.count && 'invisible'
          )}>{snap.count || 0}</span>
        <Button type="button" variant="tool" size="icon" id="wbann-side-toggle"
          className="wb-ann-side-toggle ml-auto flex-none"
          aria-label="收起标注面板" title="收起标注面板" aria-expanded="true"
          onClick={function () { toggleAnnPanelCollapsed({ save: true }); }}>
          <WbIcon name="panel-right-close" size={16} className="size-4" />
        </Button>
      </div>

      <div className="wb-ann-meta flex flex-none items-center gap-2 px-[var(--wb-pad)] pb-1.5 pt-2">
        {/* status 恒占 flex-1（空文本也占位）——清空钮钉在右侧（mock .meta 行） */}
        <p className="wb-ann-status m-0 min-w-0 flex-1 text-[10.5px] leading-[1.35] tabular-nums text-[color:var(--wb-faint)]" id="wbann-status" aria-live="polite">{statusText}</p>
        <button type="button" id="wbann-clear" title="清空当前页全部标注"
          className={cn(
            'wb-ann-clear flex-none cursor-pointer rounded-md border-0 bg-transparent px-2 py-[3px] font-sans text-[11px] font-medium transition-[color,background-color] duration-150',
            clearArmed
              ? 'bg-[color-mix(in_srgb,var(--wb-danger)_8%,var(--wb-surface))] font-semibold text-destructive'
              : 'text-[color:var(--wb-faint)] hover:bg-[color-mix(in_srgb,var(--wb-danger)_7%,transparent)] hover:text-destructive'
          )}
          onClick={onClear}>{clearArmed ? '确认清空' : '清空标注'}</button>
      </div>

      <div className="wb-ann-list flex min-h-0 flex-1 flex-col overflow-y-auto px-[var(--wb-pad)] pb-2.5 pt-0.5" id="wbann-list" ref={listRef}>
        {groups.length ? groups.map(function (g) {
          return (
            <Fragment key={g.key}>
              {g.label !== '未分组' ? (
                <div className="wb-ann-group px-0.5 pb-1 pt-2.5 font-[var(--wb-font-mono)] text-[9.5px] font-semibold uppercase leading-[1.2] tracking-[0.12em] text-[color:color-mix(in_srgb,var(--wb-accent)_45%,var(--wb-faint))] first:pt-0.5">
                  {g.label}
                </div>
              ) : null}
              {g.items.map(function (r) {
                return <AnnRow key={r.key} row={r} on={focusAnnN === r.n} onGoTo={onGoTo} onDelete={onDelete} />;
              })}
            </Fragment>
          );
        }) : (
          <div className="wb-ann-empty m-auto flex flex-col items-center justify-center gap-1.5">
            <WbIcon name="empty-ann" size={22} className="wb-ann-empty-ico block size-[22px] text-[color:var(--wb-faint)] opacity-75" />
            <p className="wb-ann-empty-title m-0">暂无标注</p>
            <p className="wb-ann-empty-hint max-w-[16em]">切换到「标注」后，在画布上点选或框选元素</p>
          </div>
        )}
      </div>

      <div className="wb-ann-foot flex flex-none flex-col gap-1.5 border-t border-[color:color-mix(in_srgb,var(--wb-accent)_16%,transparent)] px-[var(--wb-pad)] pb-2.5 pt-2">
        <button type="button" id="wbann-toggle" data-ann-mode="annotate"
          title={mode ? '标注模式 (A → 交互)' : '标注模式 (A)'}
          aria-pressed={mode ? 'true' : 'false'}
          className={cn(
            'wb-ann-modebtn w-full cursor-pointer rounded-[8px] border-0 px-2 py-[7px] text-center font-sans text-[11.5px] font-semibold transition-[background-color,color,box-shadow] duration-150',
            // 标注中 = 实心 accent（全页唯一实心 on 态，decisions 08-14）；交互 = 浅面
            mode
              ? 'on bg-[var(--wb-accent)] text-white shadow-[0_1px_3px_color-mix(in_srgb,var(--wb-accent)_40%,transparent)]'
              : 'bg-[color-mix(in_srgb,var(--wb-accent)_7%,#f4f6f8)] text-[color:color-mix(in_srgb,var(--wb-accent)_55%,#6b7f9c)] hover:bg-[color-mix(in_srgb,var(--wb-accent)_10%,#f0f3f6)]'
          )}
          onClick={onToggle}>
          <span className="wb-tool-label">{mode ? '标注中' : '交互'}</span>
        </button>
        <div className="wb-ann-bubble-dd relative">
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button type="button" id="wbann-bubble" title="画布批注显示方式"
              className="wb-ann-bubble-btn flex w-full cursor-pointer items-center gap-[7px] rounded-md border-0 bg-transparent px-2 py-[6px] text-left font-sans text-[11.5px] font-medium text-[color:color-mix(in_srgb,var(--wb-accent)_65%,#54687f)] transition-[color,background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--wb-accent)_5%,var(--wb-surface))]">
              <WbIcon name="message" size={13} className="size-[13px] flex-none" />
              画布批注
              <span className="wb-ann-bubble-v ml-auto text-[11px] font-semibold text-[var(--wb-accent)]" id="wbann-bubble-v">{bubbleLabel}</span>
              <WbIcon name="chevron-up" size={10} className="size-2.5 flex-none opacity-60" />
            </button>
          </DropdownMenu.Trigger>
          {/* 与 frame ⋯ 菜单同例：popper 包装层已被 index.html 全局置惰（.wb-library
              是 transform:scale 空间，JS 量测定位在缩放 ≠1 必错位）——菜单位置由
              自己的绝对定位拥有（底栏向上开）。 */}
          <DropdownMenu.Content asChild>
            <span role="menu" tabIndex={-1}
              className="wb-ann-bubble-menu absolute bottom-[calc(100%+4px)] left-0 right-0 z-50 box-border flex flex-col rounded-lg border border-[color:color-mix(in_srgb,var(--wb-accent)_20%,transparent)] bg-card p-1 shadow-[0_6px_24px_color-mix(in_srgb,var(--wb-accent)_20%,transparent)]">
              {BUBBLE_MODES.map(function (m) {
                var sel = bubbleMode === m[0];
                return (
                  <DropdownMenu.Item asChild key={m[0]} onSelect={function () { onBubblePick(m[0]); }}>
                    <button type="button" role="menuitem" data-bubble={m[0]}
                      id={'wbann-bubble-' + m[0]}
                      className={cn(
                        'flex cursor-pointer items-center gap-[7px] rounded-[5px] border-0 bg-transparent px-2 py-[6px] text-left font-sans text-[11.5px] font-medium text-foreground transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--wb-accent)_6%,var(--wb-surface))]',
                        sel && 'font-semibold text-[var(--wb-accent)]'
                      )}>
                      <span className="w-3 flex-none text-center text-[11px] text-[var(--wb-accent)]" aria-hidden="true">{sel ? '✓' : ''}</span>
                      {m[1]}
                    </button>
                  </DropdownMenu.Item>
                );
              })}
            </span>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        </div>
      </div>
    </Fragment>
  );
}
