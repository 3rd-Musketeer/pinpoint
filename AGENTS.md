# pinpoint — Agent Guide

pinpoint 是一个本地视觉反馈服务：kit（`content/kits/ios/`，第一份设计规范）+ workbench 画布
（多方案原型对比）+ 标注层（人 → agent 的反馈回路，也是这个项目的核心）。
常驻服务跑在 `https://pinpoint.localhost`，同一个 origin 服务 workbench、annotate API、
登记进来的仓外目录（`/sites/<id>/`）和 client bundle（`/annotate.js`）。

## 开工读序

1. [`CONTEXT.md`](CONTEXT.md) —— 词汇表。page / board / entry / frame / 桶 / 账本这些词在这里各有一条定义，
   `entry` 有两个意思，读代码前先看清楚。
2. 本文的「坑与约定」一节 —— agent 猜不到、猜错了会白干的东西。
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
just check                # 契约测试 + Chromium e2e（第一次先 npx playwright install chromium）
```

`Justfile` 是工作流的唯一事实源，`package.json` 的 scripts 是它的实现原语。
Portless 拥有正常路由与进程生命周期。`npm run dev:direct` 是显式绕过代理的兜底
（`http://127.0.0.1:5199`）；不要给这个 app 配常驻的 Portless alias。
kit 的 CSS/JS 不依赖框架；**workbench** 需要 Vite + Lucide（`npm install`）。

`just check` 跑 e2e 时带 `PREVIEW_TEMPLATE_ONLY=1`，所以实例本地的页面和组件不会影响断言。

**两轮 e2e 可以同时跑，靠 `E2E_PORT` 分家**（`E2E_PORT=5399 npx playwright test`）。
一个端口一套固件：webServer 端口、代理上游端口（`E2E_PORT + 10`）、标注数据根与 registry
（`$TMPDIR/pinpoint-playwright-<port>/`）、以及仓内的 `test-results-<port>/` 与
`playwright-report-<port>/` 全从这一个数推导（`e2e/env.js`，单测 `e2e/env.test.js`）。
默认端口 5299 那一轮的路径和以前一样，不带后缀。别用 `mkdtempSync`：`e2e/env.js` 会被
playwright 的 runner、worker、globalSetup 各加载一次，随机名字几份对不上；端口是这几个进程
唯一共享的输入。产物目录也必须分家——共用 `test-results/` 时两边同时写同一个 trace zip，
报出来的是「file data stream has unexpected number of bytes」，读起来完全不像并发冲突。
所以在别人也在跑 e2e 的机器上，跑一个自己的端口，不要占默认端口。

**站点打不开，第一件事是 `pinpoint status`**——不要先猜、也不要先 `ps`：

```bash
pinpoint status     # 路由 · 进程 · 直连 /health · 代理 /health · 服务 root · registry；全绿才退 0
pinpoint start      # 已经健康就拒绝；否则在 CLI 所在仓库起 `npm run dev`，日志进 ~/.pinpoint/logs/
pinpoint stop       # SIGTERM portless 记的那个 pid，有界等待并复核
pinpoint restart    # 停 + 起
```

status 一次答两种真实故障：**进程没了**（路由还在、页面 404，2026-08-17）和**进程还在但已失效**
（vite 抱着搬迁前的绝对路径跑裸默认配置、代理 502，2026-09-04）。所以它两条健康检查都打——
直连 `http://127.0.0.1:<portless 端口>/health` 与穿代理的 `https://pinpoint.localhost/health`——
并把服务自报的 `root` 和当前 CLI 所在仓库比对：不一致说明服务跑的是另一个目录（另一个 worktree、
或搬迁前的旧路径）。这些命令只管 pinpoint 自己的 app 注册与进程树；portless 的 proxy daemon
（443，多 app 共享）不归它管。

健康检查也可以自己打：`curl -s https://pinpoint.localhost/health`。payload 里有 `root`（服务跑的
仓库根）、`dataDir`（默认 `pinpoint` 桶的路径，留给 `jq -r .dataDir` 的消费者）、`dataRoot`
（标注数据根）和一个 `registry` 段（`ok` / `path` / `entries` **数量** / `errors` / `warnings`）
——要真的条目列表用 `GET /registry`。

**服务跨过一次仓库目录搬迁就必须重启**（`pinpoint restart`）：长命 vite 抱着启动时解析出的绝对路径，
目录一搬它会静默落回全部默认配置，表面还活着。案例见 [`docs/debugging.md`](docs/debugging.md)。

改完之后自己走一遍：加一屏 → 板热重载；读标注按 `pageId → section → screenId` 分组、
改被路由到的那个源文件；标注正文里的 `[@t:iN]` 对着同一条标注的 `targets[].ref` 解析，
解析不到就把它留在那里显式说明，不要猜另一个 target；改完在对话里说清楚改了什么，
review 和清理标注留给用户，不要替用户清空标注。

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
| 加页 / section / 屏 / 组件 / 交互 frame | [`skills/pinpoint-build/SKILL.md`](skills/pinpoint-build/SKILL.md)（组件何时抽：§4.0；safe area：§1.2） |
| 标注 → 读标注 → 修改 | [`skills/pinpoint-annotate/SKILL.md`](skills/pinpoint-annotate/SKILL.md) |
| 登记 / 重指 / 验证一个 registry dir 或 url 条目 | [`skills/pinpoint-annotate/SKILL.md`](skills/pinpoint-annotate/SKILL.md) §2 |
| `board.json` 的字段、条目派生、交互 frame、编辑面 | [`docs/board-schema.md`](docs/board-schema.md) |
| registry 条目形状与分组层、CLI（add / move / rename / folder）、三条注入路径、代理 | [`docs/registry.md`](docs/registry.md) |
| 标注字段、账本与桶、控制面、workbench 偏好、图片导出 | [`docs/annotation.md`](docs/annotation.md) |
| 设计语言（写 / 改 UI 前必读） | [`docs/design.md`](docs/design.md) |
| 一个决定为什么是这样 | [`docs/adr/`](docs/adr/) |
| 怪现象排查（先查案例库再动手） | [`docs/debugging.md`](docs/debugging.md) |
| token / class 词汇表 / knobs / 导出用法 | [`README.md`](README.md) |

## 坑与约定

**overlay 规矩（iOS）** —— `.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 是 `.ios-app` 的
**同级元素**，不是子元素。嵌进 `.ios-app` 会弄坏滚动与 sheet 定位。见
[build skill](skills/pinpoint-build/SKILL.md) §1.1。

**safe area** —— 自定义导航栏 / composer 必须用 `--ios-safe-top` / `--ios-safe-bottom`
（变量在 `ios-kit.css`）；不要写死 px，也不要拿占位 div 顶。见
[build skill](skills/pinpoint-build/SKILL.md) §1.2。

**glass chrome** —— 用 `.ios-glass` / `.ios-glass-pill`（token 在 `ios-kit.css`）。
`.ios-glass--liquid` 只加在稀疏的 chrome 上做 Chromium 折射效果，不要铺满整页。

**URL 是契约，磁盘位置不是** —— 2026-09-04 起代码住 `src/`（client / server / workbench /
shared / pages），被服务的内容住 `content/`（kits / previews），但服务的 URL 一个没变：
`/kits/…` `/previews/…` `/panel.html` `/starter.html` `/lib/ann-list.css` 照旧。映射在
`src/server/content-routes.js`（改写 `req.url` 的磁盘投影，注册在插件链末尾，所以按原 URL
匹配的中间件看到的仍是原 URL）。搬动 `content/` 或 `src/pages/` 下的东西，先想清楚哪个 URL
会跟着变——仓外的页面按 URL 引 kit，它们不在这个仓里、改不到。

**`pinpoint stop` 只 SIGTERM portless run 的 pid** —— portless 会带走 vite 子进程（2026-09-04
实测无孤儿），不要再手杀 vite。站点打不开先 `pinpoint status`。

**Playwright 的 `toBeVisible` / `click` 不查视口** —— 元素被画布 padding 推到 3000px 外也全绿
（2026-09-04 错误面板，与 08-17 ScrollArea 同形）。要断言「人看得见」，用 boundingBox 和 stage
几何比，不靠可见性断言。

**改 `src/shared/` 或 `src/client/lib/` 就是改 `/annotate.js`** —— 那些模块在 serve 时被内联进 client，
是纯函数、有 node 测试，保持它们不碰 DOM。

**vendored 组件有看不见的内部契约** —— `src/workbench/app/ui/` 里的 shadcn 副本
「source-owned, edit freely」只说对了一半：包装层是我们的，Radix Primitive 的内部 DOM 契约还是上游的，
读代码看不见，只有 computed style 看得见。改这些组件或它们周边的布局前先看这两条
（新增条目带日期与来路）：

- **ScrollArea（`ui/scroll-area.jsx`）**：Viewport 给 children 包一层内联
  `display:table;min-width:100%`，内容按自然宽排版、不随容器收缩。2026-08-17 实况：
  左栏 Page 行自然宽 274 > 栏宽 250，行尾复制钮被 `overflow-x:hidden` 裁出栏外、
  对人不可见不可点，而 e2e「点击 + 读剪贴板」全绿（Playwright 点击不检查祖先裁剪）。
  修复 = `index.html` 里的
  `#wbside [data-slot="scroll-area-viewport"] > div { display:block !important; }`；
  防回归 = e2e 的 `withinContainerViolations` 几何断言。
  **由此定的规矩：布局与自适应断言一律比 bounding box，不靠点击。**
- **DropdownMenu（`app/frame-menu.jsx`）**：Radix Popper 会包一层定位 wrapper，
  组件只管行为，皮肤和几何在 `index.html` 的 CSS 里中和。置惰规则 2026-08-17 起收敛为
  `[data-radix-popper-content-wrapper]:has(> .wb-frame-menu)`——全局写法会把同样走 Popper 的
  右键菜单（`app/row-menu.jsx`）和 Tooltip 一并压成 static，菜单渲染在视口之外：
  DOM 断言全绿但肉眼不可见。新增 Popper 系组件时先确认这条规则的作用域。

本节只记组件的**静态契约**；完整故障案例（现象 → 误判 → 根因 → 识别特征）归
[`docs/debugging.md`](docs/debugging.md)。

**模板与实例的边界** —— 进 git 的只有模板：框架代码、Example Library、system 组件，
`content/previews/` 里只放这些。owner 在这台机器上的东西靠 `.git/info/exclude` 挡在 git 之外，
清单是：`prototypes/`（设计探索页，经 registry 登记进 Pages）、`tasks/`、`BACKLOG.md`、`TODO.md`、
`.archive/`，以及一批 owner-local 的 kit 组件目录（`content/kits/ios/components/` 下 areta-* / time-* /
energy-* / home-body / wr-progress 那些——Component Library 与存量页面靠 include 依赖它们）。
exclude 不进共享的 `.gitignore`，模板使用者看不到这些目录名。往 tracked 文件里夹带实例内容
（页面、组件、机器本地的 registry 内容）是这个仓最容易犯也最难回收的错。
不在 `content/kits/ios/components/_index.json` 里的组件目录会被自动发现并追加；
`PREVIEW_TEMPLATE_ONLY=1` 把仓内的覆盖全藏起来（e2e 与发布校验跑这个模式）。

**组件归属**（ADR 0028）—— 组件 = 跨页共享资产，kit 是它的天然住所：通用 / 可复用的进
`content/kits/ios/components/`（tracked 或 owner-local exclude），单页专用的片段内联进页面 HTML、不进 kit。
page-local 组件解析不实现，启动信号是组件 fork（两个页面要同名组件的不同版本）或多机 / 协作需求。
存量证据：16 个 exclude 组件里 15 个只在单个 topic 用，但 `time-dashboard` 跨 topic 共享——
page-local 归属模型被这一个真实反例证伪。
