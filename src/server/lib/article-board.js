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
import { CANVAS_ERROR_CODES, frameFileReaders, parseArticleCanvas, resolveRootFrame } from './article-canvas.js';
import { PROJECT_ROOT_SEGMENT, PROJECT_SOURCE_SEGMENT, articlePageId, rootFrameSrc } from '../../shared/project-ids.js';
import { isArticleError, isFigureError } from '../../shared/project-errors.js';
import { parseFrontmatter } from './frontmatter.js';
import { listArticleTargets, resolveArticleTarget } from './page-resolve.js';
import { findProject } from './projects.js';
import { loadRegistry } from './registry.js';
import { resolveContainedFile, resolveServableFile } from './servable-file.js';

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
  // 一篇文章的帧请求每个都要 board：首开一篇 34 帧的文章（正文卡片 + 画布浮层）要派生上百次，
  // 每次读正文和全部帧文件约 23 ms，机器负载高时请求排队到代理回 502（2026-10-19 性能审计 F1）。
  // 输入没变就用上次的结果；判“没变”只 stat，不读内容。
  const key = cacheKey(target);
  const hit = derivedCache.get(key);
  if (hit && depsUnchanged(hit.deps)) return structuredClone(hit.value);
  const value = deriveArticleBoardUncached(target);
  derivedCache.set(key, { deps: collectDeps(target, value), value: structuredClone(value) });
  return value;
}

const derivedCache = new Map();

function cacheKey(target) {
  return JSON.stringify([target.articleFile, target.pageDir, target.projectRoot, target.entryId, target.sources || {}]);
}

/** 文件或目录的 stat 指纹（跟 symlink）；不存在是 'absent'。目录的 mtime 在增删、改名条目时变。 */
function statSig(file) {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch {
    return 'absent';
  }
}

/** 派生用到的输入：正文、文章目录与图目录（增删帧、article.css/js）、每个帧的 jsx / html、project 根下的 HTML 帧。 */
function collectDeps(target, value) {
  const files = new Set([target.articleFile, target.pageDir, path.join(target.pageDir, 'figures')]);
  for (const section of value.sections) {
    for (const id of section.frames) {
      files.add(path.join(target.pageDir, `${id}.jsx`));
      files.add(path.join(target.pageDir, `${id}.html`));
      const src = section.frameSrc && section.frameSrc[id];
      if (src) {
        const root = resolveRootFrame(target.projectRoot, src, target.sources || {});
        if (root.file) files.add(root.file);
        else files.add(target.projectRoot);
      }
    }
  }
  return [...files].map((file) => [file, statSig(file)]);
}

function depsUnchanged(deps) {
  return deps.every(([file, sig]) => statSig(file) === sig);
}

function deriveArticleBoardUncached(target) {
  const found = resolveContainedFile(target.projectRoot, path.relative(target.projectRoot, target.articleFile), { index: false });
  if (!found.file) throw new Error('文章正文不在 project 根内或不存在');
  const text = fs.readFileSync(found.file, 'utf8');
  const fm = parseFrontmatter(text);
  const parsed = parseArticleCanvas(text, frameFileReaders(target.pageDir, { projectRoot: target.projectRoot, sources: target.sources }));
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
      // project 根下的 HTML 帧带 src（/sites/<页 id>/@root/<路径>）：工作台、/api/frame 和截图都按它打开这一帧。
      screens: section.frames.map((id) => ({
        id,
        ...(section.frameShells && section.frameShells[id] ? { shell: section.frameShells[id] } : {}),
        ...(section.frameSrc && section.frameSrc[id] ? { src: rootFrameSrc(target.entryId, section.frameSrc[id]) } : {}),
      })),
    })),
  };
  if (assets.css || assets.js) board.assets = assets;
  return { board, sections: parsed.sections, figures: parsed.figures || [], errors: parsed.errors };
}

/**
 * 站点卡片（M1-F）读的画布结构：articleCanvas(projectId, articleId, { registry? })
 *   → { pageId, project, article,
 *       sections: [{ id, title, letter, shell?, frames: [{ id, ref, shell?, missing? }] }],
 *       errors: [{ code, message, path?, line?, section?, frame? }] }
 * - letter 是这一节在正文里的字母（所有 Section 一起数，纯文字的节也占），画布编号
 *   （工作台、ppnt、ref）用同一个字母（派生 board 的 section.letter，见 board-refs.js）。
 * - frames 里没有源文件的帧带 missing: true（画布上那一格是错误面板）。HTML 帧带 url：它在服务上的地址
 *   （`/sites/<页 id>/…`，iframe 的 location.pathname），那一页的标注账本按它命名。帧文件写了
 *   `export const shell = "…"` 的帧带 shell（这一帧的实际 shell，盖过节的 shell）。
 * - errors：画布写法的错误带 section（节 id）、frame；不属于某一节的（frontmatter、
 *   页 id 撞名、MDX 写坏、Canvas 在节外…）没有 section，是页级错误。都是 listProjects 里
 *   这篇的布局错误（path 在 articles/<文章> 下的那些），对象相同。
 * - figures：正文里每个 <Figure> 一项，按正文顺序（docs/projects.md“图”）：
 *   [{ index, id?, caption?, section?, line?, missing?, errors: [错误对象] }]。index 是第几个 <Figure>
 *   （站点的 remark 步骤给每个 <Figure> 注入同一个序号）；src 写坏的图没有 id；源文件不在的带
 *   missing。errors 是这个图自己的错误（也都在顶层 errors 里，code 以 figure_ 开头）。
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
  const base = { pageId, project: projectId, article: articleId, sections: [], figures: [] };
  const project = findProject(reg, projectId);
  if (!project) return { ...base, errors: [{ code: 'project_not_registered', message: `project 没登记：${projectId}` }] };
  const own = project.errors.filter((error) => isArticleError(error, articleId));
  const target = resolveArticleTarget(reg, pageId);
  if (!target) return { ...base, errors: own.length ? own : [{ code: 'article_missing', message: `文章不存在：articles/${articleId}/index.mdx` }] };
  const derived = deriveArticleBoard(target);
  const refs = boardRefs(derived.board);
  const missingIds = new Set(derived.errors.filter((error) => error.code === 'frame_missing' && error.frame).map((error) => error.frame));
  const missing = new Set(derived.sections.flatMap((section) => section.frames).filter((id) => missingIds.has(id)));
  // HTML 帧在服务上的地址（iframe 的 location.pathname，百分号编码后的样子）：那一页的标注客户端按它定
  // 账本名（pageKeyFromPathname），文章页右栏与卡片标注数据此读同桶里那一页的账本。
  const htmlUrls = new Map();
  for (const section of derived.board.sections) {
    for (const screen of section.screens) {
      if (!articleHtmlFrameFile(target, screen)) continue;
      htmlUrls.set(`${section.id}\0${screen.id}`, screen.src ? `/${screen.src}` : `${target.urlBase}${screen.id}.html`);
    }
  }
  const sections = derived.sections.map((section) => ({
    id: section.id,
    title: section.title,
    letter: refs.bySection[section.id] || section.articleLetter,
    ...(section.shell ? { shell: section.shell } : {}),
    frames: section.frames.map((id) => ({
      id,
      ref: refs.byFrame[`${section.id}\0${id}`] || '',
      ...(section.frameShells && section.frameShells[id] ? { shell: section.frameShells[id] } : {}),
      ...(section.frameSrc && section.frameSrc[id] ? { src: section.frameSrc[id] } : {}),
      ...(htmlUrls.has(`${section.id}\0${id}`) ? { url: htmlUrls.get(`${section.id}\0${id}`) } : {}),
      ...(missing.has(id) ? { missing: true } : {}),
    })),
  }));
  // listProjects 里这篇的画布错误与 derived.errors 是同一次解析的结果：用 derived 的，其余（frontmatter、
  // 页 id 撞名）照搬。
  const errors = [...derived.errors, ...own.filter((error) => !CANVAS_ERROR_CODES.has(error.code))];
  const figureErrors = derived.errors.filter(isFigureError);
  const figures = derived.figures.map((figure) => {
    const mine = figureErrors.filter((error) => error.line === figure.line);
    return {
      ...figure,
      ...(mine.some((error) => error.code === 'figure_missing') ? { missing: true } : {}),
      errors: mine,
    };
  });
  return { ...base, sections, figures, errors };
}

/**
 * 工作台清单用的文章画布页（GET /registry 的 articles）：不进左栏 Pages，只让
 * `/workbench/?page=<页 id>` 认得它。[{ id, title, project, article, url }]
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

/**
 * 文章画布上一帧的 HTML 源文件（绝对路径），不是 HTML 帧返回 null（docs/projects.md“HTML 帧”）：
 * - screen 带 src（`sites/<页 id>/@root/<路径>` 或 `sites/<页 id>/@source/<名>/<路径>`）：project 根或
 *   那个 source 目录下的文件，越出目录或不在盘上时 null；
 * - 否则本篇目录下的 `<帧 id>.html`，同名的 `.jsx` 在时算 JSX 帧（编译器同一个顺序）；按文章目录的出文件规则
 *   （lib/servable-file.js）判，指出文章目录的 symlink 返回 null。
 * screen 是派生 board 里的屏（{ id, shell?, src? }）。
 */
export function articleHtmlFrameFile(target, screen) {
  if (!target || target.kind !== 'article' || !screen) return null;
  if (typeof screen.src === 'string' && screen.src) {
    const src = frameSrcFromUrlPath(target, screen.src);
    if (src === null) return null;
    const found = resolveRootFrame(target.projectRoot, src, target.sources);
    return found.file || null;
  }
  if (isFile(path.join(target.pageDir, `${screen.id}.jsx`))) return null;
  return resolveServableFile(target.pageDir, `${screen.id}.html`, { index: false }).file || null;
}

/**
 * 文章画布上现有的 HTML 帧在服务上的地址（解码后的 pathname，标注客户端记进账本 path 的那个形状）→ 帧 id。
 * 本篇的写成 `/sites/<页 id>/<帧 id>.html`，`{ id, src }` 的写成 `/sites/<页 id>/@root/<路径>` 或
 * `/sites/<页 id>/@source/<名>/<路径>`。帧要还在正文的 Canvas 里、源文件也解析得到才算：这张表是文章页的
 * 文档页标注表面（孤儿判定，src/server/lib/orphans.js）。board 缺省从 index.mdx 现派生。
 */
export function articleHtmlFramePaths(target, board = null) {
  const out = new Map();
  const derived = board || deriveArticleBoard(target).board;
  for (const section of (derived && derived.sections) || []) {
    for (const screen of section.screens || []) {
      if (!screen || typeof screen !== 'object' || !articleHtmlFrameFile(target, screen)) continue;
      let p = screen.src ? `/${String(screen.src).replace(/^\//, '')}` : `${target.urlBase}${screen.id}.html`;
      try { p = decodeURIComponent(p); } catch { /* 保持原样 */ }
      if (!out.has(p)) out.set(p, screen.id);
    }
  }
  return out;
}

/**
 * 服务地址 → 帧的 src 写法（解码后）：`@root/<路径>` → `<路径>`，`@source/<名>/<路径>` → `<名>:<路径>`。
 * urlPath 可以是 `/sites/<页 id>/…`（开头的 `/` 可有可无），也可以是 `/sites/<页 id>/` 之后的 rel。
 * 不是这两种形状返回 null。
 */
export function frameSrcFromUrlPath(target, urlPath) {
  let rest = String(urlPath || '').replace(/^\//, '');
  const base = target.urlBase.replace(/^\//, '');
  if (rest.startsWith(base)) rest = rest.slice(base.length);
  // 每一段恰好解码一次，来源标记本身也算一段：CLI（ppnt shot）按 URL 规范把 @ 编成 %40。
  const segs = rest.split('/');
  try {
    const head = decodeURIComponent(segs[0]);
    const decodeAll = (parts) => parts.map(decodeURIComponent).join('/');
    if (head === PROJECT_ROOT_SEGMENT && segs.length > 1) return decodeAll(segs.slice(1));
    if (head === PROJECT_SOURCE_SEGMENT && segs.length > 2) {
      const name = decodeURIComponent(segs[1]);
      if (!name) return null;
      return `${name}:${decodeAll(segs.slice(2))}`;
    }
  } catch {
    return null;
  }
  return null;
}

/** 文章组件的解析序：本篇 components/ > pinpoint/kit。没有 project 这一层（ADR 0045）。 */
export function articleComponentCandidates(target, name, kitJsxDir) {
  return [
    path.join(target.pageDir, 'components', `${name}.jsx`),
    path.join(kitJsxDir, `${name}.jsx`),
  ];
}
