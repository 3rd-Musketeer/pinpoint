import fs from 'node:fs';
import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { compilePage, listPageIds, readTargetBoard, renderScreenHtml, resolvePageTarget } from '../../src/server/lib/page-compiler.js';
import { isWatchedSource, planPageRecompile } from '../../src/server/lib/recompile-plan.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { refLikeFrameIds, refLikeTitles } from '../../src/workbench/lib/board-refs.js';

import { REPO_ROOT, ioOf } from './core.js';
import { resolveRegistryPath } from './registry.js';
import { guardParse, reportUsageError } from './args.js';
import { reportMissingTarget } from './list.js';
import { displayAddress, toPageRef } from './address.js';

/** 解析 <页> 为编译目标；找不到时报错并列出可用 id。返回 null 表示已报错。 */
function pageTargetOrReport(token, flags, { env, err }) {
  const registryPath = resolveRegistryPath(flags, env);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath });
  const target = resolvePageTarget(String(toPageRef(token)), { registry, root: REPO_ROOT });
  if (!target) {
    reportMissingTarget(token, { registryPath, env, err });
    return null;
  }
  return target;
}

/**
 * 帧 id 形如显示编号时给一行提示（只提示、不算失败）。已有帧别改名：id 是标注
 * 锚点，改名会断标注；只管新起的帧。
 */
export function refLikeIdNotice(pageDirOrTarget) {
  let board = null;
  try {
    board = typeof pageDirOrTarget === 'string'
      ? JSON.parse(fs.readFileSync(path.join(pageDirOrTarget, 'board.json'), 'utf8'))
      : readTargetBoard(pageDirOrTarget);
  } catch {
    return '';
  }
  const ids = refLikeFrameIds(board);
  const notes = [];
  if (ids.length) {
    const shown = ids.slice(0, 3).join('、') + (ids.length > 3 ? ` 等 ${ids.length} 个帧 id ` : ' 这些帧 id ');
    notes.push(`注意 ${shown}形如编号。编号按 board 顺序派生、调序就变，id 不变；`
      + '新帧的 id 用描述内容的短词（如 detail-noop-run），已有的帧不要改名（id 是标注锚点）。');
  }
  const titles = refLikeTitles(board);
  if (titles.length) {
    const shown = titles.slice(0, 3).map((t) => `“${t}”`).join('、') + (titles.length > 3 ? ` 等 ${titles.length} 个标题 ` : ' 这些标题 ');
    notes.push(`注意 ${shown}以编号开头。编号由系统按 board 顺序派生，手写必重复（ADR 0026）；`
      + '同一个关键帧要画几种做法，就在同一个 section 里放几个普通 frame，标题写各自做法的内容，不要自造编号。');
  }
  return notes.join('\n');
}

function printBuildResult(result, { out, err }, plan = null) {
  // 漂移：build.json 记下的文件变了却没收到 watch 事件（丢事件 / 页外依赖），
  // 这一拍已按全编纠正；打一行让「为什么突然整页重编」有据可查。
  if (plan && plan.drift) out(`注意 ${plan.drift} 变了但没收到 watch 事件，整页重编`);
  for (const row of result.screens) {
    if (row.ok) out(`ok   ${row.id}  ${row.ms}ms`);
    else err(`错误 ${row.id}  ${row.error}`);
  }
  // 正文里的图（docs/projects.md“图”）：整页编译时一起编，行首写“图”。
  const figures = result.figures || [];
  for (const row of figures) {
    if (row.ok) out(`ok   图 ${row.id}  ${row.ms}ms`);
    else err(`错误 图 ${row.id}  ${row.error}`);
  }
  if (result.error) err(`错误 ${displayAddress(result.entryId)}  ${result.error}`);
  // 增量拍只列点名的帧：写成「增量 M/N 帧」，免得读成整页只有 M 帧。
  const count = (result.partial
    ? `增量 ${result.screens.length}/${result.totalScreens} 帧`
    : `${result.screens.length} 帧`) + (figures.length ? ` · ${figures.length} 图` : '');
  out(`${result.ok ? '完成' : '有失败'} ${displayAddress(result.entryId)}  共 ${result.ms}ms（${count}）`);
}

/**
 * fs.watch 盯页目录：board.json / 帧 / 组件 / 资源变更 → 去抖后重编。返回 watcher（测试用）。
 * 盯的文件类型见 recompile-plan 的 isWatchedSource（deps 可能出现的 json / ts 等都在内，
 * dist、build.json、node_modules 不盯）。
 * 增量（审计 B1）：debounce 窗口里的多个文件攒成一批，按 recompile-plan 筛出
 * 命中的屏只编这些，筛不动就整页重编；计划在串行链轮到这一拍时才算 ——
 * build.json 是上一拍写下的，链上保证它是最新的。算计划时已经进了下一窗口的
 * 文件作为 pendingFiles 传给漂移校验：它们有自己的一拍，不算漂移。
 * 每拍单独 catch：一拍抛错（文件在 stat 与读之间被删、dist 写盘 IO 错）只打日志，
 * 串行链不能永久 rejected，否则之后的批次全部静默不编。
 */
export function startPageWatch(target, onResult, { debounceMs = 120, distRoot, onError = null } = {}) {
  let timer = null;
  let running = Promise.resolve();
  const pending = new Set();
  const reportError = onError || ((error) => console.error(`[pp2] 编译 ${target.entryId} 异常：${(error && error.message) || error}`));
  const watcher = fs.watch(target.pageDir, { recursive: true }, (_event, filename) => {
    const abs = filename ? path.resolve(target.pageDir, String(filename)) : null;
    if (abs && !isWatchedSource(abs, { distRoot })) return;
    // 平台拿不到文件名时存 null：planRecompile 对拿不准的批次回落全编。
    pending.add(abs);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const batch = [...pending];
      pending.clear();
      running = running.then(async () => {
        const options = distRoot ? { distRoot } : {};
        const plan = planPageRecompile(target, batch, { ...options, pendingFiles: [...pending].filter(Boolean) });
        // 文章画布：这一拍只改了正文、画布没变 → 不编。
        if (plan.noop) return undefined;
        if (!plan.all) options.onlyScreens = plan.screens;
        const result = await compilePage(target, options);
        return onResult(result, plan);
      }).catch(reportError);
    }, debounceMs);
  });
  return { watcher, done: () => running };
}

export async function runBuild(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const target = pageTargetOrReport(parsed.target, parsed.flags, { env, err });
  if (!target) return 1;
  const distRoot = path.join(dataRoot(env), 'dist');
  // --frame 是现在的写法，--screen 是旧写法（同义）。
  const first = await compilePage(target, { distRoot, onlyScreen: parsed.flags.frame || parsed.flags.screen || null });
  printBuildResult(first, { out, err });
  const refLike = refLikeIdNotice(target);
  if (refLike) out(refLike);
  if (!parsed.flags.watch) return first.ok ? 0 : 1;
  out(`监视 ${target.pageDir}（Ctrl-C 退出）…`);
  startPageWatch(target, (result, plan) => printBuildResult(result, { out, err }, plan), {
    distRoot,
    onError: (error) => err(`错误 ${target.entryId}  编译异常：${(error && error.message) || error}（继续监视）`),
  });
  return new Promise(() => {}); // watch 常驻，进程不退出
}

/** render 输出形态（纯函数）：超 limit 截断并给出全文落盘计划。 */
export function planRenderOutput(html, { full = false, limit = 8000, spillPath = null } = {}) {
  if (full || html.length <= limit) return { text: html, spill: null };
  return {
    text: `${html.slice(0, limit)}\n… 已截断（共 ${html.length} 字符），全文见 ${spillPath}`,
    spill: spillPath ? { path: spillPath, content: html } : null,
  };
}

export async function runRender(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const ref = parsed.target;
  // 最后一段是帧 id，前面是目标（<project>/<article>、页 id 或文章网址）。
  const slash = ref.lastIndexOf('/');
  if (slash <= 0 || slash === ref.length - 1) {
    return reportUsageError('render', `render 参数形如 <目标>/<帧 id>，收到：${ref}`, err);
  }
  const pageRef = String(toPageRef(ref.slice(0, slash)));
  const screenId = ref.slice(slash + 1);
  const target = pageTargetOrReport(pageRef, parsed.flags, { env, err });
  if (!target) return 1;
  const result = await renderScreenHtml(target, screenId);
  if (!result.ok) {
    err(`编译失败：${result.error}`);
    return 1;
  }
  const spillPath = path.join(dataRoot(env), 'render', pageRef, `${screenId}.html`);
  const plan = planRenderOutput(result.html, { full: !!parsed.flags.full, spillPath });
  if (plan.spill) {
    fs.mkdirSync(path.dirname(plan.spill.path), { recursive: true });
    fs.writeFileSync(plan.spill.path, plan.spill.content);
  }
  out(plan.text);
  return 0;
}

/* ---- pp2 切片 4：check / locate / shot / mark（标注面，只读为主） ---- */
