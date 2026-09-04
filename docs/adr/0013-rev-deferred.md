# 0013 · REV 机制缓期进 backlog

Status: 现行 · Date: 2026-08-15 · Scope: `BACKLOG.md`、`docs/design.md`

Superseded-by: ADR 0014（左栏内容修订）

**Decided**（owner 复评同日 08-15 条目后拍板）: REV 版本机制整体缓期——bump 端点、左栏更改栏、铭牌、标注绑 REV、过期提示、「未记录改动」检测，全部进 `.gdd/backlog.md`（当时的路径，现在是 owner-local 的 `BACKLOG.md`）（含启动信号与分期预案）。
**Why**: owner 原话「我目前没有想到特别刚需的场景，之前没有这个一样迭代，它不是最关键的痛点」。设计时高估了异步多轮验收的频率；chat 在当前节奏下就是 changelog。
**Consequences**: 侧栏重构第一批的左栏只做 Pages + 设置视图；`DESIGN.md` 版本管理节只留缓期指针；设计储备（更改栏 / 铭牌 / REV chip / 三向联动）留在体验板 `previews/sidebar-variants/` 不删。画布图注（A1 引用法、尺寸下置）、导出 picker、装饰检验、文档正典化不受影响，按原计划推进。
