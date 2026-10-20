/**
 * 工作台挪到 `/workbench/` 之后的路由判定（纯函数，ADR 0044）。
 *
 *   /workbench/、/workbench/index.html   → 改写成 /index.html（仓库根的工作台壳页），交给 vite 的 html 服务
 *   /workbench                           → 302 /workbench/（补尾斜杠，query 原样）
 *   /index.html[?<参数>]                 → 404：旧的工作台地址（迁移期结束，owner 2026-10-20）
 *   /?<工作台参数>（page/mode/entry/tab/section/embed/gen）→ 404：旧的画布视图地址
 *   /?<别的参数>                          → 不归这里：文章站点的 blog 首页（article-routes.js）
 *
 * 只管 GET / HEAD；其余方法原样放行。query 原样带过去，不重新编码。
 * 返回 null，或 { action: 'redirect', location }、{ action: 'rewrite', url }、{ action: 'notFound' }。
 */
import { hasWorkbenchQuery, WORKBENCH_PATH } from '../../shared/workbench-url.js';
import { splitUrlQuery } from './req-url.js';

const WORKBENCH_SHELL = '/index.html';

export function routeWorkbenchRequest(method, url) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  const { pathname, search } = splitUrlQuery(url);
  // `/?`（空查询串）当作不带参数。
  const query = search === '?' ? '' : search;
  if (pathname === WORKBENCH_PATH || pathname === `${WORKBENCH_PATH}index.html`) {
    return { action: 'rewrite', url: WORKBENCH_SHELL + query };
  }
  if (pathname === WORKBENCH_PATH.slice(0, -1)) return { action: 'redirect', location: WORKBENCH_PATH + query };
  if (pathname === WORKBENCH_SHELL) return { action: 'notFound' };
  if (pathname === '/' && query && hasWorkbenchQuery(query)) return { action: 'notFound' };
  return null;
}
