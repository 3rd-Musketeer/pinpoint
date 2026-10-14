// 左栏「文章」组的模型（pp3，docs/design.md「左栏结构」）：纯函数，不碰 DOM。
// 输入是 GET /api/projects（listProjects 的形状）和工作台清单认得的画布页 id
// （manifest.articles）；输出是 project → 文章 两层，Sidebar 只照着画。

import { formatProjectError } from '../../shared/project-errors.js';

/** 布局错误 tooltip 列几条；多出来的写“还有 N 条”。 */
export var ARTICLE_ERROR_TOOLTIP_MAX = 3;

/** 文章正文的地址：/<project>/<article>/（站点路由，docs/projects.md）。 */
export function articleReadUrl(projectId, articleId) {
  return '/' + encodeURIComponent(projectId) + '/' + encodeURIComponent(articleId) + '/';
}

/**
 * 画布视图回正文的地址（横条的“阅读正文”）：row 是清单 manifest.articles 里这一页的那一行
 * （kind 'article'，带 project / article）；不是文章画布页（存量页、模板页）返回 null。
 * sectionId 是画布当前所在的节（store.activeGroup）：它是这块板上的节，就拼成正文的锚点
 * `#<节 id>`（文章页上 <Section id> 就是 DOM id，site/README.md）；不是就落到文章顶部。
 * board 取全部 tab（fullBoard），节 id 全页唯一。
 */
export function articleCanvasReadUrl(row, board, sectionId) {
  if (!row || row.kind !== 'article') return null;
  var base = row.project && row.article ? articleReadUrl(row.project, row.article) : row.url;
  if (!base) return null;
  var sections = (board && Array.isArray(board.sections)) ? board.sections : [];
  var known = !!sectionId && sections.some(function (section) { return section && section.id === sectionId; });
  return known ? base + '#' + encodeURIComponent(sectionId) : base;
}

/** project 错误的 tooltip：前几条逐行，多的折成一句。没有错误返回 ''。 */
export function projectErrorTooltip(errors, max) {
  var list = Array.isArray(errors) ? errors.filter(Boolean).map(formatProjectError) : [];
  if (!list.length) return '';
  max = max || ARTICLE_ERROR_TOOLTIP_MAX;
  var lines = ['布局错误 ' + list.length + ' 条：'].concat(list.slice(0, max));
  if (list.length > max) lines.push('…还有 ' + (list.length - max) + ' 条（ppnt list <project> 看全部）');
  return lines.join('\n');
}

/**
 * projects × 画布页清单 → [{ id, title, errors, errorCount, errorTooltip,
 *   articles: [{ id, title, summary, pageId, readUrl, canvas }] }]
 * - 顺序照登记顺序、文章照 listProjects 的顺序，不另排。
 * - canvas = 这篇有画布节，且工作台清单认得它的画布页（撞名时模板页优先，画布打不开，
 *   那就和没有画布一样，点了开正文）。
 * - 没有文章的 project 照样出一组（标题行 + 空），错误标照常。
 */
export function articleGroups(projects, canvasPageIds) {
  var known = canvasPageIds instanceof Set ? canvasPageIds : new Set(canvasPageIds || []);
  return (Array.isArray(projects) ? projects : []).filter(function (project) {
    return project && typeof project.id === 'string';
  }).map(function (project) {
    var errors = Array.isArray(project.errors) ? project.errors : [];
    return {
      id: project.id,
      title: project.title || project.id,
      errors: errors,
      errorCount: errors.length,
      errorTooltip: projectErrorTooltip(errors),
      articles: (project.articles || []).filter(function (article) {
        return article && typeof article.id === 'string';
      }).map(function (article) {
        var pageId = typeof article.pageId === 'string' ? article.pageId : null;
        return {
          id: article.id,
          title: article.title || article.id,
          summary: article.summary || '',
          pageId: pageId,
          readUrl: articleReadUrl(project.id, article.id),
          canvas: !!pageId && article.canvasSections > 0 && known.has(pageId)
        };
      })
    };
  });
}

/** 行的 tooltip：标题、摘要、id 与点了会去哪。 */
export function articleRowTooltip(group, article) {
  var lines = [article.title];
  if (article.summary) lines.push(article.summary);
  lines.push(group.id + ' / ' + article.id + (article.canvas ? '' : ' · 没有画布，点开正文'));
  return lines.join('\n');
}
