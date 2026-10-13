/**
 * `pinpoint migrate <页> --project <project 根> [--article <id>] [--dry-run]`：把一个存量页
 * 迁成一篇文章（docs/projects.md「从存量页迁移」）。逻辑在 src/server/lib/page-migrate.js，
 * 这里只做参数、输出和退出码。
 */
import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { readBucketLedgers } from '../../src/server/lib/orphans.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { MigrateError, planPageMigration, verifyMigration, writeMigration } from '../../src/server/lib/page-migrate.js';

import { REPO_ROOT, displayWidth, ioOf, padWide } from './core.js';
import { guardParse } from './args.js';
import { resolveRegistryPath } from './registry.js';
import { reportPageSuggestions } from './list.js';

const KIND_LABEL = { frame: '复制', comp: 'comp 生成' };
const FILE_KIND_LABEL = { frame: '帧', component: '组件', dep: '依赖', sidecar: 'sidecar', js: '页级 js' };

function diffLabel(diff) {
  if (diff === 'same') return '相同';
  if (diff === 'urls') return '只差地址';
  if (typeof diff === 'number') return `差 ${diff} 行`;
  return '—';
}

/** 计划的摘要行（dry-run 与正式写共用）。 */
export function formatPlan(plan) {
  const lines = [];
  const frames = plan.sections.flatMap((section) => section.frames);
  const comp = frames.filter((frame) => frame.kind === 'comp').length;
  const kinds = {};
  for (const spec of plan.files.values()) kinds[spec.kind] = (kinds[spec.kind] || 0) + 1;
  lines.push(`迁移 ${plan.pageId} → project ${plan.project.id} 的文章 ${plan.articleId}（画布页 ${plan.articlePageId}）`);
  lines.push(`  旧页 ${plan.legacy.dir}（${plan.legacy.kind === 'template' ? '模板页' : '登记页'}，标题“${plan.title}”）`);
  lines.push(`  新文章 ${plan.articleDir}`);
  const counts = [
    `${plan.sections.length} 节`,
    `${frames.length} 帧（复制 ${frames.length - comp}，comp 屏生成 ${comp}）`,
    `组件 ${kinds.component || 0}`,
    ...(kinds.dep ? [`其他依赖 ${kinds.dep}`] : []),
    ...(kinds.sidecar ? [`sidecar ${kinds.sidecar}`] : []),
    `资源 ${kinds['资源'] || 0}`,
  ];
  lines.push(`  ${counts.join(' · ')}`);
  for (const name of ['article.css', 'article.js']) {
    const spec = plan.files.get(name);
    if (spec) lines.push(`  ${name} ← ${spec.note}`);
  }
  const shells = frames.filter((frame) => frame.appendShell);
  if (shells.length) lines.push(`  帧级 shell（复制的帧文件末尾补一行 export const shell）：${shells.map((frame) => `${frame.id} ${frame.frameShell}`).join('、')}`);
  const rewritten = [...plan.files].filter(([, spec]) => spec.rewritten).map(([rel]) => rel);
  if (rewritten.length) lines.push(`  改了地址或补了 shell 的文件：${rewritten.join('、')}`);
  if (plan.warnings.length) {
    lines.push('注意');
    for (const warning of plan.warnings) lines.push(`  - ${warning}`);
  }
  return lines;
}

/** 校验表：编号 · 帧 · 来源 · shell · 编译 · 与旧页。 */
export function formatVerify(report) {
  const head = ['编号', '帧', '来源', 'shell', '编译', '与旧页'];
  const body = report.rows.map((row) => [
    row.ref || '—',
    row.frame,
    KIND_LABEL[row.kind] || row.kind,
    row.shell === row.legacyShell ? row.shell : `${row.shell}（旧页 ${row.legacyShell}）`,
    row.compile === 'ok' ? 'ok' : '错误',
    row.legacyCompile === 'ok' ? diffLabel(row.diff) : '旧页也编不过',
  ]);
  const widths = head.map((_, i) => Math.max(...[head, ...body].map((cells) => displayWidth(cells[i]))));
  const line = (cells) => cells.map((cell, i) => (i === cells.length - 1 ? String(cell) : padWide(cell, widths[i]))).join('  ').trimEnd();
  const out = [line(head), ...body.map(line)];
  for (const row of report.rows) {
    if (row.compile !== 'ok') out.push(`错误 ${row.frame}：${row.compile}`);
  }
  for (const error of report.errors) out.push(`错误 index.mdx：${error}`);
  return out;
}

export async function runMigrate(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { cwd, env, out, err } = ioOf(io);
  if (!parsed.flags.project) {
    err('错误：migrate 需要 --project <project 根目录>（目录里要有 docs/pinpoint/project.json）');
    return 1;
  }
  const registryPath = resolveRegistryPath(parsed.flags, env, cwd);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath, log: () => {} });
  let plan;
  try {
    plan = await planPageMigration({
      pageId: parsed.target,
      projectRoot: parsed.flags.project,
      articleId: parsed.flags.article || null,
      registry,
      root: REPO_ROOT,
      cwd,
    });
  } catch (error) {
    if (!(error instanceof MigrateError)) throw error;
    err(`错误：${error.message}`);
    if (/^找不到页/.test(error.message)) reportPageSuggestions(parsed.target, { registryPath, env, err });
    return 1;
  }
  for (const line of formatPlan(plan)) out(line);
  // 新画布页 id 的桶已经有标注行（删掉或改了名的文章留下的孤儿桶）：迁完这个 id 又是活页
  // （orphans.js 的 pageIdIsLive），旧行会静默挂到新文章上。与 rename 撞桶同一条：拒绝。
  const bucket = path.join(dataRoot(env), plan.articlePageId);
  const staleRows = readBucketLedgers(bucket)
    .reduce((sum, ledger) => sum + (Array.isArray(ledger.doc && ledger.doc.annotations) ? ledger.doc.annotations.length : 0), 0);
  if (staleRows > 0) {
    err(`错误：标注桶 ${bucket} 里已有 ${staleRows} 行标注（旧文章留下的孤儿）；迁过去它们会挂到新文章上。换 --article，或先 \`ppnt prune ${plan.articlePageId}\` 清掉`);
    return 1;
  }
  if (plan.problems.length) {
    err(`拦下：${plan.problems.length} 个问题，没有写任何文件`);
    for (const problem of plan.problems) err(`  - ${problem}`);
    return 1;
  }
  const keep = `旧页不动：文件不改、登记不撤；旧页的标注留在旧页（桶 ${plan.pageId}），不迁到新文章（新桶 ${plan.articlePageId}）。`;
  if (parsed.flags['dry-run']) {
    out('会写这些文件（--dry-run，没写）：');
    for (const [rel, spec] of [...plan.files].sort(([a], [b]) => a.localeCompare(b))) out(`  ${rel}  ${FILE_KIND_LABEL[spec.kind] || spec.kind}${spec.rewritten ? '（改过地址）' : ''}`);
    out('index.mdx：');
    for (const line of plan.files.get('index.mdx').content.trimEnd().split('\n')) out(`  ${line}`);
    out(keep);
    return 0;
  }
  let written;
  try {
    written = writeMigration(plan);
  } catch (error) {
    if (!(error instanceof MigrateError)) throw error;
    err(`错误：${error.message}`);
    return 1;
  }
  out(`已写 ${written.length} 个文件到 ${plan.articleDir}`);
  out('校验：从新 index.mdx 派生画布，逐帧编译，和旧页的渲染逐行比（“只差地址”= 把旧页地址换成新地址后逐字相同）');
  const report = await verifyMigration(plan);
  for (const line of formatVerify(report)) out(line);
  out(keep);
  const registered = (registry.projects || []).find((entry) => entry && entry.id === plan.project.id);
  if (!registered) out(`project ${plan.project.id} 还没登记：pinpoint add ${plan.project.root} --project，之后画布在 /?page=${plan.articlePageId}`);
  else if (path.resolve(registered.path) !== plan.project.root) out(`注意 登记的 project ${plan.project.id} 指向 ${registered.path}，不是 ${plan.project.root}`);
  else out(`画布 /?page=${plan.articlePageId} · 正文 /${plan.project.id}/${plan.articleId}/（正文只有节和画布，要补写）`);
  if (!report.ok) {
    const failed = report.rows.filter((row) => row.compile !== 'ok' || row.shell !== row.legacyShell).length;
    err(`有失败：${failed} 帧编不过或 shell 和旧页不同，正文 ${report.errors.length} 条画布错误。文件已写，修好后 ppnt build ${plan.articlePageId}`);
    return 1;
  }
  out(`通过：${report.rows.length} 帧都编过，shell 和旧页一致`);
  return 0;
}
