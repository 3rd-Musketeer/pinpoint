// 侧栏整树（P1b cut2，goal-20260810-workbench-react-rebuild）— head（连接状态 +
// 折叠钮）、Pages 段（单一页面列表）、「内容」区（产物/草稿条目 + frame 树）、
// 设置视图壳、footer。原 index.html 静态标记 + pages.js/boot-prefs.js 手工 DOM
// 同步的 React 形态；DOM id / class / 文案与原实现逐一对应（e2e 选择器即契约）。
// 状态全部来自 app/store.js；交互回调仍调 pages.js / boot-prefs.js 的命令式动作
// （页面装载、条目切换、偏好保存的命令式副作用留在那些模块，本文件只做渲染与转发）。
//
// V2 换皮（goal-20260811-workbench-visual-rebuild）：侧栏 chrome 全量收编 shadcn
// 复制件 + Tailwind 类，配方照 V1 基准（SettingsView / app/Seg.jsx 头注释）。
//
// 2026-08-15 侧栏重构（decisions 08-14 左右分工 + 08-15c 大纲延伸线）：
//  - 左栏 = 页面上下文：head（连接状态 + 齿轮进设置视图 + 收起）→ Pages → 大纲；
//    标注区迁出为独立右栏；2026-09-04 右栏取消常驻，改为横条计数钮弹出的
//    列表（app/AnnPopover.jsx）。
//  - 段头改静态（mock 无折叠 affordance），sectionOpen 机制随 Annotations 段退役。
//
// 2026-08-16 阶段 2（Web 退役 + Pages 统一）：模式 Seg（iOS/Web/HTML）退役，
// Pages 变单一列表（本地页 + registry dir 条目同列）。
// 2026-08-16f 阶段 7（产物与草稿模型，decisions 08-16f，ROADMAP 阶段 7）：
//  - Page 去类型化：Page 行只剩标题 + hover copy 钮（壳标 pill / data-page-mode
//    随本阶段删除）；类型信息下移到产物条目的 tag。
//  - 左栏第二层 = 「内容」区（Contents）：产物组（画布条目 + 文档/网页条目，各带
//    mono 类型 tag）+ 草稿组（role=draft 条目，纯标题行，无 tag——草稿恒为整页
//    HTML）。DocVersions 层级退役：多屏 doc 拆成扁平条目，doc 导出挪到条目行的
//    hover icon 钮（复用 PageRow copy 钮模式，点击 = export-core
//    openDocExportDialog(screenId)）。
//  - 画布条目的 frame 树收编旧大纲组件（不再是独立 section）：选中画布条目时树
//    挂在画布条目行下；纯画布页不出条目行、树直接挂区头下。树的交互（点击定位
//    frame + 机身 flash 环、计数徽标、失效红、与标注卡焦点双向同步）全部保留，
//    延伸线几何 CSS 仍在 index.html（.wb-outline 系）。
//  - 坍缩规则（lib/board-entries.js contentsModel）：纯单 doc 屏页整区不出现；
//    单网页条目页仍出行（tag 是类型信息的唯一落点）；混合页条目行全出。
// 2026-08-17 行级动作收编右键菜单（owner 决定）：Pages 行 / 条目行 / frame
// 树行的 locator 复制、doc 导出、页面重命名统一进 app/row-menu.jsx 的右键
// 菜单；行尾 hover 钮（copy / 导出 icon）退役，行宽全部还给标题，窄栏也不再
// 有行尾元素被裁切的面。菜单项 data 契约：data-copy-page / data-copy-frame /
// data-entry-export / data-rename-page（e2e 选择器）。
// 2026-08-17g（Pages 时间与排序）：PageRow 行尾出内容 mtime 的相对时间
// （lib/page-sort.js formatRelativeTime；无 mtime 的页不出）；Pages 段头右侧
// 排序钮循环 default → 最近更新 → 名称（lib/page-sort.js sortPages，持久化
// prefs.pageSort）。语义 = 内容文件改动，标注活动不参与。
//
// 2026-09-04 切片 ②（外壳重设计的左栏内容，评审板 C1 + ADR 0031/0032）：
//  - head 第一眼是产品名与搜索，不是「已连接」：wordmark + 连接小点（状态只剩
//    颜色与 tooltip）+ 齿轮，下面一格搜索框（⌘K 聚焦，打字即筛，Esc 清空）。
//  - 「最近」段（本地记录五条）在「页面」段之上，行尾是打开时刻的相对时间。
//  - 「页面」段 = 文件夹在前、散页在后（lib/page-groups.js 的纯函数给模型，
//    ADR 0032）；夹可折叠、可改名、可删（删夹不删页）；页靠拖放入夹，夹内在
//    「默认」档可拖排序。三条写接口在 lib/folder-api.js。
//  - 行语言统一成 .wb-row（几何与皮肤在 index.html）：页面行行首一个类型图标
//    （画布 / 文档 / 网页，映射在 lib/page-groups.js），文件夹行带 chevron + 夹图标；
//    行尾 11 mono。
//  - 模板页（Component Library / Example Library / Example HTML）默认不显示，
//    开关在预览设置；当前页是模板页时它照旧显示，否则选中态没有落点。
//  - footer 的预览 Light/Dark 搬进预览设置（改名「预览主题」），footer 随之取消。
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkbenchStore, wbSet } from './store.js';
import {
  entriesOfActiveBoard,
  pageGrouping,
  retryPageManifest,
  setActiveEntry,
  setActivePage,
  showSettings,
  showTabs,
  sidebarPages
} from '../pages.js';
import { flashBoardFrame, focusWorkbenchFrame } from '../board-nav.js';
import { openDocExportDialog } from '../export-core.js';
import {
  CANVAS_ENTRY_ID,
  ENTRY_TAG_LABELS,
  canvasBoard,
  contentsModel,
  entryTag,
  resolveEntry
} from '../lib/board-entries.js';
import { boardRefs } from '../lib/board-refs.js';
import {
  PAGE_SORT_LABELS,
  formatRelativeTime,
  nextPageSort,
  normalizePageSort
} from '../lib/page-sort.js';
import {
  filterPages,
  groupPages,
  nextFolderId,
  PAGE_KIND_ICONS,
  pageDisplayTitle,
  pageKindKey,
  recentRows,
  visiblePages
} from '../lib/page-groups.js';
import { putFolders, putPageFolder, putPageOrder } from '../lib/folder-api.js';
import { readPrefs, readRecentPages, savePrefs } from '../lib/prefs.js';
import { SettingsView } from './SettingsView.jsx';
import { WbIcon } from './WbIcon.jsx';
import { RowMenu } from './row-menu.jsx';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { ScrollArea } from './ui/scroll-area.jsx';

// 页面行（Pages 段）与内容区条目行共用同一套行语言；页面行多 accent 边条与
// 行容器 group-hover 联动（行 hover 即行态，不只按钮本身）。
// 行的选中态（2026-09-04 字阶裁决）：accent 10% 底 + 600 字重，正色不退灰。
// hover 是 --wb-hover 4%（shadcn 桥的 accent 就指它，基础类里的 hover:bg-accent
// 已经是这一档）。
var ROW_ON =
  'bg-[var(--wb-sel)] font-semibold text-foreground ' +
  'hover:bg-[var(--wb-sel)] hover:text-foreground group-hover:bg-[var(--wb-sel)] group-hover:text-foreground';
// 行的常态排印：13/500 正色（旧值 12.5 muted —— 裁决把列表行提到正色一档）
var ROW_TEXT = 'text-[13px] font-medium text-foreground';

// 「内容」区组头（产物 / 草稿）：比段头低一档的 mono eyebrow
// （对齐基准 previews/hierarchy-demo 的 .t-sub）。
var GROUP_HEAD =
  'wb-entry-group-head px-[var(--wb-pad)] pb-[3px] pt-[9px] font-[var(--wb-font-mono)] ' +
  'text-[9px] font-semibold tracking-[0.1em] text-[color:var(--wb-faint)]';

// 产物条目的类型 tag（阶段 7，Page 壳标 pill 的下移）：mono 9px 小字 + accent
// 淡底扁平块，无描边；左栏 < 230 紧凑断点整 tag 隐藏（#wbside.compact 规则在
// index.html）。data-tag = canvas/doc/web 是 e2e 契约。
var ENTRY_TAG =
  'wb-entry-tag inline-flex h-[15px] flex-none items-center justify-center rounded ' +
  'bg-[color:color-mix(in_srgb,var(--wb-accent)_9%,transparent)] px-[5px] ' +
  'font-[var(--wb-font-mono)] text-[9px] font-semibold leading-none tracking-[0.05em] ' +
  'text-[color:color-mix(in_srgb,var(--wb-accent)_70%,var(--wb-faint))]';

// 段头（最近 / 页面 / 内容）：11 mono semibold 淡色 eyebrow（C1）。几何与色在
// index.html 的 .wb-section-head 里，这里只挂类名。
var SECTION_HEAD = 'wb-section-head';

// 拖放载荷的 MIME：只认自家的，外面拖进来的文件不会被当成一次入夹。
var DND_TYPE = 'application/x-pinpoint-page';

/* head（2026-09-04 外壳重设计）：收起钮搬去底部横条（#wbside-toggle 在
   app/Strip.jsx，收起去哪、从哪展开是同一个点，G1b）。切片 ② 起第一眼是
   产品名 —— 连接状态收成一颗小点（原来的整句话进 title），齿轮留在右端。 */
function SideHead() {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; });
  var settingsOpen = useWorkbenchStore(function (s) { return s.settingsOpen; });
  var on = !!(snap && snap.available && snap.connected);
  var syncErr = !!(snap && snap.available && snap.syncError);
  return (
    <div className="wb-head">
      <span className="wb-wordmark">pinpoint</span>
      <span id="wbconn" data-state={on ? 'online' : 'offline'} className="wb-conn"
        title={on ? (syncErr ? '已连接 · 上次同步失败' : '标注服务已连接') : '标注服务未连接（请运行 npm run dev）'}>
        <span className="wb-conn-dot" aria-hidden="true"></span>
        <span className="sr-only">{on ? '标注服务已连接' : '标注服务未连接'}</span>
      </span>
      <span className="wb-head-sp"></span>
      <Button type="button" variant="tool" size="icon" id="wbgear"
        aria-label="设置" title="设置"
        data-state={settingsOpen ? 'on' : undefined}
        onClick={function () { showSettings(); }}>
        <WbIcon name="settings" size={15} className="size-[15px]" />
      </Button>
    </div>
  );
}

/* 搜索框（C1）：打字即筛，跨「最近」与「页面」两段按标题或 id 过滤。
   ⌘K / Ctrl+K 聚焦（全局监听，画布上也管用），Esc 清空并交还焦点。 */
function SearchField(props) {
  var inputRef = useRef(null);
  useEffect(function () {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, []);
  return (
    <div className="wb-search" id="wbsearch">
      <WbIcon name="search" size={13} className="wb-search-ic" />
      <input ref={inputRef} type="text" id="wbsearch-input" aria-label="搜索页面"
        placeholder="搜索页面" autoComplete="off" spellCheck="false"
        value={props.value}
        onChange={function (e) { props.onChange(e.target.value); }}
        onKeyDown={function (e) {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          props.onChange('');
          e.target.blur();
        }} />
      <span className="wb-search-kbd" aria-hidden="true">⌘K</span>
    </div>
  );
}

const PagePreferences = createContext(null);

function PageRow(props) {
  var preferences = useContext(PagePreferences);
  var pinned = !!preferences.value.pinned[props.page.id];
  var archived = !!preferences.value.archived[props.page.id];
  var page = props.page;
  var system = !!page.system;
  var active = useWorkbenchStore(function (s) { return s.activePageId === page.id; });
  var customName = useWorkbenchStore(function (s) { return s.pageNames[page.id]; });
  var [renaming, setRenaming] = useState(false);
  var inputRef = useRef(null);
  var doneRef = useRef(false);
  var title = pageDisplayTitle(page, customName === undefined ? null : { [page.id]: customName });
  var dnd = props.dnd;
  // 2026-08-17：行尾 hover copy 钮退役，复制 / 重命名进右键菜单（row-menu）。
  // 2026-09-04：行尾 11 mono 元数据。行首类型图标的来历见 lib/page-groups.js。

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

  var menuItems = [
    { kind: 'copy', label: '复制 @page', text: '@page:' + page.id,
      attr: { 'data-copy-page': page.id } }
  ];
  menuItems.push({ kind: 'action', label: pinned ? '取消置顶' : '置顶', icon: 'pin',
    onSelect: function () { preferences.toggle('pinned', page.id); },
    attr: { 'data-pin-page': page.id } });
  menuItems.push({ kind: 'action', label: archived ? '恢复页面' : '归档', icon: 'archive',
    onSelect: function () { preferences.toggle('archived', page.id); },
    attr: { 'data-archive-page': page.id } });
  if (!system) {
    menuItems.push({
      kind: 'action', label: '重命名', icon: 'pencil',
      onSelect: function () { doneRef.current = false; setRenaming(true); },
      attr: { 'data-rename-page': page.id }
    });
    // 入夹 / 出夹的键盘可达路径（拖放之外的第二条）：菜单里逐个夹列出来。
    menuItems.push({
      kind: 'action', label: '新建文件夹并放入', icon: 'folder-plus',
      onSelect: function () { dnd.createFolderWith(page.id); },
      attr: { 'data-new-folder-with': page.id }
    });
    dnd.folders.forEach(function (folder) {
      if (folder.id === props.folderId) return;
      menuItems.push({
        kind: 'action', label: '移到「' + folder.name + '」', icon: 'folder',
        onSelect: function () { dnd.movePage(page.id, folder.id); },
        attr: { 'data-move-to-folder': folder.id }
      });
    });
    if (props.folderId) {
      menuItems.push({
        kind: 'action', label: '移出文件夹', icon: 'folder',
        onSelect: function () { dnd.movePage(page.id, null); },
        attr: { 'data-move-out': page.id }
      });
    }
  }

  var dropHint = dnd.dropHintFor(page.id);

  return (
    <RowMenu items={menuItems}>
    <div className="wb-page-row group" data-page-system={system ? '1' : undefined}>
      <button type="button"
        data-vpage={page.id} data-page-system={system ? '1' : undefined}
        data-page-default={page.title}
        data-state={active ? 'on' : undefined}
        data-drop-hint={dropHint || undefined}
        draggable={!system && !renaming}
        onDragStart={function (e) { dnd.onDragStart(e, page.id, props.folderId || null); }}
        onDragEnd={function () { dnd.onDragEnd(); }}
        onDragOver={function (e) { dnd.onPageDragOver(e, page.id, props.folderId || null); }}
        onDragLeave={function () { dnd.onDragLeave(); }}
        onDrop={function (e) { dnd.onPageDrop(e, page.id, props.folderId || null); }}
        className={cn('wb-row wb-page', props.indent && 'ind', active && 'on', renaming && 'renaming')}
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
            className="wb-page-rename h-auto flex-1 rounded-md border-0 bg-transparent px-1 py-0 text-[13px] font-semibold text-foreground shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--wb-accent)_55%,transparent)]"
            defaultValue={title} onKeyDown={onRenameKey}
            onBlur={function (e) { finishRename(true, e.target.value); }} />
        ) : (
          <Fragment>
            <WbIcon name={PAGE_KIND_ICONS[pageKindKey(page)]} size={14}
              className="wb-row-glyph wb-page-kind" data-kind={pageKindKey(page)} aria-hidden="true" />
            <span className="wb-page-t wb-row-t">{title}</span>
          </Fragment>
        )}
        {/* 2026-08-17g：内容 mtime 的行内相对时间（mono 小字，视觉语言同
            条目 tag 但无底色；完整时间进 hover title）。无 mtime 的页
            （url 条目 / 本地示例页）不出此元素——行尾那一格就留空，标题
            不许借位（2026-09-04 切片 ② 第 10 条）；紧凑断点整枚隐藏
            （index.html #wbside.compact 规则）。 */}
        {!renaming && page.mtime ? (
          <span className="wb-page-time wb-row-m"
            data-page-time={page.id}
            title={new Date(page.mtime).toLocaleString('zh-CN', { hour12: false })}>
            {formatRelativeTime(page.mtime, props.now || Date.now())}
          </span>
        ) : null}
      </button>
    </div>
    </RowMenu>
  );
}

/* 文件夹行（ADR 0032）：chevron + 夹图标 + 名称，整行是折叠钮，也是入夹的落点。
   右键 = 重命名（行内编辑，与页面行同一套）/ 删除文件夹（删夹不删页）。 */
function FolderRow(props) {
  var folder = props.folder;
  var dnd = props.dnd;
  var renaming = dnd.renamingFolderId === folder.id;
  var inputRef = useRef(null);
  var doneRef = useRef(false);

  useEffect(function () {
    if (renaming && inputRef.current) {
      doneRef.current = false;
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  function finishRename(commit, value) {
    if (doneRef.current) return;
    doneRef.current = true;
    var next = String(value == null ? '' : value).trim();
    dnd.finishFolderRename(folder.id, commit && next ? next : null);
  }

  return (
    <RowMenu items={[
      { kind: 'action', label: '重命名', icon: 'pencil',
        onSelect: function () { dnd.startFolderRename(folder.id); },
        attr: { 'data-rename-folder': folder.id } },
      { kind: 'action', label: '删除文件夹', icon: 'trash',
        onSelect: function () { dnd.removeFolder(folder.id); },
        attr: { 'data-remove-folder': folder.id } },
      { kind: 'action', label: '新建文件夹', icon: 'folder-plus',
        onSelect: function () { dnd.createFolderWith(null); },
        attr: { 'data-new-folder': '1' } }
    ]}>
    <div className="wb-folder-row group">
      <button type="button"
        className={cn('wb-row wb-folder', dnd.dropFolderId === folder.id && 'drop')}
        data-folder={folder.id}
        data-state={props.collapsed ? 'collapsed' : 'open'}
        aria-expanded={!props.collapsed}
        onDragOver={function (e) { dnd.onFolderDragOver(e, folder.id); }}
        onDragLeave={function () { dnd.onDragLeave(); }}
        onDrop={function (e) { dnd.onFolderDrop(e, folder.id); }}
        onClick={function () { if (!renaming) dnd.toggleFolder(folder.id); }}>
        <WbIcon name={props.collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="wb-row-chv" />
        <WbIcon name="folder" size={14} className="wb-row-glyph" />
        {renaming ? (
          <Input ref={inputRef} type="text" aria-label="重命名文件夹"
            className="wb-folder-rename h-auto flex-1 rounded-md border-0 bg-transparent px-1 py-0 text-[13px] font-semibold text-foreground shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--wb-accent)_55%,transparent)]"
            defaultValue={folder.name}
            onClick={function (e) { e.stopPropagation(); }}
            onKeyDown={function (e) {
              if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); finishRename(true, e.target.value); }
              else if (e.key === 'Escape') { e.preventDefault(); finishRename(false, e.target.value); }
            }}
            onBlur={function (e) { finishRename(true, e.target.value); }} />
        ) : (
          <span className="wb-row-t wb-folder-t">{folder.name}</span>
        )}
      </button>
    </div>
    </RowMenu>
  );
}

/* 「最近」段（2026-09-04 裁决 5c）：本地记录的最近打开五条，行尾是打开时刻的
   相对时间（不是内容 mtime —— 这一段回答「我刚才在看什么」）。空则整段不出。 */
function RecentSection(props) {
  var rows = props.rows;
  if (!rows.length) return null;
  return (
    <section className="wb-section" data-section="recent">
      <div className={SECTION_HEAD}>最近</div>
      <nav className="wb-side-nav" id="wbrecent" aria-label="最近打开">
        {rows.map(function (row) {
          return (
            <RecentRow key={row.page.id} page={row.page} at={row.at} now={props.now} />
          );
        })}
      </nav>
    </section>
  );
}

function RecentRow(props) {
  var page = props.page;
  var active = useWorkbenchStore(function (s) { return s.activePageId === page.id; });
  var customName = useWorkbenchStore(function (s) { return s.pageNames[page.id]; });
  var title = pageDisplayTitle(page, customName === undefined ? null : { [page.id]: customName });
  return (
    <button type="button" data-recent-page={page.id}
      data-state={active ? 'on' : undefined}
      className={cn('wb-row wb-recent', active && 'on')}
      onClick={function () { showTabs(); setActivePage(page.id); }}>
      <WbIcon name={PAGE_KIND_ICONS[pageKindKey(page)]} size={14}
        className="wb-row-glyph wb-page-kind" data-kind={pageKindKey(page)} aria-hidden="true" />
      <span className="wb-row-t">{title}</span>
      <span className="wb-row-m">{formatRelativeTime(props.at, props.now)}</span>
    </button>
  );
}

/* Pages 段（2026-08-17g 排序钮 + 2026-09-04 分组层）：
   段头右侧仍是排序切换钮（default → 最近更新 → 名称，持久化 prefs.pageSort，
   data-page-sort 是 e2e 契约）；段身 = 文件夹在前、散页在后，最后一行「新建
   文件夹」。散页区整块是「拖出来」的落点。 */
function PagesSection(props) {
  useWorkbenchStore(function (s) { return s.pageManifest; }); // 订阅触发重渲染；取值走 sidebarPages
  var manifestError = useWorkbenchStore(function (s) { return s.pageManifestError; });
  var dnd = props.dnd;
  var model = props.model;

  return (
    <section className="wb-section" data-section="pages">
      <div className="wb-section-head-row">

        <Button type="button" variant="tool" size="icon"
          className="wb-page-sort size-[18px] [&_svg]:opacity-60 hover:[&_svg]:opacity-100"
          data-page-sort={props.sort}
          aria-label={'Pages 排序：' + PAGE_SORT_LABELS[props.sort]}
          title={'排序：' + PAGE_SORT_LABELS[props.sort] + '（点击切换）'}
          onClick={props.onCycleSort}>
          <WbIcon name="sort" size={11} className="size-[11px]" />
        </Button>
      </div>
      <nav className="wb-side-nav wb-pages" id="wbpages">
        {model.folders.map(function (folder) {
          var collapsed = dnd.isCollapsed(folder);
          return (
            <Fragment key={folder.id}>
              <FolderRow folder={folder} collapsed={collapsed} dnd={dnd} />
              {collapsed ? null : folder.pages.map(function (page) {
                return (
                  <PageRow key={page.id} page={page} indent folderId={folder.id}
                    dnd={dnd} now={props.now} />
                );
              })}
            </Fragment>
          );
        })}
        <div className="wb-loose"
          onDragOver={function (e) { dnd.onLooseDragOver(e); }}
          onDragLeave={function () { dnd.onDragLeave(); }}
          onDrop={function (e) { dnd.onLooseDrop(e); }}
          data-drop-hint={dnd.looseDrop ? 'into' : undefined}>
          {model.loose.map(function (page) {
            return <PageRow key={page.id} page={page} dnd={dnd} now={props.now} />;
          })}
        </div>
        <button type="button" className="wb-row wb-new-folder" data-new-folder="1"
          onClick={function () { dnd.createFolderWith(null); }}>
          <span className="wb-row-slot" aria-hidden="true"></span>
          <WbIcon name="folder-plus" size={14} className="wb-row-glyph" />
          <span className="wb-row-t">新建文件夹</span>
        </button>
        {dnd.error ? (
          <p className="wb-folder-error" role="alert">{dnd.error}</p>
        ) : null}
        {manifestError ? (
          <div className="wb-page-error" style={{ margin: '6px 10px' }}>
            <p title={manifestError}
              style={{ margin: 0, color: 'var(--wb-danger)', fontSize: '12px', lineHeight: 1.35 }}>
              页面清单读取失败：board.json 缺失或返回的不是 JSON。检查对应 previews 目录后重试。
            </p>
            {/* 与板失败面板同一条规矩（2026-09-04）：错误状态自带回到可用状态的动作 */}
            <button type="button" className="wb-screen-err-act" data-page-manifest-retry
              style={{ marginTop: '8px' }}
              onClick={function () { retryPageManifest(); }}>重试</button>
          </div>
        ) : null}
      </nav>
    </section>
  );
}

/* frame 树（decisions 2026-08-15c 大纲的收编，2026-08-16f 阶段 7）：当前页画布条目
   的 section → frame 树，行 = mono 引用号 + 屏名 + 计数徽标（红 = 含失效锚点）。
   延伸线几何（.ol-*）在 index.html；点击复用 board-nav 的 frame 定位（与标注卡
   goToMark 同一导航源），机身闪 focus 环。选中态（store.focusFrameKey）由树点击
   与标注卡点击双向写入。树是画布语汇：只覆盖画布屏（canvasBoard 滤掉 doc 屏，
   引用号与图注/导出树同源）。 */
function FrameTree(props) {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; });
  var focusKey = useWorkbenchStore(function (s) { return s.focusFrameKey; });
  var focusSection = useWorkbenchStore(function (s) { return s.focusSectionId; });
  var refs = props.refs;

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
    wbSet({ focusFrameKey: sectionId + '\0' + screenId, focusSectionId: null, focusAnnN: null });
    focusWorkbenchFrame(sectionId, screenId);
    flashBoardFrame(sectionId, screenId);
  }

  // section 行点击 = 选中 section+ 定位到
  // 该组第一帧（与 frame 行同一套定位原语）
  function onPickSection(sec) {
    wbSet({ focusSectionId: sec.id, focusFrameKey: null, focusAnnN: null });
    var first = sec.frames && sec.frames[0];
    if (first) focusWorkbenchFrame(sec.id, first.id);
  }

  return (
    <nav className="wb-outline mx-[var(--wb-pad)]" id="wboutline" aria-label="大纲">
      {refs.outline.map(function (sec) {
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
            {sec.frames.map(function (f) {
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

/* 条目行（2026-08-16f 阶段 7）：产物行 = 标题 + 类型 tag（data-tag），草稿行 =
   纯标题（草稿恒为整页 HTML，无 tag）。2026-08-17 起行级动作进右键菜单
   （hover icon 钮退役）：doc 条目 = 复制 @frame + 导出（export-core
   openDocExportDialog(screenId)，不切换选中条目）；画布条目 = 复制 @page
   （画布即页面的默认视图，@frame 语法不覆盖它）。 */
function EntryRow(props) {
  var entry = props.entry;
  var on = !!props.on;
  // 草稿行不打类型 tag（草稿恒为整页 HTML，无类型维度）
  var tagKey = entry.role === 'draft' ? null : entryTag(entry);
  var menuItems = entry.kind === 'doc'
    ? [
        { kind: 'copy', label: '复制 @frame', text: '@frame:' + props.pageId + '/' + entry.id,
          attr: { 'data-copy-frame': props.pageId + '/' + entry.id } },
        { kind: 'action', label: '导出…', icon: 'export-image',
          onSelect: function () { openDocExportDialog(entry.id); },
          attr: { 'data-entry-export': entry.id } }
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
        onClick={function () { setActiveEntry(entry.id); }}>
        <span className="wb-entry-t min-w-0 flex-1 truncate">{entry.title}</span>
        {tagKey ? (
          <span className={ENTRY_TAG} data-tag={tagKey}>{ENTRY_TAG_LABELS[tagKey]}</span>
        ) : null}
      </button>
    </div>
    </RowMenu>
  );
}

/* 「内容」区（2026-08-16f 阶段 7，decisions 08-16f / ROADMAP 阶段 7，对齐基准
   previews/hierarchy-demo）：左栏第二层，回答「这件事里我在看哪一份」。
   产物组（画布条目 + 文档/网页条目，各带类型 tag）+ 草稿组（role=draft 条目）；
   画布条目选中时其 frame 树（旧大纲）挂在画布行下。坍缩规则由
   lib/board-entries.js contentsModel 纯函数给出（单条目不显示目录）：
   - 纯画布页：无条目行，frame 树直接挂区头下（旧大纲体验）；
   - 纯单 doc 屏页：整区不出现；
   - 混合页 / 多文档页 / 单网页条目页：组头 + 条目行全出。 */
function Contents() {
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var active = useWorkbenchStore(function (s) { return s.activeBoard; });
  var activeEntryId = useWorkbenchStore(function (s) { return s.activeEntryId; });
  // 板未装载 / 换页途中不出内容区
  if (!active || active.pageId !== activePageId) return null;
  var entries = entriesOfActiveBoard();
  var model = contentsModel(entries);
  // frame 树 = 画布语汇，只覆盖画布屏（canvasBoard 滤掉 doc 屏，引用号与
  // 图注/导出树同源）；展开时机 = 画布条目选中（阅读器态下定位无意义）。
  var refs = model.tree ? boardRefs(canvasBoard(active.board)) : null;
  var hasTree = !!(refs && refs.outline.length);
  var current = resolveEntry(entries, activeEntryId);
  var treeOpen = hasTree && !!current && current.kind === 'canvas';
  // 空板 / 坍缩（contentsModel）/ 纯画布但树为空 → 整区不出现
  if (model.hidden || (!model.productRows.length && !model.drafts.length && !hasTree)) return null;

  var productRows = model.productRows.map(function (entry) {
    var rows = [
      <EntryRow key={entry.id} entry={entry} pageId={activePageId}
        on={!!current && current.id === entry.id} />
    ];
    // 画布条目展开（选中）时 frame 树挂在其行下（收编旧大纲；不再是独立 section）
    if (entry.id === CANVAS_ENTRY_ID && treeOpen) {
      rows.push(
        <div key="canvas-tree" className="wb-entry-tree ms-[7px]">
          <FrameTree refs={refs} pageId={activePageId} />
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
          // 纯画布页：条目行坍缩，frame 树直接挂区头下
          <FrameTree refs={refs} pageId={activePageId} />
        ) : null}
        {model.drafts.length ? (
          <div className="wb-entry-group flex flex-col gap-px" data-group="draft">
            <div className={GROUP_HEAD}>草稿</div>
            {model.drafts.map(function (entry) {
              return (
                <EntryRow key={entry.id} entry={entry} pageId={activePageId}
                  on={!!current && current.id === entry.id} />
              );
            })}
          </div>
        ) : null}
      </nav>
    </section>
  );
}

/* 分组层的交互状态与三条写接口的调用点（ADR 0032）。折叠是本地先动、后台再写
   （折叠一个夹不该等一次网络往返）；其余动作一律「写成功了才变」——登记表是
   事实源，乐观更新会让一次被拒的写看起来成功了。 */
function useFolderActions(folders, model, sort) {
  var [collapsedLocal, setCollapsedLocal] = useState({});
  var [renamingFolderId, setRenamingFolderId] = useState(null);
  // 拖动中的页存在 ref 里，不存 state：dragstart 与第一个 dragover 之间可能还没
  // 有过一次渲染，读 state 会读到 null，那一下拖放就被当成「没在拖」丢掉。
  var draggingRef = useRef(null);
  var [dropFolderId, setDropFolderId] = useState(null);
  var [dropPage, setDropPage] = useState(null);
  var [looseDrop, setLooseDrop] = useState(false);
  var [error, setError] = useState(null);

  function fail(e) {
    setError(String(e && e.message ? e.message : e));
  }
  function run(promise) {
    setError(null);
    return promise.catch(fail);
  }

  function resolvedCollapsed(folder, local) {
    var v = local[folder.id];
    return v === undefined ? !!folder.collapsed : v;
  }

  /** 整表写入的载荷；local 是折叠态的本地覆盖（缺省用当前的）。 */
  function foldersPayload(local) {
    local = local || collapsedLocal;
    return folders.map(function (folder) {
      var out = { id: folder.id };
      if (folder.name && folder.name !== folder.id) out.name = folder.name;
      if (resolvedCollapsed(folder, local)) out.collapsed = true;
      return out;
    });
  }

  function clearDrop() {
    setDropFolderId(null);
    setDropPage(null);
    setLooseDrop(false);
  }

  var actions = {
    folders: model.folders,
    renamingFolderId: renamingFolderId,
    dropFolderId: dropFolderId,
    looseDrop: looseDrop,
    error: error,

    isCollapsed: function (folder) { return resolvedCollapsed(folder, collapsedLocal); },

    toggleFolder: function (id) {
      var folder = folders.find(function (f) { return f.id === id; });
      if (!folder) return;
      var merged = Object.assign({}, collapsedLocal);
      merged[id] = !resolvedCollapsed(folder, collapsedLocal);
      setCollapsedLocal(merged);
      // 写完（成功登记表已更新、失败则回到登记表的值）本地覆盖都该退场，
      // 否则一次被拒的写会让这个夹永远与登记表不一致。
      run(putFolders(foldersPayload(merged))).then(function () {
        setCollapsedLocal(function (prev) {
          var next = Object.assign({}, prev);
          delete next[id];
          return next;
        });
      });
    },

    createFolderWith: function (pageId) {
      var name = '新建文件夹';
      var id = nextFolderId(folders.map(function (f) { return f.id; }), name);
      run(putFolders(foldersPayload().concat([{ id: id, name: name }])).then(function () {
        setRenamingFolderId(id);
        if (pageId) return putPageFolder(pageId, id);
        return null;
      }));
    },

    startFolderRename: function (id) { setRenamingFolderId(id); },

    finishFolderRename: function (id, name) {
      setRenamingFolderId(null);
      if (!name) return;
      run(putFolders(foldersPayload().map(function (f) {
        return f.id === id ? Object.assign({}, f, { name: name }) : f;
      })));
    },

    removeFolder: function (id) {
      // 删夹不删页：里面的页退回散页区，服务端在同一次原子写里释放。
      run(putFolders(foldersPayload().filter(function (f) { return f.id !== id; })));
    },

    movePage: function (pageId, folderId) {
      run(putPageFolder(pageId, folderId));
    },

    /* ---- 拖放 ---- */
    onDragStart: function (e, pageId, folderId) {
      draggingRef.current = { id: pageId, folder: folderId };
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(DND_TYPE, pageId);
      e.dataTransfer.setData('text/plain', pageId);
    },
    onDragEnd: function () { draggingRef.current = null; clearDrop(); },
    onDragLeave: function () { clearDrop(); },

    onFolderDragOver: function (e, folderId) {
      if (!draggingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setDropFolderId(folderId);
      setDropPage(null);
      setLooseDrop(false);
    },
    onFolderDrop: function (e, folderId) {
      var drag = draggingRef.current;
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = null;
      clearDrop();
      if (drag.folder === folderId) return;
      actions.movePage(drag.id, folderId);
    },

    /* 夹内的页行既是入夹落点，也是「默认」档下的重排落点：同夹同档 = 排序，
       否则 = 入夹（拖到别人夹里的某一行上，意思显然是进那个夹）。 */
    onPageDragOver: function (e, pageId, folderId) {
      var drag = draggingRef.current;
      if (!drag || drag.id === pageId) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (folderId && drag.folder === folderId && sort === 'default') {
        var box = e.currentTarget.getBoundingClientRect();
        var before = e.clientY < box.top + box.height / 2;
        // dragover 连续触发；落点没变就别换对象，整栏免得跟着每次指针移动重渲染。
        setDropPage(function (prev) {
          return prev && prev.id === pageId && prev.before === before ? prev : { id: pageId, before: before };
        });
        setDropFolderId(null);
      } else if (folderId) {
        setDropFolderId(folderId);
        setDropPage(null);
      } else {
        setDropPage(null);
        setDropFolderId(null);
        setLooseDrop(true);
      }
    },
    onPageDrop: function (e, pageId, folderId) {
      var drag = draggingRef.current;
      if (!drag || drag.id === pageId) return;
      e.preventDefault();
      e.stopPropagation();
      var hint = dropPage;
      draggingRef.current = null;
      clearDrop();
      if (folderId && drag.folder === folderId && sort === 'default') {
        var group = model.folders.filter(function (f) { return f.id === folderId; })[0];
        if (!group) return;
        var ids = group.pages.map(function (p) { return p.id; }).filter(function (id) { return id !== drag.id; });
        var at = ids.indexOf(pageId);
        if (at < 0) return;
        ids.splice(hint && hint.before ? at : at + 1, 0, drag.id);
        actions.reorderPages(ids);
        return;
      }
      if (folderId) {
        if (drag.folder !== folderId) actions.movePage(drag.id, folderId);
        return;
      }
      if (drag.folder) actions.movePage(drag.id, null);
    },
    reorderPages: function (ids) { run(putPageOrder(ids)); },

    onLooseDragOver: function (e) {
      var drag = draggingRef.current;
      if (!drag || !drag.folder) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setLooseDrop(true);
      setDropFolderId(null);
    },
    onLooseDrop: function (e) {
      var drag = draggingRef.current;
      if (!drag) return;
      e.preventDefault();
      draggingRef.current = null;
      clearDrop();
      if (drag.folder) actions.movePage(drag.id, null);
    },

    dropHintFor: function (pageId) {
      if (!dropPage || dropPage.id !== pageId) return null;
      return dropPage.before ? 'before' : 'after';
    }
  };
  return actions;
}

export function Sidebar() {
  var [sidebarTab, setSidebarTab] = useState('pages');
  var [showArchived, setShowArchived] = useState(false);
  var [pagePreferences, setPagePreferences] = useState(function () {
    var stored = readPrefs().pagePreferences || {};
    return { pinned: stored.pinned || {}, archived: stored.archived || {} };
  });
  function togglePagePreference(kind, pageId) {
    setPagePreferences(function (current) {
      var next = { ...current, [kind]: { ...current[kind] } };
      if (next[kind][pageId]) delete next[kind][pageId];
      else next[kind][pageId] = true;
      savePrefs({ pagePreferences: next });
      return next;
    });
  }
  var settingsOpen = useWorkbenchStore(function (s) { return s.settingsOpen; });
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var showTemplates = useWorkbenchStore(function (s) { return s.showTemplatePages; });
  var [query, setQuery] = useState('');
  var [sort, setSort] = useState(function () { return normalizePageSort(readPrefs().pageSort); });
  // 相对时间每分钟重算一次（2026-08-17g），否则「5m」会挂到会话结束
  var [now, setNow] = useState(function () { return Date.now(); });
  useEffect(function () {
    var timer = setInterval(function () { setNow(Date.now()); }, 60000);
    return function () { clearInterval(timer); };
  }, []);
  var manifest = useWorkbenchStore(function (s) { return s.pageManifest; });

  // 分组模型只在清单 / 开关 / 当前页 / 搜索 / 排序变了才重算 —— 拖放中的落点态
  // 与每分钟的时间 tick 都会让整栏重渲染，别让它们顺带重排一遍。
  var derived = useMemo(function () {
    var grouping = pageGrouping();
    var pages = filterPages(
      visiblePages(sidebarPages(), { showTemplates: showTemplates, keepId: activePageId }),
      query
    );
    return {
      grouping: grouping,
      pages: pages.filter(function (page) { return !pagePreferences.archived[page.id]; }),
      pinned: pages.filter(function (page) { return !pagePreferences.archived[page.id] && pagePreferences.pinned[page.id]; }),
      archived: pages.filter(function (page) { return pagePreferences.archived[page.id]; }),
      model: groupPages({
        pages: pages.filter(function (page) { return !pagePreferences.archived[page.id] && !pagePreferences.pinned[page.id]; }),
        folders: grouping.folders,
        pageFolders: grouping.pageFolders,
        pageOrder: grouping.pageOrder,
        sort: sort
      })
    };
  }, [manifest, showTemplates, activePageId, query, sort, pagePreferences]);
  var model = derived.model;
  var dnd = useFolderActions(derived.grouping.folders, model, sort);
  // 「最近」与「页面」吃同一份过滤结果 —— 搜索是跨段的一条规则，不是每段一套。
  var recent = recentRows(readRecentPages(), derived.pages);

  return (
    <Fragment>
      <SideHead />
      {settingsOpen ? null : <SearchField value={query} onChange={setQuery} />}
      {!settingsOpen && <div className="wb-side-tabs" role="tablist" aria-label="侧栏视图">
        {['pages', 'outline'].map(function (tab) { return <button key={tab} role="tab" type="button" aria-selected={sidebarTab === tab} tabIndex={sidebarTab === tab ? 0 : -1} onKeyDown={function (event) {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            setSidebarTab(tab === 'pages' ? 'outline' : 'pages');
            var sibling = tab === 'pages' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
            if (sibling) sibling.focus();
          }
        }} onClick={function () { setSidebarTab(tab); }}>{tab === 'pages' ? '页面' : '大纲'}</button>; })}
      </div>}
      <div className="wb-side-body">
        <ScrollArea className="wb-side-scroll min-h-0 flex-1" id="wbside-scroll" hidden={settingsOpen}>
          <div hidden={sidebarTab !== 'pages'}>
          <PagePreferences.Provider value={{ value: pagePreferences, toggle: togglePagePreference }}>
          {showArchived ? <nav aria-label="已归档页面">
            {derived.archived.map(function (page) { return <PageRow key={page.id} page={page} dnd={dnd} now={now} />; })}
            {!derived.archived.length && <p className="wb-row">没有归档页面</p>}
          </nav> : <>
          {derived.pinned.length > 0 && <nav className="wb-pinned-pages" aria-label="置顶页面">
            {derived.pinned.map(function (page) { return <PageRow key={page.id} page={page} folderId={derived.grouping.pageFolders[page.id]} dnd={dnd} now={now} />; })}
          </nav>}
          <RecentSection rows={recent.filter(function (row) { return !pagePreferences.pinned[row.page.id]; })} now={now} />
          <PagesSection model={model} dnd={dnd} sort={sort} now={now}
            onCycleSort={function () {
              var next = nextPageSort(sort);
              savePrefs({ pageSort: next });
              setSort(next);
            }} />
          </>}
          </PagePreferences.Provider>
          </div>
          <div hidden={sidebarTab !== 'outline'}><Contents /></div>
        </ScrollArea>
        {!settingsOpen && sidebarTab === 'pages' && <div className="wb-side-footer">
          <button type="button" className="wb-row wb-archive-toggle" data-show-archived aria-pressed={showArchived} onClick={function () { setShowArchived(!showArchived); }}><WbIcon name={showArchived ? 'chevron-left' : 'archive'} size={14} />{showArchived ? '返回页面' : '已归档'}</button>
        </div>}
        <div className="wb-settings-view" id="wbsettings" hidden={!settingsOpen}>
          <SettingsView />
        </div>
      </div>
    </Fragment>
  );
}
