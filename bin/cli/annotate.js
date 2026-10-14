import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { buildCheckReport, docFrameUrl, formatCheckMarkdown, loadPageContext, locateLine } from '../../src/server/lib/ann-query.js';
import { expandRefs, expandStatus, parseCrossRef, REF_STATUSES } from '../../src/server/lib/ann-refs.js';
import { listPageIds } from '../../src/server/lib/page-compiler.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { outlineFrames } from '../../src/workbench/lib/board-refs.js';

import fs from 'node:fs';

import { articleOutline } from '../../src/server/lib/article-canvas.js';
import { deriveArticleBoard } from '../../src/server/lib/article-board.js';
import { findProject } from '../../src/server/lib/projects.js';

import { DEFAULT_ORIGIN, REPO_ROOT, ioOf } from './core.js';
import { resolveRegistryPath } from './registry.js';
import { guardParse, reportUsageError, USAGE_EXIT, HELP } from './args.js';
import { loadAnnotateContext, pageIdKnown, printBucketOrphanStatus, reportMissingTarget } from './list.js';
import { displayAddress, letterNumber, normalizeRefToken, parseAddress, resolveAddress, sectionNumberOf, toPageRef } from './address.js';
import { addressContext, pickTarget, printCandidates } from './targets.js';
import { runValidate } from './validate.js';
import { ensureDist, ensureDistNote } from './dist.js';

const CHECK_STATUSES = new Set(['open', 'check', 'done', 'close', 'all']);
const CHECK_MODES = new Set(['excerpt', 'image', 'both']);
const GROUP_BYS = new Set(['frame', 'component']);

/** 服务没答时的那句话：隔离运行（设了 PINPOINT_ORIGIN）不能 `ppnt start`。 */
function serviceDown(origin, env, what) {
  return env.PINPOINT_ORIGIN
    ? `PINPOINT_ORIGIN=${origin} 那个服务没答；${what}，先把那个服务起起来（docs/registry.md“隔离运行”）。`
    : `pinpoint 服务未在跑（${origin}）；${what}，先 \`ppnt start\`。`;
}

/**
 * 引用（#n、#a-#b、@a:id、<页>#n）能指到的全部行：帧行、文档行，加上孤儿账本里的行。
 * comments 把孤儿单独列出来，agent 照着它回复、写状态，所以这些行也要能被 #n 指到；
 * 服务端点按账本 + 序号找行，不看画布，孤儿账本照样能写。--status 批量展开和帧 / 节展开
 * 只走活的行，孤儿不会被一句 `--status open` 顺手改掉。
 */
function addressableRows(context) {
  return [...context.frameRows, ...context.docRows, ...(context.orphanRows || [])];
}

/** `<页>#n` 跨页引用的行读取器（mark / reply 用；locate 另带每页上下文）。 */
function crossPageRowsFor(parsed, env) {
  const registryPath = resolveRegistryPath(parsed.flags, env);
  return (pageRef) => {
    const other = loadPageContext({ pageRef: String(toPageRef(pageRef)), registryPath, dataRootDir: dataRoot(env) });
    return other ? addressableRows(other) : [];
  };
}

/** 文章的节 id → 节号（正文评论那一行写 §n）。不是文章时 null。 */
function sectionNumbersOf(context) {
  if (!context.article) return null;
  let text = '';
  try {
    text = fs.readFileSync(context.article.file, 'utf8');
  } catch {
    return null;
  }
  return Object.fromEntries(articleOutline(text).filter((row) => row.id).map((row) => [row.id, row.n]));
}

/**
 * 一个页 id 的标注队列（comments 的本体，也是过渡期旧 check 的行为）。token 是目标写法，可带 #n。
 * printed = 实际打出了几条（project 级 comments 用它跳过空文章）。返回 { code, rows }。
 */
async function queueReport(token, parsed, { env, out, err }, { skipEmpty = false } = {}) {
  const status = parsed.flags.status || (parseAddress(token) && parseAddress(token).n ? 'all' : 'open');
  if (!CHECK_STATUSES.has(status)) {
    err(`错误：--status 只支持 ${[...CHECK_STATUSES].join(' / ')}，收到：${status}`);
    return { code: USAGE_EXIT, rows: 0 };
  }
  const mode = parsed.flags.mode || 'excerpt';
  if (!CHECK_MODES.has(mode)) {
    err(`错误：--mode 只支持 excerpt / image / both，收到：${mode}`);
    return { code: USAGE_EXIT, rows: 0 };
  }
  const groupBy = parsed.flags['group-by'] || 'frame';
  if (!GROUP_BYS.has(groupBy)) {
    err(`错误：--group-by 只支持 frame / component，收到：${groupBy}`);
    return { code: USAGE_EXIT, rows: 0 };
  }
  // `<目标>#n`：只看这一条（任何状态），页取 `#` 前面那段。
  const cross = parseCrossRef(toPageRef(token));
  const pageRef = cross ? cross.pageId : String(toPageRef(token));
  // 找不到页的报错先攒着：页不在了但桶还在（删了的页、删了或改了名的文章）时，
  // 和 status --page 一样把整桶列成孤儿，而不是只说找不到页。
  const pending = [];
  const context = loadAnnotateContext(pageRef, parsed, { env, err: (line) => pending.push(line) });
  if (!context) {
    if (!pageIdKnown(pageRef, parsed, { env }) && printBucketOrphanStatus(pageRef, { env, out })) return { code: 0, rows: 0 };
    for (const line of pending) err(line);
    return { code: USAGE_EXIT, rows: 0 };
  }
  // 源码摘录和截图读 dist：画布标注要摘录、dist 不在或落后时先编（不用先 ppnt build）。
  if (context.frameRows.length && !context.docOnly) {
    const note = ensureDistNote(await ensureDist(context.target, { distRoot: path.join(dataRoot(env), 'dist') }), context.address);
    if (note) err(note);
  }
  if (cross) {
    const keep = (row) => Number(row.n) === cross.n;
    if (!addressableRows(context).some(keep)) {
      err(`错误：${context.address} 没有 #${cross.n}`);
      return { code: 1, rows: 0 };
    }
    context.frameRows = context.frameRows.filter(keep);
    context.docRows = context.docRows.filter(keep);
    context.orphanRows = (context.orphanRows || []).filter(keep);
  }
  const frameRef = parsed.flags.frame ? normalizeRefToken(parsed.flags.frame) : null;
  const report = buildCheckReport(context, { frame: frameRef, status, groupBy, mode });
  if (report.error) {
    err(`错误：${report.error}`);
    return { code: 1, rows: 0 };
  }
  report.address = context.address;
  const sectionNumbers = sectionNumbersOf(context);
  if (sectionNumbers) report.sectionNumbers = sectionNumbers;
  const rowCount = report.groups.reduce((sum, group) => sum + group.rows.length, 0);
  if (skipEmpty && !rowCount) return { code: 0, rows: 0, report };
  let imagePaths = null;
  if (mode === 'image' || mode === 'both') {
    const statusAllows = (row) => status === 'all' || (row.status || 'open') === status;
    const screenIds = [...new Set(report.groups.filter((group) => group.kind === 'frame' && !group.offBoard).map((group) => group.screenId))];
    if (screenIds.length) {
      const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
      let renderShots;
      try {
        ({ renderShots } = await import('../ppnt-shot.js'));
      } catch (error) {
        err(`错误：渲染器加载失败：${error.message}`);
        return { code: 1, rows: 0 };
      }
      const tabOfScreen = new Map(outlineFrames(context.refs).filter((frame) => frame.tabId).map((frame) => [frame.id, frame.tabId]));
      const jobs = screenIds.map((screenId) => ({
        kind: 'frame',
        screenId,
        ...(tabOfScreen.has(screenId) ? { tabId: tabOfScreen.get(screenId) } : {}),
        scale: 1,
        out: path.join(dataRoot(env), 'check', context.pageId, `${screenId}.png`),
        marks: context.frameRows.filter((row) => row.screenId === screenId && (row.status || 'open') !== 'close' && statusAllows(row)),
      }));
      try {
        await renderShots({ origin, pageId: context.pageId, jobs, env });
        imagePaths = Object.fromEntries(jobs.map((job) => [job.screenId, job.out]));
      } catch (error) {
        err(`错误：${error.message}`);
        return { code: 1, rows: 0 };
      }
    }
  }
  report.images = imagePaths;
  if (!parsed.flags.json) for (const line of formatCheckMarkdown(report, { imagePaths })) out(line);
  return { code: 0, rows: rowCount, report };
}

/**
 * `ppnt comments <目标>`：标注队列（画布标注 + 正文评论）。目标是一篇文章、一个存量页，
 * 或整个 project（逐篇列出有条目的文章，最后一行汇总）。
 */
export async function runComments(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  return commentsFor(parsed.target, parsed, ioOf(io));
}

async function commentsFor(token, parsed, { env, out, err }) {
  const ctx = addressContext(parsed.flags, env);
  const hit = resolveAddress(token, ctx);
  if (hit && hit.kind === 'project') {
    if (parsed.flags.frame) return reportUsageError('comments', '--frame 要指定一篇文章：ppnt comments <project>/<article> --frame B1', err);
    const project = findProject(ctx.registry, hit.projectId);
    const reports = [];
    let shown = 0;
    for (const article of project.articles) {
      const buffer = [];
      const result = await queueReport(`${project.id}/${article.id}`, parsed, { env, out: (line) => buffer.push(line), err }, { skipEmpty: true });
      if (result.code) return result.code;
      if (result.report) reports.push(result.report);
      if (!result.rows) continue;
      if (shown) out('');
      for (const line of buffer) out(line);
      shown += 1;
    }
    const status = parsed.flags.status || 'open';
    if (parsed.flags.json) {
      out(JSON.stringify({ project: project.id, status, articles: reports }, null, 2));
      return 0;
    }
    if (shown) out('');
    out(`project ${project.id}：${project.articles.length} 篇文章，${shown} 篇有 ${status} 的条目`);
    return 0;
  }
  const result = await queueReport(token, parsed, { env, out, err });
  if (!result.code && parsed.flags.json && result.report) out(JSON.stringify(result.report, null, 2));
  return result.code;
}

/** 过渡期：这些写法是旧的 `check`（列标注队列），照旧列出，另打一行指向 comments。 */
function isLegacyCheck(parsed, env) {
  if (['frame', 'status', 'mode', 'group-by'].some((name) => parsed.flags[name] !== undefined)) return true;
  const token = String(parsed.target || '');
  const address = parseAddress(token);
  if (address && address.n) return true;
  if (token.includes('/')) return false;
  // 页 id 形 <project>_<article>（不管文章还在不在）是旧写法。
  if (address && address.kind === 'article') return true;
  const hit = resolveAddress(token, addressContext(parsed.flags, env));
  if (hit && hit.kind === 'page') return true;
  // 不是页也不是 project，但桶还在（删掉的页）：旧 check 报整桶孤儿。
  return !hit && fs.existsSync(path.join(dataRoot(env), String(toPageRef(token))));
}

/**
 * `ppnt check <project>[/<article>]`：验证（validate.js）。过渡期里旧用法（见 isLegacyCheck）照旧列
 * 标注队列，并在 stderr 打一行提示，stdout 不变（--json 照样能解析）。
 */
export async function runCheck(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { cwd, env, out, err } = ioOf(io);
  if (isLegacyCheck(parsed, env)) {
    const shown = displayAddress(String(toPageRef(parsed.target)).replace(/#\d+$/, ''));
    err(`提示：check 现在是验证；列标注和评论改用 \`ppnt comments ${shown}\`（这次照旧列出）。`);
    return commentsFor(parsed.target, parsed, { env, out, err });
  }
  return runValidate(parsed, { env, out, err, cwd });
}

/** 文章的全部节（纯文字的也在），读不到时 []。 */
function outlineOf(context) {
  if (!context.article) return [];
  try {
    return articleOutline(fs.readFileSync(context.article.file, 'utf8'));
  } catch {
    return [];
  }
}

/** 一枚节引用（§2、字母、节 id）对上文章的哪一节；不是节引用返回 null。 */
function articleSectionOf(token, outline) {
  const raw = String(token || '').trim();
  const n = sectionNumberOf(raw);
  if (n) return outline.find((row) => row.n === n) || { missing: true, n };
  return outline.find((row) => row.letter === raw || (row.id && row.id === raw)) || null;
}

/**
 * locate / mark 的引用预处理：`<project>/<article>#3` 换成页 id 形，`§2` 换成字母；
 * 指到纯文字节（画布上没有这一行）的节引用直接展开成这一节的正文评论。
 * → { tokens（交给 expandRefs）, picks（已展开的）, errors, empty（对上了但没有评论的节）}
 */
function prepareRefs(refs, context) {
  const outline = outlineOf(context);
  const onCanvas = new Set((context.refs.outline || []).map((section) => section.id));
  const tokens = [];
  const picks = [];
  const errors = [];
  const empty = [];
  for (const ref of refs) {
    const section = outline.length ? articleSectionOf(ref, outline) : null;
    if (section && section.missing) {
      errors.push(`${ref}：这篇文章只有 ${outline.length} 节`);
      continue;
    }
    if (section && section.id && !onCanvas.has(section.id)) {
      const rows = [...context.frameRows, ...context.docRows].filter((row) => row.type === 'prose' && row.section === section.id);
      if (!rows.length) empty.push(`${ref}：${section.letter}（§${section.n} ${section.id}）暂无评论`);
      for (const row of rows) picks.push({ kind: 'annotation', row, via: ref });
      continue;
    }
    tokens.push(normalizeRefToken(ref));
  }
  return { tokens, picks, errors, empty };
}

/** locate / shot / mark / reply 的目标与上下文；失败时已报错，返回 { code }。 */
function targetContext(parsed, { env, err }, command) {
  const picked = pickTarget(parsed, { env, err, command, usage: HELP[command].usage });
  if (picked.error) return { code: USAGE_EXIT };
  const context = loadAnnotateContext(picked.pageRef, parsed, { env, err });
  if (!context) return { code: USAGE_EXIT };
  return { context, refs: picked.refs };
}

export async function runLocate(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  if (parsed.flags.status && !REF_STATUSES.includes(parsed.flags.status)) {
    return reportUsageError('locate', `--status 只支持 ${REF_STATUSES.join(' / ')}，收到：${parsed.flags.status}`, err);
  }
  const got = targetContext(parsed, { env, err }, 'locate');
  if (!got.context) return got.code;
  const { context } = got;
  if (!got.refs.length && !parsed.flags.status) {
    return reportUsageError('locate', 'locate 要至少一个引用（#n、B3、§2、帧 id …）或 --status', err);
  }
  // 源码定位读 dist：不在或落后时先编。
  if (context.frameRows.length && !context.docOnly) {
    const note = ensureDistNote(await ensureDist(context.target, { distRoot: path.join(dataRoot(env), 'dist') }), context.address);
    if (note) err(note);
  }
  const rows = [...context.frameRows, ...context.docRows];
  // 别页的行按它自己的页上下文定位（源文件、板、文章都跟着页走）。
  const contexts = new Map([[context.pageId, context]]);
  const contextOf = (pageRef) => {
    if (!contexts.has(pageRef)) contexts.set(pageRef, loadAnnotateContext(pageRef, parsed, { env, err: () => {} }));
    return contexts.get(pageRef);
  };
  const crossPageRows = (pageRef) => {
    const other = contextOf(pageRef);
    return other ? addressableRows(other) : [];
  };
  const refCtx = { rows: addressableRows(context), board: context.board, pageId: context.pageId, crossPageRows };
  const prepared = prepareRefs(got.refs, context);
  const { picks, errors, empty } = expandRefs(prepared.tokens, refCtx);
  picks.unshift(...prepared.picks);
  errors.unshift(...prepared.errors);
  empty.unshift(...prepared.empty);
  if (parsed.flags.status) {
    for (const row of expandStatus(parsed.flags.status, rows)) picks.push({ kind: 'annotation', row, via: `--status ${parsed.flags.status}` });
  }
  for (const error of errors) err(`错误：${error}`);
  const seen = new Set();
  const located = [];
  const addRow = (row) => {
    const key = `${row.__bucket}|${row.__ledger}|${row.id || row.n}`;
    if (seen.has(key)) return;
    seen.add(key);
    const line = locateLine(row, (row.__bucket && contextOf(row.__bucket)) || context);
    const where = line.text.match(/→ ([^\s（]+?\.(?:jsx|mdx|html|js|css)):(\d+)/);
    located.push({
      n: row.n,
      type: row.type === 'prose' ? 'prose' : 'canvas',
      status: row.status || 'open',
      ...(row.screenId ? { frame: row.screenId } : {}),
      ...(row.section ? { section: row.section } : {}),
      ...(where ? { file: where[1], line: Number(where[2]) } : {}),
      text: line.text,
    });
  };
  for (const pick of picks) {
    if (pick.kind === 'annotation') addRow(pick.row);
    else if (pick.kind === 'frame') for (const row of rows.filter((row) => row.screenId === pick.screenId)) addRow(row);
    else if (pick.kind === 'section') for (const row of rows.filter((row) => pick.frames.some((frame) => frame.id === row.screenId))) addRow(row);
  }
  if (parsed.flags.json) {
    out(JSON.stringify({ target: context.address, rows: located, empty, errors }, null, 2));
  } else {
    for (const row of located) out(row.text);
    // 帧或节上没有标注：如实说一句，不算失败。
    for (const line of empty) out(line);
  }
  return errors.length ? 1 : 0;
}

/**
 * shot 的作业规划（纯函数，2026-09-23 页引用修复时抽出）：picks → 渲染作业。
 * 帧按 screenId 去重；段整段一图；页引用出整页一图。页 id 不必是基页（<页>
 * 语义），非基页经 contextFor 现场装载该页上下文 —— marks 与输出目录都跟着
 * 页走。渲染按页分组：一次 renderShots 只动一个画布页（ppnt-shot 的
 * setActivePage 是会话级的）。
 */
export function planShotJobs(picks, { basePageId, baseContext, scale, withMarks, contextFor, dataRootDir }) {
  const jobs = [];
  const problems = [];
  const contexts = new Map([[basePageId, baseContext]]);
  const contextOf = (pageId) => {
    if (!contexts.has(pageId)) contexts.set(pageId, contextFor ? contextFor(pageId) : null);
    return contexts.get(pageId);
  };
  const shotDirOf = (pageId) => path.join(dataRootDir, 'shot', pageId);
  const openRows = (ctx) => ctx.frameRows.filter((row) => (row.status || 'open') !== 'close');
  const seenScreens = new Set();
  // 产物按不变的 id 命名（编号会随 board 调序漂移）；打印时编号与 id 并列。
  const frameRefById = new Map();
  const multiTab = ((baseContext.refs && baseContext.refs.tabs) || []).length >= 2;
  if (baseContext.refs) for (const frame of outlineFrames(baseContext.refs)) if (!frameRefById.has(frame.id)) frameRefById.set(frame.id, multiTab && frame.tabId ? `${frame.tabId}:${frame.ref}` : frame.ref);
  const frameRefOf = (screenId) => frameRefById.get(screenId) || '';
  // 页 tab（ADR 0041）：工作台只挂活动 tab，渲染端拍每一份之前要先切到目标所在的 tab。
  // 帧 / 段的 tab 从引用号表里查，整页引用见下面“逐 tab 各拍一张”。
  const tabOfFrame = new Map();
  if (baseContext.refs) for (const frame of outlineFrames(baseContext.refs)) if (frame.tabId) tabOfFrame.set(frame.id, frame.tabId);
  const withTab = (tabId) => (tabId ? { tabId } : {});
  // 文章的文档帧（HTML 帧）不在画布上：直接打开它自己的地址，按手机宽度拍整页（ppnt-shot 的 renderDocShots）。
  const docUrlOf = (screenId) => (baseContext.article && baseContext.board && baseContext.target
    ? docFrameUrl(baseContext.board, baseContext.target.urlBase, screenId)
    : null);
  const frameJob = (screenId) => {
    if (seenScreens.has(screenId)) return;
    seenScreens.add(screenId);
    const docUrl = docUrlOf(screenId);
    if (docUrl) {
      jobs.push({
        kind: 'doc',
        pageId: basePageId,
        screenId,
        url: docUrl,
        scale,
        label: [frameRefOf(screenId), screenId].filter(Boolean).join(' · '),
        out: path.join(shotDirOf(basePageId), `${screenId}.png`),
        marks: withMarks ? openRows(baseContext).filter((row) => row.screenId === screenId) : [],
      });
      return;
    }
    jobs.push({
      kind: 'frame',
      pageId: basePageId,
      screenId,
      ...withTab(tabOfFrame.get(screenId)),
      scale,
      label: [frameRefOf(screenId), screenId].filter(Boolean).join(' · '),
      out: path.join(shotDirOf(basePageId), `${screenId}.png`),
      marks: withMarks
        ? openRows(baseContext).filter((row) => row.screenId === screenId)
        : [],
    });
  };
  for (const pick of picks) {
    if (pick.kind === 'frame') frameJob(pick.screenId);
    else if (pick.kind === 'annotation' && pick.row.screenId) frameJob(pick.row.screenId);
    else if (pick.kind === 'section') {
      // 文章：节里的文档帧各拍一张；节里没有画布上的帧时不拍节图。
      const docFrames = pick.frames.filter((frame) => docUrlOf(frame.id));
      for (const frame of docFrames) frameJob(frame.id);
      if (docFrames.length && docFrames.length === pick.frames.length) continue;
      jobs.push({
        kind: 'section',
        pageId: basePageId,
        sectionId: pick.sectionId,
        ...withTab(pick.tabId),
        scale,
        // 文章：B（§2 confirm）——编号、文章页上的节号、节 id 并列。
        label: baseContext.article && pick.ref
          ? `${pick.ref}（§${letterNumber(pick.ref)} ${pick.sectionId}）`
          : [pick.ref, pick.sectionId].filter(Boolean).join(' · '),
        out: path.join(shotDirOf(basePageId), `${pick.sectionId}.png`),
        marks: withMarks
          ? openRows(baseContext).filter((row) => pick.frames.some((frame) => frame.id === row.screenId))
          : [],
      });
    } else if (pick.kind === 'page') {
      const pageContext = contextOf(pick.pageId);
      if (!pageContext) {
        problems.push(`错误：找不到页：${pick.pageId}`);
        continue;
      }
      // 多 tab 页：逐 tab 各拍一张（一图装不下互不相干的几块画布）；产物 <页>--<tab>.png。
      // 单 tab / 存量页一张图，路径同从前。
      const pageTabs = (pageContext.refs && pageContext.refs.tabs) || [];
      if (pageTabs.length >= 2) {
        for (const tab of pageTabs) {
          jobs.push({
            kind: 'page',
            pageId: pageContext.pageId,
            tabId: tab.id,
            scale,
            label: `${pageContext.pageId} · ${tab.id}`,
            out: path.join(shotDirOf(pageContext.pageId), `${pageContext.pageId}--${tab.id}.png`),
            marks: withMarks ? openRows(pageContext) : [],
          });
        }
        continue;
      }
      jobs.push({
        kind: 'page',
        pageId: pageContext.pageId,
        scale,
        label: pageContext.article ? `${displayAddress(pageContext.pageId)} 画布视图` : pageContext.pageId,
        out: path.join(shotDirOf(pageContext.pageId), `${pageContext.pageId}.png`),
        marks: withMarks ? openRows(pageContext) : [],
      });
    }
  }
  return { jobs, problems };
}

/**
 * `ppnt shot <project>/<article> --figure <图 id>`：拍正文里的一个图，浅色、深色各一张（renderFigureShots）。
 * 目标照 shot 的规则解析（第一个参数，或 --page）；图不和帧、节的引用混用。
 * 图编译失败、在浏览器里运行出错时打出原因、退 1。
 */
async function shotFigure(context, refs, { env, out, err, scale, figureId, json = false }) {
  if (refs.length) {
    return reportUsageError('shot', `--figure 只拍一个图，不和引用（${refs.join(' ')}）一起用：ppnt shot <project>/<article> --figure <图 id>`, err);
  }
  if (!context.article) {
    err(`错误：${displayAddress(context.pageId)} 是存量页，没有正文里的图；--figure 的目标写 <project>/<article>。`);
    return USAGE_EXIT;
  }
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  let renderFigureShots;
  try {
    ({ renderFigureShots } = await import('../ppnt-shot.js'));
  } catch (error) {
    err(`错误：渲染器加载失败：${error.message}`);
    return 1;
  }
  const pageId = context.pageId;
  let results;
  try {
    results = await renderFigureShots({ origin, pageId, figureId, scale, env, outBase: path.join(dataRoot(env), 'shot', pageId, `figure-${figureId}`) });
  } catch (error) {
    err(`错误：${error.message}`);
    return 1;
  }
  let failed = false;
  for (const result of results) {
    if (!json) out(`图 ${figureId} · ${result.theme === 'light' ? '浅色' : '深色'} → ${result.out} · ${result.width}×${result.height}`);
    for (const message of result.errors) {
      failed = true;
      err(`  出错：${message}`);
    }
  }
  if (json) {
    out(JSON.stringify({
      target: context.address,
      shots: results.map((result) => ({ kind: 'figure', figure: figureId, theme: result.theme, out: result.out, width: result.width, height: result.height, errors: result.errors })),
    }, null, 2));
  }
  return failed ? 1 : 0;
}

/**
 * shot 的文章页作业（纯函数）：不写引用 = 文章页整页；§n = 文章页上那一节；字母 / 节 id 指到纯文字节
 * （画布上没有这一行）也截文章页上那一节。其余引用留给画布。
 * → { articleJobs, canvasTokens, errors }
 */
export function planArticleShots(refs, { context, outline, origin, dataRootDir, scale, canvas }) {
  const articleJobs = [];
  const canvasTokens = [];
  const errors = [];
  const shotDir = path.join(dataRootDir, 'shot', context.pageId);
  const url = `${origin}${context.article.url}`;
  const onCanvas = new Set((context.refs.outline || []).map((section) => section.id));
  for (const ref of refs) {
    const n = sectionNumberOf(ref);
    const section = articleSectionOf(ref, outline);
    if (section && section.missing) {
      errors.push(`${ref}：这篇文章只有 ${outline.length} 节`);
      continue;
    }
    if (section && section.id && (n || !onCanvas.has(section.id))) {
      articleJobs.push({
        kind: 'article-section',
        url,
        sectionId: section.id,
        scale,
        label: `${section.letter}（§${section.n} ${section.id}）文章页`,
        out: path.join(shotDir, `article-${section.id}.png`),
      });
      continue;
    }
    canvasTokens.push(normalizeRefToken(ref));
  }
  if (!refs.length && !canvas) {
    articleJobs.push({ kind: 'article', url, scale, label: `${context.address} 文章页`, out: path.join(shotDir, 'article.png') });
  }
  return { articleJobs, canvasTokens, errors };
}

/** 截到的文章页没有正文结尾时的那句话。 */
export function truncatedWarning(address) {
  return `文章页在正文中途断了（页面里没有正文结尾标记），正文多半渲染出错；跑 ppnt check ${address} 看是哪一行`;
}

/** 正文里图的 id（读不出正文时 []）。 */
function figureIdsOf(context) {
  try {
    return deriveArticleBoard(context.target).figures.map((figure) => figure.id).filter(Boolean);
  } catch {
    return [];
  }
}

export async function runShot(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const scale = Number(parsed.flags.scale || 1);
  if (scale !== 1 && scale !== 2) {
    return reportUsageError('shot', `--scale 只支持 1 或 2，收到：${parsed.flags.scale || '(空)'}`, err);
  }
  const timeoutSec = parsed.flags.timeout === undefined ? 60 : Number(parsed.flags.timeout);
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    return reportUsageError('shot', `--timeout 要一个正数（秒），收到：${parsed.flags.timeout}`, err);
  }
  const got = targetContext(parsed, { env, err }, 'shot');
  if (!got.context) return got.code;
  const { context } = got;
  if (parsed.flags.figure) return shotFigure(context, got.refs, { env, out, err, scale, figureId: parsed.flags.figure, json: !!parsed.flags.json });
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  const rows = [...context.frameRows, ...context.docRows];
  let refs = got.refs;
  let articleJobs = [];
  const errors = [];
  if (context.article) {
    const plan = planArticleShots(refs, { context, outline: outlineOf(context), origin, dataRootDir: dataRoot(env), scale, canvas: !!parsed.flags.canvas });
    articleJobs = plan.articleJobs;
    refs = plan.canvasTokens;
    errors.push(...plan.errors);
  } else {
    refs = refs.map(normalizeRefToken);
  }
  // 画布视图整页：--canvas，或存量页不写引用（从前的 shot <页>）。
  if (parsed.flags.canvas || (!context.article && !got.refs.length && !parsed.flags.status)) refs = [context.pageId, ...refs];
  // 页引用（<页>）对照登记页 id 清单解析 —— 基页之外，页引用自己可以指向任何登记页。
  const registry = loadRegistry({ root: REPO_ROOT, path: resolveRegistryPath(parsed.flags, env) });
  const pageIds = listPageIds({ registry, root: REPO_ROOT });
  const expanded = expandRefs(refs, { rows, board: context.board, pageId: context.pageId, pageIds, crossPageRows: null }, { shotRefs: true });
  const picks = expanded.picks;
  errors.push(...expanded.errors);
  // 写成引用的图 id：图不在画布上，指向 --figure（不把位置参数当图，帧、节和图可以同名）。
  if (context.article && expanded.errors.length) {
    for (const id of figureIdsOf(context)) {
      if (refs.includes(id)) errors.push(`${id} 是正文里的图，不在画布上：ppnt shot ${context.address} --figure ${id}`);
    }
  }
  if (parsed.flags.status) {
    if (!REF_STATUSES.includes(parsed.flags.status)) {
      return reportUsageError('shot', `--status 只支持 ${REF_STATUSES.join(' / ')}，收到：${parsed.flags.status}`, err);
    }
    for (const screenId of [...new Set(expandStatus(parsed.flags.status, rows).map((row) => row.screenId).filter(Boolean))]) {
      picks.push({ kind: 'frame', screenId, via: screenId });
    }
  }
  for (const error of errors) err(error);
  const plan = planShotJobs(picks, {
    basePageId: context.pageId,
    baseContext: context,
    scale,
    withMarks: !!parsed.flags.marks,
    contextFor: (pageId) => loadAnnotateContext(pageId, parsed, { env, err }),
    dataRootDir: dataRoot(env),
  });
  for (const problem of plan.problems) err(problem);
  const jobs = plan.jobs;
  if (!jobs.length && !articleJobs.length) {
    err('没有可拍的目标（引用都未命中）。');
    return 1;
  }
  let renderer;
  try {
    renderer = await import('../ppnt-shot.js');
  } catch (error) {
    err(`错误：渲染器加载失败：${error.message}`);
    return 1;
  }
  const byPage = new Map();
  const docJobs = jobs.filter((job) => job.kind === 'doc');
  for (const job of jobs.filter((row) => row.kind !== 'doc')) {
    if (!byPage.has(job.pageId)) byPage.set(job.pageId, []);
    byPage.get(job.pageId).push(job);
  }
  const shots = [];
  const print = (result, kind) => {
    shots.push({ kind, label: result.label || '', out: result.out, width: result.width, height: result.height, ...(result.truncated ? { truncated: true } : {}) });
    if (!parsed.flags.json) out(`${result.label ? `${result.label} → ` : ''}${result.out} · ${result.width}×${result.height}`);
  };
  const warnings = [];
  try {
    if (articleJobs.length) {
      for (const result of await renderer.renderArticleShots({ origin, jobs: articleJobs, timeoutMs: timeoutSec * 1000, env })) print(result, 'article');
    }
    if (docJobs.length) {
      for (const result of await renderer.renderDocShots({ origin, jobs: docJobs, env })) print(result);
    }
    for (const [pageId, group] of byPage) {
      for (const result of await renderer.renderShots({ origin, pageId, jobs: group, env })) print(result, 'canvas');
    }
  } catch (error) {
    err(`错误：${error.message}`);
    return 1;
  }
  // 文章页没渲染到正文结尾（站点在正文结尾放了 data-pp-article-end）：图是截了，但正文多半渲染出错。
  if (shots.some((shot) => shot.truncated)) {
    warnings.push(truncatedWarning(context.address));
    err(`注意：${warnings[warnings.length - 1]}`);
  }
  if (parsed.flags.json) out(JSON.stringify({ target: context.address, shots, warnings, errors: [...errors, ...plan.problems] }, null, 2));
  return errors.length || plan.problems.length || warnings.length ? 1 : 0;
}

export async function runMark(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err, requestFn } = ioOf(io);
  if (parsed.statusWord === 'close') {
    return reportUsageError('mark', 'close 只在工作台（owner 单击验收，带 toast 撤销）；ppnt mark 不接受 close。', err);
  }
  if (parsed.statusWord === 'open') {
    return reportUsageError('mark', 'open 由工作台编辑触发，mark 不写；ppnt mark 只写 check / done。', err);
  }
  if (!['done', 'check'].includes(parsed.statusWord)) {
    return reportUsageError('mark', `状态只支持 done | check，收到：${parsed.statusWord}`, err);
  }
  if (parsed.flags.note !== undefined && !String(parsed.flags.note).trim()) return reportUsageError('mark', '--note 的内容是空的', err);
  if (parsed.flags.status && !REF_STATUSES.includes(parsed.flags.status)) {
    return reportUsageError('mark', `--status 只支持 ${REF_STATUSES.join(' / ')}，收到：${parsed.flags.status}`, err);
  }
  const got = targetContext(parsed, { env, err }, 'mark');
  if (!got.context) return got.code;
  const { context } = got;
  if (!got.refs.length && !parsed.flags.status) return reportUsageError('mark', 'mark 要至少一个引用（#n、B3、§2 …）', err);
  const crossPageRows = crossPageRowsFor(parsed, env);
  const rows = [...context.frameRows, ...context.docRows];
  const prepared = prepareRefs(got.refs, context);
  const { picks, errors, empty } = expandRefs(prepared.tokens, { rows: addressableRows(context), board: context.board, pageId: context.pageId, crossPageRows });
  picks.unshift(...prepared.picks);
  errors.unshift(...prepared.errors);
  empty.unshift(...prepared.empty);
  if (parsed.flags.status) {
    for (const row of expandStatus(parsed.flags.status, rows)) picks.push({ kind: 'annotation', row, via: `--status ${parsed.flags.status}` });
  }
  for (const error of errors) err(`错误：${error}`);
  for (const line of empty) err(line);
  const annotationPicks = picks.filter((pick) => pick.kind === 'annotation');
  if (!annotationPicks.length) {
    err('错误：没有命中的标注。');
    return 1;
  }
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  try {
    const health = await requestFn(`${origin}/health`);
    if (health.status !== 200) throw new Error(`health ${health.status}`);
  } catch {
    err(`错误：${serviceDown(origin, env, 'mark 写状态走服务端点')}`);
    return 1;
  }
  let failed = 0;
  const results = [];
  const say = (line) => { if (!parsed.flags.json) out(line); };
  const note = parsed.flags.note ? String(parsed.flags.note).trim() : '';
  for (const pick of annotationPicks) {
    const row = pick.row;
    // storage-unify：#n 只在本页桶里解析（桶名恒等于页），不再需要桶名消歧。
    const label = `#${row.n}`;
    // --note：先在线程里回一句（状态不动），再写状态；回复失败就不写状态，免得 owner 看到状态却没有说明。
    if (note) {
      const replied = await postAnnotation(origin, row, 'reply', { text: note }, requestFn);
      if (!replied.ok) {
        failed += 1;
        say(`${label} ✗ 回复没写进去：${replied.reason}（状态没改）`);
        results.push({ n: row.n, ok: false, error: `reply ${replied.reason}` });
        continue;
      }
    }
    const res = await postAnnotation(origin, row, 'status', { status: parsed.statusWord }, requestFn);
    if (res.ok) {
      say(`${label} → ${parsed.statusWord}${note ? `，线程里回了：${note}` : ''}`);
      results.push({ n: row.n, ok: true, status: parsed.statusWord, ...(note ? { note } : {}) });
    } else {
      failed += 1;
      say(`${label} ✗ ${res.reason}${note ? '（回复已写进线程，状态没改）' : ''}`);
      results.push({ n: row.n, ok: false, error: res.reason, ...(note ? { note } : {}) });
    }
  }
  if (parsed.flags.json) out(JSON.stringify({ target: context.address, status: parsed.statusWord, results, errors, empty }, null, 2));
  return failed || errors.length ? 1 : 0;
}

/**
 * 写一条标注：action 'status' | 'reply'，带上现读的 baseRevision。
 * → { ok: true, json } | { ok: false, reason }。
 */
async function postAnnotation(origin, row, action, body, requestFn) {
  try {
    const doc = await requestFn(`${origin}/annotations/${encodeURIComponent(row.__ledger)}?entry=${encodeURIComponent(row.__bucket)}`);
    const baseRevision = doc.json && Number.isFinite(Number(doc.json.revision)) ? Number(doc.json.revision) : null;
    const res = await requestFn(`${origin}/annotations/${encodeURIComponent(row.__ledger)}/${row.n}/${action}`, {
      method: 'POST',
      body: { entry: row.__bucket, baseRevision, ...body },
    });
    if (res.status === 200) return { ok: true, json: res.json };
    const detail = res.json && res.json.detail ? `：${res.json.detail}` : '';
    return { ok: false, reason: `${res.status} ${res.json && res.json.error ? res.json.error : ''}${detail}`.trim() };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export async function runReply(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err, requestFn } = ioOf(io);
  const text = String(parsed.text || '').trim();
  if (!text) return reportUsageError('reply', '回复内容是空的。', err);
  const got = targetContext(parsed.target ? { ...parsed, flags: { ...parsed.flags, page: parsed.flags.page || parsed.target } } : parsed, { env, err }, 'reply');
  if (!got.context) return got.code;
  const { context } = got;
  const crossPageRows = crossPageRowsFor(parsed, env);
  const { picks, errors } = expandRefs(got.refs.map(normalizeRefToken), { rows: addressableRows(context), board: context.board, pageId: context.pageId, crossPageRows });
  for (const error of errors) err(error);
  const annotationPicks = picks.filter((pick) => pick.kind === 'annotation');
  if (annotationPicks.length !== 1) {
    if (!errors.length) err(annotationPicks.length ? '错误：reply 一次只回一条，引用命中了多条（回复并改状态用 ppnt mark … --note）。' : '错误：没有命中的标注。');
    return 1;
  }
  const row = annotationPicks[0].row;
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  try {
    const health = await requestFn(`${origin}/health`);
    if (health.status !== 200) throw new Error(`health ${health.status}`);
  } catch {
    err(`错误：${serviceDown(origin, env, 'reply 走服务端点')}`);
    return 1;
  }
  const res = await postAnnotation(origin, row, 'reply', { text }, requestFn);
  if (!res.ok) {
    if (parsed.flags.json) out(JSON.stringify({ target: context.address, n: row.n, ok: false, error: res.reason }, null, 2));
    else out(`#${row.n} ✗ ${res.reason}`);
    return 1;
  }
  const status = res.json && res.json.annotation ? res.json.annotation.status : row.status;
  if (parsed.flags.json) out(JSON.stringify({ target: context.address, n: row.n, ok: true, status: status || 'open', text }, null, 2));
  else out(`#${row.n} ← agent：${text}（状态仍是 ${status || 'open'}）`);
  return 0;
}
