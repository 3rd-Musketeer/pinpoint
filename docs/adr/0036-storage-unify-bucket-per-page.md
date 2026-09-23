# 0036 · 存储统一：桶 = 页，取代 pinpoint 共享画布账本；孤儿与 prune

Status: 现行 · Date: 2026-09-23 · Supersedes: 0003（桶按条目分的半边——桶按页分后条目只是页的来源之一）、0020（mention 帧写死 pinpoint 桶的半边） · Scope: `src/server/lib/annotation-store.js`、`src/server/annotate-api.js`、`src/server/lib/orphans.js`、`src/server/lib/page-times.js`、`src/server/lib/ann-query.js`、`src/client/annotate.js`、`src/workbench/stage.js`、`bin/pinpoint-cli.js`、`scripts/migrate-ledgers.mjs`、`docs/annotation.md`

**Decided**（2026-09-23 owner 决定「对标注存储做统一」；勘查地图在 `tasks/done/2026-09-22-pp2/reviews/storage-map.md`）：

- **桶 = 页。** `~/.pinpoint/<pageId>/`：pageId = 这条内容在 Pages 列表里属于哪一行
  （registry 条目 id；挂靠条目 `entry.page` 用宿主页 id；manifest 模板页用自己的 id）。
  `pinpoint` 桶只留给不属于任何页的东西（今天没有，保留兜底）。行上的 `pageId`
  不再承担归属 —— 归属由桶表达，`rename` 改桶名即完成迁移。
- **账本 = 桶内的一个表面。** 画布是一本固定名 `@canvas.json`（不再跟工作台
  pathname 走，`/` 与 `/index.html` 从此同一本）；文档、直开页、url 条目仍是一个
  pathname 一本，命名规则不变。mention 帧写所属页的 `@canvas` —— 画布与文档里
  同一帧的标注仍是同一本账、双向实时同步，但账本不再跟顶层工作台 pathname 走
  （`/api/frame` 的 ledger 参数退役）。
- **`#n` 按页。** `_seq.json` 与 `bucketFloor` 本来就按桶；桶 = 页之后 CLI 的 `#n`
  只在这一页的桶里解析，不再合并画布 / 文档两套序列先命中。
- **工作台画布切页 = 换桶。** 客户端 `ENTRY` 与账本不在加载时定死；切活动页 =
  换桶（`ENTRY = 新页 id`、账本 `@canvas`）并重新 hydrate，localStorage 账本 key
  跟着换。跨页跳转（`goToMark` 用 `m.pageId`）先切页、等新账本落定再定位。
  画布实例不装 SPA 路由监听（工作台 pathname 恒定，url-sync 的 replaceState
  会把账本切回旧形态）。
- **注入的 entry 一律是页桶。** `/sites/<id>/` 给 `entry.page || entry.id`；
  `/previews/<p>/` 给 `p`（previews 注入与 `/sites/` 完全同形，tag-only 助手退役）；
  url 条目给自己（恒自成页）。服务端 `storeFor` 的 pageId 兜底统一用桶 id。
- **页时间。** `annotatedAt` = 该页桶内各账本最近一次保存（`updated_at`）；
  `page_updated_at` 逐页映射停写（读侧兼容存量），manifest 页的时间从自己的
  桶读（原来只能来自 pinpoint 桶的映射）。
- **孤儿与 prune。** 一本账本对应的表面已不存在（文档文件删了、条目移走了、
  页不在 registry 与 manifest 里了 = 整桶皆孤儿）叫孤儿。`ppnt status --page`
  与 `check` 把孤儿单独列出、不计入 open 等计数；`GET /registry` 的页信息给
  每页孤儿数（页信息面板显示）；清理只经 `ppnt prune <页> [--dry-run]`，
  直接删除、不备份（owner 定过：孤儿不备份）。判定保守：path 缺失的存量账本
  与落在未知 URL 空间的错放账本不判孤儿，prune 宁漏报不误删。
- **存量迁移。** `scripts/migrate-ledgers.mjs` 扩归桶阶段（同一支、dry-run 默认、
  `--apply` 前整根备份）：pinpoint 桶按行 pageId 拆进各页 `@canvas`（无 pageId
  的行按账本 pathname 找页，找不到报孤儿不自动删）；挂靠条目旧桶整桶并进宿主
  页；合并按 id 去重（冲突报出来保留目标行）、桶内重号重新取号（打旧号 → 新号
  对照表）、被行引用的图片跟着搬；每桶重算 `_seq.json`（与现有 next 取大，
  号永不复用不倒退）。幂等：第二遍 0 变更。

**Why**（storage-map 实测的四个后果，桶 = 页逐一消掉）：

- 一次清空跨四页：画布清空走 `markOnActivePage` 过滤，但所有页的行共居 pinpoint
  桶的几本账，页未定 / 锚点近亲命中时误伤别页。一页一桶后别的页的行根本不在
  本账本里。
- 页的标注分两处（画布行在 pinpoint 桶、文档行在条目桶），`#n` 两套 `_seq`
  各自编号、CLI 按先命中取：桶 = 页后一页一套序列，读写一个地址。
- 工作台 `/` 与 `/index.html` 两个拼法各开一本画布账，账本跟 pathname 走是
  历史包袱；固定名 `@canvas` 让「画布」成为一个稳定的表面。
- 文件删掉 / 页移走后账本成孤儿，界面看不到、CLI 照数 —— 孤儿显式化并给
  一条清理命令，比静默积累好。

**代价与边界**：

- 客户端多一次「切页 → 换桶 → 重新 hydrate」的往返；boot 时画布实例等第一个
  页定下来才有账本（workbench 一直不出现的兜底页落 pinpoint 桶）。
- 存量 previews / mention 帧账本（旧落缺省 pinpoint 桶）必须跑迁移，迁移前的
  旧账本在新读侧看不见 —— 迁移是本决定落地的一部分，不是可选步骤。
- `pinpoint` 桶保留为「不属于任何页」的兜底（SPA fallback 页、未落页的画布），
  不是页，Pages 不列。
