# pinpoint — Agent Guide

pinpoint 是一个本地服务：agent 把设计写成文章（article），文章里嵌着可以实时渲染的界面帧；owner 和其他读者在浏览器里读，
owner 用正文评论和画布标注把反馈交回 agent。常驻服务跑在 `https://pinpoint.localhost`，同一个 origin 服务文章站点、
工作台、标注 API、登记进来的仓外内容（`/sites/<id>/`）和标注客户端（`/annotate.js`）。

模型从上到下：project → 文章 → section（节）→ 节里的画布组件（列帧）和图。一篇文章是 `<project 根>/docs/pinpoint/articles/<id>/`
下的 `index.mdx` 加本篇的帧和组件，帧是 `<帧 id>.jsx` 或一整份 `.html`（HTML 帧）；读者在文章页 `/<project>/<article>/` 读它，集中修改在画布视图
`/?page=<project>_<article>`（所有带画布的节按行排开，由正文自动生成）。`ppnt` 里这篇文章写成 `<project>/<article>`；
`<project>_<article>` 是它的页 id，画布视图的地址和标注桶用它，正文评论和画布上的标注进同一个队列。JSX 帧和图由 `ppnt build` 编进
dist（`~/.pinpoint/dist/<页 id>/`），画布、卡片和截图读 dist；HTML 帧不编译，服务直接给源文件。

存量页（带 `board.json` 的原型页）是和文章并列的入口，照常可看、可改、可标注；新工作写成文章，存量页需要时用 `pinpoint migrate` 转成文章。
写法与查错见 [`skills/pinpoint-build/SKILL.md`](skills/pinpoint-build/SKILL.md)，帧与编译机制见
[`docs/board-schema.md`](docs/board-schema.md)，为什么这样定见 ADR 0042。

## 开工读序

1. [`CONTEXT.md`](CONTEXT.md) —— 词汇表。project / 文章 / section / 帧 / 画布视图 / 页 id / 桶这些词在这里各有一条定义；
   代码和 CLI 里的 `page`、`screen`、`entry` 对应哪个词也写在那里，读代码前先看清楚。
2. 本文的“坑与约定”一节 —— agent 猜不到、猜错了会白干的东西。
3. 下面的技能路由表 —— 按你要碰的面打开对应文档，不要通读全部。

设计语言正典是 [`docs/design.md`](docs/design.md)：写或改任何 UI 之前先读。
为什么长这样、什么时候定的，在 [`docs/adr/`](docs/adr/)（索引 + 格式见
[`docs/adr/README.md`](docs/adr/README.md)）。变更历史看 `git log`，本仓不维护 changelog。

## 起服务与验收

```bash
brew install just         # 每台机器一次
npm install -g portless   # 每台机器一次
npm install               # 第一次
just dev                  # https://pinpoint.localhost/index.html
just check                # 契约测试 + 站点构建检查（test:site）+ 两组 Chromium e2e（第一次先 npx playwright install chromium）
```

`Justfile` 是工作流的唯一事实源，`package.json` 的 scripts 是它的实现原语。
Portless 拥有正常路由与进程生命周期；`npm run dev:direct` 是显式绕过代理的兜底
（`http://127.0.0.1:5199`）；不要给这个 app 配常驻的 Portless alias。

**e2e 两组并行，靠 `E2E_PORT` 分家。** 组端口 = 基准与基准 + 20，文章站点各 +5，默认基准
5299（共占 5299~5329）。一个端口一套固件，registry、标注数据根、`test-results-<port>/` 全从
这一个数推导（`e2e/env.js`）。在别人也在跑 e2e 的机器上换基准跑自己的那一轮：
`E2E_PORT=5399 npm run test:e2e`——共用产物目录时两边会同时写同一个 trace zip，报出来的错
完全不像并发冲突。单独跑一条 spec 用 `npm run test:e2e:serial -- e2e/<file>`。基准别选 5875~5900：组端口 +5 / +20 / +25 会撞上 macOS 屏幕共享占的 5900，webServer 起不来，JSON 报告只剩“webServer was not able to start”和 0 条用例。

**高负载降单组，失败用例重跑一次。** 机器 1 分钟 load ≥ 10 时 `test:e2e` 只起一组（慢一倍，但不再随机超时），`E2E_SINGLE_GROUP_LOAD` 改阈值，`E2E_GROUPS=1|2` 强制组数。跑完后每个挂了的组用 `--last-failed` 把失败用例重跑一次，重跑仍挂才算挂。所以输出里看到“rerunning failed tests once”不等于通过，要看最后的 rerun exit code。重跑会清空该组产物目录，首跑的截图、trace 与报告先复制到 `test-results-<端口>-first-run/`、`playwright-report-<端口>-first-run/`，查重跑过了的偶发失败从这里读。

**分组与删桶。** 两组按 `scripts/e2e-parallel.mjs` 的时长表配平，会拉起文章站点（Astro）的 spec 固定在同一组；每轮首跑的每文件时长写进 `.tmp/e2e-durations.json`，表偏了照它改。用例里删标注桶之前先 `await closeSettled(page)`（`e2e/ledger-settle.js`）：关页时客户端还会发一次保存，删桶和它撞上会把数据写回来，或让服务 rename 报 ENOENT 整个退出。

**功能分支上只跑单测和相关的 spec，不跑全量。** 全量两组约 2 分钟、机器满载时时序用例会偶挂，
每个分支各跑一遍再回基点对照，时间都花在这里。分支上：`npm test` + 改动涉及的 spec（新写的与
断言被改的）。全量两组在合入 main 之后跑一次，几个分支攒一起跑；那一轮挂了才单独跑定位。

**回归测试先写单测，只有必须靠浏览器才验证得了的行为才写 e2e。** 纯逻辑（筛选、排序、解析、状态机、服务端响应）落在对应源文件的 `*.test.js`；e2e 只守 iframe 标注桥、几何与层级遮挡、手势、跨窗口同步、代理注入这类单测够不着的行为。同一个决定或同一块功能的断言合进一条用例、用 `test.step` 分段，不为每条标注各开一次页面。等待只等可观察信号（`expect.poll`、事件），不写固定 sleep。

**站点打不开，第一件事是 `pinpoint status`**——不要先猜、也不要先 `ps`：

```bash
pinpoint status     # 路由 · 进程 · 直连 /health · 代理 /health · 服务 root · registry；全绿才退 0
pinpoint start      # 已经健康就拒绝；否则在 CLI 所在仓库起 `npm run dev`，日志进 ~/.pinpoint/logs/
pinpoint stop       # 只 SIGTERM portless 记的那个 pid，vite 子进程跟着走，不要再手杀
pinpoint restart    # 停 + 起
```

status 一次答两种真实故障：进程没了、进程还在但已失效（比如服务跨过一次仓库目录搬迁——
长命 vite 抱着启动时解析出的绝对路径，目录一搬会静默落回全部默认配置，表面还活着，必须
`pinpoint restart`）。案例见 [`docs/debugging.md`](docs/debugging.md)。

**`ppnt` = `pinpoint`**，命令一览：`status` / `start` / `stop` / `restart`（服务）、`dev --sandbox`（隔离服务）、
`new project` / `new article`（脚手架）、`add` / `move` / `rename` / `remove`（registry）、`migrate`（存量页转成文章）、`build` / `render`（编译）、
`show` / `check` / `open`（一篇文章的节和帧、`--uses` 查组件用在哪 / 验证 / 网址）、`comments` / `locate` / `shot` / `mark` / `reply`（读标注 / 定位 / 截图 / 写状态，`--note` 同时回复 / 只回复）。
每个命令都认 `--json`，退出码 0 成功、1 有问题、2 用法错或找不到目标。每个命令的选项是 `ppnt <命令> --help`，共用约定见 [`docs/registry.md`](docs/registry.md)“CLI”。第一个参数是目标：文章写 `<project>/<article>`，
存量页写它的 id。改完跑 `ppnt check <project>/<article>`，存量页跑 `ppnt build <页 id>`
（或 `--watch` 挂着）——dist 落后于源码或某帧没编过时，那一帧出错误面板，
重编即修，不要手改 `~/.pinpoint/dist/` 下的任何文件。标注四态 open / check / done / close：
agent 只经 `ppnt mark <目标> <引用…> check|done [--note "<回复>"]` 写状态（`open` 由 owner 在工作台编辑时
自动回，`close` 只有 owner 在工作台做），
字段与转换规则见 [`docs/annotation.md`](docs/annotation.md)。

## 分支与推送

- 只有一个长期分支 `main`，唯一 clone 在 `repos/github.com/3rd-Musketeer/pinpoint/`。
  常驻的 `pinpoint.localhost` 服务从这个 clone 起。
- 小改动直接在 `main` 上提交。较大的功能开 worktree：
  `git worktree add ../../../.worktrees/github.com/3rd-Musketeer/pinpoint/<任务名> -b feat/<任务名>`。
  做完在 clone 里 `git merge --ff-only feat/<任务名>`，再 `git worktree remove` 并删掉分支。
  worktree 里没有 owner-local 文件（`tasks/`、`TODO.md` 等），派 worker 时给 clone 里的绝对路径；
  `git worktree remove` 会连 ignored 文件一起删，只在 worktree 里的东西先挪出来。
- 在 feat worktree 里亲手试改动用 `just preview`：用 worktree 的代码起 `<分支名>.pinpoint.localhost`，
  数据是 `~/.pinpoint` 的一份快照，放在 worktree 的 `.tmp/preview-data/`，标注写进快照、不动真实账本。
  快照只在第一次启动时复制；要重新取真实数据就删掉这个目录再起。停预览在它的终端按 Ctrl-C
  （预览和常驻服务的进程命令行一样，不要按命令行 pkill）。`git worktree remove` 时快照随之删除。
  worktree 里要有 `node_modules`（`npm ci`，或软链 clone 的）。
- 删 CSS class 前先 grep 运行时拼接的写法（如 `'wb-sec-' + layout`），静态扫描看不到它们；删后跑 `e2e/viewport.spec.js`。
- `just ship` 是唯一的推送工作流：要求在 `main`、工作区干净、不与 `origin/main` 发散，
  跑完整 check，推 `origin/main`，再核对 ref。它会改远端状态；不要绕过失败的 guard，不要 force-push。
- 推没推看 git：`git log --oneline origin/main..main` 为空就是都推了。

## 技能路由

| 要做什么 | 打开 |
|---|---|
| 写 article、加帧 / 加组件、写 concept、改存量页的 board、做屏内交互 | [`skills/pinpoint-build/SKILL.md`](skills/pinpoint-build/SKILL.md) |
| 读画布标注与正文评论 → 改稿 → 回复、写回状态 | [`skills/pinpoint-annotate/SKILL.md`](skills/pinpoint-annotate/SKILL.md) |
| 帧、组件、编译、交互的唯一机制权威（含存量页的 board） | [`docs/board-schema.md`](docs/board-schema.md) |
| registry 条目形状、注入契约、CLI（add / move / rename / remove） | [`docs/registry.md`](docs/registry.md) |
| project 目录（`docs/pinpoint/`）、`add --project`、`listProjects` / `/api/projects`、画布视图与页 id、`migrate` | [`docs/projects.md`](docs/projects.md) |
| 文章站点：`Section` / `Canvas` 写法、画布卡片与画布浮层、`[[ ]]`、路由、`llms.txt` | [`site/README.md`](site/README.md) |
| 画布标注与正文评论的字段、账本与桶、状态机、控制面 | [`docs/annotation.md`](docs/annotation.md) |
| 设计语言（写 / 改 UI 前必读） | [`docs/design.md`](docs/design.md) |
| 一个决定为什么是这样 | [`docs/adr/`](docs/adr/) |
| 怪现象排查（先查案例库再动手） | [`docs/debugging.md`](docs/debugging.md) |
| token / class 词汇表 / knobs | [`README.md`](README.md) |

`skills/pinpoint-build` 与 `skills/pinpoint-annotate` 是实现的一部分，不是事后补的说明：别的仓的 agent 只读这两个 skill，照着它们写文章、读标注、调 `ppnt`。改实现（CLI 命令与参数、文章与 board 的写法、标注状态机、帧与组件写法）的同一个提交里，逐段检查这两个 skill 要不要同步改；删掉或改名一个机制时，同时删掉 skill 里对它的描述。skill 落后于实现，别的 agent 就会照着过时的写法做。

## 坑与约定

以下六条 agent 猜不到、猜错了会白干。正文（机制全文）都在
[`docs/board-schema.md`](docs/board-schema.md) 与各链接里，这里只留指针。

**overlay 与 `.ios-app` 同级（iOS）** —— `.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 是
`.ios-app` 的**同级元素**，不是子元素；嵌进 `.ios-app` 会弄坏滚动与 sheet 定位。见
board-schema“iOS 帧的硬约束”。

**safe area 走 token** —— 自定义导航栏 / composer 必须用 `--ios-safe-top` / `--ios-safe-bottom`
（变量在 `ios-kit.css`）；不要写死 px，也不要拿占位 div 顶。

**URL 是契约，磁盘位置不是** —— 代码住 `src/`（client / server / workbench / shared），被服务的
内容住 `content/`；对外的 URL（`/kits/…` `/previews/…` `/sites/…` `/annotate.js`）是契约，
映射在 `src/server/content-routes.js`。搬动 `content/` 下的东西先想清楚哪个 URL 会跟着变——仓外的
页面按 URL 引 kit，它们不在这个仓里、改不到。反方向同样成立：`src/shared/` 与 `src/client/lib/`
在 serve 时被内联进 `/annotate.js`，改它们就是改 client——保持纯函数、不碰 DOM。

**Playwright 的可见性断言不查视口** —— `toBeVisible` / `click` 对被画布 padding 推到 3000px 外、
被祖先 `overflow` 裁掉的元素照样全绿。要断言“人看得见、点得到”，用 boundingBox 和 stage 几何比。

**vendored 组件有看不见的内部契约** —— `src/workbench/app/ui/` 里的 shadcn 副本“source-owned,
edit freely”只说对一半：包装层是仓内的，Radix Primitive 的内部 DOM 契约（ScrollArea 视口的
`display:table`、Popper 的定位 wrapper）读代码看不见，只有 computed style 看得见。改这些组件或
周边布局前先读 ADR 0023 与 [`docs/debugging.md`](docs/debugging.md) 的对应案例。

**层级（z-index）走 `--wb-z-*` 阶梯** —— 外壳里带 z-index 的元素一律从阶梯挑档，不写数字；
`.wb` 是隔离的堆叠上下文，`.wb-stage-wrap` 永远不能成为堆叠上下文。阶梯表与两条结构规则在
[`docs/design.md`](docs/design.md)“层级”，`src/workbench/layering.test.js` 守，来龙去脉见 ADR 0034。
