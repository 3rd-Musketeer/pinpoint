import fs from 'node:fs';
import path from 'node:path';

import { resolveContainedFile } from './servable-file.js';

function within(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

/** 编译输入保留文本路径，再按它所属的登记根查 realpath，不能用另一个根兜底越界的 symlink。 */
export function containedSource(target, file, extraRoots = []) {
  const absolute = path.resolve(target.pageDir, file);
  const roots = [target.projectRoot || (target.kind === 'template' ? path.dirname(target.pageDir) : target.pageDir), ...extraRoots];
  for (const root of roots) {
    const base = path.resolve(root);
    // esbuild / macOS 也可能给出登记根本身的真实路径（/var → /private/var）。
    const aliases = [base];
    try { aliases.push(fs.realpathSync(base)); } catch { /* 由共同判定返回 missing */ }
    for (const alias of aliases) {
      if (within(alias, absolute)) return resolveContainedFile(alias, path.relative(alias, absolute), { index: false });
    }
  }
  return { reason: 'outside' };
}

export function requireSource(target, file, extraRoots = []) {
  const found = containedSource(target, file, extraRoots);
  if (!found.file) throw new Error(`源码不存在或不在登记根内：${file}`);
  return found.file;
}

/** 在 esbuild 读任何输入（包括 JS / JSON 等 import）之前守边界。配合 preserveSymlinks 保留别名来源。 */
export function sourceBoundaryPlugin(target, extraRoots = []) {
  return {
    name: 'pp-source-boundary',
    setup(build) {
      build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
        requireSource(target, args.path, extraRoots);
        return undefined;
      });
    },
  };
}
