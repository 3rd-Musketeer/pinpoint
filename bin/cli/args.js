import { DEFAULT_ORIGIN, CliError, ioOf } from './core.js';

export const BOARDS = new Set(['ios', 'html']);
// 值选项与布尔开关（布尔开关不吃下一个 token，也不许带 =值）。
const VALUE_FLAGS = new Set(['title', 'board', 'id', 'registry', 'page', 'screen', 'frame', 'status', 'mode', 'group-by', 'scale']);
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
  mark: { positional: null, flags: new Set(['registry', 'status', 'page']) },
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
export const NO_FOLDER = 'none';

export const USAGE = `用法：
  pinpoint list [关键词…]                               列出页：id · 标题 · 类型 · 标注计数 · 源路径；关键词在 id / 标题 / 路径上宽松匹配
  pinpoint list <页> --frames                           列画布帧：编号 · 帧 id · 源文件 · 标题（编号 ↔ id 对照）
  pinpoint add <目录|文件.html|http(s)://URL> [选项]   登记一个新条目
  pinpoint move <id> <新目录|新文件|新URL>             把既有条目重指到新路径（保留 id）
  pinpoint rename <旧 id> <新 id>                      给既有条目改 id（登记表 + 标注桶 + 资源前缀一起改）
  pinpoint remove <id>                                 从登记表删一个条目（源文件 / URL 不动；详见下面 remove 一节）
  pinpoint folder <list|add|rename|rm|move> …          左栏的一层分组（详见下面 folder 一节）
  pinpoint build <页> [--screen <屏>] [--watch]        编译一页（源码 → dist），打印每屏 ok / 错误与耗时
  pinpoint render <页>/<屏> [--full]                   编译一帧打到 stdout（不落 dist）；超 8000 字符截断并落全文文件
  pinpoint check <页> [选项]                           标注清单（只读）：序号 / 正文 / 意图 / 源码摘录 / 状态
  pinpoint locate <引用…> [--page <页>]                标注定位：#n → 源文件:行 · 组件（共用 n 帧）
  pinpoint shot <引用…> [--marks] [--scale 1]          出图：帧 B3 / 段 B / 整页 <页>，--marks 烤 #n 序号钉
  pinpoint mark <引用…> done|check                     写状态（open 由编辑触发、close 只在工作台）；逐条打印结果
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
  帧 id / 段 id（与 B3 / B 同义）· <页>（整页，shot）· @frame:<页>/<屏> · @a:<id> ·
  --status open|check|done|close|all
  B3 / B 是按 board 顺序派生的显示编号，调序就变；帧 id / 段 id 不变。
  写进 README、交接稿这类留存文字时用 id，编号只在当场对话里用。

  pinpoint check <页> [--frame B3|帧 id] [--status open|check|done|close|all]
                  [--mode excerpt|image|both] [--group-by frame|component] [--json]
                                       默认 open、按帧分组；excerpt 给最小完整元素 + 父链
                                       面包屑 + 兄弟折叠（约 300 token）；image 走服务渲染器
                                       1x 截图到 <dataRoot>/check/<页>/<屏>.png（服务要在跑）
  pinpoint locate <引用…>              每条一行：#n → 源文件:行 · 组件（共用 n 帧）；
                                       存量 HTML 页给 dist 路径 + selector
  pinpoint shot <引用…> [--scale 1] [--marks]
                                       PNG 到 <dataRoot>/shot/<页>/<帧 id|段 id|页>.png，打印“编号 · id → 路径”；
                                       --marks 烤 #n 序号钉（清单由 check 给）
  pinpoint mark <引用…> done|check
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
  list <页> --frames 改列这一页的画布帧，每段一个小标题，每帧一行：编号 · 帧 id ·
  源文件（相对页目录）· 标题。编号（B3）按 board 顺序派生、调序就变；帧 id 不变，
  也是源文件名。owner 说“D1”时用它对上文件，写进留存文字时用 id。

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
    if (!positional.length) throw new CliError(`${command} 至少要一个引用（#n / entry#n / B3 / B / 帧 id / 段 id / 页 / @frame:p/s / @a:id）`);
    return { command, refs: positional, flags };
  }
  if (command === 'mark') {
    if (positional.length < 2) throw new CliError('mark 需要引用与状态：ppnt mark <ref…> done|check');
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

export function guardParse(argv, io) {
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
