/**
 * 文章在 /sites/<页 id>/ 下出文件的唯一解析规则（docs/projects.md“HTML 帧”）。文章目录、project 根（`@root`）、
 * source 目录（`@source`）三条出文件的分支，本篇与 `{ id, src }` 的 HTML 帧，以及 `ppnt check` 收集 HTML 帧
 * 引用的资源，都走这一个函数：check 说在的文件，服务一定出得来；服务出不来的，check 一定报。
 *
 * resolveServableFile(base, rel, { index = true }) → { file, real } | { reason }
 * - rel 相对 base，`/` 分隔，已解码。
 * - 文本检查：含 NUL、按文本解析后在 base 外面 → outside；任何一段以 `.` 开头（.env、.git/）→ denied。
 * - 真实路径（跟 symlink）必须在 base 的真实路径下，否则 outside；真实路径相对 base 的段同样不能以 `.` 开头
 *   （symlink 指向同目录的 .env 也不出）→ denied。
 * - 目录回落到它的 index.html，同样检查；{ index: false } 时目录算 missing（帧必须是文件本身）。
 * - 不在盘上、不是文件 → missing。
 * file 是按文本拼出的绝对路径（显示、写进 build.json 用），real 是真实路径。
 */
import fs from 'node:fs';
import path from 'node:path';

function within(base, p) {
  return p === base || p.startsWith(base + path.sep);
}

/** 任何一段以 `.` 开头（`.env`、`.git`，也包括 `.` 和 `..`）。 */
function hiddenSegment(rel) {
  return rel.split(/[\\/]/).some((seg) => seg.startsWith('.'));
}

/** p 相对 base 的路径里有 `.` 开头的段。 */
function deniedRelative(base, p) {
  return hiddenSegment(path.relative(base, p));
}

function realOf(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

export function resolveServableFile(base, rel, { index = true } = {}) {
  const value = String(rel == null ? '' : rel);
  if (!base || value.includes('\0')) return { reason: 'outside' };
  const root = path.resolve(base);
  const abs = path.resolve(root, value);
  if (!within(root, abs)) return { reason: 'outside' };
  if (hiddenSegment(value)) return { reason: 'denied' };
  const realRoot = realOf(root);
  if (!realRoot) return { reason: 'missing' };
  let file = abs;
  let real = realOf(abs);
  if (!real) return { reason: 'missing' };
  if (!within(realRoot, real)) return { reason: 'outside' };
  if (deniedRelative(realRoot, real)) return { reason: 'denied' };
  let stat = fs.statSync(real);
  if (stat.isDirectory()) {
    if (!index) return { reason: 'missing' };
    file = path.join(abs, 'index.html');
    real = realOf(file);
    if (!real) return { reason: 'missing' };
    if (!within(realRoot, real)) return { reason: 'outside' };
    if (deniedRelative(realRoot, real)) return { reason: 'denied' };
    stat = fs.statSync(real);
  }
  return stat.isFile() ? { file, real } : { reason: 'missing' };
}
