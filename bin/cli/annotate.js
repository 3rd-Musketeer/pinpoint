import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { buildCheckReport, formatCheckMarkdown, loadPageContext, locateLine } from '../../src/server/lib/ann-query.js';
import { expandRefs, expandStatus, REF_STATUSES } from '../../src/server/lib/ann-refs.js';
import { listPageIds } from '../../src/server/lib/page-compiler.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { outlineFrames } from '../../src/workbench/lib/board-refs.js';

import { DEFAULT_ORIGIN, REPO_ROOT, ioOf } from './core.js';
import { resolveRegistryPath } from './registry.js';
import { guardParse } from './args.js';
import { loadAnnotateContext } from './list.js';

const CHECK_STATUSES = new Set(['open', 'check', 'done', 'close', 'all']);
const CHECK_MODES = new Set(['excerpt', 'image', 'both']);
const GROUP_BYS = new Set(['frame', 'component']);

/** locate / shot / mark 的基页：--page 优先，缺省取 registry 第一个可编译页。 */
function pageRefFor(parsed, { env, err }) {
  if (parsed.target) return parsed.target;
  if (parsed.flags.page) return parsed.flags.page;
  const registryPath = resolveRegistryPath(parsed.flags, env);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath });
  const first = listPageIds({ registry, root: REPO_ROOT })[0];
  if (!first) err('错误：registry 里没有可编译页；用 --page <页 id> 指定。');
  return first || null;
}

export async function runCheck(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const status = parsed.flags.status || 'open';
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
  const context = loadAnnotateContext(parsed.target, parsed, { env, err });
  if (!context) return 1;
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
  const refCtx = { rows, board: context.board, pageId: context.pageId, crossPageRows: null };
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
    out(locateLine(row, context).text);
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
  const registryPath = resolveRegistryPath(parsed.flags, env);
  const crossPageRows = (pageRef) => {
    const other = loadPageContext({ pageRef, registryPath, dataRootDir: dataRoot(env) });
    return other ? [...other.frameRows, ...other.docRows] : [];
  };
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
