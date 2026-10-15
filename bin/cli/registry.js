import fs from 'node:fs';
import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { manifestPageIds as libManifestPageIds } from '../../src/server/lib/page-manifest.js';
import { defaultEntries, defaultRegistryPath, ENTRY_ID_PATTERN, loadRegistry, PAGE_ID_PATTERN, RETIRED_ENTRY_KEYS } from '../../src/server/lib/registry.js';
import { collectBucketOrphans, collectPageOrphans } from '../../src/server/lib/orphans.js';
import { resolvePage } from '../../src/server/lib/page-resolve.js';
import { articlePageId, parseArticlePageId } from '../../src/shared/project-ids.js';
import { PROJECT_CONTENT_DIR, readProjectJson } from '../../src/server/lib/projects.js';
import { formatProjectError } from '../../src/shared/project-errors.js';
import { addRegistryEntry, listRegistryEntries, removeRegistryEntry, renameRegistryEntry, updateRegistryEntry } from '../../src/server/lib/registry-store.js';

import { DEFAULT_ORIGIN, REPO_ROOT, CliError, slugify, ioOf } from './core.js';
import { BOARDS, parseArgs, guardParse } from './args.js';
import { toPageRef } from './address.js';
import { htmlPathnames, planMovedBucket, rewriteMovedBucket } from './bucket-move.js';
import { beginMoveRecovery } from './move-recovery.js';
import { checkedBucketRowCount } from './bucket-check.js';

export { rewriteMovedBucket } from './bucket-move.js';

function isHttpUrl(target) {
  return /^https?:\/\//i.test(target);
}

/** 一个目标（目录 / .html 文件）解析成 registry 的 kind + 落点。
    add 与 move 共用同一套校验：路径必须真的存在，单文件必须是 html。 */
export function resolveTarget(target, cwd = process.cwd()) {
  if (isHttpUrl(target)) {
    throw new CliError(`登记的目标是本地目录或 .html 文件；网址请先存成本地 HTML 再登记：${target}`);
  }
  const absPath = path.resolve(cwd, target);
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    throw new CliError(`路径不存在：${absPath}`);
  }
  if (stat.isDirectory()) {
    const baseName = path.basename(absPath);
    return { kind: 'dir', absPath, baseName, idSeed: baseName };
  }
  if (stat.isFile()) {
    const ext = path.extname(absPath).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') {
      throw new CliError(`单个文件只支持 .html/.htm（要登记整个目录请传目录路径）：${absPath}`);
    }
    // id 不带扩展名（保留原大小写截取）：report.html → report
    return { kind: 'file', absPath, baseName: path.basename(absPath), idSeed: path.basename(absPath, path.extname(absPath)) };
  }
  throw new CliError(`不支持的路径类型（既不是目录也不是文件）：${absPath}`);
}

/** 条目的登记落点，用于报错与打印。 */
export function entryTargetDesc(entry) {
  // 老登记表里残留的 url 条目只有 url（remove / 撞 id 提示时会打印它）。
  return entry && (entry.path || entry.url);
}

function idTakenError(id, existing) {
  const where = existing ? `，指向 ${entryTargetDesc(existing)}` : '';
  return new CliError(
    `id 已存在：${id}${where}；更新路径用 \`ppnt mv ${id} <新路径>\`，要新条目请显式 \`--id <其他 id>\``,
  );
}

/**
 * 由目标构造 registry 条目（纯函数 + fs 探测；不写盘）。
 * takenEntries：现有条目（供 id 查重与「已存在，指向哪」的提示）；takenIds 是它的
 * id 投影，测试可只给 id。
 */
export function buildEntry(target, flags = {}, { cwd = process.cwd(), takenEntries = [], takenIds } = {}) {
  const existingIds = takenIds || takenEntries.map((entry) => entry && entry.id);
  const findExisting = (id) => takenEntries.find((entry) => entry && entry.id === id) || null;
  if (flags.project) return buildProjectEntry(target, flags, { cwd, existingIds, findExisting });
  const resolved = resolveTarget(target, cwd);
  const { kind } = resolved;

  let id;
  if (flags.id) {
    if (!ENTRY_ID_PATTERN.test(flags.id)) {
      throw new CliError(`--id 必须匹配 ${ENTRY_ID_PATTERN}（小写字母/数字/中划线，字母或数字开头）：${flags.id}`);
    }
    if (existingIds.includes(flags.id)) throw idTakenError(flags.id, findExisting(flags.id));
    id = flags.id;
  } else {
    const slug = slugify(resolved.idSeed);
    if (!slug) throw new CliError(`无法从 "${resolved.idSeed}" 派生 id，请用 --id 显式指定`);
    // 撞 id 一律报错。历史行为是静默追加 -2，而标注账本按 id 寻址——
    // 那等于给同一份内容开了个空桶，既有标注就此孤儿化（2026-09-01 实迁踩到）。
    if (existingIds.includes(slug)) throw idTakenError(slug, findExisting(slug));
    id = slug;
  }

  let board;
  if (flags.board !== undefined && !BOARDS.has(flags.board)) {
    throw new CliError(`--board 只支持 ios 或 html：${flags.board}`);
  }
  // file 条目恒 doc 壳（Pages 端强制），--board ios 对单文件是矛盾输入，响亮拒绝；
  // file 条目也不落 board 字段（恒 doc，写了是死数据）。
  if (kind === 'file' && flags.board === 'ios') {
    throw new CliError('单个 HTML 文件恒以 doc 阅读器打开；--board ios 只对目录有意义');
  }
  if (kind === 'dir') board = flags.board || 'html';


  const entry = { id, title: flags.title || resolved.baseName, kind, path: resolved.absPath };
  if (board) entry.board = board;
  return entry;
}

/**
 * project 根目录 → 校验过的 project 条目（docs/projects.md）。id 只有一个来源：
 * project.json 的 id。站点 URL、registry 条目、将来的评论桶都用它，两处写得不一样
 * 迟早有一处被改漏，所以 --id 只能重复它，不能另起一个。
 */
export function resolveProjectRoot(target, cwd = process.cwd()) {
  const root = path.resolve(cwd, target);
  if (isHttpUrl(target)) throw new CliError(`--project 需要 project 根目录，不是 URL：${target}`);
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new CliError(`路径不存在：${root}`);
  }
  if (!stat.isDirectory()) throw new CliError(`--project 需要 project 根目录（含 ${PROJECT_CONTENT_DIR}/project.json）：${root}`);
  const meta = readProjectJson(root);
  if (meta.errors.length) throw new CliError(`${meta.errors.map(formatProjectError).join('；')}（project 根：${root}）`);
  return { root, json: meta.json };
}

function buildProjectEntry(target, flags, { cwd, existingIds, findExisting }) {
  if (flags.board !== undefined) throw new CliError('--project 不能和 --board 同用（project 不是页，没有壳）');
  // 标题只有一个来源：project.json 的 title（读取时它优先），--title 写进登记表也会被盖掉。
  if (flags.title !== undefined) throw new CliError('--project 不接受 --title：标题写在 docs/pinpoint/project.json 的 title 里');
  const { root, json } = resolveProjectRoot(target, cwd);
  if (flags.id && flags.id !== json.id) {
    throw new CliError(`--id ${flags.id} 与 project.json 的 id "${json.id}" 不同；project 的 id 只认 project.json，要换 id 先改那里`);
  }
  if (existingIds.includes(json.id)) throw idTakenError(json.id, findExisting(json.id));
  const title = (typeof json.title === 'string' && json.title) || path.basename(root);
  return { id: json.id, title, kind: 'project', path: root };
}

/** 本地 manifest 页 id 列表（实现在 src/server/lib/page-manifest.js，服务端
    用的是同一份）。缺省读本 CLI 所在仓库。 */
export function manifestPageIds(root = REPO_ROOT) {
  return libManifestPageIds(root);
}

/**
 * move 的新条目（纯函数 + fs 探测；不写盘）：只换 kind 与落点，id / title
 * 原样带走——标注桶按页寻址（桶 = 页），换路径不该动标注归属。
 */
export function buildMove(id, target, { cwd = process.cwd(), entries = [] } = {}) {
  const before = entries.find((entry) => entry && entry.id === id);
  if (!before) {
    const known = entries.map((entry) => entry && entry.id).filter(Boolean).join('、');
    throw new CliError(`条目不存在：${id}${known ? `（现有：${known}）` : ''}`);
  }
  if (before.kind === 'project') {
    // project 只能重指到另一个 project 根，且 id 不变（id 写在 project.json 里）。
    const { root, json } = resolveProjectRoot(target, cwd);
    if (json.id !== id) {
      throw new CliError(`新根目录的 project.json id 是 "${json.id}"，不是 ${id}；换根目录时 id 不变，换 id 用 \`ppnt mv ${id} <新 id>\``);
    }
    return { before, after: { ...before, path: root } };
  }
  const resolved = resolveTarget(target, cwd);
  const after = { ...before, kind: resolved.kind };
  for (const key of RETIRED_ENTRY_KEYS) delete after[key];
  after.path = resolved.absPath;
  // board 只对 dir 条目有意义（file 恒 doc 阅读器）。
  if (resolved.kind !== 'dir') delete after.board;
  return { before, after };
}

/* ------------------------ 改 id（ppnt mv <旧 id> <新 id>） ------------------------
   id 是三个地方的地址：登记表的条目 id、标注桶 ~/.pinpoint/<id>/、以及页面资源
   的 URL 前缀 /sites/<id>/。手改其中一个，另外两个就此错位——2026-09-03 实迁
   （mcp-confirm + artifact-v2 合并成 chat-cards）踩到的正是第三个：机壳和内联
   HTML 还在，JS 注入的卡整段消失，看起来像设计坏了。改 id 把三处一次改齐。 */

/** 会被扫的扩展名：HTML 是主场，CSS/JS sidecar 里也会写死 /sites/<id>/ 前缀。 */
const SITE_PREFIX_EXTS = new Set(['.html', '.htm', '.css', '.js']);

/** `/sites/<旧 id>/` → `/sites/<新 id>/`：精确前缀的纯字符串替换，不碰别的。 */
export function rewriteSitePrefix(text, oldId, newId) {
  const from = `/sites/${oldId}/`;
  if (!text.includes(from)) return { text, changed: false };
  return { text: text.split(from).join(`/sites/${newId}/`), changed: true };
}

/**
 * 目录下扩展名在 exts 里的文本文件，逐个交给 visit(full, text)。跳过 node_modules 与
 * 逃出目录的 symlink（那些文件不归这个目录管），按 realpath 记账避免 symlink 成环。
 * 返回 root 的 realpath（调用方算相对路径用）。
 */
function walkTextFiles(dirPath, exts, visit) {
  const root = fs.realpathSync(dirPath);
  const seen = new Set();
  const walk = (dir) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (item.name === 'node_modules') continue;
      const full = path.join(dir, item.name);
      let real;
      try {
        real = fs.realpathSync(full);
      } catch {
        continue; // 断链的 symlink
      }
      if (real !== full && real !== root && !real.startsWith(root + path.sep)) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(real);
        continue;
      }
      if (!stat.isFile() || !exts.has(path.extname(item.name).toLowerCase())) continue;
      let text;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      visit(full, text);
    }
  };
  walk(root);
  return root;
}

/**
 * 条目目录下所有 *.html/*.css/*.js（exts 可换，`ppnt mv` 搬文章时用 ARTICLE_SOURCE_EXTS）里的 /sites/<旧 id>/ 换成新前缀。
 * 返回被改写的文件相对路径列表。dryRun 只统计不落盘（预检用）。
 */
export function rewriteSitePrefixUnder(dirPath, oldId, newId, { dryRun = false, exts = SITE_PREFIX_EXTS, writeFile = fs.writeFileSync } = {}) {
  const changed = [];
  const root = walkTextFiles(dirPath, exts, (full, text) => {
    const next = rewriteSitePrefix(text, oldId, newId);
    if (!next.changed) return;
    if (!dryRun) writeFile(full, next.text);
    changed.push(full);
  });
  return changed.map((full) => path.relative(root, full));
}

/** project 内容目录里会写死文章画布地址的文件类型。 */
export const ARTICLE_SOURCE_EXTS = new Set(['.jsx', '.js', '.css', '.mdx', '.md', '.html', '.htm', '.json']);

/**
 * project 的 docs/pinpoint/ 下写死了 `/sites/<project id>_` 的文件（相对 docs/pinpoint/）。
 * rename 不改作者的源文件，只把这些文件列出来让作者自己改（改成相对路径更好）。
 */
export function filesWithArticleSitePrefix(projectRoot, projectId) {
  const dir = path.join(projectRoot, PROJECT_CONTENT_DIR);
  if (!fs.existsSync(dir)) return [];
  const needle = `/sites/${projectId}_`;
  const hits = [];
  const root = walkTextFiles(dir, ARTICLE_SOURCE_EXTS, (full, text) => {
    if (text.includes(needle)) hits.push(full);
  });
  return hits.map((full) => path.relative(root, full)).sort();
}

/**
 * 数据根下属于一个 project 的文章桶 id（`<project>_<article>`，docs/projects.md「标注桶」），
 * 按名排序。按盘上的桶扫，不按现有文章列：文章目录删了、桶还在，那也是这个 project 的桶
 * （孤儿），换 id 时一起带走。带 `_` 的模板页 id 不算（撞名时模板页优先）。
 */
export function articleBucketIds(root, projectId, { manifestIds = [] } = {}) {
  let items;
  try {
    items = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return items
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .filter((name) => {
      const parts = parseArticlePageId(name);
      return parts && parts.projectId === projectId && !manifestIds.includes(name);
    })
    .sort();
}

/** 数据根下按页 id 存的派生物。dist / render 里的 HTML 写死了 `/sites/<页 id>/`，
    换 id 后作废，删掉重编；check / shot 只是图片，跟着搬。 */
export const PAGE_CACHE_DROP = ['dist', 'render'];
export const PAGE_CACHE_MOVE = ['check', 'shot'];

/**
 * rename 的新条目（纯函数）：只换 id，kind / 落点 / title 原样带走。
 * 返回 { before, after }。
 */
export function buildRename(oldId, newId, { entries = [] } = {}) {
  const before = entries.find((entry) => entry && entry.id === oldId);
  if (!before) {
    const known = entries.map((entry) => entry && entry.id).filter(Boolean).join('、');
    throw new CliError(`条目不存在：${oldId}${known ? `（现有：${known}）` : ''}`);
  }
  if (!ENTRY_ID_PATTERN.test(newId)) {
    throw new CliError(`新 id 必须匹配 ${ENTRY_ID_PATTERN}（小写字母/数字/中划线，字母或数字开头）：${newId}`);
  }
  if (newId === oldId) throw new CliError(`新旧 id 相同：${oldId}`);
  const clash = entries.find((entry) => entry && entry.id === newId);
  if (clash) {
    throw new CliError(
      `id 已存在：${newId}，指向 ${entryTargetDesc(clash)}；把两个条目并成一个 = 先 \`ppnt mv\` 改 id，再 \`ppnt mv <id> <路径>\` 换路径`,
    );
  }
  return { before, after: { ...before, id: newId } };
}

/** 改 id 的构造 + 四件事的预检（不写盘、不联网）：任何一件做不了就整单不动手。parsed = { id, newId, flags }。 */
export function planRename(parsed, { cwd = process.cwd(), env = process.env } = {}) {
  const registryPath = resolveRegistryPath(parsed.flags || {}, env, cwd);
  const { before, after } = buildRename(parsed.id, parsed.newId, {
    entries: existingEntriesFor(registryPath),
  });

  // ② 标注桶：旧桶在就改名，新桶已存在是硬冲突（两份标注不能合）。
  // project id 本身不是桶（docs/projects.md「标注桶」）：project 的桶是每篇文章的
  // <id>_<文章>，在下面 ②' 里搬。
  const root = dataRoot(env);
  const bucketFrom = path.join(root, before.id);
  const bucketTo = path.join(root, after.id);
  const bucketExists = before.kind !== 'project' && fs.existsSync(bucketFrom);
  if (bucketExists && fs.existsSync(bucketTo)) {
    throw new CliError(`标注桶已存在：${bucketTo}；先处理掉它再改 id（两个桶不会自动合并）`);
  }

  // ③ 资源前缀：只有 dir 条目有目录可扫；目录不在就先 move 到真实路径。
  // project 条目没有 /sites/ 前缀，要改的是 project.json 里的 id。
  let rewriteDir = null;
  let rewritePreview = [];
  let projectJson = null;
  let articleMoves = [];
  let sitePrefixFiles = [];
  if (before.kind === 'project') {
    const meta = readProjectJson(before.path);
    if (!meta.json) throw new CliError(`${meta.errors.map(formatProjectError).join('；')}；先修好 project.json 再改 id`);
    if (meta.json.id !== before.id) {
      throw new CliError(`project.json 的 id 是 "${meta.json.id}"，与登记的 ${before.id} 不一致；先让两边一致再改 id`);
    }
    projectJson = meta.file;
    sitePrefixFiles = filesWithArticleSitePrefix(before.path, before.id);
    // ②' 文章桶 <旧 id>_<文章> → <新 id>_<文章>：目标有一个已存在就整单不动。
    const manifestIds = manifestPageIds();
    articleMoves = articleBucketIds(root, before.id, { manifestIds }).map((fromId) => {
      const { articleId } = parseArticlePageId(fromId);
      const toId = articlePageId(after.id, articleId);
      const move = { fromId, toId, articleId, fromProject: before.id, toProject: after.id, from: path.join(root, fromId), to: path.join(root, toId),
        htmlPathnames: htmlPathnames(before.id, articleId, loadRegistry({ root: REPO_ROOT, path: registryPath })),
      };
      planMovedBucket(move.from, move);
      return move;
    });
    const taken = articleMoves.filter((move) => fs.existsSync(move.to) || manifestIds.includes(move.toId));
    if (taken.length) {
      throw new CliError(
        `文章桶的目标已存在：${taken.map((move) => (manifestIds.includes(move.toId) ? `${move.toId}（模板页 id）` : move.to)).join('、')}；` +
        '先处理掉它们再改 id（两个桶不会自动合并）',
      );
    }
  }
  if (before.kind === 'dir') {
    if (!fs.existsSync(before.path)) {
      throw new CliError(`条目 ${before.id} 的目录不存在：${before.path}；先 \`ppnt mv ${before.id} <真实路径>\` 再改 id`);
    }
    rewriteDir = before.path;
    rewritePreview = rewriteSitePrefixUnder(rewriteDir, before.id, after.id, { dryRun: true });
  }

  return { ...parsed, registryPath, dataRoot: root, before, after, bucketFrom, bucketTo, bucketExists, rewriteDir, rewritePreview, projectJson, articleMoves, sitePrefixFiles };
}

/** --registry > PINPOINT_REGISTRY > 默认；相对路径按 cwd 解析。 */
export function resolveRegistryPath(flags = {}, env = process.env, cwd = process.cwd()) {
  const explicit = flags.registry || env.PINPOINT_REGISTRY;
  return explicit ? path.resolve(cwd, explicit) : defaultRegistryPath();
}

/** 现有条目（文件不存在时 = 写入将播种的默认条目，派生与查重必须同样避让）。 */
export function existingEntriesFor(registryPath) {
  return fs.existsSync(registryPath) ? listRegistryEntries(registryPath) : defaultEntries(REPO_ROOT);
}

/** parse + 查重 + 构造，返回一次 add 的全部输入（不写盘、不联网）。 */
export function planAdd(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) return parsed;
  const registryPath = resolveRegistryPath(parsed.flags, env, cwd);
  const entry = buildEntry(parsed.target, parsed.flags, { cwd, takenEntries: existingEntriesFor(registryPath) });
  return { ...parsed, registryPath, entry };
}

/** 定位既有条目 + 构造新落点，返回一次换路径的全部输入（不写盘、不联网）。parsed = { id, target, flags }。 */
export function planMove(parsed, { cwd = process.cwd(), env = process.env } = {}) {
  const registryPath = resolveRegistryPath(parsed.flags || {}, env, cwd);
  const { before, after } = buildMove(parsed.id, parsed.target, { cwd, entries: existingEntriesFor(registryPath) });
  return { ...parsed, registryPath, before, after };
}

/**
 * reload 应答里 entries 只数 page 条目，kind "project" 另计在 projects（annotate-api registrySummary）。
 * 给人看的总数是文件里的条目数，两者相加。
 */
export function registryCountText(summary) {
  const pages = Number(summary.entries) || 0;
  const projects = Number(summary.projects) || 0;
  return projects
    ? `registry 共 ${pages + projects} 条，其中 project ${projects} 个`
    : `registry 共 ${pages} 条`;
}

/** 写盘成功后的即时生效：服务可达就让它重读 registry；不可达不视为失败。 */
export async function reloadService({ env, requestFn, registryPath, out, err }) {
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  try {
    const health = await requestFn(`${origin}/health`);
    if (health.status !== 200) throw new Error(`health ${health.status}`);
  } catch {
    err('pinpoint 服务未在跑；已写入 registry，下次启动生效。');
    return false;
  }
  try {
    const res = await requestFn(`${origin}/registry/reload`, { method: 'POST' });
    if (res.status !== 200 || !res.json) throw new Error(`reload ${res.status}`);
    const summary = res.json;
    if (summary.path && summary.path !== registryPath) {
      err(`注意：服务在用的 registry 是 ${summary.path}，与本次写入的不是同一个文件；本次写入要等服务重启或换用同一 registry 才生效。`);
      return false;
    }
    out(`服务已重载（${registryCountText(summary)}）。`);
    return true;
  } catch (error) {
    err(`服务可达但 reload 失败（${error.message}）；条目已登记，重启服务后生效。`);
    return false;
  }
}

/**
 * 执行一次 add：写 registry → 探活服务 → 可达则 reload。返回进程退出码。
 * io: { cwd, env, out, err, requestFn } — 测试注入 out/err/requestFn 断言行为。
 */
export async function runAdd(argv, io = {}) {
  const { cwd, env, out, err, requestFn } = ioOf(io);

  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed; // 用法问题：已打错误 + usage
  if (parsed.help) return 0;
  let plan;
  try {
    plan = planAdd(argv, { cwd, env });
  } catch (error) {
    // 参数形状没问题，是目标本身不成立（路径不存在、id 撞车…）
    // 或 registry 文件已损坏。这些不该再刷一屏 usage，答案在错误行里。
    err(`${error instanceof CliError ? '错误' : '登记失败'}：${error.message}`);
    return 1;
  }

  let entry;
  try {
    entry = addRegistryEntry(plan.registryPath, plan.entry, { seedEntries: defaultEntries(REPO_ROOT) });
  } catch (error) {
    err(`登记失败：${error.message}`);
    return 1;
  }
  out(`已登记 ${entry.id}（${entry.kind}）：${entryTargetDesc(entry)}`);
  if (entry.kind === 'project') out(`文章与 wiki：\`ppnt show ${entry.id}\`；验证：\`ppnt check ${entry.id}\``);
  out(`registry：${plan.registryPath}`);
  await reloadService({ env, requestFn, registryPath: plan.registryPath, out, err });
  return 0;
}

/**
 * `ppnt mv <id> <路径>`：原子改写既有条目的落点 → 探活服务 → 可达则 reload。
 * id 与 title 不变，所以 ~/.pinpoint/<id>/ 里的既有标注继续对得上。parsed = { id, target, flags }。
 */
export async function moveEntry(parsed, io = {}) {
  const { cwd, env, out, err, requestFn } = ioOf(io);
  let plan;
  try {
    plan = planMove(parsed, { cwd, env });
  } catch (error) {
    err(`${error instanceof CliError ? '错误' : '重指失败'}：${error.message}`);
    return 1;
  }
  if (parsed.flags && parsed.flags['dry-run']) {
    out(`计划：${plan.before.id} 换路径（${plan.before.kind} → ${plan.after.kind}）`);
    out(`  旧：${entryTargetDesc(plan.before)}`);
    out(`  新：${entryTargetDesc(plan.after)}`);
    out(`  标注桶 ${plan.before.kind === 'project' ? `${plan.before.id}_<文章>` : plan.before.id} 不动（id 不变）。`);
    out('--dry-run：什么都没写，去掉 --dry-run 再跑。');
    return 0;
  }

  let entry;
  try {
    entry = updateRegistryEntry(plan.registryPath, plan.after);
  } catch (error) {
    err(`重指失败：${error.message}`);
    return 1;
  }
  out(`已重指 ${entry.id}（${plan.before.kind} → ${entry.kind}）`);
  out(`  旧：${entryTargetDesc(plan.before)}`);
  out(`  新：${entryTargetDesc(entry)}`);
  out(`标注桶 ~/.pinpoint/${entry.id}/ 不变（id 保留）。`);
  out(`registry：${plan.registryPath}`);
  await reloadService({ env, requestFn, registryPath: plan.registryPath, out, err });
  return 0;
}

/**
 * prune <页> [--dry-run]（storage-unify）：删除该页桶里的孤儿账本。
 * 孤儿 = 表面已不存在（文档文件没了 / 条目移走 / 页不在 registry 与
 * manifest 里 = 整桶皆孤儿）。owner 裁决：孤儿不备份，直接删；--dry-run 先看
 * 清单。账本自己的图片（images/<账本 key>-*）一并清掉。
 */
export async function runPrune(argv, io = {}) {
  const { env, out, err } = ioOf(io);
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  // <project>/<article> 只看字面换成页 id：删掉的文章的桶也能这样写。
  const pageId = String(toPageRef(parsed.target || ''));
  if (!PAGE_ID_PATTERN.test(pageId)) {
    err(`错误：页 id 不合法：${pageId}`);
    return 1;
  }
  const root = dataRoot(env);
  const bucket = path.join(root, pageId);
  if (!fs.existsSync(bucket)) {
    err(`错误：标注桶不存在：${bucket}`);
    return 1;
  }
  const registryPath = resolveRegistryPath(parsed.flags, env);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath });
  const localIds = manifestPageIds(REPO_ROOT);
  // 活页（含文章画布页）只删桶里表面已死的账本；不是页了才整桶皆孤儿。
  const page = resolvePage(registry, pageId, { manifestIds: localIds });
  const known = page != null;
  const names = known
    ? collectPageOrphans({
        pageId,
        dataRoot: root,
        entries: registry.entries,
        isManifestPage: page.kind === 'template',
        previewsRoot: path.join(REPO_ROOT, 'content', 'previews'),
        article: page.kind === 'article' ? page.target : null,
      })
    : collectBucketOrphans(pageId, root);
  if (!names.length) {
    if (known) {
      out(`页 ${pageId} 没有孤儿账本。`);
    } else if (parsed.flags['dry-run']) {
      out(`桶 ${pageId} 不在任何页里，也没有账本；--dry-run：桶目录待删（ppnt prune ${pageId} 落盘）。`);
    } else {
      fs.rmSync(bucket, { recursive: true, force: true });
      out(`桶 ${pageId} 不在任何页里，也没有账本；桶目录删了：${bucket}`);
    }
    return 0;
  }
  for (const name of names) out(`${path.join(bucket, name)}${known ? '' : '（页已不存在，整桶孤儿）'}`);
  if (parsed.flags['dry-run']) {
    out(`--dry-run：${names.length} 本孤儿账本待删（ppnt prune ${pageId} 落盘）。`);
    return 0;
  }
  let images = 0;
  for (const name of names) {
    fs.rmSync(path.join(bucket, name), { force: true });
    // 该账本独有的图片：文件名前缀 = 账本 key（不含 .json）+ '-'。
    const prefix = `${name.replace(/\.json$/, '')}-`;
    const imagesDir = path.join(bucket, 'images');
    if (fs.existsSync(imagesDir)) {
      for (const file of fs.readdirSync(imagesDir)) {
        if (!file.startsWith(prefix)) continue;
        const fileAbs = path.join(imagesDir, file);
        if (fs.statSync(fileAbs).isFile()) {
          fs.rmSync(fileAbs, { force: true });
          images += 1;
        }
      }
    }
  }
  // 页已不在：账本删完，桶里只剩 _seq.json、图片之类，整个桶目录一起删。桶目录在盘上就能写
  // （docs/annotation.md“孤儿”），留着空目录，迟到的保存会把行写回来；目录没了，服务不新建页已不在的桶。
  if (!known) {
    fs.rmSync(bucket, { recursive: true, force: true });
    out(`已删除 ${names.length} 本孤儿账本，页已不在，桶目录也删了：${bucket}`);
    return 0;
  }
  out(`已删除 ${names.length} 本孤儿账本${images ? ` 与 ${images} 个孤儿图片` : ''}。`);
  return 0;
}

/**
 * `ppnt mv <旧 id> <新 id>`：预检四件事都能做 → 换 id → 改标注桶名 → 重写 /sites/ 前缀 →
 * 探活服务并 reload。id 是登记表、标注桶、资源 URL 三处的同一个地址，所以这三处
 * 必须一起改（2026-09-03 实迁：只改了登记表，页面资源整段 404 却看不出来）。parsed = { id, newId, flags }。
 */
export async function renameEntry(parsed, io = {}) {
  const { cwd, env, out, err, requestFn } = ioOf(io);
  let plan;
  try {
    plan = planRename(parsed, { cwd, env });
  } catch (error) {
    err(`${error instanceof CliError ? '错误' : '改 id 失败'}：${error.message}`);
    return 1;
  }
  if (parsed.flags && parsed.flags['dry-run']) {
    out(`计划：${plan.before.id} 改 id 成 ${plan.after.id}（${plan.before.kind}）：${entryTargetDesc(plan.before)}`);
    out('  登记表：条目改名');
    if (plan.bucketExists) out(`  标注桶：${plan.bucketFrom} → ${plan.bucketTo}`);
    else if (plan.before.kind !== 'project') out(`  标注桶：${plan.bucketFrom} 不存在，没有标注要搬`);
    for (const move of plan.articleMoves || []) out(`  文章桶：${move.from} → ${move.to}`);
    if (plan.before.kind === 'project' && !(plan.articleMoves || []).length) out(`  文章桶：没有 ${plan.before.id}_<文章> 桶要搬`);
    if (plan.projectJson) out(`  project.json：id ${plan.before.id} → ${plan.after.id}（${plan.projectJson}）`);
    if (plan.rewriteDir) {
      out(plan.rewritePreview.length
        ? `  资源前缀：${plan.rewritePreview.length} 个文件里的 /sites/${plan.before.id}/ 换成 /sites/${plan.after.id}/`
        : `  资源前缀：没有文件写着 /sites/${plan.before.id}/`);
      for (const file of plan.rewritePreview) out(`    ${file}`);
    }
    out('--dry-run：什么都没写，去掉 --dry-run 再跑。');
    return 0;
  }

  let recovery;
  let renamed;
  try {
    recovery = beginMoveRecovery(plan.dataRoot, [
      plan.registryPath, plan.projectJson,
      ...(plan.bucketExists ? [plan.bucketFrom, plan.bucketTo] : []),
      ...plan.articleMoves.flatMap((move) => [move.from, move.to]),
      ...plan.rewritePreview.map((file) => path.join(plan.rewriteDir, file)),
    ], {
      followWrites: [plan.projectJson, ...plan.rewritePreview.map((file) => path.join(plan.rewriteDir, file))].filter(Boolean),
      watchContents: [plan.bucketFrom, plan.bucketTo, ...plan.articleMoves.flatMap((move) => [move.from, move.to])],
    });
    renamed = recovery.step('登记表改名', () => recovery.replaceFile(plan.registryPath, (file) => renameRegistryEntry(file, plan.before.id, plan.after.id)));
    if (plan.bucketExists) recovery.step('标注桶改名', () => recovery.rename(plan.bucketFrom, plan.bucketTo));
    for (const move of plan.articleMoves) {
      recovery.step(`文章桶 ${move.fromId} 改名`, () => recovery.rename(move.from, move.to));
      move.rewritten = recovery.step(`文章桶 ${move.toId} 账本与附件地址`, () => rewriteMovedBucket(move.to, move, recovery));
    }
    if (plan.projectJson) {
      recovery.step('project.json', () => {
        const json = JSON.parse(fs.readFileSync(plan.projectJson, 'utf8'));
        recovery.writeFile(plan.projectJson, JSON.stringify({ ...json, id: plan.after.id }, null, 2) + '\n');
      });
    } else if (plan.rewriteDir) {
      recovery.step('资源前缀', () => rewriteSitePrefixUnder(plan.rewriteDir, plan.before.id, plan.after.id, { writeFile: recovery.writeFile }));
    }
    recovery.commit(err);
  } catch (error) {
    if (recovery) return recovery.rollback(error, err);
    err(`改 id 备份失败，关键数据未改：${error.message}`);
    return 1;
  }
  out(`已改 id：${plan.before.id} → ${renamed.entry.id}（${renamed.entry.kind}）：${entryTargetDesc(renamed.entry)}`);
  out('  登记表：条目已改名');
  if (plan.bucketExists) out(`  标注桶：${plan.bucketFrom} → ${plan.bucketTo}`);
  else if (plan.before.kind !== 'project') out(`  标注桶：${plan.bucketFrom} 不存在，没有标注要搬`);
  if (plan.projectJson) out(`  project.json：id ${plan.before.id} → ${plan.after.id}（${plan.projectJson}）`);
  if (plan.rewriteDir) {
    out(plan.rewritePreview.length
      ? `  资源前缀：${plan.rewritePreview.length} 个文件里的 /sites/${plan.before.id}/ 已换成 /sites/${plan.after.id}/`
      : `  资源前缀：没有文件写着 /sites/${plan.before.id}/`);
    for (const file of plan.rewritePreview) out(`    ${file}`);
  } else if (!plan.projectJson) {
    out(`  资源前缀：${plan.before.kind} 条目没有目录可扫，跳过`);
  }

  // 关键数据已提交，缓存能再生：失败只警告，不影响迁移结果。
  for (const move of plan.articleMoves) {
    out(`  文章桶：${move.from} → ${move.to}${move.rewritten.length ? `（账本改写：${move.rewritten.join('、')}）` : ''}`);
    for (const dir of PAGE_CACHE_MOVE) {
      const from = path.join(plan.dataRoot, dir, move.fromId);
      if (!fs.existsSync(from)) continue;
      const to = path.join(plan.dataRoot, dir, move.toId);
      try {
        fs.rmSync(to, { recursive: true, force: true });
        fs.renameSync(from, to);
        out(`    ${dir}/${move.fromId} → ${dir}/${move.toId}`);
      } catch (error) {
        err(`    注意：缓存 ${dir}/${move.fromId} 没搬，还在旧名下（${from}）；可以删掉，下次 ppnt ${dir} 重新生成：${error.message}`);
      }
    }
    move.hadDist = fs.existsSync(path.join(plan.dataRoot, 'dist', move.fromId));
    for (const dir of PAGE_CACHE_DROP) {
      const stale = path.join(plan.dataRoot, dir, move.fromId);
      if (!fs.existsSync(stale)) continue;
      try {
        fs.rmSync(stale, { recursive: true, force: true });
        out(`    ${dir}/${move.fromId} 已删（产物写死了旧的 /sites/ 地址）`);
      } catch (error) {
        err(`    注意：缓存 ${dir}/${move.fromId} 没删掉（${stale}），它写死了旧的 /sites/ 地址，可以手动删：${error.message}`);
      }
    }
  }

  // project 的源文件 rename 不改：写死了 /sites/<旧 id>_<文章>/ 的文件列出来让作者改。
  if (plan.sitePrefixFiles && plan.sitePrefixFiles.length) {
    err(`  注意：这些文件写死了 /sites/${plan.before.id}_…/，ppnt mv 不改源文件，请改成 /sites/${plan.after.id}_…/ 或相对路径：`);
    for (const file of plan.sitePrefixFiles) err(`    ${path.join(plan.before.path, PROJECT_CONTENT_DIR, file)}`);
  }

  // ③' 文章画布：旧 dist 删了的，按新页 id 重编一次（和 `ppnt build <页>` 同一个编译器）。
  const rebuild = (plan.articleMoves || []).filter((move) => move.hadDist);
  if (rebuild.length) {
    const { compilePage, resolvePageTarget } = await import('../../src/server/lib/page-compiler.js');
    const registry = loadRegistry({ root: REPO_ROOT, path: plan.registryPath });
    for (const move of rebuild) {
      const target = resolvePageTarget(move.toId, { registry, root: REPO_ROOT });
      if (!target) {
        out(`  画布 ${move.toId}：文章已不在盘上，不重编`);
        continue;
      }
      try {
        const result = await compilePage(target, { distRoot: path.join(plan.dataRoot, 'dist') });
        out(`  画布 ${move.toId}：已重编${result.ok ? '' : `（有失败，跑 \`ppnt build ${move.toId}\` 看详情）`}`);
      } catch (error) {
        err(`  画布 ${move.toId} 重编失败：${error.message}；跑 \`ppnt build ${move.toId}\``);
      }
    }
  }

  out(`registry：${plan.registryPath}`);
  // ④ 重载
  await reloadService({ env, requestFn, registryPath: plan.registryPath, out, err });
  return 0;
}

/* ---------------------------- remove（删条目） ----------------------------
   删条目与 rename 相反：id 从三处地址里退场——登记表去掉一行，/sites/<id>/
   前缀不再有人应答，标注桶只在空的时候才允许跟着删。所以动手前要把桶里的
   标注行数清楚，有行就整单不动。 */

/** parse + 定位既有条目 + 预检标注桶（不写盘、不联网）。 */
export function planRemove(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) return parsed;
  const registryPath = resolveRegistryPath(parsed.flags, env, cwd);
  const id = parsed.id;
  const entries = existingEntriesFor(registryPath);
  const before = entries.find((entry) => entry && entry.id === id);
  if (!before) {
    const known = entries.map((entry) => entry && entry.id).filter(Boolean).join('、');
    throw new CliError(`条目不存在：${id}${known ? `（现有：${known}）` : ''}`);
  }
  // 桶里有标注行就拒绝：删登记随时可以重新 add 找回，删行找不回来。
  const root = dataRoot(env);
  const bucket = path.join(root, id);
  // project id 本身不是桶，project 的桶是下面的文章桶。
  const isProject = before.kind === 'project';
  const rows = isProject ? 0 : checkedBucketRowCount(bucket);
  if (rows > 0) {
    throw new CliError(
      `标注桶 ${bucket} 里还有 ${rows} 行标注；先在工作台处理掉，或 \`pinpoint prune ${id}\`（--dry-run 先看清单）清完再 remove`,
    );
  }
  // project：每篇文章的桶 <id>_<文章> 守同一条规则——有标注行就拒绝，空桶跟着删。
  const articleBuckets = isProject
    ? articleBucketIds(root, id, { manifestIds: manifestPageIds() }).map((pageId) => ({ pageId, dir: path.join(root, pageId), rows: checkedBucketRowCount(path.join(root, pageId)) }))
    : [];
  const busy = articleBuckets.filter((item) => item.rows > 0);
  if (busy.length) {
    throw new CliError(
      `文章桶里还有标注：${busy.map((item) => `${item.pageId}（${item.rows} 行）`).join('、')}；` +
      `先在工作台处理掉，或逐个 \`pinpoint prune <页>\` 清完再 remove ${id}`,
    );
  }
  return { ...parsed, registryPath, before, bucket, bucketExists: !isProject && fs.existsSync(bucket), rows, articleBuckets };
}

/**
 * 执行一次 remove：预检（id 存在、桶里没有标注行）→ 从登记表去掉条目
 * → 空桶顺手删 → 探活服务 → 可达则 reload。只删登记，条目指向的源文件 / URL
 * 原地不动，重新 `pinpoint add` 同一个目标即恢复登记。
 */
export async function runRemove(argv, io = {}) {
  const { cwd, env, out, err, requestFn } = ioOf(io);

  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  let plan;
  try {
    plan = planRemove(argv, { cwd, env });
  } catch (error) {
    err(`${error instanceof CliError ? '错误' : '删除失败'}：${error.message}`);
    return 1;
  }

  let removed;
  try {
    removed = removeRegistryEntry(plan.registryPath, plan.id);
  } catch (error) {
    err(`删除失败：${error.message}`);
    return 1;
  }
  out(`已从登记表删除 ${removed.id}（${removed.kind}）：${entryTargetDesc(removed)}`);
  out(`  源文件不动：${entryTargetDesc(removed)} 还在原地，重新 \`pinpoint add\` 即恢复登记。`);
  // 删桶时服务可能正好在往里写（一次保存的临时文件刚建出来）：rmSync 遇到 ENOTEMPTY
  // 重试几次，不让 CLI 在登记表已改之后抛栈退出。那次保存自己会回 503 bucket_gone。
  const rmBucket = { recursive: true, force: true, maxRetries: 3 };
  if (plan.bucketExists) {
    fs.rmSync(plan.bucket, rmBucket);
    out(`  标注桶 ${plan.bucket} 里没有标注行，已顺手删掉。`);
  } else if (plan.before.kind !== 'project') {
    out(`  标注桶 ${plan.bucket} 不存在，没有桶要清。`);
  }
  for (const item of plan.articleBuckets || []) {
    fs.rmSync(item.dir, rmBucket);
    out(`  文章桶 ${item.dir} 里没有标注行，已顺手删掉。`);
  }
  out(`registry：${plan.registryPath}`);
  await reloadService({ env, requestFn, registryPath: plan.registryPath, out, err });
  return 0;
}
