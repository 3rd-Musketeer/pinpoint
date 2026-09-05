// 底部横条（2026-09-04 外壳重设计，评审板 G1）—— 收纳的唯一去处，挂 #wbstrip。
// 顶部什么都不放；屏幕上只剩画布、左栏玻璃面板和这一条。从左到右一条读下来：
//   在哪一页（Pages 开关 + 页名 + 类型标）
//   → 在哪一帧（‹ 1 / 6 › + map）→ 画布怎么看（缩放 · 回中 · 导出）——这两段是
//     <CanvasHud/>，DOM id / 布线契约与右下 HUD 时期逐一相同
//   → 在干什么（交互｜标注 两段 + 计数）。
// 两处退役在这里合流：画布两缘的展开浮钮（StageRails）与右栏常驻标注工作台——
// 展开左栏的唯一入口是这里的 #wbside-toggle（id 沿用，e2e 选择器即契约），
// 标注列表由 #wbann-count 按需弹出（app/AnnPopover.jsx）。
//
// --wb-strip-w：横条居中且宽度随内容变，弹出列表要贴它的右端、dock 要贴它的
// 左端 —— 量测后写回 :root，两处 CSS 用 calc(50% ∓ var(--wb-strip-w)/2) 对齐。
import { Fragment, useEffect } from 'react';
import { useWorkbenchStore, wbGet, wbSet } from './store.js';
import { annotateApi } from '../ann-bridge.js';
import { toggleSideCollapsed } from '../boot-prefs.js';
import { entriesOfActiveBoard, manifestPages } from '../pages.js';
import { ENTRY_TAG_LABELS, entryTag, resolveEntry } from '../lib/board-entries.js';
import { COMPONENTS_ID } from '../lib/page-url.js';
import { CanvasHud } from './CanvasHud.jsx';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';
import { WbIcon } from './WbIcon.jsx';

// 模式两段（2026-09-04 裁决 7，取代 ADR 0011 的单钮）：槽式分段 —— 灰槽 +
// 选中项凸起。「标注」选中 = 实心 accent（全页唯一实心 on 态，DESIGN 色彩不变），
// 「交互」选中 = 白面（槽式分段的常规选中语言）。
var SEG_ITEM =
  'h-6 cursor-pointer rounded-md border-0 bg-transparent px-2.5 font-sans text-[11.5px] ' +
  'font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 ' +
  'hover:text-foreground';
var SEG_ON_PLAIN = 'bg-card font-semibold text-foreground shadow-[var(--wb-sh-1)]';
var SEG_ON_ACCENT = 'on bg-[var(--wb-accent)] font-semibold text-white shadow-[var(--wb-sh-1)] hover:text-white';

/** 当前页的显示名：重命名优先，Component Library 是内置页不参与重命名。 */
function pageTitle(pageId, pages, names) {
  if (!pageId) return '';
  if (pageId === COMPONENTS_ID) return 'Component Library';
  var custom = names && names[pageId];
  var page = pages.find(function (p) { return p.id === pageId; });
  var fallback = (page && page.title) || pageId;
  return typeof custom === 'string' && custom.trim() ? custom.trim() : fallback;
}

export function Strip() {
  var sideCollapsed = useWorkbenchStore(function (s) { return s.sideCollapsed; });
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var activeEntryId = useWorkbenchStore(function (s) { return s.activeEntryId; });
  var pageNames = useWorkbenchStore(function (s) { return s.pageNames; });
  var snap = useWorkbenchStore(function (s) { return s.annSnap; });
  var listOpen = useWorkbenchStore(function (s) { return s.annListOpen; });
  useWorkbenchStore(function (s) { return s.pageManifest; });   // 订阅重渲染，取值走 manifestPages
  useWorkbenchStore(function (s) { return s.activeBoard; });    // 同上：类型标跟着板走

  // 横条宽度回写（弹出列表与 dock 的对齐锚）：内容变宽（页名长、类型标出现）
  // 与窗口变化都要跟上，所以用 ResizeObserver 而不是一次量测。
  useEffect(function () {
    // 量的是容器 #wbstrip 本体（index.html 静态标记），不是组件里的包装层 ——
    // 组件根若用 display:contents，getBoundingClientRect 恒为 0。
    var el = document.getElementById('wbstrip');
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    function sync() {
      document.documentElement.style.setProperty(
        '--wb-strip-w', Math.round(el.getBoundingClientRect().width) + 'px'
      );
    }
    sync();
    var ro = new ResizeObserver(sync);
    ro.observe(el);
    return function () { ro.disconnect(); };
  }, []);

  var title = pageTitle(activePageId, manifestPages(), pageNames);
  var entry = resolveEntry(entriesOfActiveBoard(), activeEntryId);
  var kindKey = entry ? entryTag(entry) : null;
  var mode = !!(snap && snap.available && snap.mode);
  var count = (snap && snap.count) || 0;

  // 每次点击重新解析 annotate 实例：文档条目要驱动的是 iframe 里那个。
  function setMode(on) {
    if (on === mode) return;
    var a = annotateApi();
    if (a) a.toggle();
  }

  return (
    <Fragment>
      <Button type="button" variant="tool" size="icon" id="wbside-toggle"
        className="wb-side-toggle flex-none"
        aria-label={sideCollapsed ? '展开 Pages 面板' : '收起 Pages 面板'}
        title={sideCollapsed ? '展开 Pages 面板' : '收起 Pages 面板'}
        aria-expanded={sideCollapsed ? 'false' : 'true'} aria-controls="wbside"
        onClick={function () { toggleSideCollapsed({ save: true }); }}>
        <WbIcon name={sideCollapsed ? 'panel-left-open' : 'panel-left-close'} size={16} className="size-4" />
      </Button>
      <span className="wb-strip-title max-w-[220px] truncate text-[13px] font-semibold tracking-[-0.01em]"
        id="wbstrip-title" title={title}>{title}</span>
      {kindKey ? (
        <span className="wb-strip-kind rounded-full bg-[var(--wb-fill)] px-[7px] py-1 font-[var(--wb-font-mono)] text-[10.5px] font-medium leading-none tracking-[0.04em] text-muted-foreground"
          id="wbstrip-kind" data-kind={kindKey}>{ENTRY_TAG_LABELS[kindKey]}</span>
      ) : null}

      {/* 中段（帧导航 + 画布工具），含它自己的前置分隔线 */}
      <CanvasHud />

      <span className="wb-strip-div" aria-hidden="true"></span>
      <div className="wb-strip-modes flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
        id="wbmode" role="group" aria-label="模式">
        <button type="button" id="wbann-interact" data-ann-mode="interact"
          aria-pressed={mode ? 'false' : 'true'} title="交互模式（原型可点，标注让位）"
          className={cn(SEG_ITEM, !mode && SEG_ON_PLAIN)}
          onClick={function () { setMode(false); }}>交互</button>
        {/* id 沿用 #wbann-toggle：它仍然是「把标注模式打开」的那个控件（e2e 契约） */}
        <button type="button" id="wbann-toggle" data-ann-mode="annotate"
          aria-pressed={mode ? 'true' : 'false'} title="标注模式 (A)"
          className={cn(SEG_ITEM, mode && SEG_ON_ACCENT)}
          onClick={function () { setMode(true); }}>
          <span className="wb-tool-label">标注</span>
        </button>
      </div>
      <button type="button" id="wbann-count"
        aria-expanded={listOpen ? 'true' : 'false'} aria-controls="wbann-pop"
        aria-label={'这页的标注 ' + count + ' 条'}
        title={count ? '这页的标注（点击展开列表）' : '这页还没有标注'}
        className={cn(
          'wb-ann-hcount inline-flex h-[18px] min-w-[18px] cursor-pointer items-center justify-center rounded-full border-0 px-[5px]',
          'font-[var(--wb-font-mono)] text-[10.5px] font-semibold leading-none tabular-nums transition-[background-color,color] duration-150',
          count
            ? 'bg-[var(--wb-accent)] text-white'
            : 'bg-[var(--wb-fill)] text-[color:var(--wb-faint)]'
        )}
        onClick={function () { wbSet({ annListOpen: !wbGet().annListOpen }); }}>{count}</button>
    </Fragment>
  );
}
