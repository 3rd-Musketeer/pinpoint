// 大纲浮层（2026-10-10）：从左栏「大纲」页签挪到页 tab 条。多 tab 页每个 tab 标题旁一个
// 触发钮；不到两个 tab 的画布页不出 tab 条，那一个钮在底部横条里（2026-10-15，Strip.jsx），浮层画整页。
// 文章画布的页面浮层里横条照样有这个钮：点帧 / 节先关页面浮层回画布，再聚焦过去。
// 不用下拉菜单：菜单会拦下 Tab，大纲行是普通按钮，Tab 要能走进去。浮层 Portal 到
// body（条有 overflow-x，玻璃的 backdrop-filter 也会把 fixed 后代收成包含块），
// 从触发钮向上弹，层级 --wb-z-float，皮肤 .wb-glass。同一时刻只开一个。
// 右键菜单门户在浮层外面。点到 [role=menu] 时不关，复制菜单才能把焦点交还行内按钮。
// 点外关闭自己听 document 捕获段（与换 Radix 之前一致）：Radix 的点外在冒泡段，
// 标注钉子在自己的冒泡段 pointerdown 上 stopPropagation，事件到不了 document，
// 大纲开着时点钉子就收不起来。挂载时同步聚焦浮层、Esc 关掉时同步把焦点还给打开前的
// 元素，不用 Radix FocusScope：它的卸载归还排在 setTimeout(0)，Esc 关掉后马上再开，
// 上一个浮层迟到的归还会把焦点从新浮层拽回触发钮（e2e 约 1/10 复现）。
// Esc 归工作台弹层栈（use-layer.js），焦点在输入框里时这一下归输入框。
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, computePosition, offset, shift } from '@floating-ui/dom';
import { useWorkbenchStore, wbGet } from './store.js';
import { activeEntryOf, closePageOverlay, isPageOverlayOpen, setActiveEntry, setActiveTab } from '../pages.js';
import {
  flashBoardFrame,
  focusBoardSection,
  focusWorkbenchFrame,
  selectBoardFrame,
  selectBoardSection
} from '../board-nav.js';
import {
  CANVAS_ENTRY_ID,
  ENTRY_TAG_LABELS,
  contentsModel,
  entryTag,
  isPageOverlayEntry,
  outlineSlice
} from '../lib/board-entries.js';
import { tabIdOfScreen } from '../lib/board-tabs.js';
import { boardRefs } from '../lib/board-refs.js';
import { WbIcon } from './WbIcon.jsx';
import { RowMenu } from './row-menu.jsx';
import { LAYER_RANK, useStackLayer } from './use-layer.js';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';

var ROW_ON =
  'bg-[var(--wb-sel)] font-semibold text-foreground ' +
  'hover:bg-[var(--wb-sel)] hover:text-foreground group-hover:bg-[var(--wb-sel)] group-hover:text-foreground';
var ROW_TEXT = 'text-[13px] font-medium text-foreground';
var GROUP_HEAD =
  'wb-entry-group-head px-[var(--wb-pad)] pb-[3px] pt-[9px] font-[var(--wb-font-mono)] ' +
  'text-[9px] font-semibold tracking-[0.1em] text-[color:var(--wb-faint)]';
var ENTRY_TAG =
  'wb-entry-tag inline-flex h-[15px] flex-none items-center justify-center rounded ' +
  'bg-[color:color-mix(in_srgb,var(--wb-accent)_9%,transparent)] px-[5px] ' +
  'font-[var(--wb-font-mono)] text-[9px] font-semibold leading-none tracking-[0.05em] ' +
  'text-[color:color-mix(in_srgb,var(--wb-accent)_70%,var(--wb-faint))]';

var openKey = null;
var openSubs = [];

function setOpenKey(key) {
  if (openKey === key) return;
  openKey = key;
  openSubs.slice().forEach(function (fn) { fn(); });
}

function useOpenKey() {
  var setTick = useState(0)[1];
  useEffect(function () {
    function onChange() { setTick(function (n) { return n + 1; }); }
    openSubs.push(onChange);
    return function () {
      var i = openSubs.indexOf(onChange);
      if (i >= 0) openSubs.splice(i, 1);
    };
  }, [setTick]);
  return openKey;
}

// 定位（@floating-ui/dom，2026-10-19 C4）：placement top + offset(8) = 水平居中于
// 触发钮、底边贴钮上方 8px；shift 把水平位置夹回视口（12px 边距）。maxHeight 仍按
// 旧公式先写（ placement 的 y 要用收过的高度量 ）：min(60vh, 钮上方空间，最少 80)。
function placePop(trigger, pop) {
  var margin = 12;
  var box = trigger.getBoundingClientRect();
  pop.style.width = Math.min(320, window.innerWidth - margin * 2) + 'px';
  pop.style.bottom = 'auto';
  pop.style.maxHeight = Math.min(window.innerHeight * 0.6, Math.max(80, box.top - 8 - margin)) + 'px';
  return computePosition(trigger, pop, {
    strategy: 'fixed',
    placement: 'top',
    middleware: [offset(8), shift({ padding: margin })]
  }).then(function (result) {
    if (!pop.isConnected) return;
    pop.style.left = result.x + 'px';
    pop.style.top = result.y + 'px';
  });
}

function focusFrame(sectionId, screenId) {
  var api = window.workbench && window.workbench.focusFrame;
  return api ? api(sectionId, screenId) : focusWorkbenchFrame(sectionId, screenId);
}

// 点 section 与 ?section= 落点同一条路（stage.js focusSection）：跨 tab 先切、选中画布条目、
// 即时定位并选中。没有 window.workbench（不该发生）时退到当前 tab 的同一原语。
function goToSection(sectionId) {
  var api = window.workbench && window.workbench.focusSection;
  if (api) return api(sectionId);
  if (focusBoardSection(sectionId, { smooth: false })) selectBoardSection(sectionId);
}

function FrameTree(props) {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; });
  var focusKey = useWorkbenchStore(function (s) { return s.focusFrameKey; });
  var focusSection = useWorkbenchStore(function (s) { return s.focusSectionId; });
  var refs = props.refs;

  var counts = {};
  var warns = {};
  ((snap && snap.rows) || []).forEach(function (r) {
    if (!r.screenId) return;
    var k = r.group + '\0' + r.screenId;
    counts[k] = (counts[k] || 0) + 1;
    if (r.broken) warns[k] = true;
  });

  // setActiveTab 会先清掉选中。跨 tab 时 focusFrame 是 Promise，高亮要等板重挂完再写。
  // 在文章画布的页面浮层里点：先关浮层回画布（同步切回画布条目），再聚焦。
  function onPick(sectionId, screenId) {
    if (isPageOverlayOpen()) closePageOverlay();
    var result = focusFrame(sectionId, screenId);
    function finish(ok) {
      if (ok === false) return;
      selectBoardFrame(sectionId, screenId);
      flashBoardFrame(sectionId, screenId);
    }
    if (result && typeof result.then === 'function') result.then(finish);
    else finish(result);
    if (props.onFrameNavigate) props.onFrameNavigate();
  }

  function onPickSection(sec) {
    if (isPageOverlayOpen()) closePageOverlay();
    goToSection(sec.id);
    if (props.onFrameNavigate) props.onFrameNavigate();
  }

  return (
    <nav className="wb-outline mx-[var(--wb-pad)]" id="wboutline" aria-label="大纲">
      {refs.outline.map(function (sec) {
        // 文章画布上的 HTML 帧也在画布上（卡片，2026-10-15），和别的帧一样列、一样点了定位。
        var frames = sec.frames;
        if (!frames.length) return null;
        return (
          <div className="ol" key={sec.id} data-ol-section={sec.id}>
            <button type="button"
              className={cn('ol-sec', focusSection === sec.id && 'on')}
              data-state={focusSection === sec.id ? 'on' : undefined}
              title={sec.letter + ' ' + sec.title}
              onClick={function () { onPickSection(sec); }}>
              <span className="ol-L">{sec.letter}</span>
              <span className="ol-sec-t min-w-0 flex-1 truncate">{sec.title}</span>
            </button>
            {frames.map(function (f) {
              var k = sec.id + '\0' + f.id;
              var n = counts[k] || 0;
              var on = focusKey === k;
              return (
                <RowMenu key={f.id} items={[
                  { kind: 'copy', label: '复制 @frame', text: '@frame:' + props.pageId + '/' + f.id,
                    attr: { 'data-copy-frame': props.pageId + '/' + f.id } }
                ]}>
                <button type="button"
                  className={cn('ol-row', on && 'on')}
                  data-ol-frame={f.id} data-state={on ? 'on' : undefined}
                  title={f.ref + ' ' + f.title}
                  onClick={function () { onPick(sec.id, f.id); }}>
                  <span className="spine" aria-hidden="true"></span>
                  <span className="no">{f.ref}</span>
                  <span className="nm">{f.title}</span>
                  {n ? <span className={cn('ol-n', warns[k] && 'warn')}>{n}</span> : null}
                </button>
                </RowMenu>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function EntryRow(props) {
  var entry = props.entry;
  var on = !!props.on;
  var tagKey = entry.role === 'draft' ? null : entryTag(entry);
  var menuItems = entry.kind === 'doc'
    ? [
        { kind: 'copy', label: '复制 @frame', text: '@frame:' + props.pageId + '/' + entry.id,
          attr: { 'data-copy-frame': props.pageId + '/' + entry.id } }
      ]
    : [
        { kind: 'copy', label: '复制 @page', text: '@page:' + props.pageId,
          attr: { 'data-copy-page': props.pageId } }
      ];
  return (
    <RowMenu items={menuItems}>
    <div className="wb-entry-row group flex min-w-0 items-stretch gap-0.5">
      <button type="button"
        data-entry={entry.id} data-state={on ? 'on' : undefined}
        className={cn(
          'wb-entry flex flex-1 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-[var(--wb-pad)] py-1.5 text-left font-sans transition-[color,background-color] duration-150 hover:bg-accent group-hover:bg-accent',
          ROW_TEXT,
          on && 'on ' + ROW_ON
        )}
        onClick={function () { props.onPick(entry); }}>
        <span className="wb-entry-t min-w-0 flex-1 truncate">{entry.title}</span>
        {tagKey ? (
          <span className={ENTRY_TAG} data-tag={tagKey}>{ENTRY_TAG_LABELS[tagKey]}</span>
        ) : null}
      </button>
    </div>
    </RowMenu>
  );
}

/* 浮层里的内容树。选中态按当前挂着的板解析，不按这份切片：某个 tab 把文档行藏掉之后，
   不能因为选中的文档不在列表里就回落成画布、把树打开。
   第一个 tab（以及整页那一个钮）带文档 / 草稿，树仍只在画布条目选中时展开。
   其它 tab 只画该 tab 的帧，不看当前选的是不是画布。点帧、section 或条目都先关浮层再导航：
   条目一切就是换了一屏，浮层留着只会盖在新内容上。 */
function OutlineContents(props) {
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var active = useWorkbenchStore(function (s) { return s.activeBoard; });
  useWorkbenchStore(function (s) { return s.activeEntryId; }); // 订阅选中变化；取值走 activeEntryOf
  if (!active || active.pageId !== activePageId) return null;
  var full = active.fullBoard || active.board;
  var slice = outlineSlice(full, props.tabId || '');
  var entries = slice.entries;
  var model = contentsModel(entries);
  var refs = boardRefs(slice.view);
  var hasTree = !!(refs && refs.outline.some(function (sec) { return sec.frames.length > 0; }));
  var current = activeEntryOf();
  // 页面浮层（文章画布的 HTML 帧）也算在画布上：树照样展开，点了回画布。
  var onCanvas = !!current && (current.kind === 'canvas' || isPageOverlayEntry(current));
  var treeOpen = hasTree && (!slice.showDocs || onCanvas);
  if (!hasTree && (model.hidden || (!model.productRows.length && !model.drafts.length))) {
    return <p className="wb-outline-empty">没有帧</p>;
  }

  function onPickEntry(entry) {
    var now = wbGet().activeBoard;
    if (!now) return;
    var board = now.fullBoard || now.board;
    var targetTab = entry.kind === 'doc' ? tabIdOfScreen(board, entry.id) : (props.tabId || '');
    var go = targetTab && now.tabId && targetTab !== now.tabId ? setActiveTab(targetTab) : null;
    function apply() { setActiveEntry(entry.id); }
    if (props.onFrameNavigate) props.onFrameNavigate();
    if (go && typeof go.then === 'function') go.then(function (ok) { if (ok !== false) apply(); });
    else apply();
  }

  var productRows = model.productRows.map(function (entry) {
    var rows = [
      <EntryRow key={entry.id} entry={entry} pageId={activePageId}
        on={!!current && current.id === entry.id} onPick={onPickEntry} />
    ];
    if (entry.id === CANVAS_ENTRY_ID && treeOpen) {
      rows.push(
        <div key="canvas-tree" className="wb-entry-tree ms-[7px]">
          <FrameTree refs={refs} pageId={activePageId} onFrameNavigate={props.onFrameNavigate} />
        </div>
      );
    }
    return rows;
  });

  return (
    <section className="wb-section" data-section="contents">
      <nav className="wb-contents flex flex-col gap-px pb-1 pt-0.5" id="wbcontents" aria-label="内容">
        {model.productRows.length ? (
          <div className="wb-entry-group flex flex-col gap-px" data-group="product">
            <div className={GROUP_HEAD}>产物</div>
            {productRows}
          </div>
        ) : null}
        {!model.productRows.length && treeOpen ? (
          <FrameTree refs={refs} pageId={activePageId} onFrameNavigate={props.onFrameNavigate} />
        ) : null}
        {model.drafts.length ? (
          <div className="wb-entry-group flex flex-col gap-px" data-group="draft">
            <div className={GROUP_HEAD}>草稿</div>
            {model.drafts.map(function (entry) {
              return (
                <EntryRow key={entry.id} entry={entry} pageId={activePageId}
                  on={!!current && current.id === entry.id} onPick={onPickEntry} />
              );
            })}
          </div>
        ) : null}
      </nav>
    </section>
  );
}

function OutlinePop(props) {
  var popRef = useRef(null);
  var focusBefore = useRef(null);
  var label = props.label;

  useLayoutEffect(function () {
    var pop = popRef.current;
    focusBefore.current = document.activeElement;
    if (pop) pop.focus({ preventScroll: true });
    function trigger() {
      return document.querySelector('[data-outline-trigger][aria-expanded="true"]');
    }
    function place() {
      var button = trigger();
      if (pop && button) placePop(button, pop);
    }
    place();
    // 跟随触发钮：祖先滚动 / 视口缩放 / 钮自身尺寸变化都经 autoUpdate 再定位
    // （替代旧的 window resize + capture scroll 两对监听，2026-10-19 C4）。
    var stopAutoUpdate = function () {};
    var anchor = trigger();
    if (pop && anchor) stopAutoUpdate = autoUpdate(anchor, pop, place);
    // 捕获段：标注钉子在冒泡段 stopPropagation，冒泡段的点外关闭收不到这一下。
    // 排除浮层自己、当前触发钮（它自己的 click 负责开合）与菜单（右键 / 复制菜单
    // 门户在浮层外，点它们不收浮层）。
    function onPointerDown(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('#wboutline-pop')) return;
      if (target.closest('[data-outline-trigger][aria-expanded="true"]')) return;
      if (target.closest('[role="menu"], [data-radix-popper-content-wrapper]')) return;
      setOpenKey(null);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return function () {
      stopAutoUpdate();
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  function requestClose() { setOpenKey(null); }

  // Esc 由弹层栈关（LAYER_RANK.chrome，焦点在打字里时这一下归输入框）。焦点只在 Esc 关掉时
  // 还给打开前的元素；点外、跳帧关掉时焦点留在用户点的地方，不被拽回横条。焦点移出不算关闭
  // （Tab 走出去还回得来）。
  useStackLayer('outline-pop', true, function () {
    var back = focusBefore.current;
    requestClose();
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }, { rank: LAYER_RANK.chrome, respectTyping: true });

  return createPortal(
    <div ref={popRef} className="wb-outline-pop wb-glass" id="wboutline-pop" role="dialog"
      aria-modal="false" aria-label={label} tabIndex={-1} data-ann-ui>
      <OutlineContents tabId={props.tabId || ''} onFrameNavigate={function () { setOpenKey(null); }} />
    </div>,
    document.body
  );
}

export function OutlineButton(props) {
  var key = props.tabId || '@page';
  var current = useOpenKey();
  var open = current === key;
  var pageId = useWorkbenchStore(function (s) { return s.activePageId; });
  useEffect(function () { setOpenKey(null); }, [pageId]);
  useEffect(function () {
    return function () { if (openKey === key) setOpenKey(null); };
  }, [key]);

  var common = {
    type: 'button',
    'data-outline-trigger': '',
    'data-tab-outline': props.tabId || '',
    'aria-label': props.label,
    title: props.label,
    'aria-expanded': open ? 'true' : 'false',
    'aria-controls': open ? 'wboutline-pop' : undefined,
    onClick: function () { setOpenKey(open ? null : key); }
  };
  // 横条里的那一个（props.strip）：横条工具钮的同一套皮肤（tool variant，同 #wbminimap-toggle），开着时 on 态。
  var trigger = props.strip ? (
    <Button {...common} variant="tool" size="icon" id="wbstrip-outline"
      data-state={open ? 'on' : undefined}
      className={cn('wb-strip-outline', open && 'on')}>
      <WbIcon name="section-nav" size={14} className="size-3.5" />
    </Button>
  ) : (
    <button {...common} className="wb-outline-trigger">
      <WbIcon name="section-nav" size={14} />
    </button>
  );

  return (
    <Fragment>
      {trigger}
      {open ? <OutlinePop tabId={props.tabId || ''} label={props.label} /> : null}
    </Fragment>
  );
}
