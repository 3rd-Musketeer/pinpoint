/**
 * `ppnt check <project>[/<article>]`：验证。诊断由 src/server/lib/article-check.js 产出，
 * 这里只做目标解析、输出和退出码（0 通过 · 1 有错误 · 2 用法错或找不到目标）。
 */
import path from 'node:path';

import { checkProject } from '../../src/server/lib/article-check.js';

import { reportUsageError, USAGE_EXIT } from './args.js';
import { resolveAddress } from './address.js';
import { addressContext, printCandidates } from './targets.js';

const SEVERITY_LABEL = { error: '错误', warning: '警告', info: '提示' };
const SEVERITY_MARK = { error: '✗', warning: '!', info: '·' };

/** 一条诊断一行：文件:行  级别  code  说明（节、帧附在后面）。 */
export function formatDiagnostic(row, { cwd = process.cwd() } = {}) {
  const rel = row.file && row.file.startsWith(cwd + path.sep) ? path.relative(cwd, row.file) : row.file;
  const where = `${rel || '（无文件）'}${row.line ? `:${row.line}` : ''}`;
  const extra = [row.section ? `节 ${row.section}` : '', row.frame ? `帧 ${row.frame}` : ''].filter(Boolean).join(' · ');
  return `${SEVERITY_MARK[row.severity] || '?'} ${where}  ${SEVERITY_LABEL[row.severity] || row.severity}  ${row.code}  ${row.message}${extra ? `（${extra}）` : ''}`;
}

export function countDiagnostics(diagnostics) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const row of diagnostics) counts[row.severity] = (counts[row.severity] || 0) + 1;
  return counts;
}

export async function runValidate(parsed, { env, out, err, cwd = process.cwd() }) {
  const ctx = addressContext(parsed.flags, env);
  const token = String(parsed.target || '');
  const hit = resolveAddress(token, ctx);
  if (!hit || hit.kind === 'page' || hit.kind === 'missing-article') {
    if (hit && hit.kind === 'missing-article') {
      err(`错误：找不到文章 ${hit.address}${hit.projectKnown ? `：project ${hit.projectId} 里没有 articles/${hit.articleId}/index.mdx` : `：project ${hit.projectId} 没登记`}`);
      printCandidates(ctx, err, hit.projectKnown ? { onlyProject: hit.projectId, heading: `${hit.projectId} 的文章` } : {});
      return USAGE_EXIT;
    }
    if (hit && hit.kind === 'page') return reportUsageError('check', `${token} 是存量页：check 验证 project 和文章；存量页用 ppnt build ${token}，读标注用 ppnt comments ${token}`, err);
    err(`错误：找不到 ${token}：check 的目标是 <project> 或 <project>/<article>`);
    printCandidates(ctx, err);
    return USAGE_EXIT;
  }
  const result = await checkProject(ctx.registry, hit.projectId, { articleId: hit.kind === 'article' ? hit.articleId : null });
  const counts = countDiagnostics(result.diagnostics);
  const ok = counts.error === 0;
  if (parsed.flags.json) {
    out(JSON.stringify({
      target: hit.address,
      ok,
      counts,
      articles: result.articles.map((id) => `${hit.projectId}/${id}`),
      frames: result.frames,
      diagnostics: result.diagnostics,
    }, null, 2));
    return ok ? 0 : 1;
  }
  out(`check ${hit.address}`);
  for (const row of result.diagnostics) out(formatDiagnostic(row, { cwd }));
  const scope = `${result.articles.length} 篇文章、${result.frames} 帧`;
  const tally = `${counts.error} 个错误 · ${counts.warning} 个警告 · ${counts.info} 条提示`;
  out(ok ? `通过：${tally}（查了 ${scope}）` : `没通过：${tally}（查了 ${scope}）`);
  return ok ? 0 : 1;
}
