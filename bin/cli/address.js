/**
 * ppnt 的目标与引用地址（docs/registry.md“CLI”，CONTEXT.md“引用地址”）。
 *
 * 目标（命令的第一个位置参数）：
 *   <project>/<article>       一篇文章（输出一律打这个斜杠形）
 *   <project>_<article>       同一篇文章的页 id（旧写法，照认）
 *   文章网址                   https://pinpoint.localhost/<project>/<article>/…、/<project>/<article>/、/workbench/?page=<页 id>（旧的 /?page= 照认）
 *   @page:<页 id>             工作台“复制 @page”给的写法，同页 id
 *   <project>                 一个 project（show / check / comments 用）
 *   <页 id>                   存量页
 * 标注：<project>/<article>#3（= <project>_<article>#3）。
 * 节：§2（文章页节号）= 第 2 个字母 B；节 id；字母 B。帧：B1 或帧 id。
 *
 * 解析分两层：parseAddress 只看字面（纯函数，不读盘）；resolveAddress 再对照 registry 与磁盘
 * 判断它指的是什么。斜杠形换成页 id 也只看字面（toPageRef），所以删掉的文章、孤儿桶也能用斜杠形写。
 */
import { ARTICLE_PAGE_ID_PATTERN, articlePageId, parseArticlePageId, RESERVED_ARTICLE_IDS, sectionLetter } from '../../src/shared/project-ids.js';
import { ENTRY_ID_PATTERN, PAGE_ID_PATTERN } from '../../src/shared/registry-ids.js';
import { resolveArticleTarget } from '../../src/server/lib/page-resolve.js';
import { projectEntries, projectEntry, registryEntry } from '../../src/server/lib/registry.js';

const ID = ENTRY_ID_PATTERN.source.slice(1, -1);
const SLASH_ARTICLE_RE = new RegExp(`^(${ID})/(${ID})/?$`);
const SECTION_NUMBER_RE = /^§([1-9][0-9]*)$/;
const NUM_SUFFIX_RE = /^(.*)#([1-9][0-9]*)$/;
const PAGE_INDICATOR_PREFIX = '@page:';
// 工作台地址：现行 /workbench/，旧写法 / 与 /index.html 照认（ADR 0044）。
const WORKBENCH_PATHNAMES = new Set(['/workbench/', '/workbench/index.html', '/', '/index.html']);
// 引用的样子：#n、#3-#7、@frame: / @a:、§2、字母编号 B / B3、<tab>:B3。这些不会是目标。
const REF_SHAPE_RE = /^(?:#|@|§)|^[A-Z]+(?:[1-9][0-9]*)?$|^[a-zA-Z0-9_-]+:[A-Z]+(?:[1-9][0-9]*)?$/;

/** 文章网址 → { project, article } | { project } | { pageId } | null。只认 pinpoint 的路由形状。 */
function parseUrlish(token) {
  let url;
  try {
    url = /^https?:\/\//i.test(token) ? new URL(token) : (token.startsWith('/') ? new URL(token, 'http://x') : null);
  } catch {
    return null;
  }
  if (!url) return null;
  const page = url.searchParams.get('page');
  if (WORKBENCH_PATHNAMES.has(url.pathname) && page && PAGE_ID_PATTERN.test(page)) return { pageId: page };
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ENTRY_ID_PATTERN.test(parts[0]) && ENTRY_ID_PATTERN.test(parts[1]) && !RESERVED_ARTICLE_IDS.has(parts[1])) {
    return { project: parts[0], article: parts[1] };
  }
  if (parts.length === 1 && ENTRY_ID_PATTERN.test(parts[0])) return { project: parts[0] };
  return null;
}

/**
 * 字面解析（不读盘）→
 *   { kind: 'article', project, article, pageId, n? }   斜杠形、页 id 形（含 @page:）、文章网址
 *   { kind: 'id', id, n? }                               一个 id：project、存量页，或模板页 id
 *   null                                                  不是目标的样子
 */
export function parseAddress(token) {
  let raw = String(token == null ? '' : token).trim();
  if (!raw) return null;
  let n;
  const numbered = raw.match(NUM_SUFFIX_RE);
  if (numbered && !/^https?:/i.test(raw)) {
    raw = numbered[1];
    n = Number(numbered[2]);
  }
  const withN = (value) => (n ? { ...value, n } : value);
  if (raw.startsWith(PAGE_INDICATOR_PREFIX)) {
    const pageId = raw.slice(PAGE_INDICATOR_PREFIX.length);
    if (!PAGE_ID_PATTERN.test(pageId)) return null;
    const ids = parseArticlePageId(pageId);
    return withN(ids ? { kind: 'article', project: ids.projectId, article: ids.articleId, pageId } : { kind: 'id', id: pageId });
  }
  const urlish = parseUrlish(raw);
  if (urlish) {
    if (urlish.pageId) {
      const ids = parseArticlePageId(urlish.pageId);
      return withN(ids ? { kind: 'article', project: ids.projectId, article: ids.articleId, pageId: urlish.pageId } : { kind: 'id', id: urlish.pageId });
    }
    if (urlish.article) return withN({ kind: 'article', project: urlish.project, article: urlish.article, pageId: articlePageId(urlish.project, urlish.article) });
    return withN({ kind: 'id', id: urlish.project });
  }
  const slash = raw.match(SLASH_ARTICLE_RE);
  if (slash) return withN({ kind: 'article', project: slash[1], article: slash[2], pageId: articlePageId(slash[1], slash[2]) });
  if (ARTICLE_PAGE_ID_PATTERN.test(raw)) {
    const ids = parseArticlePageId(raw);
    return withN({ kind: 'article', project: ids.projectId, article: ids.articleId, pageId: raw });
  }
  if (PAGE_ID_PATTERN.test(raw) && !REF_SHAPE_RE.test(raw)) return withN({ kind: 'id', id: raw });
  return null;
}

/** 这个 token 像不像一枚引用（#n、@…、§n、B3、B、tab:B3）。像引用的不当目标。 */
export function looksLikeRef(token) {
  return REF_SHAPE_RE.test(String(token || '').trim());
}

/** 页 id → 显示用地址：文章页 id 打斜杠形，其余原样。 */
export function displayAddress(pageId) {
  const ids = parseArticlePageId(pageId);
  return ids ? `${ids.projectId}/${ids.articleId}` : String(pageId == null ? '' : pageId);
}

/** 任何目标写法 → 页 id（只看字面；不是目标的样子原样返回）。`p/a#3` → `p_a#3`。 */
export function toPageRef(token) {
  const parsed = parseAddress(token);
  if (!parsed) return token;
  const id = parsed.kind === 'article' ? parsed.pageId : parsed.id;
  return parsed.n ? `${id}#${parsed.n}` : id;
}

/**
 * 一枚引用换成 ann-refs 认的写法：`<project>/<article>#3` → `<页 id>#3`，`§2` → `B`
 * （第 n 节就是第 n 个字母，纯文字的节也占）。其余原样。
 */
export function normalizeRefToken(token) {
  const raw = String(token == null ? '' : token).trim();
  const section = raw.match(SECTION_NUMBER_RE);
  if (section) return sectionLetter(Number(section[1]) - 1);
  if (raw.includes('/') && NUM_SUFFIX_RE.test(raw)) return toPageRef(raw);
  return raw;
}

/** 节字母 → 节号（A → 1，Z → 26，AA → 27；sectionLetter 的反函数）。不是字母返回 null。 */
export function letterNumber(letter) {
  const raw = String(letter || '');
  if (!/^[A-Z]+$/.test(raw)) return null;
  let n = 0;
  for (const ch of raw) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** §n 写法 → n；别的写法 null。 */
export function sectionNumberOf(token) {
  const m = String(token || '').trim().match(SECTION_NUMBER_RE);
  return m ? Number(m[1]) : null;
}

/**
 * 对照 registry 与磁盘解析目标 →
 *   { kind: 'article', pageId, projectId, articleId, address, target, n? }
 *   { kind: 'project', projectId, address }
 *   { kind: 'page', pageId, address, n? }                     存量页（registry 条目或模板页）
 *   { kind: 'missing-article', projectId, articleId, pageId, address, projectKnown, n? }
 *   null                                                        什么都不是
 */
export function resolveAddress(token, { registry, manifestIds = [] } = {}) {
  const parsed = parseAddress(token);
  if (!parsed) return null;
  const withN = (value) => (parsed.n ? { ...value, n: parsed.n } : value);
  if (parsed.kind === 'article') {
    // 同 id 的模板页或登记页优先（与 resolvePage 同序）。
    if (registryEntry(registry, parsed.pageId) || manifestIds.includes(parsed.pageId)) {
      return withN({ kind: 'page', pageId: parsed.pageId, address: parsed.pageId });
    }
    const target = resolveArticleTarget(registry, parsed.pageId);
    const address = `${parsed.project}/${parsed.article}`;
    if (target) return withN({ kind: 'article', pageId: parsed.pageId, projectId: parsed.project, articleId: parsed.article, address, target });
    return withN({
      kind: 'missing-article',
      projectId: parsed.project,
      articleId: parsed.article,
      pageId: parsed.pageId,
      address,
      projectKnown: Boolean(projectEntry(registry, parsed.project)),
    });
  }
  if (projectEntry(registry, parsed.id)) {
    return parsed.n ? null : { kind: 'project', projectId: parsed.id, address: parsed.id };
  }
  if (registryEntry(registry, parsed.id) || manifestIds.includes(parsed.id)) {
    return withN({ kind: 'page', pageId: parsed.id, address: parsed.id });
  }
  return null;
}

/** 全部可作目标的地址：每篇文章的斜杠形 + 存量页 id（project 的文章按目录名排）。 */
export function targetCandidates({ registry, manifestIds = [], articlesOf }) {
  const rows = [];
  for (const entry of projectEntries(registry)) {
    for (const articleId of articlesOf(entry)) rows.push({ address: `${entry.id}/${articleId}`, kind: 'article' });
  }
  for (const entry of (registry && registry.entries) || []) {
    if (entry && entry.kind !== 'project') rows.push({ address: entry.id, kind: 'page' });
  }
  for (const id of manifestIds) if (!rows.some((row) => row.address === id)) rows.push({ address: id, kind: 'page' });
  return rows;
}
