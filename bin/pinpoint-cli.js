/**
 * pinpoint CLI —— 登记评审入口 + 服务生命周期（bin/pinpoint.mjs 的逻辑层，node --test 直接测这里）。
 *
 * pinpoint 是 HTML 宿主：想让一个页面进 pinpoint，就用 `pinpoint add`；
 * 已登记条目换路径用 `pinpoint move`（保留 id；标注桶按页寻址——挂靠条目的
 * 桶是宿主页的桶（storage-unify），换路径不会孤儿化）；
 * 换 id 用 `pinpoint rename`（登记表 + 标注桶 + 存量 HTML 里的 /sites/<id>/ 一起改）；
 * 从登记表删掉条目用 `pinpoint remove`（只删登记，源文件 / URL 不动；桶里还有
 * 标注行或有条目挂着它时拒绝，空桶顺手删掉）。
 * 静态内容（目录 / 单个 .html）由服务直接 host 在 /sites/<id>/；活的应用登记 URL。
 * 文件留在原地，CLI 只登记路径/URL。
 *
 * 服务侧：`status` / `start` / `stop` / `restart` 管的是这个 app 的 portless 注册
 * （`portless run --name pinpoint npm run dev:app`）与它那棵进程树。portless 的
 * proxy daemon（443，多 app 共享）不归 pinpoint 管，本文件一个字都不碰它。
 *
 * 进程原语（发信号、spawn、sleep）由 bin/pinpoint.mjs 注入 io，本文件只做判定，
 * 所以两种真实故障形态（进程死了 / 进程活着但配置错）都能拿构造输入单测。
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dataRoot } from '../src/server/lib/annotate-data-dir.js';
import {
  buildCheckReport,
  countByStatus,
  formatCheckMarkdown,
  loadPageContext,
  locateLine,
} from '../src/server/lib/ann-query.js';
import { expandRefs, expandStatus, REF_STATUSES } from '../src/server/lib/ann-refs.js';
import {
  compilePage,
  distStatus,
  listPageIds,
  readDistScreen,
  renderScreenHtml,
  resolvePageTarget,
} from '../src/server/lib/page-compiler.js';
import { manifestPageIds as libManifestPageIds } from '../src/server/lib/page-manifest.js';
import { isWatchedSource, planPageRecompile } from '../src/server/lib/recompile-plan.js';
import {
  defaultEntries,
  defaultRegistryPath,
  ENTRY_ID_PATTERN,
  FOLDER_ID_PATTERN,
  loadRegistry,
  PAGE_ID_PATTERN,
} from '../src/server/lib/registry.js';
import { collectBucketOrphans, collectPageOrphans, readBucketLedgers } from '../src/server/lib/orphans.js';
import { buildPageList, formatPageRow, matchPages, suggestPages } from '../src/server/lib/page-list.js';
import { slugify } from '../src/shared/registry-ids.js';
import {
  addRegistryEntry,
  listRegistryEntries,
  listRegistryGrouping,
  removeRegistryEntry,
  renameRegistryEntry,
  setEntryFolder,
  updateRegistryEntry,
  writeRegistryFolders,
} from '../src/server/lib/registry-store.js';

export const DEFAULT_ORIGIN = 'https://pinpoint.localhost';
/** 服务在 portless 里的注册名 / 主机名（`portless run --name pinpoint`）。 */
export const PORTLESS_HOSTNAME = 'pinpoint.localhost';

// CLI 住在仓库里，仓库根就是 pinpoint workbench 自己的 dir entry 路径——
// 首次 add（registry 文件还不存在）时用它播种默认 pinpoint 条目，与
// loadRegistry 的 missing-file 语义一致，workbench 自己的标注桶不会丢。
// status 也拿它跟服务自报的 root 比对（2026-09-04 事故：进程还在，抱着搬迁前的
// 旧绝对路径跑裸默认配置）。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BOARDS = new Set(['ios', 'html']);
// 值选项与布尔开关（布尔开关不吃下一个 token，也不许带 =值）。
const VALUE_FLAGS = new Set(['title', 'board', 'id', 'registry', 'page', 'screen', 'frame', 'status', 'mode', 'group-by', 'note', 'scale']);
const BOOLEAN_FLAGS = new Set(['draft', 'watch', 'full', 'json', 'marks', 'dry-run']);
// 每个命令接受的选项与位置参数个数。folder / locate / shot / mark 的位置参数
// 个数按子命令定（variadic = null），由命令自己校验下限。
const COMMANDS = {
  add: { positional: 1, flags: new Set(['title', 'board', 'id', 'registry', 'page', 'draft']) },
  move: { positional: 2, flags: new Set(['registry']) },
  rename: { positional: 2, flags: new Set(['registry']) },
  remove: { positional: 1, flags: new Set(['registry']) },
  folder: { positional: null, flags: new Set(['registry', 'id']) },
  status: { positional: 0, flags: new Set(['page', 'registry']) },
  start: { positional: 0, flags: new Set() },
  stop: { positional: 0, flags: new Set() },
  restart: { positional: 0, flags: new Set() },
  build: { positional: 1, flags: new Set(['registry', 'screen', 'watch']) },
  render: { positional: 1, flags: new Set(['registry', 'full']) },
  check: { positional: 1, flags: new Set(['registry', 'frame', 'status', 'mode', 'group-by', 'json']) },
  locate: { positional: null, flags: new Set(['registry', 'status', 'page']) },
  shot: { positional: null, flags: new Set(['registry', 'status', 'scale', 'marks', 'page']) },
  mark: { positional: null, flags: new Set(['registry', 'status', 'note', 'page']) },
  prune: { positional: 1, flags: new Set(['registry', 'dry-run']) },
};

// `pinpoint folder <子命令>`（2026-09-04 裁决 5a）：owner 手建的一层分组，
// workbench 的拖放走服务端写接口，CLI 是同一份登记表的另一个入口。
const FOLDER_SUBCOMMANDS = {
  list: { positional: 0, flags: new Set(['registry']) },
  add: { positional: 1, flags: new Set(['registry', 'id']) },
  rename: { positional: 2, flags: new Set(['registry']) },
  rm: { positional: 1, flags: new Set(['registry']) },
  move: { positional: 2, flags: new Set(['registry']) },
};
/** `pinpoint folder move <id> none` = 拖出文件夹（散页）。 */
const NO_FOLDER = 'none';

export class CliError extends Error {}

export const USAGE = `用法：
  pinpoint list [关键词…]                               列出页：id · 标题 · 类型 · 标注计数 · 源路径；关键词在 id / 标题 / 路径上宽松匹配
  pinpoint add <目录|文件.html|http(s)://URL> [选项]   登记一个新条目
  pinpoint move <id> <新目录|新文件|新URL>             把既有条目重指到新路径（保留 id）
  pinpoint rename <旧 id> <新 id>                      给既有条目改 id（登记表 + 标注桶 + 资源前缀一起改）
  pinpoint remove <id>                                 从登记表删一个条目（源文件 / URL 不动；详见下面 remove 一节）
  pinpoint folder <list|add|rename|rm|move> …          左栏的一层分组（详见下面 folder 一节）
  pinpoint build <页> [--screen <屏>] [--watch]        编译一页（源码 → dist），打印每屏 ok / 错误与耗时
  pinpoint render <页>/<屏> [--full]                   编译一帧打到 stdout（不落 dist）；超 8000 字符截断并落全文文件
  pinpoint check <页> [选项]                           标注清单（只读）：序号 / 正文 / 意图 / 源码摘录 / 状态 / note
  pinpoint locate <引用…> [--page <页>]                标注定位：#n → 源文件:行 · 组件（共用 n 帧）
  pinpoint shot <引用…> [--marks] [--scale 1]          出图：帧 B3 / 段 B / 整页 <页>，--marks 烤 #n 序号钉
  pinpoint mark <引用…> done|check [--note "…"]        写状态（open 由编辑触发、close 只在工作台）；逐条打印结果
  pinpoint status [--page <页>]                        服务体检；--page 改报该页各状态计数与 dist 是否过期
  pinpoint prune <页> [--dry-run]                      删除该页桶里的孤儿账本（表面已不存在；--dry-run 只列不删）
  pinpoint start | stop | restart                      起 / 停 / 重起常驻服务

add —— 把评审目标登记进 pinpoint registry（文件留在原地，CLI 只登记路径/URL）：
  目录             → kind "dir"，服务只读 host 在 /sites/<id>/ 并注入标注
  单个 .html 文件  → kind "file"，仅 serve 该文件（/sites/<id>/ 与 /sites/<id>/<文件名>）
  http(s)://URL    → kind "url"，同源代理内嵌 + 内嵌响应注入标注

选项（add）：
  --title X        显示名（默认：目录名 / 文件名 / hostname）
  --board X        workbench 壳：ios | html（默认 html；仅 dir 条目生效，file 恒 doc）
  --id xxx         本条目自己的 id（默认由名称 slug 派生；撞既有 id 一律报错，不静默改名）
  --page xxx       挂到既有页 <id>，不是指定本条目的 id：本条目不再自成 Pages 行，
                   而是并进 <id> 那一页的「内容」区（仅 dir/file；url 恒独立页）。
                   反例：要让本条目自己叫 weekly-review-v2，用 --id weekly-review-v2；
                   写成 --page weekly-review 是把它塞进 weekly-review 那一页。
  --draft          搭配 --page：条目落目标页的草稿组（缺省落产物组）
  --registry 路径  覆盖 registry 文件位置
                  （默认 ~/.pinpoint/registry.json；亦可用 PINPOINT_REGISTRY 环境变量）

选项（move）：
  --registry 路径  同上。move 只改 kind/path/url，id 与 title 原样保留——
                   标注桶按页寻址（桶 = 页：自成页的条目用 ~/.pinpoint/<id>/，
                   挂靠条目用宿主页的桶），换路径不动既有标注。

选项（rename）：
  --registry 路径  同上。rename 一次做四件事，四件都能做才动手：
                   ① 登记表里换 id（含挂在旧 id 上的条目的 page 字段）
                   ② 标注桶 ~/.pinpoint/<旧 id>/ 改名成 <新 id>/（标注不孤儿化）
                   ③ dir 条目目录下 *.html/*.css/*.js 里的 /sites/<旧 id>/ 换成新前缀
                   ④ 服务重载
                   把两个条目合并成一个 = rename + move（先把其中一个改成目标 id
                   之外的名字，再 move 到同一个落点）。

remove —— 把一个条目从登记表里删掉。只删登记：源文件 / URL 留在原地，重新
  \`pinpoint add\` 同一个目标即恢复登记。三种情况拒绝动手，登记表一个字节不动：
  · id 不存在；
  · 还有条目挂着它（page 字段等于它）——先把那些条目 remove 掉（重新 add
    时用 --page 挂到别的页）；
  · 标注桶 ~/.pinpoint/<id>/ 里还有标注行——先在工作台处理，或用
    \`pinpoint prune <id>\`（--dry-run 先看清单）清掉孤儿账本。
  桶不存在或只剩空账本 / _seq.json 时放行，并顺手删掉这个空桶。

选项（remove）：
  --registry 路径  同上

folder —— 左栏的一层分组（不嵌套；workbench 里拖放写的是同一份登记表，CLI 是另一个入口）：
  pinpoint folder list                      列出文件夹：id / 名称 / 页数 / 是否折叠
  pinpoint folder add <名称> [--id xxx]     建一个夹（id 默认由名称 slug 派生；中文名派生不出，用 --id）
  pinpoint folder rename <id> <新名称>      只改显示名，id 不变（条目的归属引用不用动）
  pinpoint folder rm <id>                   删夹。**夹里的页不会被删**：它们丢掉归属变成散页
  pinpoint folder move <页 id> <夹 id>      把一个页放进夹；夹 id 写 ${NO_FOLDER} = 移出来变散页
                                            页 id 可以是 registry 条目 id，也可以是本地 manifest 页 id

选项（folder）：
  --registry 路径  同上（list 之外的子命令要求登记表已经存在）
  --id xxx         只用于 folder add：显式指定新夹的 id

build / render —— pp2 的编译面（<页> = registry dir 条目 id 或模板页 id）：
  pinpoint build <页>                  整页编译到 dist（<dataRoot>/dist/<页>/）
  pinpoint build <页> --screen <屏>    只编一屏（build.json 里其余屏的记录保留）
  pinpoint build <页> --watch          编完后 fs.watch 盯页目录，变更自动重编
  pinpoint render <页>/<屏>            编译该帧（不落 dist）打到 stdout；超 8000 字符
                                       截断，全文写 <dataRoot>/render/<页>/<屏>.html
                                       并在末尾打出路径；--full 不截断
  --registry 路径                      解析页 id 用哪份 registry（同 add）

check / locate / shot / mark —— pp2 的标注面。引用语法四处共用：
  #12 · <entry>#12 · #3-#7（区间）· B3（帧，展开为帧内标注）· B（整段）·
  <页>（整页，shot）· @frame:<页>/<屏> · @a:<id> · --status open|check|done|close|all

  pinpoint check <页> [--frame B3] [--status open|check|done|close|all]
                  [--mode excerpt|image|both] [--group-by frame|component] [--json]
                                       默认 open、按帧分组；excerpt 给最小完整元素 + 父链
                                       面包屑 + 兄弟折叠（约 300 token）；image 走服务渲染器
                                       1x 截图到 <dataRoot>/check/<页>/<屏>.png（服务要在跑）
  pinpoint locate <引用…>              每条一行：#n → 源文件:行 · 组件（共用 n 帧）；
                                       存量 HTML 页给 dist 路径 + selector
  pinpoint shot <引用…> [--scale 1] [--marks]
                                       PNG 到 <dataRoot>/shot/<页>/<引用>.png，打印路径；
                                       --marks 烤 #n 序号钉（清单由 check 给）
  pinpoint mark <引用…> done|check [--note "…"]
                                       走服务状态端点（带 baseRevision）；冲突 / 非法转换
                                       打 409 原因，不中断其他条；open 由 owner 编辑触发、
                                       close 只在工作台，两者 mark 都不写
  --page <页>                          locate / shot / mark 的基页（缺省 registry 第一个可编译页）
  --registry 路径                      同 add

list —— 把口头说的页对上页 id。每页两行：id · 标题 · 类型（编译页 / 文档页 / 网页 /
  单文件，模板页另标）· open / check / done 计数 · 文件夹；次行源路径（挂靠条目列在宿主下）。
  带关键词时只列匹配的，按匹配程度排序：多个词要同时对上，英文复数自动去 s
  （routines 能对上 routine-creator），连字符与空格互通。例：
    pinpoint list routines          → routine-creator  ·  Routine 创建  ·  编译页 …
    pinpoint list areta 界面
  其他命令找不到页时，也按同一规则给最接近的候选。

prune —— 孤儿账本清理（storage-unify：桶 = 页）。孤儿 = 表面已不存在的账本：
  文档文件删了、条目改挂别页或从登记表移走了、页不在 registry 与 manifest 里
  了（整桶皆孤儿）。check / status --page 会把这些行单独列出（不计入 open 等
  计数）；页信息面板显示每页孤儿数。清理只经本命令，直接删除、不备份
  （owner 裁决）；--dry-run 先看清单。

  -h, --help       显示本说明

环境变量：
  PINPOINT_REGISTRY   同 --registry（--registry 优先）
  PINPOINT_ORIGIN     服务地址（默认 ${DEFAULT_ORIGIN}）；写入后 CLI 会
                      GET /health 探活，可达则 POST /registry/reload 即时生效；
                      check --mode image / shot / mark 也走它
  PORTLESS_ROUTES     portless 路由表位置（默认 ~/.portless/routes.json），status 读它`;

/** 参数解析（纯函数）。add 返回 { command, target, flags }，move 返回 { command, id, target, flags }，
    服务命令返回 { command, flags }；非法输入抛 CliError。 */
export function parseArgs(argv) {
  const args = [...argv];
  if (args.includes('-h') || args.includes('--help')) return { help: true };
  const command = args.shift();
  if (!command) throw new CliError('缺少命令（add / move / rename / folder / status / start / stop / restart）');
  const spec = COMMANDS[command];
  if (!spec) throw new CliError(`未知命令：${command}`);
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
      if (!spec.flags.has(name)) throw new CliError(`选项 --${name} 不适用于 ${command}`);
      flags[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new CliError(`未知选项：--${name}`);
    }
    if (!spec.flags.has(name)) throw new CliError(`选项 --${name} 不适用于 ${command}`);
    const value = inline > 0 ? arg.slice(inline + 1) : args[++i];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new CliError(`选项 --${name} 缺少值`);
    }
    flags[name] = value;
  }
  if (command === 'folder') return parseFolderArgs(positional, flags);
  if (spec.positional !== null && positional.length !== spec.positional) {
    throw new CliError(positionalProblem(command, spec.positional, positional.length));
  }
  if (command === 'add') return { command, target: positional[0], flags };
  if (command === 'move') return { command, id: positional[0], target: positional[1], flags };
  if (command === 'rename') return { command, id: positional[0], newId: positional[1], flags };
  if (command === 'remove') return { command, id: positional[0], flags };
  if (command === 'build' || command === 'render' || command === 'check' || command === 'prune') return { command, target: positional[0], flags };
  if (command === 'locate' || command === 'shot') {
    if (!positional.length) throw new CliError(`${command} 至少要一个引用（#n / entry#n / B3 / B / 页 / @frame:p/s / @a:id）`);
    return { command, refs: positional, flags };
  }
  if (command === 'mark') {
    if (positional.length < 2) throw new CliError('mark 需要引用与状态：ppnt mark <ref…> done|check [--note "…"]');
    return { command, refs: positional.slice(0, -1), statusWord: positional[positional.length - 1], flags };
  }
  return { command, flags };
}

/** folder 的子命令层：第一个位置参数是子命令，其余按子命令的固定个数校验。 */
function parseFolderArgs(positional, flags) {
  const [sub, ...args] = positional;
  if (!sub) {
    throw new CliError(`folder 需要一个子命令（${Object.keys(FOLDER_SUBCOMMANDS).join(' / ')}）`);
  }
  const spec = FOLDER_SUBCOMMANDS[sub];
  if (!spec) throw new CliError(`未知子命令：folder ${sub}（可用：${Object.keys(FOLDER_SUBCOMMANDS).join(' / ')}）`);
  for (const name of Object.keys(flags)) {
    if (!spec.flags.has(name)) throw new CliError(`选项 --${name} 不适用于 folder ${sub}`);
  }
  if (args.length !== spec.positional) {
    throw new CliError(`folder ${sub} 需要 ${spec.positional} 个参数，收到 ${args.length} 个`);
  }
  return { command: 'folder', sub, args, flags };
}

function positionalProblem(command, want, got) {
  if (command === 'add') {
    return got === 0 ? 'add 需要一个目标（目录 / 文件 / URL）' : `add 只接受一个目标，收到 ${got} 个`;
  }
  if (command === 'move') {
    return got < 2
      ? 'move 需要两个参数：<id> <新目录|新文件|新URL>'
      : `move 只接受两个参数，收到 ${got} 个`;
  }
  if (command === 'rename') {
    return got < 2
      ? 'rename 需要两个参数：<旧 id> <新 id>'
      : `rename 只接受两个参数，收到 ${got} 个`;
  }
  if (command === 'remove') {
    return got === 0 ? 'remove 需要一个条目 id' : `remove 只接受一个条目 id，收到 ${got} 个`;
  }
  if (command === 'build') {
    return got === 0 ? 'build 需要一个页（registry 条目 id 或模板页 id）' : `build 只接受一个页，收到 ${got} 个`;
  }
  if (command === 'render') {
    return got === 0 ? 'render 需要一帧（<page>/<screen>）' : `render 只接受一帧，收到 ${got} 个`;
  }
  if (command === 'check') {
    return got === 0 ? 'check 需要一个页（registry 条目 id 或模板页 id）' : `check 只接受一个页，收到 ${got} 个`;
  }
  if (command === 'prune') {
    return got === 0 ? 'prune 需要一个页（或桶 id）' : `prune 只接受一个页，收到 ${got} 个`;
  }
  return `${command} 不接受位置参数，收到 ${got} 个`;
}

export { slugify };

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
function existingEntriesFor(registryPath) {
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

/**
 * 零依赖的 JSON 请求（GET/POST）。为什么不用全局 fetch：常驻服务经 portless
 * 代理暴露在 https://pinpoint.localhost，证书是本地自签 CA——curl 走系统
 * 钥匙串能验，node 的 fetch 读不到钥匙串会 SELF_SIGNED_CERT_IN_CHAIN。
 * 目标只是本机开发服务的探活/reload，故 https 关闭证书校验。
 * 返回 { status, json }；网络/超时错误 reject。
 */
export function requestJson(urlString, { method = 'GET', timeoutMs = 1500, body = null } = {}) {
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
        ...(body != null ? { headers: { 'Content-Type': 'application/json' } } : {}),
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
    req.end(body == null ? undefined : JSON.stringify(body));
  });
}

/** 写盘成功后的即时生效：服务可达就让它重读 registry；不可达不视为失败。 */
async function reloadService({ env, requestFn, registryPath, out, err }) {
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

function ioOf(io) {
  return {
    cwd: io.cwd || process.cwd(),
    env: io.env || process.env,
    out: io.out || ((line) => console.log(line)),
    err: io.err || ((line) => console.error(line)),
    requestFn: io.requestFn || requestJson,
  };
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

/** portless 路由表位置（PORTLESS_ROUTES 覆盖，给测试与非默认安装用）。 */
export function portlessRoutesPath(env = process.env) {
  return env.PORTLESS_ROUTES || path.join(os.homedir(), '.portless', 'routes.json');
}

/** routes.json 文本 → 规范化的 [{hostname, port, pid}]；坏文件当空表（status 另有一行说路由没有）。 */
export function parseRoutes(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(doc)) return [];
  return doc
    .filter((row) => row && typeof row.hostname === 'string' && Number.isFinite(Number(row.port)))
    .map((row) => ({ hostname: row.hostname, port: Number(row.port), pid: Number(row.pid) || 0 }));
}

export function pickRoute(routes, hostname = PORTLESS_HOSTNAME) {
  return routes.find((route) => route.hostname === hostname) || null;
}

function readRoutes(routesPath) {
  try {
    return parseRoutes(fs.readFileSync(routesPath, 'utf8'));
  } catch {
    return [];
  }
}

/** 服务日志目录（PINPOINT_DATA_DIR 跟着走，与标注数据同一个根）。 */
export function serviceLogPath(env = process.env) {
  return path.join(dataRoot(env), 'logs', 'service.log');
}

const CJK = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

/** 终端显示宽度（全角算 2），给状态表对齐用。 */
export function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) width += CJK.test(ch) ? 2 : 1;
  return width;
}

function padWide(text, width) {
  return String(text) + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

const STATE_LABEL = { ok: '正常', bad: '失败', warn: '注意', skip: '—' };

/**
 * 由采集到的事实判定服务状态（纯函数）。输入：
 *   repoRoot   CLI 所在仓库根
 *   routesPath portless 路由表路径（报错时打印）
 *   route      { hostname, port, pid } | null
 *   pidAlive   route.pid 是否还活着
 *   direct     { ok, status?, json?, error? } —— http://127.0.0.1:<port>/health（直连 vite）
 *   proxied    同上 —— https://pinpoint.localhost/health（穿 portless 代理）
 * 两条健康检查都做：2026-09-04 的故障恰恰是「vite 活着但听错端口、代理 502」，
 * 只查一条分不出「进程没了」和「进程在但配置错」。
 */
export function classifyStatus({ repoRoot, routesPath, route, pidAlive = false, direct = null, proxied = null }) {
  const rows = [];
  const health = (direct && direct.ok && direct.json) || (proxied && proxied.ok && proxied.json) || null;
  const serviceRoot = health && typeof health.root === 'string' ? health.root : null;

  rows.push(route
    ? { label: '路由', state: 'ok', detail: `${route.hostname} → 127.0.0.1:${route.port}` }
    : { label: '路由', state: 'bad', detail: `${routesPath} 里没有 ${PORTLESS_HOSTNAME}：服务没起过或已注销` });

  if (!route) rows.push({ label: '进程', state: 'skip', detail: '没有路由，无 pid 可查' });
  else if (!route.pid) rows.push({ label: '进程', state: 'bad', detail: 'routes.json 没记 pid' });
  else rows.push({ label: '进程', state: pidAlive ? 'ok' : 'bad', detail: `pid ${route.pid} ${pidAlive ? '在' : '已不在（进程死了）'}` });

  rows.push(probeRow('直连 /health', direct));
  rows.push(probeRow('代理 /health', proxied));

  if (!health) {
    rows.push({ label: '服务 root', state: 'skip', detail: '/health 不通，问不到' });
    rows.push({ label: 'registry', state: 'skip', detail: '/health 不通，问不到' });
  } else {
    if (!serviceRoot) {
      rows.push({ label: '服务 root', state: 'warn', detail: '/health 没有 root 字段（服务比本 CLI 旧，重启后可比对）' });
    } else if (serviceRoot === repoRoot) {
      rows.push({ label: '服务 root', state: 'ok', detail: serviceRoot });
    } else {
      rows.push({ label: '服务 root', state: 'bad', detail: `服务在 ${serviceRoot}；本 CLI 在 ${repoRoot}` });
    }
    const registry = health.registry || {};
    const errors = Array.isArray(registry.errors) ? registry.errors : [];
    const warnings = Array.isArray(registry.warnings) ? registry.warnings : [];
    const detail = `${registry.entries ?? 0} 条，${errors.length} error，${warnings.length} warning — ${registry.path || '路径未知'}`;
    rows.push({ label: 'registry', state: errors.length ? 'bad' : (warnings.length ? 'warn' : 'ok'), detail });
    for (const line of [...errors, ...warnings]) rows.push({ label: '', state: 'note', detail: line });
  }

  const bad = rows.filter((row) => row.state === 'bad');
  const ok = bad.length === 0;
  return {
    ok,
    rows,
    pid: route ? route.pid : 0,
    port: route ? route.port : 0,
    pidAlive: Boolean(route && route.pid && pidAlive),
    serviceRoot,
    diagnosis: diagnose({ ok, rows, route, pidAlive, direct, proxied, serviceRoot, repoRoot }),
  };
}

function probeRow(label, probe) {
  if (!probe) return { label, state: 'skip', detail: '没有路由端口，没打' };
  if (probe.ok) return { label, state: 'ok', detail: `${probe.url} 200` };
  const why = probe.error ? probe.error : `HTTP ${probe.status}`;
  return { label, state: 'bad', detail: `${probe.url} ${why}` };
}

function diagnose({ ok, rows, route, pidAlive, direct, proxied, serviceRoot, repoRoot }) {
  if (ok) {
    return rows.some((row) => row.state === 'warn')
      ? '服务在跑，但有告警（见上）。'
      : '服务正常。';
  }
  if (!route) return '服务没在跑：portless 里没有这个 app 的路由。跑 `pinpoint start`。';
  if (!route.pid || !pidAlive) return '路由还在、进程没了（2026-08-17 形态：页面 404）。跑 `pinpoint restart`。';
  if (direct && !direct.ok) {
    return '进程活着但直连 /health 不通（2026-09-04 形态：vite 抱着旧绝对路径跑裸默认配置，端口/插件全落回默认）。跑 `pinpoint restart`。';
  }
  if (proxied && !proxied.ok) {
    return 'vite 在听自己的端口，但穿代理打不通：portless proxy daemon 或路由端口不对（proxy daemon 不归 pinpoint 管，自己看 `portless proxy`）。';
  }
  if (serviceRoot && serviceRoot !== repoRoot) {
    return `服务跑的是另一个目录（${serviceRoot}），不是本 CLI 所在的仓库（${repoRoot}）。要让服务改跑这里，在这里 \`pinpoint restart\`。`;
  }
  return 'registry 有 error，服务在按回落表跑（见上）。';
}

/** 状态表（一屏）。 */
export function formatStatus(report) {
  const labelWidth = Math.max(...report.rows.map((row) => displayWidth(row.label)), 10);
  const lines = report.rows.map((row) => (row.state === 'note'
    ? `  ${' '.repeat(labelWidth)}      · ${row.detail}`
    : `  ${padWide(row.label, labelWidth)}  ${padWide(STATE_LABEL[row.state], 4)}  ${row.detail}`));
  lines.push(`  → ${report.diagnosis}`);
  return lines;
}

/** start 的判定：健康就拒绝；进程还在但不健康也拒绝（同名 portless 注册会打架，走 restart）。 */
export function decideStart(report) {
  if (report.ok) return { action: 'refuse', reason: '服务已经在跑且健康；要重来用 `pinpoint restart`。' };
  if (report.pidAlive) {
    return { action: 'refuse', reason: `服务进程还在（pid ${report.pid}）但不健康；先 \`pinpoint stop\`，或直接 \`pinpoint restart\`。` };
  }
  return { action: 'start' };
}

/** stop 的判定：没有活进程就是幂等的 no-op。 */
export function decideStop(report) {
  if (!report.pid) return { action: 'none', reason: '没有在跑的 pinpoint 服务（portless 路由里没有 pid）。' };
  if (!report.pidAlive) return { action: 'none', reason: `路由记的 pid ${report.pid} 已不在；没有要停的进程。` };
  return { action: 'kill', pid: report.pid };
}

/** 采集一次现状（读 routes.json + 两条 /health），交给 classifyStatus 判定。 */
export async function collectStatus(io = {}) {
  const { env, requestFn } = ioOf(io);
  const pidAliveFn = io.pidAlive || (() => false);
  const routesPath = portlessRoutesPath(env);
  const route = pickRoute(readRoutes(routesPath));
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  const direct = route ? await probe(`http://127.0.0.1:${route.port}/health`, requestFn) : null;
  const proxied = await probe(`${origin}/health`, requestFn);
  return classifyStatus({
    repoRoot: REPO_ROOT,
    routesPath,
    route,
    pidAlive: route && route.pid ? Boolean(pidAliveFn(route.pid)) : false,
    direct,
    proxied,
  });
}

async function probe(url, requestFn) {
  try {
    const res = await requestFn(url, { timeoutMs: 2000 });
    return { url, ok: res.status === 200 && Boolean(res.json), status: res.status, json: res.json };
  } catch (error) {
    return { url, ok: false, error: error.message };
  }
}

export async function runStatus(argv, io = {}) {
  const { env, out } = ioOf(io);
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  if (parsed.flags.page) return printPageStatus(parsed, { env, out, err: ioOf(io).err });
  const report = await collectStatus(io);
  out('pinpoint status');
  for (const line of formatStatus(report)) out(line);
  return report.ok ? 0 : 1;
}

function guardParse(argv, io) {
  const { out, err } = ioOf(io);
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) {
      out(USAGE);
      return { help: true };
    }
    return parsed;
  } catch (error) {
    err(`错误：${error.message}`);
    err(USAGE);
    return 1;
  }
}

export async function runStop(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  return stopService(io);
}

/** SIGTERM → 有界等待退出 → 复核路由/进程。返回退出码。 */
async function stopService(io) {
  const { env, out, err } = ioOf(io);
  const pidAlive = io.pidAlive || (() => false);
  const killPid = io.killPid;
  const sleep = io.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const report = await collectStatus(io);
  const decision = decideStop(report);
  if (decision.action === 'none') {
    out(decision.reason);
    return 0;
  }
  if (!killPid) throw new Error('runStop 需要 io.killPid');
  out(`停 pid ${decision.pid}（SIGTERM）…`);
  try {
    killPid(decision.pid, 'SIGTERM');
  } catch (error) {
    err(`发信号失败：${error.message}`);
    return 1;
  }
  const deadline = 8000;
  for (let waited = 0; waited < deadline; waited += 250) {
    await sleep(250);
    if (!pidAlive(decision.pid)) break;
  }
  // 复核：路由消失（portless 注销）或 pid 已死，两者任一即算停住。
  const route = pickRoute(readRoutes(portlessRoutesPath(env)));
  const gone = !route || route.pid !== decision.pid || !pidAlive(decision.pid);
  if (!gone) {
    err(`pid ${decision.pid} 在 ${deadline / 1000}s 内没退出；手动查 \`ps -p ${decision.pid}\` 再决定要不要 SIGKILL。`);
    return 1;
  }
  out('已停。');
  return 0;
}

export async function runStart(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  return startService(io);
}

/** spawn → 轮询健康（~20s）→ 打状态表。返回退出码。 */
async function startService(io) {
  const { env, out, err } = ioOf(io);
  const sleep = io.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const before = await collectStatus(io);
  const decision = decideStart(before);
  if (decision.action === 'refuse') {
    err(decision.reason);
    for (const line of formatStatus(before)) err(line);
    return 1;
  }
  if (!io.spawnService) throw new Error('runStart 需要 io.spawnService');
  const logFile = serviceLogPath(env);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const child = io.spawnService({ cwd: REPO_ROOT, logFile });
  out(`已在 ${REPO_ROOT} 启动 \`npm run dev\`（pid ${child && child.pid}），日志：${logFile}`);
  let report = before;
  for (let waited = 0; waited < 20000; waited += 1000) {
    await sleep(1000);
    report = await collectStatus(io);
    if (report.ok) break;
  }
  out('pinpoint status');
  for (const line of formatStatus(report)) out(line);
  if (!report.ok) err(`20s 内没起来；看日志：tail -n 40 ${logFile}`);
  return report.ok ? 0 : 1;
}

export async function runRestart(argv, io = {}) {
  const { out } = ioOf(io);
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const stopped = await stopService(io);
  if (stopped !== 0) return stopped;
  out('');
  return startService(io);
}

/* ---- pp2：build / render（编译面，进程内直接编译，不依赖服务） ---- */

/** 解析 <页> 为编译目标；找不到时报错并列出可用 id。返回 null 表示已报错。 */
function pageTargetOrReport(pageRef, flags, { env, err }) {
  const registryPath = resolveRegistryPath(flags, env);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath });
  const target = resolvePageTarget(pageRef, { registry, root: REPO_ROOT });
  if (!target) {
    err(`错误：找不到页：${pageRef}`);
    if (!reportPageSuggestions(pageRef, { registryPath, env, err })) {
      const ids = listPageIds({ registry, root: REPO_ROOT });
      err(`可用页 id：${ids.join('、') || '（无）'}`);
    }
    return null;
  }
  return target;
}

function printBuildResult(result, { out, err }, plan = null) {
  // 漂移：build.json 记下的文件变了却没收到 watch 事件（丢事件 / 页外依赖），
  // 这一拍已按全编纠正；打一行让「为什么突然整页重编」有据可查。
  if (plan && plan.drift) out(`注意 ${plan.drift} 变了但没收到 watch 事件，整页重编`);
  for (const row of result.screens) {
    if (row.ok) out(`ok   ${row.id}  ${row.ms}ms`);
    else err(`错误 ${row.id}  ${row.error}`);
  }
  if (result.error) err(`错误 ${result.entryId}  ${result.error}`);
  // 增量拍只列点名的屏：写成「增量 M/N 屏」，免得读成整页只有 M 屏。
  const count = result.partial
    ? `增量 ${result.screens.length}/${result.totalScreens} 屏`
    : `${result.screens.length} 屏`;
  out(`${result.ok ? '完成' : '有失败'} ${result.entryId}  共 ${result.ms}ms（${count}）`);
}

/**
 * fs.watch 盯页目录：board.json / 帧 / 组件 / 资源变更 → 去抖后重编。返回 watcher（测试用）。
 * 盯的文件类型见 recompile-plan 的 isWatchedSource（deps 可能出现的 json / ts 等都在内，
 * dist、build.json、node_modules 不盯）。
 * 增量（审计 B1）：debounce 窗口里的多个文件攒成一批，按 recompile-plan 筛出
 * 命中的屏只编这些，筛不动就整页重编；计划在串行链轮到这一拍时才算 ——
 * build.json 是上一拍写下的，链上保证它是最新的。算计划时已经进了下一窗口的
 * 文件作为 pendingFiles 传给漂移校验：它们有自己的一拍，不算漂移。
 * 每拍单独 catch：一拍抛错（文件在 stat 与读之间被删、dist 写盘 IO 错）只打日志，
 * 串行链不能永久 rejected，否则之后的批次全部静默不编。
 */
export function startPageWatch(target, onResult, { debounceMs = 120, distRoot, onError = null } = {}) {
  let timer = null;
  let running = Promise.resolve();
  const pending = new Set();
  const reportError = onError || ((error) => console.error(`[pp2] 编译 ${target.entryId} 异常：${(error && error.message) || error}`));
  const watcher = fs.watch(target.pageDir, { recursive: true }, (_event, filename) => {
    const abs = filename ? path.resolve(target.pageDir, String(filename)) : null;
    if (abs && !isWatchedSource(abs, { distRoot })) return;
    // 平台拿不到文件名时存 null：planRecompile 对拿不准的批次回落全编。
    pending.add(abs);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const batch = [...pending];
      pending.clear();
      running = running.then(async () => {
        const options = distRoot ? { distRoot } : {};
        const plan = planPageRecompile(target, batch, { ...options, pendingFiles: [...pending].filter(Boolean) });
        if (!plan.all) options.onlyScreens = plan.screens;
        const result = await compilePage(target, options);
        return onResult(result, plan);
      }).catch(reportError);
    }, debounceMs);
  });
  return { watcher, done: () => running };
}

export async function runBuild(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const target = pageTargetOrReport(parsed.target, parsed.flags, { env, err });
  if (!target) return 1;
  const distRoot = path.join(dataRoot(env), 'dist');
  const first = await compilePage(target, { distRoot, onlyScreen: parsed.flags.screen || null });
  printBuildResult(first, { out, err });
  if (!parsed.flags.watch) return first.ok ? 0 : 1;
  out(`监视 ${target.pageDir}（Ctrl-C 退出）…`);
  startPageWatch(target, (result, plan) => printBuildResult(result, { out, err }, plan), {
    distRoot,
    onError: (error) => err(`错误 ${target.entryId}  编译异常：${(error && error.message) || error}（继续监视）`),
  });
  return new Promise(() => {}); // watch 常驻，进程不退出
}

/** render 输出形态（纯函数）：超 limit 截断并给出全文落盘计划。 */
export function planRenderOutput(html, { full = false, limit = 8000, spillPath = null } = {}) {
  if (full || html.length <= limit) return { text: html, spill: null };
  return {
    text: `${html.slice(0, limit)}\n… 已截断（共 ${html.length} 字符），全文见 ${spillPath}`,
    spill: spillPath ? { path: spillPath, content: html } : null,
  };
}

export async function runRender(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const ref = parsed.target;
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) {
    err(`错误：render 参数形如 <页>/<屏>，收到：${ref}`);
    return 1;
  }
  const pageRef = ref.slice(0, slash);
  const screenId = ref.slice(slash + 1);
  const target = pageTargetOrReport(pageRef, parsed.flags, { env, err });
  if (!target) return 1;
  const result = await renderScreenHtml(target, screenId);
  if (!result.ok) {
    err(`编译失败：${result.error}`);
    return 1;
  }
  const spillPath = path.join(dataRoot(env), 'render', pageRef, `${screenId}.html`);
  const plan = planRenderOutput(result.html, { full: !!parsed.flags.full, spillPath });
  if (plan.spill) {
    fs.mkdirSync(path.dirname(plan.spill.path), { recursive: true });
    fs.writeFileSync(plan.spill.path, plan.spill.content);
  }
  out(plan.text);
  return 0;
}

/* ---- pp2 切片 4：check / locate / shot / mark（标注面，只读为主） ---- */

const CHECK_STATUSES = new Set(['open', 'check', 'done', 'close', 'all']);
const CHECK_MODES = new Set(['excerpt', 'image', 'both']);
const GROUP_BYS = new Set(['frame', 'component']);

/** locate / shot / mark 的基页：--page 优先，缺省取 registry 第一个可编译页。 */
function pageRefFor(parsed, { env, err }) {
  if (parsed.target) return parsed.target;
  if (parsed.flags.page) return parsed.flags.page;
  const registryPath = resolveRegistryPath(parsed.flags, env);
  const registry = loadRegistry({ root: REPO_ROOT, path: registryPath });
  const first = listPageIds({ registry, root: REPO_ROOT })[0];
  if (!first) err('错误：registry 里没有可编译页；用 --page <页 id> 指定。');
  return first || null;
}

/** 装配查询上下文（dist 读取器注入；找不到页时已报错，返回 null）。 */
function loadAnnotateContext(pageRef, parsed, { env, err }) {
  if (!pageRef) return null;
  const registryPath = resolveRegistryPath(parsed.flags, env);
  const context = loadPageContext({ pageRef, registryPath, dataRootDir: dataRoot(env) });
  if (!context) {
    err(`错误：找不到页：${pageRef}`);
    if (!reportPageSuggestions(pageRef, { registryPath, env, err })) {
      const registry = loadRegistry({ root: REPO_ROOT, path: registryPath });
      err(`可用页 id：${listPageIds({ registry, root: REPO_ROOT }).join('、') || '（无）'}`);
    }
    return null;
  }
  const distRoot = path.join(dataRoot(env), 'dist');
  context.distHtmlFor = (screenId) => {
    const read = readDistScreen(context.target.entryId, screenId, { distRoot });
    return read.kind === 'ok' ? read.html : null;
  };
  context.readFile = (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
  return context;
}

export async function runCheck(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const status = parsed.flags.status || 'open';
  if (!CHECK_STATUSES.has(status)) {
    err(`错误：--status 只支持 ${[...CHECK_STATUSES].join(' / ')}，收到：${status}`);
    return 1;
  }
  const mode = parsed.flags.mode || 'excerpt';
  if (!CHECK_MODES.has(mode)) {
    err(`错误：--mode 只支持 excerpt / image / both，收到：${mode}`);
    return 1;
  }
  const groupBy = parsed.flags['group-by'] || 'frame';
  if (!GROUP_BYS.has(groupBy)) {
    err(`错误：--group-by 只支持 frame / component，收到：${groupBy}`);
    return 1;
  }
  const context = loadAnnotateContext(parsed.target, parsed, { env, err });
  if (!context) return 1;
  const report = buildCheckReport(context, { frame: parsed.flags.frame || null, status, groupBy, mode });
  if (report.error) {
    err(`错误：${report.error}`);
    return 1;
  }
  let imagePaths = null;
  if (mode === 'image' || mode === 'both') {
    const statusAllows = (row) => status === 'all' || (row.status || 'open') === status;
    const screenIds = [...new Set(report.groups.filter((group) => group.kind === 'frame' && !group.offBoard).map((group) => group.screenId))];
    if (screenIds.length) {
      const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
      let renderShots;
      try {
        ({ renderShots } = await import('./ppnt-shot.js'));
      } catch (error) {
        err(`错误：渲染器加载失败：${error.message}`);
        return 1;
      }
      const jobs = screenIds.map((screenId) => ({
        kind: 'frame',
        screenId,
        scale: 1,
        out: path.join(dataRoot(env), 'check', context.pageId, `${screenId}.png`),
        marks: context.frameRows.filter((row) => row.screenId === screenId && (row.status || 'open') !== 'close' && statusAllows(row)),
      }));
      try {
        await renderShots({ origin, pageId: context.pageId, jobs });
        imagePaths = Object.fromEntries(jobs.map((job) => [job.screenId, job.out]));
      } catch (error) {
        err(`错误：${error.message}`);
        return 1;
      }
    }
  }
  if (parsed.flags.json) {
    out(JSON.stringify({ ...report, images: imagePaths }, null, 2));
    return 0;
  }
  for (const line of formatCheckMarkdown(report, { imagePaths })) out(line);
  return 0;
}

export async function runLocate(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const context = loadAnnotateContext(pageRefFor(parsed, { env, err }), parsed, { env, err });
  if (!context) return 1;
  const rows = [...context.frameRows, ...context.docRows];
  const refCtx = { rows, board: context.board, pageId: context.pageId, crossPageRows: null };
  const { picks, errors } = expandRefs(parsed.refs, refCtx);
  if (parsed.flags.status) {
    if (!REF_STATUSES.includes(parsed.flags.status)) {
      err(`错误：--status 只支持 ${REF_STATUSES.join(' / ')}，收到：${parsed.flags.status}`);
      return 1;
    }
    for (const row of expandStatus(parsed.flags.status, rows)) picks.push({ kind: 'annotation', row, via: `--status ${parsed.flags.status}` });
  }
  for (const error of errors) err(error);
  const seen = new Set();
  const printRow = (row) => {
    const key = `${row.__bucket}|${row.__ledger}|${row.id || row.n}`;
    if (seen.has(key)) return;
    seen.add(key);
    out(locateLine(row, context).text);
  };
  for (const pick of picks) {
    if (pick.kind === 'annotation') printRow(pick.row);
    else if (pick.kind === 'frame') for (const row of rows.filter((row) => row.screenId === pick.screenId)) printRow(row);
    else if (pick.kind === 'section') for (const row of rows.filter((row) => pick.frames.some((frame) => frame.id === row.screenId))) printRow(row);
  }
  return errors.length ? 1 : 0;
}

/**
 * shot 的作业规划（纯函数，2026-09-23 页引用修复时抽出）：picks → 渲染作业。
 * 帧按 screenId 去重；段整段一图；页引用出整页一图。页 id 不必是基页（<页>
 * 语义），非基页经 contextFor 现场装载该页上下文 —— marks 与输出目录都跟着
 * 页走。渲染按页分组：一次 renderShots 只动一个画布页（ppnt-shot 的
 * setActivePage 是会话级的）。
 */
export function planShotJobs(picks, { basePageId, baseContext, scale, withMarks, contextFor, dataRootDir }) {
  const jobs = [];
  const problems = [];
  const contexts = new Map([[basePageId, baseContext]]);
  const contextOf = (pageId) => {
    if (!contexts.has(pageId)) contexts.set(pageId, contextFor ? contextFor(pageId) : null);
    return contexts.get(pageId);
  };
  const shotDirOf = (pageId) => path.join(dataRootDir, 'shot', pageId);
  const openRows = (ctx) => ctx.frameRows.filter((row) => (row.status || 'open') !== 'close');
  const seenScreens = new Set();
  const frameJob = (screenId, via) => {
    if (seenScreens.has(screenId)) return;
    seenScreens.add(screenId);
    jobs.push({
      kind: 'frame',
      pageId: basePageId,
      screenId,
      scale,
      out: path.join(shotDirOf(basePageId), `${via || screenId}.png`),
      marks: withMarks
        ? openRows(baseContext).filter((row) => row.screenId === screenId)
        : [],
    });
  };
  for (const pick of picks) {
    if (pick.kind === 'frame') frameJob(pick.screenId, pick.via);
    else if (pick.kind === 'annotation' && pick.row.screenId) frameJob(pick.row.screenId, pick.row.screenId);
    else if (pick.kind === 'section') {
      jobs.push({
        kind: 'section',
        pageId: basePageId,
        sectionId: pick.sectionId,
        scale,
        out: path.join(shotDirOf(basePageId), `${pick.via}.png`),
        marks: withMarks
          ? openRows(baseContext).filter((row) => pick.frames.some((frame) => frame.id === row.screenId))
          : [],
      });
    } else if (pick.kind === 'page') {
      const pageContext = contextOf(pick.pageId);
      if (!pageContext) {
        problems.push(`错误：找不到页：${pick.pageId}`);
        continue;
      }
      jobs.push({
        kind: 'page',
        pageId: pageContext.pageId,
        scale,
        out: path.join(shotDirOf(pageContext.pageId), `${pageContext.pageId}.png`),
        marks: withMarks ? openRows(pageContext) : [],
      });
    }
  }
  return { jobs, problems };
}

export async function runShot(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err } = ioOf(io);
  const scale = Number(parsed.flags.scale || 1);
  if (scale !== 1 && scale !== 2) {
    err(`错误：--scale 只支持 1 或 2，收到：${parsed.flags.scale || '(空)'}`);
    return 1;
  }
  const context = loadAnnotateContext(pageRefFor(parsed, { env, err }), parsed, { env, err });
  if (!context) return 1;
  const rows = [...context.frameRows, ...context.docRows];
  // 页引用（<页>）对照登记页 id 清单解析 —— 基页是 --page / 缺省第一页，页
  // 引用自己可以指向任何登记页（2026-09-23 修复「ppnt shot <页> 认不出」）。
  const registry = loadRegistry({ root: REPO_ROOT, path: resolveRegistryPath(parsed.flags, env) });
  const pageIds = listPageIds({ registry, root: REPO_ROOT });
  const { picks, errors } = expandRefs(parsed.refs, { rows, board: context.board, pageId: context.pageId, pageIds, crossPageRows: null }, { shotRefs: true });
  if (parsed.flags.status) {
    if (!REF_STATUSES.includes(parsed.flags.status)) {
      err(`错误：--status 只支持 ${REF_STATUSES.join(' / ')}，收到：${parsed.flags.status}`);
      return 1;
    }
    for (const screenId of [...new Set(expandStatus(parsed.flags.status, rows).map((row) => row.screenId).filter(Boolean))]) {
      picks.push({ kind: 'frame', screenId, via: screenId });
    }
  }
  for (const error of errors) err(error);
  const plan = planShotJobs(picks, {
    basePageId: context.pageId,
    baseContext: context,
    scale,
    withMarks: !!parsed.flags.marks,
    contextFor: (pageId) => loadAnnotateContext(pageId, parsed, { env, err }),
    dataRootDir: dataRoot(env),
  });
  for (const problem of plan.problems) err(problem);
  const jobs = plan.jobs;
  if (!jobs.length) {
    err('没有可拍的目标（引用都未命中）。');
    return 1;
  }
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  let renderShots;
  try {
    ({ renderShots } = await import('./ppnt-shot.js'));
  } catch (error) {
    err(`错误：渲染器加载失败：${error.message}`);
    return 1;
  }
  const byPage = new Map();
  for (const job of jobs) {
    if (!byPage.has(job.pageId)) byPage.set(job.pageId, []);
    byPage.get(job.pageId).push(job);
  }
  try {
    for (const [pageId, group] of byPage) {
      const results = await renderShots({ origin, pageId, jobs: group });
      for (const result of results) out(`${result.out} · ${result.width}×${result.height}`);
    }
  } catch (error) {
    err(`错误：${error.message}`);
    return 1;
  }
  return errors.length ? 1 : 0;
}

export async function runMark(argv, io = {}) {
  const parsed = guardParse(argv, io);
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  const { env, out, err, requestFn } = ioOf(io);
  if (parsed.statusWord === 'close') {
    err('close 只在工作台（owner 单击验收，带 toast 撤销）；ppnt mark 不接受 close。');
    return 1;
  }
  if (parsed.statusWord === 'open') {
    err('open 由工作台编辑触发，mark 不写；ppnt mark 只写 check / done。');
    return 1;
  }
  if (!['done', 'check'].includes(parsed.statusWord)) {
    err(`错误：状态只支持 done | check，收到：${parsed.statusWord}`);
    return 1;
  }
  const context = loadAnnotateContext(pageRefFor(parsed, { env, err }), parsed, { env, err });
  if (!context) return 1;
  const registryPath = resolveRegistryPath(parsed.flags, env);
  const crossPageRows = (pageRef) => {
    const other = loadPageContext({ pageRef, registryPath, dataRootDir: dataRoot(env) });
    return other ? [...other.frameRows, ...other.docRows] : [];
  };
  const rows = [...context.frameRows, ...context.docRows];
  const { picks, errors } = expandRefs(parsed.refs, { rows, board: context.board, pageId: context.pageId, crossPageRows });
  if (parsed.flags.status) {
    if (!REF_STATUSES.includes(parsed.flags.status)) {
      err(`错误：--status 只支持 ${REF_STATUSES.join(' / ')}，收到：${parsed.flags.status}`);
      return 1;
    }
    for (const row of expandStatus(parsed.flags.status, rows)) picks.push({ kind: 'annotation', row, via: `--status ${parsed.flags.status}` });
  }
  for (const error of errors) err(error);
  const annotationPicks = picks.filter((pick) => pick.kind === 'annotation');
  if (!annotationPicks.length) {
    err('没有命中的标注。');
    return 1;
  }
  const origin = env.PINPOINT_ORIGIN || DEFAULT_ORIGIN;
  try {
    const health = await requestFn(`${origin}/health`);
    if (health.status !== 200) throw new Error(`health ${health.status}`);
  } catch {
    err(`错误：pinpoint 服务未在跑（${origin}）；mark 写状态走服务端点，先 \`ppnt start\`。`);
    return 1;
  }
  let failed = 0;
  for (const pick of annotationPicks) {
    const row = pick.row;
    // storage-unify：#n 只在本页桶里解析（桶名恒等于页），不再需要桶名消歧。
    const label = `#${row.n}`;
    try {
      const doc = await requestFn(`${origin}/annotations/${encodeURIComponent(row.__ledger)}?entry=${encodeURIComponent(row.__bucket)}`);
      const baseRevision = doc.json && Number.isFinite(Number(doc.json.revision)) ? Number(doc.json.revision) : null;
      const res = await requestFn(`${origin}/annotations/${encodeURIComponent(row.__ledger)}/${row.n}/status`, {
        method: 'POST',
        body: {
          entry: row.__bucket,
          baseRevision,
          status: parsed.statusWord,
          ...(parsed.flags.note ? { note: parsed.flags.note } : {}),
        },
      });
      if (res.status === 200) {
        out(`${label} → ${parsed.statusWord}${parsed.flags.note ? `（note：${parsed.flags.note}）` : ''}`);
      } else {
        failed += 1;
        const detail = res.json && res.json.detail ? `：${res.json.detail}` : '';
        out(`${label} ✗ ${res.status} ${res.json && res.json.error ? res.json.error : ''}${detail}`);
      }
    } catch (error) {
      failed += 1;
      out(`${label} ✗ ${error.message}`);
    }
  }
  return failed || errors.length ? 1 : 0;
}

/** status --page <页>：各状态计数 + dist 是否过期 + 孤儿账本（只读，不依赖服务）。 */
function printPageStatus(parsed, { env, out, err }) {
  // 找不到页的报错先攒着：整桶孤儿的页（删页后残留）有专门的报告，先打一行
  // 「错误：找不到页 + 可用页清单」全是噪音（K8）；真没桶再原样报错。
  const errors = [];
  const pageRef = parsed.flags.page;
  const context = loadAnnotateContext(pageRef, parsed, { env, err: (m) => errors.push(m) });
  if (!context) {
    // 页不在 registry 与 manifest 里，但桶还在：整桶皆孤儿（storage-unify）——
    // 报告而不是裸报错，不然删页后的残留账本没有入口可见。报告只给两处都不在
    // 的桶：页已知而加载失败的（url 条目等）原样报错，不把活页的账本吞成孤儿。
    if (!pageIdKnown(pageRef, parsed, { env }) && printBucketOrphanStatus(pageRef, { env, out })) return 0;
    for (const line of errors) err(line);
    return 1;
  }
  const counts = countByStatus([...context.frameRows, ...context.docRows]);
  out(`页 ${context.pageId}`);
  out(`  open ${counts.open} · check ${counts.check} · done ${counts.done} · close ${counts.close} · 共 ${counts.total}`);
  if (context.docOnly) {
    out('  这页不是编译页（registry 条目没有 board.json），没有 dist 与源码摘录');
  } else {
    const dist = distStatus(context.target.entryId, context.target.pageDir, { distRoot: path.join(dataRoot(env), 'dist') });
    out(`  dist ${dist.builtAt ? new Date(dist.builtAt).toISOString() : '未编译'}${dist.stale ? ' · 已过期（源码比产物新，跑 ppnt build）' : ' · 最新'}`);
  }
  const orphanCount = (context.orphanRows || []).length;
  if (orphanCount) out(`  孤儿 ${orphanCount} 条 · ${(context.orphanLedgers || []).join('、')}（表面已不存在，ppnt prune ${context.pageId} 清理）`);
  return 0;
}

/** 页消失后的整桶孤儿报告；桶也不在时返回 false（调用方走原报错）。 */
function printBucketOrphanStatus(pageRef, { env, out }) {
  if (!pageRef) return false;
  const names = collectBucketOrphans(String(pageRef), dataRoot(env));
  if (!names.length) return false;
  out(`页 ${pageRef} 不在 registry 与本地页面清单里；桶里 ${names.length} 本账本全是孤儿：`);
  for (const name of names) out(`  ${name}`);
  out(`清理：ppnt prune ${pageRef}（--dry-run 先看清单）`);
  return true;
}

/** 页 id 是否在 registry 或本地 manifest 里（整桶孤儿报告只给两处都不在的桶）。 */
function pageIdKnown(pageRef, parsed, { env }) {
  if (!pageRef || !PAGE_ID_PATTERN.test(String(pageRef))) return false;
  const registry = loadRegistry({ root: REPO_ROOT, path: resolveRegistryPath(parsed.flags, env) });
  if (registry.resolve(pageRef)) return true;
  return manifestPageIds(REPO_ROOT).includes(pageRef);
}

/** 命令分发。bin/pinpoint.mjs 只做进程原语与这一次调用。 */
/* ---- list：页清单与“找不到页”的候选 ---- */

function statusCountsOf(bucketPath) {
  const counts = { open: 0, check: 0, done: 0, close: 0 };
  for (const { doc } of readBucketLedgers(bucketPath)) {
    for (const row of (doc && Array.isArray(doc.annotations) ? doc.annotations : [])) {
      const st = row && row.status;
      if (st && Object.prototype.hasOwnProperty.call(counts, st)) counts[st] += 1;
      else counts.open += 1;
    }
  }
  return counts;
}

function manifestPagesOf(root) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(root, 'content', 'previews', '_index.json'), 'utf8'));
    return Array.isArray(doc && doc.pages) ? doc.pages : [];
  } catch {
    return [];
  }
}

/** 页清单（registry + 本地模板页），list 与“找不到页”的候选共用。 */
export function pageListRows({ registryPath, env = process.env, root = REPO_ROOT } = {}) {
  const entries = existingEntriesFor(registryPath);
  const grouping = fs.existsSync(registryPath) ? listRegistryGrouping(registryPath) : { folders: [], pageFolders: {} };
  const bucketRoot = dataRoot(env);
  return buildPageList({
    entries,
    manifestPages: manifestPagesOf(root),
    folders: grouping.folders,
    pageFolders: grouping.pageFolders,
    hasBoard: (entry) => typeof entry.path === 'string' && fs.existsSync(path.join(path.resolve(entry.path), 'board.json')),
    countsFor: (id) => statusCountsOf(path.join(bucketRoot, id)),
  });
}

/** “找不到页”报错的候选行；清单读不出时退回 null（调用方沿用 id 清单）。 */
function reportPageSuggestions(pageRef, { registryPath, env, err }) {
  let rows;
  try { rows = pageListRows({ registryPath, env }); } catch { return false; }
  const picks = suggestPages(rows, pageRef);
  if (!picks.length) return false;
  err('最接近的页（`pinpoint list <关键词>` 看全部）：');
  for (const row of picks) err(`  ${row.id}  ·  ${row.title || '（无标题）'}`);
  return true;
}

export async function runList(argv, io = {}) {
  const { cwd, env, out } = ioOf(io);
  const words = [];
  const flags = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--registry') { flags.registry = argv[++i]; continue; }
    words.push(argv[i]);
  }
  const registryPath = resolveRegistryPath(flags, env, cwd);
  const query = words.join(' ');
  const rows = matchPages(pageListRows({ registryPath, env }), query);
  if (!rows.length) {
    out(`没有匹配“${query}”的页。不带关键词跑 \`pinpoint list\` 看全部。`);
    return 1;
  }
  for (const row of rows) for (const line of formatPageRow(row)) out(line);
  out(`共 ${rows.length} 页${query ? `（匹配“${query}”）` : ''} · registry：${registryPath}`);
  return 0;
}

export async function run(argv, io = {}) {
  const { out, err } = ioOf(io);
  if (argv.includes('-h') || argv.includes('--help') || argv.length === 0) {
    out(USAGE);
    return 0;
  }
  switch (argv[0]) {
    case 'list': return runList(argv, io);
    case 'add': return runAdd(argv, io);
    case 'move': return runMove(argv, io);
    case 'rename': return runRename(argv, io);
    case 'remove': return runRemove(argv, io);
    case 'folder': return runFolder(argv, io);
    case 'status': return runStatus(argv, io);
    case 'start': return runStart(argv, io);
    case 'stop': return runStop(argv, io);
    case 'restart': return runRestart(argv, io);
    case 'build': return runBuild(argv, io);
    case 'render': return runRender(argv, io);
    case 'check': return runCheck(argv, io);
    case 'locate': return runLocate(argv, io);
    case 'shot': return runShot(argv, io);
    case 'mark': return runMark(argv, io);
    case 'prune': return runPrune(argv, io);
    default:
      err(`错误：未知命令：${argv[0]}`);
      err(USAGE);
      return 1;
  }
}
