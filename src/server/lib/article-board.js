/**
 * 每篇 article 的画布 = 一个由正文派生的页（docs/projects.md「画布视图」）。
 *
 * - 页 id = articlePageId(project, article)（src/shared/project-ids.js），`?page=`、标注桶、
 *   /sites/<id>/、ppnt 都用它。
 * - 编译目标（page-resolve.js 的 resolveArticleTarget）与普通 dir 页同形：pageDir = 文章目录，帧是
 *   `<帧 id>.jsx`。不同处只有 board 的来源：每次都从 index.mdx 现派生
 *   （deriveArticleBoard），编译时写进 dist（<dist>/<页 id>/board.json），从不写回
 *   源目录。
 * - articleCanvas(project, article, { registry? })：给站点卡片（M1-F）用的画布结构与错误。
 */
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { boardRefs } from '../../workbench/lib/board-refs.js';
import { CANVAS_ERROR_CODES, frameFileReaders, parseArticleCanvas } from './article-canvas.js';
import { articlePageId } from '../../shared/project-ids.js';
import { isArticleError } from '../../shared/project-errors.js';
import { parseFrontmatter } from './frontmatter.js';
import { listArticleTargets, resolveArticleTarget } from './page-resolve.js';
import { findProject } from './projects.js';
import { loadRegistry } from './registry.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** 本篇页级资源的固定文件名（common-m1.md §1），存在就像 board.assets 一样注入每帧。 */
export const ARTICLE_ASSET_FILES = Object.freeze({ css: 'article.css', js: 'article.js' });

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * 文章目标 → { board, sections, errors }：读 index.mdx 现派生 board（errors 是
 * parseArticleCanvas 的错误对象）。
 * board.sections 按正文 Section 顺序、只含有 Canvas 的节；screen 是帧 id。
 * 读不到 index.mdx 时抛错（与 board.json 读不到同一处理）。
 */
export function deriveArticleBoard(target) {
  const text = fs.readFileSync(target.articleFile, 'utf8');
  const fm = parseFrontmatter(text);
  const parsed = parseArticleCanvas(text, frameFileReaders(target.pageDir));
  const assets = {};
  if (isFile(path.join(target.pageDir, ARTICLE_ASSET_FILES.css))) assets.css = [ARTICLE_ASSET_FILES.css];
  if (isFile(path.join(target.pageDir, ARTICLE_ASSET_FILES.js))) assets.js = [ARTICLE_ASSET_FILES.js];
  const board = {
    title: fm.data.title || target.articleId,
    // 画布从哪篇文章派生：工作台与 CLI 可以据此指回正文。
    article: { project: target.projectId, id: target.articleId, url: `/${target.projectId}/${target.articleId}/` },
    sections: parsed.sections.map((section) => ({
      id: section.id,
      title: section.title,
      layout: 'row',
      // 正文里的节字母：画布编号（boardRefs）与文章节标题用同一个字母。
      letter: section.articleLetter,
      ...(section.shell ? { shell: section.shell } : {}),
      // 帧文件的 `export const shell = "…"` 落在这一屏上，盖过节的 shell（board 的 shell 可下放到单屏）。
      screens: section.frames.map((id) => (section.frameShells && section.frameShells[id] ? { id, shell: section.frameShells[id] } : { id })),
    })),
  };
  if (assets.css || assets.js) board.assets = assets;
  return { board, sections: parsed.sections, errors: parsed.errors };
}

/**
 * 站点卡片（M1-F）读的画布结构：articleCanvas(projectId, articleId, { registry? })
 *   → { pageId, project, article,
 *       sections: [{ id, title, letter, shell?, frames: [{ id, ref, shell?, missing? }] }],
 *       errors: [{ code, message, path?, line?, section?, frame? }] }
 * - letter 是这一节在正文里的字母（所有 Section 一起数，纯文字的节也占），画布编号
 *   （工作台、ppnt、ref）用同一个字母（派生 board 的 section.letter，见 board-refs.js）。
 * - frames 里没有源文件的帧带 missing: true（画布上那一格是错误面板）。帧文件写了
 *   `export const shell = "…"` 的帧带 shell（这一帧的实际 shell，盖过节的 shell）。
 * - errors：画布写法的错误带 section（节 id）、frame；不属于某一节的（frontmatter、
 *   页 id 撞名、MDX 写坏、Canvas 在节外…）没有 section，是页级错误。都是 listProjects 里
 *   这篇的布局错误（path 在 articles/<文章> 下的那些），对象相同。
 * - registry 缺省读 loadRegistry()（PINPOINT_REGISTRY 或 ~/.pinpoint/registry.json）。
 *   project 没登记或文章不在时 sections 为空、errors 说明原因。
 */
export function articleCanvas(projectId, articleId, { registry = null } = {}) {
  const reg = registry || loadRegistry({ root: REPO_ROOT, log: () => {} });
  let pageId = null;
  try {
    pageId = articlePageId(projectId, articleId);
  } catch (error) {
    return { pageId, project: projectId, article: articleId, sections: [], errors: [{ code: 'article_id_invalid', message: error.message }] };
  }
  const base = { pageId, project: projectId, article: articleId, sections: [] };
  const project = findProject(reg, projectId);
  if (!project) return { ...base, errors: [{ code: 'project_not_registered', message: `project 没登记：${projectId}` }] };
  const own = project.errors.filter((error) => isArticleError(error, articleId));
  const target = resolveArticleTarget(reg, pageId);
  if (!target) return { ...base, errors: own.length ? own : [{ code: 'article_missing', message: `文章不存在：articles/${articleId}/index.mdx` }] };
  const derived = deriveArticleBoard(target);
  const refs = boardRefs(derived.board);
  const missing = new Set(derived.sections.flatMap((section) => section.frames)
    .filter((id) => !isFile(path.join(target.pageDir, `${id}.jsx`))));
  const sections = derived.sections.map((section) => ({
    id: section.id,
    title: section.title,
    letter: refs.bySection[section.id] || section.articleLetter,
    ...(section.shell ? { shell: section.shell } : {}),
    frames: section.frames.map((id) => ({
      id,
      ref: refs.byFrame[`${section.id}\0${id}`] || '',
      ...(section.frameShells && section.frameShells[id] ? { shell: section.frameShells[id] } : {}),
      ...(missing.has(id) ? { missing: true } : {}),
    })),
  }));
  // listProjects 里这篇的画布错误与 derived.errors 是同一次解析的结果：用 derived 的，其余（frontmatter、
  // 页 id 撞名）照搬。
  const errors = [...derived.errors, ...own.filter((error) => !CANVAS_ERROR_CODES.has(error.code))];
  return { ...base, sections, errors };
}

/**
 * 工作台清单用的文章画布页（GET /registry 的 articles）：不进左栏 Pages，只让
 * `/?page=<页 id>` 认得它。[{ id, title, project, article, url }]
 */
export function articlePageRows(registry) {
  return listArticleTargets(registry).map((target) => {
    let title = target.articleId;
    try {
      title = parseFrontmatter(fs.readFileSync(target.articleFile, 'utf8')).data.title || title;
    } catch { /* 读不到：用 id */ }
    return {
      id: target.entryId,
      title,
      project: target.projectId,
      article: target.articleId,
      url: `/${target.projectId}/${target.articleId}/`,
    };
  });
}

/** 文章组件的解析序：本篇 components/ > project components/ > pinpoint/kit（common-m1.md §1）。 */
export function articleComponentCandidates(target, name, kitJsxDir) {
  return [
    path.join(target.pageDir, 'components', `${name}.jsx`),
    path.join(target.projectDir, 'components', `${name}.jsx`),
    path.join(kitJsxDir, `${name}.jsx`),
  ];
}
