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
 * - 文章正文 `index.mdx`（文件名，按文本或真实路径）不出 → denied：文章目录和 @root 一个口径。
 * - 目录回落到它的 index.html，同样检查；{ index: false } 时目录算 missing（帧必须是文件本身）。
 * - 不在盘上、不是文件 → missing。
 * file 是按文本拼出的绝对路径（显示、写进 build.json 用），real 是真实路径。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 不经 /sites/ 出的文件名：文章正文源（读者读渲染后的文章页）。 */
const NOT_SERVED = new Set(['index.mdx']);

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

/** 已解码的相对路径：文本路径与真实路径都必须留在登记根内。允许根自身是 symlink。 */
export function resolveContainedPath(base, rel) {
  const value = String(rel == null ? '' : rel);
  if (!base || value.includes('\0')) return { reason: 'outside' };
  const root = path.resolve(base);
  const file = path.resolve(root, value);
  if (!within(root, file)) return { reason: 'outside' };
  const realRoot = realOf(root);
  const real = realOf(file);
  if (!realRoot || !real) return { reason: 'missing' };
  if (!within(realRoot, real)) return { reason: 'outside' };
  return { file, real, realRoot };
}

/** 存量页与模板帧的文件解析；文章额外的隐藏段和正文限制见 resolveServableFile。 */
export function resolveContainedFile(base, rel, { index = true } = {}) {
  const value = String(rel == null ? '' : rel);
  const resolved = resolveContainedPath(base, value);
  if (resolved.reason) return resolved;
  let { file, real } = resolved;
  let stat = fs.statSync(real);
  if (stat.isDirectory()) {
    if (!index) return { reason: 'missing' };
    const child = resolveContainedPath(base, path.join(value, 'index.html'));
    if (child.reason) return child;
    ({ file, real } = child);
    stat = fs.statSync(real);
  }
  if (!stat.isFile()) return { reason: 'missing' };
  return { file, real };
}

export function resolveServableFile(base, rel, options = {}) {
  const initial = resolveContainedPath(base, rel);
  if (initial.reason) return initial;
  if (hiddenSegment(String(rel ?? '')) || deniedRelative(initial.realRoot, initial.real)) return { reason: 'denied' };
  const resolved = resolveContainedFile(base, rel, options);
  if (resolved.reason) return resolved;
  const { file, real } = resolved;
  if (deniedRelative(initial.realRoot, real)) return { reason: 'denied' };
  if (NOT_SERVED.has(path.basename(file)) || NOT_SERVED.has(path.basename(real))) return { reason: 'denied' };
  return resolved;
}
