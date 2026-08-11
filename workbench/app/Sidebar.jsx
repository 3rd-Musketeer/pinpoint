// 侧栏整树（P1b cut2，goal-20260810-workbench-react-rebuild）— head（连接状态 +
// 折叠钮）、Pages 段（board mode / 页面列表 / 文档版本）、Annotations 段（AnnPanel）、
// 设置视图壳、footer（主题 + 设置入口）。原 index.html 静态标记 + pages.js/boot-prefs.js
// 手工 DOM 同步的 React 形态；DOM id / class / 文案与原实现逐一对应（e2e 选择器即契约）。
// 状态全部来自 app/store.js；交互回调仍调 pages.js / boot-prefs.js 的命令式动作
// （页面装载、文档切换、偏好保存的命令式副作用留在那些模块，本文件只做渲染与转发）。
//
// V2 换皮（goal-20260811-workbench-visual-rebuild）：侧栏 chrome 全量收编 shadcn
// 复制件 + Tailwind 类，配方照 V1 基准（SettingsView / app/Seg.jsx 头注释）：
//  - 分段控件（#wbboard-mode / footer #wbtheme）走共享 Seg（ToggleGroup single 受控）；
//  - 图标钮（#wbside-toggle）= Button tool variant + size=icon（V0 gear 同款）；
//  - 页面行/文档版本行：off = muted 字 + hover 浅面（--wb-hover 档），on = --wb-fill 面 +
//    semibold + 前景字（页面行多一条 inset 2px accent 边条，产品原有强调）；行 hover 与
//    on 态的优先级用 hover:/group-hover: + data-[state=on] 复合类显式锁（同 Seg 配方）；
//  - 重命名 input 收 vendored Input（accent inset 描边替代旧 .wb-page-rename 写法）；
//  - 滚动区 .wb-side-scroll 收 ScrollArea（Radix 覆盖式滑条，bg-border 经桥 = --wb-line）；
//  - 连接状态点/在线绿/offline 红/复制成功绿是状态语义色（非 chrome 皮肤），保留字面量，
//    与 client 端同源值一致。
import { Fragment, useEffect, useRef, useState } from 'react';
import { useWorkbenchStore, wbGet, wbSet } from './store.js';
import {
  docScreensOfActiveBoard,
  pagesForMode,
  setActiveDoc,
  setActivePage,
  setBoardMode,
  setSectionOpen,
  showSettings,
  showTabs
} from '../pages.js';
import { setTheme, toggleSideCollapsed } from '../boot-prefs.js';
import { openDocExportDialog } from '../export-core.js';
import { COMPONENTS_ID } from '../lib/page-url.js';
import { readPrefs, savePrefs } from '../lib/prefs.js';
import { AnnPanel } from './AnnPanel.jsx';
import { SettingsView } from './SettingsView.jsx';
import { Seg } from './Seg.jsx';
import { WbIcon } from './WbIcon.jsx';
import { cn } from './lib/utils.js';
import { Badge } from './ui/badge.jsx';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { ScrollArea } from './ui/scroll-area.jsx';

// 页面行（Pages 段）与文档版本行共用同一套行语言；页面行多 accent 边条与
// 行容器 group-hover 联动（行 hover 即行态，不只按钮本身）。
var ROW_ON =
  'bg-secondary font-semibold text-foreground ' +
  'hover:bg-secondary hover:text-foreground group-hover:bg-secondary group-hover:text-foreground';

function SideHead() {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; });
  var collapsed = useWorkbenchStore(function (s) { return s.sideCollapsed; });
  var on = !!(snap && snap.available && snap.connected);
  var syncErr = !!(snap && snap.available && snap.syncError);
  return (
    <div className="wb-head flex items-center justify-between gap-2 px-[var(--wb-pad)] pb-2 pt-2.5">
      <div id="wbconn" data-state={on ? 'online' : 'offline'}
        className="wb-conn group inline-flex min-w-0 select-none items-center gap-1.5 text-[11px] font-medium leading-none text-muted-foreground data-[state=offline]:text-destructive data-[state=online]:text-[#1b7a3d]"
        title={on ? (syncErr ? '已连接 · 上次同步失败' : '标注服务已连接') : '标注服务未连接（请运行 npm run dev）'}>
        <span className="wb-conn-dot size-[7px] flex-none rounded-full bg-[#c7c7cc] shadow-[0_0_0_2px_rgba(199,199,204,.25)] group-data-[state=online]:bg-[#34c759] group-data-[state=online]:shadow-[0_0_0_2px_rgba(52,199,89,.22)] group-data-[state=offline]:bg-destructive group-data-[state=offline]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--wb-danger)_18%,transparent)]" aria-hidden="true"></span>
        <span className="wb-conn-label truncate">{on ? '已连接' : '未连接'}</span>
      </div>
      <Button type="button" variant="tool" size="icon" id="wbside-toggle"
        className="wb-side-toggle flex-none"
        aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}
        aria-expanded={collapsed ? 'false' : 'true'}
        onClick={function () { toggleSideCollapsed({ save: true }); }}>
        <WbIcon name="panel-left-close" size={16} className="size-4" />
      </Button>
    </div>
  );
}

function Section(props) {
  var open = useWorkbenchStore(function (s) { return s.sectionOpen[props.name] !== false; });
  return (
    <section className={'wb-section' + (open ? ' open' : '')} data-section={props.name}>
      <button type="button" aria-expanded={open ? 'true' : 'false'}
        className="wb-section-head flex w-full cursor-pointer items-center gap-[7px] border-0 bg-transparent px-[var(--wb-pad)] pb-[9px] pt-[11px] text-left font-sans text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[color:var(--wb-faint)] transition-[color,background-color] duration-150 hover:bg-accent hover:text-muted-foreground"
        onClick={function () { setSectionOpen(props.name, !open); }}>
        <span aria-hidden="true"
          className={cn(
            'wb-section-chevron size-1.5 flex-none border-b-[1.4px] border-r-[1.4px] border-current opacity-75 transition-[transform,margin-top] duration-(--wb-dur) ease-(--wb-ease)',
            open ? '-rotate-[135deg] mt-px' : 'rotate-45 -mt-0.5'
          )}></span>
        <span className="wb-section-title min-w-0 flex-1">{props.title}</span>
        {props.count || null}
      </button>
      <div className={cn(
        'wb-section-body grid transition-[grid-template-rows] duration-(--wb-dur) ease-(--wb-ease)',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      )}>
        <div className={cn(
          'wb-section-body-inner min-h-0 overflow-hidden px-[var(--wb-pad)] pb-3 transition-[opacity,transform] duration-150 ease-(--wb-ease)',
          open ? 'pointer-events-auto translate-y-0 opacity-100 delay-[40ms]' : 'pointer-events-none -translate-y-0.5 opacity-0'
        )}>{props.children}</div>
      </div>
    </section>
  );
}

function AnnCount() {
  var count = useWorkbenchStore(function (s) { return (s.annSnap && s.annSnap.rows.length) || 0; });
  // 0 时不渲染徽章但保留 #wbann-count 锚点（id 契约）；旧文案 "(N)" 归并为裸计数徽章
  if (!count) return <span className="wb-section-count hidden" id="wbann-count"></span>;
  return (
    <Badge variant="secondary" id="wbann-count"
      className="wb-section-count px-1.5 py-0 text-[10px] leading-[1.6] font-semibold tabular-nums text-[color:var(--wb-faint)]">
      {count}
    </Badge>
  );
}

var BOARD_MODES = [
  ['ios', 'iOS', { title: '手机原型' }],
  ['web', 'Web', { title: 'web app 画板' }],
  ['html', 'HTML', { title: '完整单页 HTML 文档（汇报页一类）' }]
];

function BoardModeSwitch() {
  var boardMode = useWorkbenchStore(function (s) { return s.boardMode; });
  return (
    <Seg id="wbboard-mode" role="group" aria-label="Board mode"
      className="wb-board-mode mx-[var(--wb-pad)] mb-2 w-auto"
      value={boardMode} dataAttr="data-board-mode" options={BOARD_MODES}
      onPick={function (v) { if (v !== wbGet().boardMode) setBoardMode(v); }} />
  );
}

function copyPageId(id, done) {
  var text = '@page:' + String(id || '').trim();
  if (!id) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { /* ignore */ });
    return;
  }
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (document.execCommand('copy')) done();
  } catch (e) { /* ignore */ }
  ta.remove();
}

function PageRow(props) {
  var page = props.page;
  var system = !!props.system;
  var active = useWorkbenchStore(function (s) { return s.activePageId === page.id; });
  var customName = useWorkbenchStore(function (s) { return s.pageNames[page.id]; });
  var [renaming, setRenaming] = useState(false);
  var [copied, setCopied] = useState(false);
  var inputRef = useRef(null);
  var doneRef = useRef(false);
  var title = system || typeof customName !== 'string' || !customName.trim() ? page.title : customName.trim();

  useEffect(function () {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  // Enter 路径是 blur + finish 双触发，blur 在 unmount 时也可能再发一次 —— done 守卫挡住
  function finishRename(commit, value) {
    if (doneRef.current) return;
    doneRef.current = true;
    var next = String(value == null ? '' : value).trim();
    if (!commit || !next) next = title || page.title;
    var names = Object.assign({}, readPrefs().pageNames || {});
    if (next === page.title) delete names[page.id];
    else names[page.id] = next;
    savePrefs({ pageNames: names });
    wbSet({ pageNames: names });
    setRenaming(false);
  }

  function onRenameKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputRef.current) inputRef.current.blur();
      finishRename(true, e.target.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishRename(false, e.target.value);
    }
  }

  return (
    <div className="wb-page-row group flex min-w-0 items-stretch gap-0.5" data-page-system={system ? '1' : undefined}>
      <button type="button"
        data-vpage={page.id} data-page-system={system ? '1' : undefined}
        data-page-default={page.title} data-page-mode={system ? undefined : (page.mode || 'ios')}
        data-state={active ? 'on' : undefined}
        className={cn(
          'wb-page flex-1 min-w-0 cursor-pointer truncate rounded-md border-0 bg-transparent px-2 py-[7px] text-left font-sans text-[12.5px] font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 hover:bg-accent hover:text-accent-foreground group-hover:bg-accent group-hover:text-accent-foreground',
          active && 'on',
          active && ROW_ON,
          renaming && 'renaming bg-accent px-0 py-0 hover:bg-accent group-hover:bg-accent'
        )}
        onClick={function () {
          if (renaming) return;
          showTabs();
          setActivePage(page.id);
        }}
        onDoubleClick={function (e) {
          if (system || renaming) return;
          e.preventDefault();
          doneRef.current = false;
          setRenaming(true);
        }}>
        {renaming ? (
          <Input ref={inputRef} type="text" aria-label="重命名页面"
            className="wb-page-rename h-auto rounded-md border-0 bg-transparent px-2 py-[7px] text-[12.5px] font-semibold text-foreground shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--wb-accent)_55%,transparent)]"
            defaultValue={title} onKeyDown={onRenameKey}
            onBlur={function (e) { finishRename(true, e.target.value); }} />
        ) : title}
      </button>
      <Button type="button" variant="ghost"
        className={cn(
          'wb-page-copy h-auto w-7 flex-none self-stretch rounded-md px-0 py-0 text-muted-foreground',
          'opacity-0 transition-[opacity,color,background-color] duration-150 group-hover:opacity-100 focus-visible:opacity-100',
          copied && 'ok bg-accent text-[#1b7a3d] hover:text-[#1b7a3d]'
        )}
        data-copy-page={page.id}
        aria-label={'Copy @page:' + page.id}
        title={copied ? 'Copied @page:' + page.id : 'Copy @page:' + page.id}
        onClick={function (e) {
          e.preventDefault();
          e.stopPropagation();
          copyPageId(page.id, function () {
            setCopied(true);
            setTimeout(function () { setCopied(false); }, 1200);
          });
        }}>
        <WbIcon name="link" size={12} className="size-3" />
      </Button>
    </div>
  );
}

function PagesNav() {
  var boardMode = useWorkbenchStore(function (s) { return s.boardMode; });
  useWorkbenchStore(function (s) { return s.pageManifest; }); // 订阅触发重渲染；取值走 pagesForMode
  var manifestError = useWorkbenchStore(function (s) { return s.pageManifestError; });
  var pages = pagesForMode(boardMode);
  return (
    <nav className="wb-pages flex flex-col gap-px pb-1 pt-0.5" id="wbpages">
      {boardMode === 'ios' ? (
        <PageRow system page={{ id: COMPONENTS_ID, title: 'Component Library' }} />
      ) : null}
      {pages.map(function (p) { return <PageRow key={p.id} page={p} />; })}
      {manifestError ? (
        <p className="wb-page-error" title={manifestError}
          style={{ margin: '6px 10px', color: 'var(--wb-danger)', fontSize: '12px', lineHeight: 1.35 }}>
          页面清单读取失败：board.json 缺失或返回的不是 JSON。请检查对应 previews 目录后刷新。
        </p>
      ) : null}
    </nav>
  );
}

function DocVersions() {
  var boardMode = useWorkbenchStore(function (s) { return s.boardMode; });
  useWorkbenchStore(function (s) { return s.activeBoard; }); // 订阅触发重渲染；取值走 docScreensOfActiveBoard
  var activeDocId = useWorkbenchStore(function (s) { return s.activeDocId; });
  var screens = docScreensOfActiveBoard();
  var show = boardMode === 'html' && screens.length > 0;
  var items = [];
  var lastSection = null;
  screens.forEach(function (sc) {
    if (screens.length > 1 && sc.section && sc.section !== lastSection) {
      lastSection = sc.section;
      items.push(
        <div key={'sec-' + sc.section}
          className="wb-doc-ver-sec px-[var(--wb-pad)] pb-0.5 pt-1.5 text-[10px] tracking-[0.04em] text-[color:var(--wb-faint)]">
          {sc.section}
        </div>
      );
    }
    var on = activeDocId === sc.id;
    items.push(
      <button key={sc.id} type="button" data-doc-screen={sc.id} data-state={on ? 'on' : undefined}
        className={cn(
          'wb-doc-ver mx-1.5 cursor-pointer rounded-md border-0 bg-transparent px-[var(--wb-pad)] py-1.5 text-left font-sans text-[12.5px] text-muted-foreground transition-[color,background-color] duration-150 hover:bg-accent hover:text-accent-foreground',
          on && 'on ' + ROW_ON
        )}
        onClick={function () { setActiveDoc(sc.id); }}>
        {sc.title}
      </button>
    );
  });
  return (
    // display 类会盖掉 [hidden] 的 UA 规则，show=false 时显式 hidden 类还回来
    <nav id="wbdoc-versions" aria-label="文档版本" hidden={!show}
      className={cn('wb-doc-versions flex-col gap-px pb-1 pt-0.5', show ? 'flex' : 'hidden')}>
      {show ? (
        <Fragment>
          <div className="wb-doc-ver-head flex items-center justify-between gap-2 px-[var(--wb-pad)] pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.06em] text-[color:var(--wb-faint)]">
            <span>{screens.length > 1 ? 'Versions' : 'Document'}</span>
            <Button type="button" variant="ghost" data-doc-export="" title="导出当前文档"
              className="wb-doc-export h-auto min-h-0 rounded-md bg-[var(--wb-side)] px-2 py-[3px] text-[11px] font-semibold leading-[1.2] text-muted-foreground shadow-none transition-[color,background-color] duration-150 hover:bg-accent hover:text-primary"
              onClick={function () { openDocExportDialog(); }}>导出</Button>
          </div>
          {items}
        </Fragment>
      ) : null}
    </nav>
  );
}

function PagesSection() {
  return (
    <Fragment>
      <BoardModeSwitch />
      <PagesNav />
      <DocVersions />
    </Fragment>
  );
}

function themeLabel(icon, text) {
  return (
    <Fragment>
      <WbIcon name={icon} size={12} className="size-3" />
      {text}
    </Fragment>
  );
}

// footer 主题分段项：图标常态淡一档（旧 #wbtheme .wb-ico opacity .75→on 1 的收编）
var THEME_ITEM = 'gap-1 [&_svg]:opacity-75 data-[state=on]:[&_svg]:opacity-100';

function SideFoot() {
  var theme = useWorkbenchStore(function (s) { return s.theme; });
  var settingsOpen = useWorkbenchStore(function (s) { return s.settingsOpen; });
  return (
    <div className="wb-foot flex items-center gap-1.5 px-[var(--wb-pad)] py-2.5" id="wbfoot" hidden={settingsOpen}>
      <Seg id="wbtheme" role="group" aria-label="屏幕主题"
        value={theme} dataAttr="data-theme"
        options={[
          ['light', themeLabel('sun', 'Light'), { title: 'Light', className: THEME_ITEM }],
          ['dark', themeLabel('moon', 'Dark'), { title: 'Dark', className: THEME_ITEM }]
        ]}
        onPick={function (v) { setTheme(v, { save: true }); }} />
      <Button type="button" variant="tool" size="icon" id="wbgear"
        aria-label="预览设置" title="设置"
        data-state={settingsOpen ? 'on' : undefined}
        onClick={function () { showSettings(); }}>
        <WbIcon name="settings" size={15} className="size-[15px]" />
      </Button>
    </div>
  );
}

export function Sidebar() {
  var settingsOpen = useWorkbenchStore(function (s) { return s.settingsOpen; });
  return (
    <Fragment>
      <SideHead />
      <div className="wb-side-body">
        <ScrollArea className="wb-side-scroll min-h-0 flex-1" id="wbside-scroll" hidden={settingsOpen}>
          <Section name="pages" title="Pages"><PagesSection /></Section>
          <Section name="annotations" title="Annotations" count={<AnnCount />}><AnnPanel /></Section>
        </ScrollArea>
        <div className="wb-settings-view" id="wbsettings" hidden={!settingsOpen}>
          <SettingsView />
        </div>
        <SideFoot />
      </div>
    </Fragment>
  );
}
