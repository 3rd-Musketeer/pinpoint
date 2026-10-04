import fs from 'node:fs';
import path from 'node:path';

import { dataRoot } from '../../src/server/lib/annotate-data-dir.js';
import { manifestPageIds as libManifestPageIds } from '../../src/server/lib/page-manifest.js';
import { defaultEntries, defaultRegistryPath, ENTRY_ID_PATTERN, loadRegistry, PAGE_ID_PATTERN } from '../../src/server/lib/registry.js';
import { collectBucketOrphans, collectPageOrphans, readBucketLedgers } from '../../src/server/lib/orphans.js';
import { addRegistryEntry, listRegistryEntries, removeRegistryEntry, renameRegistryEntry, updateRegistryEntry } from '../../src/server/lib/registry-store.js';

import { DEFAULT_ORIGIN, REPO_ROOT, CliError, slugify, ioOf } from './core.js';
import { BOARDS, parseArgs, guardParse } from './args.js';

function isHttpUrl(target) {
  return /^https?:\/\//i.test(target);
}

/** 一个目标（目录 / .html 文件 / http(s) URL）解析成 registry 的 kind + 落点。
    add 与 move 共用同一套校验：路径必须真的存在，单文件必须是 html。 */
export function resolveTarget(target, cwd = process.cwd()) {
  if (isHttpUrl(target)) {
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      throw new CliError(`URL 不合法：${target}`);
    }
    return { kind: 'url', url: target, baseName: parsed.hostname, idSeed: parsed.hostname };
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
  return entry && (entry.kind === 'url' ? entry.url : entry.path);
}

function idTakenError(id, existing) {
  const where = existing ? `，指向 ${entryTargetDesc(existing)}` : '';
  return new CliError(
    `id 已存在：${id}${where}；更新路径用 \`pinpoint move ${id} <新路径>\`，要新条目请显式 \`--id <其他 id>\``,
  );
}

/**
 * 由目标构造 registry 条目（纯函数 + fs 探测；不写盘）。
 * takenEntries：现有条目（供 id 查重与「已存在，指向哪」的提示，同时是可归属的
 * registry 页面名单）；takenIds 是它的 id 投影，测试可只给 id；
 * pageIds：本地 manifest 页 id 名单（缺省读仓库 content/previews/_index[.local].json）。
 */
export function buildEntry(target, flags = {}, { cwd = process.cwd(), takenEntries = [], takenIds, pageIds } = {}) {
  const existingIds = takenIds || takenEntries.map((entry) => entry && entry.id);
  const findExisting = (id) => takenEntries.find((entry) => entry && entry.id === id) || null;
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

  // 阶段 8（产物与草稿模型）：--page 把条目挂到既有页 —— 不再自成 Pages
  // 行，作为目标页「内容」区的 doc 条目出现；--draft 落草稿组（缺省产物组）。
  if (flags.draft && !flags.page) {
    throw new CliError('--draft 需要搭配 --page（草稿归属某个 Page 的草稿组）');
  }
  let page;
  if (flags.page !== undefined) {
    if (kind === 'url') {
      throw new CliError('url 条目恒为独立页（经代理内嵌的网页产物），--page 只适用于目录 / 文件');
    }
    if (!PAGE_ID_PATTERN.test(flags.page)) {
      throw new CliError(`--page 必须匹配 ${PAGE_ID_PATTERN}：${flags.page}`);
    }
    const resolvable = new Set([...(pageIds || manifestPageIds()), ...existingIds]);
    if (!resolvable.has(flags.page)) {
      throw new CliError(`--page 目标页不可解析：${flags.page}（既不是本地 manifest 页，也不是已登记的 registry 条目；不会静默写坏 registry）`);
    }
    page = flags.page;
  }

  const entry = { id, title: flags.title || resolved.baseName, kind };
  if (kind === 'url') entry.url = resolved.url;
  else entry.path = resolved.absPath;
  if (board) entry.board = board;
  if (page) entry.page = page;
  if (flags.draft) entry.role = 'draft';
  return entry;
}

/** 本地 manifest 页 id 列表（实现在 src/server/lib/page-manifest.js，服务端的
    文件夹写接口用的是同一份）。缺省读本 CLI 所在仓库。 */
export function manifestPageIds(root = REPO_ROOT) {
  return libManifestPageIds(root);
}

/**
 * move 的新条目（纯函数 + fs 探测；不写盘）：只换 kind 与落点，id / title /
 * page / role 原样带走——标注桶按页寻址（桶 = 页），换路径不该动标注归属。
 */
export function buildMove(id, target, { cwd = process.cwd(), entries = [] } = {}) {
  const before = entries.find((entry) => entry && entry.id === id);
  if (!before) {
    const known = entries.map((entry) => entry && entry.id).filter(Boolean).join('、');
    throw new CliError(`条目不存在：${id}${known ? `（现有：${known}）` : ''}`);
  }
  const resolved = resolveTarget(target, cwd);
  const after = { ...before, kind: resolved.kind };
  if (resolved.kind === 'url') {
    after.url = resolved.url;
    delete after.path;
  } else {
    after.path = resolved.absPath;
    delete after.url;
  }
  // board 只对 dir 条目有意义（file 恒 doc 阅读器，url 恒合成单屏板）。
  if (resolved.kind !== 'dir') delete after.board;
  if (resolved.kind === 'url' && after.page) {
    throw new CliError(`条目 ${id} 挂在页面「${after.page}」上，不能改指 url（url 条目恒为独立页）；先改归属再 move`);
  }
  return { before, after };
}

/* ---------------------------- rename（改 id） ----------------------------
   id 是三个地方的地址：登记表的条目 id、标注桶 ~/.pinpoint/<id>/、以及页面资源
   的 URL 前缀 /sites/<id>/。手改其中一个，另外两个就此错位——2026-09-03 实迁
   （mcp-confirm + artifact-v2 合并成 chat-cards）踩到的正是第三个：机壳和内联
   HTML 还在，JS 注入的卡整段消失，看起来像设计坏了。rename 把三处一次改齐。 */

/** 会被扫的扩展名：HTML 是主场，CSS/JS sidecar 里也会写死 /sites/<id>/ 前缀。 */
const SITE_PREFIX_EXTS = new Set(['.html', '.htm', '.css', '.js']);

/** `/sites/<旧 id>/` → `/sites/<新 id>/`：精确前缀的纯字符串替换，不碰别的。 */
export function rewriteSitePrefix(text, oldId, newId) {
  const from = `/sites/${oldId}/`;
  if (!text.includes(from)) return { text, changed: false };
  return { text: text.split(from).join(`/sites/${newId}/`), changed: true };
}

/**
 * 条目目录下所有 *.html/*.css/*.js 里的 /sites/<旧 id>/ 换成新前缀。
 * 跳过 node_modules 与逃出条目目录的 symlink（那些文件不归这个条目管），
 * 按 realpath 记账避免 symlink 成环。返回被改写的文件相对路径列表。
 * dryRun 只统计不落盘（预检用）。
 */
export function rewriteSitePrefixUnder(dirPath, oldId, newId, { dryRun = false } = {}) {
  const root = fs.realpathSync(dirPath);
  const changed = [];
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
      if (!stat.isFile() || !SITE_PREFIX_EXTS.has(path.extname(item.name).toLowerCase())) continue;
      let text;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const next = rewriteSitePrefix(text, oldId, newId);
      if (!next.changed) continue;
      if (!dryRun) fs.writeFileSync(full, next.text);
      changed.push(path.relative(root, full));
    }
  };
  walk(root);
  return changed;
}

/**
 * rename 的新条目（纯函数）：只换 id，kind / 落点 / title / 归属原样带走；
 * 挂在旧 id 上的条目（page 字段）跟着改，否则它们会指向一个不存在的页。
 * 返回 { before, after, attached }（attached = 要改 page 字段的条目 id）。
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
      `id 已存在：${newId}，指向 ${entryTargetDesc(clash)}；把两个条目并成一个 = 先 rename 再 \`pinpoint move\``,
    );
  }
  const after = { ...before, id: newId };
  const attached = entries
    .filter((entry) => entry && entry.id !== oldId && entry.page === oldId)
    .map((entry) => entry.id);
  return { before, after, attached };
}

/** parse + 构造 + 四件事的预检（不写盘、不联网）：任何一件做不了就整单不动手。 */
export function planRename(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) return parsed;
  const registryPath = resolveRegistryPath(parsed.flags, env, cwd);
  const { before, after, attached } = buildRename(parsed.id, parsed.newId, {
    entries: existingEntriesFor(registryPath),
  });

  // ② 标注桶：旧桶在就改名，新桶已存在是硬冲突（两份标注不能合）。
  const root = dataRoot(env);
  const bucketFrom = path.join(root, before.id);
  const bucketTo = path.join(root, after.id);
  const bucketExists = fs.existsSync(bucketFrom);
  if (bucketExists && fs.existsSync(bucketTo)) {
    throw new CliError(`标注桶已存在：${bucketTo}；先处理掉它再改 id（两个桶不会自动合并）`);
  }

  // ③ 资源前缀：只有 dir 条目有目录可扫；目录不在就先 move 到真实路径。
  let rewriteDir = null;
  let rewritePreview = [];
  if (before.kind === 'dir') {
    if (!fs.existsSync(before.path)) {
      throw new CliError(`条目 ${before.id} 的目录不存在：${before.path}；先 \`pinpoint move ${before.id} <真实路径>\` 再改 id`);
    }
    rewriteDir = before.path;
    rewritePreview = rewriteSitePrefixUnder(rewriteDir, before.id, after.id, { dryRun: true });
  }

  return { ...parsed, registryPath, before, after, attached, bucketFrom, bucketTo, bucketExists, rewriteDir, rewritePreview };
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

/** parse + 定位既有条目 + 构造新落点，返回一次 move 的全部输入（不写盘、不联网）。 */
export function planMove(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) return parsed;
  const registryPath = resolveRegistryPath(parsed.flags, env, cwd);
  const { before, after } = buildMove(parsed.id, parsed.target, { cwd, entries: existingEntriesFor(registryPath) });
  return { ...parsed, registryPath, before, after };
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
    out(`服务已重载（registry 共 ${summary.entries} 条）。`);
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
    // 参数形状没问题，是目标本身不成立（路径不存在、id 撞车、目标页不可解析…）
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
  if (entry.page) {
    out(`归属 Page「${entry.page}」的「内容」区${entry.role === 'draft' ? '草稿组' : '产物组'}；不新增 Pages 行。`);
  }
  out(`registry：${plan.registryPath}`);
  await reloadService({ env, requestFn, registryPath: plan.registryPath, out, err });
  return 0;
}

/**
 * 执行一次 move：原子改写既有条目的落点 → 探活服务 → 可达则 reload。
 * id 与 title 不变，所以 ~/.pinpoint/<id>/ 里的既有标注继续对得上。
 */
export async function runMove(argv, io = {}) {
  const { cwd, env, out, err, requestFn } = ioOf(io);

  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  let plan;
  try {
    plan = planMove(argv, { cwd, env });
  } catch (error) {
    err(`${error instanceof CliError ? '错误' : '重指失败'}：${error.message}`);
    return 1;
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
 * 孤儿 = 表面已不存在（文档文件没了 / url 条目移走 / 页不在 registry 与
 * manifest 里 = 整桶皆孤儿）。owner 裁决：孤儿不备份，直接删；--dry-run 先看
 * 清单。账本自己的图片（images/<账本 key>-*）一并清掉。
 */
export async function runPrune(argv, io = {}) {
  const { env, out, err } = ioOf(io);
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const pageId = String(parsed.target || '');
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
  const known = registry.resolve(pageId) != null || localIds.includes(pageId);
  const names = known
    ? collectPageOrphans({
        pageId,
        dataRoot: root,
        entries: registry.entries,
        isManifestPage: !registry.resolve(pageId) && localIds.includes(pageId),
        previewsRoot: path.join(REPO_ROOT, 'content', 'previews'),
      })
    : collectBucketOrphans(pageId, root);
  if (!names.length) {
    out(known ? `页 ${pageId} 没有孤儿账本。` : `桶 ${pageId} 不在任何页里，但也没有账本。`);
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
  out(`已删除 ${names.length} 本孤儿账本${images ? ` 与 ${images} 个孤儿图片` : ''}。`);
  return 0;
}

/**
 * 执行一次 rename：预检四件事都能做 → 换 id → 改标注桶名 → 重写 /sites/ 前缀 →
 * 探活服务并 reload。id 是登记表、标注桶、资源 URL 三处的同一个地址，所以这三处
 * 必须一起改（2026-09-03 实迁：只改了登记表，页面资源整段 404 却看不出来）。
 */
export async function runRename(argv, io = {}) {
  const { cwd, env, out, err, requestFn } = ioOf(io);

  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  let plan;
  try {
    plan = planRename(argv, { cwd, env });
  } catch (error) {
    err(`${error instanceof CliError ? '错误' : '改 id 失败'}：${error.message}`);
    return 1;
  }

  // ① 登记表
  let renamed;
  try {
    renamed = renameRegistryEntry(plan.registryPath, plan.before.id, plan.after.id);
  } catch (error) {
    err(`改 id 失败：${error.message}`);
    return 1;
  }
  out(`已改 id：${plan.before.id} → ${renamed.entry.id}（${renamed.entry.kind}）：${entryTargetDesc(renamed.entry)}`);
  out(renamed.attached.length
    ? `  登记表：条目已改名；挂在它上面的 ${renamed.attached.length} 条也跟着改（${renamed.attached.join('、')}）`
    : '  登记表：条目已改名');

  // ② 标注桶
  if (plan.bucketExists) {
    try {
      fs.renameSync(plan.bucketFrom, plan.bucketTo);
      out(`  标注桶：${plan.bucketFrom} → ${plan.bucketTo}`);
    } catch (error) {
      err(`  标注桶改名失败（登记表已改，标注还在旧桶）：${error.message}`);
      return 1;
    }
  } else {
    out(`  标注桶：${plan.bucketFrom} 不存在，没有标注要搬`);
  }

  // ③ 资源前缀
  if (plan.rewriteDir) {
    const changed = rewriteSitePrefixUnder(plan.rewriteDir, plan.before.id, plan.after.id);
    out(changed.length
      ? `  资源前缀：${changed.length} 个文件里的 /sites/${plan.before.id}/ 已换成 /sites/${plan.after.id}/`
      : `  资源前缀：没有文件写着 /sites/${plan.before.id}/`);
    for (const file of changed) out(`    ${file}`);
  } else {
    out(`  资源前缀：${plan.before.kind} 条目没有目录可扫，跳过`);
  }

  out(`registry：${plan.registryPath}`);
  // ④ 重载
  await reloadService({ env, requestFn, registryPath: plan.registryPath, out, err });
  return 0;
}

/* ---------------------------- remove（删条目） ----------------------------
   删条目与 rename 相反：id 从三处地址里退场——登记表去掉一行，/sites/<id>/
   前缀不再有人应答，标注桶只在空的时候才允许跟着删。所以动手前要把「还有
   什么挂在 id 上」数清楚：挂靠条目、桶里的标注行，数不平就整单不动。 */

/** parse + 定位既有条目 + 预检挂靠与标注桶（不写盘、不联网）。 */
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
  // 挂靠条目的 page 字段指着它：删掉宿主，那些条目会在 workbench 里静默消失
  //（rename 换 id 时必须带上它们，是同一个原因的反向）。
  const attached = entries
    .filter((entry) => entry && entry.page === id)
    .map((entry) => entry.id);
  if (attached.length) {
    throw new CliError(
      `条目 ${id} 还被 ${attached.length} 条挂靠（${attached.join('、')} 的 page 字段指着它）；` +
      `先把它们 remove 掉（重新 add 时用 --page 挂到别的页），再 remove ${id}`,
    );
  }
  // 桶里有标注行就拒绝：删登记随时可以重新 add 找回，删行找不回来。
  const bucket = path.join(dataRoot(env), id);
  const rows = readBucketLedgers(bucket)
    .reduce((sum, ledger) => sum + (Array.isArray(ledger.doc && ledger.doc.annotations) ? ledger.doc.annotations.length : 0), 0);
  if (rows > 0) {
    throw new CliError(
      `标注桶 ${bucket} 里还有 ${rows} 行标注；先在工作台处理掉，或 \`pinpoint prune ${id}\`（--dry-run 先看清单）清完再 remove`,
    );
  }
  return { ...parsed, registryPath, before, bucket, bucketExists: fs.existsSync(bucket), rows };
}

/**
 * 执行一次 remove：预检（id 存在、无挂靠、桶里没有标注行）→ 从登记表去掉条目
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
  out(`  源文件 / URL 不动：${entryTargetDesc(removed)} 还在原地，重新 \`pinpoint add\` 即恢复登记。`);
  if (plan.bucketExists) {
    fs.rmSync(plan.bucket, { recursive: true, force: true });
    out(`  标注桶 ${plan.bucket} 里没有标注行，已顺手删掉。`);
  } else {
    out(`  标注桶 ${plan.bucket} 不存在，没有桶要清。`);
  }
  out(`registry：${plan.registryPath}`);
  await reloadService({ env, requestFn, registryPath: plan.registryPath, out, err });
  return 0;
}

/* ============================== folder（分组） ==============================
   2026-09-04 裁决 5a：owner 自己建夹、把页拖进去，一层不嵌套。拖放在 workbench
   里做（走服务端的三个 PUT），CLI 是同一份登记表的另一个入口——建夹 / 改名 /
   删夹 / 归属，都是「全部校验 → 一次原子写 → 重载服务」，与 rename 同一套姿态。
   删夹永远不删页：夹里的页丢掉归属变成散页。 */
