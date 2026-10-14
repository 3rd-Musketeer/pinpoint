/**
 * 孤儿账本判定（storage-unify）。桶 = 页之后，一页的桶里可能留着表面已经
 * 不存在的账本。这里只做判定与计数，不动盘；清理只经 `ppnt prune`。
 *
 * 判三种（头注承诺与行为一致）：
 * 1. 本页表面死了：dir 条目目录下文档文件删了、file 条目的登记文件删了；
 * 2. 路径指向别页的条目空间：账本错放在本页桶里 —— 表面活着，但不归本页；
 * 3. 路径指向登记表里已不存在的条目（条目移走）：`/sites/<id>/…` 这个
 *    表面在任何页都查不到了。
 *
 * 表面（一个页的可标注 URL 空间，按页收集）：
 * - 页自己的 registry 条目：`/sites/<条目 id>/` —— dir = 目录下现存文件；file = 登记文件现存；
 * - manifest 模板页：`/previews/<页 id>/` —— 页目录下现存文件 + board.json 屏
 *   （屏 HTML 从 dist 出，源文件可以只有 .jsx，不能按 .html 是否在盘上判死）；
 * - 文章页：`/sites/<页 id>/` —— 只有现有 HTML 帧的地址（本篇、`@root`、`@source` 三种，
 *   article-board.js 的 articleHtmlFramePaths：帧还在 Canvas 里、源文件解析得到）。
 *   文章目录里别的文件服务时不注入标注客户端，不会有账本；
 * - `@canvas.json`、`@prose.json` 恒活：页在，画布与正文表面就在。
 * 不判（宁漏报不误删）：无 path 的存量账本、`/sites/` `/previews/` 形态之外的
 * 未知空间、读不出正文的文章。页本身不在 registry 与 manifest 里 = 整桶皆孤儿（CLI 侧按桶判）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { articleHtmlFramePaths } from './article-board.js';
import { boardScreenIds } from './page-compiler.js';
import { CANVAS_LEDGER, PROSE_LEDGER } from '../../shared/project-ids.js';

// “这个页 id 现在是不是一页”在 page-resolve.js（pageIdIsLive / resolvePage）。

/** 一个页的表面空间列表。entries 是 registry 条目；isManifestPage
    = 该 id 在 content/previews/_index.json 里；article = 文章页的编译目标（page-resolve.js 的
    resolveArticleTarget，kind 'article'），给了就按它的 HTML 帧收表面。 */
export function pageSurfaceSpaces({ pageId, entries = [], isManifestPage = false, previewsRoot, article = null }) {
  const spaces = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.id !== pageId) continue;
    const prefix = `/sites/${entry.id}/`;
    if (entry.kind === 'dir' && typeof entry.path === 'string') {
      spaces.push({ prefix, kind: 'dir', root: path.resolve(entry.path) });
    } else if (entry.kind === 'file' && typeof entry.path === 'string') {
      spaces.push({ prefix, kind: 'file', file: entry.path });
    }
  }
  if (isManifestPage) spaces.push({ prefix: `/previews/${pageId}/`, kind: 'preview', root: path.join(previewsRoot, pageId) });
  if (article && article.kind === 'article' && article.entryId === pageId) {
    let paths = null;
    try {
      paths = new Set(articleHtmlFramePaths(article).keys());
    } catch { /* 正文读不出：表面未知，这一页的账本都不判 */ }
    spaces.push({ prefix: `/sites/${pageId}/`, kind: 'article', paths });
  }
  return spaces;
}

/** 一本账本是否孤儿。name = 桶内文件名；doc = 解析后的账本；spaces =
    pageSurfaceSpaces 的返回。保守取向：path 缺失（存量）或落在 /sites/ 与
    /previews/ 形态之外的未知空间都不判孤儿。 */
export function ledgerIsOrphan({ name, doc }, spaces) {
  if (name === `${CANVAS_LEDGER}.json` || name === `${PROSE_LEDGER}.json`) return false;
  const p = String((doc && doc.path) || '');
  if (!p) return false;
  const space = spaces.find((s) => p === s.prefix.slice(0, -1) || p.startsWith(s.prefix));
  if (!space) {
    // 不在本页的空间里：仍可能判两种（头注的 2、3）——路径指向 /sites/<id>/
    // 这个形态的表面，而表面只属于登记表里的条目。条目是别页 = 错放；
    // 条目不在登记表 = 表面已消失（条目移走）。两种都
    // 不归本页。/sites/ /previews/ 之外的未知空间照旧不判。页 id 的形状含文章页的 `_`。
    return /^\/sites\/[A-Za-z0-9_-]+(\/|$)/.test(p);
  }
  if (space.kind === 'file') return !fs.existsSync(space.file);
  if (space.kind === 'article') return space.paths ? !space.paths.has(p) : false;
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

/** 一页的孤儿账本文件名列表。文章页要给 article（它的编译目标），否则本篇的 HTML 帧账本无从判。 */
export function collectPageOrphans({ pageId, dataRoot, entries, isManifestPage = false, previewsRoot, article = null }) {
  const spaces = pageSurfaceSpaces({ pageId, entries, isManifestPage, previewsRoot, article });
  return readBucketLedgers(path.join(dataRoot, pageId))
    .filter((ledger) => ledgerIsOrphan(ledger, spaces))
    .map((ledger) => ledger.name);
}

/** 页不在 registry 与 manifest 里 = 整桶皆孤儿（@canvas 也是 —— 页没了）。 */
export function collectBucketOrphans(pageId, dataRoot) {
  return readBucketLedgers(path.join(dataRoot, pageId)).map((ledger) => ledger.name);
}

/** 每个已知页的孤儿行数（GET /registry 的页信息用）。口径 = 行数（K7）；
    一本孤儿账本可能装着几十行。
    articleTargets = 活的文章画布页的编译目标（它们不在 entries 里，桶照样要数，HTML 帧账本按它判）。 */
export function collectOrphanCounts({ entries, dataRoot, localIds, root, articleTargets = [] }) {
  const previewsRoot = path.join(root, 'content', 'previews');
  const articles = new Map(articleTargets.map((target) => [target.entryId, target]));
  const ids = new Set([...localIds, ...articles.keys()]);
  for (const entry of entries) if (entry.id !== 'pinpoint' && entry.kind !== 'project') ids.add(entry.id);
  const out = {};
  for (const pageId of ids) {
    const orphanLedgers = new Set(collectPageOrphans({
      pageId,
      dataRoot,
      entries,
      isManifestPage: localIds.includes(pageId),
      previewsRoot,
      article: articles.get(pageId) || null,
    }));
    out[pageId] = readBucketLedgers(path.join(dataRoot, pageId))
      .filter((ledger) => orphanLedgers.has(ledger.name))
      .reduce((sum, ledger) => sum + annotationsCount(ledger.doc), 0);
  }
  return out;
}

const annotationsCount = (doc) => (Array.isArray(doc && doc.annotations) ? doc.annotations.length : 0);
