/**
 * Content registry: which entries may be reviewed through the annotate API.
 * Lives at ~/.pinpoint/registry.json (PINPOINT_REGISTRY overrides;
 * e2e points it at a fixture). A missing file means a default pinpoint-only
 * registry. Malformed JSON or invalid entries must never crash the server —
 * log, fall back / skip, and expose the failure on the result (/health reads
 * it back out).
 *
 * Keys and entry kinds from retired features (RETIRED_TOP_KEYS /
 * RETIRED_ENTRY_KEYS / RETIRED_KINDS) may still sit in an older file: they are
 * skipped with a warning and the rest of the registry loads as usual.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENTRY_ID_PATTERN, PAGE_ID_PATTERN } from '../../shared/registry-ids.js';

export { ENTRY_ID_PATTERN, PAGE_ID_PATTERN };
const KINDS = new Set(['dir', 'file', 'project']);
// pp3（2026-10-13）：kind "project" 的 path 是 project 根目录，内容在
// <path>/docs/pinpoint/（docs/projects.md）。project 条目不进 entries——
// entries 的每个消费者（Pages、/sites/、标注桶、编译）都按 page 理解它——
// 而是单独放在 projects 里，由 src/server/lib/projects.js 读。
// 2026-10-14 删掉的功能留在老登记表里的键：读的时候跳过并 warn，服务照常起。
// 文件夹与手动排序（ADR 0032）：顶层 folders / pageFolders / pageOrder，条目上的 folder / order。
// 登记表级挂靠（ADR 0021 阶段 8）：条目上的 page / role；带 page 的条目照常自成一页。
// url 条目与站点代理（ADR 0019）：kind "url" 的整条条目跳过；别的条目上的 url 字段同样跳过，
// 所以老 url 条目能经 move 重指到本地目录或文件。
export const RETIRED_TOP_KEYS = ['folders', 'pageFolders', 'pageOrder'];
export const RETIRED_ENTRY_KEYS = ['folder', 'order', 'page', 'role', 'url'];
export const RETIRED_KINDS = ['url'];

/**
 * 按 id 读 registry 的入口（loadRegistry 的结果与 registry-store 的 live view 同形）：
 * 页条目（dir / file）走 resolve(id)，kind "project" 的条目在 projects 里，两者 id 不重。
 * 只带 entries、没有 resolve 的视图（测试与 CLI 拼的）按 entries 找。
 */
export function registryEntry(registry, id) {
  if (!registry) return null;
  if (typeof registry.resolve === 'function') return registry.resolve(id) || null;
  return (registry.entries || []).find((entry) => entry && entry.id === id) || null;
}

export function projectEntries(registry) {
  return registry && Array.isArray(registry.projects) ? registry.projects : [];
}

export function projectEntry(registry, id) {
  return projectEntries(registry).find((entry) => entry && entry.id === id) || null;
}

export function defaultRegistryPath() {
  return path.join(os.homedir(), '.pinpoint', 'registry.json');
}

export function defaultEntries(root) {
  return [{ id: 'pinpoint', title: 'pinpoint workbench', kind: 'dir', path: root }];
}

function validateEntry(raw, seen) {
  if (!raw || typeof raw !== 'object') return 'entry is not an object';
  if (typeof raw.id !== 'string' || !ENTRY_ID_PATTERN.test(raw.id)) {
    return `entry id must match ${ENTRY_ID_PATTERN}: ${JSON.stringify(raw.id)}`;
  }
  if (seen.has(raw.id)) return `duplicate entry id "${raw.id}"`;
  if (!KINDS.has(raw.kind)) return `entry "${raw.id}" kind must be "dir", "file", or "project"`;
  if (typeof raw.path !== 'string') return `entry "${raw.id}" kind "${raw.kind}" requires a path`;
  return null;
}

function normalizeEntry(raw) {
  const entry = {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : raw.id,
    kind: raw.kind,
    path: raw.path,
  };
  if (Number.isFinite(raw.addedAt) && raw.addedAt > 0) entry.addedAt = raw.addedAt;
  if (raw.kind === 'project') return entry;
  if (typeof raw.board === 'string') entry.board = raw.board;
  return entry;
}

/** PINPOINT_REGISTRY 是唯一的环境变量入口（HTML_ANNOTATE_REGISTRY 别名已删）。 */
function envRegistryPath(env, log) {
  return env.PINPOINT_REGISTRY || null;
}

export function loadRegistry(options = {}) {
  const root = options.root || process.cwd();
  const log = options.log || ((message) => console.error(message));
  const registryPath = options.path || envRegistryPath(process.env, log) || defaultRegistryPath();
  const errors = [];
  const warnings = [];

  function finish(entries, projects = []) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return {
      ok: errors.length === 0,
      path: registryPath,
      entries,
      // kind "project" 的条目（pp3）：与 entries 共用 id 命名空间，但不是 page。
      projects,
      errors,
      warnings,
      resolve: (id) => byId.get(id) || null,
    };
  }

  function fallback(message) {
    errors.push(message);
    log(`[registry] ${message} — falling back to default entries`);
    return finish(defaultEntries(root));
  }

  if (!fs.existsSync(registryPath)) return finish(defaultEntries(root));

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    return fallback(`registry is not valid JSON: ${error.message}`);
  }
  if (!parsed || !Array.isArray(parsed.entries)) {
    return fallback('registry must be {"version":1,"entries":[...]}');
  }

  function warn(message) {
    warnings.push(message);
    log(`[registry] warning: ${message}`);
  }

  for (const key of RETIRED_TOP_KEYS) {
    if (parsed[key] !== undefined) warn(`"${key}" belongs to a retired feature — ignored`);
  }

  const seen = new Set();
  const entries = [];
  const projects = [];
  for (const raw of parsed.entries) {
    if (raw && typeof raw === 'object' && RETIRED_KINDS.includes(raw.kind)) {
      warn(`entry "${raw.id}" kind "${raw.kind}" belongs to a retired feature — skipped`);
      continue;
    }
    const problem = validateEntry(raw, seen);
    if (problem) {
      errors.push(problem);
      log(`[registry] skipping entry: ${problem}`);
      continue;
    }
    seen.add(raw.id);
    const entry = normalizeEntry(raw);
    if (entry.kind === 'project') {
      // 布局问题（project.json、撞名…）不在这里查：那是 projects.js 的 error 列表，
      // 不让一篇写错的文章把整份登记表标成 error。
      if (!fs.existsSync(entry.path)) warn(`project "${entry.id}" path does not exist: ${entry.path}`);
      projects.push(entry);
      continue;
    }
    if ((entry.kind === 'dir' || entry.kind === 'file') && !fs.existsSync(entry.path)) {
      // A missing path only breaks that entry's own /sites/ serving (404) —
      // keep the entry and warn rather than failing the whole registry.
      warnings.push(`entry "${entry.id}" path does not exist: ${entry.path}`);
      log(`[registry] warning: ${warnings[warnings.length - 1]}`);
    }
    for (const key of RETIRED_ENTRY_KEYS) {
      if (raw[key] !== undefined) warn(`entry "${entry.id}" field "${key}" belongs to a retired feature — ignored`);
    }
    entries.push(entry);
  }

  return finish(entries, projects);
}
