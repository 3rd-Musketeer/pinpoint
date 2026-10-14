/**
 * 读 dist 的命令（comments 的源码摘录、check --mode image、locate、show --uses）在 dist 不在或落后于
 * 源码时先编一次，不再要求 agent 先跑 ppnt build（docs/registry.md“CLI”）。和 ppnt build 同一个编译器，
 * 写同一个 dist；不在盘上的页（文档页）什么也不做。
 */
import { compilePage, distStatus, readTargetBoard } from '../../src/server/lib/page-compiler.js';

/**
 * target 是 resolvePageTarget / loadPageContext 的目标。dist 是最新的返回 null；
 * 否则整页编一次（含正文里的图），返回 compilePage 的结果。
 */
export async function ensureDist(target, { distRoot }) {
  if (!target || target.docOnly || !target.pageDir) return null;
  let board = null;
  if (target.kind === 'article') {
    try {
      board = readTargetBoard(target);
    } catch {
      return null; // 正文读不出画布：布局错误由 show / check 报，这里不编
    }
  }
  const status = distStatus(target.entryId, target.pageDir, { distRoot, ...(board ? { board } : {}) });
  if (!status.stale) return null;
  return compilePage(target, { distRoot });
}

/** ensureDist 的一行说明（打到 stderr，stdout 留给结果）。没编返回 ''。 */
export function ensureDistNote(result, address) {
  if (!result) return '';
  const failed = result.screens.filter((row) => !row.ok).length;
  return `dist 不在或落后于源码，先编了 ${address}（${result.screens.length} 帧${failed ? `，${failed} 帧编不过，ppnt check ${address} 看原因` : ''}）`;
}
