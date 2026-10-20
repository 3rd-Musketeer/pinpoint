/**
 * 工作台的地址（ADR 0044）：工作台住在 `/workbench/`，`/` 是文章站点的 blog 首页。
 * 画布视图 = `/workbench/?page=<页 id>`，可以再带 `&section=<节 id>`（以及工作台自己的
 * mode / entry / tab）。叶子模块，纯函数：服务、CLI、工作台、文章站点共用这一份
 * （站点的浏览器端脚本经 devFsAllow 也能 import 它，astro.config.mjs）。
 */
export const WORKBENCH_PATH = '/workbench/';

/** 工作台地址；query 是不带前导 ? 的查询串，空串时就是 `/workbench/`。 */
export function workbenchHref(query = '') {
  const q = String(query || '').replace(/^\?/, '');
  return q ? `${WORKBENCH_PATH}?${q}` : WORKBENCH_PATH;
}

/** 一篇文章的画布视图；给了节 id 就落到那一节。 */
export function canvasViewHref(pageId, sectionId) {
  return workbenchHref(`page=${encodeURIComponent(pageId)}${sectionId ? `&section=${encodeURIComponent(sectionId)}` : ''}`);
}

/** 工作台深链用的 query 参数名（lib/page-url.js 的 deepLinkQuery 写它们）。
 *  旧的工作台地址（`/?page=…`、`/index.html…`）已退役：根 `/` 带这些参数
 *  与根 `/index.html` 一律 404（src/server/lib/workbench-routes.js）。 */
export const WORKBENCH_QUERY_PARAMS = ['page', 'mode', 'entry', 'tab', 'section', 'embed', 'gen'];

/** 查询串（可带前导 ?）里有没有工作台深链参数。 */
export function hasWorkbenchQuery(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return WORKBENCH_QUERY_PARAMS.some((name) => params.has(name));
}
