/**
 * HTML 帧引用的本地文件（docs/projects.md“HTML 帧”）。`ppnt check` 用它报断掉的相对路径，
 * `pinpoint migrate` 用它找出要跟着帧一起复制的文件。只做文本扫描，不执行页面：
 *
 * - HTML：属性 `src`、`href`、`poster`（前面要有空白，`data-src` 这类不算）、`srcset` 的每一项，
 *   以及 `<style>` 块和 `style="…"` 里的 CSS；
 * - CSS：`url(…)` 与 `@import "…"`；
 * - JS：静态 `import … from "./x"`、`import "./x"`、`export … from "./x"`、`import("./x")`（字面量字符串）。
 *
 * 只收相对路径：空串、`#…`、`/…`、`//…`、带协议（`https:`、`data:`、`mailto:`…）的都跳过，含模板记号
 * （`${`、`{{`）的也跳过。`?query` 和 `#hash` 去掉后按引用它的文件所在目录解析。
 *
 * collectHtmlFrameAssets(file, { root }) 从一个 HTML 帧出发顺着引用走：HTML 帧本身、iframe / frame 里的
 * HTML、CSS、JS 继续往下扫，其他文件（图片、字体、下载文件、`<a href>` 指的页面）只记不扫。
 *   → { files: [{ file, from, line, url }], missing: [{ from, line, url, file }], outside: [{ from, line, url, file, reason }] }
 * files 是找到的文件（不含起点），missing 是不在盘上的，outside 是服务出不来的（root 缺省不限）。给了 root 时，
 * 每个引用按 /sites/ 出文件的同一条规则判（lib/servable-file.js 的 resolveServableFile）：outside 的 reason 是
 * 'outside'（按文本或按真实路径在 root 外面，含指出去的 symlink）或 'denied'（`.` 开头的段、文章正文 index.mdx，含 symlink 的真实落点）；
 * 指向目录的引用按服务的做法落到它的 index.html。
 * 每个 from 是引用它的那个文件，line 是那一行（1 起）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { resolveServableFile } from './servable-file.js';

const SKIP_URL = /^(?:$|#|\/|[a-z][a-z0-9+.-]*:)/i;
const TEMPLATE = /\$\{|\{\{|\}\}|<%/;

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** 一个引用 → 相对路径（去掉 query / hash 并解码），不是本地相对路径时 null。 */
export function localRef(url) {
  const raw = String(url || '').trim();
  if (SKIP_URL.test(raw) || TEMPLATE.test(raw) || /\s/.test(raw)) return null;
  const bare = raw.replace(/[?#].*$/, '');
  if (!bare) return null;
  try {
    return decodeURIComponent(bare);
  } catch {
    return bare;
  }
}

function decodeEntities(value) {
  return String(value).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** CSS 文本里的引用：[{ url, index }]。offset 加到 index 上（CSS 嵌在 HTML 里时用）。 */
function cssRefs(text, offset = 0) {
  const out = [];
  const re = /url\(\s*(["']?)([^"')]*)\1\s*\)|@import\s+(["'])([^"']+)\3/gi;
  let m;
  while ((m = re.exec(text))) out.push({ url: m[2] !== undefined ? m[2] : m[4], index: offset + m.index });
  return out;
}

/** HTML 文本里的引用：[{ url, index, tag, attr }]。 */
export function htmlRefs(text) {
  const out = [];
  const attrRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
  let tag;
  while ((tag = attrRe.exec(text))) {
    const name = tag[1].toLowerCase();
    const body = tag[0];
    const one = /\s(src|href|poster|srcset|style)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let a;
    while ((a = one.exec(body))) {
      const attr = a[1].toLowerCase();
      const value = decodeEntities(a[2] !== undefined ? a[2] : a[3]);
      const index = tag.index + a.index;
      if (attr === 'style') {
        for (const ref of cssRefs(value)) out.push({ url: ref.url, index, tag: name, attr });
      } else if (attr === 'srcset') {
        for (const part of value.split(',')) {
          const url = part.trim().split(/\s+/)[0];
          if (url) out.push({ url, index, tag: name, attr });
        }
      } else {
        out.push({ url: value, index, tag: name, attr });
      }
    }
  }
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let st;
  while ((st = styleRe.exec(text))) {
    const start = st.index + st[0].indexOf('>') + 1;
    for (const ref of cssRefs(st[1], start)) out.push({ ...ref, tag: 'style', attr: 'css' });
  }
  return out;
}

/** JS 文本里的静态引用：[{ url, index }]。 */
function jsRefs(text) {
  const out = [];
  const re = /\b(?:import|export)\b[^'"`;]*?\bfrom\s*(["'])([^"']+)\1|\bimport\s*(["'])([^"']+)\3|\bimport\(\s*(["'])([^"']+)\5\s*\)/g;
  let m;
  while ((m = re.exec(text))) out.push({ url: m[2] || m[4] || m[6], index: m.index });
  return out;
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.css') return 'css';
  if (ext === '.js' || ext === '.mjs') return 'js';
  return 'other';
}

function within(base, p) {
  return p === base || p.startsWith(base + path.sep);
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** 从一个 HTML 帧出发顺着引用走，见文件头。 */
export function collectHtmlFrameAssets(start, { root = null } = {}) {
  const base = root ? path.resolve(root) : null;
  const files = [];
  const missing = [];
  const outside = [];
  const seen = new Set([path.resolve(start)]);
  const queue = [{ file: path.resolve(start), kind: 'html' }];
  while (queue.length) {
    const { file: from, kind } = queue.shift();
    let text;
    try {
      text = fs.readFileSync(from, 'utf8');
    } catch {
      continue;
    }
    const refs = kind === 'html' ? htmlRefs(text) : kind === 'css' ? cssRefs(text) : jsRefs(text);
    for (const ref of refs) {
      const rel = localRef(ref.url);
      if (rel === null) continue;
      let abs = path.resolve(path.dirname(from), rel);
      const row = { from, line: lineAt(text, ref.index), url: ref.url, file: abs };
      if (base) {
        const found = within(base, abs) ? resolveServableFile(base, path.relative(base, abs)) : { reason: 'outside' };
        if (found.reason === 'outside' || found.reason === 'denied') {
          outside.push({ ...row, reason: found.reason });
          continue;
        }
        if (found.file) abs = found.file;
        row.file = abs;
      }
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (!isFile(abs)) {
        missing.push(row);
        continue;
      }
      files.push(row);
      const next = kindOf(abs);
      // 页面里链出去的 HTML（<a href>）只记不扫；iframe / frame 里嵌的 HTML 是这一帧的一部分，接着扫。
      const embedded = next !== 'html' || (kind === 'html' && (ref.tag === 'iframe' || ref.tag === 'frame'));
      if (next !== 'other' && embedded) queue.push({ file: abs, kind: next });
    }
  }
  return { files, missing, outside };
}
