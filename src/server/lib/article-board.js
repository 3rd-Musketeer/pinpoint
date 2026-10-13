/**
 * pp3 M1：每篇 article 的画布 = 一个由正文派生的页（docs/projects.md「文章的画布」）。
 *
 * - 页 id = articlePageId(project, article)（src/shared/project-ids.js），`?page=`、标注桶、
 *   /sites/<id>/、ppnt 都用它。
 * - 编译目标（resolveArticleTarget）与普通 dir 页同形：pageDir = 文章目录，帧是
 *   `<帧 id>.jsx`。不同处只有 board 的来源：每次都从 index.mdx 现派生
 *   （deriveArticleBoard），编译时写进 dist（<dist>/<页 id>/board.json），从不写回
 *   源目录。
 * - articleCanvas(project, article, { registry? })：给站点卡片（M1-F）用的画布结构与错误。
 */
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { boardRefs } from '../../workbench/lib/board-refs.js';
import { frameFileReaders, parseArticleCanvas } from './article-canvas.js';
import { articlePageId, parseArticlePageId, RESERVED_ARTICLE_IDS } from '../../shared/project-ids.js';
import { parseFrontmatter } from './frontmatter.js';
import { findProject, PROJECT_CONTENT_DIR } from './projects.js';
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

function projectEntryOf(registry, projectId) {
  if (!registry) return null;
  if (typeof registry.resolveProject === 'function') return registry.resolveProject(projectId) || null;
  const list = Array.isArray(registry.projects)
    ? registry.projects
    : (registry.entries || []).filter((entry) => entry && entry.kind === 'project');
  return list.find((entry) => entry && entry.id === projectId) || null;
}

function targetFor(entry, ids, pageId) {
  if (!entry || typeof entry.path !== 'string' || RESERVED_ARTICLE_IDS.has(ids.articleId)) return null;
  const projectDir = path.join(path.resolve(entry.path), PROJECT_CONTENT_DIR);
  const articleDir = path.join(projectDir, 'articles', ids.articleId);
  const articleFile = path.join(articleDir, 'index.mdx');
  if (!isFile(articleFile)) return null;
  return {
    entryId: pageId,
    pageDir: articleDir,
    urlBase: `/sites/${pageId}/`,
    kind: 'article',
    projectId: ids.projectId,
    articleId: ids.articleId,
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
  return targetFor(projectEntryOf(registry, ids.projectId), ids, pageId);
}

/** 全部登记 project 的全部文章画布目标（服务启动全量编译、watch、页 id 清单用）。 */
export function listArticleTargets(registry) {
  const entries = registry
    ? (Array.isArray(registry.projects) ? registry.projects : (registry.entries || []).filter((entry) => entry && entry.kind === 'project'))
    : [];
  const targets = [];
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string') continue;
    const articlesDir = path.join(path.resolve(entry.path), PROJECT_CONTENT_DIR, 'articles');
    let names = [];
    try {
      names = fs.readdirSync(articlesDir).filter((name) => !name.startsWith('.')).sort((a, b) => a.localeCompare(b));
    } catch {
      continue;
    }
    for (const name of names) {
      let pageId;
      try {
        pageId = articlePageId(entry.id, name);
      } catch {
        continue; // 目录名不合 id 规则：listProjects 已记布局错误
      }
      const target = targetFor(entry, { projectId: entry.id, articleId: name }, pageId);
      if (target) targets.push(target);
    }
  }
  return targets;
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
 *       errors: [{ message, line?, section?, frame? }] }
 * - letter 是这一节在正文里的字母（所有 Section 一起数，纯文字的节也占），画布编号
 *   （工作台、ppnt、ref）用同一个字母（派生 board 的 section.letter，见 board-refs.js）。
 * - frames 里没有源文件的帧带 missing: true（画布上那一格是错误面板）。帧文件写了
 *   `export const shell = "…"` 的帧带 shell（这一帧的实际 shell，盖过节的 shell）。
 * - errors：画布写法的错误带 section（节 id）、frame；不属于某一节的（frontmatter、
 *   页 id 撞名、MDX 写坏、Canvas 在节外…）没有 section，是页级错误。message 与
 *   listProjects 里这篇的布局错误同一句（去掉 articles/<文章>/index.mdx： 前缀）。
 * - registry 缺省读 loadRegistry()（PINPOINT_REGISTRY 或 ~/.pinpoint/registry.json）。
 *   project 没登记或文章不在时 sections 为空、errors 说明原因。
 */
export function articleCanvas(projectId, articleId, { registry = null } = {}) {
  const reg = registry || loadRegistry({ root: REPO_ROOT, log: () => {} });
  let pageId = null;
  try {
    pageId = articlePageId(projectId, articleId);
  } catch (error) {
    return { pageId, project: projectId, article: articleId, sections: [], errors: [{ message: error.message }] };
  }
  const base = { pageId, project: projectId, article: articleId, sections: [] };
  const project = findProject(reg, projectId);
  if (!project) return { ...base, errors: [{ message: `project 没登记：${projectId}` }] };
  const prefix = `articles/${articleId}`;
  const own = project.errors
    .filter((problem) => problem.startsWith(`${prefix}/`) || problem.startsWith(`${prefix}：`))
    .map((problem) => problem.replace(new RegExp(`^${prefix}(?:/index\\.mdx)?：`), ''));
  const target = resolveArticleTarget(reg, pageId);
  if (!target) return { ...base, errors: (own.length ? own : [`文章不存在：${prefix}/index.mdx`]).map((message) => ({ message })) };
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
  const canvasMessages = new Set(derived.errors.map((e) => e.message));
  const errors = [...derived.errors, ...own.filter((message) => !canvasMessages.has(message)).map((message) => ({ message }))];
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
