/**
 * Content registry: which entries may be reviewed through the annotate API.
 * Lives at ~/.pinpoint/registry.json (PINPOINT_REGISTRY overrides;
 * e2e points it at a fixture). A missing file means a default pinpoint-only
 * registry. Malformed JSON or invalid entries must never crash the server —
 * log, fall back / skip, and expose the failure on the result (/health reads
 * it back out).
 *
 * Since 2026-09-04 the document also carries owner-made grouping (裁决 5a):
 * top-level `folders[]`, `pageFolders{}` (manifest pages that are not registry
 * entries) and `pageOrder{}` (manual order for those pages). Grouping never
 * decides whether a page exists — a broken folder reference downgrades the
 * page to loose (warning), it never drops the entry.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// 归属目标 Page id（2026-08-16f 阶段 8）：本地 manifest 页（preview-contracts
// ID_PATTERN）与 registry 条目 id 都落在该模式内。
export const PAGE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
// 文件夹 id 与条目 id 同一套模式（2026-09-04 裁决 5a）：一层分组，不嵌套，
// 两个命名空间各自独立——`folder` 字段只引用 folders[] 里的 id。
export const FOLDER_ID_PATTERN = ENTRY_ID_PATTERN;
const KINDS = new Set(['dir', 'file', 'url']);
// 条目级角色（阶段 8）：缺省 product；draft = 草稿，只在带 page 归属时有意义
// （落目标页「内容」区草稿组）。无 page 的 role 不生效但也不拒（宽容读）。
const ROLES = new Set(['product', 'draft']);

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
  if (!KINDS.has(raw.kind)) return `entry "${raw.id}" kind must be "dir", "file", or "url"`;
  if ((raw.kind === 'dir' || raw.kind === 'file') && typeof raw.path !== 'string') {
    return `entry "${raw.id}" kind "${raw.kind}" requires a path`;
  }
  if (raw.kind === 'url' && typeof raw.url !== 'string') {
    return `entry "${raw.id}" kind "url" requires a url`;
  }
  // 阶段 8：page 归属（attach 到既有 Page 的「内容」区，不再自成 Pages 行）。
  // url 条目恒为独立页（代理内嵌的网页产物），与 page 互斥。
  if (raw.page !== undefined) {
    if (typeof raw.page !== 'string' || !PAGE_ID_PATTERN.test(raw.page)) {
      return `entry "${raw.id}" page must match ${PAGE_ID_PATTERN}`;
    }
    if (raw.kind === 'url') return `entry "${raw.id}" kind "url" cannot attach to a page`;
  }
  if (raw.role !== undefined && !ROLES.has(raw.role)) {
    return `entry "${raw.id}" role must be "product" or "draft"`;
  }
  return null;
}

function normalizeEntry(raw) {
  const entry = {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : raw.id,
    kind: raw.kind,
  };
  if (raw.kind === 'dir' || raw.kind === 'file') entry.path = raw.path;
  else entry.url = raw.url;
  if (typeof raw.board === 'string') entry.board = raw.board;
  if (typeof raw.page === 'string') entry.page = raw.page;
  if (typeof raw.role === 'string') entry.role = raw.role;
  return entry;
}

/** 一条 folders[] 记录的宽容校验。返回错误说明或 null（该条被跳过）。 */
function validateFolder(raw, seen) {
  if (!raw || typeof raw !== 'object') return 'folder is not an object';
  if (typeof raw.id !== 'string' || !FOLDER_ID_PATTERN.test(raw.id)) {
    return `folder id must match ${FOLDER_ID_PATTERN}: ${JSON.stringify(raw && raw.id)}`;
  }
  // 同 id 的第二个夹是错误，但只毙这一条：另一个夹与所有页都不受影响。
  if (seen.has(raw.id)) return `duplicate folder id "${raw.id}"`;
  if (raw.name !== undefined && typeof raw.name !== 'string') {
    return `folder "${raw.id}" name must be a string`;
  }
  return null;
}

function normalizeFolder(raw) {
  // name 自由文本，缺省等于 id（与条目的 title 同一条惯例）。
  const folder = { id: raw.id, name: typeof raw.name === 'string' && raw.name ? raw.name : raw.id };
  if (raw.collapsed === true) folder.collapsed = true;
  if (Number.isFinite(raw.order)) folder.order = raw.order;
  return folder;
}

/** PINPOINT_REGISTRY wins; the deprecated HTML_ANNOTATE_REGISTRY still applies with a warning. */
function envRegistryPath(env, log) {
  if (env.PINPOINT_REGISTRY) return env.PINPOINT_REGISTRY;
  if (env.HTML_ANNOTATE_REGISTRY) {
    log('[registry] HTML_ANNOTATE_REGISTRY is deprecated; rename it to PINPOINT_REGISTRY');
    return env.HTML_ANNOTATE_REGISTRY;
  }
  return null;
}

export function loadRegistry(options = {}) {
  const root = options.root || process.cwd();
  const log = options.log || ((message) => console.error(message));
  const registryPath = options.path || envRegistryPath(process.env, log) || defaultRegistryPath();
  const errors = [];
  const warnings = [];

  function finish(entries, grouping = {}) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return {
      ok: errors.length === 0,
      path: registryPath,
      entries,
      // 分组层（2026-09-04）：folders 是 owner 手建的一层夹；pageFolders /
      // pageOrder 装的是「不是 registry 条目」的 manifest 页的归属与手动次序。
      folders: grouping.folders || [],
      pageFolders: grouping.pageFolders || {},
      pageOrder: grouping.pageOrder || {},
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

  // 文件夹先解析：条目的 folder 字段要拿它查引用。
  const folders = [];
  const folderIds = new Set();
  if (parsed.folders !== undefined) {
    if (!Array.isArray(parsed.folders)) {
      errors.push('registry folders must be an array');
      log('[registry] folders is not an array — ignoring the whole grouping list');
    } else {
      for (const raw of parsed.folders) {
        const problem = validateFolder(raw, folderIds);
        if (problem) {
          errors.push(problem);
          log(`[registry] skipping folder: ${problem}`);
          continue;
        }
        folderIds.add(raw.id);
        folders.push(normalizeFolder(raw));
      }
    }
  }

  const seen = new Set();
  const entries = [];
  for (const raw of parsed.entries) {
    const problem = validateEntry(raw, seen);
    if (problem) {
      errors.push(problem);
      log(`[registry] skipping entry: ${problem}`);
      continue;
    }
    seen.add(raw.id);
    const entry = normalizeEntry(raw);
    if ((entry.kind === 'dir' || entry.kind === 'file') && !fs.existsSync(entry.path)) {
      // A missing path only breaks that entry's own /sites/ serving (404) —
      // keep the entry and warn rather than failing the whole registry.
      warnings.push(`entry "${entry.id}" path does not exist: ${entry.path}`);
      log(`[registry] warning: ${warnings[warnings.length - 1]}`);
    }
    // 归属与手动次序都不决定「这个页存不存在」：坏引用只让它变成散页，
    // 绝不把条目本身毙掉（丢一行 Pages 远比丢一层分组难查）。
    if (raw.folder !== undefined) {
      if (typeof raw.folder !== 'string' || !folderIds.has(raw.folder)) {
        warn(`entry "${entry.id}" folder does not exist: ${JSON.stringify(raw.folder)} — treated as loose`);
      } else {
        entry.folder = raw.folder;
      }
    }
    if (raw.order !== undefined) {
      if (Number.isFinite(raw.order)) entry.order = raw.order;
      else warn(`entry "${entry.id}" order must be a number: ${JSON.stringify(raw.order)} — ignored`);
    }
    entries.push(entry);
  }

  // manifest 页（不是 registry 条目的那些，Component Library 等）的归属与次序。
  const pageFolders = readPageMap(parsed.pageFolders, 'pageFolders', {
    errors, warn, entryIds: seen,
    accept: (value, id) => {
      if (typeof value !== 'string' || !folderIds.has(value)) {
        warn(`pageFolders "${id}" folder does not exist: ${JSON.stringify(value)} — treated as loose`);
        return undefined;
      }
      return value;
    },
  });
  const pageOrder = readPageMap(parsed.pageOrder, 'pageOrder', {
    errors, warn, entryIds: seen,
    accept: (value, id) => {
      if (Number.isFinite(value)) return value;
      warn(`pageOrder "${id}" must be a number: ${JSON.stringify(value)} — ignored`);
      return undefined;
    },
  });

  return finish(entries, { folders, pageFolders, pageOrder });
}

/**
 * `{<pageId>: value}` 形状的宽容读取（pageFolders / pageOrder 共用）。
 * 键必须是页 id；键撞上 registry 条目 id 时那条映射是死数据（条目自己的
 * folder / order 字段才是它的归属），响亮地 warn 掉而不是静默留着。
 */
function readPageMap(raw, name, { errors, warn, entryIds, accept }) {
  const out = {};
  if (raw === undefined) return out;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`registry ${name} must be an object`);
    return out;
  }
  for (const [id, value] of Object.entries(raw)) {
    if (!PAGE_ID_PATTERN.test(id)) {
      warn(`${name} key must match ${PAGE_ID_PATTERN}: ${JSON.stringify(id)} — ignored`);
      continue;
    }
    if (entryIds.has(id)) {
      warn(`${name} "${id}" is a registry entry — its own field wins, the mapping is ignored`);
      continue;
    }
    const accepted = accept(value, id);
    if (accepted !== undefined) out[id] = accepted;
  }
  return out;
}
