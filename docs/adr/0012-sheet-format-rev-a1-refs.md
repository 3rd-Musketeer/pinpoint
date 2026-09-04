# 0012 · 图纸版式：铭牌 + REV 协议 + A1 引用法 + 装饰检验；DESIGN.md 正典化

Status: 部分缓期（图注 / 装饰检验 / 文档权威现行） · Date: 2026-08-15 · Scope: `src/workbench/lib/board-refs.js`、`docs/design.md`

Superseded-by: ADR 0013（REV 及其展示面缓期）

**Decided**（owner 在评审板 `previews/sheet-rev` 上逐轮拍板）:
- **sheet 元信息进左栏**：铭牌（格子语言，图名与图号同格 + REV / 张次 / 更新）固定左栏底部，不随列表滚动；更改栏（Revisions）居左栏中部。画布不再承担标题栏 / 更改栏。
- **引用法**：图幅边缘刻度（ABCD / 123）删除，引用体系取而代之——section 用字母、frame 用数字（A1 / A2 / B3）。人对 agent 说 A2；机器引用仍走 `@frame:id`。
- **图注两行**（引用号 + 屏名），尺寸挪 frame 下方居中 mono 小字。
- **REV 协议**：字母制；agent 每轮改动完成后自调 `POST /api/pages/:id/rev {"note":"一行说明"}`，服务端自增字母、落日期写进 board.json；标注记录创建时 REV，页面 REV 前进后旧标注标「可能已过期」；不做画布时间轴穿越（git 即全量历史）；screen / board 变化但无新 REV 时，更改栏显示「未记录的改动」灰行提醒补注记。
- **装饰检验**（设计语言原则第 1 条）：每个视觉元素必须回答「它标记 / 组织 / 反馈什么真实信息」。判例：铭牌铆钉删（CSS 里不固定任何东西）；画布内图框 + 角部十字退役（纸上是裁切 / 对折标记，屏幕无对应物，边界信号与外框重复）。
- **无「·」**：文案判据归 topics/ui-text 规则 8（本 repo 引用不复制）。
- **文档权威**：新增 `DESIGN.md`（当前正典）；本文件保持 journal 角色并加索引（含 successor 列）；`decisions.md` 与 `DESIGN.md` 自 07-21 的 exclude 清单放出——教义随模板走；实例内容（previews/ 个人页、组件、`.gdd/`、CHANGELOG.local.md）排除不变。
- **导出收敛方向**：单入口 picker + 当前页 proto tree 多选，per-section 导出钮删除。未定：批量档位（zip 任意多选 vs 单选 + section 整选）、frame ⋯ 菜单去留——落地前补拍。

**Why**: 复古 / old-school 感来自建造逻辑可见（字体、编号、线宽纪律），不来自贴皮；REV 绑定的收益 = 多轮迭代里「这条反馈针对哪一版」可对齐。文档侧只有日志没有正典，supersession 曾只存在于读者脑子里。
