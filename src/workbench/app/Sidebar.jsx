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
//    标注区迁出为独立右栏（app/AnnPanel.jsx，挂 #wbann-side）。
//  - 段头改静态（mock 无折叠 affordance），sectionOpen 机制随 Annotations 段退役。
//  - footer 的 Light/Dark 分段是预览内容主题（ios-root data-theme），原地保留。
//
// 2026-08-16 阶段 2（Web 退役 + Pages 统一）：模式 Seg（iOS/Web/HTML）退役，
// Pages 变单一列表（本地页 + registry dir 条目同列）。
// 2026-08-16f 阶段 7（产物与草稿模型，decisions 08-16f，ROADMAP 阶段 7）：
//  - Page 去类型化：Page 行只剩标题 + hover copy 钮（壳标 pill / data-page-mode
//    随本阶段删除）；类型信息下移到产物条目的 tag（画布 / 文档 / 网页）。
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
import { Fragment, useEffect, useRef, useState } from 'react';
import { useWorkbenchStore, wbSet } from './store.js';
import {
  entriesOfActiveBoard,
  manifestPages,
  setActiveEntry,
  setActivePage,
  showSettings,
  showTabs
} from '../pages.js';
import { setTheme, toggleSideCollapsed } from '../boot-prefs.js';
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
import { COMPONENTS_ID } from '../lib/page-url.js';
import { boardRefs } from '../lib/board-refs.js';
import {
  PAGE_SORT_LABELS,
  formatRelativeTime,
  nextPageSort,
  normalizePageSort,
  sortPages
} from '../lib/page-sort.js';
import { readPrefs, savePrefs } from '../lib/prefs.js';
import { SettingsView } from './SettingsView.jsx';
import { Seg } from './Seg.jsx';
import { WbIcon } from './WbIcon.jsx';
import { RowMenu } from './row-menu.jsx';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { ScrollArea } from './ui/scroll-area.jsx';

// 页面行（Pages 段）与内容区条目行共用同一套行语言；页面行多 accent 边条与
// 行容器 group-hover 联动（行 hover 即行态，不只按钮本身）。
var ROW_ON =
  'bg-secondary font-semibold text-foreground ' +
  'hover:bg-secondary hover:text-foreground group-hover:bg-secondary group-hover:text-foreground';

// 段头（Pages / 内容）：静态 eyebrow，mono 小字 + 宽字距（mock .sec 的收编；
// 2026-08-15 起不再是折叠钮）。
var SECTION_HEAD =
  'wb-section-head px-[var(--wb-pad)] pb-[7px] pt-[13px] font-[var(--wb-font-mono)] ' +
  'text-[9.5px] font-semibold uppercase tracking-[0.12em] ' +
  'text-[color:color-mix(in_srgb,var(--wb-accent)_45%,var(--wb-faint))]';

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

function PageRow(props) {
  var page = props.page;
  var system = !!props.system;
  var active = useWorkbenchStore(function (s) { return s.activePageId === page.id; });
  var customName = useWorkbenchStore(function (s) { return s.pageNames[page.id]; });
  var [renaming, setRenaming] = useState(false);
  var inputRef = useRef(null);
  var doneRef = useRef(false);
  var title = system || typeof customName !== 'string' || !customName.trim() ? page.title : customName.trim();
  // 2026-08-16f 阶段 7：Page 去类型化 —— 行只剩标题；壳标 pill 与
  // data-page-mode 已撤，类型信息下移到「内容」区产物条目的 tag。
  // 2026-08-17：行尾 hover copy 钮退役，复制 / 重命名进右键菜单（row-menu）。

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
  if (!system) {
    menuItems.push({
      kind: 'action', label: '重命名', icon: 'pencil',
      onSelect: function () { doneRef.current = false; setRenaming(true); },
      attr: { 'data-rename-page': page.id }
    });
  }

  return (
    <RowMenu items={menuItems}>
    <div className="wb-page-row group flex min-w-0 items-stretch gap-0.5" data-page-system={system ? '1' : undefined}>
      <button type="button"
        data-vpage={page.id} data-page-system={system ? '1' : undefined}
        data-page-default={page.title}
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
          <span className="wb-page-t min-w-0 flex-1 truncate">{title}</span>
        )}
        {/* 2026-08-17g：内容 mtime 的行内相对时间（mono 小字，视觉语言同
            条目 tag 但无底色；完整时间进 hover title）。无 mtime 的页
            （url 条目 / 本地示例页）不出此元素；紧凑断点整枚隐藏
            （index.html #wbside.compact 规则）。 */}
        {!renaming && page.mtime ? (
          <span className="wb-page-time flex-none font-[var(--wb-font-mono)] text-[9px] leading-none text-[color:var(--wb-faint)]"
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

function PagesNav(props) {
  useWorkbenchStore(function (s) { return s.pageManifest; }); // 订阅触发重渲染；取值走 manifestPages
  var manifestError = useWorkbenchStore(function (s) { return s.pageManifestError; });
  // 相对时间每分钟重算一次（2026-08-17g），否则「5m」会挂到会话结束
  var [now, setNow] = useState(function () { return Date.now(); });
  useEffect(function () {
    var timer = setInterval(function () { setNow(Date.now()); }, 60000);
    return function () { clearInterval(timer); };
  }, []);
  var pages = sortPages(manifestPages(), props.sort);
  return (
    <nav className="wb-pages flex flex-col gap-px pb-1 pt-0.5" id="wbpages">
      <PageRow system page={{ id: COMPONENTS_ID, title: 'Component Library' }} now={now} />
      {pages.map(function (p) { return <PageRow key={p.id} page={p} now={now} />; })}
      {manifestError ? (
        <p className="wb-page-error" title={manifestError}
          style={{ margin: '6px 10px', color: 'var(--wb-danger)', fontSize: '12px', lineHeight: 1.35 }}>
          页面清单读取失败：board.json 缺失或返回的不是 JSON。请检查对应 previews 目录后刷新。
        </p>
      ) : null}
    </nav>
  );
}

/* Pages 段（2026-08-17g）：段头右侧挂排序切换钮 —— default → 最近更新 →
   名称循环，选择持久化在 prefs.pageSort。data-page-sort 是 e2e 契约。 */
function PagesSection() {
  var [sort, setSort] = useState(function () {
    return normalizePageSort(readPrefs().pageSort);
  });
  function cycleSort() {
    var next = nextPageSort(sort);
    savePrefs({ pageSort: next });
    setSort(next);
  }
  return (
    <section className="wb-section" data-section="pages">
      <div className="flex items-center justify-between">
        <div className={SECTION_HEAD}>Pages</div>
        <Button type="button" variant="tool" size="icon"
          className="wb-page-sort me-[var(--wb-pad)] mt-[9px] size-[18px] [&_svg]:opacity-60 hover:[&_svg]:opacity-100"
          data-page-sort={sort}
          aria-label={'Pages 排序：' + PAGE_SORT_LABELS[sort]}
          title={'排序：' + PAGE_SORT_LABELS[sort] + '（点击切换）'}
          onClick={cycleSort}>
          <WbIcon name="sort" size={11} className="size-[11px]" />
        </Button>
      </div>
      <PagesNav sort={sort} />
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

  // section 行点击 = 选中 section（detail 面板展示 section note）+ 定位到
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
          'wb-entry flex flex-1 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-[var(--wb-pad)] py-1.5 text-left font-sans text-[12.5px] text-muted-foreground transition-[color,background-color] duration-150 hover:bg-accent hover:text-accent-foreground group-hover:bg-accent group-hover:text-accent-foreground',
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
      <div className={SECTION_HEAD}>内容</div>
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
          <PagesSection />
          <Contents />
        </ScrollArea>
        <div className="wb-settings-view" id="wbsettings" hidden={!settingsOpen}>
          <SettingsView />
        </div>
        <SideFoot />
      </div>
    </Fragment>
  );
}
