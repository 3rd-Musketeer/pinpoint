/**
 * Registry entry content mtime (2026-08-17g): the「最近更新」signal behind
 * Pages 排序。语义 = 内容文件最后改动时间，与标注活动无关（标注活动时间
 * 是另一个排序档的事，见 backlog）。
 *
 * - file 条目 → 文件自身 mtime；
 * - dir 条目 → 目录递归 walk 的最大 mtime（文件与目录都计入 —— 目录 mtime
 *   捕获「删了最后一个文件」这类不产生新文件 mtime 的变化）；跳过 dot 名
 *   与 node_modules，symlink 不跟随（/sites/ 防泄漏契约本就不接受逃逸
 *   symlink）；visit 上限防误注册巨型目录时拖慢 /registry；
 * - url 条目 / 路径缺失 → null（客户端不显示时间、排序沉底）。
 */
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules']);
const MAX_VISITS = 5000;

function mtimeOf(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

export function contentMtimeMs(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.kind === 'file') return mtimeOf(entry.path) || null;
  if (entry.kind !== 'dir') return null;
  let best = mtimeOf(entry.path);
  if (!best) return null;
  const stack = [entry.path];
  let visits = 0;
  while (stack.length && visits < MAX_VISITS) {
    const dir = stack.pop();
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 读不了的子目录不拖垮整个条目
    }
    for (const item of items) {
      if (visits >= MAX_VISITS) break;
      if (item.name[0] === '.' || SKIP_DIRS.has(item.name)) continue;
      visits += 1;
      const p = path.join(dir, item.name);
      if (item.isDirectory()) {
        best = Math.max(best, mtimeOf(p));
        stack.push(p);
      } else if (item.isFile()) {
        best = Math.max(best, mtimeOf(p));
      }
    }
  }
  return best || null;
}
