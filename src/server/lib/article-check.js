/**
 * 文章的验证（`ppnt check <project>[/<article>]`）：汇报前一条命令看全一篇文章或一个 project 的问题。
 *
 *   checkProject(registry, projectId, { articleId? }) →
 *     { project, articles: [文章 id…], frames: 编了几帧, figures: 编了几个图, diagnostics: [诊断…] } | null（project 没登记）
 *
 * 诊断 = { severity: 'error' | 'warning' | 'info', code, file, line, message, article?, section?, frame?, figure? }：
 * - 布局错误：listProjects 读出的那些（code 原样，path 换成绝对路径，message 去掉“第 N 行：”前缀，行号在 line）。
 * - 帧：正文里每个 <Canvas> 字面上列的帧都编一遍（articleOutline，被布局错误挡在画布外的节也算），
 *   lint 与编译错误带帧文件和行（compileScreenChecked，一帧只编一次，产物同时给机壳
 *   契约与 sidecar 挂载点用），不落 dist。HTML 帧不编译，查它引用的本地文件：
 *   解析到可服务范围外是错误（html_asset_outside），不在盘上是警告（html_asset_missing），带引用所在的文件和行。
 * - 图：正文里每个源文件在的 <Figure> 也编一遍（compileFigure，同帧的 lint 与编译规则），诊断带图文件和行
 *   与 figure（图 id），不落 dist。图的写法错误（src、缺文件）已是布局错误；浏览器里的运行错误要打开过
 *   图才有，check 不跑图，看 ppnt show <project>。
 * - 正文渲染：checkMdxRender（没定义的组件、变量这类打开文章页才出的错）。正文连 MDX 都解析不了时
 *   已有一条 mdx_parse 布局错误，不再渲染。
 * - 空 ref：info 级（合法，只是提示还有哪些词没定义）。
 * - project 的 title 像一句描述（带冒号或超过 24 个字符）：info 级（ADR 0044：project 只是装一批文章的文件夹，title 只写名字）。
 * 有 error 级诊断就是没通过。
 */
import fs from 'node:fs';
import path from 'node:path';

import { parseRefBody, refsWithLines } from '../../shared/refs.js';
import { articlePageId, refKey } from '../../shared/project-ids.js';
import { isArticleError } from '../../shared/project-errors.js';
import { articleOutline, resolveRootFrame } from './article-canvas.js';
import { screenEntries } from '../../shared/board-screens.js';
import { collectHtmlFrameAssets } from './html-frame-assets.js';
import { resolveServableFile } from './servable-file.js';
import { parseFrontmatter } from './frontmatter.js';
import { checkMdxRender } from './mdx-check.js';
import { deriveArticleBoard } from './article-board.js';
import { compileFigure, compileScreenChecked, figureFiles } from './page-compiler.js';
import { resolveArticleTarget } from './page-resolve.js';
import { listProjects } from './projects.js';
import { isFile } from './fs-utils.js';

const LINE_PREFIX_RE = /^第 \d+ 行[：:]\s*/;

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** 布局错误 → 诊断。project 自己的错误（没有 path）指 project.json。 */
function layoutDiagnostic(project, error) {
  const file = error.path ? path.join(project.dir, error.path) : path.join(project.dir, 'project.json');
  const articleMatch = (error.path || '').match(/^articles\/([^/]+)/);
  return {
    severity: 'error',
    code: error.code || 'layout',
    file,
    line: error.line || null,
    message: String(error.message || '').replace(LINE_PREFIX_RE, ''),
    ...(articleMatch ? { article: `${project.id}/${articleMatch[1]}` } : {}),
    ...(error.section ? { section: error.section } : {}),
    ...(error.frame ? { frame: error.frame } : {}),
  };
}

/** `[[ ]]` 的目标在不在：本 project 的文章 id 与 wiki 词条的 name，或 `[[project:名字]]` 指的那个 project。 */
function refResolver(projects) {
  const names = new Map(projects.map((project) => [project.id, new Set([
    ...project.articles.map((article) => refKey(article.id)),
    ...project.concepts.map((concept) => refKey(concept.name)),
  ])]));
  return (raw, from) => {
    const { target } = parseRefBody(raw);
    let projectId = from;
    let name = target;
    const colon = target.indexOf(':');
    if (colon > 0 && names.has(target.slice(0, colon).trim())) {
      projectId = target.slice(0, colon).trim();
      name = target.slice(colon + 1).trim();
    }
    return { name, projectId, found: Boolean(names.get(projectId) && names.get(projectId).has(refKey(name))) };
  };
}

/** 一份正文里的空 ref，带行号：跳过 frontmatter；代码怎么跳与站点同一份（src/shared/refs.js refsWithLines）。 */
export function emptyRefsIn(text, { from, resolve }) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const { body } = parseFrontmatter(source);
  const skip = body === source ? 0 : source.slice(0, source.length - body.length).split('\n').length - 1;
  const found = [];
  for (const { line, raw } of refsWithLines(body)) {
    const hit = resolve(raw, from);
    if (!hit.found) found.push({ line: line + skip, name: hit.projectId === from ? hit.name : `${hit.projectId}:${hit.name}`, raw });
  }
  return found;
}

/** 正文里一帧的 HTML 源文件：→ { file, root } | null（不是 HTML 帧，或文件不在：缺帧是布局错误）。
    root 是这一帧能引用到的范围：本篇目录下的帧是文章目录（服务在 /sites/<页 id>/ 下出它），
    project 根下的帧是 project 根（/sites/<页 id>/@root/ 下），source 下的帧是那个 source 目录
    （/sites/<页 id>/@source/<名>/ 下）。 */
function htmlFrameFile(target, frame, src) {
  if (src !== undefined) {
    const found = resolveRootFrame(target.projectRoot, src, target.sources);
    return found.file ? { file: found.file, root: found.base } : null;
  }
  if (isFile(path.join(target.pageDir, `${frame}.jsx`))) return null;
  const file = resolveServableFile(target.pageDir, `${frame}.html`, { index: false }).file;
  return file ? { file, root: target.pageDir } : null;
}

/** HTML 帧引用的本地文件：服务出不来（越出范围、symlink 指出去、隐藏文件）是错误，不在盘上是警告（docs/projects.md“HTML 帧”）。 */
function htmlFrameDiagnostics({ file, root }, { address, section, frame }) {
  const { missing, outside } = collectHtmlFrameAssets(file, { root });
  const where = (row) => ({ file: row.from, line: row.line, article: address, ...(section ? { section } : {}), frame });
  return [
    ...outside.map((row) => ({
      severity: 'error',
      code: 'html_asset_outside',
      message: row.reason === 'denied'
        ? `引用的 ${JSON.stringify(row.url)} 解析到 ${row.file}，是 . 开头的隐藏文件或文章正文 index.mdx（或符号链接指向它们），服务不出这个文件`
        : `引用的 ${JSON.stringify(row.url)} 解析到 ${row.file}，在 ${root} 外面（含符号链接指出去），服务不出这个文件`,
      ...where(row),
    })),
    ...missing.map((row) => ({
      severity: 'warning',
      code: 'html_asset_missing',
      message: `引用的 ${JSON.stringify(row.url)} 不在盘上（${row.file}）`,
      ...where(row),
    })),
  ];
}

/** doc 机壳的帧文件写法：`export const shell = "doc"`（与 lint 认的同一行）。 */
// 画布 fragment 的机壳契约（workbench validateScreenFragment 的同一句正则）：
// 非 comp / doc 壳的屏必须有这一族根元素，否则画布挂 ContractError 错误面板。
const IOS_SHELL_RE = /\b(?:ios-app|ios-lockscreen|ios-stage|ios-device)\b/;

/**
 * R5 B4（诊断缺口）：裸组件 JSX 帧不写 shell——check/build 全绿，工作台画布挂
 * ContractError 错误面板。契约（validateScreenFragment）此前只在客户端拉帧时跑，
 * check 不看帧内容形态。这里对编译产物用同一句正则校验：非 comp / doc 壳的帧
 * 缺机壳就是 error（运行时事实如此）。HTML 帧套非 doc 机壳的装载面归画布侧
 * （R5 B2 的后续），不在这里猜。
 */
function frameShellDiagnostic(frame, section, { address, pageDir }) {
  return {
    severity: 'error',
    code: 'frame_shell_missing',
    file: path.join(pageDir, `${frame}.jsx`),
    message: '帧内容没有 ios-app / ios-lockscreen 机壳，工作台画布会挂 ContractError 错误面板：给帧内容套机壳，或给节 / 帧写 shell="comp"（无机壳片段）。',
    article: address,
    ...(section && section.id ? { section: section.id } : {}),
    frame,
  };
}

/**
 * R5 S3（诊断缺口）：ios 帧的同名 sidecar `<帧 id>.js` 只在帧根标了
 * data-preview-mount（board-schema「交互 frame」B 形态）或帧里有显式的
 * data-preview-script 时才被装载；doc 机壳的屏由 wb-doc-surface 隐式探。
 * 写了 sidecar 却两条都不占，画布静默无交互——check 此前全绿。只查 JSX 帧。
 */
function sidecarMountHint(target, frame, section, { address, html }) {
  if (!html) return [];
  if (!isFile(path.join(target.pageDir, `${frame}.js`))) return [];
  if (/data-preview-mount/.test(html) || /data-preview-script/.test(html)) return [];
  return [{
    severity: 'warning',
    code: 'sidecar_no_mount',
    file: path.join(target.pageDir, `${frame}.js`),
    message: '同名 sidecar 存在，但帧里没有挂载点：帧根要标 data-preview-mount（board-schema「交互 frame」B 形态；doc 机壳的屏才隐式探 <帧 id>.js）。这个 sidecar 现在在画布上不会执行。',
    article: address,
    ...(section && section.id ? { section: section.id } : {}),
    frame,
  }];
}

/** 一篇文章：帧、正文渲染、空 ref 的诊断（布局错误另由 checkProject 给）。 */
async function checkArticle({ registry, project, article, resolve, layoutErrors, frameCache }) {
  const address = `${project.id}/${article.id}`;
  const diagnostics = [];
  const text = readText(article.file);
  if (text === null) return { diagnostics, frames: 0, figures: 0 };
  const target = resolveArticleTarget(registry, articlePageId(project.id, article.id));
  const outline = articleOutline(text);
  // 屏 id → 有效 shell（派生板，含帧级 export const shell 的覆盖）。
  let boardScreens = null;
  if (target) {
    try {
      // 帧 → { frameShell, sectionShell }：帧级 export const shell 盖过节；两个都
      // 没写时 JSX 帧按缺省 app 走画布契约（R5 B4 的复现形态）。节级 shell 在画布
      // 分派里的确切行为归画布侧核实，只写节级的不在这里下判断。
      boardScreens = new Map(screenEntries(deriveArticleBoard(target).board).map(({ screen, section }) => [
        screen.id,
        { frameShell: screen.shell || null, sectionShell: (section && section.shell) || null, src: Boolean(screen.src) },
      ]));
    } catch { /* 板错误由布局诊断另报 */ }
  }
  let frames = 0;
  for (const section of outline) {
    for (const frame of section.frames) {
      const html = target ? htmlFrameFile(target, frame, section.sources && section.sources[frame]) : null;
      if (html) {
        frames += 1;
        diagnostics.push(...htmlFrameDiagnostics(html, { address, section: section.id, frame }));
        continue;
      }
      if (!target || !isFile(path.join(target.pageDir, `${frame}.jsx`))) continue; // 缺帧是布局错误
      frames += 1;
      // 画布契约只看能从产物判定的形状：帧级 shell 写了按它（comp / doc 跳过），
      // 只写了节级 shell 的跳过（分派归画布侧），两个都没写按缺省 app 校验。
      // 一帧只编一次：lint / 编译诊断、机壳契约（B4）和 sidecar 提示（S3）共用这份
      // 产物。编译失败不拿失败的产物说事。
      const result = await compileScreenChecked(target, frame);
      const shells = boardScreens ? boardScreens.get(frame) : null;
      // shellChecked 同时是机壳契约与 sidecar 提示的门：只在帧级 shell 为 app / lock
      // （或两个都没写、按缺省 app）时才拿产物说话。comp、doc、只写了节级 shell 的
      // 帧产物不进这两条诊断——sidecar 的 html 传 null，与并成一次编译之前一致。
      const shellChecked = result.ok && shells && !shells.src
        && (shells.frameShell ? shells.frameShell !== 'comp' && shells.frameShell !== 'doc' : !shells.sectionShell);
      if (shellChecked && !IOS_SHELL_RE.test(result.html)) {
        diagnostics.push(frameShellDiagnostic(frame, section, { address, pageDir: target.pageDir }));
      }
      diagnostics.push(...sidecarMountHint(target, frame, section, { address, html: shellChecked ? result.html : null }));
      for (const row of result.diagnostics) {
        const key = `${row.code}|${row.file}|${row.line}|${row.message}`;
        // 几帧共用的组件只报一次。
        if (frameCache.has(key)) continue;
        frameCache.add(key);
        diagnostics.push({
          severity: 'error',
          code: row.code,
          file: row.file || path.join(target.pageDir, `${frame}.jsx`),
          line: row.line || null,
          message: row.message,
          article: address,
          ...(section.id ? { section: section.id } : {}),
          frame,
        });
      }
    }
  }
  let figures = 0;
  let figureList = [];
  try {
    figureList = target ? deriveArticleBoard(target).figures : [];
  } catch { /* 读不到正文：布局错误另报 */ }
  for (const figure of figureList) {
    if (!figure.id || !isFile(path.join(target.pageDir, figureFiles(figure.id).jsx))) continue; // 写法错误、缺文件是布局错误
    figures += 1;
    const result = await compileFigure(target, figure.id);
    if (result.ok) continue;
    for (const row of result.diagnostics || [{ code: 'compile', file: null, line: null, message: result.error }]) {
      const key = `${row.code}|${row.file}|${row.line}|${row.message}`;
      if (frameCache.has(key)) continue; // 图和帧共用的组件只报一次
      frameCache.add(key);
      diagnostics.push({
        severity: 'error',
        code: row.code,
        file: row.file || path.join(target.pageDir, figureFiles(figure.id).jsx),
        line: row.line || null,
        message: row.message,
        article: address,
        ...(figure.section ? { section: figure.section } : {}),
        figure: figure.id,
      });
    }
  }
  if (!layoutErrors.some((error) => error.code === 'mdx_parse')) {
    for (const row of await checkMdxRender(text, { file: article.file })) {
      diagnostics.push({ severity: row.severity, code: row.code, file: article.file, line: row.line, message: row.message, article: address });
    }
  }
  for (const ref of emptyRefsIn(text, { from: project.id, resolve })) {
    diagnostics.push({
      severity: 'info',
      code: 'empty_ref',
      file: article.file,
      line: ref.line,
      message: `空 ref [[${ref.raw}]]：“${ref.name}”还没有文章或 wiki 词条（合法，project 首页会列出）`,
      article: address,
    });
  }
  return { diagnostics, frames, figures };
}

/**
 * 一个 project 的全部空 ref（文章和 wiki 词条正文里写的都算），按名字合并：
 * [{ name, sources: [{ kind: 'article' | 'concept', id, file, line }] }]，引用多的在前。
 * `ppnt show <project>` 用它；站点首页的列表（site-data.js 的 projectEmptyRefs）是同一口径。
 */
export function projectEmptyRefs(registry, projectId) {
  const projects = listProjects(registry);
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) return [];
  const resolve = refResolver(projects);
  const byName = new Map();
  const note = (ref, source) => {
    if (!byName.has(ref.name)) byName.set(ref.name, []);
    byName.get(ref.name).push({ ...source, line: ref.line });
  };
  for (const article of project.articles) {
    for (const ref of emptyRefsIn(readText(article.file) || '', { from: project.id, resolve })) note(ref, { kind: 'article', id: article.id, file: article.file });
  }
  for (const concept of project.concepts) {
    for (const ref of emptyRefsIn(readText(concept.file) || '', { from: project.id, resolve })) note(ref, { kind: 'concept', id: concept.name, file: concept.file });
  }
  return [...byName.entries()]
    .map(([name, sources]) => ({ name, sources }))
    .sort((a, b) => b.sources.length - a.sources.length || a.name.localeCompare(b.name, 'zh'));
}

/** project title 的上限（字符数，按码位数）；超过或带冒号时 check 给一条提示（ADR 0044）。 */
const PROJECT_TITLE_MAX = 24;

/** project title 像不像一句描述：→ 原因列表（空 = 没问题）。 */
export function projectTitleIssues(title) {
  const text = String(title == null ? '' : title);
  const issues = [];
  if (/[:：]/.test(text)) issues.push('带冒号');
  if ([...text].length > PROJECT_TITLE_MAX) issues.push(`超过 ${PROJECT_TITLE_MAX} 个字符`);
  return issues;
}

function projectTitleDiagnostic(project) {
  const issues = projectTitleIssues(project.title);
  if (!issues.length) return null;
  const file = path.join(project.dir, 'project.json');
  const lines = (readText(file) || '').split('\n');
  const at = lines.findIndex((line) => /"title"\s*:/.test(line));
  return {
    severity: 'info',
    code: 'project_title_long',
    file,
    line: at >= 0 ? at + 1 : null,
    message: `project 的 title 只写名字（例如 Vault、Areta browser use），不写成一句描述。现在是“${project.title}”（${issues.join('、')}）`,
  };
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/** 见文件头。articleId 给了只查这一篇（project 自己的错误也算，它们会让整站构建失败）。 */
export async function checkProject(registry, projectId, { articleId = null } = {}) {
  const projects = listProjects(registry);
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) return null;
  const articles = articleId ? project.articles.filter((article) => article.id === articleId) : project.articles;
  const diagnostics = [];
  for (const error of project.errors) {
    // 只查一篇时，别的文章和 wiki 词条的错误不算；project 自己的错误（没有 path）照报。
    if (articleId && error.path && !isArticleError(error, articleId)) continue;
    diagnostics.push(layoutDiagnostic(project, error));
  }
  const titleHint = projectTitleDiagnostic(project);
  if (titleHint) diagnostics.push(titleHint);
  const resolve = refResolver(projects);
  const frameCache = new Set();
  let frames = 0;
  let figures = 0;
  for (const article of articles) {
    const layoutErrors = project.errors.filter((error) => isArticleError(error, article.id));
    const result = await checkArticle({ registry, project, article, resolve, layoutErrors, frameCache });
    diagnostics.push(...result.diagnostics);
    frames += result.frames;
    figures += result.figures;
  }
  if (!articleId) {
    for (const concept of project.concepts) {
      for (const ref of emptyRefsIn(readText(concept.file) || '', { from: project.id, resolve })) {
        diagnostics.push({
          severity: 'info',
          code: 'empty_ref',
          file: concept.file,
          line: ref.line,
          message: `空 ref [[${ref.raw}]]：“${ref.name}”还没有文章或 wiki 词条（合法，project 首页会列出）`,
        });
      }
    }
  }
  diagnostics.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || String(a.file).localeCompare(String(b.file))
    || (a.line || 0) - (b.line || 0));
  return { project, articles: articles.map((article) => article.id), frames, figures, diagnostics };
}

