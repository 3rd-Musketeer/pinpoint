/**
 * 命令怎么拿到目标（docs/registry.md“CLI”）：第一个位置参数是目标，`--page` 是它的别名；
 * 都没写时看引用里有没有 `<project>/<article>#3`。还是没有就报错并列候选，不猜
 * （从前缺目标时取 registry 第一页，`locate B1` 会静默落到别的页上）。
 */
import { loadRegistry } from '../../src/server/lib/registry.js';
import { projectArticleTargets } from '../../src/server/lib/page-resolve.js';

import { REPO_ROOT } from './core.js';
import { manifestPageIds, resolveRegistryPath } from './registry.js';
import { displayAddress, looksLikeRef, parseAddress, resolveAddress, targetCandidates, toPageRef } from './address.js';
import { parseCrossRef } from '../../src/server/lib/ann-refs.js';

const MAX_CANDIDATES = 15;

/** 读一次 registry 与模板页清单，命令内复用。 */
export function addressContext(flags, env) {
  const registryPath = resolveRegistryPath(flags, env);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath, log: () => {} });
  return { registry, registryPath, manifestIds: manifestPageIds(REPO_ROOT) };
}

/** 候选目标：每篇文章的斜杠形 + 存量页 id。 */
export function candidateAddresses(ctx) {
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
 *   --page > 第一个位置参数（解析得到页、文章或 project 时）> 引用里第一个 `<目标>#n`。
 * 返回 { pageRef, address, refs }（refs 去掉了被当成目标的那一个；pageRef 是页 id），
 * 或 { error: true }（已经打了错误和候选）。
 */
export function pickTarget(parsed, { env, err, command, usage }) {
  const ctx = addressContext(parsed.flags, env);
  const refs = [...(parsed.refs || [])];
  let token = parsed.flags.page || null;
  if (!token && refs.length && !looksLikeRef(refs[0]) && !String(refs[0]).includes('#')) {
    const hit = resolveAddress(refs[0], ctx);
    if (hit || parseAddress(refs[0])?.kind === 'article') token = refs.shift();
  }
  if (!token) {
    const cross = refs.map((ref) => parseCrossRef(toPageRef(ref))).find(Boolean);
    if (cross) token = cross.pageId;
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
