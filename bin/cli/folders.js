import fs from 'node:fs';

import { FOLDER_ID_PATTERN, PAGE_ID_PATTERN } from '../../src/server/lib/registry.js';
import { listRegistryEntries, listRegistryGrouping, setEntryFolder, writeRegistryFolders } from '../../src/server/lib/registry-store.js';

import { NO_FOLDER, parseArgs, guardParse } from './args.js';
import { CliError, slugify, ioOf, displayWidth, padWide } from './core.js';
import { manifestPageIds, resolveRegistryPath, reloadService } from './registry.js';

/** 文件夹的显示名（缺省等于 id，与读侧 normalizeFolder 同一条规则）。 */
function folderName(folder) {
  return folder && typeof folder.name === 'string' && folder.name ? folder.name : folder && folder.id;
}

function knownFolderList(folders) {
  const ids = folders.map((folder) => folder && folder.id).filter(Boolean);
  return ids.length ? `（现有：${ids.join('、')}）` : '（一个夹都还没有）';
}

/** 新建一个夹（纯函数）：返回 { folder, folders }（folders = 要整表写回的新列表）。 */
export function buildFolderAdd(name, flags = {}, { folders = [] } = {}) {
  const label = String(name == null ? '' : name).trim();
  if (!label) throw new CliError('文件夹名不能为空');
  let id;
  if (flags.id) {
    if (!FOLDER_ID_PATTERN.test(flags.id)) {
      throw new CliError(`--id 必须匹配 ${FOLDER_ID_PATTERN}（小写字母/数字/中划线，字母或数字开头）：${flags.id}`);
    }
    id = flags.id;
  } else {
    const slug = slugify(label);
    // 中文名 slug 化后是空串——不猜，让 owner 显式给 id（与 add 同一条规矩）。
    if (!slug) throw new CliError(`无法从「${label}」派生 id，请用 --id 显式指定`);
    id = slug;
  }
  const clash = folders.find((folder) => folder && folder.id === id);
  if (clash) {
    throw new CliError(
      `文件夹 id 已存在：${id}（名称「${folderName(clash)}」）；改名用 \`pinpoint folder rename ${id} <新名称>\`，要另一个夹请显式 \`--id <其他 id>\``,
    );
  }
  const folder = { id, name: label };
  return { folder, folders: [...folders, folder] };
}

/** 改一个夹的显示名（纯函数）：id 不变，条目的 folder 引用因此不用动。 */
export function buildFolderRename(id, name, { folders = [] } = {}) {
  const before = folders.find((folder) => folder && folder.id === id);
  if (!before) throw new CliError(`文件夹不存在：${id}${knownFolderList(folders)}`);
  const label = String(name == null ? '' : name).trim();
  if (!label) throw new CliError('文件夹名不能为空');
  const after = { ...before, name: label };
  return { before, after, folders: folders.map((folder) => (folder && folder.id === id ? after : folder)) };
}

/** 删一个夹（纯函数）：只从 folders[] 里去掉它；夹里的页由写侧释放成散页。 */
export function buildFolderRemove(id, { folders = [] } = {}) {
  const removed = folders.find((folder) => folder && folder.id === id);
  if (!removed) throw new CliError(`文件夹不存在：${id}${knownFolderList(folders)}`);
  return { removed, folders: folders.filter((folder) => folder && folder.id !== id) };
}

/**
 * 一个页进夹 / 出夹（纯函数）：id 必须是 registry 条目或本地 manifest 页，
 * 目标夹必须已经存在（`none` = 拖出来变散页）。校验全在这里，写侧只落盘。
 */
export function buildFolderMove(id, folderArg, { folders = [], entryIds = [], pageIds = [] } = {}) {
  if (typeof id !== 'string' || !PAGE_ID_PATTERN.test(id)) {
    throw new CliError(`页 id 不合法（必须匹配 ${PAGE_ID_PATTERN}）：${JSON.stringify(id)}`);
  }
  if (!entryIds.includes(id) && !pageIds.includes(id)) {
    throw new CliError(`未知的页：${id}（既不是 registry 条目，也不是本地 manifest 页）`);
  }
  const kind = entryIds.includes(id) ? 'entry' : 'page';
  if (folderArg === NO_FOLDER) return { id, kind, folder: null };
  if (typeof folderArg !== 'string' || !FOLDER_ID_PATTERN.test(folderArg)) {
    throw new CliError(`文件夹 id 不合法（要么匹配 ${FOLDER_ID_PATTERN}，要么是 ${NO_FOLDER} = 移出文件夹）：${JSON.stringify(folderArg)}`);
  }
  if (!folders.some((folder) => folder && folder.id === folderArg)) {
    throw new CliError(
      `文件夹不存在：${folderArg}${knownFolderList(folders)}；先 \`pinpoint folder add <名称> --id ${folderArg}\``,
    );
  }
  return { id, kind, folder: folderArg };
}

/**
 * `folder list` 的行（纯函数）：夹的顺序就是文件里的顺序（workbench 拖动重排
 * 时整表写回，文件顺序即左栏顺序）。count = 指着这个夹的 registry 条目数
 * + pageFolders 里指着它的 manifest 页数。
 */
export function folderRows({ folders = [], entries = [], pageFolders = {} } = {}) {
  return folders.map((folder) => {
    const fromEntries = entries.filter((entry) => entry && entry.folder === folder.id).length;
    const fromPages = Object.values(pageFolders).filter((value) => value === folder.id).length;
    return {
      id: folder.id,
      name: folderName(folder),
      count: fromEntries + fromPages,
      collapsed: folder.collapsed === true,
    };
  });
}

const FOLDER_TABLE_HEAD = { id: 'id', name: '名称', count: '页数', collapsed: '折叠' };

/** 文件夹表（一屏）。全角按两列算，与状态表同一套对齐。 */
export function formatFolderList(rows) {
  if (!rows.length) return ['（还没有文件夹；`pinpoint folder add <名称>` 建一个）'];
  const cells = [FOLDER_TABLE_HEAD, ...rows].map((row) => ({
    id: String(row.id),
    name: String(row.name),
    count: String(row.count),
    collapsed: row.collapsed === true ? '是' : (row.collapsed === false ? '—' : String(row.collapsed)),
  }));
  const width = (key) => Math.max(...cells.map((row) => displayWidth(row[key])));
  return cells.map((row) =>
    `  ${padWide(row.id, width('id'))}  ${padWide(row.name, width('name'))}  ${padWide(row.count, width('count'))}  ${row.collapsed}`);
}

/** 分组层的现状 + 条目（预检读侧）。 */
function groupingStateFor(registryPath) {
  const grouping = listRegistryGrouping(registryPath);
  return { ...grouping, entries: listRegistryEntries(registryPath) };
}

/** parse + 读现状 + 构造，返回一次 folder 子命令的全部输入（不写盘、不联网）。 */
export function planFolder(argv, { cwd = process.cwd(), env = process.env, pageIds } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) return parsed;
  const registryPath = resolveRegistryPath(parsed.flags, env, cwd);
  const exists = fs.existsSync(registryPath);
  if (parsed.sub === 'list') {
    const state = exists ? groupingStateFor(registryPath) : { folders: [], entries: [], pageFolders: {} };
    return { ...parsed, registryPath, rows: folderRows(state) };
  }
  // 写子命令不给不存在的登记表播种：整表写回不带 pinpoint 默认条目，会写出一份
  // 没有 workbench 自己那条的登记表。先 `pinpoint add` 才有页可分组。
  if (!exists) {
    throw new CliError(`registry 文件还不存在：${registryPath}；先 \`pinpoint add …\` 登记一个条目，再建文件夹（夹是给页分组的）`);
  }
  const state = groupingStateFor(registryPath);
  if (parsed.sub === 'add') {
    return { ...parsed, registryPath, ...buildFolderAdd(parsed.args[0], parsed.flags, state) };
  }
  if (parsed.sub === 'rename') {
    return { ...parsed, registryPath, ...buildFolderRename(parsed.args[0], parsed.args[1], state) };
  }
  if (parsed.sub === 'rm') {
    return { ...parsed, registryPath, ...buildFolderRemove(parsed.args[0], state) };
  }
  const known = pageIds || manifestPageIds();
  const move = buildFolderMove(parsed.args[0], parsed.args[1], {
    folders: state.folders,
    entryIds: state.entries.map((entry) => entry && entry.id),
    pageIds: known,
  });
  return { ...parsed, registryPath, move, pageIds: known };
}

/**
 * 执行一次 folder 子命令：list 只读；其余都是一次原子写 → 探活 → 可达则 reload
 * （与 add / move / rename 同一条即时生效路径，打开着的 workbench 立刻重排左栏）。
 */
export async function runFolder(argv, io = {}) {
  const { cwd, env, out, err, requestFn } = ioOf(io);

  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  let plan;
  try {
    plan = planFolder(argv, { cwd, env });
  } catch (error) {
    err(`${error instanceof CliError ? '错误' : '文件夹操作失败'}：${error.message}`);
    return 1;
  }

  if (plan.sub === 'list') {
    out(`registry：${plan.registryPath}`);
    for (const line of formatFolderList(plan.rows)) out(line);
    return 0;
  }

  try {
    if (plan.sub === 'add') {
      writeRegistryFolders(plan.registryPath, plan.folders);
      out(`已建文件夹 ${plan.folder.id}（${plan.folder.name}）；把页放进来用 \`pinpoint folder move <页 id> ${plan.folder.id}\``);
    } else if (plan.sub === 'rename') {
      writeRegistryFolders(plan.registryPath, plan.folders);
      out(`已改名文件夹 ${plan.after.id}：${folderName(plan.before)} → ${plan.after.name}`);
    } else if (plan.sub === 'rm') {
      const result = writeRegistryFolders(plan.registryPath, plan.folders);
      const released = [...result.releasedEntries, ...result.releasedPages];
      out(`已删文件夹 ${plan.removed.id}（${folderName(plan.removed)}）`);
      out(released.length
        ? `  夹里的 ${released.length} 个页没有被删，变成散页：${released.join('、')}`
        : '  夹是空的，没有页要释放');
    } else {
      const result = setEntryFolder(plan.registryPath, plan.move.id, { folder: plan.move.folder }, { pageIds: plan.pageIds });
      const where = result.kind === 'entry' ? 'registry 条目' : '本地 manifest 页（归属记在 pageFolders）';
      out(plan.move.folder
        ? `已把 ${result.id} 放进文件夹 ${plan.move.folder}（${where}）`
        : `已把 ${result.id} 移出文件夹，现在是散页（${where}）`);
    }
  } catch (error) {
    err(`文件夹操作失败：${error.message}`);
    return 1;
  }
  out(`registry：${plan.registryPath}`);
  await reloadService({ env, requestFn, registryPath: plan.registryPath, out, err });
  return 0;
}

/* ============================ 服务生命周期 ============================ */
