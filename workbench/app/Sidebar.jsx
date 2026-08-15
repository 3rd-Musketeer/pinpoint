// 侧栏整树（P1b cut2，goal-20260810-workbench-react-rebuild）— head（连接状态 +
// 折叠钮）、Pages 段（单一页面列表 + 行内壳标记 / 文档版本）、设置视图壳、footer。
// 原 index.html 静态标记 + pages.js/boot-prefs.js 手工 DOM 同步的 React 形态；
// DOM id / class / 文案与原实现逐一对应（e2e 选择器即契约）。状态全部来自
// app/store.js；交互回调仍调 pages.js / boot-prefs.js 的命令式动作（页面装载、
// 文档切换、偏好保存的命令式副作用留在那些模块，本文件只做渲染与转发）。
//
// V2 换皮（goal-20260811-workbench-visual-rebuild）：侧栏 chrome 全量收编 shadcn
// 复制件 + Tailwind 类，配方照 V1 基准（SettingsView / app/Seg.jsx 头注释）。
//
// 2026-08-15 侧栏重构（decisions 08-14 左右分工 + 08-15c 大纲延伸线）：
//  - 左栏 = 页面上下文：head（连接状态 + 齿轮进设置视图 + 收起）→ Pages → 大纲；
//    标注区迁出为独立右栏（app/AnnPanel.jsx，挂 #wbann-side）。
//  - 大纲 = 当前页 section → frame 树（引用号 + 屏名 + 计数徽标，红 = 含失效锚点）；
//    点击 = board-nav 定位 frame + 机身 flash 环，与标注卡焦点双向同步
//    （store.focusFrameKey / focusAnnN）。延伸线几何（rail 槽 / spine 逐行拼接 /
//    末行 └ 角）是正式组件结构，CSS 在 index.html（.wb-outline 系，全 token）。
//  - 段头改静态（mock 无折叠 affordance），sectionOpen 机制随 Annotations 段退役。
//  - footer 的 Light/Dark 分段是预览内容主题（ios-root data-theme），原地保留。
//
// 2026-08-16 阶段 2（Web 退役 + Pages 统一）：模式 Seg（iOS/Web/HTML）退役，
// Pages 变单一列表（本地页 + registry dir 条目同列），行内壳标记区分机壳/文档；
// 壳形态由 modeForPage(activePageId) 派生，不再是独立状态。
import { Fragment, useEffect, useRef, useState } from 'react';
import { useWorkbenchStore, wbSet } from './store.js';
import {
  docScreensOfActiveBoard,
  manifestPages,
  setActiveDoc,
  setActivePage,
  showSettings,
  showTabs
} from '../pages.js';
import { setTheme, toggleSideCollapsed } from '../boot-prefs.js';
import { flashBoardFrame, focusWorkbenchFrame } from '../board-nav.js';
import { openDocExportDialog } from '../export-core.js';
import { COMPONENTS_ID, modeForPage } from '../lib/page-url.js';
import { boardRefs } from '../lib/board-refs.js';
import { readPrefs, savePrefs } from '../lib/prefs.js';
import { SettingsView } from './SettingsView.jsx';
import { Seg } from './Seg.jsx';
import { WbIcon } from './WbIcon.jsx';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { ScrollArea } from './ui/scroll-area.jsx';

// 页面行（Pages 段）与文档版本行共用同一套行语言；页面行多 accent 边条与
// 行容器 group-hover 联动（行 hover 即行态，不只按钮本身）。
var ROW_ON =
  'bg-secondary font-semibold text-foreground ' +
  'hover:bg-secondary hover:text-foreground group-hover:bg-secondary group-hover:text-foreground';

// 段头（Pages / 大纲）：静态 eyebrow，mono 小字 + 宽字距（mock .sec 的收编；
// 2026-08-15 起不再是折叠钮）。
var SECTION_HEAD =
  'wb-section-head px-[var(--wb-pad)] pb-[7px] pt-[13px] font-[var(--wb-font-mono)] ' +
  'text-[9.5px] font-semibold uppercase tracking-[0.12em] ' +
  'text-[color:color-mix(in_srgb,var(--wb-accent)_45%,var(--wb-faint))]';

function SideHead() {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; });
  var collapsed = useWorkbenchStore(function (s) { return s.sideCollapsed; });
  var settingsOpen = useWorkbenchStore(function (s) { return s.settingsOpen; });
  var on = !!(snap && snap.available && snap.connected);
  var syncErr = !!(snap && snap.available && snap.syncError);
  return (
    <div className="wb-head flex items-center justify-between gap-2 border-b border-[color:color-mix(in_srgb,var(--wb-accent)_16%,transparent)] px-[var(--wb-pad)] pb-2 pt-2.5">
      <div id="wbconn" data-state={on ? 'online' : 'offline'}
        className="wb-conn group inline-flex min-w-0 select-none items-center gap-1.5 text-[11px] font-medium leading-none text-muted-foreground data-[state=offline]:text-destructive data-[state=online]:text-[color:var(--wb-ok)]"
        title={on ? (syncErr ? '已连接 · 上次同步失败' : '标注服务已连接') : '标注服务未连接（请运行 npm run dev）'}>
        <span className="wb-conn-dot size-[7px] flex-none rounded-full bg-[#c7c7cc] shadow-[0_0_0_2px_rgba(199,199,204,.25)] group-data-[state=online]:bg-[var(--wb-ok)] group-data-[state=online]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--wb-ok)_22%,transparent)] group-data-[state=offline]:bg-destructive group-data-[state=offline]:shadow-[0_0_0_2px_color-mix(in_srgb,var(--wb-danger)_18%,transparent)]" aria-hidden="true"></span>
        <span className="wb-conn-label truncate">{on ? '已连接' : '未连接'}</span>
      </div>
      <div className="flex flex-none items-center gap-1">
        <Button type="button" variant="tool" size="icon" id="wbgear"
          aria-label="预览设置" title="设置"
          data-state={settingsOpen ? 'on' : undefined}
          onClick={function () { showSettings(); }}>
          <WbIcon name="settings" size={15} className="size-[15px]" />
        </Button>
        <Button type="button" variant="tool" size="icon" id="wbside-toggle"
          className="wb-side-toggle flex-none"
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-expanded={collapsed ? 'false' : 'true'}
          onClick={function () { toggleSideCollapsed({ save: true }); }}>
          <WbIcon name="panel-left-close" size={16} className="size-4" />
        </Button>
      </div>
    </div>
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
  // 行内壳标记（2026-08-16 阶段 2）：机壳页 smartphone / 文档页 file-text，
  // 淡色 12px，不抢行的视觉重心；Component Library 系统行带机壳标。
  var pageMode = system ? 'ios' : (page.mode || 'ios');
  var shellIcon = pageMode === 'html' ? 'file-text' : 'smartphone';

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
        data-page-default={page.title} data-page-mode={system ? undefined : pageMode}
        data-state={active ? 'on' : undefined}
        className={cn(
          'wb-page flex flex-1 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-[7px] text-left font-sans text-[12.5px] font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 hover:bg-accent hover:text-accent-foreground group-hover:bg-accent group-hover:text-accent-foreground',
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
        ) : (
          <Fragment>
            <WbIcon name={shellIcon} size={12} className="wb-page-ico size-3 flex-none opacity-70" />
            <span className="min-w-0 flex-1 truncate">{title}</span>
          </Fragment>
        )}
      </button>
      <Button type="button" variant="ghost"
        className={cn(
          'wb-page-copy h-auto w-7 flex-none self-stretch rounded-md px-0 py-0 text-muted-foreground',
          'opacity-0 transition-[opacity,color,background-color] duration-150 group-hover:opacity-100 focus-visible:opacity-100',
          copied && 'ok bg-accent text-[color:var(--wb-ok)] hover:text-[color:var(--wb-ok)]'
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
  useWorkbenchStore(function (s) { return s.pageManifest; }); // 订阅触发重渲染；取值走 manifestPages
  var manifestError = useWorkbenchStore(function (s) { return s.pageManifestError; });
  var pages = manifestPages();
  return (
    <nav className="wb-pages flex flex-col gap-px pb-1 pt-0.5" id="wbpages">
      <PageRow system page={{ id: COMPONENTS_ID, title: 'Component Library', mode: 'ios' }} />
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
  var mode = useWorkbenchStore(function (s) { return modeForPage(s.pageManifest, s.activePageId); });
  useWorkbenchStore(function (s) { return s.activeBoard; }); // 订阅触发重渲染；取值走 docScreensOfActiveBoard
  var activeDocId = useWorkbenchStore(function (s) { return s.activeDocId; });
  var screens = docScreensOfActiveBoard();
  var show = mode === 'html' && screens.length > 0;
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

/* 大纲（decisions 2026-08-15c）：当前页 section → frame 树，行 = mono 引用号 +
   屏名 + 计数徽标（红 = 含失效锚点）。延伸线几何（.ol-*）在 index.html；
   点击复用 board-nav 的 frame 定位（与标注卡 goToMark 同一导航源），机身闪
   focus 环。选中态（store.focusFrameKey）由大纲点击与标注卡点击双向写入。 */
function Outline() {
  var mode = useWorkbenchStore(function (s) { return modeForPage(s.pageManifest, s.activePageId); });
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var active = useWorkbenchStore(function (s) { return s.activeBoard; });
  var snap = useWorkbenchStore(function (s) { return s.annSnap; });
  var focusKey = useWorkbenchStore(function (s) { return s.focusFrameKey; });
  // 文档页不是画布（文档版本切换在 Pages 段）；板未装载 / 空板不出大纲。
  if (mode === 'html' || !active || active.pageId !== activePageId) return null;
  var refs = boardRefs(active.board);
  if (!refs.outline.length) return null;

  // 徽标计数：annSnap 行带 section/screenId（ann-bridge 增量），按帧归并
  var counts = {};
  var warns = {};
  ((snap && snap.rows) || []).forEach(function (r) {
    if (!r.screenId) return;
    var k = r.group + '\0' + r.screenId;
    counts[k] = (counts[k] || 0) + 1;
    if (r.broken) warns[k] = true;
  });

  function onPick(sectionId, screenId) {
    wbSet({ focusFrameKey: sectionId + '\0' + screenId, focusAnnN: null });
    focusWorkbenchFrame(sectionId, screenId);
    flashBoardFrame(sectionId, screenId);
  }

  return (
    <section className="wb-section" data-section="outline">
      <div className={SECTION_HEAD}>大纲</div>
      <nav className="wb-outline mx-[var(--wb-pad)]" id="wboutline" aria-label="大纲">
        {refs.outline.map(function (sec) {
          return (
            <div className="ol" key={sec.id} data-ol-section={sec.id}>
              <div className="ol-sec">
                <span className="ol-L">{sec.letter}</span>
                <span className="ol-sec-t min-w-0 flex-1 truncate">{sec.title}</span>
              </div>
              {sec.frames.map(function (f) {
                var k = sec.id + '\0' + f.id;
                var n = counts[k] || 0;
                var on = focusKey === k;
                return (
                  <button key={f.id} type="button"
                    className={cn('ol-row', on && 'on')}
                    data-ol-frame={f.id} data-state={on ? 'on' : undefined}
                    title={f.ref + ' ' + f.title}
                    onClick={function () { onPick(sec.id, f.id); }}>
                    <span className="spine" aria-hidden="true"></span>
                    <span className="no">{f.ref}</span>
                    <span className="nm">{f.title}</span>
                    {n ? <span className={cn('ol-n', warns[k] && 'warn')}>{n}</span> : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>
    </section>
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
  // footer 只剩预览内容主题分段（ios-root data-theme，不是 chrome 主题）；
  // 设置入口挪进左栏 head 齿轮（2026-08-15 mock）。
  return (
    <div className="wb-foot flex items-center gap-1.5 px-[var(--wb-pad)] py-2.5" id="wbfoot" hidden={settingsOpen}>
      <Seg id="wbtheme" role="group" aria-label="屏幕主题"
        value={theme} dataAttr="data-theme"
        options={[
          ['light', themeLabel('sun', 'Light'), { title: 'Light', className: THEME_ITEM }],
          ['dark', themeLabel('moon', 'Dark'), { title: 'Dark', className: THEME_ITEM }]
        ]}
        onPick={function (v) { setTheme(v, { save: true }); }} />
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
          <section className="wb-section" data-section="pages">
            <div className={SECTION_HEAD}>Pages</div>
            <PagesNav />
            <DocVersions />
          </section>
          <Outline />
        </ScrollArea>
        <div className="wb-settings-view" id="wbsettings" hidden={!settingsOpen}>
          <SettingsView />
        </div>
        <SideFoot />
      </div>
    </Fragment>
  );
}
