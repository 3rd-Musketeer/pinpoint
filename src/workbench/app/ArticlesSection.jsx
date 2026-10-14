// 左栏「文章」组（pp3，owner 2026-10-13 选 A）：Pages 面板顶上一组，按
// project → 文章列出；下面是原来的「页面」组，原样可用。
// - project 标题行 = chevron + 标题（project.json 的 title）+ 布局错误标（个数，tooltip
//   列前几条）；整行是折叠钮，折叠是本机偏好 prefs.articleProjectsCollapsed。
// - 文章行：有画布 → 点了在工作台打开画布页 `<project>_<article>`（与 `/?page=` 同一个页），
//   选中态跟页面行一样从 activePageId 派生；没有画布 → 点了在新标签页打开正文。
// - 行尾“阅读正文”钮：常态不出、不占标题宽度，hover / 键盘焦点进行时才现，在新标签页
//   打开 `/<project>/<article>/`。这是 ADR 0024（行尾不挂 hover 钮）的一处例外，owner 点名要的。
// - 不做归档、置顶、拖放；文章画布也不进「最近」（最近只算 Pages 的页）。
// 数据：store.projects（pages.js loadProjects ← GET /api/projects），画布页是否认得看
// manifest.articles。模型是 lib/article-groups.js 的纯函数。
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useWorkbenchStore } from './store.js';
import { loadProjects, setActivePage, showTabs } from '../pages.js';
import { articleGroups, articleRowTooltip } from '../lib/article-groups.js';
import { readPrefs, savePrefs } from '../lib/prefs.js';
import { RowMenu } from './row-menu.jsx';
import { WbIcon } from './WbIcon.jsx';
import { cn } from './lib/utils.js';

function openReader(url) {
  window.open(url, '_blank', 'noopener');
}

function ArticleRow(props) {
  var group = props.group;
  var article = props.article;
  var active = useWorkbenchStore(function (s) { return !!article.canvas && s.activePageId === article.pageId; });
  var menuItems = [
    { kind: 'action', label: '阅读正文', icon: 'book-open',
      onSelect: function () { openReader(article.readUrl); },
      attr: { 'data-read-article': article.pageId || article.id } }
  ];
  if (article.canvas) {
    menuItems.push({ kind: 'copy', label: '复制 @page', text: '@page:' + article.pageId,
      attr: { 'data-copy-page': article.pageId } });
  }
  return (
    <RowMenu items={menuItems}>
      <div className="wb-article-row">
        <button type="button"
          className={cn('wb-row wb-article', active && 'on')}
          data-article={group.id + '/' + article.id}
          data-article-page={article.pageId || undefined}
          data-canvas={article.canvas ? '1' : '0'}
          data-state={active ? 'on' : undefined}
          aria-current={active ? 'page' : undefined}
          title={articleRowTooltip(group, article)}
          onClick={function () {
            if (!article.canvas) { openReader(article.readUrl); return; }
            showTabs();
            setActivePage(article.pageId);
          }}>
          <WbIcon name={article.canvas ? 'newspaper' : 'file-text'} size={14}
            className="wb-row-glyph wb-article-kind" aria-hidden="true" />
          <span className="wb-row-t">{article.title}</span>
        </button>
        <a className="wb-article-read" href={article.readUrl} target="_blank" rel="noopener"
          data-article-read={group.id + '/' + article.id}
          title="阅读正文" aria-label={'阅读正文：' + article.title}>
          <WbIcon name="book-open" size={14} className="size-[14px]" />
        </a>
      </div>
    </RowMenu>
  );
}

function ProjectRow(props) {
  var group = props.group;
  return (
    <div className="wb-project-row">
      <button type="button" className="wb-row wb-project"
        data-project={group.id}
        data-state={props.collapsed ? 'collapsed' : 'open'}
        aria-expanded={!props.collapsed}
        title={group.title === group.id ? group.id : group.title + '\n' + group.id}
        onClick={props.onToggle}>
        <WbIcon name={props.collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="wb-row-chv" />
        <WbIcon name="library" size={14} className="wb-row-glyph" />
        <span className="wb-row-t wb-project-t">{group.title}</span>
        {group.errorCount ? (
          <span className="wb-project-err" data-project-errors={group.errorCount}
            title={group.errorTooltip} aria-label={group.errorTooltip}>
            <WbIcon name="circle-alert" size={12} className="size-[12px]" />
            {group.errorCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function readCollapsed() {
  var raw = readPrefs().articleProjectsCollapsed;
  return raw && typeof raw === 'object' ? raw : {};
}

export function ArticlesSection() {
  var projects = useWorkbenchStore(function (s) { return s.projects; });
  var error = useWorkbenchStore(function (s) { return s.projectsError; });
  var manifest = useWorkbenchStore(function (s) { return s.pageManifest; });
  var [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(function () { loadProjects(); }, []);

  var groups = useMemo(function () {
    var ids = ((manifest && manifest.articles) || []).map(function (row) { return row.id; });
    return articleGroups(projects, ids);
  }, [projects, manifest]);

  function toggle(id) {
    setCollapsed(function (current) {
      var next = Object.assign({}, current);
      if (next[id]) delete next[id];
      else next[id] = true;
      savePrefs({ articleProjectsCollapsed: next });
      return next;
    });
  }

  return (
    <section className="wb-section wb-articles" data-section="articles">
      <div className="wb-section-head wb-group-head">文章</div>
      <nav className="wb-side-nav" id="wbarticles" aria-label="文章">
        {groups.map(function (group) {
          var closed = !!collapsed[group.id];
          return (
            <Fragment key={group.id}>
              <ProjectRow group={group} collapsed={closed} onToggle={function () { toggle(group.id); }} />
              {closed ? null : group.articles.map(function (article) {
                return <ArticleRow key={article.id} group={group} article={article} />;
              })}
              {!closed && !group.articles.length ? (
                <p className="wb-article-empty">还没有文章</p>
              ) : null}
            </Fragment>
          );
        })}
        {projects && !projects.length && !error ? (
          <p className="wb-article-empty wb-article-empty--top">还没有登记的 project（ppnt add --project &lt;目录&gt;）</p>
        ) : null}
        {error ? (
          <div className="wb-page-error" style={{ margin: '6px 10px' }}>
            <p title={error} style={{ margin: 0, color: 'var(--wb-danger)', fontSize: '12px', lineHeight: 1.35 }}>
              文章列表读取失败（/api/projects）。
            </p>
            <button type="button" className="wb-screen-err-act" data-projects-retry
              style={{ marginTop: '8px' }}
              onClick={function () { loadProjects(); }}>重试</button>
          </div>
        ) : null}
      </nav>
    </section>
  );
}
