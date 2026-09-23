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

import { defaultEntries, ENTRY_ID_PATTERN, FOLDER_ID_PATTERN, loadRegistry, normalizeFolder, PAGE_ID_PATTERN } from './registry.js';

const WRITE_KINDS = new Set(['dir', 'file', 'url']);
const WRITE_ROLES = new Set(['product', 'draft']);
// 写入白名单（2026-08-16f 阶段 8 起含 page/role，2026-09-04 起含 folder/order）：
// 未知字段响亮拒绝，不静默丢数据（写坏 registry 比报错难查得多）。
const WRITE_KEYS = new Set(['id', 'title', 'kind', 'path', 'url', 'board', 'page', 'role', 'folder', 'order', 'addedAt']);
// folders[] 一条记录的写入白名单。
const FOLDER_KEYS = new Set(['id', 'name', 'collapsed', 'order']);

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
  if (raw.addedAt !== undefined && (!Number.isFinite(raw.addedAt) || raw.addedAt <= 0)) return 'addedAt 必须是正数时间戳';
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
  // 2026-09-04 分组层：folder 引用 folders[] 里的一个 id（存不存在由文件夹写接口
  // 校验，这里只管形状），order 只在 workbench 排序档为「默认」时生效。
  if (raw.folder !== undefined && (typeof raw.folder !== 'string' || !FOLDER_ID_PATTERN.test(raw.folder))) {
    return `条目 "${raw.id}" 的 folder 必须匹配 ${FOLDER_ID_PATTERN}`;
  }
  if (raw.order !== undefined && !Number.isFinite(raw.order)) {
    return `条目 "${raw.id}" 的 order 必须是数字`;
  }
  return null;
}

function normalizeNewEntry(raw) {
  const entry = { id: raw.id, kind: raw.kind };
  entry.title = typeof raw.title === 'string' && raw.title ? raw.title : raw.id;
  if (raw.kind === 'dir' || raw.kind === 'file') entry.path = raw.path;
  else entry.url = raw.url;
  if (Number.isFinite(raw.addedAt) && raw.addedAt > 0) entry.addedAt = raw.addedAt;
  if (typeof raw.board === 'string') entry.board = raw.board;
  if (typeof raw.page === 'string') entry.page = raw.page;
  if (typeof raw.role === 'string') entry.role = raw.role;
  if (typeof raw.folder === 'string') entry.folder = raw.folder;
  if (Number.isFinite(raw.order)) entry.order = raw.order;
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
  const entries = replaceEntry(doc.entries, index, raw);
  writeRegistryFile(registryPath, { ...doc, entries });
  return entries[index];
}

/**
 * entries 里换掉第 index 条：对其余 id 做严格校验、归一，返回新数组。
 * move / 进夹 / 排序都走这一条——同一个条目改任何字段，校验口径只有一个。
 */
function replaceEntry(entries, index, raw) {
  const otherIds = new Set(entries.filter((_, i) => i !== index).map((entry) => entry && entry.id));
  const problem = validateNewEntry(raw, otherIds);
  if (problem) throw new Error(problem);
  const next = [...entries];
  next[index] = normalizeNewEntry({ ...raw, addedAt: entries[index].addedAt });
  return next;
}

/**
 * Rename one entry's id in place (the `pinpoint rename` path): the entry keeps
 * its position, kind, path and title, and every other entry whose `page`
 * attaches to the old id follows along — an attach pointing at a vanished page
 * would silently drop that entry out of the workbench. Same strict validation
 * and same atomic rewrite as a write. Throws when the old id is unknown or the
 * new id is taken/invalid; the on-disk file is untouched in that case.
 * Returns { entry, attached } — attached = ids whose `page` field was rewritten.
 */
export function renameRegistryEntry(registryPath, oldId, newId) {
  const doc = readRegistryDoc(registryPath);
  const index = doc.entries.findIndex((entry) => entry && entry.id === oldId);
  if (index < 0) throw new Error(`条目不存在：${oldId}`);
  const otherIds = new Set(doc.entries.filter((_, i) => i !== index).map((entry) => entry && entry.id));
  const problem = validateNewEntry({ ...doc.entries[index], id: newId }, otherIds);
  if (problem) throw new Error(problem);
  const attached = [];
  const entries = doc.entries.map((entry, i) => {
    if (i === index) return normalizeNewEntry({ ...entry, id: newId });
    if (entry && entry.page === oldId) {
      attached.push(entry.id);
      return { ...entry, page: newId };
    }
    return entry;
  });
  writeRegistryFile(registryPath, { ...doc, entries });
  return { entry: entries[index], attached };
}

/**
 * Drop one entry from the registry file (the `pinpoint remove` path): the
 * entry disappears, every other entry keeps its position. Same strict read
 * and same atomic rewrite as every other write; guards against losing
 * annotations live in the CLI's preflight (attached entries, non-empty
 * bucket) — this layer only refuses an unknown id. Returns the removed entry.
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

/* ============================ 分组层（文件夹） ============================
   2026-09-04 裁决 5a：owner 自己建夹、把页拖进去，一层不嵌套。写侧与条目写
   共用同一条原子写，但入口不止 CLI —— workbench 的拖放经服务端的三个写接口
   落到同一份文件（docs/registry.md「写入走 CLI 或 workbench 的文件夹操作」）。
   删夹永远不删页：指着它的条目丢掉 folder 字段变成散页。 */

/**
 * 分组层的现状，一次读出来（CLI 的预检读侧：`pinpoint folder list` 要数每个夹
 * 里有几个页，写子命令要在动手前知道有哪些夹）。folders 原样，两张 page 映射
 * 是浅拷贝。文件损坏时抛——预检阶段就报错，比写坏登记表好。
 */
export function listRegistryGrouping(registryPath) {
  const doc = readRegistryDoc(registryPath);
  return {
    folders: foldersOf(doc),
    pageFolders: pageMapOf(doc, 'pageFolders'),
    pageOrder: pageMapOf(doc, 'pageOrder'),
  };
}

function foldersOf(doc) {
  return Array.isArray(doc.folders) ? doc.folders.filter((folder) => folder && typeof folder === 'object') : [];
}

function pageMapOf(doc, key) {
  const raw = doc[key];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
}

/** 整份 folders[] 的严格校验（写入前）。返回错误说明或 null。 */
export function validateFolderList(raw) {
  if (!Array.isArray(raw)) return 'folders 必须是数组';
  const seen = new Set();
  for (const folder of raw) {
    if (!folder || typeof folder !== 'object' || Array.isArray(folder)) return '文件夹必须是对象';
    for (const key of Object.keys(folder)) {
      if (!FOLDER_KEYS.has(key)) return `文件夹 "${folder.id}" 带未知字段：${key}`;
    }
    if (typeof folder.id !== 'string' || !FOLDER_ID_PATTERN.test(folder.id)) {
      return `文件夹 id 必须匹配 ${FOLDER_ID_PATTERN}（小写字母/数字/中划线，字母或数字开头）：${JSON.stringify(folder.id)}`;
    }
    if (seen.has(folder.id)) return `文件夹 id 重复：${folder.id}`;
    seen.add(folder.id);
    if (folder.name !== undefined && typeof folder.name !== 'string') {
      return `文件夹 "${folder.id}" 的 name 必须是字符串`;
    }
    if (folder.collapsed !== undefined && typeof folder.collapsed !== 'boolean') {
      return `文件夹 "${folder.id}" 的 collapsed 必须是 true / false`;
    }
    if (folder.order !== undefined && !Number.isFinite(folder.order)) {
      return `文件夹 "${folder.id}" 的 order 必须是数字`;
    }
  }
  return null;
}

/** 空的 folders / pageFolders / pageOrder 不留在文件里（登记表保持能一眼读完）。 */
function putGrouping(doc, key, value) {
  const next = { ...doc };
  const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
  if (empty) delete next[key];
  else next[key] = value;
  return next;
}

/**
 * 顶层 folders[] 整表替换（新建 / 改名 / 删除 / 折叠 / 重排都走这一条）。
 * 删掉的夹不带走任何页：指着它的条目丢掉 folder 字段、pageFolders 里的映射
 * 一并去掉，页照样在 Pages 里，只是变成散页。
 * 返回 { folders, releasedEntries, releasedPages }。
 */
export function writeRegistryFolders(registryPath, folders) {
  const problem = validateFolderList(folders);
  if (problem) throw new Error(problem);
  const doc = readRegistryDoc(registryPath);
  const next = folders.map(normalizeFolder);
  const ids = new Set(next.map((folder) => folder.id));

  const releasedEntries = [];
  const entries = doc.entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.folder !== 'string') return entry;
    if (ids.has(entry.folder)) return entry;
    releasedEntries.push(entry.id);
    const { folder, ...rest } = entry;
    return rest;
  });

  const pageFolders = pageMapOf(doc, 'pageFolders');
  const releasedPages = [];
  for (const [pageId, folderId] of Object.entries(pageFolders)) {
    if (ids.has(folderId)) continue;
    releasedPages.push(pageId);
    delete pageFolders[pageId];
  }

  let out = { ...doc, entries };
  out = putGrouping(out, 'folders', next);
  out = putGrouping(out, 'pageFolders', pageFolders);
  writeRegistryFile(registryPath, out);
  return { folders: next, releasedEntries, releasedPages };
}

/** id 是 registry 条目、还是本地 manifest 页（Component Library 等）——两条写路径不同。 */
function classifyPageId(doc, id, pageIds) {
  if (typeof id !== 'string' || !PAGE_ID_PATTERN.test(id)) {
    throw new Error(`id 不合法（必须匹配 ${PAGE_ID_PATTERN}）：${JSON.stringify(id)}`);
  }
  const index = doc.entries.findIndex((entry) => entry && entry.id === id);
  if (index >= 0) return { kind: 'entry', index };
  if (pageIds.includes(id)) return { kind: 'page' };
  throw new Error(`未知 id：${id}（既不是 registry 条目，也不是本地 manifest 页）`);
}

/**
 * 一个页的归属（拖进夹 / 拖出来）。id 可以是 registry 条目 id，也可以是
 * manifest 页 id —— 后者落顶层 pageFolders。folder 传 null 就是拖成散页。
 * order 可选，同一次写入里带上（手动排序只在 workbench 排序档「默认」时生效）。
 * 返回 { id, kind, folder, order }。
 */
export function setEntryFolder(registryPath, id, { folder: target = null, order } = {}, { pageIds = [] } = {}) {
  if (target !== null && (typeof target !== 'string' || !FOLDER_ID_PATTERN.test(target))) {
    throw new Error(`folder 必须是文件夹 id 或 null：${JSON.stringify(target)}`);
  }
  if (order !== undefined && !Number.isFinite(order)) throw new Error(`order 必须是数字：${JSON.stringify(order)}`);

  const doc = readRegistryDoc(registryPath);
  if (target !== null && !foldersOf(doc).some((entry) => entry.id === target)) {
    throw new Error(`文件夹不存在：${target}`);
  }
  const where = classifyPageId(doc, id, pageIds);

  let out;
  if (where.kind === 'entry') {
    const before = doc.entries[where.index];
    const raw = { ...before };
    if (target === null) delete raw.folder;
    else raw.folder = target;
    if (order !== undefined) raw.order = order;
    out = { ...doc, entries: replaceEntry(doc.entries, where.index, raw) };
  } else {
    const pageFolders = pageMapOf(doc, 'pageFolders');
    if (target === null) delete pageFolders[id];
    else pageFolders[id] = target;
    out = putGrouping(doc, 'pageFolders', pageFolders);
    if (order !== undefined) {
      const pageOrder = pageMapOf(doc, 'pageOrder');
      pageOrder[id] = order;
      out = putGrouping(out, 'pageOrder', pageOrder);
    }
  }
  writeRegistryFile(registryPath, out);
  return { id, kind: where.kind, folder: target, order };
}

/**
 * 一串 id 按给定顺序写 order（0、1、2…）：条目写自己的 order 字段，
 * manifest 页写顶层 pageOrder。一次原子写，部分 id 不认整单失败。
 * 返回 [{id, kind, order}]。
 */
export function assignRegistryOrder(registryPath, ids, { pageIds = [] } = {}) {
  if (!Array.isArray(ids)) throw new Error('ids 必须是数组');
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`ids 里有重复项：${id}`);
    seen.add(id);
  }
  const doc = readRegistryDoc(registryPath);
  const placed = ids.map((id, index) => ({ id, index, where: classifyPageId(doc, id, pageIds) }));

  let entries = doc.entries;
  const pageOrder = pageMapOf(doc, 'pageOrder');
  for (const item of placed) {
    if (item.where.kind === 'entry') {
      entries = replaceEntry(entries, item.where.index, { ...entries[item.where.index], order: item.index });
    } else {
      pageOrder[item.id] = item.index;
    }
  }
  writeRegistryFile(registryPath, putGrouping({ ...doc, entries }, 'pageOrder', pageOrder));
  return placed.map((item) => ({ id: item.id, kind: item.where.kind, order: item.index }));
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
    get folders() { return snapshot.folders; },
    get pageFolders() { return snapshot.pageFolders; },
    get pageOrder() { return snapshot.pageOrder; },
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
    // 分组层的三个写入口（workbench 拖放经服务端打到这里）：每个都是
    // 一次原子写 + 一次 reload，所以写完立刻对所有插件生效。
    setFolders(folders) {
      const result = writeRegistryFolders(snapshot.path, folders);
      store.reload();
      return result;
    },
    setEntryFolder(id, patch, options) {
      const result = setEntryFolder(snapshot.path, id, patch, options);
      store.reload();
      return result;
    },
    setOrder(ids, options) {
      const result = assignRegistryOrder(snapshot.path, ids, options);
      store.reload();
      return result;
    },
  };
  return store;
}
