/**
 * pinpoint CLI — 登记评审入口（bin/pinpoint.mjs 的纯函数层，node --test 直接测这里）。
 *
 * pinpoint 是 HTML 宿主：想让一个页面进 pinpoint，就用 `pinpoint add`。
 * 静态内容（目录 / 单个 .html）由服务直接 host 在 /sites/<id>/；活的应用
 * 登记 URL（代理映射是后续阶段，本轮只登记，浏览器扩展按 origin 注入）。
 * 文件留在原地，CLI 只登记路径/URL。
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultEntries, defaultRegistryPath, ENTRY_ID_PATTERN, PAGE_ID_PATTERN } from '../server/lib/registry.js';
import { addRegistryEntry, listRegistryIds } from '../server/lib/registry-store.js';

export const DEFAULT_ORIGIN = 'https://pinpoint.localhost';

// CLI 住在仓库里，仓库根就是 pinpoint workbench 自己的 dir entry 路径——
// 首次 add（registry 文件还不存在）时用它播种默认 pinpoint 条目，与
// loadRegistry 的 missing-file 语义一致，workbench 自己的标注桶不会丢。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BOARDS = new Set(['ios', 'html']);
// 值选项与布尔开关（布尔开关不吃下一个 token，也不许带 =值）。
const VALUE_FLAGS = new Set(['title', 'board', 'id', 'registry', 'page']);
const BOOLEAN_FLAGS = new Set(['draft']);

export class CliError extends Error {}

export const USAGE = `用法：
  pinpoint add <目录|文件.html|http(s)://URL> [选项]

把评审目标登记进 pinpoint registry（文件留在原地，CLI 只登记路径/URL）：
  目录             → kind "dir"，服务只读 host 在 /sites/<id>/ 并注入标注
  单个 .html 文件  → kind "file"，仅 serve 该文件（/sites/<id>/ 与 /sites/<id>/<文件名>）
  http(s)://URL    → kind "url"，浏览器扩展按 origin 注入

选项：
  --title X        显示名（默认：目录名 / 文件名 / hostname）
  --board X        workbench 壳：ios | html（默认 html；仅 dir 条目生效，file 恒 doc）
  --id xxx         显式 id（默认由名称 slug 派生，冲突自动追加 -2/-3；显式 id 冲突报错）
  --page xxx       归属到既有 Page（本地 manifest 页或另一 registry 条目）：不再自成
                   Pages 行，作为目标页「内容」区的 doc 条目出现（仅 dir/file；url 恒独立页）
  --draft          搭配 --page：条目落目标页的草稿组（缺省落产物组）
  --registry 路径  覆盖 registry 文件位置
                  （默认 ~/.pinpoint/registry.json；亦可用 PINPOINT_REGISTRY 环境变量）
  -h, --help       显示本说明

环境变量：
  PINPOINT_REGISTRY   同 --registry（--registry 优先）
  PINPOINT_ORIGIN     服务地址（默认 ${DEFAULT_ORIGIN}）；登记后 CLI 会
                      GET /health 探活，可达则 POST /registry/reload 即时生效`;

/** 参数解析（纯函数）。返回 { command, target, flags }；非法输入抛 CliError。 */
export function parseArgs(argv) {
  const args = [...argv];
  if (args.includes('-h') || args.includes('--help')) return { help: true };
  const command = args.shift();
  if (command !== 'add') {
    throw new CliError(command ? `未知命令：${command}` : '缺少命令（目前只有 add）');
  }
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const inline = arg.includes('=') ? arg.indexOf('=') : -1;
    const name = inline > 0 ? arg.slice(2, inline) : arg.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      // 布尔开关：不吃下一个 token，也不许 --draft=xxx 带值。
      if (inline > 0) throw new CliError(`选项 --${name} 是开关，不带值`);
      flags[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new CliError(`未知选项：--${name}`);
    }
    const value = inline > 0 ? arg.slice(inline + 1) : args[++i];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new CliError(`选项 --${name} 缺少值`);
    }
    flags[name] = value;
  }
  if (positional.length !== 1) {
    throw new CliError(positional.length === 0 ? 'add 需要一个目标（目录 / 文件 / URL）' : `add 只接受一个目标，收到 ${positional.length} 个`);
  }
  return { command, target: positional[0], flags };
}

/** basename → registry id 基材：小写、非字母数字折叠成 -、去首尾 -。 */
export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** 派生 id：被占用时追加 -2 / -3 …（仅用于自动派生；显式 --id 冲突是报错）。 */
export function deriveId(base, takenIds) {
  const taken = new Set(takenIds);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function isHttpUrl(target) {
  return /^https?:\/\//i.test(target);
}

/** 本地 manifest 页 id 列表（_index.local.json 优先，缺失回落 tracked _index.json；
    与 workbench loadPageManifest 同源）。文件损坏时返回 []——页面归属校验随之
    只认 registry 条目，报错比静默写坏 registry 好。 */
export function localManifestPageIds(root = REPO_ROOT) {
  for (const name of ['_index.local.json', '_index.json']) {
    const file = path.join(root, 'previews', name);
    if (!fs.existsSync(file)) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (doc && Array.isArray(doc.pages)) {
        return doc.pages.map((page) => page && page.id).filter((id) => typeof id === 'string');
      }
      return []; // 存在的 manifest 损坏 = 诚实空列表（workbench 同样会报错）
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 由目标构造 registry 条目（纯函数 + fs 探测；不写盘）。
 * takenIds：现有条目 id 列表（供派生 id 避让与显式 id 查重，同时是可归属的
 * registry 页面名单）；pageIds：本地 manifest 页 id 名单（缺省读仓库
 * previews/_index[.local].json，测试可注入）。
 */
export function buildEntry(target, flags = {}, { cwd = process.cwd(), takenIds = [], pageIds } = {}) {
  let kind;
  let absPath;
  let url;
  let baseName; // title 默认值
  let idSeed;   // id 派生基材
  if (isHttpUrl(target)) {
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      throw new CliError(`URL 不合法：${target}`);
    }
    kind = 'url';
    url = target;
    baseName = parsed.hostname;
    idSeed = parsed.hostname;
  } else {
    absPath = path.resolve(cwd, target);
    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch {
      throw new CliError(`路径不存在：${absPath}`);
    }
    if (stat.isDirectory()) {
      kind = 'dir';
      baseName = path.basename(absPath);
      idSeed = baseName;
    } else if (stat.isFile()) {
      const ext = path.extname(absPath).toLowerCase();
      if (ext !== '.html' && ext !== '.htm') {
        throw new CliError(`单个文件只支持 .html/.htm（要登记整个目录请传目录路径）：${absPath}`);
      }
      kind = 'file';
      baseName = path.basename(absPath);
      idSeed = path.basename(absPath, path.extname(absPath)); // id 不带扩展名（保留原大小写截取）：report.html → report
    } else {
      throw new CliError(`不支持的路径类型（既不是目录也不是文件）：${absPath}`);
    }
  }

  let id;
  if (flags.id) {
    if (!ENTRY_ID_PATTERN.test(flags.id)) {
      throw new CliError(`--id 必须匹配 ${ENTRY_ID_PATTERN}（小写字母/数字/中划线，字母或数字开头）：${flags.id}`);
    }
    if (takenIds.includes(flags.id)) {
      throw new CliError(`条目 id 已存在：${flags.id}（不会覆盖；换个 --id 或先手动移出旧条目）`);
    }
    id = flags.id;
  } else {
    const slug = slugify(idSeed);
    if (!slug) throw new CliError(`无法从 "${idSeed}" 派生 id，请用 --id 显式指定`);
    id = deriveId(slug, takenIds);
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

  // 阶段 8（产物与草稿模型）：--page 把条目归属到既有 Page —— 不再自成 Pages
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
    const resolvable = new Set([...(pageIds || localManifestPageIds()), ...takenIds]);
    if (!resolvable.has(flags.page)) {
      throw new CliError(`--page 目标页不可解析：${flags.page}（既不是本地 manifest 页，也不是已登记的 registry 条目；不会静默写坏 registry）`);
    }
    page = flags.page;
  }

  const entry = { id, title: flags.title || baseName, kind };
  if (kind === 'url') entry.url = url;
  else entry.path = absPath;
  if (board) entry.board = board;
  if (page) entry.page = page;
  if (flags.draft) entry.role = 'draft';
  return entry;
}

/** --registry > PINPOINT_REGISTRY > 默认；相对路径按 cwd 解析。 */
export function resolveRegistryPath(flags = {}, env = process.env, cwd = process.cwd()) {
  const explicit = flags.registry || env.PINPOINT_REGISTRY;
  return explicit ? path.resolve(cwd, explicit) : defaultRegistryPath();
}

/** parse + 查重 + 构造，返回一次 add 的全部输入（不写盘、不联网）。 */
export function planAdd(argv, { cwd = process.cwd(), env = process.env } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) return parsed;
  const registryPath = resolveRegistryPath(parsed.flags, env, cwd);
  // 文件还不存在时，写入会播种默认 pinpoint 条目——派生 id 必须同样避让。
  const takenIds = fs.existsSync(registryPath)
    ? listRegistryIds(registryPath)
    : defaultEntries(REPO_ROOT).map((entry) => entry.id);
  const entry = buildEntry(parsed.target, parsed.flags, { cwd, takenIds });
  return { ...parsed, registryPath, entry };
}

/**
 * 零依赖的 JSON 请求（GET/POST）。为什么不用全局 fetch：常驻服务经 portless
 * 代理暴露在 https://pinpoint.localhost，证书是本地自签 CA——curl 走系统
 * 钥匙串能验，node 的 fetch 读不到钥匙串会 SELF_SIGNED_CERT_IN_CHAIN。
 * 目标只是本机开发服务的探活/reload，故 https 关闭证书校验。
 * 返回 { status, json }；网络/超时错误 reject。
 */
export function requestJson(urlString, { method = 'GET', timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        rejectUnauthorized: false, // 本机自签代理，见函数注释
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch { /* 健康检查只要状态码；reload 一定是 JSON，json 为 null 时按失败处理 */ }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * 执行一次 add：写 registry → 探活服务 → 可达则 reload。返回进程退出码。
 * io: { cwd, env, out, err, requestFn } — 测试注入 out/err/requestFn 断言行为。
 */
export async function runAdd(argv, io = {}) {
  const cwd = io.cwd || process.cwd();
  const env = io.env || process.env;
  const out = io.out || ((line) => console.log(line));
  const err = io.err || ((line) => console.error(line));
  const requestFn = io.requestFn || requestJson;

  let plan;
  try {
    plan = planAdd(argv, { cwd, env });
  } catch (error) {
    // CliError = 用法问题（带 usage）；其余（如 registry 文件已损坏）同样是
    // 用户可读的错误，只是不属于用法。
    err(`${error instanceof CliError ? '错误' : '登记失败'}：${error.message}`);
    if (error instanceof CliError) err(USAGE);
    return 1;
  }
  if (plan.help) {
    out(USAGE);
    return 0;
  }

  let entry;
  try {
    entry = addRegistryEntry(plan.registryPath, plan.entry, { seedEntries: defaultEntries(REPO_ROOT) });
  } catch (error) {
    err(`登记失败：${error.message}`);
    return 1;
  }
  const targetDesc = entry.kind === 'url' ? entry.url : entry.path;
  out(`已登记 ${entry.id}（${entry.kind}）：${targetDesc}`);
  if (entry.page) {
    out(`归属 Page「${entry.page}」的「内容」区${entry.role === 'draft' ? '草稿组' : '产物组'}；不新增 Pages 行。`);
  }
  out(`registry：${plan.registryPath}`);

  // 即时生效：服务可达就让它重读 registry；不可达不视为失败（下次启动生效）。
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  try {
    const health = await requestFn(`${origin}/health`);
    if (health.status !== 200) throw new Error(`health ${health.status}`);
  } catch {
    err('pinpoint 服务未在跑；条目已登记，下次启动生效。');
    return 0;
  }
  try {
    const res = await requestFn(`${origin}/registry/reload`, { method: 'POST' });
    if (res.status !== 200 || !res.json) throw new Error(`reload ${res.status}`);
    const summary = res.json;
    if (summary.path && summary.path !== plan.registryPath) {
      err(`注意：服务在用的 registry 是 ${summary.path}，与本次写入的不是同一个文件；该条目要等服务重启或换用同一 registry 才生效。`);
    } else {
      out(`服务已重载（registry 共 ${summary.entries} 条）。`);
    }
  } catch (error) {
    err(`服务可达但 reload 失败（${error.message}）；条目已登记，重启服务后生效。`);
  }
  return 0;
}
