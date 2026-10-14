import fs from 'node:fs';
import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { countByStatus, loadPageContext } from '../../src/server/lib/ann-query.js';
import { distStatus, listPageIds, readDistScreen, readTargetBoard } from '../../src/server/lib/page-compiler.js';
import { loadRegistry, PAGE_ID_PATTERN } from '../../src/server/lib/registry.js';
import { listProjects } from '../../src/server/lib/projects.js';
import { formatProjectError } from '../../src/shared/project-errors.js';
import { collectBucketOrphans, readBucketLedgers } from '../../src/server/lib/orphans.js';
import { pageIdIsLive } from '../../src/server/lib/page-resolve.js';
import { buildPageList, formatPageRow, matchPages, scorePage, suggestPages } from '../../src/server/lib/page-list.js';
import { screenOf } from '../../src/workbench/lib/board-refs.js';

import { REPO_ROOT, ioOf } from './core.js';
import { displayAddress, parseAddress, resolveAddress, toPageRef } from './address.js';
import { HELP, reportUsageError } from './args.js';
import { addressContext, printCandidates } from './targets.js';
import { manifestPageIds, resolveRegistryPath, existingEntriesFor } from './registry.js';

/** 装配查询上下文（dist 读取器注入；找不到页时已报错，返回 null）。 */
export function loadAnnotateContext(token, parsed, { env, err }) {
  if (!token) return null;
  // 斜杠形、文章网址都换成页 id（只看字面：删掉的文章也能这样写，报孤儿用）。
  const pageRef = String(toPageRef(token));
  const registryPath = resolveRegistryPath(parsed.flags, env);
  const context = loadPageContext({ pageRef, registryPath, dataRootDir: dataRoot(env) });
  if (!context) {
    reportMissingTarget(token, { registryPath, env, err });
    return null;
  }
  context.address = displayAddress(context.pageId);
  const distRoot = path.join(dataRoot(env), 'dist');
  context.distHtmlFor = (screenId) => {
    const read = readDistScreen(context.target.entryId, screenId, { distRoot });
    return read.kind === 'ok' ? read.html : null;
  };
  context.readFile = (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
  return context;
}

/**
 * 找不到目标时的报错：文章地址说清是 project 没登记还是文章不在，并列出那个 project 的文章；
 * 其余按口头说法给最接近的页，再不行列全部候选。
 */
export function reportMissingTarget(token, { registryPath, env, err }) {
  const parsedAddress = parseAddress(token);
  const ctx = addressContext({ registry: registryPath }, env);
  if (parsedAddress && parsedAddress.kind === 'article') {
    const address = `${parsedAddress.project}/${parsedAddress.article}`;
    const hit = resolveAddress(address, ctx);
    if (hit && hit.kind === 'missing-article' && hit.projectKnown) {
      err(`错误：找不到文章 ${address}：project ${parsedAddress.project} 里没有 articles/${parsedAddress.article}/index.mdx`);
      printCandidates(ctx, err, { onlyProject: parsedAddress.project, heading: `${parsedAddress.project} 的文章` });
    } else {
      err(`错误：找不到文章 ${address}：project ${parsedAddress.project} 没登记（ppnt add <project 根> --project）`);
      printCandidates(ctx, err);
    }
    return;
  }
  const pageRef = String(toPageRef(token));
  err(`错误：找不到 ${pageRef}`);
  if (!reportPageSuggestions(pageRef, { registryPath, env, err })) printCandidates(ctx, err);
}

/** status --page <页>：各状态计数 + dist 是否过期 + 孤儿账本（只读，不依赖服务）。 */
export function printPageStatus(parsed, { env, out, err }) {
  // 找不到页的报错先攒着：整桶孤儿的页（删页后残留）有专门的报告，先打一行
  // 「错误：找不到页 + 可用页清单」全是噪音（K8）；真没桶再原样报错。
  const errors = [];
  const pageRef = String(toPageRef(parsed.flags.page));
  const context = loadAnnotateContext(pageRef, parsed, { env, err: (m) => errors.push(m) });
  if (!context) {
    // 页不在 registry 与 manifest 里，但桶还在：整桶皆孤儿（storage-unify）——
    // 报告而不是裸报错，不然删页后的残留账本没有入口可见。报告只给两处都不在
    // 的桶：页已知而加载失败的原样报错，不把活页的账本吞成孤儿。
    if (!pageIdKnown(pageRef, parsed, { env }) && printBucketOrphanStatus(pageRef, { env, out })) return 0;
    for (const line of errors) err(line);
    return 1;
  }
  const counts = countByStatus([...context.frameRows, ...context.docRows]);
  out(`${context.address === context.pageId ? '页' : '文章'} ${context.address}`);
  out(`  open ${counts.open} · check ${counts.check} · done ${counts.done} · close ${counts.close} · 共 ${counts.total}`);
  if (context.docOnly) {
    out('  这页不是编译页（registry 条目没有 board.json），没有 dist 与源码摘录');
  } else {
    const dist = distStatus(context.target.entryId, context.target.pageDir, {
      distRoot: path.join(dataRoot(env), 'dist'),
      // 文章画布：板是现派生的，比对 dist 里那份，不看 index.mdx 的 mtime。
      ...(context.target.kind === 'article' ? { board: readTargetBoard(context.target) } : {}),
    });
    out(`  dist ${dist.builtAt ? new Date(dist.builtAt).toISOString() : '未编译'}${dist.stale ? ' · 已过期（源码比产物新，跑 ppnt build）' : ' · 最新'}`);
  }
  const orphanCount = (context.orphanRows || []).length;
  if (orphanCount) out(`  孤儿 ${orphanCount} 条 · ${(context.orphanLedgers || []).join('、')}（表面已不存在，ppnt prune ${context.address} 清理）`);
  return 0;
}

/** 页消失后的整桶孤儿报告；桶也不在时返回 false（调用方走原报错）。 */
export function printBucketOrphanStatus(pageRef, { env, out }) {
  if (!pageRef) return false;
  const names = collectBucketOrphans(String(pageRef), dataRoot(env));
  if (!names.length) return false;
  const shown = displayAddress(pageRef);
  out(`${shown} 不在 registry 与本地页面清单里（文章删了、改名了，或页不在了）；桶里 ${names.length} 本账本全是孤儿：`);
  for (const name of names) out(`  ${name}`);
  out(`清理：ppnt prune ${shown}（--dry-run 先看清单）`);
  return true;
}

/** 页 id 现在是不是一页（registry 条目、模板页、文章画布页；整桶孤儿报告只给不是页的桶）。 */
export function pageIdKnown(pageRef, parsed, { env }) {
  if (!pageRef || !PAGE_ID_PATTERN.test(String(pageRef))) return false;
  const registry = loadRegistry({ root: REPO_ROOT, path: resolveRegistryPath(parsed.flags, env) });
  return pageIdIsLive(registry, pageRef, { manifestIds: manifestPageIds(REPO_ROOT) });
}

/** 命令分发。bin/pinpoint.mjs 只做进程原语与这一次调用。 */
/* ---- list：页清单与“找不到页”的候选 ---- */

function statusCountsOf(bucketPath) {
  const counts = { open: 0, check: 0, done: 0, close: 0 };
  for (const { doc } of readBucketLedgers(bucketPath)) {
    for (const row of (doc && Array.isArray(doc.annotations) ? doc.annotations : [])) {
      const st = row && row.status;
      if (st && Object.prototype.hasOwnProperty.call(counts, st)) counts[st] += 1;
      else counts.open += 1;
    }
  }
  return counts;
}

function manifestPagesOf(root) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'content', 'previews', '_index.json'), 'utf8'));
    return Array.isArray(doc && doc.pages) ? doc.pages : [];
  } catch {
    return [];
  }
}

/** 页清单（registry + 本地模板页），list 与“找不到页”的候选共用。 */
export function pageListRows({ registryPath, env = process.env, root = REPO_ROOT } = {}) {
  // project 条目（pp3）不是页：单独列在 projectListRows。
  const entries = existingEntriesFor(registryPath).filter((entry) => entry && entry.kind !== 'project');
  const bucketRoot = dataRoot(env);
  return buildPageList({
    entries,
    manifestPages: manifestPagesOf(root),
    hasBoard: (entry) => typeof entry.path === 'string' && fs.existsSync(path.join(path.resolve(entry.path), 'board.json')),
    countsFor: (id) => statusCountsOf(path.join(bucketRoot, id)),
  });
}

/** “找不到页”报错的候选行；清单读不出时退回 null（调用方沿用 id 清单）。 */
export function reportPageSuggestions(pageRef, { registryPath, env, err }) {
  let rows;
  try { rows = pageListRows({ registryPath, env }); } catch { return false; }
  const picks = suggestPages(rows, pageRef);
  if (!picks.length) return false;
  err('最接近的页（`pinpoint list <关键词>` 看全部）：');
  for (const row of picks) err(`  ${row.id}  ·  ${row.title || '（无标题）'}`);
  return true;
}

/** 帧的源文件：页目录里的 <id>.jsx / <id>.html（page-compiler 同一查找序），否则 board 的 src。 */
function frameSourceOf(pageDir, screen) {
  for (const ext of ['.jsx', '.html']) {
    const file = pageDir ? path.join(pageDir, `${screen.id}${ext}`) : '';
    if (file && fs.existsSync(file)) return file;
  }
  return screen.src ? String(screen.src) : '（无源文件）';
}

/**
 * `list <页> --frames`：显示编号 ↔ 不变 id ↔ 源文件的对照。编号（B3）按 board
 * 顺序派生、调序就变；id 是帧的身份，也是源文件名。编号与 check / shot 同一份
 * boardRefs，doc 帧不上画布、不占编号。
 */
export function listFrames(words, { registryPath, env, out, err }) {
  if (words.length !== 1) {
    err('错误：list --frames 需要且只要一个目标：ppnt list <目标> --frames');
    return 2;
  }
  const pageRef = String(toPageRef(words[0]));
  const context = loadPageContext({ pageRef, registryPath, dataRootDir: dataRoot(env) });
  if (!context || !context.board) {
    err(`错误：${words[0]} 没有画布帧（list --frames 只列画布帧）`);
    if (!context) reportPageSuggestions(pageRef, { registryPath, env, err });
    return 1;
  }
  const rawScreens = new Map();
  for (const section of context.board.sections || []) {
    for (const entry of section.screens || []) {
      const screen = screenOf(entry);
      if (!rawScreens.has(screen.id)) rawScreens.set(screen.id, screen);
    }
  }
  const pageDir = context.target && context.target.pageDir;
  const rows = context.refs.outline.map((section) => ({
    section,
    frames: section.frames.map((frame) => {
      const source = frameSourceOf(pageDir, rawScreens.get(frame.id) || { id: frame.id });
      return { ...frame, source: pageDir && source.startsWith(pageDir + path.sep) ? path.relative(pageDir, source) : source };
    }),
  }));
  // 多 tab 页（ADR 0041）：按 tab 分组，位置号带 tab 前缀（`flow:B3`，可直接贴给 check / mark / shot）；
  // 单 tab / 存量页与从前逐字相同。
  const tabs = context.refs.tabs || [];
  const multiTab = tabs.length >= 2;
  const shownRef = (frame) => (multiTab && frame.tabId ? `${frame.tabId}:${frame.ref}` : frame.ref);
  const refWidth = Math.max(2, ...rows.flatMap((row) => row.frames.map((frame) => shownRef(frame).length)));
  const idWidth = Math.max(2, ...rows.flatMap((row) => row.frames.map((frame) => frame.id.length)));
  const sourceWidth = Math.max(2, ...rows.flatMap((row) => row.frames.map((frame) => frame.source.length)));
  out(`# ${displayAddress(context.pageId)} · 画布帧（编号随画布顺序变；id 不变，留存文字里用 id）`);
  if (pageDir) out(`页目录：${pageDir}`);
  if (multiTab) out(`tab：${tabs.map((tab) => tab.id).join('、')}（编号按 tab 各自从 A 起，写 <tab>:B3）`);
  let lastTab = null;
  for (const row of rows) {
    out('');
    if (multiTab && row.section.tabId !== lastTab) {
      lastTab = row.section.tabId;
      const tab = tabs.find((entry) => entry.id === lastTab);
      out(`tab  ${lastTab}  ${tab && tab.title !== lastTab ? tab.title : ''}`.trimEnd());
      out('');
    }
    out(`${row.section.letter}  ${row.section.id}  ${row.section.title}`);
    for (const frame of row.frames) {
      out(`  ${shownRef(frame).padEnd(refWidth)}  ${frame.id.padEnd(idWidth)}  ${frame.source.padEnd(sourceWidth)}  ${frame.title}`);
    }
  }
  const frameCount = rows.reduce((sum, row) => sum + row.frames.length, 0);
  out('');
  out(`共 ${multiTab ? `${tabs.length} 个 tab ` : ''}${rows.length} 节 ${frameCount} 帧`);
  return 0;
}

/* ---- list：project（pp3） ---- */

/** 登记表里的 project，读盘后（文章、概念、布局错误）。 */
export function projectListRows({ registryPath } = {}) {
  // 读盘（list 不依赖服务），与服务同一个 loadRegistry + listProjects。
  return listProjects(loadRegistry({ root: REPO_ROOT, path: registryPath, log: () => {} }));
}

/** 关键词匹配用的投影：文章 id / 标题也能对上 project。 */
function projectMatchRow(project) {
  return {
    id: project.id,
    title: project.title,
    path: project.root,
    aliases: project.articles.flatMap((article) => [article.id, article.title]),
  };
}

function countLabel(project) {
  const bits = [`${project.articles.length} 篇文章`, `${project.concepts.length} 个概念`];
  if (project.errors.length) bits.push(`${project.errors.length} 个布局错误`);
  return bits.join(' · ');
}

/** 总表里的一个 project：首行 project · 计数，次行根目录，下面每篇文章缩进一行。 */
export function formatProjectRow(project) {
  const lines = [[project.id, project.title, 'project', countLabel(project)].filter(Boolean).join('  ·  ')];
  lines.push(`    ${project.root}`);
  for (const article of project.articles) lines.push(`    ${project.id}/${article.id}  ·  ${article.title}`);
  return lines;
}

/** `list <project>`：文章、概念与布局错误全列出来。 */
export function formatProjectDetail(project) {
  const lines = [`# ${project.id} · ${project.title}`, `根目录：${project.root}`, `内容：${project.dir}`, ''];
  lines.push(`文章（${project.articles.length}）`);
  if (!project.articles.length) lines.push('  （无）');
  for (const article of project.articles) {
    lines.push(`  ${article.id}  ·  ${article.title}${article.summary ? `  ·  ${article.summary}` : ''}`);
    lines.push(`    ${article.file}`);
    // 页 id：/?page= 和标注桶用它；CLI 输出打斜杠形。
    if (article.pageId) lines.push(`    画布 ${article.pageId}`);
  }
  lines.push('', `概念（${project.concepts.length}）`);
  if (!project.concepts.length) lines.push('  （无）');
  for (const concept of project.concepts) {
    const bits = [concept.name, concept.status, concept.boundary].filter(Boolean);
    lines.push(`  ${bits.join('  ·  ')}`);
    lines.push(`    ${concept.file}`);
  }
  lines.push('', project.errors.length ? `布局错误（${project.errors.length}）` : '布局错误：无');
  for (const problem of project.errors) lines.push(`  ✗ ${formatProjectError(problem)}`);
  return lines;
}

export async function runList(argv, io = {}) {
  const { cwd, env, out, err } = ioOf(io);
  const words = [];
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      out(HELP.list.text);
      return 0;
    }
    if (arg === '--registry' || arg.startsWith('--registry=')) {
      flags.registry = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i];
      if (!flags.registry) return reportUsageError('list', '选项 --registry 缺少值', err);
      continue;
    }
    if (arg === '--frames') { flags.frames = true; continue; }
    if (arg === '--json') { flags.json = true; continue; }
    // 未知选项是用法错，不当关键词去匹配（从前 list --json 会去找叫 --json 的页）。
    if (arg.startsWith('--')) return reportUsageError('list', `未知选项：${arg}`, err);
    words.push(arg);
  }
  const registryPath = resolveRegistryPath(flags, env, cwd);
  if (flags.frames) return listFrames(words, { registryPath, env, out, err });
  const query = words.join(' ');
  const projects = projectListRows({ registryPath });
  // 恰好是一个 project 的 id：同 show <project>。
  const exact = words.length === 1 ? projects.find((project) => project.id === words[0]) : null;
  if (exact) {
    const { showTarget } = await import('./show.js');
    return showTarget(exact.id, { flags }, { env, out, err });
  }
  const rows = matchPages(pageListRows({ registryPath, env }), query);
  const projectRows = projects.filter((project) => scorePage(projectMatchRow(project), query) > 0);
  if (flags.json) {
    out(JSON.stringify({
      query,
      registry: registryPath,
      projects: projectRows.map((project) => ({
        id: project.id,
        title: project.title,
        root: project.root,
        articles: project.articles.map((article) => ({ address: `${project.id}/${article.id}`, title: article.title })),
        errors: project.errors.length,
      })),
      pages: rows.map((row) => ({ id: row.id, title: row.title || '', kind: row.kind || '', path: row.path || '', counts: row.counts || null })),
    }, null, 2));
    return rows.length || projectRows.length ? 0 : 1;
  }
  if (!rows.length && !projectRows.length) {
    out(`没有匹配“${query}”的页。不带关键词跑 \`pinpoint list\` 看全部。`);
    return 1;
  }
  for (const row of rows) for (const line of formatPageRow(row)) out(line);
  if (projectRows.length) {
    if (rows.length) out('');
    for (const project of projectRows) for (const line of formatProjectRow(project)) out(line);
  }
  const tail = projectRows.length ? ` · ${projectRows.length} 个 project` : '';
  out(`共 ${rows.length} 页${tail}${query ? `（匹配“${query}”）` : ''} · registry：${registryPath}`);
  return 0;
}
