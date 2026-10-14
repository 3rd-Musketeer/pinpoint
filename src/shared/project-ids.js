/**
 * pp3 的 id 规则与固定名（docs/projects.md）：服务、CLI、站点的服务端代码和工作台共用的
 * 唯一一份。叶子模块：只 import 同为叶子的 registry-ids.js，不碰 node 内置模块，浏览器也能用。
 *
 * - 文章画布页 id `<project>_<article>`：拼与拆；
 * - URL 首段与 project 内第二段的保留名（project id、article id 不能取）；
 * - `[[ ]]` 的命名空间键 refKey；
 * - 正文里 <Section id> 与 <Canvas frames> 的 id 规则、shell 取值、节字母；
 * - 账本名：画布 @canvas、正文评论 @prose。
 */
import { ENTRY_ID_PATTERN } from './registry-ids.js';

const ID = ENTRY_ID_PATTERN.source.slice(1, -1); // [a-z0-9][a-z0-9-]*

/**
 * 文章画布的页 id（docs/projects.md“画布视图”）：`<project id>_<article id>`。
 * project id 与 article id 都匹配 ENTRY_ID_PATTERN（没有 `_`），所以拆分无歧义，
 * 也不会和 registry 条目撞（条目 id 不含 `_`）；仍匹配 PAGE_ID_PATTERN。唯一可能撞的
 * 是 content/previews/_index.json 里带 `_` 的模板页，读取时检查并记错误。
 */
export const ARTICLE_PAGE_ID_SEPARATOR = '_';
export const ARTICLE_PAGE_ID_PATTERN = new RegExp(`^(${ID})${ARTICLE_PAGE_ID_SEPARATOR}(${ID})$`);

/** registry 条目 id 或文章画布页 id（不含 ^$，拼进别的正则用，例如 `<页>#n`）。 */
export const ENTRY_OR_ARTICLE_ID_SOURCE = `${ID}(?:${ARTICLE_PAGE_ID_SEPARATOR}${ID})?`;
export const ENTRY_OR_ARTICLE_ID_PATTERN = new RegExp(`^${ENTRY_OR_ARTICLE_ID_SOURCE}$`);

export function articlePageId(projectId, articleId) {
  const id = `${projectId}${ARTICLE_PAGE_ID_SEPARATOR}${articleId}`;
  if (!ENTRY_ID_PATTERN.test(String(projectId)) || !ENTRY_ID_PATTERN.test(String(articleId))) {
    throw new Error(`articlePageId：project id 与 article id 都必须匹配 ${ENTRY_ID_PATTERN}：${JSON.stringify(id)}`);
  }
  return id;
}

/** 页 id → { projectId, articleId }；不是文章画布的页 id 形状返回 null（不查盘）。 */
export function parseArticlePageId(pageId) {
  const match = String(pageId == null ? '' : pageId).match(ARTICLE_PAGE_ID_PATTERN);
  return match ? { projectId: match[1], articleId: match[2] } : null;
}

/**
 * 服务已经占用、或保留给 pp3 的 URL 首段：唯一的一份表。project id 不能取这些名字
 * （登记校验与站点读取都用 isReservedProjectId），服务路由也绝不把它们交给站点
 * （article-routes.js），双保险。带 _ 的几个（_astro、_image、node_modules）本来就
 * 不符合 id 规则，也列进来，让“哪些首段被占用”只有这一处答案。
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
  // Astro 开发服务器的内部路径（article-routes.js 文件头）
  '_astro', '_image',
]);

// e2e 产物目录（test-results-<端口>、playwright-report-<端口>）落在仓库根，也被 vite 服务。
export const RESERVED_SEGMENT_PATTERNS = Object.freeze([/^test-results(?:-|$)/, /^playwright-report(?:-|$)/]);

const RESERVED_SET = new Set(RESERVED_TOP_SEGMENTS);

/** URL 首段是不是保留名（整名或前缀）。 */
export function isReservedSegment(segment) {
  return RESERVED_SET.has(segment) || RESERVED_SEGMENT_PATTERNS.some((re) => re.test(segment));
}

/** project id 是站点 URL 的第一段（/<project>/<article>/），不能是保留首段。 */
export const isReservedProjectId = (id) => isReservedSegment(String(id));

/** project 内占用的 URL 第二段：/<project>/concepts/<名字>/。article id 不能取。 */
export const CONCEPTS_SEGMENT = 'concepts';
export const RESERVED_ARTICLE_IDS = new Set([CONCEPTS_SEGMENT]);

/** `[[名字]]` 的命名空间键：比较不分大小写、去首尾空白（Obsidian 同规则）。 */
export function refKey(name) {
  return String(name).normalize('NFC').trim().toLowerCase();
}

/** <Section id> 的规则（DOM id、画布 section id）；帧 id 与 screen id 契约一致。 */
export const SECTION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const FRAME_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * 正文里的图（<Figure src="figures/<图 id>.jsx">，docs/projects.md“图”）：源文件在文章目录的 figures/ 下，
 * 图 id 是文件名，规则同帧 id。src 只认这一种写法。
 */
export const FIGURE_DIR = 'figures';
export const FIGURE_SRC_PATTERN = /^figures\/([a-zA-Z0-9_-]+)\.jsx$/;

/**
 * HTML 帧（docs/projects.md“HTML 帧”）。帧可以是文章目录下的 `<帧 id>.html`，也可以指 project 根下别处的
 * 一个 HTML 文件：`<Canvas frames={[{ id: "catalog", src: "skill/preview.html" }]}>`，src 相对 project 根。
 * 后一种在服务上的地址是 `/sites/<页 id>/@root/<src>`：地址的目录就是文件所在的目录，文件里写的相对资源
 * 照原样解析。`@` 不会出现在帧 id 和文件名规则里，和文章目录下的文件不会撞。
 */
export const PROJECT_ROOT_SEGMENT = '@root';
export const HTML_FRAME_SRC_PATTERN = /^[^/\\].*\.html?$/i;

/** project 根下一个 HTML 帧的服务地址（不带开头的 `/`，和合成板的 screen src 同一种写法）。 */
export function rootFrameSrc(pageId, src) {
  return `sites/${pageId}/${PROJECT_ROOT_SEGMENT}/${String(src).split('/').map(encodeURIComponent).join('/')}`;
}

/** 卡片和浮层里 HTML 帧的两种宽度（owner 2026-10-14：手机 390、桌面 1280，缺省手机）。 */
export const HTML_FRAME_WIDTHS = Object.freeze({ phone: 390, desktop: 1280 });

/** board / <Canvas shell> / 帧级 shell 的取值（docs/board-schema.md）。 */
export const CANVAS_SHELLS = Object.freeze(['app', 'lock', 'doc', 'comp']);

/** 派生 board 带的节字母（A、B … AA）。 */
export function isSectionLetter(value) {
  return typeof value === 'string' && /^[A-Z]+$/.test(value);
}

/** 节序号 → 字母：0 → A，25 → Z，26 → AA（表格列名式递进）。正文节标题与画布编号同一套。 */
export function sectionLetter(index) {
  var n = Math.max(0, Math.floor(Number(index) || 0));
  var out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** 桶里的固定账本：画布与帧的标注、文章的正文评论（文件 `<页 id>/<名字>.json`）。 */
export const CANVAS_LEDGER = '@canvas';
export const PROSE_LEDGER = '@prose';
