# 0018 · CLI 注册入口：pinpoint add + 合成板 + registry 热重载

Status: 现行（已落地） · Date: 2026-08-16 · 补充: 0035（命令名 `ppnt` 与 build / render / check / locate / shot / mark 扩面） · Scope: `bin/pinpoint.mjs`、`src/server/lib/registry-store.js`、`src/server/lib/synth-board.js`

**Decided**（阶段 3/5 落地）:

- **CLI 心智**（owner 原话收敛）：想让一个页面进 pinpoint 就用 CLI；静态的 pinpoint 直接 host（/sites/ 管道），活的登记 URL 待阶段 4 代理映射。N 个项目小服务器 → 一台总线 + 一张登记表。
- `bin/pinpoint.mjs`：`add <path|url> [--title] [--board ios|html] [--id] [--registry]`；id = basename slug 化 + 冲突避让；dir/file 的 board 默认 html；file 拒 `--board ios`（合成板恒 doc 壳）。
- registry 读写收 `server/lib/registry-store.js`（原子写、严格校验、缺失时以默认 pinpoint 条目播种）；`POST /registry/reload` 热重载——启动期缓存的三处消费点（annotate-api / sites-api / export-doc-api）收编为共享活 store，reload 后全部即时生效；workbench 经 HMR `registry:update` 失效重拉 Pages。
- **合成板**：`/sites/<id>/board.json` 磁盘优先，缺失时合成 doc 板——file 条目单屏；无板 dir 顶层 *.html 码位序各一屏（侧栏版本列表）；dir 无顶层 html / 目录缺失 / 显式 `board:'ios'` 无板 → 404（不合成，与 registry 白名单惯例一致，打开呈现明确加载失败而非空页）。合成板导出、标注分桶（src percent-encode 三处逐字节一致）闭环。
- url 条目仍不进 Pages（阶段 4 代理内嵌时才进）。

**Why**: 「出现在 Pages」的语义 = 出现且能打开可读可标；否则不如不出现（改动前缺板条目打开是 404 错误面板）。
