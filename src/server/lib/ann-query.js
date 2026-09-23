/**
 * ppnt check / locate / status / prune 的查询层（2026-09-22 切片 4；
 * storage-unify 起读模型换成桶 = 页）。
 *
 * 数据从哪来（读侧，无副作用）：
 * - 帧标注：本页桶里的 @canvas 账本（画布与 mention frame 共用这一本），
 *   行带 pageId / screenId；
 * - 文档标注：同一桶里按路径分的其余账本（/sites/<id>/ 与 /previews/ 直开页）；
 * - 孤儿账本：表面已不存在的账本（lib/orphans.js 判定），check / status 单独
 *   列出、不计入计数，清理只经 prune；
 * - 帧 HTML：dist（readDistScreen，不触发编译 —— check 只读，未编译的帧在
 *   摘录处降级为提示，不去写 dist）。
 *
 * 纯函数部分（模型与 markdown / json 格式化）注入 fs 读取器（distHtmlFor /
 * readFile），node --test 直测；采集层薄薄一层读文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dataRoot } from './annotate-data-dir.js';
import { CANVAS_LEDGER } from './annotation-store.js';
import { collectPageOrphans, readBucketLedgers } from './orphans.js';
import { manifestPageIds } from './page-manifest.js';
import { resolvePageTarget } from './page-compiler.js';
import { loadRegistry } from './registry.js';
import { normalizeAnnotation, targetContentToDisplay } from '../../shared/annotation-indicator.js';
import { boardRefs } from '../../workbench/lib/board-refs.js';
import { frameInternalSelector } from '../../shared/frame-anchor.js';
import {
  ancestorsOf,
  foldHtmlElement,
  foldRange,
  jsxElementRange,
  parseHtmlFragment,
  renderExcerpt,
  resolveSelectorChain,
  siblingHints,
} from './ann-excerpt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** 一个桶目录下的全部账本行（跳过 _seq.json；坏文件跳过）。 */
export function readBucketRows(bucketPath) {
  const out = [];
  if (!fs.existsSync(bucketPath)) return out;
  for (const name of fs.readdirSync(bucketPath).sort()) {
    if (!name.endsWith('.json') || name === '_seq.json') continue;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(path.join(bucketPath, name), 'utf8'));
    } catch {
      continue;
    }
    const rows = Array.isArray(doc.annotations) ? doc.annotations : [];
    const ledger = name.replace(/\.json$/, '');
    for (const row of rows) {
      const normalized = normalizeAnnotation(row);
      if (!normalized || typeof normalized !== 'object') continue;
      out.push({ ...normalized, __ledger: ledger });
    }
  }
  return out;
}

/**
 * 一页的标注全量（storage-unify：桶 = 页）：帧标注 = 本页桶的 @canvas 账本，
 * 文档标注 = 桶里按路径分的其余账本。skipLedgers = 孤儿账本名（不带 .json），
 * 它们的行不进计数、不走引用解析，只由 check / status 单独列出。
 * 返回 { frameRows, docRows }；行上带 __bucket / __ledger，mark 回写时用。
 */
export function collectPageRows({ root, pageId, skipLedgers = [] }) {
  const skip = new Set(skipLedgers);
  const rows = readBucketRows(path.join(root, pageId))
    .filter((row) => !skip.has(row.__ledger))
    .map((row) => ({ ...row, __bucket: pageId }));
  const frameRows = rows.filter((row) => row.__ledger === CANVAS_LEDGER);
  const docRows = rows
    .filter((row) => row.__ledger !== CANVAS_LEDGER)
    .map((row) => ({ ...row, __page: row.__ledger }));
  return { frameRows, docRows };
}

/** check / locate / status / prune 的页上下文：编译目标 + 板 + 引用号 + 标注 + 孤儿。 */
export function loadPageContext({ pageRef, registryPath = null, root = null, dataRootDir = null }) {
  const repoRoot = root || REPO_ROOT;
  const registry = loadRegistry({ root: repoRoot, path: registryPath || undefined });
  const target = resolvePageTarget(pageRef, { registry, root: repoRoot });
  if (!target) return null;
  let board = null;
  try {
    board = JSON.parse(fs.readFileSync(path.join(target.pageDir, 'board.json'), 'utf8'));
  } catch { /* 板坏：resolvePageTarget 已保证存在；真坏由调用方呈现 */ }
  const dataRootValue = dataRootDir || dataRoot();
  // 孤儿账本（storage-unify）：从帧/文档行里摘出去，单独挂在上下文上。
  const localIds = manifestPageIds(repoRoot);
  const orphanLedgers = collectPageOrphans({
    pageId: target.entryId,
    dataRoot: dataRootValue,
    entries: registry.entries,
    isManifestPage: !registry.resolve(target.entryId) && localIds.includes(target.entryId),
    previewsRoot: path.join(repoRoot, 'content', 'previews'),
  });
  const { frameRows, docRows } = collectPageRows({
    root: dataRootValue,
    pageId: target.entryId,
    skipLedgers: orphanLedgers.map((name) => name.replace(/\.json$/, '')),
  });
  const orphanRows = readBucketLedgers(path.join(dataRootValue, target.entryId))
    .filter((ledger) => orphanLedgers.includes(ledger.name))
    .flatMap((ledger) => (Array.isArray(ledger.doc.annotations) ? ledger.doc.annotations : [])
      .map((row) => normalizeAnnotation(row)))
    .filter(Boolean)
    .map((row) => ({ ...row, __bucket: target.entryId, __ledger: orphanLedgerOf(row, orphanLedgers, path.join(dataRootValue, target.entryId)) }));
  return { pageId: target.entryId, target, board, refs: boardRefs(board || {}), frameRows, docRows, orphanLedgers, orphanRows };
}

function orphanLedgerOf(row, orphanLedgers, bucketPath) {
  // 行来自哪本孤儿账本不可靠（行上没有账本信息），这里只为显示服务：逐本比对 id。
  for (const name of orphanLedgers) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(bucketPath, name), 'utf8'));
      if (Array.isArray(doc.annotations) && doc.annotations.some((a) => a && a.id && a.id === row.id)) {
        return name.replace(/\.json$/, '');
      }
    } catch { /* 坏文件跳过 */ }
  }
  return orphanLedgers[0] ? orphanLedgers[0].replace(/\.json$/, '') : '';
}

/* ---- 锚点解析：selector → dist 元素 ---- */

const PP_ID_RE = /^(.+):(\d+)@(\d+)$/;

/**
 * 行的第一个目标在帧 dist HTML 里的元素（cssPath 链经 frameInternalSelector
 * 归一到 stage 后缀）。返回 { tree, node, html } 或 { error }。
 */
export function anchorNode(row, distHtml) {
  const selector = row && row.targets && row.targets[0] && row.targets[0].selector;
  if (!selector) return { error: '无锚点 selector' };
  const tree = parseHtmlFragment(distHtml);
  if (!tree) return { error: 'dist HTML 解析失败' };
  let chain = frameInternalSelector(selector);
  if (chain) chain = chain.replace(/^:scope\s*>\s*/, '');
  else if (/^#/.test(selector)) chain = selector;
  if (!chain) return { error: '锚点 selector 不可归一（无 stage 段）' };
  const node = resolveSelectorChain(tree, chain);
  if (!node) return { error: '锚点在当前产物里解析不到（可能已失效）' };
  return { tree, node, html: distHtml };
}

/** 元素的组件名：自身或最近祖先的 data-pp-comp；帧根（片段首元素）的组件名
    是帧自己的，不算「锚点落在组件里」。 */
export function anchorComp(node) {
  if (!node) return null;
  const isFragmentRoot = (el) => el.parent && el.parent.tag === '#root';
  if (node.attrs['data-pp-comp'] && !isFragmentRoot(node)) return node.attrs['data-pp-comp'];
  for (let cur = node.parent; cur && cur.tag !== '#root'; cur = cur.parent) {
    if (cur.attrs['data-pp-comp'] && !isFragmentRoot(cur)) return cur.attrs['data-pp-comp'];
  }
  return null;
}

/** 组件共用帧数：页内全部 dist 屏扫 data-pp-comp（结果缓存）。 */
export function compFrameUsage(distHtmlFor, screenIds) {
  const cache = new Map();
  return (comp) => {
    if (cache.has(comp)) return cache.get(comp);
    let count = 0;
    for (const screenId of screenIds) {
      const html = distHtmlFor(screenId);
      if (html && html.includes(`data-pp-comp="${comp}"`)) count += 1;
    }
    cache.set(comp, count);
    return count;
  };
}

/** data-pp-id 的源文件路径（页内相对优先，kit 落仓相对）。 */
export function sourceFileFor(ppIdFile, pageDir) {
  const local = path.join(pageDir, ppIdFile);
  if (fs.existsSync(local)) return local;
  const repo = path.join(REPO_ROOT, ppIdFile);
  if (fs.existsSync(repo)) return repo;
  return null;
}

/* ---- 摘录编排 ---- */

/** 区间为 null（锚点行号越界等）时退 ±3 行。 */
function rangeOrFallback(range, line, lineCount) {
  return range || { start: Math.max(1, line - 3), end: Math.min(lineCount, line + 3) };
}

/** 预算（约 300 token，4 字符 ≈ 1 token）：先砍兄弟提示，再截长段。 */
const EXCERPT_BUDGET = 1200;

function budgetClip(lines) {
  let text = lines.join('\n');
  if (text.length <= EXCERPT_BUDGET) return lines;
  // 先去掉兄弟提示行（sibling= 标记）。
  const kept = lines.filter((line) => !line.startsWith('sib|'));
  text = kept.join('\n');
  if (text.length <= EXCERPT_BUDGET) return kept;
  // 再硬截，留尾标。
  const out = [];
  let size = 0;
  for (const line of kept) {
    if (size + line.length + 20 > EXCERPT_BUDGET) {
      out.push('…（摘录达预算截断）');
      break;
    }
    out.push(line);
    size += line.length + 1;
  }
  return out;
}

/**
 * 一条标注的 code excerpt（决定 #19）。distHtmlFor / readFile 注入。
 * 返回 { lines: string[], file, line, comp, sharedFrames, anchor } 或
 * { lines: ['（摘录不可用：原因）'], ... }。
 */
export function excerptForRow(row, context) {
  const { target, distHtmlFor, readFile = () => null } = context;
  const screenId = row.screenId || '';
  const distHtml = distHtmlFor(screenId);
  if (!distHtml) return { lines: [`（摘录不可用：帧 ${screenId || '?'} 无 dist 产物，先 ppnt build）`], file: null, line: 0, comp: null };
  const anchor = anchorNode(row, distHtml);
  if (anchor.error) return { lines: [`（摘录不可用：${anchor.error}）`], file: null, line: 0, comp: null };
  const { node, html } = anchor;
  const comp = anchorComp(node);
  const breadcrumbs = ancestorsOf(node)
    .concat([node])
    .map((el) => el.attrs['data-pp-comp'])
    .filter(Boolean);
  const breadcrumb = breadcrumbs.length > 1 ? breadcrumbs.join(' > ') : '';

  const ppId = node.attrs['data-pp-id'] || '';
  const idMatch = ppId.match(PP_ID_RE);
  const segments = [];
  let file = null;
  let line = 0;
  if (idMatch) {
    file = idMatch[1];
    line = Number(idMatch[2]);
    const abs = sourceFileFor(file, target.pageDir);
    const source = abs ? readFile(abs) : null;
    if (source == null) {
      return { lines: [`（摘录不可用：源文件读不到 ${file}）`], file, line, comp };
    }
    const lines = source.split('\n');
    segments.push({ file, lines: foldRange(lines, line, rangeOrFallback(jsxElementRange(source, line), line, lines.length), 15) });
    // 组件内部锚点：两段 —— 帧里的实例行 + 组件定义里的元素。编译产物里组件
    // 根的 data-pp-id 指向元素字面量所在的文件（kit 组件 = kit 文件，页内
    // function 组件 = 帧文件）；锚点文件 ≠ 帧文件即「落在组件里」，实例行从
    // 帧源码扫 <CompName 得到。
    const rootPpId = (anchor.tree.children[0] && anchor.tree.children[0].attrs['data-pp-id']) || '';
    const rootMatch = rootPpId.match(PP_ID_RE);
    const frameFile = rootMatch ? rootMatch[1] : null;
    if (comp && frameFile && file !== frameFile) {
      const frameAbs = sourceFileFor(frameFile, target.pageDir);
      const frameSource = frameAbs ? readFile(frameAbs) : null;
      if (frameSource != null) {
        // 实例行（S3）：一帧多实例时，锚点是 dist 文档序里第 k 个该组件实例，
        // 实例行取帧源码里第 k 个 <Comp 匹配，不再恒指首匹配。帧源码里的匹配
        // 数不够（循环 / 条件渲染等映射不完美）时退回首匹配，并在段名注明。
        const k = instanceOrdinal(anchor.tree, node, comp);
        let instanceLine = kthTagLine(frameSource, comp, k);
        let label = k > 1 ? `（帧内实例 · 文档序第 ${k} 个）` : '（帧内实例）';
        if (!instanceLine) {
          instanceLine = kthTagLine(frameSource, comp, 1);
          label = `（帧内实例 · 文档序第 ${k} 个，源码只匹配到首处）`;
        }
        if (instanceLine > 0) {
          const frameLines = frameSource.split(String.fromCharCode(10));
          segments.unshift({
            file: `${frameFile}${label}`,
            lines: foldRange(frameLines, instanceLine, rangeOrFallback(jsxElementRange(frameSource, instanceLine), instanceLine, frameLines.length), 15),
          });
        }
      }
    }
  } else {
    // 存量 HTML：outerHTML 摘自 dist，行号指 dist 文件。
    const distRel = `dist/${target.entryId}/${screenId}.html`;
    segments.push({ file: distRel, lines: foldHtmlElement(node, html, lineOfNode(node, html)) });
    file = distRel;
  }
  const hints = siblingHints(node, html)
    .map((hint) => `sib|${hint.where === 'before' ? '↖ ' : '↘ '}${hint.text}`);
  const rendered = renderExcerpt({ breadcrumb, segments });
  const withHints = [...hints.filter((hint) => hint.startsWith('sib|↖')), ...rendered, ...hints.filter((hint) => hint.startsWith('sib|↘'))];
  return { lines: budgetClip(withHints).map((line) => line.replace(/^sib\|/, '')), file, line, comp, anchor: true };
}

function lineOfNode(node, html) {
  return String(html).slice(0, node.start).split('\n').length;
}

/** 锚点所属的组件元素（自身或最近祖先带 data-pp-comp；帧根不算，与 anchorComp
    同一条规则）在 dist 文档序里是该组件的第几个实例（1 起）。 */
function instanceOrdinal(tree, node, comp) {
  const isFragmentRoot = (el) => el.parent && el.parent.tag === '#root';
  const isCompEl = (el) => el && el.attrs && el.attrs['data-pp-comp'] === comp && !isFragmentRoot(el);
  let target = isCompEl(node) ? node : null;
  if (!target) {
    for (let cur = node.parent; cur && cur.tag !== '#root'; cur = cur.parent) {
      if (isCompEl(cur)) { target = cur; break; }
    }
  }
  if (!target) return 1;
  let seen = 0;
  const walk = (el) => {
    if (isCompEl(el)) seen += 1;
    if (el === target) return true;
    for (const child of el.children || []) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(tree);
  return Math.max(1, seen);
}

/** 帧源码里第 k 个 `<Comp` 匹配所在的行（1 起；匹配不足返回 0）。同一行的多个
    匹配按出现次数计。 */
function kthTagLine(source, comp, k) {
  const re = new RegExp(`<${comp}(?=[\\s/>])`, 'g');
  const lines = source.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    let hits = 0;
    while (re.exec(lines[i])) hits += 1;
    if (seen + hits >= k) return i + 1;
    seen += hits;
  }
  return 0;
}

/* ---- check 模型与格式化 ---- */

/** 意图标签：changeTo ✎ / move ↗ / 两者 / 普通。 */
export function intentOf(row) {
  const intents = [];
  if (row.changeTo) intents.push('changeTo');
  if (row.move) intents.push('move');
  return intents.length ? intents.join('+') : '普通';
}

export function checkRowModel(row, context) {
  const display = targetContentToDisplay(row.content || '', row.targets || []);
  const screenId = row.screenId || '';
  const frame = context.refs.byFrame
    ? Object.entries(context.refs.byFrame).find(([key]) => key.split('\0')[1] === screenId)
    : null;
  return {
    n: row.n,
    id: row.id,
    content: display,
    intent: intentOf(row),
    status: row.status || 'open',
    note: row.note || '',
    screenId,
    frameRef: frame ? frame[1] : '',
    bucket: row.__bucket,
    ledger: row.__ledger,
  };
}

/**
 * check 报告模型。options = { frame, status, groupBy, mode }；
 * context = loadPageContext 的返回 + distHtmlFor / readFile 注入。
 */
export function buildCheckReport(context, options = {}) {
  const status = options.status || 'open';
  const groupBy = options.groupBy || 'frame';
  const wantExcerpt = (options.mode || 'excerpt') !== 'image';
  const screenIds = context.refs.outline.flatMap((section) => section.frames.map((frame) => frame.id));
  const usage = compFrameUsage(context.distHtmlFor, screenIds);

  let rows = [...context.frameRows];
  if (status !== 'all') rows = rows.filter((row) => (row.status || 'open') === status);
  if (options.frame) {
    const hit = context.refs.outline.flatMap((section) => section.frames).find((frame) => frame.ref === options.frame);
    if (!hit) return { error: `图纸上没有帧 ${options.frame}` };
    rows = rows.filter((row) => row.screenId === hit.id);
  }

  const modeled = rows.map((row) => {
    const model = checkRowModel(row, context);
    if (wantExcerpt) {
      const excerpt = excerptForRow(row, context);
      model.excerpt = excerpt.lines;
      model.file = excerpt.file;
      model.line = excerpt.line;
      model.comp = excerpt.comp;
      model.sharedFrames = excerpt.comp ? usage(excerpt.comp) : 0;
    }
    return model;
  });
  const docRows = status === 'all'
    ? context.docRows
    : context.docRows.filter((row) => (row.status || 'open') === status);

  // 分组：按帧（默认）或按组件（无组件归「仅本帧」）。
  const groups = [];
  if (groupBy === 'component') {
    const byComp = new Map();
    for (const model of modeled) {
      const key = model.comp || '';
      if (!byComp.has(key)) byComp.set(key, []);
      byComp.get(key).push(model);
    }
    for (const [comp, models] of byComp) {
      groups.push({
        kind: 'component',
        title: comp ? comp : '仅本帧',
        detail: comp ? `组件 · 共用 ${models[0].sharedFrames || 0} 帧` : '',
        rows: models,
      });
    }
  } else {
    const orderedFrames = context.refs.outline.flatMap((section) => section.frames);
    const byScreen = new Map();
    for (const model of modeled) {
      if (!byScreen.has(model.screenId)) byScreen.set(model.screenId, []);
      byScreen.get(model.screenId).push(model);
    }
    const used = new Set();
    for (const frame of orderedFrames) {
      used.add(frame.id);
      if (!byScreen.has(frame.id)) continue;
      groups.push({
        kind: 'frame',
        title: `${frame.ref} ${frame.title}`,
        ref: frame.ref,
        screenId: frame.id,
        rows: byScreen.get(frame.id),
      });
    }
    for (const [screenId, models] of byScreen) {
      if (used.has(screenId)) continue;
      groups.push({ kind: 'frame', title: screenId, ref: '', screenId, rows: models, offBoard: true });
    }
  }
  if (docRows.length) {
    groups.push({
      kind: 'doc',
      title: '文档页标注（非帧）',
      rows: docRows.map((row) => checkRowModel({ ...row, __ledger: row.__page || row.__ledger }, context)),
    });
  }
  // 孤儿账本（storage-unify）：单独一组、标「孤儿」，不进上面的状态过滤，也不
  // 计入 counts —— 表面已经不存在，处理它们走 ppnt prune，不走 mark。
  const orphanRows = (context.orphanRows || []);
  if (orphanRows.length) {
    groups.push({
      kind: 'orphan',
      title: `孤儿标注（表面已不存在，ppnt prune ${context.pageId} 清理）`,
      rows: orphanRows.map((row) => ({ ...checkRowModel(row, context), orphan: true })),
    });
  }
  return { page: context.pageId, status, groupBy, groups, counts: countByStatus([...context.frameRows, ...context.docRows]) };
}

export function countByStatus(rows) {
  const counts = { open: 0, check: 0, done: 0, close: 0 };
  for (const row of rows) counts[row.status || 'open'] = (counts[row.status || 'open'] || 0) + 1;
  counts.total = rows.length;
  return counts;
}

/** check 的 markdown（一组行）。 */
export function formatCheckMarkdown(report, { imagePaths = null } = {}) {
  const lines = [];
  lines.push(`# ${report.page} · 标注清单（${report.status}）`);
  const total = report.groups.reduce((sum, group) => sum + group.rows.length, 0);
  lines.push(`共 ${total} 条${report.status === 'all' ? '' : `（全量 ${report.counts.total}）`}`);
  if (imagePaths && report.groups.some((group) => group.kind === 'frame')) {
    const seen = new Set();
    for (const group of report.groups) {
      if (group.kind !== 'frame' || !imagePaths[group.screenId] || seen.has(group.screenId)) continue;
      seen.add(group.screenId);
      lines.push(`截图 ${group.ref || group.screenId}：${imagePaths[group.screenId]}`);
    }
  }
  for (const group of report.groups) {
    lines.push('');
    lines.push(`## ${group.title}${group.detail ? ` · ${group.detail}` : ''}`);
    for (const row of group.rows) {
      const parts = [`[#${displayN(row)}]`, row.content, `· ${row.intent}`, `· ${row.status}`];
      if (row.note) parts.push(`· note：${row.note}`);
      if (row.comp) parts.push(`· ${row.comp}（共用 ${row.sharedFrames} 帧）`);
      lines.push(parts.join(' '));
      if (row.excerpt && row.excerpt.length) {
        for (const line of row.excerpt) lines.push(`  ${line}`);
      }
    }
  }
  if (!report.groups.length) lines.push('', '（该过滤条件下没有标注）');
  return lines;
}

/* ---- locate ---- */

/** 读侧显示序号：没跑过发号服务的冷账本行没有 n，显示 #?，不出 #undefined（建议 9）。 */
function displayN(row) {
  return Number.isInteger(row && row.n) ? String(row.n) : '?';
}

/** 一条标注的定位行。 */
export function locateLine(row, context) {
  const n = displayN(row);
  const distHtml = context.distHtmlFor(row.screenId || '');
  const where = row.screenId ? `${row.screenId}` : '文档页';
  if (!distHtml) {
    return { n: row.n, text: `#${n} → 帧无 dist 产物（${where}）；selector：${(row.targets && row.targets[0] && row.targets[0].selector) || row.selector || ''}` };
  }
  const anchor = anchorNode(row, distHtml);
  if (anchor.error) {
    return { n: row.n, text: `#${n} → ${anchor.error}；selector：${(row.targets && row.targets[0] && row.targets[0].selector) || row.selector || ''}` };
  }
  const ppId = anchor.node.attrs['data-pp-id'] || '';
  const idMatch = ppId.match(PP_ID_RE);
  const comp = anchorComp(anchor.node);
  const usage = comp ? compFrameUsage(context.distHtmlFor, context.refs.outline.flatMap((section) => section.frames.map((frame) => frame.id)))(comp) : 0;
  if (idMatch) {
    const tail = comp ? ` · 组件 ${comp}（共用 ${usage} 帧）` : '';
    return { n: row.n, text: `#${n} → ${idMatch[1]}:${idMatch[2]}${tail}` };
  }
  return {
    n: row.n,
    text: `#${n} → dist/${context.pageId}/${row.screenId}.html · ${(row.targets && row.targets[0] && row.targets[0].selector) || row.selector || ''}`,
  };
}
