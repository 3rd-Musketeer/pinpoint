# 0030 · 目录重排：src/ 与 content/ 两轴，服务 URL 是契约

Status: 现行 · Date: 2026-09-04 · Scope: `src/`、`content/`、`src/server/content-routes.js`、`docs/`、`docs/adr/`、`AGENTS.md`

**Decided**（owner 2026-09-04 决定全部重构，context 与 code 分两个 commit）：

- **代码层两轴**：`src/{client,server,workbench,shared,pages}` 是 pinpoint 自己；`content/{kits,previews}` 是它服务的内容。根目录只留 Vite 入口 `index.html`、配置与 context 文件。
- **服务 URL 是契约，磁盘位置不是**：`/annotate.js`、`/kits/…`、`/previews/…`、`/panel.html`、`/starter.html`、`/lib/…` 一个不变，由 `src/server/content-routes.js` 把 URL 投影到磁盘（先解码 + normalize，落在前缀内才投影；文件不存在回真 404，不进 SPA fallback）。
- **context 层按 workspace 的 context-layout 规范**：public 层与 owner-local 层同一套形态。决策进 `docs/adr/`（decisions.md 逐条拆成 0001–0029，正文逐字保留，只加头行）；DESIGN / debugging / ROADMAP 进 `docs/`；CHANGELOG 退役（历史看 git log）；AGENTS 只留读序、验收命令、坑与约定；词汇进 `CONTEXT.md`；owner-local 的 `.gdd/` 变成 `tasks/done/` + `BACKLOG.md` + `TODO.md`，`playground/` 变成 `prototypes/`，全部走 `.git/info/exclude`。

**Why**：仓库当天从 `topics/pinpoint` 迁入 `repos/github.com/3rd-Musketeer/pinpoint`，四种「目录外持有绝对路径的东西」同时失效（长命 vite、npm link、`~/.pinpoint/registry.json`、release worktree 的 gitdir 指针），暴露出根目录五种东西平铺（应用代码、内容、扩展、agent context、构建工具）没有一条轴能说清。URL 保持不变是因为仓外的原型页和扩展写死了 URL，它们不在这个仓里、改不到。

**Rejected**：URL 跟着磁盘走（仓外消费者改不到）；public 层保留 OSS 惯例只改 owner-local 层（owner 选全部重构，理由是两套形态并存边界要靠 exclude 清单记）。
