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
