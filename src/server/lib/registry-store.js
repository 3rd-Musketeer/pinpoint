/**
 * Registry store: the read/write SSOT for the content registry
 * (~/.pinpoint/registry.json, PINPOINT_REGISTRY overrides).
 *
 * Reads reuse ./registry.js's loadRegistry — lenient: malformed files fall
 * back to the default, invalid entries are skipped, missing paths only warn.
 * Writes (the CLI path) are strict instead: the new entry must be valid, its
 * id unique, and dir/file paths must exist on disk; a malformed existing file
 * is an error, never silently clobbered. The file is replaced atomically
 * (tmp sibling + rename, 2-space JSON) so a running server never reads a
 * torn document.
 *
 * createRegistryStore() gives every server plugin ONE live view of the
 * registry: getters delegate to the latest snapshot, so store.reload() (via
 * POST /registry/reload, or store.add() from a future in-process writer)
 * takes effect for serving / injection / bucket routing without a restart.
 * Handlers keep their old `options.registry` contract — a static loadRegistry
 * snapshot still works (tests), it just cannot reload.
 */
import fs from 'node:fs';
import path from 'node:path';

import { defaultEntries, ENTRY_ID_PATTERN, loadRegistry, PAGE_ID_PATTERN } from './registry.js';

const WRITE_KINDS = new Set(['dir', 'file', 'url']);
const WRITE_ROLES = new Set(['product', 'draft']);
// 写入白名单（2026-08-16f 阶段 8 起含 page/role）：未知字段响亮拒绝，
// 不静默丢数据（写坏 registry 比报错难查得多）。
const WRITE_KEYS = new Set(['id', 'title', 'kind', 'path', 'url', 'board', 'page', 'role']);

/** Atomic JSON write: tmp sibling + rename, 2-space layout, trailing newline. */
export function writeRegistryFile(registryPath, doc) {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  const tmp = `${registryPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(tmp, registryPath);
}

/** Strict validation of one entry about to be written. Returns an error message or null. */
export function validateNewEntry(raw, existingIds) {
  if (!raw || typeof raw !== 'object') return '条目必须是对象';
  for (const key of Object.keys(raw)) {
    if (!WRITE_KEYS.has(key)) return `条目 "${raw.id}" 带未知字段：${key}`;
  }
  if (typeof raw.id !== 'string' || !ENTRY_ID_PATTERN.test(raw.id)) {
    return `条目 id 必须匹配 ${ENTRY_ID_PATTERN}（小写字母/数字/中划线，字母或数字开头）：${JSON.stringify(raw.id)}`;
  }
  if (existingIds.has(raw.id)) return `条目 id 已存在：${raw.id}`;
  if (!WRITE_KINDS.has(raw.kind)) return `条目 "${raw.id}" 的 kind 必须是 dir / file / url`;
  if (raw.kind === 'dir' || raw.kind === 'file') {
    if (typeof raw.path !== 'string' || !path.isAbsolute(raw.path)) {
      return `条目 "${raw.id}" 需要绝对路径 path`;
    }
    let stat;
    try {
      stat = fs.statSync(raw.path);
    } catch {
      return `条目 "${raw.id}" 的路径不存在：${raw.path}`;
    }
    if (raw.kind === 'dir' && !stat.isDirectory()) return `条目 "${raw.id}" 的路径不是目录：${raw.path}`;
    if (raw.kind === 'file' && !stat.isFile()) return `条目 "${raw.id}" 的路径不是文件：${raw.path}`;
  }
  if (raw.kind === 'url') {
    if (typeof raw.url !== 'string') return `条目 "${raw.id}" 需要 url`;
    let parsed;
    try {
      parsed = new URL(raw.url);
    } catch {
      return `条目 "${raw.id}" 的 url 不合法：${raw.url}`;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `条目 "${raw.id}" 的 url 只支持 http(s)：${raw.url}`;
    }
  }
  if (raw.board !== undefined && typeof raw.board !== 'string') {
    return `条目 "${raw.id}" 的 board 必须是字符串`;
  }
  // 阶段 8：page 归属（作为目标 Page 的 doc 条目进「内容」区，不再自成 Pages
  // 行）。url 条目恒为独立页（网页产物），与 page 互斥；目标页可解析性
  // （本地 manifest 页或另一 registry 条目）由 CLI 在写入前校验。
  if (raw.page !== undefined) {
    if (typeof raw.page !== 'string' || !PAGE_ID_PATTERN.test(raw.page)) {
      return `条目 "${raw.id}" 的 page 必须匹配 ${PAGE_ID_PATTERN}`;
    }
    if (raw.kind === 'url') return `条目 "${raw.id}" 是 url 条目，不能归属页面（url 恒为独立页）`;
  }
  if (raw.role !== undefined && !WRITE_ROLES.has(raw.role)) {
    return `条目 "${raw.id}" 的 role 必须是 product / draft`;
  }
  return null;
}

function normalizeNewEntry(raw) {
  const entry = { id: raw.id, kind: raw.kind };
  entry.title = typeof raw.title === 'string' && raw.title ? raw.title : raw.id;
  if (raw.kind === 'dir' || raw.kind === 'file') entry.path = raw.path;
  else entry.url = raw.url;
  if (typeof raw.board === 'string') entry.board = raw.board;
  if (typeof raw.page === 'string') entry.page = raw.page;
  if (typeof raw.role === 'string') entry.role = raw.role;
  return entry;
}

function readRegistryDoc(registryPath) {
  if (!fs.existsSync(registryPath)) return { version: 1, entries: [] };
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch (error) {
    throw new Error(`registry 文件不是合法 JSON（未改动）：${registryPath} — ${error.message}`);
  }
  if (!doc || !Array.isArray(doc.entries)) {
    throw new Error(`registry 文件必须是 {"version":1,"entries":[...]}（未改动）：${registryPath}`);
  }
  return doc;
}

/** Existing entry ids for id-derivation / collision checks (CLI). Throws on a malformed file. */
export function listRegistryIds(registryPath) {
  return readRegistryDoc(registryPath).entries.map((entry) => entry && entry.id);
}

/**
 * Existing entries as written on disk (CLI): id collision messages name the
 * path the id already points at, and `pinpoint move` needs the whole entry to
 * carry title / page / role across a re-point. Throws on a malformed file.
 */
export function listRegistryEntries(registryPath) {
  return readRegistryDoc(registryPath).entries.filter((entry) => entry && typeof entry === 'object');
}

/**
 * Replace one existing entry in place (the `pinpoint move` path): same strict
 * validation as a write, same atomic rewrite, same position in the list — the
 * id is the annotation bucket address (~/.pinpoint/<id>/), so re-pointing a
 * path must never renumber it. Throws when the id is unknown or the new shape
 * is invalid; the on-disk file is untouched in that case.
 */
export function updateRegistryEntry(registryPath, raw) {
  const doc = readRegistryDoc(registryPath);
  const index = doc.entries.findIndex((entry) => entry && entry.id === (raw && raw.id));
  if (index < 0) throw new Error(`条目不存在：${raw && raw.id}`);
  const otherIds = new Set(doc.entries.filter((_, i) => i !== index).map((entry) => entry && entry.id));
  const problem = validateNewEntry(raw, otherIds);
  if (problem) throw new Error(problem);
  const entry = normalizeNewEntry(raw);
  const entries = [...doc.entries];
  entries[index] = entry;
  writeRegistryFile(registryPath, { ...doc, entries });
  return entry;
}

/**
 * Append one entry to the registry file: strict-validate, then atomically
 * rewrite preserving the existing top-level shape (version et al). Throws on
 * any problem; the on-disk file is left untouched in that case. Returns the
 * normalized entry that was written.
 *
 * options.seedEntries: when the file does not exist yet, start the document
 * with these entries (the server passes its default pinpoint entry, so the
 * first `pinpoint add` produces [pinpoint, new] — matching the missing-file
 * semantics of loadRegistry instead of silently dropping the workbench's own
 * bucket). Seed ids collide with the new entry like any existing id.
 */
export function addRegistryEntry(registryPath, raw, options = {}) {
  const seed = Array.isArray(options.seedEntries) ? options.seedEntries : [];
  const doc = fs.existsSync(registryPath)
    ? readRegistryDoc(registryPath)
    : { version: 1, entries: [...seed] };
  const existingIds = new Set(doc.entries.map((entry) => entry && entry.id));
  const problem = validateNewEntry(raw, existingIds);
  if (problem) throw new Error(problem);
  const entry = normalizeNewEntry(raw);
  writeRegistryFile(registryPath, { ...doc, entries: [...doc.entries, entry] });
  return entry;
}

/**
 * Live registry view shared by the server plugins. Quacks like a loadRegistry
 * snapshot (ok / path / entries / errors / warnings / resolve) but every
 * accessor reads the latest snapshot, so reload() swaps the effective
 * registry for all holders at once.
 */
export function createRegistryStore(options = {}) {
  const root = options.root || process.cwd();
  const log = options.log || ((message) => console.error(message));
  // An explicit path wins; otherwise loadRegistry resolves PINPOINT_REGISTRY
  // (and the deprecated HTML_ANNOTATE_REGISTRY) itself, and we pin whatever
  // path the first load reports back.
  let snapshot = loadRegistry({ root, log, path: options.path });

  const store = {
    get ok() { return snapshot.ok; },
    get path() { return snapshot.path; },
    get entries() { return snapshot.entries; },
    get errors() { return snapshot.errors; },
    get warnings() { return snapshot.warnings; },
    resolve(id) { return snapshot.resolve(id); },
    reload() {
      snapshot = loadRegistry({ root, log, path: snapshot.path });
      return snapshot;
    },
    add(raw) {
      const entry = addRegistryEntry(snapshot.path, raw, { seedEntries: defaultEntries(root) });
      store.reload();
      return entry;
    },
  };
  return store;
}
