# pinpoint — Agent Guide

pinpoint 是一个本地视觉反馈服务：kit（`content/kits/ios/`，第一份设计规范）+ workbench 画布
（多方案原型对比）+ 标注层（人 → agent 的反馈回路，也是这个项目的核心）。
常驻服务跑在 `https://pinpoint.localhost`，同一个 origin 服务 workbench、annotate API、
登记进来的仓外目录（`/sites/<id>/`）和 client bundle（`/annotate.js`）。

pp2（2026-09-22 起）页是**源码**：`<screenId>.jsx` 帧 + `components/<Name>.jsx` 页内组件 +
`board.json`；`ppnt build` 把源码编译成 dist（`~/.pinpoint/dist/<entry>/`），画布、标注、
导出、mention 只认 dist。机制细节见 [`docs/board-schema.md`](docs/board-schema.md)。

## 开工读序

1. [`CONTEXT.md`](CONTEXT.md) —— 词汇表。page / board / entry / frame / 桶 / 账本这些词在这里各有一条定义，
   `entry` 有两个意思，读代码前先看清楚。
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
just check                # 契约测试 + 两组 Chromium e2e（第一次先 npx playwright install chromium）
```

`Justfile` 是工作流的唯一事实源，`package.json` 的 scripts 是它的实现原语。
Portless 拥有正常路由与进程生命周期；`npm run dev:direct` 是显式绕过代理的兜底
（`http://127.0.0.1:5199`）；不要给这个 app 配常驻的 Portless alias。

**e2e 两组并行，靠 `E2E_PORT` 分家。** 组端口 = 基准与基准 + 20，代理上游各 +10，默认基准
5299（共占 5299~5329）。一个端口一套固件，registry、标注数据根、`test-results-<port>/` 全从
这一个数推导（`e2e/env.js`）。在别人也在跑 e2e 的机器上换基准跑自己的那一轮：
`E2E_PORT=5399 npm run test:e2e`——共用产物目录时两边会同时写同一个 trace zip，报出来的错
完全不像并发冲突。单跑一条 spec 用 `npm run test:e2e:serial -- e2e/<file>`。基准别选 5870~5900：组端口 +10 / +20 / +30 会撞上 macOS 屏幕共享占的 5900，webServer 起不来，JSON 报告只剩“webServer was not able to start”和 0 条用例。

**高负载降单组，失败用例重跑一次。** 机器 1 分钟 load ≥ 4 时 `test:e2e` 只起一组（慢一倍，但不再随机超时），`E2E_SINGLE_GROUP_LOAD` 改阈值，`E2E_GROUPS=1|2` 强制组数。跑完后每个挂了的组用 `--last-failed` 把失败用例重跑一次，重跑仍挂才算挂。所以输出里看到“rerunning failed tests once”不等于通过，要看最后的 rerun exit code。

**功能分支上只跑单测和相关的 spec，不跑全量。** 全量两组约 2 分钟、机器满载时时序用例会偶挂，
每个分支各跑一遍再回基点对照，时间都花在这里。分支上：`npm test` + 改动涉及的 spec（新写的与
断言被改的）。全量两组只在合入 dev 后跑一次，几个分支攒一起跑；那一轮挂了才单跑定位。

**回归测试先写单测，只有必须靠浏览器才验证得了的行为才写 e2e。** 纯逻辑（筛选、排序、解析、状态机、服务端响应）落在对应源文件的 `*.test.js`；e2e 只守 iframe 标注桥、几何与层级遮挡、手势、跨窗口同步、代理注入这类单测够不着的行为。同一个决定或同一块功能的断言合进一条用例、用 `test.step` 分段，不为每条批注各开一次页面。等待只等可观察信号（`expect.poll`、事件），不写固定 sleep。2026-09-24 按这条口径把 e2e 从 159 条精简到 95 条，审计记录在 `tasks/done/2026-09-24-e2e-audit/`。

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

**`ppnt` = `pinpoint`**，命令一览：`status` / `start` / `stop` / `restart`（服务）、
`add` / `move` / `rename` / `folder`（registry）、`build` / `render`（编译）、
`check` / `locate` / `shot` / `mark` / `status --page`（读标注 / 定位 / 截图 / 写状态，
pp2 切片 4 契约，落地前以 `bin/pinpoint-cli.js` 为准）。改完页源码跑 `ppnt build <页>`
（或 `--watch` 挂着）——dist 落后于源码或某屏没编过时，那个 frame 出错误面板，
重编即修，不要手改 `~/.pinpoint/dist/` 下的任何文件。标注四态 open / check / done / close：
agent 只经 `ppnt mark <ref…> check|done --note` 写状态（`open` 由 owner 在工作台编辑时
自动回，`close` 只有 owner 在工作台做），
字段与转换规则见 [`docs/annotation.md`](docs/annotation.md)。

## worktree 与发布契约

- 一个 git 仓库，两个长期 worktree：日常开发在 `dev`
  （`repos/github.com/3rd-Musketeer/pinpoint/`），公开模板发布在 `main`
  （`repos/.worktrees/github.com/3rd-Musketeer/pinpoint/release/`）。
- 常驻的 `pinpoint.localhost` 服务**只**从 dev worktree 起。release worktree 是冷的校验与发布面。
- 不要在 `main` 上开发、造私有实例内容、或直接提交。`main` 只能 fast-forward 到已发布的 dev tip。
- `just ship-dev` 是唯一的 dev push 工作流：要求 dev 干净且不发散，跑完整 check，推 `origin/dev`，再核对 ref。
- `just publish` 是唯一的 main 发布工作流：在 release worktree 的 `main` 上跑；要求两个 worktree 都干净、
  本地 `dev == origin/dev`，用 `git merge --ff-only`，按 lockfile 安装，跑 template-only 校验，
  推 `origin/main`，核对 `origin/main == origin/dev`。
- 两条 recipe 都会改远端状态。永远不要绕过失败的 guard、不要 force-push、不要为了让发布通过而造 merge commit。

## 技能路由

| 要做什么 | 打开 |
|---|---|
| 加帧 / 加组件 / 改 board / 做屏内交互 | [`skills/pinpoint-build/SKILL.md`](skills/pinpoint-build/SKILL.md) |
| 读标注 → 改稿 → 写回状态 | [`skills/pinpoint-annotate/SKILL.md`](skills/pinpoint-annotate/SKILL.md) |
| board、帧、组件、编译、交互的唯一机制权威 | [`docs/board-schema.md`](docs/board-schema.md) |
| registry 条目形状、注入契约、CLI（add / move / rename / folder）、代理 | [`docs/registry.md`](docs/registry.md) |
| 标注字段、账本与桶、状态机、控制面 | [`docs/annotation.md`](docs/annotation.md) |
| 设计语言（写 / 改 UI 前必读） | [`docs/design.md`](docs/design.md) |
| 一个决定为什么是这样 | [`docs/adr/`](docs/adr/) |
| 怪现象排查（先查案例库再动手） | [`docs/debugging.md`](docs/debugging.md) |
| token / class 词汇表 / knobs | [`README.md`](README.md) |

## 坑与约定

以下六条 agent 猜不到、猜错了会白干。正文（机制全文）都在
[`docs/board-schema.md`](docs/board-schema.md) 与各链接里，这里只留指针。

**overlay 与 `.ios-app` 同级（iOS）** —— `.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 是
`.ios-app` 的**同级元素**，不是子元素；嵌进 `.ios-app` 会弄坏滚动与 sheet 定位。见
board-schema“iOS 帧的硬约束”。

**safe area 走 token** —— 自定义导航栏 / composer 必须用 `--ios-safe-top` / `--ios-safe-bottom`
（变量在 `ios-kit.css`）；不要写死 px，也不要拿占位 div 顶。

**URL 是契约，磁盘位置不是** —— 代码住 `src/`（client / server / workbench / shared），被服务的
内容住 `content/`，但服务的 URL 一个没变：`/kits/…` `/previews/…` `/sites/…` `/annotate.js` 照旧，
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
