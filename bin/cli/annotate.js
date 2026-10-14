import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { buildCheckReport, formatCheckMarkdown, loadPageContext, locateLine } from '../../src/server/lib/ann-query.js';
import { expandRefs, expandStatus, parseCrossRef, REF_STATUSES } from '../../src/server/lib/ann-refs.js';
import { listPageIds } from '../../src/server/lib/page-compiler.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { outlineFrames } from '../../src/workbench/lib/board-refs.js';

import { DEFAULT_ORIGIN, REPO_ROOT, ioOf } from './core.js';
import { resolveRegistryPath } from './registry.js';
import { guardParse } from './args.js';
import { loadAnnotateContext, pageIdKnown, printBucketOrphanStatus } from './list.js';

const CHECK_STATUSES = new Set(['open', 'check', 'done', 'close', 'all']);
const CHECK_MODES = new Set(['excerpt', 'image', 'both']);
const GROUP_BYS = new Set(['frame', 'component']);

/** locate / shot / mark / reply 的基页：--page 优先；没给时引用里第一个 `<页>#n` 的页
    （文章页 `<project>_<article>#3` 也一样）；都没有取 registry 第一个可编译页。 */
function pageRefFor(parsed, { env, err }) {
  if (parsed.target) return parsed.target;
  if (parsed.flags.page) return parsed.flags.page;
  const cross = (parsed.refs || []).map(parseCrossRef).find(Boolean);
  if (cross) return cross.pageId;
  const registryPath = resolveRegistryPath(parsed.flags, env);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath });
  const first = listPageIds({ registry, root: REPO_ROOT })[0];
  if (!first) err('错误：registry 里没有可编译页；用 --page <页 id> 指定。');
  return first || null;
}

/** `<页>#n` 跨页引用的行读取器（mark / reply 用；locate 另带每页上下文）。 */
function crossPageRowsFor(parsed, env) {
  const registryPath = resolveRegistryPath(parsed.flags, env);
  return (pageRef) => {
    const other = loadPageContext({ pageRef, registryPath, dataRootDir: dataRoot(env) });
    return other ? [...other.frameRows, ...other.docRows] : [];
  };
}

export async function runCheck(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const status = parsed.flags.status || (parseCrossRef(parsed.target) ? 'all' : 'open');
  if (!CHECK_STATUSES.has(status)) {
    err(`错误：--status 只支持 ${[...CHECK_STATUSES].join(' / ')}，收到：${status}`);
    return 1;
  }
  const mode = parsed.flags.mode || 'excerpt';
  if (!CHECK_MODES.has(mode)) {
    err(`错误：--mode 只支持 excerpt / image / both，收到：${mode}`);
    return 1;
  }
  const groupBy = parsed.flags['group-by'] || 'frame';
  if (!GROUP_BYS.has(groupBy)) {
    err(`错误：--group-by 只支持 frame / component，收到：${groupBy}`);
    return 1;
  }
  // `check <页>#n`：只看这一条（任何状态），页取 `#` 前面那段。
  const cross = parseCrossRef(parsed.target);
  const pageRef = cross ? cross.pageId : parsed.target;
  // 找不到页的报错先攒着：页不在了但桶还在（删了的页、删了或改了名的文章）时，
  // 和 status --page 一样把整桶列成孤儿，而不是只说找不到页。
  const pending = [];
  const context = loadAnnotateContext(pageRef, parsed, { env, err: (line) => pending.push(line) });
  if (!context) {
    if (!pageIdKnown(pageRef, parsed, { env }) && printBucketOrphanStatus(pageRef, { env, out })) return 0;
    for (const line of pending) err(line);
    return 1;
  }
  if (cross) {
    const keep = (row) => Number(row.n) === cross.n;
    if (![...context.frameRows, ...context.docRows].some(keep)) {
      err(`错误：${pageRef} 没有 #${cross.n}`);
      return 1;
    }
    context.frameRows = context.frameRows.filter(keep);
    context.docRows = context.docRows.filter(keep);
  }
  const report = buildCheckReport(context, { frame: parsed.flags.frame || null, status, groupBy, mode });
  if (report.error) {
    err(`错误：${report.error}`);
    return 1;
  }
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
        return 1;
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
        await renderShots({ origin, pageId: context.pageId, jobs });
        imagePaths = Object.fromEntries(jobs.map((job) => [job.screenId, job.out]));
      } catch (error) {
        err(`错误：${error.message}`);
        return 1;
      }
    }
  }
  if (parsed.flags.json) {
    out(JSON.stringify({ ...report, images: imagePaths }, null, 2));
    return 0;
  }
  for (const line of formatCheckMarkdown(report, { imagePaths })) out(line);
  return 0;
}

export async function runLocate(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const context = loadAnnotateContext(pageRefFor(parsed, { env, err }), parsed, { env, err });
  if (!context) return 1;
  const rows = [...context.frameRows, ...context.docRows];
  // 别页的行按它自己的页上下文定位（源文件、板、文章都跟着页走）。
  const contexts = new Map([[context.pageId, context]]);
  const contextOf = (pageRef) => {
    if (!contexts.has(pageRef)) contexts.set(pageRef, loadAnnotateContext(pageRef, parsed, { env, err: () => {} }));
    return contexts.get(pageRef);
  };
  const crossPageRows = (pageRef) => {
    const other = contextOf(pageRef);
    return other ? [...other.frameRows, ...other.docRows] : [];
  };
  const refCtx = { rows, board: context.board, pageId: context.pageId, crossPageRows };
  const { picks, errors } = expandRefs(parsed.refs, refCtx);
  if (parsed.flags.status) {
    if (!REF_STATUSES.includes(parsed.flags.status)) {
      err(`错误：--status 只支持 ${REF_STATUSES.join(' / ')}，收到：${parsed.flags.status}`);
      return 1;
    }
    for (const row of expandStatus(parsed.flags.status, rows)) picks.push({ kind: 'annotation', row, via: `--status ${parsed.flags.status}` });
  }
  for (const error of errors) err(error);
  const seen = new Set();
  const printRow = (row) => {
    const key = `${row.__bucket}|${row.__ledger}|${row.id || row.n}`;
    if (seen.has(key)) return;
    seen.add(key);
    out(locateLine(row, (row.__bucket && contextOf(row.__bucket)) || context).text);
  };
  for (const pick of picks) {
    if (pick.kind === 'annotation') printRow(pick.row);
    else if (pick.kind === 'frame') for (const row of rows.filter((row) => row.screenId === pick.screenId)) printRow(row);
    else if (pick.kind === 'section') for (const row of rows.filter((row) => pick.frames.some((frame) => frame.id === row.screenId))) printRow(row);
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
  const frameJob = (screenId) => {
    if (seenScreens.has(screenId)) return;
    seenScreens.add(screenId);
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
      jobs.push({
        kind: 'section',
        pageId: basePageId,
        sectionId: pick.sectionId,
        ...withTab(pick.tabId),
        scale,
        label: [pick.ref, pick.sectionId].filter(Boolean).join(' · '),
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
        label: pageContext.pageId,
        out: path.join(shotDirOf(pageContext.pageId), `${pageContext.pageId}.png`),
        marks: withMarks ? openRows(pageContext) : [],
      });
    }
  }
  return { jobs, problems };
}

/**
 * `ppnt shot --figure <图 id> --page <文章页 id>`：拍正文里的一个图，浅色、深色各一张（renderFigureShots）。
 * 页也可以写成唯一的位置参数。图编译失败、在浏览器里运行出错时打出原因、退 1。
 */
async function shotFigure(parsed, { env, out, err, scale }) {
  const refs = parsed.refs || [];
  const pageId = parsed.flags.page || (refs.length === 1 ? refs[0] : '');
  if (!pageId || refs.length > 1 || (parsed.flags.page && refs.length)) {
    err('错误：shot --figure 拍一个图：ppnt shot --figure <图 id> --page <文章页 id>（不和帧、段的引用混用）');
    return 1;
  }
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  let renderFigureShots;
  try {
    ({ renderFigureShots } = await import('../ppnt-shot.js'));
  } catch (error) {
    err(`错误：渲染器加载失败：${error.message}`);
    return 1;
  }
  const figureId = parsed.flags.figure;
  let results;
  try {
    results = await renderFigureShots({ origin, pageId, figureId, scale, outBase: path.join(dataRoot(env), 'shot', pageId, `figure-${figureId}`) });
  } catch (error) {
    err(`错误：${error.message}`);
    return 1;
  }
  let failed = false;
  for (const result of results) {
    out(`图 ${figureId} · ${result.theme === 'light' ? '浅色' : '深色'} → ${result.out} · ${result.width}×${result.height}`);
    for (const message of result.errors) {
      failed = true;
      err(`  出错：${message}`);
    }
  }
  return failed ? 1 : 0;
}

export async function runShot(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const scale = Number(parsed.flags.scale || 1);
  if (scale !== 1 && scale !== 2) {
    err(`错误：--scale 只支持 1 或 2，收到：${parsed.flags.scale || '(空)'}`);
    return 1;
  }
  if (parsed.flags.figure) return shotFigure(parsed, { env, out, err, scale });
  const context = loadAnnotateContext(pageRefFor(parsed, { env, err }), parsed, { env, err });
  if (!context) return 1;
  const rows = [...context.frameRows, ...context.docRows];
  // 页引用（<页>）对照登记页 id 清单解析 —— 基页是 --page / 缺省第一页，页
  // 引用自己可以指向任何登记页（2026-09-23 修复「ppnt shot <页> 认不出」）。
  const registry = loadRegistry({ root: REPO_ROOT, path: resolveRegistryPath(parsed.flags, env) });
  const pageIds = listPageIds({ registry, root: REPO_ROOT });
  const { picks, errors } = expandRefs(parsed.refs, { rows, board: context.board, pageId: context.pageId, pageIds, crossPageRows: null }, { shotRefs: true });
  if (parsed.flags.status) {
    if (!REF_STATUSES.includes(parsed.flags.status)) {
      err(`错误：--status 只支持 ${REF_STATUSES.join(' / ')}，收到：${parsed.flags.status}`);
      return 1;
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
  if (!jobs.length) {
    err('没有可拍的目标（引用都未命中）。');
    return 1;
  }
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  let renderShots;
  try {
    ({ renderShots } = await import('../ppnt-shot.js'));
  } catch (error) {
    err(`错误：渲染器加载失败：${error.message}`);
    return 1;
  }
  const byPage = new Map();
  for (const job of jobs) {
    if (!byPage.has(job.pageId)) byPage.set(job.pageId, []);
    byPage.get(job.pageId).push(job);
  }
  try {
    for (const [pageId, group] of byPage) {
      const results = await renderShots({ origin, pageId, jobs: group });
      for (const result of results) out(`${result.label ? `${result.label} → ` : ''}${result.out} · ${result.width}×${result.height}`);
    }
  } catch (error) {
    err(`错误：${error.message}`);
    return 1;
  }
  return errors.length ? 1 : 0;
}

export async function runMark(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err, requestFn } = ioOf(io);
  if (parsed.statusWord === 'close') {
    err('close 只在工作台（owner 单击验收，带 toast 撤销）；ppnt mark 不接受 close。');
    return 1;
  }
  if (parsed.statusWord === 'open') {
    err('open 由工作台编辑触发，mark 不写；ppnt mark 只写 check / done。');
    return 1;
  }
  if (!['done', 'check'].includes(parsed.statusWord)) {
    err(`错误：状态只支持 done | check，收到：${parsed.statusWord}`);
    return 1;
  }
  const context = loadAnnotateContext(pageRefFor(parsed, { env, err }), parsed, { env, err });
  if (!context) return 1;
  const crossPageRows = crossPageRowsFor(parsed, env);
  const rows = [...context.frameRows, ...context.docRows];
  const { picks, errors } = expandRefs(parsed.refs, { rows, board: context.board, pageId: context.pageId, crossPageRows });
  if (parsed.flags.status) {
    if (!REF_STATUSES.includes(parsed.flags.status)) {
      err(`错误：--status 只支持 ${REF_STATUSES.join(' / ')}，收到：${parsed.flags.status}`);
      return 1;
    }
    for (const row of expandStatus(parsed.flags.status, rows)) picks.push({ kind: 'annotation', row, via: `--status ${parsed.flags.status}` });
  }
  for (const error of errors) err(error);
  const annotationPicks = picks.filter((pick) => pick.kind === 'annotation');
  if (!annotationPicks.length) {
    err('没有命中的标注。');
    return 1;
  }
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  try {
    const health = await requestFn(`${origin}/health`);
    if (health.status !== 200) throw new Error(`health ${health.status}`);
  } catch {
    err(`错误：pinpoint 服务未在跑（${origin}）；mark 写状态走服务端点，先 \`ppnt start\`。`);
    return 1;
  }
  let failed = 0;
  for (const pick of annotationPicks) {
    const row = pick.row;
    // storage-unify：#n 只在本页桶里解析（桶名恒等于页），不再需要桶名消歧。
    const label = `#${row.n}`;
    try {
      const doc = await requestFn(`${origin}/annotations/${encodeURIComponent(row.__ledger)}?entry=${encodeURIComponent(row.__bucket)}`);
      const baseRevision = doc.json && Number.isFinite(Number(doc.json.revision)) ? Number(doc.json.revision) : null;
      const res = await requestFn(`${origin}/annotations/${encodeURIComponent(row.__ledger)}/${row.n}/status`, {
        method: 'POST',
        body: {
          entry: row.__bucket,
          baseRevision,
          status: parsed.statusWord,
        },
      });
      if (res.status === 200) {
        out(`${label} → ${parsed.statusWord}`);
      } else {
        failed += 1;
        const detail = res.json && res.json.detail ? `：${res.json.detail}` : '';
        out(`${label} ✗ ${res.status} ${res.json && res.json.error ? res.json.error : ''}${detail}`);
      }
    } catch (error) {
      failed += 1;
      out(`${label} ✗ ${error.message}`);
    }
  }
  return failed || errors.length ? 1 : 0;
}

export async function runReply(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err, requestFn } = ioOf(io);
  const text = String(parsed.text || '').trim();
  if (!text) {
    err('错误：回复内容是空的。');
    return 1;
  }
  const context = loadAnnotateContext(pageRefFor(parsed, { env, err }), parsed, { env, err });
  if (!context) return 1;
  const crossPageRows = crossPageRowsFor(parsed, env);
  const rows = [...context.frameRows, ...context.docRows];
  const { picks, errors } = expandRefs(parsed.refs, { rows, board: context.board, pageId: context.pageId, crossPageRows });
  for (const error of errors) err(error);
  const annotationPicks = picks.filter((pick) => pick.kind === 'annotation');
  if (annotationPicks.length !== 1) {
    if (!errors.length) err(annotationPicks.length ? 'reply 一次只回一条评论，引用命中了多条。' : '没有命中的评论。');
    return 1;
  }
  const row = annotationPicks[0].row;
  if (row.type !== 'prose') {
    err(`#${row.n} 是画布标注，没有线程；reply 只用于正文评论。要写状态用 ppnt mark。`);
    return 1;
  }
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  try {
    const health = await requestFn(`${origin}/health`);
    if (health.status !== 200) throw new Error(`health ${health.status}`);
  } catch {
    err(`错误：pinpoint 服务未在跑（${origin}）；reply 走服务端点，先 \`ppnt start\`。`);
    return 1;
  }
  try {
    const doc = await requestFn(`${origin}/annotations/${encodeURIComponent(row.__ledger)}?entry=${encodeURIComponent(row.__bucket)}`);
    const baseRevision = doc.json && Number.isFinite(Number(doc.json.revision)) ? Number(doc.json.revision) : null;
    const res = await requestFn(`${origin}/annotations/${encodeURIComponent(row.__ledger)}/${row.n}/reply`, {
      method: 'POST',
      body: { entry: row.__bucket, baseRevision, text },
    });
    if (res.status !== 200) {
      const detail = res.json && res.json.detail ? `：${res.json.detail}` : '';
      out(`#${row.n} ✗ ${res.status} ${res.json && res.json.error ? res.json.error : ''}${detail}`);
      return 1;
    }
    const status = res.json && res.json.annotation ? res.json.annotation.status : row.status;
    out(`#${row.n} ← agent：${text}（状态仍是 ${status || 'open'}）`);
    return 0;
  } catch (error) {
    out(`#${row.n} ✗ ${error.message}`);
    return 1;
  }
}
