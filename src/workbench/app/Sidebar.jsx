// 侧栏整树（P1b cut2，goal-20260810-workbench-react-rebuild）— head（连接状态 +
// 折叠钮）、Pages 段（单一页面列表）、设置视图壳。2026-10-10 起大纲不在左栏，
// 画在页 tab 条的浮层里（app/OutlinePopover.jsx）。原 index.html 静态标记 +
// pages.js/boot-prefs.js 手工 DOM 同步的 React 形态；DOM id / class / 文案与
// 原实现逐一对应（e2e 选择器即契约）。
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
//  - 左栏第二层 = 「内容」区（Contents）：产物组（画布条目 + 文档条目，各带
//    mono 类型 tag）+ 草稿组（role=draft 条目，纯标题行，无 tag——草稿恒为整页
//    HTML）。DocVersions 层级退役：多屏 doc 拆成扁平条目。
//  - 画布条目的 frame 树收编旧大纲组件（不再是独立 section）：选中画布条目时树
//    挂在画布条目行下；纯画布页不出条目行、树直接挂区头下。树的交互（点击定位
//    frame + 机身 flash 环、计数徽标、失效红、与标注卡焦点双向同步）全部保留，
//    延伸线几何 CSS 仍在 index.html（.wb-outline 系）。
//  - 坍缩规则（lib/board-entries.js contentsModel）：纯单 doc 屏页整区不出现；
//    混合页条目行全出。
// 2026-08-17 行级动作收编右键菜单（owner 决定）：Pages 行 / 条目行 / frame
// 树行的 locator 复制、页面重命名统一进 app/row-menu.jsx 的右键
// 菜单；行尾 hover 钮（copy / 导出 icon）退役，行宽全部还给标题，窄栏也不再
// 有行尾元素被裁切的面。菜单项 data 契约：data-copy-page / data-copy-frame /
// data-rename-page（e2e 选择器）。
// 2026-08-17g（Pages 时间与排序）：PageRow 行尾出内容 mtime 的相对时间
// （lib/page-sort.js formatRelativeTime；无 mtime 的页不出）；Pages 段头右侧
// 排序菜单提供依据与方向的组合选项（lib/page-sort.js，持久化 prefs.pageSort）。
//
// 2026-09-04 切片 ②（外壳重设计的左栏内容，评审板 C1 + ADR 0031/0032）：
//  - head 第一眼是产品名与搜索，不是「已连接」：wordmark + 连接小点（状态只剩
//    颜色与 tooltip）+ 齿轮，下面一格搜索框（⌘K 聚焦，打字即筛，Esc 清空）。
//  - 「最近」段（本地记录五条）在「页面」段之上，行尾是打开时刻的相对时间。
//  - 「页面」段按排序菜单的档位列出全部页（lib/page-sort.js）。
//  - 行语言统一成 .wb-row（几何与皮肤在 index.html）：页面行行首一个类型图标
//    （画布 / 文档，映射在 lib/page-groups.js）；行尾 11 mono。
//  - 模板页（Component Library / Example Library / Example HTML）默认不显示，
//    开关在预览设置；当前页是模板页时它照旧显示，否则选中态没有落点。
//  - footer 的预览 Light/Dark 搬进预览设置（改名「预览主题」），footer 随之取消。
//
// 2026-10-10：大纲离开左栏。产物 / 草稿条目和 frame 树改由页 tab 条上的浮层打开
// （app/OutlinePopover.jsx）。左栏 icon tab 只剩「页面 / 已归档」。
//
// 2026-10-13（pp3，owner 选 A）：「页面」tab 顶上加一组「文章」（app/ArticlesSection.jsx，
// project → 文章）；原来的置顶、最近与页面列表原样搬进下面的「页面」组。
import { emitServerEvent, setServerEventsOnline } from '../server-events.js';
import { registerEmbedPark } from '../embed-park.js';
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PageInfo } from './PageInfo.jsx';
import { PageSortMenu } from './PageSortMenu.jsx';
import { useWorkbenchStore, wbSet } from './store.js';
import {
  retryPageManifest,
  refreshRegistry,
  setActivePage,
  showSettings,
  showTabs,
  manifestPages
} from '../pages.js';
import {
  PAGE_SORT_LABELS,
  formatRelativeTime,
  pageTime,
  activityRows,
  normalizePageSort,
  sortPages
} from '../lib/page-sort.js';
import {
  PAGE_KIND_ICONS,
  pageDisplayTitle,
  pageKindKey
} from '../lib/page-groups.js';
import { readPrefs, savePrefs } from '../lib/prefs.js';
import { isComposingKey } from '../../shared/keys.js';
import { SettingsView } from './SettingsView.jsx';
import { ArticlesSection } from './ArticlesSection.jsx';
import { WbIcon } from './WbIcon.jsx';
import { RowMenu } from './row-menu.jsx';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';
import { Input } from './ui/input.jsx';
import { ScrollArea } from './ui/scroll-area.jsx';

// 段头（最近 / 页面）：11 mono semibold 淡色 eyebrow（C1）。几何与色在
// index.html 的 .wb-section-head 里，这里只挂类名。
var SECTION_HEAD = 'wb-section-head';

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

const PagePreferences = createContext(null);

function PageRow(props) {
  var preferences = useContext(PagePreferences);
  var pinned = !!preferences.value.pinned[props.page.id];
  var archived = !!preferences.value.archived[props.page.id];
  var page = props.page;
  var system = !!page.system;
  var active = useWorkbenchStore(function (s) { return s.activePageId === page.id; });
  var timeSort = props.recent ? 'default' : preferences.sort;
  var time = pageTime(page, timeSort);
  var customName = useWorkbenchStore(function (s) { return s.pageNames[page.id]; });
  var [renaming, setRenaming] = useState(false);
  var inputRef = useRef(null);
  var doneRef = useRef(false);
  var title = pageDisplayTitle(page, customName === undefined ? null : { [page.id]: customName });
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
    // 组字中的 Enter / Esc 是输入法在确认候选，不是保存 / 取消（r5b B10：全库
    // 唯一漏输入法守卫的输入框）。读 nativeEvent：React 合成事件不透传
    // isComposing（只拷 key / keyCode 等固定字段），Safari 组字 Enter 靠
    // keyCode 229 也读得到，Firefox（keyCode 13 + isComposing）只有原生事件上有。
    if (isComposingKey(e.nativeEvent)) return;
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
    { kind: 'action', label: '查看信息', icon: 'file-text',
      onSelect: function () { preferences.showInfo({ ...page, title: title }); },
      attr: { 'data-page-info': page.id } },
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
  }

  return (
    <RowMenu items={menuItems}>
    <div className="wb-page-row group" data-page-system={system ? '1' : undefined}>
      <button type="button"
        data-vpage={props.recent ? undefined : page.id}
        data-recent-page={props.recent ? page.id : undefined} data-page-system={system ? '1' : undefined}
        data-page-default={page.title}
        data-state={active ? 'on' : undefined}
        className={cn('wb-row wb-page', props.recent && 'wb-recent', active && 'on', renaming && 'renaming')}
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
            （本地示例页）不出此元素——行尾那一格就留空，标题
            不许借位（2026-09-04 切片 ② 第 10 条）；紧凑断点整枚隐藏
            （index.html #wbside.compact 规则）。 */}
        {!renaming && time ? (
          <span className="wb-page-time wb-row-m"
            data-page-time={page.id}
            title={(PAGE_SORT_LABELS[timeSort] && !['default', 'name', 'name-desc'].includes(timeSort) ? PAGE_SORT_LABELS[timeSort] : '最近变动') + '：' + new Date(time).toLocaleString('zh-CN', { hour12: false })}>
            {formatRelativeTime(time, props.now || Date.now())}
          </span>
        ) : null}
      </button>
    </div>
    </RowMenu>
  );
}

/* 最近取添加、内容修改、标注变动三个时间的最大值，最多五条。 */
function RecentSection(props) {
  var rows = props.rows;
  if (!rows.length) return null;
  return (
    <section className="wb-section" data-section="recent">
      <div className={SECTION_HEAD}>最近</div>
      <nav className="wb-side-nav" id="wbrecent" aria-label="最近变动">
        {rows.map(function (row) {
          return (
            <PageRow key={row.page.id} page={row.page} recent now={props.now} />
          );
        })}
      </nav>
    </section>
  );
}

/* Pages 段（2026-08-17g 排序钮）：段头右侧是排序菜单（持久化 prefs.pageSort，
   data-page-sort 是 e2e 契约），段身按当前档位排好的页。 */
function PagesSection(props) {
  useWorkbenchStore(function (s) { return s.pageManifest; }); // 订阅触发重渲染；取值走 manifestPages
  var manifestError = useWorkbenchStore(function (s) { return s.pageManifestError; });

  return (
    <section className="wb-section" data-section="pages">
      <div className="wb-section-head-row">

        <PageSortMenu sort={props.sort} onChange={props.onSortChange} />
      </div>
      <nav className="wb-side-nav wb-pages" id="wbpages">
        {props.pages.map(function (page) {
          return <PageRow key={page.id} page={page} now={props.now} />;
        })}
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

export function Sidebar() {
  var [infoPage, setInfoPage] = useState(null);
  useEffect(function () {
    var timer;
    var events = null;
    // 停驻（E2）：嵌入工作台停在文章页时这条 /events 断开（HTTP/1.1 同源只有 6 条，停驻的工作台
    // 不该占着，server-events.js），恢复时重连并补做：左栏刷新一次；活卡片的标注客户端经
    // server-events 收到断开 / 重连，按重连补读账本；HTML 卡片的标注数由 html-cards.js 自己补读。
    // 保存与 outbox 走 POST，不受影响。
    var parked = false;
    function refresh() {
      if (parked) return;
      clearTimeout(timer);
      timer = setTimeout(function () { refreshRegistry().catch(function () {}); }, 150);
    }
    function connect() {
      if (events) return;
      events = new EventSource('/events');
      // 连接状态与推送也转给画布上活的 HTML 卡片里的标注客户端（server-events.js），它们不各开一条。
      events.onopen = function () { setServerEventsOnline(true); };
      events.onerror = function () { if (events && events.readyState !== EventSource.OPEN) setServerEventsOnline(false); };
      events.addEventListener('annotations', function (ev) {
        refresh();
        emitServerEvent('annotations', ev.data);
        // 同一条推送转给工作台里别的订阅方（html-cards.js：文章画布上 HTML 卡片的标注数），不另开连接。
        var doc = null;
        try { doc = JSON.parse(ev.data); } catch (e) { return; }
        window.dispatchEvent(new CustomEvent('wb:annotations', { detail: doc }));
      });
    }
    function disconnect() {
      if (!events) return;
      events.close();
      events = null;
      setServerEventsOnline(false);
    }
    var releasePark = registerEmbedPark({
      pause: function () { parked = true; clearTimeout(timer); disconnect(); },
      resume: function () { parked = false; connect(); refresh(); },
    });
    if (!parked) connect();
    return function () { releasePark(); clearTimeout(timer); disconnect(); };
  }, []);
  // 旧偏好 sidebarTab='outline' 时左栏没有这个页签：落到「页面」，挂载后改写成 pages。
  // 平时的点击不写偏好，和删页签之前一样。
  var [sidebarTab, setSidebarTab] = useState(function () {
    return readPrefs().sidebarTab === 'archived' ? 'archived' : 'pages';
  });
  useEffect(function () {
    if (readPrefs().sidebarTab === 'outline') savePrefs({ sidebarTab: 'pages' });
  }, []);
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
  var [sort, setSort] = useState(function () { return normalizePageSort(readPrefs().pageSort); });
  // 相对时间每分钟重算一次（2026-08-17g），否则「5m」会挂到会话结束。
  // 停驻（E2）时这一分钟的渲染也停：画布看不见，打开时补一次就够。
  var [now, setNow] = useState(function () { return Date.now(); });
  useEffect(function () {
    var timer = setInterval(function () { setNow(Date.now()); }, 60000);
    var releasePark = registerEmbedPark({
      pause: function () { clearInterval(timer); timer = 0; },
      resume: function () {
        setNow(Date.now());
        if (!timer) timer = setInterval(function () { setNow(Date.now()); }, 60000);
      },
    });
    return function () { releasePark(); clearInterval(timer); };
  }, []);
  var manifest = useWorkbenchStore(function (s) { return s.pageManifest; });
  var pageNames = useWorkbenchStore(function (s) { return s.pageNames; });

  // 列表只在清单 / 当前页 / 排序变了才重算 —— 每分钟的时间 tick 会让整栏
  // 重渲染，别让它顺带重排一遍。
  var derived = useMemo(function () {
    var pages = manifestPages().map(page => ({ ...page, ...manifest?.pageTimes?.[page.id] }));
    var kept = pages.filter(function (page) { return !pagePreferences.archived[page.id]; });
    return {
      pages: kept,
      pinned: kept.filter(function (page) { return pagePreferences.pinned[page.id]; }),
      archived: pages.filter(function (page) { return pagePreferences.archived[page.id]; }),
      listed: sortPages(kept.filter(function (page) { return !pagePreferences.pinned[page.id]; }), sort, pageNames)
    };
  }, [manifest, activePageId, sort, pagePreferences, pageNames]);
  // 最近与页面共用归档、置顶筛选。
  var recent = activityRows(derived.pages);

  return (
    <Fragment>
      <SideHead />
      {infoPage && <PageInfo page={infoPage} onClose={function () { setInfoPage(null); }} />}
      {!settingsOpen && <div className="wb-side-toolbar">
        <div className="wb-side-tabs" role="tablist" aria-label="侧栏视图">
          {[['pages', '页面', 'files'], ['archived', '已归档', 'archive']].map(function ([tab, label, icon], index, tabs) {
            return <button key={tab} id={'wb-tab-' + tab} role="tab" type="button"
              aria-label={label} title={label} aria-controls={'wb-panel-' + tab}
              aria-selected={sidebarTab === tab} tabIndex={sidebarTab === tab ? 0 : -1}
              onKeyDown={function (event) {
                var next;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                setSidebarTab(tabs[next][0]);
                event.currentTarget.parentElement.children[next].focus();
              }} onClick={function () { setSidebarTab(tab); }}><WbIcon name={icon} size={18} /></button>;
          })}
        </div>
      </div>}
      <div className="wb-side-body">
        <ScrollArea className="wb-side-scroll min-h-0 flex-1" id="wbside-scroll" hidden={settingsOpen}>
          <PagePreferences.Provider value={{ value: pagePreferences, toggle: togglePagePreference, showInfo: setInfoPage, sort: sort }}>
          {sidebarTab === 'archived' ? <div role="tabpanel" id="wb-panel-archived" aria-labelledby="wb-tab-archived"><nav aria-label="已归档页面">
            {derived.archived.map(function (page) { return <PageRow key={page.id} page={page} now={now} />; })}
            {!derived.archived.length && <p className="wb-row">没有归档页面</p>}
          </nav></div> : <div role="tabpanel" id="wb-panel-pages" aria-labelledby="wb-tab-pages" hidden={sidebarTab !== 'pages'}>
          <ArticlesSection />
          {/* 「页面」组（pp3）：原来的置顶、最近与页面列表原样搬进来，等存量页迁成文章后撤掉。 */}
          <section className="wb-group" data-section="page-group" aria-labelledby="wb-page-group-head">
          <div className={SECTION_HEAD + ' wb-group-head'} id="wb-page-group-head">页面</div>
          {derived.pinned.length > 0 && <nav className="wb-pinned-pages" aria-label="置顶页面">
            {derived.pinned.map(function (page) { return <PageRow key={page.id} page={page} now={now} />; })}
          </nav>}
          <RecentSection rows={recent.filter(function (row) { return !pagePreferences.pinned[row.page.id]; })} now={now} />
          <PagesSection pages={derived.listed} sort={sort} now={now}
            onSortChange={function (next) {
              savePrefs({ pageSort: next });
              setSort(next);
            }} />
          </section>
          </div>}
          </PagePreferences.Provider>
        </ScrollArea>
        <div className="wb-settings-view" id="wbsettings" hidden={!settingsOpen}>
          <SettingsView />
        </div>
      </div>
    </Fragment>
  );
}
