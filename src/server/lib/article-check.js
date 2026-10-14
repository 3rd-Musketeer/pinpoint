/**
 * 文章的验证（`ppnt check <project>[/<article>]`）：汇报前一条命令看全一篇文章或一个 project 的问题。
 *
 *   checkProject(registry, projectId, { articleId? }) →
 *     { project, articles: [文章 id…], frames: 编了几帧, figures: 编了几个图, diagnostics: [诊断…] } | null（project 没登记）
 *
 * 诊断 = { severity: 'error' | 'warning' | 'info', code, file, line, message, article?, section?, frame?, figure? }：
 * - 布局错误：listProjects 读出的那些（code 原样，path 换成绝对路径，message 去掉“第 N 行：”前缀，行号在 line）。
 * - 帧：正文里每个 <Canvas> 字面上列的帧都编一遍（articleOutline，被布局错误挡在画布外的节也算），
 *   lint 与编译错误带帧文件和行（frameDiagnostics），不落 dist。HTML 帧不编译，查它引用的本地文件：
 *   解析到可服务范围外是错误（html_asset_outside），不在盘上是警告（html_asset_missing），带引用所在的文件和行。
 * - 图：正文里每个源文件在的 <Figure> 也编一遍（compileFigure，同帧的 lint 与编译规则），诊断带图文件和行
 *   与 figure（图 id），不落 dist。图的写法错误（src、缺文件）已是布局错误；浏览器里的运行错误要打开过
 *   图才有，check 不跑图，看 ppnt show <project>。
 * - 正文渲染：checkMdxRender（没定义的组件、变量这类打开文章页才出的错）。正文连 MDX 都解析不了时
 *   已有一条 mdx_parse 布局错误，不再渲染。
 * - 空 ref：info 级（合法，只是提示还有哪些词没定义）。
 * 有 error 级诊断就是没通过。
 */
import fs from 'node:fs';
import path from 'node:path';

import { extractRefs, parseRefBody } from '../../shared/refs.js';
import { articlePageId, refKey } from '../../shared/project-ids.js';
import { isArticleError } from '../../shared/project-errors.js';
import { articleOutline, resolveRootFrame } from './article-canvas.js';
import { collectHtmlFrameAssets } from './html-frame-assets.js';
import { parseFrontmatter } from './frontmatter.js';
import { checkMdxRender } from './mdx-check.js';
import { deriveArticleBoard } from './article-board.js';
import { compileFigure, figureFiles, frameDiagnostics } from './page-compiler.js';
import { resolveArticleTarget } from './page-resolve.js';
import { listProjects } from './projects.js';

const LINE_PREFIX_RE = /^第 \d+ 行[：:]\s*/;

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
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

/** `[[ ]]` 的目标在不在：本 project 的文章 id 与 concept name，或 `[[project:名字]]` 指的那个 project。 */
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

/** 一份正文里的空 ref，带行号：跳过 frontmatter、围栏代码和行内代码（与站点的 remark 步骤同口径）。 */
export function emptyRefsIn(text, { from, resolve }) {
  const source = String(text || '').replace(/^﻿/, '');
  const { body } = parseFrontmatter(source);
  const skip = body === source ? 0 : source.slice(0, source.length - body.length).split('\n').length - 1;
  const lines = source.split('\n');
  const found = [];
  let fence = null;
  for (let i = skip; i < lines.length; i++) {
    const line = lines[i];
    const opener = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
      continue;
    }
    if (opener) {
      fence = opener[1];
      continue;
    }
    for (const raw of extractRefs(line.replace(/`[^`\n]*`/g, ''))) {
      const hit = resolve(raw, from);
      if (!hit.found) found.push({ line: i + 1, name: hit.projectId === from ? hit.name : `${hit.projectId}:${hit.name}`, raw });
    }
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
  const file = path.join(target.pageDir, `${frame}.html`);
  return isFile(file) ? { file, root: target.pageDir } : null;
}

/** HTML 帧引用的本地文件：越出可服务范围是错误，不在盘上是警告（docs/projects.md“HTML 帧”）。 */
function htmlFrameDiagnostics({ file, root }, { address, section, frame }) {
  const { missing, outside } = collectHtmlFrameAssets(file, { root });
  const where = (row) => ({ file: row.from, line: row.line, article: address, ...(section ? { section } : {}), frame });
  return [
    ...outside.map((row) => ({
      severity: 'error',
      code: 'html_asset_outside',
      message: `引用的 ${JSON.stringify(row.url)} 解析到 ${row.file}，在 ${root} 外面，服务不出这个文件`,
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

/** 一篇文章：帧、正文渲染、空 ref 的诊断（布局错误另由 checkProject 给）。 */
async function checkArticle({ registry, project, article, resolve, layoutErrors, frameCache }) {
  const address = `${project.id}/${article.id}`;
  const diagnostics = [];
  const text = readText(article.file);
  if (text === null) return { diagnostics, frames: 0, figures: 0 };
  const target = resolveArticleTarget(registry, articlePageId(project.id, article.id));
  const outline = articleOutline(text);
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
      const result = await frameDiagnostics(target, frame);
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
      message: `空 ref [[${ref.raw}]]：“${ref.name}”还没有文章或概念（合法，project 首页会列出）`,
      article: address,
    });
  }
  return { diagnostics, frames, figures };
}

/**
 * 一个 project 的全部空 ref（文章和概念正文里写的都算），按名字合并：
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

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/** 见文件头。articleId 给了只查这一篇（project 自己的错误也算，它们会让整站构建失败）。 */
export async function checkProject(registry, projectId, { articleId = null } = {}) {
  const projects = listProjects(registry);
  const project = projects.find((entry) => entry.id === projectId);
  if (!project) return null;
  const articles = articleId ? project.articles.filter((article) => article.id === articleId) : project.articles;
  const diagnostics = [];
  for (const error of project.errors) {
    // 只查一篇时，别的文章和概念的错误不算；project 自己的错误（没有 path）照报。
    if (articleId && error.path && !isArticleError(error, articleId)) continue;
    diagnostics.push(layoutDiagnostic(project, error));
  }
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
          message: `空 ref [[${ref.raw}]]：“${ref.name}”还没有文章或概念（合法，project 首页会列出）`,
        });
      }
    }
  }
  diagnostics.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || String(a.file).localeCompare(String(b.file))
    || (a.line || 0) - (b.line || 0));
  return { project, articles: articles.map((article) => article.id), frames, figures, diagnostics };
}

