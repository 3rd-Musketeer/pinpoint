/**
 * blog 首页的文章流（ADR 0044，规则写在 docs/projects.md“首页”）：所有登记 project 的全部文章，
 * 按最近修改时间倒序。一篇文章的时间：frontmatter 写了合法的 `date`（YYYY-MM-DD）就用它，
 * 否则用 index.mdx 的修改时间。纯函数，站点页面与单测共用；读盘（mtime）在 listProjects。
 */

const ARTICLE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** frontmatter 的 date → 当天本地零点的毫秒数；不是合法的 YYYY-MM-DD 返回 null。 */
export function parseArticleDate(value) {
  const match = ARTICLE_DATE_PATTERN.exec(String(value == null ? '' : value).trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(y, m - 1, d);
  if (at.getFullYear() !== y || at.getMonth() !== m - 1 || at.getDate() !== d) return null;
  return at.getTime();
}

const pad = (n) => String(n).padStart(2, '0');
/** 毫秒数 → 本地日期 YYYY-MM-DD。 */
export function formatDay(ms) {
  const at = new Date(ms);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * 一篇文章在首页上的时间：{ at（排序用的毫秒数）, day（显示的 YYYY-MM-DD）, source: 'date' | 'mtime' }。
 * article 是 listProjects 的文章（date? 来自 frontmatter，mtimeMs 是 index.mdx 的修改时间）。
 */
export function articleTime(article) {
  const fromDate = parseArticleDate(article && article.date);
  if (fromDate != null) return { at: fromDate, day: formatDay(fromDate), source: 'date' };
  const mtime = Number(article && article.mtimeMs);
  const at = Number.isFinite(mtime) ? mtime : 0;
  return { at, day: at ? formatDay(at) : '', source: 'mtime' };
}

/**
 * 首页文章流：projects = [{ id, title, articles: [{ id, title, summary?, date?, mtimeMs }] }]。
 * → [{ project: { id, title }, article, time }]，新的在前；同一时间按 project id、article id。
 */
export function articleFeed(projects) {
  const rows = [];
  for (const project of projects || []) {
    for (const article of project.articles || []) {
      rows.push({ project: { id: project.id, title: project.title }, article, time: articleTime(article) });
    }
  }
  return rows.sort((x, y) => y.time.at - x.time.at
    || x.project.id.localeCompare(y.project.id)
    || x.article.id.localeCompare(y.article.id));
}
