# registry 与注入契约

**登记过才注入。** annotate client 只落在登记过的目标上，其余一切打开的是逐字节相同、
零标注面的页面。登记表装两类东西：project（文章的家，目录与读取见 [`docs/projects.md`](projects.md)）和存量页的来源
（目录、单个 HTML 文件）。本文是这条契约的完整形状：登记表长什么样、怎么写、client 有哪几条投递路径。
词的定义见 [`CONTEXT.md`](../CONTEXT.md)；建文章、建 project 和登记的步骤见
[`skills/pinpoint-build/SKILL.md`](../skills/pinpoint-build/SKILL.md) 第 1 节。

## 登记表

`src/server/lib/registry.js` 读 `~/.pinpoint/registry.json`（`PINPOINT_REGISTRY` 覆盖路径）。
形状 `{"version":1,"entries":[...]}`。存量页的条目
`{id, title?, kind: "dir"|"file", path, board?}`，每一条自成“页面”组的一行。
`kind: "project"` 的条目只有 `{id, title?, kind, path}`，`path` 是 project 根目录；
它与其他条目共用 id 命名空间，但没有自己的页 id 和桶，`loadRegistry` 把它放进 `projects` 而不是 `entries`。
目录、登记与读取见 [`docs/projects.md`](projects.md)。

- `id` 必须匹配 `^[a-z0-9][a-z0-9-]*$` 且唯一；`title` 缺省等于 id。
- `board`（`ios`/`html`）只给 dir 条目的默认壳播种（缺省与遗留值 `web` 都归一成 `html`）；
  file 条目永远在阅读器里打开，不带板。
- 文件缺失时用默认的只含 pinpoint 一条的登记表（`{id:"pinpoint", kind:"dir", path:<仓库根>}`）。
  JSON 坏了或顶层形状不对就回落到默认并记下 error；单条非法只跳过那一条；
  dir / file 路径不存在是 warning，不是删除。
- 已删功能留在老登记表里的键（顶层 `folders` / `pageFolders` / `pageOrder`，条目上的 `folder` / `order` /
  `page` / `role` / `url`）不再有特判：条目上的退役字段随归一静默丢掉、不 warn；`kind: "url"` 的老条目
  按不合法 kind 报错并跳过（进 errors，`/health` 变红），`remove <id>` 照常把它删掉。
  `ppnt mv`（换路径、改 id）对还带着这些字段的条目响亮拒绝（未知字段）——先清掉字段再搬。
- 全部状态可见：`GET /health`（registry 摘要，那里的 `entries` 是**数量**）与
  `GET /registry`（完整 `entries` 列表）。
- `GET /registry` 返回 `pageTimes`，条目也带 `addedAt`（登记时刻）、`mtime`（内容修改，目录递归取最大）、`annotatedAt`（逐页标注变动）。新增登记写入 `addedAt`，移动保留；历史添加时间未知时不补造。
- `annotatedAt` 取这个页的桶里各账本 `updated_at` 的最近一次：新增、修改和删除标注都会更新；无变化或冲突拒绝的保存不更新。

## 写入走 CLI

登记表的写入（登记、重指、改 id、删除）只有 CLI 一个入口。

`bin/pinpoint.mjs`（`npm link` 一次把 `pinpoint` 放上 PATH）：

```bash
pinpoint add    <dir|file.html> [--title X] [--board ios|html] [--id xxx]
pinpoint add    <project 根> --project
pinpoint mv     <id> <dir|file.html>      # 换落点（目标以 /、.、~ 开头）
pinpoint mv     <旧 id> <新 id>           # 改 id
pinpoint remove <id>
pinpoint list   [关键词…]
```

`list` 只读：每页一行 id · 标题 · 类型 · 标注计数，次行源路径；project 下面每篇文章一行 `<project>/<article>`。带关键词时在 id、标题、路径上宽松匹配（英文复数自动去 s），也匹配文章的 id 和标题，给 agent 把 owner 的口头说法对上地址。

`add` 原子追加到登记文件（`--registry` 覆盖路径，给脚本和测试用）。本条目自己的 id 用 `--id`，
缺省由目录名或文件名派生。

`ppnt mv` 按目标的写法做三件事中的一件（`bin/cli/mv.js`，ADR 0045）：目标以 `/`、`.`、`~` 开头是磁盘路径，换落点；
源是文章（`<project>/<article>`）时搬文章，见 [`docs/projects.md`](projects.md)“`ppnt mv` 搬文章”；其余是改 id。
三种都认 `--dry-run`：只列计划，什么都不写。

换落点（`mv <id> <路径>`）原地改一个既有条目的落点（dir / file 两种目标，校验方式与 `add` 一致：路径必须存在、
单文件必须是 .html），**id 与 title 原样保留**——标注桶按页 id 寻址（`~/.pinpoint/<id>/`），
所以换路径不动既有标注。kind 跟着新目标走，`board` 只在 dir 上留着
（改成 file 时丢掉，file 的壳是定死的）。未知 id、目标不存在都整单失败，registry 一个字节不动。

改 id（`mv <旧 id> <新 id>`）换的是 id 本身。id 同时是三个地方的地址——登记表里的条目 id、标注桶
`~/.pinpoint/<id>/`、以及页面资源的 URL 前缀 `/sites/<id>/`——手改其中一个另外两个就错位，
所以改 id 一次改齐，并且**四件事都能做才动手**（预检不过时 registry 一个字节不动）：

1. **登记表**：条目换 id，位置、kind、落点、title 全部保留。新 id 已存在就整单失败。
2. **标注桶**：`~/.pinpoint/<旧 id>/` 改名成 `~/.pinpoint/<新 id>/`。旧桶不存在就跳过；
   新桶已存在是硬冲突（两个桶不会自动合并），响亮拒绝。
3. **资源前缀**（只有 dir 条目有）：条目目录下所有 `*.html` / `*.css` / `*.js` 里的
   `/sites/<旧 id>/` 换成 `/sites/<新 id>/`，跳过 `node_modules` 与逃出条目目录的 symlink，
   打印改了几个文件、分别是哪些。file 条目没有目录可扫，这一步跳过。
   相对路径不用改——`src/workbench/lib/sidecar-css.js` 装配 fragment 时按 `pageBaseUrl` 重写。
4. **重载**：与 `add`、换落点同一条即时生效路径。

**把两个条目并成一个 = 改 id + 换落点**：先把要保留的那个条目 `mv` 成目标 id，
再把另一个条目 `mv` 到同一个落点（或用 `pinpoint remove` 把它从登记表里删掉）。
改 id 自己不做合并——目标 id 已被占用时它一律拒绝，不会去动别人的标注桶。

project 条目没有自己的桶，改 id 与 `remove` 对它按每篇文章的桶 `<id>_<文章>/` 做，见
[`docs/projects.md`](projects.md)“改 id 与文章桶”。

`remove <id>` 把条目从登记表里删掉，**只删登记，不删文件**——源文件留在原地，
重新 `add` 同一个目标即恢复登记。预检失败时 registry 一个字节不动：id 不存在、桶里还有标注行，
或无法完整读取并确认桶的内容。`mv` 与 `remove` 共用严格检查：坏 JSON、异常 `annotations` / `_seq.json`、
未知文件、无法归属已有账本的图片或 symlink 都保留并报错。桶不存在，或只有合法空账本、`{ next }` 序号
和可确认归属的遗留图片时放行，并顺手删掉空桶。标注行先在工作台处理，或用 `pinpoint prune <id>` 清掉孤儿账本。

**撞 id 是错误，不是自动改名。** 裸 `pinpoint add` 派生出的 id 或显式 `--id` 撞上既有条目时，
CLI 打印“id 已存在，指向 `<path>`；更新路径用 `ppnt mv <id> <新路径>`，要新条目请显式
`--id <其他 id>`”并退非零。自动改名会开一个空桶、让既有标注变成孤儿，所以一律报错。

写侧在 `src/server/lib/registry-store.js`（`addRegistryEntry` / `updateRegistryEntry` /
`renameRegistryEntry` / `removeRegistryEntry`
共用同一条原子写）：严格校验（id 唯一、kind 合法、dir/file 路径存在、
未知字段拒写）、tmp+rename、2 空格 JSON。
这个 store 同时是服务端的活视图：annotate / sites / export 三处插件共享同一个实例
（在 `vite.config.js` 里接线），`POST /registry/reload` 原地换快照——CLI 在 add 成功后、
服务 `/health` 有响应时会自己调它，所以新条目不重启就能 serve、注入、分桶；
已打开的 workbench 经 HMR 的 `registry:update` 事件学到（那个事件同时重挂当前板）。静态快照会答 `409 registry_not_reloadable`。

`add`、`mv`（换落点、改 id）、`remove` 写盘后都走同一条即时生效：探活 `/health`，可达就 `POST /registry/reload` 并打印
重载结果（重载了几条 / 服务在用的是另一个 registry 文件 / 服务没在跑，下次启动生效）。

服务本身的起停在 `pinpoint status｜start｜stop｜restart`，见 [`AGENTS.md`](../AGENTS.md) 的
“起服务与验收”。

## 两条投递路径

这一节讲存量页和 workbench 的投递；文章页的注入走 `src/server/article-proxy.js`，只跑正文评论，见 [`docs/projects.md`](projects.md)“标注桶”。

client 只有一份：`src/client/annotate.js`，构建（`src/server/lib/annotate-bundle.js`，esbuild 打包
共享库 + minify + 预压缩）成自包含 IIFE 后按内容哈希 serve 在 `/annotate.<hash>.js`
（`Cache-Control: immutable`，pinpoint 生成的注入点都引用它）；老地址 `/annotate.js` 发同一份
产物（ETag + no-cache），留给内容页里的手写标签。
每条投递路径都和服务同源，所以 annotate API 不带 CORS 头，`OPTIONS` 交给下一个中间件。

### 1 · workbench 自己的页面

工作台有两种投递方式，URL 与交互相同（独立打开和文章画布浮层都走 `/workbench/`）：

- 源码开发：缺省走 Vite 现场转译。`PINPOINT_WORKBENCH_MODE=dev npm run dev` 可显式切回，
  sandbox 和 e2e 的开发组也用这一形态。
- 打包：`npm run build:workbench` 只编工作台壳与其引用模块，生成 `.tmp/workbench-dist/`，不入 git。
  `PINPOINT_WORKBENCH_MODE=bundle npm run dev` 使用它；缺产物时启动直接失败，不回落开发模块。
  `PINPOINT_WORKBENCH_DIST` 可改产物目录（e2e 每端口一份）。发布 worktree 的产物有 `enabled` 标记，
  后续普通 `pinpoint start/restart` 也沿用打包模式；显式 `PINPOINT_WORKBENCH_MODE` 优先。

壳页 `Cache-Control: no-store`；JS/CSS 文件名带内容 hash，走 `/workbench/assets/` 与永久缓存，
缺失资源答 404，不回落工作台 HTML。构建先写新资源再原子替换 HTML，保留旧 hash 供已打开的文档使用。
服务启动时固定该版 HTML，避免下一次构建污染运行中的版本。`ios-kit.css/js` 仍经原内容路由提供，
`ios-kit.js` 的标注客户端 hash 注入不变。打包工作台仅额外加载 Vite 的事件客户端
`/@vite/client`，继续接收 `preview:update`、`projects:update`、`registry:update`；
预览帧仍由原编译器与 `preview-hmr` 更新，不因工作台打包失去 HMR。

`just promote [rev]` 在临时源码快照里按目标 lockfile 准备依赖、构建工作台，成功且存在产物后才移动
停旧服务、移动 release、安装产物并启用打包模式，再起新服务并运行 status 确认健康。构建或安装失败时旧 checkout 和服务不动。
切换失败时先停当前进程，恢复磁盘提交、依赖与旧壳，重新启动旧服务并运行 status 确认健康，仍向调用方报告此次发布失败。
恢复也失败时保留临时目录中的旧壳、旧依赖、recovery.json 与可执行的 recovery.sh，打印完整恢复命令。
SIGINT / SIGTERM 也走收尾：停旧前中断只清理临时构建；从停旧开始中断则恢复旧服务并验健康。
恢复期间忽略后续终止信号，避免再次 Ctrl-C 留下半次恢复；恢复失败同样保留材料并打印命令。
同一个 release（解析软链后的规范路径）以 `.tmp/promote.lock` 跨进程互斥，从读取旧状态到构建、切换、健康检查、回滚与日志均持锁。
已有锁时立即报出持有者 PID、主机、开始时间与目标版本，不排队。正常退出及信号收尾后释放锁；
SIGKILL / 断电留下的锁不自动抢占，先核对持有进程是否退出、当前服务和恢复材料，再手动移除锁重试。
新服务健康后的发布日志写入失败只报警，不触发回滚。
`just promote <旧 SHA>` 仍可回滚，目标早于打包机制时自动使用开发投递。
`just staging` 在复制快照、起 sandbox 之前先构建，构建失败直接退出；成功后用打包模式起隔离服务。

`npm run test:e2e` 第一组（含负载降为单组时）默认测打包，第二组测开发模块；
文件分组或模式覆盖没有跑到的 `@dev-modules`（分离模块图回归）与 `@bundle-entry`（hash 入口回归），
会按各自模式串行补跑，用独立报告目录保留证据，不以 skip 漏掉其中一套。
定向验证可用 `PINPOINT_WORKBENCH_MODE=bundle E2E_PORT=<端口> npm run test:e2e:serial -- <spec>`。

`ios-kit.js` 只在 loopback / `.localhost` 主机上自注入 annotate 客户端（serve 时字面量被换成
当前哈希地址；退出方式：`<html data-annotate="off">`）。
独立文档抄同一段尾部脚本，并在不是被嵌入时调 `pinpoint.setFloatingToolbar(true)`。

还有一层（ADR 0027）：`src/server/preview-inject.js` 给任何含 `<!doctype` 的 `content/previews/**.html`
响应自动注入 client（`?annotate=off` 豁免，片段没有 doctype 天然放行）。previews 的注入
**不带 entry 标记**，账本 ENTRY 保持缺省 `'pinpoint'`。

### 2 · dir 与 file 条目 → `/sites/`

`src/server/sites-api.js` 把登记目录只读地服务在 `/sites/<entry-id>/<path…>`（只接 GET/HEAD，
其余 405）。浏览器标了 `Sec-Fetch-Site: cross-site` 的请求（别的站点的网页用 iframe、脚本或 fetch 取）一律 403，
文章的 `/sites/<页 id>/` 也一样；same-origin、same-site、`none`（地址栏）和没有这个头的请求（命令行工具）照常出。登记表就是白名单：未知 id 404；`..` 按文本拒绝，symlink 逃逸按 realpath 包含判定；
目录回落到 `index.html`。HTML 的 GET 响应在 `</body>` 前注入
`<script>window.__pinpointEntry='<页桶 id>'</script><script src="/annotate.<hash>.js"></script>`
——值是条目的标注桶 id，也就是条目自己的 id（一个页 id 一个桶）。
（没有 `</body>` 就追加在末尾）；`?annotate=off` 给出磁盘上的原始字节——
workbench 的内联片段加载器与导出渲染走的就是它。

**file 条目**共用同一条注入 / annotate=off 管线，但只对那一个登记文件：
`/sites/<entry-id>/` 和 `/sites/<entry-id>/<basename>` 都服务它，其它任何拼法
（穿越、同目录的兄弟文件）一律 404。file 条目也出现在“页面”组里，永远是 doc 壳。

没有自带 `board.json` 的条目照样可读：`/sites/<id>/board.json` 服务一份合成的 doc 板
（`src/server/lib/synth-board.js`）——file 条目一屏，dir 条目按顶层 `*.html` 排序各一屏。
磁盘上的 `board.json` 永远优先。`ios` 板的 dir、以及没有任何顶层 HTML 的 dir 不合成（404）。
合成板里屏的 `src` 做 percent-encode，好让 iframe URL、`location.pathname`、
导出管线算标注 page key 的那个 hash 三者逐字节一致。

## 导出的纯净性

导出的文件里没有标注 client。离线可交互 HTML（`src/server/lib/offline-page-builder.js` 拼帧，`offline-page-export.js` 出外壳）直接读源文件和 dist，
不经服务的注入；拼出的页面和图片导出的渲染页（`src/server/export-image-api.js`）都在 `<html>` 上写
`data-annotate="off"`，`ios-kit.js` 见到它就不自注入 client。

## CLI

`ppnt` 和 `pinpoint` 是同一个入口（`bin/pinpoint.mjs`），命令一览是 `ppnt --help`，每个命令的选项和例子是 `ppnt <命令> --help`。这一节写所有命令共用的约定：怎么写目标、找不到目标时怎么办、`--json` 和退出码，以及 `new`、`check`、`comments`、`show`、`shot`、`open`、`mark` 各给什么。

### 目标和引用

命令的第一个位置参数是目标。目标有这几种写法：

- 一篇文章：`<project>/<article>`（如 `browser-use/payment-confirm`）。文章网址（`https://pinpoint.localhost/<project>/<article>/`、带 `#锚点` 的也行）、画布视图网址（`/workbench/?page=<页 id>`，旧的 `/?page=` 也认）、页 id `<project>_<article>` 和工作台“复制 @page”给的 `@page:<页 id>` 都认，输出一律打斜杠形。
- 一个 project：`<project>`。`show`、`check`、`comments` 接受它，`locate`、`mark`、`reply`、`build`、`shot` 不接受（标注和帧都在文章里）。
- 存量页：它的 id，或 `@page:<页 id>`。

目标后面跟引用。节写 `§2`（文章页上的节号）、字母 `B` 或节 id；第 n 节就是第 n 个字母，纯文字的节也占一个，所以 `§2` 和 `B` 同义。帧写 `B1` 或帧 id。一条标注写 `#3`，或带上文章写 `<project>/<article>#3`。工作台“复制 @frame”给的 `@frame:<页 id>/<帧 id>` 也指一帧，`@section:<页 id>/<节 id>` 指一节（纯文字的节也算）。带文章的标注引用、`@frame:` 和 `@section:` 自己就是目标，这时可以不写第一个参数；写了目标而 `@frame:` 或 `@section:` 的页不是它，报错并说出它指的是哪一篇，不去目标上找同名的帧或节。`shot` 里写在目标后面的 `@page:<页 id>` 是整页引用，同写页 id。

解析在 `bin/cli/address.js`：`parseAddress` 只看字面，`resolveAddress` 再对照 registry 和磁盘判断它是文章、project、存量页，还是不在的文章。像引用的写法（`#3`、`B1`、`§2`、`@a:…`）不会被当成目标。

### 找不到目标、写错参数

- 没写目标，或目标指不到任何东西：命令报错，列出最多 15 个候选地址（文章打斜杠形，存量页打 id），退 2。不会取 registry 的第一页代替。
- `<project>/<article>` 的 project 登记了、这篇不在：报“project X 里没有 articles/Y/index.mdx”，只列这个 project 的文章。
- 写了命令不认的选项、选项缺值、参数个数不对：打一行错误、一行用法，再指向 `ppnt <命令> --help`，退 2。`list` 的关键词里出现 `--x` 也算写错，不当关键词。

### `--json` 和退出码

每个命令都认 `--json`，这时 stdout 只有一个 JSON 对象，提示和错误照常写 stderr。`show`、`check`、`comments`、`list`、`locate`、`shot`、`mark`、`reply`、`build`、`status`、`new`、`open` 各有自己的结构（见各自的 `--help`）；其余命令（`add`、`mv`、`migrate` 等）给统一的外壳 `{ ok, exit, command, error?, output, stderr }`，`output` 和 `stderr` 是原本要打的行。`dev --json` 在服务就绪时打一行 JSON。`--help` 不受 `--json` 影响。

退出码在所有命令上一致（`bin/cli/dispatch.js`）：

| 码 | 什么时候 |
| --- | --- |
| 0 | 成功。`locate` 指到的帧或节上没有标注也是 0，并打一行说明 |
| 1 | 有问题：验证错误（`check`）、截到半篇文章（`shot`）、引用没命中（没有 `#99`、没有这一帧）、服务没在跑、标注写入冲突、要写的文件已经在或这篇的桶里已有旧标注（`new article`） |
| 2 | 用法错（不认的选项、缺参数、状态词写错）或找不到目标 |

找不到目标退 2 而不是 1：它和写错参数一样，是命令行本身要改，脚本据此区分“命令写错了”和“命令跑了、结果有问题”。

### `ppnt new project <目录>` / `ppnt new article [<project>/]<article>`

脚手架（`bin/cli/new.js`），两个都不覆盖已有文件。

- `new project <目录> [--id <id>] [--title <标题>]`：写 `<目录>/docs/pinpoint/project.json`（`{ id, title }`），建空的 `articles/`、`wiki/`，再登记（同 `ppnt add <目录> --project`）并让服务重读。id 缺省取目录名。`project.json` 已经在就沿用它、只补登记，所以重跑是幂等的；id 是保留名或已登记在别的目录时退 2，什么都不写。
- `new article <project>/<article> [--title <标题>]`：写 `articles/<article>/index.mdx`，frontmatter 是 title，正文是一节 `<Section id="overview">`，节里一行注释说明帧怎么加。`index.mdx` 已经在就退 1；这篇的页 id `<project>_<article>` 的桶里已有标注行（删掉或改了名的文章留下的孤儿）也退 1、什么都不写，因为建成后旧行会挂到新文章上，提示换文章 id 或先 `ppnt prune <project>_<article>`，和 `migrate` 同一条检查；project 没登记退 2，提示先 `new project`。
- `new article <article>`（不带 `/`）：建在默认 project 里，见下一节。

两个命令最后都打网址和下一步命令。

### 默认 project `notes`

`ppnt new article <article>` 不写 project 时，文章进 id 为 `notes` 的 project（ADR 0045），用来随手丢一篇，不用先想放哪个 project。

- `notes` 已经登记：直接用登记表里的根目录，不看下面的变量。
- 没登记：先在默认根目录建好 project（`project.json` 写 `{ "id": "notes", "title": "Notes" }`，建空的 `articles/`、`wiki/`），登记，再建文章；输出第一行说明建在哪。默认根目录下已有 `project.json` 而 id 不是 `notes` 时退 2，什么都不登记。
- 默认根目录是环境变量 `PINPOINT_DEFAULT_PROJECT`：`~` 开头按家目录展开，相对路径按当前目录；没设时是 `~/notes`。要换位置，第一次建之前设好这个变量，或直接 `ppnt new project <目录> --id notes --title Notes` 把它建在想要的地方。已经登记过的 `notes` 要搬家，先把目录挪过去，再 `ppnt mv notes <新根>`。
- owner 机器上 `notes` 登记在 `~/workspace/mori-ws/notes/`，没设这个变量。
- `--json` 多一个 `defaultProject: { id, root, created, files }`，只在这一次新建了 `notes` 时出现。

### `ppnt check <project>[/<article>]`：验证

汇报前跑一次，看全这篇（或整个 project）的问题。不写 dist，不需要服务在跑（`src/server/lib/article-check.js` 的 `checkProject`）。

- 布局错误：`listProjects` 读出的 `errors`，code 定义在 `src/shared/project-errors.js`，各种写法见 [`docs/projects.md`](projects.md)“读取”和“画布视图”。
- 帧：正文里每个 `<Canvas>` 列的帧都编一遍，包括因布局错误不进画布视图的节。code 是 `lint_hooks`、`lint_event_attr`、`lint_fetch`、`lint_top_level`（lint 四禁）、`compile`（esbuild）、`frame_export`、`frame_render`。几帧共用的组件出错只报一次。
- 图：正文里每个源文件在的 `<Figure>` 也编一遍，规则和 code 同帧，另有 `figure_export`、`figure_render`；诊断带 `figure`（图 id）。图的写法错误已在布局错误里；运行错误要在浏览器里跑过图才有，`check` 不跑，看 `ppnt show <project>`。
- 正文渲染（`src/server/lib/mdx-check.js`）：用站点同一套 MDX 编译和 remark 步骤把正文编成函数再渲染一次。`mdx_component_missing` 是没定义的组件（`<Foo />`），`mdx_render` 是渲染时抛的错（没定义的变量 `{x}`），`mdx_compile` 是编不过；行号指 `index.mdx`。正文里有 `import` 时跳过渲染，报一条 `mdx_import` 警告。站点给 MDX 的组件只有 `Section`、`Canvas`、`Figure`、`Ref`，与 `site/src/pages/[project]/[article]/index.astro` 对齐，单测守着这一点。
- 空 ref：提示级，code `empty_ref`。

每条诊断一行 `文件:行  级别  code  说明（节 · 帧）`，最后一行是计数。有错误退 1，只有警告和提示退 0。`--json` 输出 `{ target, ok, counts, articles, frames, figures, diagnostics: [{ severity, code, file, line, message, article?, section?, frame?, figure? }] }`，`file` 是绝对路径。

站点那一头，正文渲染出错时文章页的状态码不可靠：Astro 开发服务器边渲染边发，多数时候 200 已经发出，响应停在正文开头（`<div class="article-body">` 之后什么都没有）；少数时候是 500。所以查正文错误用 `check`，不用状态码。

`check` 只做验证；读标注用 `comments`。目标是存量页时退 2，提示存量页用 `ppnt build <页 id>` 编译、用 `ppnt comments <页 id>` 读标注。

### `ppnt comments <目标>`：标注队列

画布标注、文档页标注和正文评论，字段和分组见 [`docs/annotation.md`](annotation.md)。目标是一篇文章、一个存量页，或整个 project（逐篇列出有条目的文章，`--frame` 不能和 project 同用）。抬头是各状态的计数，所以单独看计数不用别的命令。每条标注下面列出线程里的 agent 回复。选项：`--status`、`--frame`、`--mode excerpt|image|both`、`--group-by frame|component`、`--json`。

`comments`、`comments --mode image`、`locate` 要读 dist（编译产物，源码摘录和组件归属都在里面；HTML 帧的摘录直接读源文件）。dist 不在或落后于源码时，命令先编一次（`bin/cli/dist.js` 的 `ensureDist`，同 `ppnt build`），stderr 打一行“dist 不在或落后于源码，先编了 …”，再照常输出；不用先手动 `build`。

### `ppnt show <project>[/<article>]`

只读盘，只有正文里的图过期时先重编它（写 dist）。一篇文章：每节一行 §n、字母、节 id、标题、帧数（或“纯文字”）、open 数，下面是帧（编号、帧 id、源文件）和网址（文章页锚点、画布视图），最后是这篇的布局错误。一个 project：文章（斜杠地址、节数、帧数、open 数、网址）、wiki 词条、空 ref（带出处的文件和行）、布局错误，有布局错误退 1。两种的布局错误里都有图的编译错误和浏览器里记下的运行错误（`figure_compile`、`figure_runtime`）。存量页的 id 给编号、帧 id、源文件的对照。`--json` 给同一份数据。

`--uses <组件>`（`bin/cli/uses.js`）：目标是 project 或一篇文章，列出用到这个组件的帧和图，最后给出每篇要跑的 `ppnt shot` 命令。判定看编译产物 HTML 里的 `data-pp-comp="<组件>"`，加上帧和图的依赖文件名；dist 过期时先编。哪里都没用到时退 1。改完共享组件后照这份清单截图。

### `ppnt shot <目标> [引用…]`

- 只写文章：文章页整页（1440 宽，按页面高度截全），存 `<数据目录>/shot/<页 id>/article.png`。
- `§2`：文章页上第 2 节的 `<section>`，存 `article-<节 id>.png`。纯文字的节写字母或节 id 也截文章页。
- `B1`、`B`、帧 id、节 id：画布视图上的帧或节。HTML 帧按自己的地址截 402 宽整页，存 `<帧 id>.png`。存量页不写引用就是整个画布。
- `--canvas`：按整篇文章的截图策略输出。HTML 帧在画布中是可滚动的活卡片；截图时，每个 HTML 帧按自己的地址各截一张 402 宽整页，保留完整页面内容。这篇有 JSX 帧时，另截一张画布视图图；全是 HTML 帧时，只输出各帧整页图。stdout 先打一行“说明：”讲截了什么、为什么没有画布图，`--json` 放在 `notes` 里。
- `--figure <图 id>`：正文里的一个图，浅色、深色各一张（`figure-<图 id>.png`、`figure-<图 id>-dark.png`），不和引用同用；图编不过或在浏览器里运行出错时打出原因、退 1（[`docs/projects.md`](projects.md)“图”）。

文章页里正文的末尾有一个 `<div data-pp-article-end hidden>`（`site/src/pages/[project]/[article]/index.astro`）。截到的页面里没有它，说明正文中途断了（正文渲染出错，见上面 `check` 一节）：图照样存下，stderr 打一行“注意”指向 `ppnt check <project>/<article>`，退 1；`--json` 的这一张带 `truncated: true`。

截文章页前命令轮询文章网址：503（站点启动中，或刚写好的文章还在同步）就等，刚登记时的 404 最多等 10 秒，502（站点起不来）直接报错并带上原因，200 才截；等的上限是 `--timeout` 秒，缺省 60。打开后等图片、画布卡片里的 iframe 和字体加载完再截。每张图打印一行 `引用 → 路径 · 宽×高`。

就绪规则（`bin/ppnt-shot.js` 的 `settleLazyContent`，文章页、文章页上的一节、HTML 帧共用）：顶层文档和每一层嵌套 iframe 里 `loading="lazy"` 的图片和 iframe 都改成立即加载，逐层等它们加载完（同源的轮询 iframe 自己的文档，跨源的等 Playwright 的帧 load），最多嵌 4 层；HTML 帧整页截图前还把页面从上到下滚一遍，让按 IntersectionObserver 懒加载的页面开始取图。整个过程上限 15 秒，到时还没加载完的照常截，stderr 打一行“注意”列出它们，退 1；`--json` 的这一张带 `pending`。

### `ppnt open <目标> [§2 | 节 id | wiki 词条名]`

打一篇文章、一节、一个 project 或一个 wiki 词条页的网址（`bin/cli/open.js`），不带 `--print` 时再用系统浏览器打开第一个。文章给文章页和画布视图（纯文字的文章没有画布视图）；`§2` 或节 id 给文章页锚点和 `/workbench/?page=<页 id>&section=<节 id>`；project 给 project 首页、`llms.txt`、每篇文章和每个 wiki 词条页。网址前缀是 `PINPOINT_ORIGIN`，所以在隔离服务下打出的就是隔离服务的地址。存量页退 2，并打出它在工作台里的网址。

### `ppnt mark … --note` 和 `ppnt reply`

每条标注都有线程：画布标注、文档页标注（HTML 帧和存量页的文档条目）、正文评论都一样（[`docs/annotation.md`](annotation.md)“线程”）。`ppnt mark <目标> <引用…> done|check --note "<回复>"` 对命中的每一条先走回复端点、再走状态端点；回复失败时那一条的状态不写。`ppnt reply <目标> '#n' "<回复>"` 只回一条、不改状态，引用命中多条时报错。

## 隔离运行（测试 / 不碰 owner 的服务）

`dev --sandbox` 把默认 project 根设成 `<数据目录>/notes`，通过 `env.sh` 导出
`PINPOINT_DEFAULT_PROJECT`；source 后执行 `ppnt new article <id>`，源码和登记都属于这个 sandbox。

owner 的常驻服务是 `https://pinpoint.localhost`，数据根和登记表是 `~/.pinpoint/`。agent 要试写一篇文章、跑一轮冒烟，又不想动这两样时，另起一个服务，所有路径和地址都用环境变量指到别处。

一条命令起（`bin/cli/sandbox.js`）：

```shell
ppnt dev --sandbox [<数据目录>] [--port <端口>] [--site-port <端口>]
```

- 数据目录缺省新建一个临时目录；登记表是 `<数据目录>/registry.json`，日志在 `<数据目录>/logs/service.log`。写入前递归检查已有路径：指向 `~/.pinpoint` 的目录或 symlink、`nlink > 1` 的 hardlink 文件都退 2，保留原字节且不启动服务。
- 端口缺省从 6400 起找一对空的（服务端口和它 +5 的站点端口）；写了 `--port` 就只验它。owner 的 4134、4530、5199 一律不接受。
- 起法是下面的 `npm run dev:app`，不经 portless。就绪（`/health` 答 200）后打印地址，并把 CLI 要的四个隔离变量写进 `<数据目录>/env.sh`；在别的 shell 里 `source` 它，之后的 `ppnt` 都对着这个服务。
- 命令前台常驻。Ctrl-C，或 `kill` 它打印的 pid，会给服务的进程组发 SIGTERM，服务和文章站点一起停。

它做的事等于下面的手动步骤。

不要用 `pinpoint start` 或 `just dev` 起第二个服务。它们走 `npm run dev`，也就是 `portless run --name pinpoint`，注册的是和 owner 同一条 `pinpoint.localhost` 路由，会和常驻服务撞上；常驻服务健康时，`pinpoint start` 还会报错退出、什么也不起。直接起 vite（`npm run dev:app`），不经 portless。

| 变量 | 管什么 | 缺省 |
| --- | --- | --- |
| `PINPOINT_DATA_DIR` | 数据根：标注桶、dist、截图、日志（服务和 CLI 都认） | `~/.pinpoint` |
| `PINPOINT_REGISTRY` | 登记表文件（服务、站点、CLI 都认；CLI 的 `--registry` 优先） | `~/.pinpoint/registry.json` |
| `PINPOINT_DEFAULT_PROJECT` | 默认 project `notes` 第一次建的时候放在哪（`ppnt new article <article>`，见上面“默认 project `notes`”）；登记过之后不再用 | `~/notes` |
| `PINPOINT_ORIGIN` | CLI 找服务的地址：`add` 后的热重载、`comments --mode image`、`shot`、`mark`、`reply`；设了它，`pinpoint status` 只探这个地址，不看 portless 路由 | `https://pinpoint.localhost` |
| `PORT` | 服务（vite）监听的端口，端口被占就启动失败（`strictPort`） | 5199 |
| `PINPOINT_SITE_PORT` | 服务按需拉起的 Astro 文章站点端口。这个端口上已经有服务在答时，pinpoint 直接拿来用，所以要挑一个空端口，不要和 owner 的 4530 共用 | 4530 |
| `PINPOINT_SITE_CACHE` | Astro 的缓存目录，可选。站点的内容库按 `PINPOINT_SITE_PORT` 分在 `site/.astro-cache/<端口>/`，不用为隔离再设它 | `site/.astro-cache/<端口>` |
| `PINPOINT_VITE_CACHE` | 服务（vite）的依赖预构建缓存目录，可选。缺省在本 checkout 的 `.tmp/vite`，同一个 checkout 起第二个服务时设成自己的目录（`ppnt dev --sandbox` 自动设），不要让两个实例共用一份 | `<仓库>/.tmp/vite` |

在 pinpoint 仓库里（要有 `node_modules`）起服务。下面的命令里，`<数据目录>` 是一个空的临时目录，端口换成空闲的：

```shell
PINPOINT_DATA_DIR=<数据目录> PINPOINT_REGISTRY=<数据目录>/registry.json PORT=5750 PINPOINT_SITE_PORT=5755 npm run dev:app
```

另开一个终端，CLI 带上同一组变量，再加 `PINPOINT_ORIGIN`：

```shell
PINPOINT_DATA_DIR=<数据目录> PINPOINT_REGISTRY=<数据目录>/registry.json PINPOINT_ORIGIN=http://127.0.0.1:5750 pinpoint add <project 根> --project
```

之后的 `ppnt list`、`ppnt check`、`ppnt shot`、`ppnt comments` 都带同样的前缀。文章在 `http://127.0.0.1:5750/<project>/<article>/`，画布在 `http://127.0.0.1:5750/workbench/?page=<project>_<article>`，全部文章的首页在 `http://127.0.0.1:5750/`。

在 pinpoint 自己的 feat worktree 里，`pinpoint` / `ppnt` 换成 `node bin/pinpoint.mjs`：全局装的 `pinpoint` 指向 canonical clone，跑的是那里的 CLI 代码。

文章站点按需拉起：服务起来后第一次请求文章，站点进程才 spawn，就绪前文章页返回 503 和“站点启动中”页（浏览器里会自己刷新），通常几秒。页面里的脚本、样式这类 GET 子资源不拿 503：站点在起或在重启时，它们等站点就绪再转发，最多等 15 秒。代理复用到上游刚关掉的空闲连接（ECONNRESET）时换新连接重发，不把它当成站点没了。服务重启（包括 vite 因为 `src/server/` 下的文件改动自动重启）会连站点一起重启，又是这样几秒。脚本里读文章页要轮询到 200。`pinpoint add --project` 登记新 project 不重启站点，新文章一秒内可读（2026-10-13 隔离运行实测）。刚写好的文章在读到之前先是 404，接着可能有零点几秒是 503“内容同步中”（站点的内容库已经有它、渲染模块还没登记，见 `site/src/lib/render-article.js`），再到 200。

停服务在它的终端按 Ctrl-C，站点进程组跟着停。不要按命令行 `pkill`：这个服务和 owner 的常驻服务命令行一样。e2e 的固件就是这样隔离的（`playwright.config.js` 的 webServer `env`）。在 feat worktree 里想用 owner 真实数据的一份副本亲手试，用 `just preview`，见 AGENTS.md“分支与推送”。
