/**
 * `ppnt open <目标> [§2 | 节 id | 概念名] [--print]`：一篇文章、一节、一个 project 或一个概念页的网址。
 * --print 只打印；不带时用系统浏览器打开第一个网址（io.openUrl，bin/pinpoint.mjs 注入）。
 * 网址的前缀是 PINPOINT_ORIGIN（隔离服务）或缺省的 https://pinpoint.localhost。
 */
import fs from 'node:fs';

import { articleOutline } from '../../src/server/lib/article-canvas.js';
import { findProject } from '../../src/server/lib/projects.js';
import { articlePageId, refKey } from '../../src/shared/project-ids.js';

import { DEFAULT_ORIGIN, ioOf } from './core.js';
import { guardParse, reportUsageError, USAGE_EXIT } from './args.js';
import { resolveAddress, sectionNumberOf } from './address.js';
import { addressContext, printCandidates } from './targets.js';
import { canvasViewHref } from '../../src/shared/workbench-url.js';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 网址清单（纯计算 + 读正文）→ { urls: [{ kind, label, url }] } 或 { error, exit }。
 * hit 是 resolveAddress 的结果，ref 是第二个参数（可空）。
 */
export function openUrls(hit, ref, { registry, origin }) {
  const base = origin.replace(/\/+$/, '');
  const project = findProject(registry, hit.projectId);
  if (!project) return { error: `project ${hit.projectId} 读不出来`, exit: 1 };
  const conceptUrl = (concept) => `${base}/${project.id}/concepts/${encodeURIComponent(concept.slug)}/`;
  if (hit.kind === 'project') {
    if (ref) {
      const concept = project.concepts.find((row) => refKey(row.name) === refKey(ref) || row.slug === ref);
      if (!concept) return { error: `project ${project.id} 里没有概念“${ref}”（有：${project.concepts.map((row) => row.name).join('、') || '无'}）`, exit: 1 };
      return { urls: [{ kind: 'concept', label: `概念 ${concept.name}`, url: conceptUrl(concept) }] };
    }
    const urls = [
      { kind: 'project', label: `${project.id} 首页`, url: `${base}/${project.id}/` },
      { kind: 'llms', label: 'llms.txt', url: `${base}/${project.id}/llms.txt` },
    ];
    for (const article of project.articles) {
      urls.push({ kind: 'article', label: `${project.id}/${article.id} 文章页`, url: `${base}/${project.id}/${article.id}/` });
      if (article.canvasSections) urls.push({ kind: 'canvas', label: `${project.id}/${article.id} 画布视图`, url: `${base}${canvasViewHref(article.pageId)}` });
    }
    for (const concept of project.concepts) urls.push({ kind: 'concept', label: `概念 ${concept.name}`, url: conceptUrl(concept) });
    return { urls };
  }
  const article = project.articles.find((row) => row.id === hit.articleId);
  if (!article) return { error: `读不出文章 ${hit.address}（ppnt check ${project.id} 看布局错误）`, exit: 1 };
  const articleUrl = `${base}/${project.id}/${article.id}/`;
  const pageId = articlePageId(project.id, article.id);
  if (!ref) {
    const urls = [{ kind: 'article', label: `${hit.address} 文章页`, url: articleUrl }];
    if (article.canvasSections) urls.push({ kind: 'canvas', label: `${hit.address} 画布视图`, url: `${base}${canvasViewHref(pageId)}` });
    return { urls };
  }
  const outline = articleOutline(readText(article.file));
  const n = sectionNumberOf(ref);
  const section = n ? outline.find((row) => row.n === n) : outline.find((row) => row.id === ref || row.letter === ref);
  if (section && section.id) {
    const urls = [{ kind: 'section', label: `${section.letter}（§${section.n} ${section.id}）文章页`, url: `${articleUrl}#${section.id}` }];
    if (section.canvas && section.frames.length && article.canvasSections) {
      urls.push({ kind: 'canvas', label: `${section.letter}（§${section.n} ${section.id}）画布视图`, url: `${base}${canvasViewHref(pageId, section.id)}` });
    }
    return { urls };
  }
  if (n) return { error: `${ref}：这篇文章只有 ${outline.length} 节`, exit: 1 };
  const concept = project.concepts.find((row) => refKey(row.name) === refKey(ref) || row.slug === ref);
  if (concept) return { urls: [{ kind: 'concept', label: `概念 ${concept.name}`, url: conceptUrl(concept) }] };
  return { error: `${hit.address} 里没有节 ${ref}，project ${project.id} 里也没有叫它的概念（ppnt show ${hit.address} 看节）`, exit: 1 };
}

export async function runOpen(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const ctx = addressContext(parsed.flags, env);
  const hit = resolveAddress(parsed.target, ctx);
  if (!hit || hit.kind === 'missing-article') {
    err(`错误：找不到 ${parsed.target}：open 的目标是 <project> 或 <project>/<article>`);
    printCandidates(ctx, err, hit && hit.projectKnown ? { onlyProject: hit.projectId, heading: `${hit.projectId} 的文章` } : {});
    return USAGE_EXIT;
  }
  if (hit.kind === 'page') {
    return reportUsageError('open', `${parsed.target} 是存量页：它在工作台里打开，${(env.PINPOINT_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '')}${canvasViewHref(hit.pageId)}`, err);
  }
  const result = openUrls(hit, parsed.ref, { registry: ctx.registry, origin: env.PINPOINT_ORIGIN || DEFAULT_ORIGIN });
  if (result.error) {
    err(`错误：${result.error}`);
    return result.exit;
  }
  if (parsed.flags.json) out(JSON.stringify({ target: hit.address, urls: result.urls }, null, 2));
  else for (const row of result.urls) out(`${row.label}  ${row.url}`);
  if (parsed.flags.print || parsed.flags.json) return 0;
  if (!io.openUrl) {
    err('这里打不开浏览器；网址在上面（--print 只打印）');
    return 0;
  }
  try {
    await io.openUrl(result.urls[0].url);
  } catch (error) {
    err(`错误：打不开浏览器（${error.message}）；网址在上面`);
    return 1;
  }
  return 0;
}
