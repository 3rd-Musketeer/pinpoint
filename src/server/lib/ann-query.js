/**
 * ppnt check / locate / status / prune 的查询层（2026-09-22 切片 4；
 * storage-unify 起读模型换成桶 = 页）。
 *
 * 数据从哪来（读侧，无副作用）：
 * - 帧标注：本页桶里的 @canvas 账本（画布与 /api/frame 嵌入帧共用这一本），
 *   行带 pageId / screenId；
 * - 文档标注：同一桶里按路径分的其余账本（/sites/<id>/ 与 /previews/ 直开页）；
 * - 正文评论（pp3）：article 页桶里的 @prose 账本，行 type 'prose'（引文 +
 *   section + 线程）。它们随文档行一起进计数、mark、locate，check 单独成组；
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

import { annStatusOf } from '../../shared/ann-status.js';
import { bucketOnDisk, dataRoot } from './annotate-data-dir.js';
import { CANVAS_LEDGER } from './annotation-store.js';
import { collectPageOrphans, readBucketLedgers } from './orphans.js';
import { manifestPageIds } from './page-manifest.js';
import { articleSectionSpans } from './article-canvas.js';
import { articleHtmlFrameFile } from './article-board.js';
import { resolvePage } from './page-resolve.js';
import { readTargetBoard, resolvePageTarget } from './page-compiler.js';
import { loadRegistry } from './registry.js';
import { parseFrontmatter } from './frontmatter.js';
import { normalizeAnnotation, targetContentToDisplay } from '../../shared/annotation-indicator.js';
import { isProseRow } from '../../shared/prose-thread.js';
import { SECTION_HINT_SCORE } from '../../shared/text-quote.js';
import { boardRefs, outlineFrames } from '../../workbench/lib/board-refs.js';
import { flattenTabs } from '../../workbench/lib/board-tabs.js';
import { resolveRef } from './ann-refs.js';
import { frameInternalSelector } from '../../shared/frame-anchor.js';
import { pickByTargetText } from '../../shared/ann-ppid.js';
import {
  ancestorsOf,
  elementTextOf,
  foldHtmlElement,
  foldRange,
  jsxElementRange,
  nodeMatches,
  parseHtmlFragment,
  renderExcerpt,
  resolveSelectorChain,
  segmentMatcher,
  siblingHints,
} from './ann-excerpt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** 一个桶目录下的全部账本行（跳过 _seq.json；坏文件跳过）。行带 __ledger 与
    __docPath（账本的表面路径，doc 页标注按路径分账本，check 显示用）。 */
function readBucketRows(bucketPath) {
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
    const docPath = typeof doc.path === 'string' ? doc.path : '';
    for (const row of rows) {
      const normalized = normalizeAnnotation(row);
      if (!normalized || typeof normalized !== 'object') continue;
      out.push({ ...normalized, __ledger: ledger, __docPath: docPath });
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

/**
 * 文章画布上文档帧（shell doc，多半是 HTML 帧）的表面路径 → 帧 id。路径就是帧在服务上的地址（解码后的
 * pathname）：没有 src 的是 `<urlBase><帧 id>.html`，有 src 的是 `/<src>`（project 根下的 HTML 帧）。
 * 文档帧上的标注按路径记在各自的账本里（和存量页的文档一样，锚点是元素选择器加文字），读的时候靠它对回帧。
 */
export function docFramePaths(board, urlBase) {
  const out = new Map();
  for (const section of (board && board.sections) || []) {
    for (const raw of section.screens || []) {
      const screen = typeof raw === 'string' ? { id: raw } : raw;
      if (!screen || (screen.shell || section.shell) !== 'doc') continue;
      let p = screen.src ? `/${String(screen.src).replace(/^\//, '')}` : `${urlBase}${screen.id}.html`;
      try { p = decodeURI(p); } catch { /* 保持原样 */ }
      if (!out.has(p)) out.set(p, screen.id);
    }
  }
  return out;
}

/** 文章画布上一个文档帧的地址（`/sites/…`，未编码前的路径）；不是文档帧返回 null。 */
export function docFrameUrl(board, urlBase, screenId) {
  for (const [p, id] of docFramePaths(board, urlBase)) if (id === screenId) return p;
  return null;
}

/** 文章：文档帧账本里的行挪进帧行，带上 screenId（ppnt comments 按帧分组、给编号；mark 仍写回原账本）。 */
function attachDocFrameRows({ frameRows, docRows }, board, urlBase) {
  const paths = docFramePaths(board, urlBase);
  if (!paths.size) return { frameRows, docRows };
  const moved = [];
  const rest = [];
  for (const row of docRows) {
    const screenId = paths.get(row.__docPath);
    if (screenId && row.type !== 'prose') moved.push({ ...row, screenId, __docFrame: true });
    else rest.push(row);
  }
  return { frameRows: [...frameRows, ...moved], docRows: rest };
}

/** 孤儿账本 + 本页标注行的装配（编译页与 doc 页共用）：孤儿从帧/文档行里
    摘出去，单独挂在上下文上，清理只经 prune。 */
/** 一篇 article 的页（`<project>_<article>`）：上下文带上文章的源文件与地址，正文评论的
    源码定位与 check 抬头用。不是文章页返回 null。 */
function articleInfo(target) {
  if (!target || target.kind !== 'article') return null;
  let title = target.articleId;
  try {
    title = parseFrontmatter(fs.readFileSync(target.articleFile, 'utf8')).data.title || title;
  } catch { /* 读不到：用 id（与 listProjects 的缺省相同） */ }
  return {
    projectId: target.projectId,
    articleId: target.articleId,
    title,
    file: target.articleFile,
    url: `/${target.projectId}/${target.articleId}/`,
  };
}

function contextWithRows({ registry, repoRoot, dataRootValue, pageId, target, board, isManifestPage }) {
  const orphanLedgers = collectPageOrphans({
    pageId,
    dataRoot: dataRootValue,
    entries: registry.entries,
    isManifestPage,
    previewsRoot: path.join(repoRoot, 'content', 'previews'),
    article: target && target.kind === 'article' ? target : null,
  });
  const collected = collectPageRows({
    root: dataRootValue,
    pageId,
    skipLedgers: orphanLedgers.map((name) => name.replace(/\.json$/, '')),
  });
  const { frameRows, docRows } = target && target.kind === 'article' && board
    ? attachDocFrameRows(collected, board, target.urlBase)
    : collected;
  const orphanRows = readBucketLedgers(path.join(dataRootValue, pageId))
    .filter((ledger) => orphanLedgers.includes(ledger.name))
    .flatMap((ledger) => (Array.isArray(ledger.doc.annotations) ? ledger.doc.annotations : [])
      .map((row) => normalizeAnnotation(row)))
    .filter(Boolean)
    .map((row) => ({ ...row, __bucket: pageId, __ledger: orphanLedgerOf(row, orphanLedgers, path.join(dataRootValue, pageId)) }));
  return { pageId, target, board, refs: boardRefs(board || {}), frameRows, docRows, orphanLedgers, orphanRows, article: articleInfo(target) };
}

/**
 * check / locate / status / prune 的页上下文：编译目标 + 板 + 引用号 + 标注 + 孤儿。
 * 编译页落空时的回落：registry 里没有 board.json 的 dir / file 条目也是页
 * （storage-unify 的桶就是页，每个 pathname 一本文档账本）—— 没有板、没有
 * dist，check / status / mark 照常，摘录与截图这类编译面由调用方按 docOnly
 * 明说不可用。
 */
export function loadPageContext({ pageRef, registryPath = null, root = null, dataRootDir = null }) {
  const repoRoot = root || REPO_ROOT;
  const registry = loadRegistry({ root: repoRoot, path: registryPath || undefined });
  const dataRootValue = dataRootDir || dataRoot();
  const target = resolvePageTarget(pageRef, { registry, root: repoRoot });
  if (!target) {
    // 文章页 `<project>_<article>` 不走这里：index.mdx 在盘上时 resolvePageTarget 已返回
    // kind 'article' 的目标（没编译过也是），不在盘上就不是页。
    const page = resolvePage(registry, pageRef, { manifestIds: manifestPageIds(repoRoot) });
    // 页已不在、桶还在盘上：整桶孤儿，照样能列、能 mark / reply（docs/annotation.md“孤儿”）。
    if (!page) return bucketOrphanContext(dataRootValue, pageRef);
    const entry = page.kind === 'entry' ? page.entry : null;
    if (!entry || (entry.kind !== 'dir' && entry.kind !== 'file')) return null;
    const docTarget = {
      entryId: entry.id,
      pageDir: entry.kind === 'dir' && typeof entry.path === 'string' ? path.resolve(entry.path) : null,
      urlBase: `/sites/${entry.id}/`,
      kind: entry.kind,
      docOnly: true,
    };
    return {
      ...contextWithRows({ registry, repoRoot, dataRootValue, pageId: entry.id, target: docTarget, board: null, isManifestPage: false }),
      docOnly: true,
    };
  }
  let board = null;
  try {
    board = flattenTabs(readTargetBoard(target));
  } catch { /* 板坏：resolvePageTarget 已保证存在；真坏由调用方呈现 */ }
  return contextWithRows({
    registry,
    repoRoot,
    dataRootValue,
    pageId: target.entryId,
    target,
    board,
    isManifestPage: (resolvePage(registry, target.entryId, { manifestIds: manifestPageIds(repoRoot) }) || {}).kind === 'template',
  });
}

/**
 * 页已不在（文章删了或改了名、project 或条目撤了登记）而桶目录还在盘上：整桶皆孤儿。
 * 全部行进 orphanRows，带上各自的账本：不计数，`#n`、`@a:<id>`、`<页>#n` 照样指得到，mark / reply
 * 按账本加序号写回。没有板，也没有编译面。桶不在（或 id 不合页 id 形状）时 null。
 */
function bucketOrphanContext(dataRootValue, pageId) {
  if (!bucketOnDisk(dataRootValue, pageId)) return null;
  const ledgers = readBucketLedgers(path.join(dataRootValue, String(pageId)));
  const orphanRows = ledgers.flatMap(({ name, doc }) => (Array.isArray(doc && doc.annotations) ? doc.annotations : [])
    .map((row) => normalizeAnnotation(row))
    .filter((row) => row && typeof row === 'object')
    .map((row) => ({
      ...row,
      __bucket: String(pageId),
      __ledger: name.replace(/\.json$/, ''),
      __docPath: typeof doc.path === 'string' ? doc.path : '',
    })));
  return {
    pageId: String(pageId),
    target: null,
    board: null,
    refs: boardRefs({}),
    frameRows: [],
    docRows: [],
    orphanLedgers: ledgers.map((ledger) => ledger.name),
    orphanRows,
    article: null,
    docOnly: true,
    bucketOrphan: true,
  };
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

/* ---- 锚点解析：ppId 直取 → selector 链 ---- */

const PP_ID_RE = /^(.+):(\d+)@(\d+)$/;

/** 树里按 data-pp-id 值收集节点（文档序）。 */
function nodesByPpId(tree, ppId) {
  const hits = [];
  const walk = (node) => {
    if (node.attrs && node.attrs['data-pp-id'] === ppId) hits.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  return hits;
}

/* ---- 存量画布标注的机壳剥离兜底 ---- */

// wrapPhoneShell（src/shared/frame-shell.js）垫在 stage 与片段之间的四层机壳。
// 画布上片段被装进 ios-screen 时，机壳还往里插了 island / statusbar / home 等
// 兄弟，所以片段顶层元素的 nth-of-type 在画布 selector 里整体偏移 —— dist 片段
// （只是屏幕内容）既没有这四层、顶层 nth 也对不上。
const PHONE_SHELL_CLASSES = ['ios-root', 'ios-device', 'ios-bezel', 'ios-screen'];
const SHELL_SEGMENT_RES = PHONE_SHELL_CLASSES.map(
  (cls) => new RegExp(`^div\\.${cls}(?:\\.[-\\w]+)*(?::nth-of-type\\(\\d+\\))?$`),
);

/**
 * 链首恰为四层机壳段时返回机壳后的剩余段，否则 null。只认 wrapPhoneShell 这
 * 一种形状 —— 别的壳结构不猜，维持原解析与原报错。
 */
function stripPhoneShell(chain) {
  const segments = String(chain || '').split(' > ');
  if (segments.length <= PHONE_SHELL_CLASSES.length) return null;
  for (let i = 0; i < PHONE_SHELL_CLASSES.length; i++) {
    if (!SHELL_SEGMENT_RES[i].test(segments[i])) return null;
  }
  return segments.slice(PHONE_SHELL_CLASSES.length);
}

/**
 * 机壳剥掉后的解析：剩余链的第一段去掉 :nth-of-type、按 class 在片段顶层
 * （#root 的孩子）找 —— 片段顶层正是机壳 ios-screen 里被插过兄弟的那一层；
 * 多命中按存储的 target.text 择近；其余段结构没被动过，照常在其下解析。
 */
function resolveAfterShell(tree, rest, distHtml, storedText) {
  const head = segmentMatcher(rest[0]);
  // cssPath 段形是 tag.cls[:nth-of-type(n)]，没有 class 的顶层元素认不出，不猜。
  if (!head || head.id || !head.cls) return null;
  const hits = tree.children.filter((child) => nodeMatches(child, { tag: head.tag, cls: head.cls, nth: 0 }));
  if (!hits.length) return null;
  const best = pickByTargetText(
    hits.map((node) => ({ node, text: elementTextOf(node, distHtml) })),
    storedText,
  );
  const tail = rest.slice(1).join(' > ');
  return tail ? resolveSelectorChain(best.node, tail) : best.node;
}

/**
 * 行的第一个目标在帧 dist HTML 里的元素。决定 #15：target 带 ppId 时先按
 * [data-pp-id] 直取（不再拿 cssPath 反查元素读它的 id —— 帧结构一改 cssPath
 * 会漂到别的元素上）；同一 id 多实例（同行循环渲染）按文本择近；没有 ppId
 * 或直取落空再走 cssPath 链（frameInternalSelector 归一到 stage 后缀）。
 * 存量画布标注的 selector 以工作台 DOM 为根：直链解析不到且链首是机壳四层时，
 * 剥掉机壳改按 class 在片段顶层找（resolveAfterShell）。
 * 返回 { tree, node, html } 或 { error }。
 */
export function anchorNode(row, distHtml) {
  const target = row && row.targets && row.targets[0];
  const selector = target && target.selector;
  const ppId = target && target.ppId;
  if (!selector && !ppId) return { error: '无锚点 selector' };
  const tree = parseHtmlFragment(distHtml);
  if (!tree) return { error: 'dist HTML 解析失败' };
  if (ppId) {
    const hits = nodesByPpId(tree, ppId);
    if (hits.length) {
      const best = pickByTargetText(
        hits.map((node) => ({ node, text: elementTextOf(node, distHtml) })),
        target.text || '',
      );
      return { tree, node: best.node, html: distHtml };
    }
  }
  if (!selector) return { error: '锚点在当前产物里解析不到（可能已失效）' };
  let chain = frameInternalSelector(selector);
  if (chain) chain = chain.replace(/^:scope\s*>\s*/, '');
  else if (/^#/.test(selector)) chain = selector;
  if (!chain) return { error: '锚点 selector 不可归一（无 stage 段）' };
  let node = resolveSelectorChain(tree, chain);
  if (!node) {
    const rest = stripPhoneShell(chain);
    if (rest) node = resolveAfterShell(tree, rest, distHtml, target.text || '');
  }
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
function compFrameUsage(distHtmlFor, screenIds) {
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
function sourceFileFor(ppIdFile, pageDir) {
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
  if (!distHtml) return { lines: [`（摘录不可用：帧 ${screenId || '?'} 还没编进 dist，先跑 ppnt build <目标>，再读一次）`], file: null, line: 0, comp: null };
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
    // 存量 HTML：outerHTML 摘自 dist，行号指 dist 文件。文章的 HTML 帧原样进 dist，行号与源文件相同，
    // 直接指源文件（本篇目录下的写相对文章目录的路径，project 根下的写绝对路径）。
    const htmlSource = htmlFrameSourceOf(context, screenId);
    const shown = htmlSource || `dist/${target.entryId}/${screenId}.html`;
    line = lineOfNode(node, html);
    segments.push({ file: shown, lines: foldHtmlElement(node, html, line) });
    file = shown;
  }
  const hints = siblingHints(node, html)
    .map((hint) => `sib|${hint.where === 'before' ? '↖ ' : '↘ '}${hint.text}`);
  const rendered = renderExcerpt({ breadcrumb, segments });
  const withHints = [...hints.filter((hint) => hint.startsWith('sib|↖')), ...rendered, ...hints.filter((hint) => hint.startsWith('sib|↘'))];
  return { lines: budgetClip(withHints).map((line) => line.replace(/^sib\|/, '')), file, line, comp, anchor: true };
}

/** 文章画布上一个 HTML 帧的源文件（显示用），不是 HTML 帧返回 null。 */
function htmlFrameSourceOf(context, screenId) {
  const { target, board } = context;
  if (!target || target.kind !== 'article' || !board) return null;
  for (const section of board.sections || []) {
    for (const raw of section.screens || []) {
      const screen = typeof raw === 'string' ? { id: raw } : raw;
      if (!screen || screen.id !== screenId) continue;
      const abs = articleHtmlFrameFile(target, screen);
      if (!abs) return null;
      const rel = path.relative(target.pageDir, abs);
      return rel.startsWith('..') ? abs : rel.split(path.sep).join('/');
    }
  }
  return null;
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

/** 多 tab 页（≥ 2）的位置号带 tab 前缀：`flow:B3`；其余原样。 */
function qualifiedRef(refs, tabId, ref) {
  return tabId && refs.tabs && refs.tabs.length >= 2 ? `${tabId}:${ref}` : ref;
}

/** 意图标签：changeTo ✎ / move ↗ / 两者 / 普通。 */
export function intentOf(row) {
  const intents = [];
  if (row.changeTo) intents.push('changeTo');
  if (row.move) intents.push('move');
  return intents.length ? intents.join('+') : '普通';
}

function checkRowModel(row, context) {
  const display = targetContentToDisplay(row.content || '', row.targets || []);
  const screenId = row.screenId || '';
  const frame = context.refs.byFrame
    ? Object.entries(context.refs.byFrame).find(([key]) => key.split('\0')[1] === screenId)
    : null;
  // 多 tab 页上位置号带 tab 前缀（`flow:B3`），单 tab / 存量页原样。
  const frameOnBoard = outlineFrames(context.refs).find((entry) => entry.id === screenId);
  return {
    n: row.n,
    id: row.id,
    content: display,
    intent: intentOf(row),
    status: annStatusOf(row),
    screenId,
    frameRef: frame ? qualifiedRef(context.refs, frameOnBoard && frameOnBoard.tabId, frame[1]) : '',
    bucket: row.__bucket,
    ledger: row.__ledger,
    docPath: row.__docPath || '',
    // 线程里的回复（ppnt reply、mark --note 写的 agent 消息）；正文评论另在 proseRowModel 里给全线程。
    messages: threadReplies(row),
  };
}

/** 一行的线程消息（content 之后的来回）：[{ who, text, at }]。 */
function threadReplies(row) {
  return (Array.isArray(row.messages) ? row.messages : []).filter((m) => m && typeof m.text === 'string')
    .map((m) => ({ who: m.who === 'agent' ? 'agent' : 'owner', text: m.text, at: m.at || '' }));
}

/**
 * check 报告模型。options = { frame, status, groupBy, mode }；
 * context = loadPageContext 的返回 + distHtmlFor / readFile 注入。
 */
export function buildCheckReport(context, options = {}) {
  const status = options.status || 'open';
  const groupBy = options.groupBy || 'frame';
  // doc 页（无 board.json 的 dir / file 条目）没有编译面：不产摘录，报告里
  // 明说（formatCheckMarkdown 的 docOnly 行）。
  const wantExcerpt = (options.mode || 'excerpt') !== 'image' && !context.docOnly;
  const screenIds = outlineFrames(context.refs).map((frame) => frame.id);
  const usage = compFrameUsage(context.distHtmlFor, screenIds);

  let rows = [...context.frameRows];
  if (status !== 'all') rows = rows.filter((row) => annStatusOf(row) === status);
  if (options.frame) {
    // 帧号走与 mark / locate / shot 同一套解析：B3、<tab>:B3、裸帧 id；多 tab 页上裸 B3 有歧义会报候选。
    const hit = resolveRef(options.frame, { rows: [], refs: context.refs, pageId: context.pageId });
    // 歧义 / 未知 tab 的报错带候选，原样给出；其余沿用从前那一句。
    if (hit.kind === 'unknown' && /tab/.test(hit.message)) return { error: hit.message };
    if (hit.kind !== 'frame') return { error: `画布上没有帧 ${options.frame}` };
    rows = rows.filter((row) => row.screenId === hit.screenId);
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
  const statusRows = status === 'all'
    ? context.docRows
    : context.docRows.filter((row) => annStatusOf(row) === status);
  const docRows = statusRows.filter((row) => !isProseRow(row));
  const proseRows = statusRows.filter(isProseRow);

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
    const orderedFrames = outlineFrames(context.refs);
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
        // 编号是按位置派生的显示编号，id 是不变身份：两个都给，agent 写进留存文字时用 id。
        title: `${qualifiedRef(context.refs, frame.tabId, frame.ref)} · ${frame.id} · ${frame.title}`,
        ref: qualifiedRef(context.refs, frame.tabId, frame.ref),
        tabId: frame.tabId || '',
        screenId: frame.id,
        rows: byScreen.get(frame.id),
      });
    }
    for (const [screenId, models] of byScreen) {
      if (used.has(screenId)) continue;
      groups.push({ kind: 'frame', title: screenId, ref: '', screenId, rows: models, offBoard: true });
    }
  }
  if (proseRows.length) {
    const source = context.article ? readSourceOnce(context) : null;
    groups.push({
      kind: 'prose',
      title: context.article ? `正文评论 · ${context.article.title}（${context.article.url}）` : '正文评论',
      rows: proseRows.map((row) => proseRowModel(row, context, source)),
    });
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
  return {
    page: context.pageId,
    status,
    groupBy,
    docOnly: !!context.docOnly,
    ...(context.bucketOrphan ? { bucketOrphan: { ledgers: context.orphanLedgers || [] } } : {}),
    ...(context.article ? { article: context.article } : {}),
    groups,
    counts: countByStatus([...context.frameRows, ...context.docRows]),
  };
}

function readSourceOnce(context) {
  const reader = context.readFile || ((file) => {
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
  });
  return reader(context.article.file);
}

// 一份源文件的节所占的行（articleSectionSpans 要解析 MDX）：同一份正文连着问几行时只解析一次。
let sectionSpansMemo = { source: null, spans: [] };
function sectionSpansOf(source) {
  if (sectionSpansMemo.source !== source) sectionSpansMemo = { source, spans: articleSectionSpans(source) };
  return sectionSpansMemo.spans;
}

/**
 * 引文在文章源文件里的行号（1 起），给 agent 一个落脚行。quote = { exact, prefix, suffix }，
 * section = 评论时所在的节。逐字找 exact，找不到退到它的前 12 个字符（渲染后的正文在
 * 源文件里可能夹着 markdown 记号）；同一串出现在几行时，按行内前后文与 prefix / suffix
 * 的吻合程度挑，落在 `<Section id="<section>">` 里的再加 SECTION_HINT_SCORE（与浏览器端
 * 定位引文同一个分值）。哪些行属于哪一节，与画布、站点同一个结构走法（articleSectionSpans）。
 * 都没有是 0。
 */
export function quoteSourceLine(source, quote, section = '') {
  const q = typeof quote === 'string' ? { exact: quote } : (quote || {});
  const exact = q.exact || '';
  if (typeof source !== 'string' || !exact) return 0;
  const lines = source.split('\n');
  const spans = section ? sectionSpansOf(source).filter((span) => span.id === section) : [];
  const inSection = (lineNo) => spans.some((span) => lineNo >= span.startLine && lineNo <= span.endLine);
  const prefix = q.prefix || '';
  const suffix = q.suffix || '';
  const tailMatch = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1; return n; };
  const headMatch = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n += 1; return n; };
  const probes = [exact, exact.slice(0, 12)].filter((probe, i, all) => probe && all.indexOf(probe) === i);
  for (const probe of probes) {
    let best = null;
    lines.forEach((line, i) => {
      const at = line.indexOf(probe);
      if (at < 0) return;
      const score = tailMatch(line.slice(0, at), prefix) + headMatch(line.slice(at + probe.length), suffix)
        + (inSection(i + 1) ? SECTION_HINT_SCORE : 0);
      if (!best || score > best.score) best = { line: i + 1, score };
    });
    if (best) return best.line;
  }
  return 0;
}

/** 正文评论的一行：在普通行模型上加引文、节、线程与源码落脚行。 */
function proseRowModel(row, context, source = null) {
  const model = checkRowModel(row, context);
  const exact = (row.quote && row.quote.exact) || '';
  const line = context.article ? quoteSourceLine(source, row.quote, row.section) : 0;
  return {
    ...model,
    kind: 'prose',
    intent: '正文评论',
    section: row.section || '',
    quote: exact,
    messages: threadReplies(row),
    file: context.article ? context.article.file : null,
    line,
  };
}

/** 线程消息的时间：本地时区 MM-DD HH:MM；坏值原样。 */
function shortTime(iso) {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return String(iso || '');
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function countByStatus(rows) {
  const counts = { open: 0, check: 0, done: 0, close: 0 };
  for (const row of rows) counts[annStatusOf(row)] = (counts[annStatusOf(row)] || 0) + 1;
  counts.total = rows.length;
  return counts;
}

/** check 的 markdown（一组行）。 */
export function formatCheckMarkdown(report, { imagePaths = null } = {}) {
  const lines = [];
  // address：CLI 给的显示地址（文章是 <project>/<article>），缺省用页 id。
  if (report.bucketOrphan) {
    // 整桶孤儿：页已不在，只有孤儿组；行照样能回复、写状态，清理由 owner 走 prune。
    const shown = report.address || report.page;
    const ledgers = report.bucketOrphan.ledgers;
    lines.push(`${shown} 不在 registry 与本地页面清单里（文章删了、改名了，或页不在了）；桶里 ${ledgers.length} 本账本全是孤儿：`);
    for (const name of ledgers) lines.push(`  ${name}`);
    lines.push(`还没关的照样回：ppnt mark ${shown} '#n' check|done --note "<回复>"、ppnt reply；清理：ppnt prune ${shown}（--dry-run 先看清单）`);
    for (const group of report.groups) {
      lines.push('', `## ${group.title}`);
      for (const row of group.rows) {
        lines.push([`[#${displayN(row)}]`, row.content, `· ${row.intent}`, `· ${row.status}`, row.docPath ? `· ${row.docPath}` : ''].filter(Boolean).join(' '));
        for (const m of row.messages || []) lines.push(`  ${m.who}${m.at ? `（${shortTime(m.at)}）` : ''}：${m.text}`);
      }
    }
    return lines;
  }
  lines.push(`# ${report.address || report.page} · 标注队列（${report.status}）`);
  const total = report.groups.reduce((sum, group) => sum + group.rows.length, 0);
  const c = report.counts;
  lines.push(`共 ${total} 条${report.status === 'all' ? '' : `（全量 ${c.total}）`} · open ${c.open} · check ${c.check} · done ${c.done} · close ${c.close}`);
  if (report.article) lines.push(`文章：${report.article.url} · ${report.article.file}`);
  if (report.docOnly) lines.push(report.article ? '这篇文章还没有编译的画布帧，只有正文评论。' : '这页不是编译页，没有源码摘录。');
  if (imagePaths && report.groups.some((group) => group.kind === 'frame')) {
    const seen = new Set();
    for (const group of report.groups) {
      if (group.kind !== 'frame' || !imagePaths[group.screenId] || seen.has(group.screenId)) continue;
      seen.add(group.screenId);
      lines.push(`截图 ${group.ref ? `${group.ref} · ${group.screenId}` : group.screenId}：${imagePaths[group.screenId]}`);
    }
  }
  for (const group of report.groups) {
    lines.push('');
    lines.push(`## ${group.title}${group.detail ? ` · ${group.detail}` : ''}`);
    for (const row of group.rows) {
      if (row.kind === 'prose') {
        // sectionNumbers：CLI 给的节 id → 节号（文章页上的 §n），owner 说“第 2 节”时对得上。
        const num = row.section && report.sectionNumbers ? report.sectionNumbers[row.section] : null;
        lines.push([`[#${displayN(row)}]`, row.content, `· ${row.intent}`, `· ${row.status}`, row.section ? `· 节 ${num ? `§${num} ` : ''}${row.section}` : ''].filter(Boolean).join(' '));
        lines.push(`  引文：「${row.quote}」`);
        if (row.file) lines.push(`  源文件：${row.line ? `${row.file}:${row.line}` : `${row.file}（没有逐字匹配的行${row.section ? `，按节 ${row.section} 找` : ''}）`}`);
        for (const m of row.messages) lines.push(`  ${m.who}${m.at ? `（${shortTime(m.at)}）` : ''}：${m.text}`);
        continue;
      }
      const parts = [`[#${displayN(row)}]`, row.content, `· ${row.intent}`, `· ${row.status}`];
      if (row.docPath) parts.push(`· ${row.docPath}`);
      if (row.comp) parts.push(`· ${row.comp}（共用 ${row.sharedFrames} 帧）`);
      lines.push(parts.join(' '));
      if (row.excerpt && row.excerpt.length) {
        for (const line of row.excerpt) lines.push(`  ${line}`);
      }
      for (const m of row.messages || []) lines.push(`  ${m.who}${m.at ? `（${shortTime(m.at)}）` : ''}：${m.text}`);
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
  // 正文评论：落到文章源文件里引文所在的行。
  if (isProseRow(row)) {
    const section = row.section ? `，节 ${row.section}` : '';
    if (!context.article) return { n: row.n, text: `#${n} → 正文评论（${row.__docPath || '文章页'}${section}）` };
    const line = quoteSourceLine(readSourceOnce(context), row.quote, row.section);
    return { n: row.n, text: `#${n} → ${context.article.file}${line ? `:${line}` : ''}（正文评论${section}）` };
  }
  // doc 页（无 board.json 的 dir / file 条目）没有源码定位：给出账本的表面路径。
  if (context.docOnly) {
    const where = row.__docPath || '文档页';
    return { n: row.n, text: `#${n} → ${where}（这页不是编译页，没有源码定位）` };
  }
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
  const usage = comp ? compFrameUsage(context.distHtmlFor, outlineFrames(context.refs).map((frame) => frame.id))(comp) : 0;
  if (idMatch) {
    const tail = comp ? ` · 组件 ${comp}（共用 ${usage} 帧）` : '';
    return { n: row.n, text: `#${n} → ${idMatch[1]}:${idMatch[2]}${tail}` };
  }
  return {
    n: row.n,
    text: `#${n} → dist/${context.pageId}/${row.screenId}.html · ${(row.targets && row.targets[0] && row.targets[0].selector) || row.selector || ''}`,
  };
}
