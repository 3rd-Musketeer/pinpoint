/**
 * `ppnt show <project>[/<article>]`：一条命令列全一篇文章的节号对照，或一个 project 的全貌
 * （docs/registry.md“CLI”）。只读盘，不需要服务。
 *
 * 文章：每节 §n · 字母 · 节 id · 标题 · 帧 · open 数 · 网址（纯文字的节也列）。
 * project：文章、wiki 词条、空 ref、布局错误；有布局错误退 1（同 list <project>）。
 * 两种都把正文里图的编译错误与浏览器里记下的运行错误并进布局错误（docs/projects.md“图”），过期的图先重编。
 */
import fs from 'node:fs';
import path from 'node:path';

import { annStatusOf } from '../../src/shared/ann-status.js';
import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { countByStatus } from '../../src/server/lib/ann-query.js';
import { articleOutline, resolveRootFrame } from '../../src/server/lib/article-canvas.js';
import { projectEmptyRefs } from '../../src/server/lib/article-check.js';
import { figureDistErrors } from '../../src/server/lib/page-compiler.js';
import { resolveArticleTarget } from '../../src/server/lib/page-resolve.js';
import { findProject } from '../../src/server/lib/projects.js';
import { articleHref, articlePageId, parseFrameSrc } from '../../src/shared/project-ids.js';
import { formatProjectError, isArticleError } from '../../src/shared/project-errors.js';

import { DEFAULT_ORIGIN, ioOf } from './core.js';
import { guardParse, reportUsageError, USAGE_EXIT } from './args.js';
import { componentUses, formatUses } from './uses.js';
import { resolveAddress } from './address.js';
import { addressContext, printCandidates } from './targets.js';
import { listFrames, loadAnnotateContext } from './list.js';
import { canvasViewHref } from '../../src/shared/workbench-url.js';

const isOpen = (row) => annStatusOf(row) === 'open';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** 帧的源文件（显示用）：本篇目录下的 `<帧 id>.jsx` / `.html` 写文件名，`{ id, src }` 的 HTML 帧写
    `<src>（project 根）` 或 `<src>（source <名>）`；不在盘上是 null。 */
function frameFileShown(project, article, id, src) {
  if (src !== undefined) {
    if (!resolveRootFrame(project.root, src, project.sources).file) return null;
    const source = parseFrameSrc(src).source;
    return `${src}（${source ? `source ${source}` : 'project 根'}）`;
  }
  for (const name of [`${id}.jsx`, `${id}.html`]) if (fs.existsSync(path.join(article.dir, name))) return name;
  return null;
}

/** 一篇文章的模型（--json 原样输出，文字输出由 formatArticle 排）。 */
export function articleModel({ project, article, context, origin }) {
  const outline = articleOutline(readText(article.file));
  const canvasSections = new Map((context.refs.outline || []).map((section) => [section.id, section]));
  const rows = [...context.frameRows, ...context.docRows];
  const pageId = context.pageId;
  const articleUrl = `${origin}${articleHref(project.id, article.id)}`;
  const canvasUrl = canvasSections.size ? `${origin}${canvasViewHref(pageId)}` : null;
  const sections = outline.map((row) => {
    const onCanvas = row.id ? canvasSections.get(row.id) : null;
    const frameIds = onCanvas ? onCanvas.frames.map((frame) => frame.id) : row.frames;
    const frames = frameIds.map((id) => {
      const shown = onCanvas ? onCanvas.frames.find((frame) => frame.id === id) : null;
      return { ref: shown ? shown.ref : '', id, file: frameFileShown(project, article, id, row.sources && row.sources[id]) };
    });
    const open = rows.filter((entry) => isOpen(entry)
      && ((entry.screenId && frameIds.includes(entry.screenId)) || (entry.type === 'prose' && row.id && entry.section === row.id))).length;
    return {
      n: row.n,
      letter: row.letter,
      id: row.id,
      title: row.title,
      line: row.line,
      canvas: Boolean(onCanvas),
      // 写了 <Canvas> 却不在画布上：这一节有布局错误（见 errors）。
      canvasDropped: row.canvas && !onCanvas,
      frames,
      open,
      url: row.id ? `${articleUrl}#${row.id}` : articleUrl,
      canvasUrl: onCanvas ? `${origin}${canvasViewHref(pageId, row.id)}` : null,
    };
  });
  return {
    address: `${project.id}/${article.id}`,
    title: article.title,
    file: article.file,
    pageId,
    url: articleUrl,
    canvasUrl,
    counts: countByStatus(rows),
    sections,
    errors: project.errors.filter((error) => isArticleError(error, article.id)),
  };
}

function formatArticle(model) {
  const lines = [`# ${model.address} · ${model.title}`];
  lines.push(`文件：${model.file}`);
  lines.push(`文章页：${model.url}`);
  lines.push(model.canvasUrl ? `画布视图：${model.canvasUrl}` : '画布视图：无（没有带画布的节）');
  lines.push(`页 id：${model.pageId}（画布视图 /workbench/?page= 和数据目录里的桶用它）`);
  const c = model.counts;
  lines.push(`标注队列：open ${c.open} · check ${c.check} · done ${c.done} · close ${c.close}（ppnt comments ${model.address}）`);
  lines.push('');
  lines.push('节号  字母  节 id · 标题 · 帧 · open');
  if (!model.sections.length) lines.push('  （没有 <Section>）');
  for (const section of model.sections) {
    const what = section.canvas
      ? `${section.frames.length} 帧`
      : (section.canvasDropped ? `画布有错，不在画布视图上（${section.frames.length} 帧）` : '纯文字');
    lines.push(`§${section.n}  ${section.letter}  ${section.id || '（id 不是字面量）'} · ${section.title || ''} · ${what} · open ${section.open}`);
    for (const frame of section.frames) {
      lines.push(`      ${(frame.ref || '—').padEnd(4)} ${frame.id}  ${frame.file || '（缺帧文件）'}`);
    }
    lines.push(`      ${section.url}${section.canvasUrl ? `  ·  画布 ${section.canvasUrl}` : ''}`);
  }
  lines.push('');
  lines.push(model.errors.length ? `布局错误（${model.errors.length}，ppnt check ${model.address} 看全部问题）` : '布局错误：无');
  for (const error of model.errors) lines.push(`  ✗ ${formatProjectError(error)}`);
  return lines;
}

/** 一个 project 的模型。 */
export function projectModel({ registry, project, contextOf, origin }) {
  const articles = project.articles.map((article) => {
    const outline = articleOutline(readText(article.file));
    const context = contextOf(`${project.id}/${article.id}`);
    const rows = context ? [...context.frameRows, ...context.docRows] : [];
    return {
      address: `${project.id}/${article.id}`,
      title: article.title,
      summary: article.summary || '',
      sections: outline.length,
      frames: outline.reduce((sum, row) => sum + row.frames.length, 0),
      open: rows.filter(isOpen).length,
      url: `${origin}/${project.id}/${article.id}/`,
      file: article.file,
    };
  });
  return {
    id: project.id,
    title: project.title,
    root: project.root,
    url: `${origin}/${project.id}/`,
    llms: `${origin}/${project.id}/llms.txt`,
    articles,
    concepts: project.concepts.map((concept) => ({ name: concept.name, status: concept.status || '', boundary: concept.boundary || '', file: concept.file })),
    emptyRefs: projectEmptyRefs(registry, project.id),
    errors: project.errors,
  };
}

function formatProject(model) {
  const lines = [`# ${model.id} · ${model.title}`, `根目录：${model.root}`, `project 首页：${model.url}  ·  llms.txt：${model.llms}`, ''];
  lines.push(`文章（${model.articles.length}）`);
  if (!model.articles.length) lines.push('  （无）');
  for (const article of model.articles) {
    lines.push(`  ${article.address}  ·  ${article.title}  ·  ${article.sections} 节 · ${article.frames} 帧 · open ${article.open}`);
    lines.push(`    ${article.url}`);
  }
  lines.push('', `wiki（${model.concepts.length}）`);
  if (!model.concepts.length) lines.push('  （无）');
  for (const concept of model.concepts) lines.push(`  ${[concept.name, concept.status, concept.boundary].filter(Boolean).join('  ·  ')}`);
  lines.push('', model.emptyRefs.length ? `空 ref（${model.emptyRefs.length}，合法：目标还不存在）` : '空 ref：无');
  for (const ref of model.emptyRefs) {
    const where = ref.sources.map((source) => `${source.kind === 'article' ? source.id : `wiki ${source.id}`}:${source.line}`).join('、');
    lines.push(`  [[${ref.name}]] ← ${where}`);
  }
  lines.push('', model.errors.length ? `布局错误（${model.errors.length}）` : '布局错误：无');
  for (const error of model.errors) lines.push(`  ✗ ${formatProjectError(error)}`);
  lines.push('', `一篇文章的节和帧：ppnt show ${model.id}/<article>；验证：ppnt check ${model.id}`);
  return lines;
}

/** project 加上本 project 文章里图的编译与运行错误（articleId 给了只看这一篇）。 */
async function withFigureErrors(registry, project, env, articleId = null) {
  const distRoot = path.join(dataRoot(env), 'dist');
  const extra = [];
  for (const article of project.articles) {
    if (articleId && article.id !== articleId) continue;
    const target = resolveArticleTarget(registry, articlePageId(project.id, article.id));
    if (target) extra.push(...await figureDistErrors(target, { distRoot }));
  }
  return extra.length ? { ...project, errors: [...project.errors, ...extra] } : project;
}

/** show 的本体（list <project> 也走这里）。返回退出码。 */
export async function showTarget(token, parsed, { env, out, err }) {
  const ctx = addressContext(parsed.flags, env);
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  const hit = resolveAddress(token, ctx);
  const contextOf = (address) => loadAnnotateContext(address, parsed, { env, err: () => {} });
  if (parsed.flags.uses && hit && (hit.kind === 'project' || hit.kind === 'article')) {
    return showUses(hit, parsed, { ctx, env, out, contextOf });
  }
  if (parsed.flags.uses && hit && hit.kind === 'page') {
    return reportUsageError('show', `--uses 查 project 和文章里的组件；${token} 是存量页`, err);
  }
  if (hit && hit.kind === 'project') {
    const project = await withFigureErrors(ctx.registry, findProject(ctx.registry, hit.projectId), env);
    const model = projectModel({ registry: ctx.registry, project, contextOf, origin });
    if (parsed.flags.json) out(JSON.stringify(model, null, 2));
    else for (const line of formatProject(model)) out(line);
    return model.errors.length ? 1 : 0;
  }
  if (hit && hit.kind === 'article') {
    const project = findProject(ctx.registry, hit.projectId);
    const article = project && project.articles.find((entry) => entry.id === hit.articleId);
    const context = contextOf(hit.address);
    if (!article || !context) {
      err(`错误：读不出文章 ${hit.address}（articles/${hit.articleId} 有布局错误，ppnt check ${hit.projectId} 看原因）`);
      return 1;
    }
    const model = articleModel({ project: await withFigureErrors(ctx.registry, project, env, article.id), article, context, origin });
    if (parsed.flags.json) out(JSON.stringify(model, null, 2));
    else for (const line of formatArticle(model)) out(line);
    return 0;
  }
  if (hit && hit.kind === 'page') return listFrames([hit.pageId], { registryPath: ctx.registryPath, env, out, err });
  if (hit && hit.kind === 'missing-article') {
    err(`错误：找不到文章 ${hit.address}${hit.projectKnown ? `：project ${hit.projectId} 里没有 articles/${hit.articleId}/index.mdx` : `：project ${hit.projectId} 没登记`}`);
    printCandidates(ctx, err, hit.projectKnown ? { onlyProject: hit.projectId, heading: `${hit.projectId} 的文章` } : {});
    return USAGE_EXIT;
  }
  err(`错误：找不到 ${token}：show 的目标是 <project>、<project>/<article> 或存量页 id（按口头说法找用 ppnt list <关键词>）`);
  printCandidates(ctx, err);
  return USAGE_EXIT;
}

/** show --uses：project 查全部文章，文章只查这一篇。一个都没用到退 1。 */
async function showUses(hit, parsed, { ctx, env, out, contextOf }) {
  const project = findProject(ctx.registry, hit.projectId);
  const articles = hit.kind === 'article' ? project.articles.filter((article) => article.id === hit.articleId) : project.articles;
  const targets = [];
  for (const article of articles) {
    const target = resolveArticleTarget(ctx.registry, articlePageId(project.id, article.id));
    if (target) targets.push({ address: `${project.id}/${article.id}`, target, context: contextOf(`${project.id}/${article.id}`) });
  }
  const model = await componentUses({ component: parsed.flags.uses, targets, distRoot: path.join(dataRoot(env), 'dist') });
  const found = model.frames.length + model.figures.length > 0;
  if (parsed.flags.json) out(JSON.stringify({ target: hit.address, ...model }, null, 2));
  else for (const line of formatUses(model, hit.address)) out(line);
  return found ? 0 : 1;
}

export async function runShow(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  return showTarget(parsed.target, parsed, ioOf(io));
}
