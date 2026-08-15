/**
 * Synthesized boards for registry entries that carry no board.json of their own
 * (阶段 3 收尾：「出现在 Pages」= 出现且能正常打开阅读、可标注，否则不如不出现）。
 *
 * The workbench loads a site page's board from /sites/<id>/board.json; when the
 * disk has none, sites-api falls back to these pure synthesizers (disk always
 * wins — synthesis only answers the paths that resolve to nothing):
 *
 * - `file` entries → a single-screen doc board whose one screen is the
 *   registered file. file 条目恒 doc 壳（单个完整 HTML 文档只有阅读器语义），
 *   其 board 字段不参与合成。
 * - `dir` entries without board.json → a doc board with one screen per
 *   top-level *.html (sorted, one screen = one sidebar version). 显式
 *   board:"ios" 的目录不合成（机壳画布需要手写 board.json 定义 sections），
 *   目录缺失或顶层无 .html 时也不合成（回落 404 = 「没有可阅读内容」语义，
 *   与 registry 白名单的 404 惯例一致）。
 *
 * Screen srcs are percent-encoded (`sites/<id>/<encodeURIComponent(name)>`) so
 * the iframe URL, the browser's location.pathname, and the export pipeline's
 * annotation page-key hash all agree byte-for-byte on names with spaces.
 */
import fs from 'node:fs';
import path from 'node:path';

export function siteFileSrc(entryId, filename) {
  return `sites/${entryId}/${encodeURIComponent(filename)}`;
}

// Screen id 契约是 ^[a-zA-Z0-9_-]+$（workbench/lib/preview-contracts.js）：
// 文件名折成 slug（去扩展名、小写、非法字符折叠成 -），撞名追加 -2/-3。
function screenIdFor(filename, taken) {
  const stem = filename.replace(/\.html?$/i, '');
  const base = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'doc';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function docShellBoard(entry, screens) {
  return {
    sections: [{
      id: 'main',
      title: entry.title || entry.id,
      layout: 'column',
      shell: 'doc',
      screens,
    }],
  };
}

export function synthesizeFileBoard(entry) {
  if (!entry || entry.kind !== 'file') return null;
  const basename = path.basename(entry.path);
  return docShellBoard(entry, [
    { id: 'index', title: entry.title || entry.id, src: siteFileSrc(entry.id, basename) },
  ]);
}

export function synthesizeDirBoard(entry, listDir) {
  if (!entry || entry.kind !== 'dir') return null;
  if (entry.board === 'ios') return null;
  const read = listDir || ((p) => fs.readdirSync(p, { withFileTypes: true }));
  let names;
  try {
    names = read(path.resolve(entry.path))
      .filter((item) => item.isFile() && /\.html?$/i.test(item.name))
      .map((item) => item.name)
      .sort();
  } catch {
    return null; // 目录本身缺失（registry load 已记 warning）
  }
  if (!names.length) return null;
  const taken = new Set();
  return docShellBoard(entry, names.map((name) => ({
    id: screenIdFor(name, taken),
    title: name,
    src: siteFileSrc(entry.id, name),
  })));
}

/** Dispatch by kind; null = 不合成（调用方回落 404）。 */
export function synthesizeBoard(entry, listDir) {
  if (!entry) return null;
  if (entry.kind === 'file') return synthesizeFileBoard(entry);
  if (entry.kind === 'dir') return synthesizeDirBoard(entry, listDir);
  return null;
}
