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
export function sourceBoundaryPlugin(target, extraRoots = [], inputMtimes = null, attemptDirs = null) {
  return {
    name: 'pp-source-boundary',
    setup(build) {
      if (attemptDirs) build.onResolve({ filter: /^\.\.?\// }, (args) => {
        // 失败的默认 import 没有 metafile；记查找目录，以便缺失模块出现时重试。
        for (const dir of new Set([args.resolveDir, path.dirname(path.resolve(args.resolveDir, args.path))])) {
          try { attemptDirs.set(dir, fs.statSync(dir).mtimeMs); }
          catch { attemptDirs.set(dir, null); }
        }
        return undefined;
      });
      build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
        const file = requireSource(target, args.path, extraRoots);
        // 在 esbuild 读入前记代次；打包后才 stat 会把期间的新保存冒认成旧 HTML 的输入。
        if (inputMtimes) inputMtimes.set(fs.realpathSync(file), fs.statSync(file).mtimeMs);
        return undefined;
      });
    },
  };
}
