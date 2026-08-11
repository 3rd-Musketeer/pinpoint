// 标注面板（P1b，goal-20260810-workbench-react-rebuild）— 原 workbench.js 标注
// 面板簇（markSummary/refreshAnnPanel/wireAnnotatePanel/pollAnnotate）的 React 形态。
// 状态源：app/store.js 的 annSnap（ann-bridge 把 annotate 实例状态 + pageMarks
// 汇成的纯数据快照）与 annFilter/activeGroup；行模型在 ann-bridge 里经
// lib/ann-row.js 建好，这里只做筛选/分组/渲染。手动 signature diff 与
// innerHTML 拼装随本组件删除 —— diff 交给 React 协调，转义交给 JSX。
// DOM id / class / 文案与原实现逐一对应（e2e 选择器即契约）。
//
// V2 换皮（goal-20260811-workbench-visual-rebuild）：
//  - #wbann-mode / #wbann-filter 收 ToggleGroup（SEG/SEG_ITEM 配方，app/Seg.jsx）。
//    #wbann-mode 不走 Seg.onPick：旧语义里点已选中的「标注」项会再切回交互
//    （title 即 "标注模式 (A → 交互)"），ToggleGroup 点已选项报 '' 会丢这条路径，
//    故逐项挂 onClick 保持旧语义，group 只做受控视觉。「标注」on 态保留琥珀面
//    （#f5a623 系，标注特性色，与 client .ann-sb-modes 规则同值 —— 双端信号一致）。
//  - 快捷钮组（暂停/评论/通道/Pin）= Button tool variant 竖排（V0 gear 同族）；
//    on 态语义保持（data-state=on → accent 面），'on' class 是 e2e 契约原样保留。
//  - #wbann-clear 用 danger 克制写法（ghost + hover danger 浅面/字，--wb-danger 经桥）。
//  - 行/失效态/空态的共享视觉仍在 lib/ann-list.css（注入端 client 侧栏内联同一份，
//    双端同步机制不动 —— client 侧是否跟联动归 V4 决策）；workbench 侧结构增量
//    （item-row 壳 / 28px 删除钮 / 18px 序号宽 / 空态布局）由 Tailwind 类接管。
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useWorkbenchStore, wbGet, wbSet } from './store.js';
import { annotateApi } from '../ann-bridge.js';
import { getLibraryScrollHandler, setSectionOpen } from '../pages.js';
import { savePrefs } from '../lib/prefs.js';
import { Seg, SEG, SEG_ITEM } from './Seg.jsx';
import { WbIcon } from './WbIcon.jsx';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group.jsx';

var SNAP_OFF = { available: false, rows: [] };

// 快捷钮：tool variant（透明底 + 发丝描边 + hover 白面 + data-state=on accent 面）
// 竖排 44px 高，图标 14px + 10px 标签（旧 .wb-ann-quick button 的等值收编）。
var QUICK_BTN =
  'h-11 min-w-0 flex-col gap-1 rounded-md px-0 text-[10px] font-medium leading-[1.1]';

// 「标注」on 态琥珀面（标注特性色，client 侧栏同规则同值；hover 复合类锁面）。
// 扁平方向（2026-08-11 owner）：on 态只留琥珀面+字色，不挂描边环。
// 注意：tailwind-merge 把 shadow-[var(--wb-sh-1)] 归类为 shadow-color —— 基类先显式
// 摘掉 on 态 shadow（字符串替换），防止它压掉 on 面。
var SEG_ITEM_ANNOTATE = SEG_ITEM.replace(' data-[state=on]:shadow-[var(--wb-sh-1)]', '');
var ANN_ANNOTATE_ON =
  'data-[state=on]:bg-[color-mix(in_srgb,#f5a623_16%,var(--wb-surface))] data-[state=on]:text-[#8a5a00] ' +
  'hover:data-[state=on]:bg-[color-mix(in_srgb,#f5a623_16%,var(--wb-surface))]';

function AnnRow(props) {
  var r = props.row;
  return (
    <div className={cn('wb-ann-item group flex flex-col', r.broken && 'wb-ann-item--broken')} data-ann-n={r.n}>
      <div className="wb-ann-item-row flex w-full items-stretch gap-0.5">
        <button type="button" className="wb-ann-item-main rounded-md" data-ann-n={r.n}
          onClick={function () { props.onGoTo(r.n); }}>
          <span className={cn('wb-ann-num w-[18px]', r.broken && 'opacity-50')}>{r.n}</span>
          <span className="wb-ann-body">
            <span className="wb-ann-cap">{r.cap}</span>
            <span className="wb-ann-text">{r.preview}</span>
            {r.broken ? <span className="wb-ann-broken-tag mt-px inline-block">锚点失效</span> : null}
            {r.tags ? <span className="wb-ann-tags">{r.tags}</span> : null}
          </span>
        </button>
        <Button type="button" variant="ghost" size="icon" data-ann-del={r.n}
          className="wb-ann-del mr-1 self-center rounded-lg text-[16px] font-normal leading-none text-[color:var(--wb-faint)] opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--wb-danger)_10%,transparent)] hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={'删除标注 ' + r.n} title="删除" onClick={props.onDelete(r.n)}>×</Button>
      </div>
    </div>
  );
}

export function AnnPanel() {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; }) || SNAP_OFF;
  var annFilter = useWorkbenchStore(function (s) { return s.annFilter; });
  // tab 过滤才消费 activeGroup；all 模式下 scroll-spy 的 activeGroup 变化不必重渲染
  var activeGroup = useWorkbenchStore(function (s) { return s.annFilter === 'tab' ? s.activeGroup : null; });
  var listRef = useRef(null);

  var rows = snap.rows;

  // 有标注时自动展开 Annotations 段（原 refreshAnnPanel 的行为）
  useEffect(function () {
    if (rows.length && !wbGet().sectionOpen.annotations) {
      setSectionOpen('annotations', true, { save: false });
    }
  }, [rows.length]);

  var filtered = useMemo(function () {
    if (annFilter !== 'tab') return rows;
    return rows.filter(function (r) { return r.group === '_' || r.group === activeGroup; });
  }, [rows, annFilter, activeGroup]);

  var groups = useMemo(function () {
    var out = [];
    var byGroup = {};
    filtered.forEach(function (r) {
      if (!byGroup[r.group]) {
        byGroup[r.group] = { key: r.group, label: r.groupLabel, items: [] };
        out.push(byGroup[r.group]);
      }
      byGroup[r.group].items.push(r);
    });
    return out;
  }, [filtered]);

  // 每次点击重新解析：HTML 板下要驱动的是 iframe 里那个实例，不能闭包捕获
  function onToggle() { var a = annotateApi(); if (a) a.toggle(); }
  function onInteract() { var a = annotateApi(); if (a && a.getState().mode) a.toggle(); }
  function onPause() { var a = annotateApi(); if (a) a.setPaused(!a.getState().paused); }
  function onClear() { var a = annotateApi(); if (a) a.clear(); }
  function onPin() { var a = annotateApi(); if (a) a.setFloatingToolbar(!a.getState().floating); }
  function onComments() {
    var a = annotateApi();
    if (a && typeof a.setRenderComments === 'function') a.setRenderComments(!a.getState().renderComments);
  }
  function onChannel() {
    var a = annotateApi();
    if (!a || typeof a.setBubbleLayout !== 'function') return;
    a.setBubbleLayout((a.getState().bubbleLayout || 'inline') === 'inline' ? 'sidebar' : 'inline');
  }
  function onFilterPick(value) {
    wbSet({ annFilter: value });
    savePrefs({ annFilter: value });
    var spy = getLibraryScrollHandler();
    if (value === 'tab' && spy) spy();
  }
  function onGoTo(n) {
    var a = annotateApi();
    if (!a || typeof a.goToMark !== 'function') return;
    a.goToMark(n).then(function () {
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
  var paused = available && snap.paused;
  var floating = available && snap.floating;
  var renderComments = available && snap.renderComments;
  var layout = snap.bubbleLayout || 'inline';

  var statusText = '';
  if (available && snap.count) {
    var parts = [snap.countLive + ' 条可见'];
    if (snap.countBroken) parts.push(snap.countBroken + ' 锚点失效');
    parts.push('共 ' + snap.count + ' 条');
    statusText = parts.join(' · ');
  }

  return (
    <Fragment>
      <div className="wb-ann-tools flex flex-col gap-2 pb-2.5 pt-0.5" id="wbann-tools">
        <ToggleGroup type="single" spacing={0.5} value={mode ? 'annotate' : 'interact'}
          id="wbann-mode" role="group" aria-label="交互 / 标注模式"
          className={cn(SEG, 'wb-ann-mode w-auto')}>
          <ToggleGroupItem value="interact" id="wbann-interact" data-ann-mode="interact"
            title="交互模式" className={cn(SEG_ITEM, !mode && 'on')} onClick={onInteract}>交互</ToggleGroupItem>
          <ToggleGroupItem value="annotate" id="wbann-toggle" data-ann-mode="annotate"
            title={mode ? '标注模式 (A → 交互)' : '标注模式 (A)'}
            className={cn(SEG_ITEM_ANNOTATE, ANN_ANNOTATE_ON, mode && 'on')} onClick={onToggle}>
            <span className="wb-tool-label">标注</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="wb-ann-quick grid auto-cols-fr grid-flow-col gap-1">
          <Button type="button" variant="tool" id="wbann-pause" title="暂停"
            data-state={paused ? 'on' : undefined}
            className={cn(QUICK_BTN, paused && 'on')} onClick={onPause}>
            <WbIcon name="pause" size={14} className="size-[14px]" />
            <span className="wb-tool-label max-w-full truncate">暂停</span>
          </Button>
          <Button type="button" variant="tool" id="wbann-comments"
            title="在画布渲染评论"
            data-state={renderComments ? 'on' : undefined}
            className={cn(QUICK_BTN, renderComments && 'on')} onClick={onComments}>
            <WbIcon name="message" size={14} className="size-[14px]" />
            <span className="wb-tool-label max-w-full truncate">{renderComments ? '评论✓' : '评论'}</span>
          </Button>
          <Button type="button" variant="tool" id="wbann-channel"
            hidden={!renderComments} title="评论布局：压字 / 留通道"
            data-state={layout === 'sidebar' ? 'on' : undefined}
            className={cn(QUICK_BTN, layout === 'sidebar' && 'on', !renderComments && 'hidden')}
            onClick={onChannel}>
            <WbIcon name="columns" size={14} className="size-[14px]" />
            <span className="wb-tool-label max-w-full truncate">{layout === 'sidebar' ? 'sidebar' : 'inline'}</span>
          </Button>
          <Button type="button" variant="tool" id="wbann-pin" title="Pin 悬浮条"
            data-state={floating ? 'on' : undefined}
            className={cn(QUICK_BTN, floating && 'on')} onClick={onPin}>
            <WbIcon name="pin" size={14} className="size-[14px]" />
            <span className="wb-tool-label max-w-full truncate">Pin</span>
          </Button>
        </div>
        <Button type="button" variant="ghost" id="wbann-clear" title="清空当前页全部标注"
          className="wb-ann-clear h-auto min-h-0 self-center rounded-md px-2.5 py-[3px] text-[11px] font-medium text-[color:var(--wb-faint)] transition-[color,background-color] duration-150 hover:bg-[color-mix(in_srgb,var(--wb-danger)_7%,transparent)] hover:text-destructive"
          onClick={onClear}>清空标注</Button>
      </div>
      <span className="wb-ann-status mb-1.5 block text-[10.5px] leading-[1.35] text-[color:var(--wb-faint)] empty:hidden" id="wbann-status">{statusText}</span>
      <Seg id="wbann-filter" role="group" aria-label="标注筛选" className="wb-ann-filter mb-2 w-auto"
        value={annFilter} dataAttr="data-ann-filter"
        options={[['all', '全部'], ['tab', '当前示例']]}
        onPick={onFilterPick} />
      <div className="wb-ann-list pb-0.5" id="wbann-list" ref={listRef}>
        {groups.length ? groups.map(function (g) {
          return (
            <Fragment key={g.key}>
              {g.label !== '未分组' ? (
                <div className="wb-ann-group px-0.5 pb-1 pt-2.5 text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.04em] text-[color:var(--wb-faint)] first:pt-0.5">
                  {g.label}
                </div>
              ) : null}
              {g.items.map(function (r) {
                return <AnnRow key={r.key} row={r} onGoTo={onGoTo} onDelete={onDelete} />;
              })}
            </Fragment>
          );
        }) : (
          <div className="wb-ann-empty m-0 flex flex-col items-center justify-center gap-1.5">
            <WbIcon name="empty-ann" size={22} className="wb-ann-empty-ico block size-[22px] text-[color:var(--wb-faint)] opacity-75" />
            <p className="wb-ann-empty-title m-0">暂无标注</p>
            <p className="wb-ann-empty-hint max-w-[16em]">切换到「标注」后，在画布上点选或框选元素</p>
          </div>
        )}
      </div>
    </Fragment>
  );
}
