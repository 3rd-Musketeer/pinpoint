# 0029 · Pages 时间显示 + 排序；「最近更新」= 仅内容改动

Status: 现行 · Date: 2026-08-17 · Scope: `src/server/lib/content-mtime.js`、`src/workbench/lib/page-sort.js`

**Decided**（owner 2026-08-17 提出「给 page 加上时间显示 & 排序方法」，方案讨论后确认；「最近更新包含标注更新吗」一问 owner 裁决「内容更新」）：

- **时间来源 = 文件系统 mtime，server 实时算**（`server/lib/content-mtime.js`）：`GET /registry` 给 dir/file 条目附 `mtime`（ms epoch）——file = 文件自身；dir = 递归 walk 取最大（文件与目录都计入，目录 mtime 捕获删除类变化；跳 dot 名与 node_modules，不跟随 symlink，visit 上限 5000）。url 条目与缺失路径无此字段。否决两个候选：registry 加 addedAt 字段（内容编辑不会更新它，字段会撒谎）；客户端 last-visited（跨机不一致，「打开过」≠「有更新」——若真实需求浮出，那是第三个排序档的事）。
- **「最近更新」语义 = 仅内容改动，标注活动不参与**（owner 裁决）。机制理由：迭代主循环「标注 → agent 改 HTML」里内容 mtime 必然跳动，纯标注是唯一漏网活动；且从 bucket slug（filename + 路径 hash，无时间戳）反推 entry 的映射复杂度与收益不成比例。「最近活跃（含标注）」档的做法已存 backlog（`/save` 时维护 entry → lastActivityAt 索引），等真实体感启动。
- **排序 = Pages 段头右侧排序钮，三档循环**：默认（书写顺序，Component Library 系统行恒置顶）→ 最近更新（mtime 倒序，无 mtime 按原相对顺序沉底）→ 名称（标题 localeCompare 'zh'）；选择持久化 `prefs.pageSort`。默认档保持现状，不擅自改变肌肉记忆。纯函数在 `workbench/lib/page-sort.js`（sortPages / formatRelativeTime / nextPageSort）。
- **时间显示 = PageRow 行尾 mono 小字相对时间**（`刚刚` / `Nm` / `Nh` / `Nd` / `MM-DD` / 跨年 `YYYY-MM-DD`；每分钟重算），完整时间进 hover title；无 mtime 的页（url 条目 / 本地示例页）不出该元素；紧凑断点（<230px）与条目 tag 同规则整枚隐藏。本地两个示例页 v1 不补 mtime（示例资产，不参与日常找页）。

**Why**: 列表已长到 22 条且继续增长，「找回正在做的页」是日常痛点；mtime 实时算永远是对的、零 bookkeeping，是唯一不会撒谎的时间源。一档排序只回答一个问题，语义混叠（更新 vs 活跃）从源头避免。
