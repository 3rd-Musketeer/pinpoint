# 0026 · title 规矩 + section note + 选中模型（note 收编右栏 detail 面板）

Status: 现行 · Date: 2026-08-17 · Scope: `workbench/app/DetailPanel.jsx`、`server/lib/frame-note-store.js`、`workbench/lib/board-contract.js`

Supersedes: ADR 0015（note 导出永随语义）

**Decided**（owner 2026-08-17 报「历史案例里的 title 非常杂乱且不美观」，指明两手——告知 agent title 的目的写法案例 + 给 notes/desc 找承载；讨论中 owner 两条裁决：禁「·」（编号系统已自动派生）、「section note 和 frame note 的样式需要设计……detail 可以放在右侧栏」；导出兼容 owner 明示「不用兼容，导出逻辑要重构，列为 backlog」）：

- **title 规矩成文**（SKILL.md §2.1 + AGENTS.md schema 节 + README）：title = 单行短名词短语，只回答「这是什么」；编号由系统按 board 顺序派生（A/B1），手写必重复；禁「·」拼接多段信息；图例 / 意图 / 结论 / 验证一律进 note。防线三层：文档正反例（反例 = goal-weekly B 区真实案例）→ `validateBoard` 硬拦换行（长度不钉死，存量 50+ 超长 title 不炸板）→ 画布 caption 两行 clamp + hover 全文兜底。library 模板板同步改成规矩范例（`1 · 选豆` → `选豆` 等 16 处）。
- **section note 新字段**：`sections[].note` 过 schema（canvasBoard 的 `Object.assign` 透传天然保留）；API 与 frame note 同构——`GET/PUT /api/section-notes/<pageId>/<sectionId>`，与 frame note 共享同一份 board.json 与 revision（`server/lib/frame-note-store.js` 的 `findSection` / `getSection` / `updateSection`）。动机 = B 区那段图例属于整组四个 frame，放 frame note 要重复四份，section 此前没有任何 note 字段（写了也被 schema 静默丢弃）——title 滥用的机制性原因。
- **画布点选模型**：点 frame 图注（cap/dim 行）= 选 frame，点 section 大标题 = 选 section，点板空白 = 清选中；frame 内部点击永远留给原型交互，标注模式下整个选择让位（`annotateBlocksPan` 同款豁免）；pan 残留 click 由既有 capture 相位 suppressClick 吃掉。选中源 = store 的 `focusFrameKey`（既有，frame 树 / 标注卡已在写）+ 新增 `focusSectionId`，两者互斥；持久高亮（`.wb-sel` = frame accent 环 / section 标题转 accent）由 store 订阅同步（board-nav `syncBoardSelection`），与 1.1s 定位 flash 环分工。
- **右栏 detail 面板**（`workbench/app/DetailPanel.jsx`）：挂在 `#wbann-side` 同一 root、标注工作台之上（上下分区，不引入 tab 新语汇；选中才渲染，标注列表 flex-1 自然让位）。展示引用号 / 标题 / note；note 编辑 = GET 拉 revision → PUT 带 baseRevision（409 保留草稿，客户端 fetch 层 = `lib/note-api.js`）。**Frame Note 从画布撤下**：screen-load 不再渲染 note，画布行内编辑器（frame-notes.js）连文件删除，`.wb-sec-row` 网格四行收三行；导出链路同步摘除 note 处理（export-core / export-image-api）——**导出图从此不含 note**，note 从数据注入导出图随导出系统重构另立（backlog，修订 08-15d「图纸内容永随」的 note 部分；图注 / 尺寸行永随不变）。
- **B 区案例迁移**（规矩的第一个实例）：goal-weekly `v6-bvs` section title「★ SPIKE · B 形态 · 同日型基线 vs 当日 sankey — 直通带 = 照常的部分……」拆成 title「同日型基线 vs 当日 sankey」+ section note（图例全文保留）。goal-weekly 其余 8 个长 title section 与各页超长 title 的清理进 backlog（随存量 wording 修复一起做）。

**Why**: title 杂乱不是 agent 不听话，是没有正当承载——说明需求真实存在（图例有保留价值），但 section 层级没有 note 字段、指引只有一句隐含分工、画布 caption 无截断，三处都纵容把说明写进 title。修法因此不是「叫 agent 写短点」，而是给说明文字一个比 title 更合适的位置（section note + 右栏 detail），同时把 title 的职责写死。note 收编右栏而非继续渲染画布：画布是图纸，说明文字常驻会把图纸变成文档；选中即见足够（Figma 右栏 detail 同构），且 detail 与「该 frame 的标注卡」同栏同屏，反馈回路更短。
