/**
 * pp3 文章路由（纯函数）：一个请求归不归文章站点（Astro 开发服务器），归的话
 * 上游路径是什么。服务把它代理过去（src/server/article-proxy.js），其余请求
 * 原样交给 pinpoint 自己的中间件链。
 *
 * 地址空间（docs/design.md「服务路由」）：
 *   /              不带参数 → 文章站点的 blog 首页（全部文章，ADR 0044）。带参数的 / 是旧的
 *                  画布视图地址，先被 workbench-routes.js 302 到 /workbench/，到不了这里。
 *   /<project>/…   首段是登记过的 project id → 文章站点。路径原样，站点不设 base。
 *                  旧的 wiki 地址 /<project>/concepts/… 301 到 /<project>/wiki/…（ADR 0045），不经站点。
 *   /_astro/…      Astro 开发服务器自己的 vite 内部路径（/@vite/client、/src/…、
 *                  /@fs/…、/node_modules/.vite/…、HMR websocket）。pinpoint 本身
 *                  也是 vite，同名的 /@vite/、/@fs/、/@id/、/node_modules/ 归它自己，
 *                  所以服务拉起 Astro 时让它的 vite 以 /_astro/ 为 base
 *                  （环境变量 PINPOINT_SITE_VITE_BASE），两套内部路径不撞。
 *   /_image        Astro 开发期的图片端点（Astro 的 base 仍是 /，它照 / 生成这个地址）。
 *
 * 上游一律带 /_astro 前缀：vite 的 base 中间件剥掉前缀再交给 Astro，所以
 * Astro 看到的 URL 与浏览器地址栏一致（实测 astro 7.3.4：Astro.url.pathname
 * 是 /demo/）。Astro 拼 base 时多出一道斜杠（/_astro//@vite/client），vite 对
 * 它答 404，这里把前缀后连续的斜杠压成一道。
 */
import { ENTRY_ID_PATTERN } from '../../shared/registry-ids.js';
import { isReservedSegment, LEGACY_CONCEPTS_SEGMENT, RESERVED_ARTICLE_IDS, WIKI_SEGMENT } from '../../shared/project-ids.js';
import { projectEntry } from './registry.js';
import { splitUrlQuery } from './req-url.js';

// 保留首段的表在 src/shared/project-ids.js（登记校验与这里的路由用同一份）。
export { isReservedSegment, RESERVED_SEGMENT_PATTERNS, RESERVED_TOP_SEGMENTS } from '../../shared/project-ids.js';

export const ASTRO_DEV_BASE = '/_astro/';

/** `id` 是不是登记过的 project（registry.projects，loadRegistry 的结果与 live store 同形）。 */
export function isProjectId(registry, id) {
  return typeof id === 'string' && id !== '' && projectEntry(registry, id) != null;
}

/** /_astro 后面的路径：连续斜杠压成一道（见文件头）。 */
function astroInternalUpstream(pathname) {
  const rest = pathname.slice('/_astro'.length).replace(/^\/+/, '');
  return ASTRO_DEV_BASE + rest;
}

/**
 * 一个 project 内路径是不是文章页：`/<project>/<article>/`（或不带尾斜杠、或
 * `…/index.html`）返回 article id，否则 null（project 首页、wiki 页、llms.txt、
 * 文章目录下的资源）。只看形状，不读盘：文章不存在时站点自己答 404。
 */
export function articleIdOfPath(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts.length === 3 && parts[2] === 'index.html') parts.pop();
  if (parts.length !== 2) return null;
  let segment;
  try {
    segment = decodeURIComponent(parts[1]);
  } catch {
    return null;
  }
  if (!ENTRY_ID_PATTERN.test(segment) || RESERVED_ARTICLE_IDS.has(segment)) return null;
  return segment;
}

/**
 * 一次 HTTP 请求的路由判定。
 *   url          req.url（原样，含百分号编码与 query）
 *   isProject(id) project id 判定（通常是 (id) => isProjectId(registry, id)）
 * 返回 null（不归站点）或
 *   { kind: 'home', project: null, article: null, upstream }  不带参数的 /（blog 首页）
 *   { kind: 'article', project, article, upstream }   project 下的一切路径；article =
 *                                             文章 id（文章页）或 null（首页、wiki 页…）
 *   { kind: 'redirect', status: 301, project, location }  旧的 /<project>/concepts/… → /<project>/wiki/…
 *   { kind: 'internal', upstream }            Astro 的 vite 内部路径与 /_image
 * upstream = 发给 Astro 开发服务器的路径 + query。
 */
export function routeArticleRequest(url, isProject) {
  const { pathname, search } = splitUrlQuery(url);
  if (pathname === '/' && (search === '' || search === '?')) {
    return { kind: 'home', project: null, article: null, upstream: ASTRO_DEV_BASE };
  }
  if (pathname === '/_astro' || pathname.startsWith('/_astro/')) {
    return { kind: 'internal', upstream: astroInternalUpstream(pathname) + search };
  }
  if (pathname === '/_image' || pathname.startsWith('/_image/')) {
    return { kind: 'internal', upstream: '/_astro' + pathname + search };
  }
  const segmentEnd = pathname.indexOf('/', 1);
  const rawSegment = segmentEnd < 0 ? pathname.slice(1) : pathname.slice(1, segmentEnd);
  let segment;
  try {
    segment = decodeURIComponent(rawSegment);
  } catch {
    return null;
  }
  if (!ENTRY_ID_PATTERN.test(segment) || isReservedSegment(segment)) return null;
  if (typeof isProject !== 'function' || !isProject(segment)) return null;
  const rest = segmentEnd < 0 ? '' : pathname.slice(segmentEnd + 1);
  const legacy = rest === LEGACY_CONCEPTS_SEGMENT ? '' : rest.startsWith(`${LEGACY_CONCEPTS_SEGMENT}/`) ? rest.slice(LEGACY_CONCEPTS_SEGMENT.length + 1) : null;
  if (legacy !== null) {
    return { kind: 'redirect', status: 301, project: segment, location: `/${rawSegment}/${WIKI_SEGMENT}/${legacy}${search}` };
  }
  return { kind: 'article', project: segment, article: articleIdOfPath(pathname), upstream: '/_astro' + pathname + search };
}

/**
 * websocket upgrade 的路由判定：只有 Astro 的 vite HMR（/_astro/ 下）归站点。
 * pinpoint 自己的 HMR 在 / 上，由 vite 自己的 upgrade 监听处理。
 */
export function routeArticleUpgrade(url) {
  const { pathname, search } = splitUrlQuery(url);
  if (pathname === '/_astro' || pathname.startsWith('/_astro/')) {
    return { kind: 'internal', upstream: astroInternalUpstream(pathname) + search };
  }
  return null;
}
