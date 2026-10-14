// 大纲浮层（2026-10-10）：从左栏「大纲」页签挪到页 tab 条。每个 tab 标题旁一个
// 触发钮；不到两个 tab 的画布页条上只有这一个钮，浮层画整页。
// 不用下拉菜单：菜单会拦下 Tab，大纲行是普通按钮，Tab 要能走进去。浮层 Portal 到
// body（条有 overflow-x，玻璃的 backdrop-filter 也会把 fixed 后代收成包含块），
// 向上弹，层级 --wb-z-float，皮肤 .wb-glass。同一时刻只开一个。
// 右键菜单门户在浮层外面。点到 [role=menu] 时不关，复制菜单才能把焦点交还行内按钮。
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkbenchStore, wbGet } from './store.js';
import { entriesOfActiveBoard, setActiveEntry, setActiveTab } from '../pages.js';
import {
  flashBoardFrame,
  focusBoardSection,
  focusWorkbenchFrame,
  isTypingTarget,
  selectBoardFrame,
  selectBoardSection
} from '../board-nav.js';
import {
  CANVAS_ENTRY_ID,
  ENTRY_TAG_LABELS,
  contentsModel,
  entryTag,
  outlineSlice,
  resolveEntry
} from '../lib/board-entries.js';
import { tabIdOfScreen } from '../lib/board-tabs.js';
import { boardRefs } from '../lib/board-refs.js';
import { WbIcon } from './WbIcon.jsx';
import { RowMenu } from './row-menu.jsx';
import { cn } from './lib/utils.js';

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

function placePop(trigger, pop) {
  var box = trigger.getBoundingClientRect();
  var margin = 12;
  var width = Math.min(320, window.innerWidth - margin * 2);
  var left = box.left + box.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - margin - width));
  var spaceAbove = Math.max(80, box.top - 8 - margin);
  pop.style.width = width + 'px';
  pop.style.left = left + 'px';
  pop.style.bottom = (window.innerHeight - box.top + 8) + 'px';
  pop.style.maxHeight = Math.min(window.innerHeight * 0.6, spaceAbove) + 'px';
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
  function onPick(sectionId, screenId) {
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
    goToSection(sec.id);
    if (props.onFrameNavigate) props.onFrameNavigate();
  }

  return (
    <nav className="wb-outline mx-[var(--wb-pad)]" id="wboutline" aria-label="大纲">
      {refs.outline.map(function (sec) {
        // 文章画布上的文档帧（HTML 帧）不在画布上，按“文档”条目在上面列出；帧树只列画布上的帧。
        var frames = sec.frames.filter(function (f) { return !f.doc; });
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
  var activeEntryId = useWorkbenchStore(function (s) { return s.activeEntryId; });
  if (!active || active.pageId !== activePageId) return null;
  var full = active.fullBoard || active.board;
  var slice = outlineSlice(full, props.tabId || '');
  var entries = slice.entries;
  var model = contentsModel(entries);
  var refs = boardRefs(slice.view);
  var hasTree = !!(refs && refs.outline.some(function (sec) { return sec.frames.some(function (f) { return !f.doc; }); }));
  var current = resolveEntry(entriesOfActiveBoard(), activeEntryId);
  var treeOpen = hasTree && (!slice.showDocs || (!!current && current.kind === 'canvas'));
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
  var label = props.label;

  useLayoutEffect(function () {
    var pop = popRef.current;
    function trigger() {
      return document.querySelector('[data-outline-trigger][aria-expanded="true"]');
    }
    function place() {
      var button = trigger();
      if (pop && button) placePop(button, pop);
    }
    place();
    if (pop) pop.focus();
    function onKey(event) {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="menu"]')) return;
      event.preventDefault();
      event.stopPropagation();
      var button = trigger();
      setOpenKey(null);
      if (button) button.focus();
    }
    function onPointerDown(event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest('#wboutline-pop')) return;
      if (target.closest('[data-outline-trigger][aria-expanded="true"]')) return;
      if (target.closest('[role="menu"], [data-radix-popper-content-wrapper]')) return;
      setOpenKey(null);
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return function () {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, []);

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

  return (
    <Fragment>
      <button type="button" className="wb-outline-trigger" data-outline-trigger
        data-tab-outline={props.tabId || ''}
        aria-label={props.label} title={props.label}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? 'wboutline-pop' : undefined}
        onClick={function () { setOpenKey(open ? null : key); }}>
        <WbIcon name="section-nav" size={14} />
      </button>
      {open ? <OutlinePop tabId={props.tabId || ''} label={props.label} /> : null}
    </Fragment>
  );
}
