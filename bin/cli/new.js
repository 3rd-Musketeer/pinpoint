/**
 * `ppnt new project <目录>` 与 `ppnt new article <project>/<article>`：脚手架（docs/projects.md“目录”）。
 * 两个命令都不覆盖已有文件：写了什么、跳过了什么逐行打印。
 *
 * new project：<目录>/docs/pinpoint/project.json（{ id, title }）+ 空的 articles/、wiki/，再登记
 *   （和 `ppnt add <目录> --project` 同一条路）。project.json 已经在就沿用它，只补登记，所以重跑是幂等的。
 * new article：articles/<article>/index.mdx，frontmatter 写 title，正文是一节 <Section>。index.mdx 已经在，
 *   或这篇的页 id 的桶里已有旧标注（删掉的文章留下的孤儿），就拒绝。
 *   参数不带 `/` 时建在默认 project（id notes）里；notes 没登记时先在 defaultProjectRoot() 建好并登记（ADR 0045）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { staleBucketProblem } from '../../src/server/lib/orphans.js';
import { addRegistryEntry } from '../../src/server/lib/registry-store.js';
import { defaultEntries, projectEntry } from '../../src/server/lib/registry.js';
import { PROJECT_CONTENT_DIR, readProjectJson } from '../../src/server/lib/projects.js';
import { articlePageId, isReservedProjectId, RESERVED_ARTICLE_IDS } from '../../src/shared/project-ids.js';
import { ENTRY_ID_PATTERN } from '../../src/shared/registry-ids.js';
import { formatProjectError } from '../../src/shared/project-errors.js';

import { CliError, DEFAULT_ORIGIN, REPO_ROOT, ioOf, slugify } from './core.js';
import { guardParse, reportUsageError, USAGE_EXIT } from './args.js';
import { parseAddress, resolveAddress } from './address.js';
import { addressContext, printCandidates } from './targets.js';
import { planAdd, reloadService } from './registry.js';

/** 默认 project：`ppnt new article <id>` 不带 `/` 时文章进这里（ADR 0045）。 */
export const DEFAULT_PROJECT_ID = 'notes';
export const DEFAULT_PROJECT_TITLE = 'Notes';

/**
 * 默认 project 第一次建的时候放在哪：PINPOINT_DEFAULT_PROJECT（`~` 开头按家目录展开，相对路径按 cwd），
 * 缺省 ~/notes。登记过之后以登记表为准，这个值不再用。
 */
export function defaultProjectRoot(env = process.env, cwd = process.cwd()) {
  const raw = String(env.PINPOINT_DEFAULT_PROJECT || '').trim();
  if (!raw) return path.join(os.homedir(), DEFAULT_PROJECT_ID);
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(cwd, raw);
}

/** frontmatter 的一个值：frontmatter 子集（docs/projects.md“frontmatter”）认不出的写法就加引号。 */
export function frontmatterValue(text) {
  const value = String(text).replace(/\s+/g, ' ').trim();
  const risky = /^[>|[{&*!'"#-]/.test(value) || value.includes(' #') || value.includes(': ');
  if (!risky) return value;
  return value.includes("'") ? `"${value.replace(/"/g, '“')}"` : `'${value}'`;
}

/** 新文章的 index.mdx：frontmatter + 一节。 */
export function articleScaffold({ title }) {
  return `---
title: ${frontmatterValue(title)}
---

<Section id="overview" title="概览">
{/* 这一节的正文写在这里。要画界面：在本目录写 <帧 id>.jsx，再在这一节里加一行 <Canvas frames={["<帧 id>"]} />。 */}
</Section>
`;
}

/**
 * new project 的计划（只读盘）→ { root, contentDir, id, title, write: [{ file, content }], mkdirs, skipped, existingJson }。
 * 不合法时抛 CliError。
 */
export function planNewProject(dir, { cwd = process.cwd(), id: wantId = null, title: wantTitle = null } = {}) {
  const root = path.resolve(cwd, String(dir));
  if (fs.existsSync(root) && !fs.statSync(root).isDirectory()) throw new CliError(`${root} 不是目录`);
  const contentDir = path.join(root, PROJECT_CONTENT_DIR);
  const jsonFile = path.join(contentDir, 'project.json');
  const write = [];
  const skipped = [];
  let id;
  let title;
  let existingJson = null;
  if (fs.existsSync(jsonFile)) {
    const meta = readProjectJson(root);
    if (meta.errors.length) throw new CliError(`已有的 project.json 有问题：${meta.errors.map(formatProjectError).join('；')}（${jsonFile}）`);
    existingJson = meta.json;
    id = meta.json.id;
    if (wantId && wantId !== id) throw new CliError(`${jsonFile} 已经在，id 是 "${id}"，不是 --id ${wantId}；不覆盖它，要换 id 先改那个文件`);
    title = (typeof meta.json.title === 'string' && meta.json.title) || path.basename(root);
    skipped.push(jsonFile);
  } else {
    id = wantId || slugify(path.basename(root));
    if (!id || !ENTRY_ID_PATTERN.test(id)) throw new CliError(`project id 要匹配 ${ENTRY_ID_PATTERN}，从目录名推出的是 "${id}"；用 --id 指定`);
    if (isReservedProjectId(id)) throw new CliError(`project id "${id}" 是保留名（网址第一段已被服务占用，见 docs/projects.md“保留名”）；用 --id 换一个`);
    title = wantTitle || path.basename(root);
    write.push({ file: jsonFile, content: `${JSON.stringify({ id, title }, null, 2)}\n` });
  }
  const mkdirs = [];
  for (const sub of ['articles', 'wiki']) {
    const full = path.join(contentDir, sub);
    if (fs.existsSync(full)) skipped.push(`${full}${path.sep}`);
    else mkdirs.push(full);
  }
  return { root, contentDir, id, title, write, mkdirs, skipped, existingJson };
}

/** new article 的计划 → { file, dir, content, address, projectId, articleId }。不合法时抛 CliError（带 exit）。 */
export function planNewArticle(hit, { title = null } = {}) {
  const articleId = hit.articleId;
  if (RESERVED_ARTICLE_IDS.has(articleId)) throw Object.assign(new CliError(`文章 id "${articleId}" 是保留名（/<project>/${articleId}/ 是 wiki 词条页的地址）`), { exit: USAGE_EXIT });
  const dir = path.join(hit.root, PROJECT_CONTENT_DIR, 'articles', articleId);
  const file = path.join(dir, 'index.mdx');
  if (fs.existsSync(file)) throw Object.assign(new CliError(`${file} 已经在，不覆盖：ppnt show ${hit.address} 看这篇`), { exit: 1 });
  return { file, dir, content: articleScaffold({ title: title || articleId }), address: hit.address, projectId: hit.projectId, articleId };
}

function writeIfAbsent(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // wx：文件在就失败，计划和写入之间被别人写了也不覆盖。
  fs.writeFileSync(file, content, { flag: 'wx' });
}

/**
 * 写 project 的骨架（不覆盖）并在没登记时登记，new project 和默认 project 共用。
 * → { ok: true, plan, written, registeredNow, registryPath } 或 { ok: false, usage?, message }。
 */
async function ensureProject({ dir, id = null, title = null, flags = {} }, { cwd, env, out, err, requestFn }) {
  let plan;
  try {
    plan = planNewProject(dir, { cwd, id, title });
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    return { ok: false, usage: true, message: error.message };
  }
  const ctx = addressContext(flags, env);
  const registered = projectEntry(ctx.registry, plan.id);
  if (registered && path.resolve(registered.path) !== plan.root) {
    return { ok: false, usage: true, message: `project id "${plan.id}" 已经登记在 ${registered.path}；换 --id，或用 ppnt move ${plan.id} ${plan.root} 把登记指过来` };
  }
  const written = [];
  try {
    for (const row of plan.write) {
      writeIfAbsent(row.file, row.content);
      written.push(row.file);
    }
    for (const mkdir of plan.mkdirs) {
      fs.mkdirSync(mkdir, { recursive: true });
      written.push(`${mkdir}${path.sep}`);
    }
  } catch (error) {
    return { ok: false, message: `写文件失败：${error.message}` };
  }
  let registeredNow = false;
  let registryPath = ctx.registryPath;
  if (!registered) {
    const argv = ['add', plan.root, '--project', ...(flags.registry ? ['--registry', flags.registry] : [])];
    try {
      const add = planAdd(argv, { cwd, env });
      registryPath = add.registryPath;
      addRegistryEntry(add.registryPath, add.entry, { seedEntries: defaultEntries(REPO_ROOT) });
      registeredNow = true;
    } catch (error) {
      return { ok: false, message: `文件写好了，登记失败：${error.message}（修好后 ppnt add ${plan.root} --project）` };
    }
  }
  const quiet = (line) => { if (!flags.json) out(line); };
  if (registeredNow) await reloadService({ env, requestFn, registryPath, out: quiet, err });
  return { ok: true, plan, written, registeredNow, registryPath };
}

async function newProject(parsed, io) {
  const { out, err, env } = io;
  const made = await ensureProject({ dir: parsed.target, id: parsed.flags.id || null, title: parsed.flags.title || null, flags: parsed.flags }, io);
  if (!made.ok) {
    if (made.usage) return reportUsageError('new', made.message, err);
    err(`错误：${made.message}`);
    return 1;
  }
  const { plan, written, registeredNow, registryPath } = made;
  if (plan.existingJson && parsed.flags.title && parsed.flags.title !== plan.title) {
    err(`注意：project.json 已经在，标题沿用“${plan.title}”，--title 没写进去（要改就改 ${path.join(plan.contentDir, 'project.json')}）`);
  }
  const origin = (env.PINPOINT_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
  const next = [
    `建一篇文章：ppnt new article ${plan.id}/<article> --title <标题>`,
    `看 project：ppnt show ${plan.id}`,
  ];
  const model = {
    kind: 'project',
    address: plan.id,
    root: plan.root,
    files: written,
    skipped: plan.skipped,
    registered: registeredNow ? 'now' : 'already',
    registry: registryPath,
    urls: { home: `${origin}/${plan.id}/` },
    next,
  };
  if (parsed.flags.json) {
    out(JSON.stringify(model, null, 2));
    return 0;
  }
  out(`project ${plan.id} · ${plan.title}`);
  for (const file of written) out(`  写了 ${file}`);
  for (const file of plan.skipped) out(`  已经在，没动 ${file}`);
  out(registeredNow ? `  登记了（registry：${registryPath}）` : '  已经登记过');
  out(`首页：${model.urls.home}`);
  out('下一步：');
  for (const line of next) out(`  ${line}`);
  return 0;
}

/**
 * `ppnt new article <id>` 不带 `/`：默认 project 登记了就用它，没登记就在 defaultProjectRoot() 建好并登记。
 * → { address, created: null | { root, written } } 或已打错误时的退出码。
 */
async function resolveDefaultProject(parsed, io) {
  const { cwd, env, err } = io;
  const ctx = addressContext(parsed.flags, env);
  const registered = projectEntry(ctx.registry, DEFAULT_PROJECT_ID);
  if (registered) return { root: path.resolve(registered.path), created: null };
  const root = defaultProjectRoot(env, cwd);
  const made = await ensureProject({ dir: root, id: DEFAULT_PROJECT_ID, title: DEFAULT_PROJECT_TITLE, flags: parsed.flags }, io);
  if (!made.ok) {
    err(`错误：默认 project ${DEFAULT_PROJECT_ID} 没建成（${root}）：${made.message}`);
    return made.usage ? USAGE_EXIT : 1;
  }
  return { root: made.plan.root, created: { written: made.written } };
}

async function newArticle(parsed, io) {
  const { env, out, err } = io;
  const target = String(parsed.target);
  let created = null;
  if (!target.includes('/')) {
    // 不带 `/`：文章 id，建在默认 project 里（ADR 0045）。先查 id，写错了不去建默认 project。
    if (!ENTRY_ID_PATTERN.test(target)) {
      return reportUsageError('new', `文章 id 要匹配 ${ENTRY_ID_PATTERN}（写 <article> 建在默认 project ${DEFAULT_PROJECT_ID} 里，或写 <project>/<article>），收到：${target}`, err);
    }
    if (RESERVED_ARTICLE_IDS.has(target)) {
      return reportUsageError('new', `文章 id "${target}" 是保留名（/<project>/${target}/ 是 wiki 词条页的地址）`, err);
    }
    const resolved = await resolveDefaultProject(parsed, io);
    if (typeof resolved === 'number') return resolved;
    created = resolved.created ? { ...resolved.created, root: resolved.root } : null;
    parsed = { ...parsed, target: `${DEFAULT_PROJECT_ID}/${target}` };
    if (!parsed.flags.json) out(created ? `默认 project ${DEFAULT_PROJECT_ID} 还没有，建好并登记了：${resolved.root}` : `默认 project ${DEFAULT_PROJECT_ID}：${resolved.root}`);
  }
  const ctx = addressContext(parsed.flags, env);
  const literal = parseAddress(parsed.target);
  if (!literal || literal.kind !== 'article' || literal.n || String(parsed.target).includes('_')) {
    return reportUsageError('new', `new article 的参数写 <project>/<article>，收到：${parsed.target}`, err);
  }
  const hit = resolveAddress(`${literal.project}/${literal.article}`, ctx);
  if (!hit || hit.kind === 'page') {
    return reportUsageError('new', `${parsed.target} 指到的是存量页，不是 project 里的文章`, err);
  }
  if (hit.kind === 'missing-article' && !hit.projectKnown) {
    err(`错误：project ${hit.projectId} 没登记：先 ppnt new project <目录> --id ${hit.projectId}（或 ppnt add <project 根> --project）`);
    printCandidates(ctx, err, { heading: '已有的目标' });
    return USAGE_EXIT;
  }
  const entry = projectEntry(ctx.registry, hit.projectId);
  let plan;
  try {
    plan = planNewArticle({ ...hit, root: path.resolve(entry.path) }, { title: parsed.flags.title || null });
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    err(`错误：${error.message}`);
    return error.exit || 1;
  }
  // 这个页 id 的桶里还有旧文章的标注：建了就静默接过去。与 migrate 同一条（orphans.js）。
  const stale = staleBucketProblem(dataRoot(env), articlePageId(plan.projectId, plan.articleId), { renameHint: '换一个文章 id' });
  if (stale) {
    err(`错误：${stale}`);
    return 1;
  }
  try {
    writeIfAbsent(plan.file, plan.content);
  } catch (error) {
    err(`错误：写文件失败：${error.message}`);
    return 1;
  }
  const origin = (env.PINPOINT_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
  const url = `${origin}/${plan.projectId}/${plan.articleId}/`;
  const next = [
    `写正文和帧：${plan.file}（帧写在 ${plan.dir}${path.sep}<帧 id>.jsx，在节里用 <Canvas frames={["<帧 id>"]} /> 列出来）`,
    `验证：ppnt check ${plan.address}`,
    `截文章页：ppnt shot ${plan.address}`,
  ];
  if (parsed.flags.json) {
    out(JSON.stringify({ kind: 'article', address: plan.address, files: [plan.file], skipped: [], registered: 'already', urls: { article: url }, next, ...(created ? { defaultProject: { id: DEFAULT_PROJECT_ID, root: created.root, created: true, files: created.written } } : {}) }, null, 2));
    return 0;
  }
  out(`文章 ${plan.address}`);
  out(`  写了 ${plan.file}`);
  out(`文章页：${url}`);
  out('下一步：');
  for (const line of next) out(`  ${line}`);
  return 0;
}

export async function runNew(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const ctx = ioOf(io);
  if (parsed.kind === 'project') return newProject(parsed, ctx);
  if (parsed.flags.id) return reportUsageError('new', '--id 只用于 new project；文章 id 写在 <project>/<article> 里', ctx.err);
  return newArticle(parsed, ctx);
}
