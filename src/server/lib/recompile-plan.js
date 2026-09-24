/**
 * 改一帧只重编这一帧（2026-09-24 性能审计 B1）：变更文件集合 → 该重编哪些屏。
 *
 * planRecompile 是纯函数：输入上一次的 build.json（sources 里每屏的 file + deps）、
 * 这次变更的文件路径集合、当前板的屏清单，输出屏 id 列表或「全编」；
 * planPageRecompile 是 preview-hmr 与 CLI startPageWatch 共用的落盘包装
 * （读 dist 的 build.json 与页目录的 board.json 再调纯函数）。
 *
 * 判错方向是死的：宁可多编，不可少编 —— 少编 = owner 看到旧画面，比慢更糟。
 * 所以筛选只在「上一次全绿 + 屏清单没变 + 每个变更文件都能认领到屏」时收窄，
 * 其余一切拿不准的形状（build.json 缺失/损坏/字段不对、fs.watch 拿不到文件名、
 * 页内认领不到的文件）一律回落全编。落盘包装在收窄前再做一道漂移校验
 * （findDrift）：build.json 记下的文件在盘上变了、却不在这批变更里，也全编。
 */
import fs from 'node:fs';
import path from 'node:path';

import { defaultDistRoot, readBuildJson, screenEntriesFromBoard } from './page-compiler.js';

// watch 盯的文件类型（review 必须修 2）：build.json 的 deps 记的是 esbuild
// metafile 的全部输入，esbuild 默认 loader 能打包的 json / ts / tsx / mjs / cjs /
// mts / cts 都可能进来；只盯 html/js/jsx/css 时改这些文件零事件。.txt 也能被
// import，但页目录里的 .txt 多半是笔记，盯了就是每改一次笔记整页重编；它进了
// deps 的少见情形交给漂移校验，下一拍纠正。
const WATCHED_SOURCE = /\.(?:html|jsx?|css|json|tsx?|[mc][jt]s)$/;
// 不盯的：依赖目录与 VCS 目录；编译自己写出的东西（build.json、落在页目录里的
// dist）—— 盯了就是「编译写盘 → 事件 → 再编译」的自触发循环。
const IGNORED_PATH = /(?:^|\/)(?:node_modules|\.git)\/|(?:^|\/)build\.json$/;

/**
 * 这个文件的变更要不要触发重编（CLI startPageWatch 与 preview-hmr 共用）。
 * file 可以是绝对路径或页相对路径；给了 distRoot 时，落在它下面的文件一律不盯。
 */
export function isWatchedSource(file, { distRoot = null } = {}) {
  const rel = String(file || '').replace(/\\/g, '/');
  if (!WATCHED_SOURCE.test(rel) || IGNORED_PATH.test(rel)) return false;
  if (distRoot && path.isAbsolute(String(file))) {
    const inDist = path.relative(path.resolve(distRoot), path.resolve(String(file)));
    if (inDist && !inDist.startsWith('..') && !path.isAbsolute(inDist)) return false;
  }
  return true;
}

/** 事件路径 → 页相对的 / 分隔路径（与 build.json 记录同一形状）。 */
function relToPage(pageDir, file) {
  return path.relative(pageDir, path.resolve(file)).split(path.sep).join('/');
}

/** 倒排一条 file → 屏；records 的 file/deps 按构造就是页相对的 / 分隔路径。 */
function claim(byFile, file, screenId) {
  const hit = byFile.get(file);
  if (hit) hit.push(screenId);
  else byFile.set(file, [screenId]);
}

export function planRecompile({ build, changedFiles, screenIds, pageDir }) {
  if (!Array.isArray(screenIds)) return { all: true };
  const files = changedFiles ? [...changedFiles] : [];
  // 没有变更就编不出「哪些屏」；空批只能全编，不能拿空列表跳过编译 ——
  // 那会把 builtAt 刷新而什么都不编，dist 假 fresh。
  if (!files.length) return { all: true };

  // build.json 缺失 / 解析失败 / 形状不对 → 全编。
  if (!build || typeof build !== 'object') return { all: true };
  const sources = build.sources && typeof build.sources === 'object' ? build.sources : null;
  const errors = build.errors && typeof build.errors === 'object' ? build.errors : null;
  if (!sources || !errors) return { all: true };
  // 上次编译有失败屏 → 全编：失败屏没有 deps 记录，依赖图不完整，筛不可信。
  if (Object.keys(errors).length) return { all: true };

  // 屏增删（当前板屏清单 ≠ build.json 记录过的屏 = sources ∪ errors）→ 全编。
  // 「源码不存在」的屏只在 errors 里，联合键集合就是上次编译见过的全部屏。
  const prevIds = new Set([...Object.keys(sources), ...Object.keys(errors)]);
  const nowIds = new Set(screenIds);
  if (prevIds.size !== nowIds.size) return { all: true };
  for (const id of nowIds) {
    if (!prevIds.has(id)) return { all: true };
  }

  // 变更文件 → 屏 的倒排：file 或 deps 命中都算；一个共享组件（页内
  // components/、kit 的 jsx 印章）常是多屏的依赖，命中的屏全部重编。
  const byFile = new Map();
  for (const [screenId, record] of Object.entries(sources)) {
    if (!record || typeof record.file !== 'string') return { all: true };
    claim(byFile, record.file, screenId);
    for (const dep of Array.isArray(record.deps) ? record.deps : []) {
      if (!dep || typeof dep.file !== 'string') return { all: true };
      claim(byFile, dep.file, screenId);
    }
  }

  const hits = new Set();
  for (const file of files) {
    // fs.watch 在某些平台给不出文件名：拿不准 → 全编。
    if (typeof file !== 'string' || !file) return { all: true };
    const rel = relToPage(pageDir, file);
    // 板文件一变，屏清单、assets 注入、comp props 全跟着变 → 全编。嵌套的
    // 同名文件不是板，走下面的认领逻辑（认领不到 → 全编，同归保守）。
    if (rel === 'board.json') return { all: true };
    const hit = byFile.get(rel);
    // 页内认领不到的文件（新增源码、assets、样式、sidecar）→ 全编；页外又
    // 不在任何屏 deps 里的文件同样全编兜底 —— 正常走不到这里（watch 只盯
    // 页目录、kit 印章有自己的全量分支），走到就是拿不准。
    if (!hit) return { all: true };
    for (const screenId of hit) hits.add(screenId);
  }
  // 输出按板的屏序，调用方（compilePage 的 picked）也按板序过滤。
  return { all: false, screens: screenIds.filter((id) => hits.has(id)) };
}

function liveMtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null; // 文件消失
  }
}

/**
 * 漂移校验（review 必须修 1）：build.json 记下的文件（每屏 file + 全部 deps，再加
 * board.json）在盘上变了、却不在这次的变更集合里 → 返回第一个漂移文件的页相对
 * 路径；没有漂移返回 null。
 *
 * 为什么要这一道：收窄编译会刷新整页 builtAt。watch 没盯到的改动（丢事件、不盯的
 * 文件类型、页外依赖）原本靠 distStatus 报 stale、靠下一次整页重编自愈；收窄一次
 * 就把这个 stale 信号永久盖掉，没点名的屏停在旧画面且零信号。先对一遍盘，漂移
 * 就全编，丢掉的改动在下一拍被纠正。
 *
 * 判据：记录里有 mtimeMs 就与记录比（不等即变，往回拨也算）；没有记录（board.json、
 * 旧格式 build.json）就与 builtAt 比；文件消失算变。exempt 里的文件有自己的事件，
 * 对应的屏这一拍或下一拍会重编，不算漂移。只在 planRecompile 已经收窄（即 build
 * 形状已校验）之后调用。同一文件被多屏记录时只 stat 一次。
 */
export function findDrift({ build, exempt = [], pageDir, mtimeOf = liveMtime }) {
  const skip = new Set();
  for (const file of exempt) {
    if (typeof file === 'string' && file) skip.add(relToPage(pageDir, file));
  }
  const builtAt = typeof build.builtAt === 'number' ? build.builtAt : null;
  const live = new Map();
  const drifted = (rel, recorded) => {
    if (skip.has(rel)) return false;
    if (!live.has(rel)) live.set(rel, mtimeOf(path.join(pageDir, rel)));
    const now = live.get(rel);
    if (now === null) return true;
    if (typeof recorded === 'number') return now !== recorded;
    return builtAt === null || now > builtAt;
  };
  for (const record of Object.values(build.sources)) {
    if (drifted(record.file, record.mtimeMs)) return record.file;
    for (const dep of Array.isArray(record.deps) ? record.deps : []) {
      if (drifted(dep.file, dep.mtimeMs)) return dep.file;
    }
  }
  return drifted('board.json', undefined) ? 'board.json' : null;
}

/**
 * 给一个编译目标算重编计划：读 dist 的 build.json 与页目录的 board.json，收窄时
 * 再过一道漂移校验。pendingFiles 是已经收到事件、排在后面批次里的文件（CLI
 * debounce 窗口）：它们会在自己那一拍重编，不算漂移，免得连续保存把每拍都打成全编。
 * 返回 { all: true } / { all: true, drift: 页相对路径 } / { all: false, screens }。
 */
export function planPageRecompile(target, changedFiles, { distRoot = defaultDistRoot(), pendingFiles = [] } = {}) {
  let screenIds = null;
  try {
    const board = JSON.parse(fs.readFileSync(path.join(target.pageDir, 'board.json'), 'utf8'));
    screenIds = screenEntriesFromBoard(board).map((entry) => entry.id);
  } catch {
    return { all: true }; // 板读不到时 compilePage 也会失败，这里直接全编同归
  }
  const build = readBuildJson(distRoot, target.entryId);
  const changed = changedFiles ? [...changedFiles] : [];
  const plan = planRecompile({ build, changedFiles: changed, screenIds, pageDir: target.pageDir });
  if (plan.all) return plan;
  const drift = findDrift({ build, exempt: [...changed, ...pendingFiles], pageDir: target.pageDir });
  return drift ? { all: true, drift } : plan;
}
