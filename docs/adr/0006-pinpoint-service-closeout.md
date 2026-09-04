# 0006 · pinpoint 服务化 milestone 收尾（closeout）

Status: 现行 · Date: 2026-08-10 · Scope: `server/`、`client/`、`extension/`

**Shipped**: WP0-WP9 共 12 个 commit（`8172f74..8f7dddf`）已 push 至 `origin/dev`（GitHub: 3rd-Musketeer/pinpoint）。公开模板 main **未**发布（owner 选择 A：只 ship-dev；`just publish` 留待明示）。
**Verified**: `npm test` 156/156、e2e 43/43（含 SPA 账本、扩展注入、/sites/、侧边栏全部用例）；真机回路（my-todos 注入/分桶/跳转）以自动化浏览器走完；owner 完成过一次真实 pickup 标注。
**形态**: registry（`~/.pinpoint/registry.json`）+ dir 服务端注入（/sites/）+ url 扩展注入 + SPA 账本 + 标注侧边栏（共享行渲染 `lib/ann-row.js` + `lib/ann-list.css`）；命名全部 pinpoint 化（`window.pinpoint`，`iOSAnnotate` 保留 deprecated alias）。
**残留归属**:
- `repos/` 下 morii-service、morii-ios 两处旧路径引用 → 归各 repo 自己的工作流。
- 未承诺候选（registry 热加载、Frame Note 写回、扩展非 localhost 支持、实例内容搬迁、web/html kit 等）→ `.gdd/backlog.md`（当时的路径，现在是 owner-local 的 `BACKLOG.md`）。
- e2e 环境教训：playwright 浏览器二进制会被机器上其它项目的新版 install 清走；e2e 全挂先查 `ls ~/Library/Caches/ms-playwright/`，修复 = `npx playwright install chromium`。
**重建指针**: 服务 `just dev`（https://pinpoint.localhost）；样式回归探针 `.tmp/keep/wp8-style-probe.mjs`（`--diff` 复跑）；扩展安装见 `extension/README.md`。
