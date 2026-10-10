import fs from 'node:fs';
import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { countByStatus, loadPageContext } from '../../src/server/lib/ann-query.js';
import { distStatus, listPageIds, readDistScreen } from '../../src/server/lib/page-compiler.js';
import { loadRegistry, PAGE_ID_PATTERN } from '../../src/server/lib/registry.js';
import { collectBucketOrphans, readBucketLedgers } from '../../src/server/lib/orphans.js';
import { buildPageList, formatPageRow, matchPages, suggestPages } from '../../src/server/lib/page-list.js';
import { listRegistryGrouping } from '../../src/server/lib/registry-store.js';
import { screenOf } from '../../src/workbench/lib/board-refs.js';

import { REPO_ROOT, ioOf } from './core.js';
import { manifestPageIds, resolveRegistryPath, existingEntriesFor } from './registry.js';

/** 装配查询上下文（dist 读取器注入；找不到页时已报错，返回 null）。 */
export function loadAnnotateContext(pageRef, parsed, { env, err }) {
  if (!pageRef) return null;
  const registryPath = resolveRegistryPath(parsed.flags, env);
  const context = loadPageContext({ pageRef, registryPath, dataRootDir: dataRoot(env) });
  if (!context) {
    err(`错误：找不到页：${pageRef}`);
    if (!reportPageSuggestions(pageRef, { registryPath, env, err })) {
      const registry = loadRegistry({ root: REPO_ROOT, path: registryPath });
      err(`可用页 id：${listPageIds({ registry, root: REPO_ROOT }).join('、') || '（无）'}`);
    }
    return null;
  }
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

/** status --page <页>：各状态计数 + dist 是否过期 + 孤儿账本（只读，不依赖服务）。 */
export function printPageStatus(parsed, { env, out, err }) {
  // 找不到页的报错先攒着：整桶孤儿的页（删页后残留）有专门的报告，先打一行
  // 「错误：找不到页 + 可用页清单」全是噪音（K8）；真没桶再原样报错。
  const errors = [];
  const pageRef = parsed.flags.page;
  const context = loadAnnotateContext(pageRef, parsed, { env, err: (m) => errors.push(m) });
  if (!context) {
    // 页不在 registry 与 manifest 里，但桶还在：整桶皆孤儿（storage-unify）——
    // 报告而不是裸报错，不然删页后的残留账本没有入口可见。报告只给两处都不在
    // 的桶：页已知而加载失败的（url 条目等）原样报错，不把活页的账本吞成孤儿。
    if (!pageIdKnown(pageRef, parsed, { env }) && printBucketOrphanStatus(pageRef, { env, out })) return 0;
    for (const line of errors) err(line);
    return 1;
  }
  const counts = countByStatus([...context.frameRows, ...context.docRows]);
  out(`页 ${context.pageId}`);
  out(`  open ${counts.open} · check ${counts.check} · done ${counts.done} · close ${counts.close} · 共 ${counts.total}`);
  if (context.docOnly) {
    out('  这页不是编译页（registry 条目没有 board.json），没有 dist 与源码摘录');
  } else {
    const dist = distStatus(context.target.entryId, context.target.pageDir, { distRoot: path.join(dataRoot(env), 'dist') });
    out(`  dist ${dist.builtAt ? new Date(dist.builtAt).toISOString() : '未编译'}${dist.stale ? ' · 已过期（源码比产物新，跑 ppnt build）' : ' · 最新'}`);
  }
  const orphanCount = (context.orphanRows || []).length;
  if (orphanCount) out(`  孤儿 ${orphanCount} 条 · ${(context.orphanLedgers || []).join('、')}（表面已不存在，ppnt prune ${context.pageId} 清理）`);
  return 0;
}

/** 页消失后的整桶孤儿报告；桶也不在时返回 false（调用方走原报错）。 */
function printBucketOrphanStatus(pageRef, { env, out }) {
  if (!pageRef) return false;
  const names = collectBucketOrphans(String(pageRef), dataRoot(env));
  if (!names.length) return false;
  out(`页 ${pageRef} 不在 registry 与本地页面清单里；桶里 ${names.length} 本账本全是孤儿：`);
  for (const name of names) out(`  ${name}`);
  out(`清理：ppnt prune ${pageRef}（--dry-run 先看清单）`);
  return true;
}

/** 页 id 是否在 registry 或本地 manifest 里（整桶孤儿报告只给两处都不在的桶）。 */
function pageIdKnown(pageRef, parsed, { env }) {
  if (!pageRef || !PAGE_ID_PATTERN.test(String(pageRef))) return false;
  const registry = loadRegistry({ root: REPO_ROOT, path: resolveRegistryPath(parsed.flags, env) });
  if (registry.resolve(pageRef)) return true;
  return manifestPageIds(REPO_ROOT).includes(pageRef);
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
  const entries = existingEntriesFor(registryPath);
  const grouping = fs.existsSync(registryPath) ? listRegistryGrouping(registryPath) : { folders: [], pageFolders: {} };
  const bucketRoot = dataRoot(env);
  return buildPageList({
    entries,
    manifestPages: manifestPagesOf(root),
    folders: grouping.folders,
    pageFolders: grouping.pageFolders,
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
function listFrames(words, { registryPath, env, out, err }) {
  if (words.length !== 1) {
    err('错误：list --frames 需要且只要一个页 id：ppnt list <页> --frames');
    return 1;
  }
  const context = loadPageContext({ pageRef: words[0], registryPath, dataRootDir: dataRoot(env) });
  if (!context || !context.board) {
    err(`错误：${words[0]} 不是带 board.json 的编译页（list --frames 只列画布帧）`);
    if (!context) reportPageSuggestions(words[0], { registryPath, env, err });
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
  out(`# ${context.pageId} · 画布帧（编号随 board 顺序变；id 不变，留存文字里用 id）`);
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
  out(`共 ${multiTab ? `${tabs.length} 个 tab ` : ''}${rows.length} 段 ${frameCount} 帧`);
  return 0;
}

export async function runList(argv, io = {}) {
  const { cwd, env, out } = ioOf(io);
  const words = [];
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--registry') { flags.registry = argv[++i]; continue; }
    if (argv[i] === '--frames') { flags.frames = true; continue; }
    words.push(argv[i]);
  }
  const registryPath = resolveRegistryPath(flags, env, cwd);
  if (flags.frames) return listFrames(words, { registryPath, env, out, err: ioOf(io).err });
  const query = words.join(' ');
  const rows = matchPages(pageListRows({ registryPath, env }), query);
  if (!rows.length) {
    out(`没有匹配“${query}”的页。不带关键词跑 \`pinpoint list\` 看全部。`);
    return 1;
  }
  for (const row of rows) for (const line of formatPageRow(row)) out(line);
  out(`共 ${rows.length} 页${query ? `（匹配“${query}”）` : ''} · registry：${registryPath}`);
  return 0;
}
