/**
 * 孤儿账本判定（storage-unify）。桶 = 页之后，一页的桶里可能留着表面已经
 * 不存在的账本。这里只做判定与计数，不动盘；清理只经 `ppnt prune`。
 *
 * 判三种（头注承诺与行为一致）：
 * 1. 本页表面死了：dir 条目目录下文档文件删了、file 条目的登记文件删了；
 * 2. 路径指向别页的条目空间：挂靠条目改挂别页（或本就属于别页），账本错放
 *    在本页桶里 —— 表面活着，但不归本页；
 * 3. 路径指向登记表里已不存在的条目（url 条目移走等）：`/sites/<id>/…` 这个
 *    表面在任何页都查不到了。
 *
 * 表面（一个页的可标注 URL 空间，按页收集）：
 * - registry 条目（页自己的条目 + 挂靠到本页的条目，`entry.page || entry.id`
 *   归属）：`/sites/<条目 id>/` —— dir = 目录下现存文件；file = 登记文件现存；
 *   url = 条目还在登记表里就算活着（上游死活不便宜探，不判）；
 * - manifest 模板页：`/previews/<页 id>/` —— 页目录下现存文件 + board.json 屏
 *   （屏 HTML 从 dist 出，源文件可以只有 .jsx，不能按 .html 是否在盘上判死）；
 * - `@canvas.json` 恒活：页在，画布表面就在。
 * 不判（宁漏报不误删）：无 path 的存量账本、`/sites/` `/previews/` 形态之外的
 * 未知空间。页本身不在 registry 与 manifest 里 = 整桶皆孤儿（CLI 侧按桶判）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { boardScreenIds } from './page-compiler.js';

/** 一个页的表面空间列表。entries 是 registry 条目（含挂靠）；isManifestPage
    = 该 id 在 content/previews/_index.json 里。 */
export function pageSurfaceSpaces({ pageId, entries = [], isManifestPage = false, previewsRoot }) {
  const spaces = [];
  for (const entry of entries) {
    if (!entry) continue;
    const owner = entry.page || entry.id;
    if (owner !== pageId) continue;
    const prefix = `/sites/${entry.id}/`;
    if (entry.kind === 'dir' && typeof entry.path === 'string') {
      spaces.push({ prefix, kind: 'dir', root: path.resolve(entry.path) });
    } else if (entry.kind === 'file' && typeof entry.path === 'string') {
      spaces.push({ prefix, kind: 'file', file: entry.path });
    } else if (entry.kind === 'url') {
      spaces.push({ prefix, kind: 'url' });
    }
  }
  if (isManifestPage) spaces.push({ prefix: `/previews/${pageId}/`, kind: 'preview', root: path.join(previewsRoot, pageId) });
  return spaces;
}

/** 一本账本是否孤儿。name = 桶内文件名；doc = 解析后的账本；spaces =
    pageSurfaceSpaces 的返回。保守取向：path 缺失（存量）或落在 /sites/ 与
    /previews/ 形态之外的未知空间都不判孤儿。 */
export function ledgerIsOrphan({ name, doc }, spaces) {
  if (name === '@canvas.json') return false;
  const p = String((doc && doc.path) || '');
  if (!p) return false;
  const space = spaces.find((s) => p === s.prefix.slice(0, -1) || p.startsWith(s.prefix));
  if (!space) {
    // 不在本页的空间里：仍可能判两种（头注的 2、3）——路径指向 /sites/<id>/
    // 这个形态的表面，而表面只属于登记表里的条目。条目挂在别页 = 错放
    // （改挂别页）；条目不在登记表 = 表面已消失（url 条目移走）。两种都
    // 不归本页。/sites/ /previews/ 之外的未知空间照旧不判。
    return /^\/sites\/[a-z0-9][a-z0-9-]*(\/|$)/.test(p);
  }
  if (space.kind === 'url') return false;
  if (space.kind === 'file') return !fs.existsSync(space.file);
  // doc.path 是 decode 后的 pathname（客户端写入侧已解），这里不再二次 decode：
  // 再解一次遇到字面 %（如 50%.html）会抛异常，反而把活账本判成孤儿。
  const rel = p.slice(space.prefix.length);
  // 目录形 URL（/sub/ 与裸前缀）回落 index.html，别拿 statSync 命中目录当不在盘。
  const relFile = rel === '' ? 'index.html' : (rel.endsWith('/') ? `${rel}index.html` : rel);
  const base = path.resolve(space.root);
  const abs = path.resolve(base, relFile);
  if (abs !== base && !abs.startsWith(base + path.sep)) return true;
  let stat = null;
  try { stat = fs.statSync(abs); } catch { /* 不在盘上 */ }
  if (stat && stat.isFile()) return false;
  if (space.kind === 'preview') {
    const m = relFile.match(/^([a-zA-Z0-9_-]+)\.html$/);
    if (m) {
      const ids = boardScreenIds(space.root);
      if (ids && ids.has(m[1])) return false;
    }
  }
  return true;
}

/** 桶里可读的账本（跳过 _seq.json 与坏文件），name + doc 成对。 */
export function readBucketLedgers(bucketPath) {
  const out = [];
  if (!fs.existsSync(bucketPath)) return out;
  for (const name of fs.readdirSync(bucketPath).sort()) {
    if (!name.endsWith('.json') || name === '_seq.json') continue;
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(path.join(bucketPath, name), 'utf8')); } catch { continue; }
    out.push({ name, doc });
  }
  return out;
}

/** 一页的孤儿账本文件名列表。 */
export function collectPageOrphans({ pageId, dataRoot, entries, isManifestPage = false, previewsRoot }) {
  const spaces = pageSurfaceSpaces({ pageId, entries, isManifestPage, previewsRoot });
  return readBucketLedgers(path.join(dataRoot, pageId))
    .filter((ledger) => ledgerIsOrphan(ledger, spaces))
    .map((ledger) => ledger.name);
}

/** 页不在 registry 与 manifest 里 = 整桶皆孤儿（@canvas 也是 —— 页没了）。 */
export function collectBucketOrphans(pageId, dataRoot) {
  return readBucketLedgers(path.join(dataRoot, pageId)).map((ledger) => ledger.name);
}

/** 每个已知页的孤儿账本数（GET /registry 的页信息用）。 */
export function collectOrphanCounts({ entries, dataRoot, localIds, root }) {
  const previewsRoot = path.join(root, 'content', 'previews');
  const ids = new Set([...localIds]);
  for (const entry of entries) if (entry.id !== 'pinpoint' && !entry.page) ids.add(entry.id);
  const out = {};
  for (const pageId of ids) {
    out[pageId] = collectPageOrphans({
      pageId,
      dataRoot,
      entries,
      isManifestPage: localIds.includes(pageId),
      previewsRoot,
    }).length;
  }
  return out;
}
