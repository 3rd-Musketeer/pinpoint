# 0005 · Product positioning: UIUX 原型交付与对齐工具

Status: 现行 · Date: 2026-08-07 · Scope: 全仓

**Decided**（owner 产品思想，后续设计的准绳）: 这个项目的核心不是 "iOS HTML preview"，而是**帮助 owner deliver 高保真 UIUX 原型——把 UIUX 设计想清楚，并设计出符合 owner 审美的方案**。三个层各自服务这个目标：

- **kit**（ios-kit，未来可能有 web-kit / html-kit）= owner 个人设计规范的积累，是"符合我审美"的沉淀层；
- **workbench / canvas** = 多方案原型的对比查看界面，服务"想清楚设计"；
- **annotation** = 人 → Agent 的视觉反馈回路，服务"迭代修改原型"。

**Why**: 之前 repo 以 "iOS preview 模板" 自我定位，导致跨 topic 内容（symlink）、server 托管页面标注等需求无处安放；按上述定位，annotate 是独立的反馈协议层，kit/workbench 是它的两个 client。

**已定**（2026-08-07 讨论结论）:

- 跨 topic 内容用 **registry**（中央注册表，entry 分 `dir`/`url` 两类，稳定 id）替代 symlink；内容留在 owning topic 原地。
- 注入契约 = **"登记过才注入"**：`dir` 类由 review 服务在 serve 时自动注入 annotate client；`url` 类（如 my-todos）由浏览器扩展注入；`file://`、自起 server、未登记 origin 一律干净。目标项目零感知。
- 导出物（PNG / 完整 HTML）**不得**包含注入的标注脚本；导出管线内部绕开注入，不作为用户可见开关。
- client 只有一份 `annotate.js`；服务端注入与扩展注入只是两种投递方式，通信协议（`POST /save` + 磁盘 SSOT）唯一。

**Open**（讨论中，未定）: ~~SPA 前端路由切换时 page key 的重算~~ ~~annotation key 需含 origin/项目 id~~ —— 两项均已在 pinpoint 服务化 milestone（`.gdd/goal.md`）落地：SPA 账本切换见 WP2（Navigation API + switchLedger + epoch 护栏），key 归属见 WP1（按 registry entry-id 分桶）。该 milestone 执行完毕（2026-08-09，dev 分支 `8172f74..7fe4a5b`）。
