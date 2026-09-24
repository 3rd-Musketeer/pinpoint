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
 * 页内认领不到的文件）一律回落全编。
 */
import fs from 'node:fs';
import path from 'node:path';

import { defaultDistRoot, readBuildJson, screenEntriesFromBoard } from './page-compiler.js';

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
    const rel = path.relative(pageDir, path.resolve(file)).split(path.sep).join('/');
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

/** 给一个编译目标算重编计划：读 dist 的 build.json 与页目录的 board.json。 */
export function planPageRecompile(target, changedFiles, { distRoot = defaultDistRoot() } = {}) {
  let screenIds = null;
  try {
    const board = JSON.parse(fs.readFileSync(path.join(target.pageDir, 'board.json'), 'utf8'));
    screenIds = screenEntriesFromBoard(board).map((entry) => entry.id);
  } catch {
    return { all: true }; // 板读不到时 compilePage 也会失败，这里直接全编同归
  }
  return planRecompile({
    build: readBuildJson(distRoot, target.entryId),
    changedFiles,
    screenIds,
    pageDir: target.pageDir,
  });
}
