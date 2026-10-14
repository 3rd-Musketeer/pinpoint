/**
 * 一个页 id 是什么（CONTEXT.md page 词条，docs/projects.md“画布视图”）：唯一的判定处。
 *
 *   resolvePage(registry, id, { manifestIds }) →
 *     { kind: 'entry', id, entry }       registry 条目（dir / file / url）
 *     { kind: 'template', id }           模板页：content/previews/_index.json 里的页 id
 *     { kind: 'article', id, target }    文章画布页 `<project>_<article>`：project 登记了、
 *                                        文章的 index.mdx 在盘上（只 stat，不解析正文）
 *     | null（不是页）
 *
 * 三种 id 按构造几乎不相撞：条目 id 不含 `_`，文章页 id 恰好一个 `_`（src/shared/project-ids.js），
 * 只有带 `_` 的模板页可能和文章页撞，撞了模板页优先（listProjects 记一条布局错误）。
 * project 条目不是页（它们在 registry.projects，不在 entries），project id 也不是桶。
 *
 * 用它的：服务收标注时的桶校验（annotate-api）、孤儿判定与 prune、`/sites/<id>/`（sites-api）、
 * mention 帧（frame-doc）、文章正文的注入（article-proxy）、编译目标（page-compiler 的
 * resolvePageTarget 在这上面加“有 board.json”）。
 *
 * registry 只认 loadRegistry 的结果与 registry-store 的 live view 这一种形状：
 * `entries`（页条目）+ `projects`（project 条目）。读 project 条目一律经 registry.js 的
 * projectEntries / projectEntry。
 */
import fs from 'node:fs';
import path from 'node:path';

import { articlePageId, parseArticlePageId, RESERVED_ARTICLE_IDS } from '../../shared/project-ids.js';
import { projectEntries, projectEntry, registryEntry } from './registry.js';

/** project 根下的内容目录（相对路径）。 */
export const PROJECT_CONTENT_DIR = path.join('docs', 'pinpoint');

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * 文章画布的编译目标，与普通 dir 页同形：pageDir = 文章目录，帧是 `<帧 id>.jsx` 或 `<帧 id>.html`；
 * projectRoot 是 project 根（project 根下的 HTML 帧从这里找，docs/projects.md“HTML 帧”）。
 * 文章目录或 index.mdx 不在时 null。
 */
function articleTarget(entry, articleId, pageId) {
  if (!entry || typeof entry.path !== 'string' || RESERVED_ARTICLE_IDS.has(articleId)) return null;
  const projectDir = path.join(path.resolve(entry.path), PROJECT_CONTENT_DIR);
  const articleDir = path.join(projectDir, 'articles', articleId);
  const articleFile = path.join(articleDir, 'index.mdx');
  if (!isFile(articleFile)) return null;
  return {
    entryId: pageId,
    pageDir: articleDir,
    urlBase: `/sites/${pageId}/`,
    kind: 'article',
    projectId: entry.id,
    articleId,
    projectRoot: path.resolve(entry.path),
    projectDir,
    articleFile,
  };
}

/**
 * 页 id → 文章画布的编译目标，或 null（不是文章页 id 的形状、project 没登记、
 * 文章目录或 index.mdx 不在）。只 stat，不解析正文。
 */
export function resolveArticleTarget(registry, pageId) {
  const ids = parseArticlePageId(pageId);
  if (!ids) return null;
  return articleTarget(projectEntry(registry, ids.projectId), ids.articleId, pageId);
}

/** 一个 project 条目下的全部文章画布目标，按目录名排序。 */
export function projectArticleTargets(entry) {
  if (!entry || typeof entry.path !== 'string') return [];
  const articlesDir = path.join(path.resolve(entry.path), PROJECT_CONTENT_DIR, 'articles');
  let names = [];
  try {
    names = fs.readdirSync(articlesDir).filter((name) => !name.startsWith('.')).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
  const targets = [];
  for (const name of names) {
    let pageId;
    try {
      pageId = articlePageId(entry.id, name);
    } catch {
      continue; // 目录名不合 id 规则：listProjects 已记布局错误
    }
    const target = articleTarget(entry, name, pageId);
    if (target) targets.push(target);
  }
  return targets;
}

/** 全部登记 project 的全部文章画布目标（服务启动全量编译、watch、页 id 清单用）。 */
export function listArticleTargets(registry) {
  return projectEntries(registry).flatMap((entry) => projectArticleTargets(entry));
}

/** 页 id → 它是什么（见文件头）；不是页返回 null。manifestIds = 模板页 id 清单。 */
export function resolvePage(registry, pageId, { manifestIds = [] } = {}) {
  if (!pageId) return null;
  const id = String(pageId);
  const entry = registryEntry(registry, id);
  if (entry) return { kind: 'entry', id, entry };
  if (manifestIds.includes(id)) return { kind: 'template', id };
  const target = resolveArticleTarget(registry, id);
  return target ? { kind: 'article', id, target } : null;
}

/**
 * 这个页 id 现在是不是一页（它的桶是活桶）。孤儿判定、prune、status / check 的整桶孤儿
 * 报告、服务端收标注时的桶校验都用这一处。文章目录删了或改名了，旧页 id 就不再是页，
 * 它的桶整桶皆孤儿。
 */
export function pageIdIsLive(registry, pageId, options = {}) {
  return resolvePage(registry, pageId, options) != null;
}
