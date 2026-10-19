/**
 * 命令怎么拿到目标（docs/registry.md“CLI”）：第一个位置参数是目标；
 * 没写时看引用里有没有自带页的写法：第一个引用是 `@page:<页 id>` 时它就是目标；其余看 `<project>/<article>#3`、
 * `@frame:<页 id>/<帧 id>`、`@section:<页 id>/<节 id>`。还是没有就报错并列候选，不猜
 * （从前缺目标时取 registry 第一页，`locate B1` 会静默落到别的页上）。
 */
import { bucketOnDisk, dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { projectArticleTargets } from '../../src/server/lib/page-resolve.js';

import { REPO_ROOT } from './core.js';
import { manifestPageIds, resolveRegistryPath } from './registry.js';
import { displayAddress, looksLikeRef, parseAddress, resolveAddress, targetCandidates, toPageRef } from './address.js';
import { parseCrossRef } from '../../src/server/lib/ann-refs.js';
import { parseIndicator } from '../../src/shared/annotation-indicator.js';

const MAX_CANDIDATES = 15;

/** 读一次 registry 与模板页清单，命令内复用。 */
export function addressContext(flags, env) {
  const registryPath = resolveRegistryPath(flags, env);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath, log: () => {} });
  return { registry, registryPath, manifestIds: manifestPageIds(REPO_ROOT) };
}

/** 候选目标：每篇文章的斜杠形 + 存量页 id。 */
function candidateAddresses(ctx) {
  return targetCandidates({
    registry: ctx.registry,
    manifestIds: ctx.manifestIds,
    articlesOf: (entry) => projectArticleTargets(entry).map((target) => target.articleId),
  });
}

/** 打一段候选（最多 MAX_CANDIDATES 个）。onlyProject 给了只列这个 project 的文章。 */
export function printCandidates(ctx, err, { onlyProject = null, heading = '可用的目标' } = {}) {
  const rows = candidateAddresses(ctx).filter((row) => !onlyProject || row.address.startsWith(`${onlyProject}/`));
  if (!rows.length) {
    err(`${heading}：（无）`);
    return;
  }
  err(`${heading}：`);
  for (const row of rows.slice(0, MAX_CANDIDATES)) err(`  ${row.address}${row.kind === 'page' ? '  （存量页）' : ''}`);
  if (rows.length > MAX_CANDIDATES) err(`  … 共 ${rows.length} 个，\`ppnt list\` 看全部`);
}

/**
 * locate / shot / mark / reply 取目标：
 *   parsed.target（reply 的参数解析已经分出来的目标）> 第一个位置参数（解析得到页、文章或 project 时）
 *   > 第一个引用是 `@page:<页 id>` 时取它 > 引用里第一个 `<目标>#n`、`@frame:<页 id>/<帧 id>` 或 `@section:<页 id>/<节 id>`。
 * 返回 { pageRef, address, refs }（refs 去掉了被当成目标的那一个；pageRef 是页 id），
 * 或 { error: true }（已经打了错误和候选）。
 */
export function pickTarget(parsed, { env, err, command, usage }) {
  const ctx = addressContext(parsed.flags, env);
  const refs = [...(parsed.refs || [])];
  let token = parsed.target || null;
  if (!token && refs.length && !looksLikeRef(refs[0]) && !String(refs[0]).includes('#')) {
    const hit = resolveAddress(refs[0], ctx);
    // 页已不在、桶还在盘上（整桶孤儿）的页 id 也是目标：孤儿照样能 mark / reply。
    if (hit || parseAddress(refs[0])?.kind === 'article' || bucketOnDisk(dataRoot(env), String(toPageRef(refs[0])))) token = refs.shift();
  }
  // `@page:<页 id>`（工作台“复制 @page”给的）写在第一个就是目标，和写页 id 一样。
  if (!token && refs.length && parseIndicator(refs[0])?.kind === 'page') token = refs.shift();
  if (!token) {
    // 自带页的引用：`<目标>#n`、`@frame:<页 id>/<帧 id>`（工作台“复制 @frame”给的）和 `@section:<页 id>/<节 id>`。
    const pageOf = (ref) => {
      const cross = parseCrossRef(toPageRef(ref));
      if (cross) return cross.pageId;
      const indicator = parseIndicator(ref);
      return indicator && (indicator.kind === 'frame' || indicator.kind === 'section') ? indicator.pageId : null;
    };
    token = refs.map(pageOf).find(Boolean) || null;
  }
  if (!token) {
    err(`错误：${command} 缺目标：第一个参数写 <project>/<article>（或存量页 id），不再默认取 registry 第一页。`);
    if (usage) err(`用法：${usage}`);
    printCandidates(ctx, err);
    return { error: true };
  }
  const hit = resolveAddress(token, ctx);
  if (hit && hit.kind === 'project') {
    err(`错误：${token} 是 project；标注和评论在文章里，写 ${token}/<article>。`);
    printCandidates(ctx, err, { onlyProject: token, heading: `${token} 的文章` });
    return { error: true };
  }
  const pageRef = hit && (hit.kind === 'article' || hit.kind === 'page') ? hit.pageId : String(toPageRef(token)).replace(/#\d+$/, '');
  return { pageRef, address: displayAddress(pageRef), refs, ctx, resolved: hit };
}
