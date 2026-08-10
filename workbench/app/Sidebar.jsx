// 侧栏整树（P1b cut2，goal-20260810-workbench-react-rebuild）— head（连接状态 +
// 折叠钮）、Pages 段（board mode / 页面列表 / 文档版本）、Annotations 段（AnnPanel）、
// 设置视图壳、footer（主题 + 设置入口）。原 index.html 静态标记 + pages.js/boot-prefs.js
// 手工 DOM 同步的 React 形态；DOM id / class / 文案与原实现逐一对应（e2e 选择器即契约）。
// 状态全部来自 app/store.js；交互回调仍调 pages.js / boot-prefs.js 的命令式动作
// （页面装载、文档切换、偏好保存的命令式副作用留在那些模块，本文件只做渲染与转发）。
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
import { WbIcon } from './WbIcon.jsx';

function SideHead() {
  var snap = useWorkbenchStore(function (s) { return s.annSnap; });
  var collapsed = useWorkbenchStore(function (s) { return s.sideCollapsed; });
  var on = !!(snap && snap.available && snap.connected);
  var syncErr = !!(snap && snap.available && snap.syncError);
  return (
    <div className="wb-head">
      <div className="wb-conn" id="wbconn" data-state={on ? 'online' : 'offline'}
        title={on ? (syncErr ? '已连接 · 上次同步失败' : '标注服务已连接') : '标注服务未连接（请运行 npm run dev）'}>
        <span className="wb-conn-dot" aria-hidden="true"></span>
        <span className="wb-conn-label">{on ? '已连接' : '未连接'}</span>
      </div>
      <button type="button" className="wb-side-toggle" id="wbside-toggle"
        aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}
        aria-expanded={collapsed ? 'false' : 'true'}
        onClick={function () { toggleSideCollapsed({ save: true }); }}>
        <WbIcon name="panel-left-close" size={16} />
      </button>
    </div>
  );
}

function Section(props) {
  var open = useWorkbenchStore(function (s) { return s.sectionOpen[props.name] !== false; });
  return (
    <section className={'wb-section' + (open ? ' open' : '')} data-section={props.name}>
      <button type="button" className="wb-section-head" aria-expanded={open ? 'true' : 'false'}
        onClick={function () { setSectionOpen(props.name, !open); }}>
        <span className="wb-section-chevron" aria-hidden="true"></span>
        <span className="wb-section-title">{props.title}</span>
        {props.count || null}
      </button>
      <div className="wb-section-body">
        <div className="wb-section-body-inner">{props.children}</div>
      </div>
    </section>
  );
}

function AnnCount() {
  var count = useWorkbenchStore(function (s) { return (s.annSnap && s.annSnap.rows.length) || 0; });
  return <span className="wb-section-count" id="wbann-count">{count ? '(' + count + ')' : ''}</span>;
}

var BOARD_MODES = [
  { id: 'ios', label: 'iOS', title: '手机原型' },
  { id: 'web', label: 'Web', title: 'web app 画板' },
  { id: 'html', label: 'HTML', title: '完整单页 HTML 文档（汇报页一类）' }
];

function BoardModeSwitch() {
  var boardMode = useWorkbenchStore(function (s) { return s.boardMode; });
  return (
    <div className="wb-board-mode" id="wbboard-mode" role="group" aria-label="Board mode">
      {BOARD_MODES.map(function (m) {
        var on = boardMode === m.id;
        return (
          <button key={m.id} type="button" className={'wb-board-mode-btn' + (on ? ' on' : '')}
            data-board-mode={m.id} aria-pressed={on ? 'true' : 'false'} title={m.title}
            onClick={function () { if (m.id !== wbGet().boardMode) setBoardMode(m.id); }}>
            {m.label}
          </button>
        );
      })}
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
    <div className="wb-page-row" data-page-system={system ? '1' : undefined}>
      <button type="button"
        className={'wb-page' + (active ? ' on' : '') + (renaming ? ' renaming' : '')}
        data-vpage={page.id} data-page-system={system ? '1' : undefined}
        data-page-default={page.title} data-page-mode={system ? undefined : (page.mode || 'ios')}
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
          <input ref={inputRef} type="text" className="wb-page-rename" aria-label="重命名页面"
            defaultValue={title} onKeyDown={onRenameKey}
            onBlur={function (e) { finishRename(true, e.target.value); }} />
        ) : title}
      </button>
      <button type="button" className={'wb-page-copy' + (copied ? ' ok' : '')}
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
        <WbIcon name="link" size={12} />
      </button>
    </div>
  );
}

function PagesNav() {
  var boardMode = useWorkbenchStore(function (s) { return s.boardMode; });
  useWorkbenchStore(function (s) { return s.pageManifest; }); // 订阅触发重渲染；取值走 pagesForMode
  var manifestError = useWorkbenchStore(function (s) { return s.pageManifestError; });
  var pages = pagesForMode(boardMode);
  return (
    <nav className="wb-pages" id="wbpages">
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
      items.push(<div key={'sec-' + sc.section} className="wb-doc-ver-sec">{sc.section}</div>);
    }
    items.push(
      <button key={sc.id} type="button"
        className={'wb-doc-ver' + (activeDocId === sc.id ? ' on' : '')}
        data-doc-screen={sc.id} onClick={function () { setActiveDoc(sc.id); }}>
        {sc.title}
      </button>
    );
  });
  return (
    <nav className="wb-doc-versions" id="wbdoc-versions" aria-label="文档版本" hidden={!show}>
      {show ? (
        <Fragment>
          <div className="wb-doc-ver-head">
            <span>{screens.length > 1 ? 'Versions' : 'Document'}</span>
            <button type="button" className="wb-doc-export" data-doc-export="" title="导出当前文档"
              onClick={function () { openDocExportDialog(); }}>导出</button>
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

function SideFoot() {
  var theme = useWorkbenchStore(function (s) { return s.theme; });
  var settingsOpen = useWorkbenchStore(function (s) { return s.settingsOpen; });
  return (
    <div className="wb-foot" id="wbfoot" hidden={settingsOpen}>
      <div className="ctl" id="wbtheme" role="group" aria-label="屏幕主题">
        <button type="button" data-theme="light" className={theme === 'light' ? 'on' : ''} title="Light"
          onClick={function () { setTheme('light', { save: true }); }}>
          <WbIcon name="sun" size={12} />{' '}Light
        </button>
        <button type="button" data-theme="dark" className={theme === 'dark' ? 'on' : ''} title="Dark"
          onClick={function () { setTheme('dark', { save: true }); }}>
          <WbIcon name="moon" size={12} />{' '}Dark
        </button>
      </div>
      <button type="button" className={'wb-gear' + (settingsOpen ? ' on' : '')} id="wbgear"
        aria-label="预览设置" title="设置"
        onClick={function () { showSettings(); }}>
        <WbIcon name="settings" size={15} className="wb-gear-ico" />
      </button>
    </div>
  );
}

export function Sidebar() {
  var settingsOpen = useWorkbenchStore(function (s) { return s.settingsOpen; });
  return (
    <Fragment>
      <SideHead />
      <div className="wb-side-body">
        <div className="wb-side-scroll" id="wbside-scroll" hidden={settingsOpen}>
          <Section name="pages" title="Pages"><PagesSection /></Section>
          <Section name="annotations" title="Annotations" count={<AnnCount />}><AnnPanel /></Section>
        </div>
        <div className="wb-settings-view" id="wbsettings" hidden={!settingsOpen}>
          <SettingsView />
        </div>
        <SideFoot />
      </div>
    </Fragment>
  );
}
