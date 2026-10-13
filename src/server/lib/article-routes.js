/**
 * pp3 文章路由（纯函数）：一个请求归不归文章站点（Astro 开发服务器），归的话
 * 上游路径是什么。服务把它代理过去（src/server/article-proxy.js），其余请求
 * 原样交给 pinpoint 自己的中间件链。
 *
 * 地址空间（docs/design.md「服务路由」）：
 *   /<project>/…   首段是登记过的 project id → 文章站点。路径原样，站点不设 base。
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

export const ASTRO_DEV_BASE = '/_astro/';

/**
 * 服务已经占用、或保留给 pp3 的 URL 首段：唯一的一份表。project id 不能取这些
 * 名字（projects.js 的 `isReservedProjectId` 就是这里的 `isReservedSegment`，
 * 登记校验与站点读取都用它）；这里的路由也绝不把它们交给站点，双保险。
 * 带 _ 的几个（_astro、_image、node_modules）本来就不符合 id 规则，
 * 也列进来，让“哪些首段被占用”只有这一处答案。
 */
export const RESERVED_TOP_SEGMENTS = Object.freeze([
  // annotate-api
  'health', 'registry', 'events', 'annotations', 'save', 'image', 'images',
  // frame / export / diagnostics / projects API（/api/…）与登记目录（/sites/<id>/）
  'api', 'sites',
  // content-routes 的 URL 投影
  'kits', 'previews', 'lib',
  // vite 按仓库根静态服务的顶层目录（主 clone 里还有 owner 本地的 tasks、prototypes）
  'bin', 'content', 'docs', 'e2e', 'scripts', 'skills', 'src', 'site', 'tasks', 'prototypes', 'node_modules',
  // common.md §4 预留（kits 已在上面）
  'workbench', 'assets', 'annotate',
  // Astro 开发服务器的内部路径（见文件头）
  '_astro', '_image',
]);

// e2e 产物目录（test-results-<端口>、playwright-report-<端口>）落在仓库根，也被 vite 服务。
export const RESERVED_SEGMENT_PATTERNS = Object.freeze([/^test-results(?:-|$)/, /^playwright-report(?:-|$)/]);

const RESERVED_SET = new Set(RESERVED_TOP_SEGMENTS);

export function isReservedSegment(segment) {
  return RESERVED_SET.has(segment) || RESERVED_SEGMENT_PATTERNS.some((re) => re.test(segment));
}

/**
 * `id` 是不是登记过的 project。读 registry 的 `resolveProject(id)`（loadRegistry
 * 的结果与 live store 都有），退回 `projects` 列表；两样都没有就当没有 project。
 */
export function isProjectId(registry, id) {
  if (!registry || typeof id !== 'string' || !id) return false;
  if (typeof registry.resolveProject === 'function') return Boolean(registry.resolveProject(id));
  const list = Array.isArray(registry.projects) ? registry.projects : [];
  return list.some((entry) => entry && entry.id === id);
}

function splitUrl(url) {
  const raw = typeof url === 'string' && url ? url : '/';
  const at = raw.indexOf('?');
  return at < 0 ? { pathname: raw, search: '' } : { pathname: raw.slice(0, at), search: raw.slice(at) };
}

/** /_astro 后面的路径：连续斜杠压成一道（见文件头）。 */
function astroInternalUpstream(pathname) {
  const rest = pathname.slice('/_astro'.length).replace(/^\/+/, '');
  return ASTRO_DEV_BASE + rest;
}

/**
 * 一次 HTTP 请求的路由判定。
 *   url          req.url（原样，含百分号编码与 query）
 *   isProject(id) project id 判定（通常是 (id) => isProjectId(registry, id)）
 * 返回 null（不归站点）或
 *   { kind: 'article', project, upstream }   文章页及 project 下的一切路径
 *   { kind: 'internal', upstream }            Astro 的 vite 内部路径与 /_image
 * upstream = 发给 Astro 开发服务器的路径 + query。
 */
export function routeArticleRequest(url, isProject) {
  const { pathname, search } = splitUrl(url);
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
  return { kind: 'article', project: segment, upstream: '/_astro' + pathname + search };
}

/**
 * websocket upgrade 的路由判定：只有 Astro 的 vite HMR（/_astro/ 下）归站点。
 * pinpoint 自己的 HMR 在 / 上，由 vite 自己的 upgrade 监听处理。
 */
export function routeArticleUpgrade(url) {
  const { pathname, search } = splitUrl(url);
  if (pathname === '/_astro' || pathname.startsWith('/_astro/')) {
    return { kind: 'internal', upstream: astroInternalUpstream(pathname) + search };
  }
  return null;
}
