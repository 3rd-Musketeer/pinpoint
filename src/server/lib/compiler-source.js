import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
export function sourceBoundaryPlugin(target, extraRoots = [], inputs = null) {
  return {
    name: 'pp-source-boundary',
    setup(build) {
      build.onLoad({ filter: /.*/, namespace: 'file' }, (args) => {
        const file = requireSource(target, args.path, extraRoots);
        const loader = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx', '.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx', '.json': 'json', '.css': 'css' }[path.extname(args.path)];
        if (!inputs || !loader) return undefined;
        const realpath = fs.realpathSync(file);
        const mtimeMs = fs.statSync(realpath).mtimeMs;
        const contents = fs.readFileSync(realpath);
        const record = { mtimeMs, realpath, sha256: crypto.createHash('sha256').update(contents).digest('hex') };
        inputs.set(path.resolve(args.path), { record, contents });
        // 摘要、lint 与 esbuild 共用同份 bytes；resolveDir 与诊断路径沿用 file namespace。
        return { contents, loader, resolveDir: path.dirname(args.path) };
      });
    },
  };
}
