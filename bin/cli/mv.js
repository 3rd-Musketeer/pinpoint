/**
 * `ppnt mv <源> <目标> [--dry-run]`（ADR 0045）：像 Unix mv，按目标的写法决定做什么。
 *
 *   <project>/<a> <project2>/<b>   文章换 project 和 / 或改 id：目录搬过去，标注桶 <p>_<a> → <p2>_<b>，
 *                                  账本里的 pageId / path 改写，缓存跟着搬或删。<project2>/ 保留文章 id。
 *   <id> <新 id>                   project 或存量页改 id（registry.js 的 renameEntry）。
 *   <id> <路径>                    目标以 /、.、~ 开头（或是网址）：换根目录 / 落点，id 不变（registry.js 的 moveEntry）。
 *
 * 文章搬家的预检（任何一条不过就一个字节不动）：源文章在、目标 project 登记了、目标目录不在、目标桶里没有
 * 标注行、目标页 id 不撞模板页；换 project 时文章的 HTML 帧（{ id, src }）在新 project 里都找得到。
 * 别的文章里指向它的 [[ ]] 不改，逐条列成注意。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { articleOutline, resolveRootFrame } from '../../src/server/lib/article-canvas.js';
import { listProjects, findProject } from '../../src/server/lib/projects.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { articlePageId, refKey, RESERVED_ARTICLE_IDS } from '../../src/shared/project-ids.js';
import { parseRefBody, refsWithLines } from '../../src/shared/refs.js';
import { ENTRY_ID_PATTERN } from '../../src/shared/registry-ids.js';

import { CliError, REPO_ROOT, ioOf } from './core.js';
import { guardParse, reportUsageError, USAGE_EXIT } from './args.js';
import { parseAddress } from './address.js';
import { htmlPathnames, planMovedBucket } from './bucket-move.js';
import {
  ARTICLE_SOURCE_EXTS,
  manifestPageIds,
  moveEntry,
  PAGE_CACHE_DROP,
  PAGE_CACHE_MOVE,
  renameEntry,
  resolveRegistryPath,
  rewriteMovedBucket,
  rewriteSitePrefixUnder,
} from './registry.js';

/** 目标是不是磁盘路径：以 /、.、~ 开头。网址也走换路径那条，由它报“登记的目标是本地目录或 .html 文件”。 */
export function looksLikePath(token) {
  return /^[/.~]/.test(token) || /^https?:\/\//i.test(token);
}

function expandHome(token) {
  if (token === '~') return os.homedir();
  if (token.startsWith('~/')) return path.join(os.homedir(), token.slice(2));
  return token;
}

const PROJECT_SLASH_RE = /^([a-z0-9][a-z0-9-]*)\/$/;

/**
 * 按源和目标的写法分派（纯函数，不读盘）→
 *   { kind: 'article', from: { project, article }, to: { project, article } }
 *   { kind: 'id', id, newId } | { kind: 'path', id, target } | { error }
 */
export function classifyMv(source, target) {
  const src = parseAddress(source);
  const dst = String(target || '');
  if (src && src.kind === 'article' && !src.n) {
    const from = { project: src.project, article: src.article };
    if (looksLikePath(dst)) return { error: `文章不能挪到磁盘路径：${dst}；换 project 或改 id 写 <project>/<article>（文章目录跟着 project 走）` };
    const keep = dst.match(PROJECT_SLASH_RE);
    if (keep) return { kind: 'article', from, to: { project: keep[1], article: from.article } };
    const to = parseAddress(dst);
    if (to && to.kind === 'article' && !to.n) return { kind: 'article', from, to: { project: to.project, article: to.article } };
    return { error: `源是文章，目标写 <project>/<article>（或 <project>/ 保留文章 id），收到：${dst}` };
  }
  if (!ENTRY_ID_PATTERN.test(String(source || ''))) {
    return { error: `源写 <project>/<article>、project id 或存量页 id，收到：${source}` };
  }
  if (looksLikePath(dst)) return { kind: 'path', id: source, target: dst };
  if (dst.includes('/')) return { error: `目标 ${dst} 像一个路径：换根目录写 ./${dst} 或绝对路径；<project>/<article> 只用于搬文章` };
  return { kind: 'id', id: source, newId: dst };
}

const fail = (message, exit = 1) => Object.assign(new CliError(message), { exit });

/** 文章里 { id, src } 写法的 HTML 帧，在新 project 里找不到的那些：[{ frame, src, reason }]。 */
function framesMissingIn(text, fromProject, toProject) {
  const missing = [];
  for (const section of articleOutline(text)) {
    for (const [frame, src] of Object.entries(section.sources || {})) {
      const before = resolveRootFrame(fromProject.root, src, fromProject.sources);
      if (!before.file) continue; // 在原 project 里就是坏的，搬不搬都一样
      const after = resolveRootFrame(toProject.root, src, toProject.sources);
      if (!after.file) missing.push({ frame, src, reason: after.error });
    }
  }
  return missing;
}

/** 所有登记 project 的正文和 wiki 词条里指向这篇文章的 [[ ]]：[{ file, line, raw }]。不含这篇自己。 */
function inboundRefs(projects, from, skipDir) {
  const ids = new Set(projects.map((project) => project.id));
  const hits = [];
  for (const project of projects) {
    const files = [...project.articles.map((article) => article.file), ...project.concepts.map((entry) => entry.file)];
    for (const file of files) {
      if (file.startsWith(skipDir + path.sep)) continue;
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      for (const ref of refsWithLines(text)) {
        const { target } = parseRefBody(ref.raw);
        const colon = target.indexOf(':');
        const prefixed = colon > 0 && ids.has(target.slice(0, colon));
        const projectId = prefixed ? target.slice(0, colon) : project.id;
        const name = prefixed ? target.slice(colon + 1) : target;
        if (projectId === from.project && refKey(name) === refKey(from.article)) hits.push({ file, line: ref.line, raw: ref.raw });
      }
    }
  }
  return hits;
}

/** 只有完整读过的空账本才允许替换；展示队列的宽容读取不能用来决定删桶。 */
function checkedTargetRowCount(bucket) {
  if (!fs.existsSync(bucket)) return 0;
  try {
    let rows = 0;
    for (const item of fs.readdirSync(bucket, { withFileTypes: true })) {
      if (!item.isFile() || !item.name.endsWith('.json')) throw new Error(`未知文件 ${item.name}`);
      const doc = JSON.parse(fs.readFileSync(path.join(bucket, item.name), 'utf8'));
      if (item.name === '_seq.json') {
        if (!doc || !Number.isSafeInteger(doc.next) || doc.next < 1) throw new Error(`序号文件异常 ${item.name}`);
      } else {
        if (!doc || !Array.isArray(doc.annotations)) throw new Error(`账本形状异常 ${item.name}`);
        rows += doc.annotations.length;
      }
    }
    return rows;
  } catch (error) {
    throw fail(`无法确认标注桶 ${bucket} 为空，未搬迁：${error.message}`);
  }
}

/** 文章搬家的预检（只读盘）。不过关抛 CliError（带 exit：2 = 找不到 / 写错，1 = 目标被占、帧会坏）。 */
export function planArticleMove({ from, to }, { registry, root, manifestIds = [] }) {
  const fromProject = findProject(registry, from.project);
  if (!fromProject) throw fail(`project ${from.project} 没登记（ppnt list 看有哪些）`, USAGE_EXIT);
  const fromDir = path.join(fromProject.dir, 'articles', from.article);
  const fromFile = path.join(fromDir, 'index.mdx');
  if (!fs.existsSync(fromFile)) {
    const have = fromProject.articles.map((article) => `${fromProject.id}/${article.id}`).join('、') || '无';
    throw fail(`project ${from.project} 里没有 articles/${from.article}/index.mdx（有：${have}）`, USAGE_EXIT);
  }
  const toProject = findProject(registry, to.project);
  if (!toProject) throw fail(`目标 project ${to.project} 没登记：先 ppnt new project <目录> --id ${to.project}`, USAGE_EXIT);
  if (!ENTRY_ID_PATTERN.test(to.article)) throw fail(`文章 id 要匹配 ${ENTRY_ID_PATTERN}：${to.article}`, USAGE_EXIT);
  if (RESERVED_ARTICLE_IDS.has(to.article)) throw fail(`文章 id "${to.article}" 是保留名（/<project>/${to.article}/ 是 wiki 词条页的地址）`, USAGE_EXIT);
  if (from.project === to.project && from.article === to.article) throw fail(`源和目标是同一篇：${from.project}/${from.article}`, USAGE_EXIT);

  const toDir = path.join(toProject.dir, 'articles', to.article);
  if (fs.existsSync(toDir)) throw fail(`目标 ${toDir} 已经在，不覆盖；换一个文章 id`);
  const fromId = articlePageId(from.project, from.article);
  const toId = articlePageId(to.project, to.article);
  if (manifestIds.includes(toId)) throw fail(`页 id ${toId} 和模板页撞名；换一个文章 id`);
  const bucketFrom = path.join(root, fromId);
  const bucketTo = path.join(root, toId);
  const rowsTo = checkedTargetRowCount(bucketTo);
  if (rowsTo > 0) {
    throw fail(`标注桶 ${bucketTo} 里已有 ${rowsTo} 行标注（别的文章留下的），搬过去会挂到这篇上；换一个文章 id，或先 \`ppnt prune ${toId}\``);
  }
  if (from.project !== to.project) {
    const missing = framesMissingIn(fs.readFileSync(fromFile, 'utf8'), fromProject, toProject);
    if (missing.length) {
      const lines = missing.map((row) => `  帧 ${row.frame}（src "${row.src}"）：${row.reason}`);
      throw fail(`这篇的 HTML 帧在 project ${to.project} 里找不到，搬过去就是坏帧：\n${lines.join('\n')}\n先在 ${path.join(toProject.dir, 'project.json')} 的 sources 里登记同名目录、或把文件放到 ${toProject.root} 下同样的位置，再搬`);
    }
  }
  const bucketMove = {
    fromId, toId, fromProject: from.project, toProject: to.project,
    fromArticle: from.article, toArticle: to.article,
    htmlPathnames: htmlPathnames(from.project, from.article, registry),
  };
  planMovedBucket(bucketFrom, bucketMove);
  return {
    bucketMove,
    from,
    to,
    fromProject,
    toProject,
    fromDir,
    toDir,
    fromId,
    toId,
    root,
    bucketFrom,
    bucketTo,
    bucketExists: fs.existsSync(bucketFrom),
    bucketToExists: fs.existsSync(bucketTo),
    sitePrefixFiles: rewriteSitePrefixUnder(fromDir, fromId, toId, { dryRun: true, exts: ARTICLE_SOURCE_EXTS }),
    refs: inboundRefs(listProjects(registry), from, fromDir),
  };
}

function moveDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    // 临时副本与目标同卷，复制完整后才发布正式目录。
    const staging = fs.mkdtempSync(path.join(path.dirname(to), '.ppnt-mv-'));
    try {
      const copy = path.join(staging, 'article');
      fs.cpSync(from, copy, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      if (fs.existsSync(to)) throw new Error(`目标在复制期间出现：${to}`);
      fs.renameSync(copy, to);
      fs.rmSync(from, { recursive: true, force: true });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

function printRefs(plan, err) {
  if (!plan.refs.length) return;
  err(`注意：这些地方还用 [[${plan.from.article}]] 指旧地址，mv 不改正文，请改成 ${plan.from.project === plan.to.project ? `[[${plan.to.article}]]` : `[[${plan.to.project}:${plan.to.article}]]`}：`);
  for (const ref of plan.refs) err(`  ${ref.file}:${ref.line}  [[${ref.raw}]]`);
}

async function moveArticle(classified, parsed, io) {
  const { cwd, env, out, err } = io;
  const registryPath = resolveRegistryPath(parsed.flags, env, cwd);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath });
  let plan;
  try {
    plan = planArticleMove(classified, { registry, root: dataRoot(env), manifestIds: manifestPageIds() });
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    err(`错误：${error.message}`);
    return error.exit || 1;
  }
  const head = `${plan.from.project}/${plan.from.article} → ${plan.to.project}/${plan.to.article}`;
  if (parsed.flags['dry-run']) {
    out(`计划：${head}`);
    out(`  目录：${plan.fromDir} → ${plan.toDir}`);
    out(plan.bucketExists ? `  标注桶：${plan.bucketFrom} → ${plan.bucketTo}（账本里的 pageId 与 path 改写）` : `  标注桶：${plan.bucketFrom} 不存在，没有标注要搬`);
    for (const dir of [...PAGE_CACHE_MOVE, ...PAGE_CACHE_DROP]) {
      if (!fs.existsSync(path.join(plan.root, dir, plan.fromId))) continue;
      out(PAGE_CACHE_MOVE.includes(dir) ? `  ${dir}/${plan.fromId} → ${dir}/${plan.toId}` : `  ${dir}/${plan.fromId} 删掉（写死了旧的 /sites/ 地址）`);
    }
    for (const file of plan.sitePrefixFiles) out(`  /sites/${plan.fromId}/ 换成 /sites/${plan.toId}/：${file}`);
    printRefs(plan, err);
    out('--dry-run：什么都没写，去掉 --dry-run 再跑。');
    return 0;
  }

  try {
    moveDir(plan.fromDir, plan.toDir);
  } catch (error) {
    err(`错误：搬目录失败：${error.message}；源目录 ${plan.fromDir}（${fs.existsSync(plan.fromDir) ? '存在，删除中断时可能不完整' : '不存在'}），目标目录 ${plan.toDir}（${fs.existsSync(plan.toDir) ? '存在' : '不存在'}）；标注桶尚未搬迁`);
    return 1;
  }
  out(`已搬 ${head}`);
  out(`  目录：${plan.fromDir} → ${plan.toDir}`);
  const rewritten = rewriteSitePrefixUnder(plan.toDir, plan.fromId, plan.toId, { exts: ARTICLE_SOURCE_EXTS });
  for (const file of rewritten) out(`  /sites/${plan.fromId}/ 换成 /sites/${plan.toId}/：${file}`);

  if (plan.bucketExists) {
    try {
      // 目标桶在、但没有标注行（预检过）：只剩空账本或 _seq.json，先删掉再改名。
      if (fs.existsSync(plan.bucketTo)) fs.rmSync(plan.bucketTo, { recursive: true, force: true });
      fs.renameSync(plan.bucketFrom, plan.bucketTo);
    } catch (error) {
      err(`  标注桶改名失败（目录已搬，标注还在 ${plan.bucketFrom}）：${error.message}`);
      return 1;
    }
    let ledgers = [];
    try {
      ledgers = rewriteMovedBucket(plan.bucketTo, plan.bucketMove);
    } catch (error) {
      err(`  标注桶已搬，但账本里的旧地址没改完：${error.message}`);
    }
    out(`  标注桶：${plan.bucketFrom} → ${plan.bucketTo}${ledgers.length ? `（账本改写：${ledgers.join('、')}）` : ''}`);
  } else {
    out(`  标注桶：${plan.bucketFrom} 不存在，没有标注要搬`);
  }

  // 缓存都能再生：搬不动、删不掉只警告。
  for (const dir of PAGE_CACHE_MOVE) {
    const from = path.join(plan.root, dir, plan.fromId);
    if (!fs.existsSync(from)) continue;
    const to = path.join(plan.root, dir, plan.toId);
    try {
      fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(from, to);
      out(`  ${dir}/${plan.fromId} → ${dir}/${plan.toId}`);
    } catch (error) {
      err(`  注意：缓存 ${dir}/${plan.fromId} 没搬（${from}），可以删掉：${error.message}`);
    }
  }
  const hadDist = fs.existsSync(path.join(plan.root, 'dist', plan.fromId));
  for (const dir of PAGE_CACHE_DROP) {
    const stale = path.join(plan.root, dir, plan.fromId);
    if (!fs.existsSync(stale)) continue;
    try {
      fs.rmSync(stale, { recursive: true, force: true });
      out(`  ${dir}/${plan.fromId} 已删（产物写死了旧的 /sites/ 地址）`);
    } catch (error) {
      err(`  注意：缓存 ${dir}/${plan.fromId} 没删掉（${stale}），可以手动删：${error.message}`);
    }
  }
  if (hadDist) {
    // 和 `ppnt build <页>` 同一个编译器：旧 dist 删了，按新页 id 重编一次。
    const { compilePage, resolvePageTarget } = await import('../../src/server/lib/page-compiler.js');
    const target = resolvePageTarget(plan.toId, { registry: loadRegistry({ root: REPO_ROOT, path: registryPath }), root: REPO_ROOT });
    try {
      const result = target ? await compilePage(target, { distRoot: path.join(plan.root, 'dist') }) : null;
      out(result ? `  画布 ${plan.to.project}/${plan.to.article}：已重编${result.ok ? '' : `（有失败，跑 \`ppnt build ${plan.to.project}/${plan.to.article}\` 看详情）`}` : `  画布 ${plan.to.project}/${plan.to.article}：没有编译目标，不重编`);
    } catch (error) {
      err(`  画布重编失败：${error.message}；跑 \`ppnt build ${plan.to.project}/${plan.to.article}\``);
    }
  }
  printRefs(plan, err);
  out(`文章页：${(env.PINPOINT_ORIGIN || 'https://pinpoint.localhost').replace(/\/+$/, '')}/${plan.to.project}/${plan.to.article}/`);
  return 0;
}

export async function runMv(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const ctx = ioOf(io);
  const classified = classifyMv(parsed.source, parsed.target);
  if (classified.error) return reportUsageError('mv', classified.error, ctx.err);
  if (classified.kind === 'article') return moveArticle(classified, parsed, ctx);
  if (classified.kind === 'path') {
    return moveEntry({ id: classified.id, target: expandHome(classified.target), flags: parsed.flags }, ctx);
  }
  return renameEntry({ id: classified.id, newId: classified.newId, flags: parsed.flags }, ctx);
}
