# 0039 · 变体组：同一个关键帧的几种画法

Status: 现行 · Date: 2026-10-10 · Scope: `src/workbench/lib/board-variants.js`、`src/workbench/lib/board-refs.js`、`src/workbench/lib/preview-contracts.js`、`src/server/lib/ann-refs.js`、`src/server/lib/ann-query.js`、`src/server/lib/board-file.js`、`src/server/lib/page-compiler.js`、`bin/cli/list.js`、`bin/cli/pages.js`

**起因**：browser-e2e-flow 里 agent 为同一个关键帧画三种做法，三帧各占一个位置号（B11 / B12 / B13），
它便在 title 里写了自己的“K11”来表达“同一件事”。系统编号表达不了这层关系，agent 只好自造一套，
违反 ADR 0026 的 title 规矩，也让评审说“B11”时指不清是哪一种。

**Decided**（2026-10-10 owner：“显式支持 Variants：一个 frame 里有多个变体，可以展开 / 选择展示哪个 / 收起，
收起时只展示选择的那个，默认第一个”；展开时原位横向并排；分享页、导出图、`ppnt shot` 全部展开并高亮选中的；
新概念叫“变体”，comp 那个叫“组件 variant”）：

- screen 条目带 `variants: [{ id, title? }, …]` 就是变体组。**每个变体仍是独立屏**：自己的源文件、id、标注。
  标注锚点本来就是屏 id + ppId，所以账本格式不变、旧页不迁移。
- 组整组占一个位置号（B11），变体派生 B11a / B11b / …（显示编号，调序就变，id 才是身份，同 ADR 0038）。
- 引用：`B11` / 组 id = 组内全部变体；`B11b` / 变体 id = 单个。`ppnt shot` 对组逐个变体各拍一张。
- 实现上先把板摊平（`expandVariants`）：组条目换成带 `variantOf` 的普通屏，编译、装载、导出、截图这些只认屏的
  消费端不用改；编号与引用按 `variantOf` 归组。
- 选中的变体存本机偏好（`prefs.variantsByPage`）、不进 `board.json`（评审状态不污染原型源码）。
- 画布：默认收起、只摆选中的；展开时原位横向并排、后面的帧右移（owner：“1 A”）；展开态选中的画 accent 外环。
  收起的变体不用 `display:none`（会让标注层把它们的标注全判成“锚点失效”），用 `.wb-var-off` 挪出画布。
- 分享页、整段 / 整页截图一律全部展开并高亮选中的（owner：“2 B，且高亮被选中的”）；单帧图不带环。
- 导航（minimap、‹ ›、大纲点击、标注列表跳转）只落在摆在画布上的变体；目标是被收起的变体时先选中它。

**否掉的**：
- 标注挂在“帧”而不是“变体”：评审意见通常针对某一种做法，且那样要改账本锚点格式。
- 给 title 加手写编号字段（让 agent 的 K11 合法）：编号手写必重复；语义关系用组表达，不用字符串前缀。
