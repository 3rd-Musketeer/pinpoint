# 0028 · areta-chat-eval 条目重指 + 组件归属边界成文

Status: 现行 · Date: 2026-08-17 · Scope: `content/kits/ios/components/`、`~/.pinpoint/registry.json`

**Decided**（owner 2026-08-17 要求分析两个 backlog 遗留项后采纳推荐）：

- **areta-chat-eval 重指路径** → `repos/dev/areta-eval/legacy/eval-platform-preview`。依据：该目录 README 自述 status = reference 且「pinpoint 只负责挂载、标注和导出」——它本就是为被 pinpoint 挂载保留的设计参考；标注桶 `~/.pinpoint/areta-chat-eval/`（含 v2.html 账本）按 entry id + 页内路径寻址，id 不动即无损。启动期 warning 消除，「Eval 平台」页恢复（5 个文档条目在线）。
- **组件归属 = 维持 kit 集中，边界成文**（AGENTS.md 组件行下）：组件 = 跨页共享资产，通用/可复用进 `kits/ios/components/`（tracked 或 owner-local exclude），单页专用片段内联进页面；page-local 组件解析不实现。依据 = 存量使用矩阵：16 个 exclude 组件中 15 个单 topic 使用，但 `time-dashboard` 跨 topic（jita + smart-todo）——page-local 归属模型被一个真实反例证伪。**启动信号**（届时重估 page-local 覆盖解析）：组件 fork（两页面要同名组件不同版本）或多机/协作场景。

**Why**: 两个遗留项的共同判据都是「等真实信号，不提前建机制」——条目重指是存量资产的正确接线而非新建；组件归属在证伪 page-local 模型后，集中管理就是当前最优，机制缺口（fork 冲突）出现前不投资。
