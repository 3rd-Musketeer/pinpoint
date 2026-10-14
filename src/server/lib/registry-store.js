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

import { defaultEntries, ENTRY_ID_PATTERN, loadRegistry, RETIRED_ENTRY_KEYS } from './registry.js';
import { isReservedProjectId } from '../../shared/project-ids.js';

const WRITE_KINDS = new Set(['dir', 'file', 'project']);
// project 条目（pp3）只带这些字段：没有壳。
const PROJECT_KEYS = new Set(['id', 'title', 'kind', 'path', 'addedAt']);
// 写入白名单：未知字段响亮拒绝，不静默丢数据（写坏 registry 比报错难查得多）。
const WRITE_KEYS = new Set(['id', 'title', 'kind', 'path', 'board', 'addedAt']);

/** 改写一条已有条目前去掉已退役功能的字段（registry.js RETIRED_ENTRY_KEYS）：老登记表照样能 move / rename。 */
function withoutRetiredKeys(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const out = { ...entry };
  for (const key of RETIRED_ENTRY_KEYS) delete out[key];
  return out;
}

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
  if (!WRITE_KINDS.has(raw.kind)) return `条目 "${raw.id}" 的 kind 必须是 dir / file / project`;
  if (raw.kind === 'project') {
    for (const key of Object.keys(raw)) {
      if (!PROJECT_KEYS.has(key)) return `project 条目 "${raw.id}" 不能带字段：${key}`;
    }
    // project id 是站点 URL 的第一段（/<project>/<article>/），不能占服务已有的首段。
    if (isReservedProjectId(raw.id)) return `project id 是保留名（服务已占用 /${raw.id}/）：${raw.id}`;
  }
  if (typeof raw.path !== 'string' || !path.isAbsolute(raw.path)) {
    return `条目 "${raw.id}" 需要绝对路径 path`;
  }
  let stat;
  try {
    stat = fs.statSync(raw.path);
  } catch {
    return `条目 "${raw.id}" 的路径不存在：${raw.path}`;
  }
  if ((raw.kind === 'dir' || raw.kind === 'project') && !stat.isDirectory()) return `条目 "${raw.id}" 的路径不是目录：${raw.path}`;
  if (raw.kind === 'file' && !stat.isFile()) return `条目 "${raw.id}" 的路径不是文件：${raw.path}`;
  if (raw.addedAt !== undefined && (!Number.isFinite(raw.addedAt) || raw.addedAt <= 0)) return 'addedAt 必须是正数时间戳';
  if (raw.board !== undefined && typeof raw.board !== 'string') {
    return `条目 "${raw.id}" 的 board 必须是字符串`;
  }
  return null;
}

function normalizeNewEntry(raw) {
  const entry = { id: raw.id, kind: raw.kind };
  entry.title = typeof raw.title === 'string' && raw.title ? raw.title : raw.id;
  entry.path = raw.path;
  if (Number.isFinite(raw.addedAt) && raw.addedAt > 0) entry.addedAt = raw.addedAt;
  if (typeof raw.board === 'string') entry.board = raw.board;
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

/**
 * Existing entries as written on disk (CLI): id collision messages name the
 * path the id already points at, and `pinpoint move` needs the whole entry to
 * carry title / board across a re-point. Throws on a malformed file.
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
  const entries = replaceEntry(doc.entries, index, raw);
  writeRegistryFile(registryPath, { ...doc, entries });
  return entries[index];
}

/**
 * entries 里换掉第 index 条：对其余 id 做严格校验、归一，返回新数组。
 */
function replaceEntry(entries, index, raw) {
  const otherIds = new Set(entries.filter((_, i) => i !== index).map((entry) => entry && entry.id));
  raw = withoutRetiredKeys(raw);
  const problem = validateNewEntry(raw, otherIds);
  if (problem) throw new Error(problem);
  const next = [...entries];
  next[index] = normalizeNewEntry({ ...raw, addedAt: entries[index].addedAt });
  return next;
}

/**
 * Rename one entry's id in place (the `pinpoint rename` path): the entry keeps
 * its position, kind, path and title. Same strict validation and same atomic
 * rewrite as a write. Throws when the old id is unknown or the new id is
 * taken/invalid; the on-disk file is untouched in that case. Returns { entry }.
 */
export function renameRegistryEntry(registryPath, oldId, newId) {
  const doc = readRegistryDoc(registryPath);
  const index = doc.entries.findIndex((entry) => entry && entry.id === oldId);
  if (index < 0) throw new Error(`条目不存在：${oldId}`);
  const otherIds = new Set(doc.entries.filter((_, i) => i !== index).map((entry) => entry && entry.id));
  const problem = validateNewEntry(withoutRetiredKeys({ ...doc.entries[index], id: newId }), otherIds);
  if (problem) throw new Error(problem);
  const entries = doc.entries.map((entry, i) => (i === index ? normalizeNewEntry(withoutRetiredKeys({ ...entry, id: newId })) : entry));
  writeRegistryFile(registryPath, { ...doc, entries });
  return { entry: entries[index] };
}

/**
 * Drop one entry from the registry file (the `pinpoint remove` path): the
 * entry disappears, every other entry keeps its position. Same strict read
 * and same atomic rewrite as every other write; guards against losing
 * annotations live in the CLI's preflight (non-empty bucket) — this layer only refuses an unknown id. Returns the removed entry.
 */
export function removeRegistryEntry(registryPath, id) {
  const doc = readRegistryDoc(registryPath);
  const index = doc.entries.findIndex((entry) => entry && entry.id === id);
  if (index < 0) throw new Error(`条目不存在：${id}`);
  const removed = doc.entries[index];
  writeRegistryFile(registryPath, { ...doc, entries: doc.entries.filter((_, i) => i !== index) });
  return removed;
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
  const entry = normalizeNewEntry({ ...raw, addedAt: Date.now() });
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
    get projects() { return snapshot.projects; },
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
