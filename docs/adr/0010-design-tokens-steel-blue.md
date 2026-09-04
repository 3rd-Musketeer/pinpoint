# 0010 · 设计语言 token 级锚定：Steel Blue accent + 画布点阵 + 结构缝回调

Status: 部分被取代（语义色 / 结构缝 / mono 档仍现行） · Date: 2026-08-13 · Scope: `scripts/build-wb-tokens.mjs`、`src/workbench/wb-tokens.css`、`src/shared/ann-list.css`

Superseded-by: ADR 0011（accent 值、网格人格）、ADR 0012（纹理入口进设置）

**Decided**（owner 在评审板 `previews/accent-orange` 上拍板；细化 2026-08-11 的审美锚）:
- **accent = Steel Blue `#1769aa`**（eval harness 现役 `--blue`），替换 iOS 蓝 `#007aff`。核心理由：chrome 与 iOS kit 内容分色（内容继续用 `#007aff`）。评审覆盖橙 / 蓝图蓝 / 制图绿三族 15 个候选，含 WCAG 对比度与琥珀同框检查。
- **画布纹理 = 24px 中性暖灰点阵**（`--wb-stage-dot`，屏空间固定，pan/zoom 不带动、无 moiré；职责是平移反馈不是测量）。灵感 = 绘图室三原色（绘图纸 / 晒图蓝图 / 坐标纸绿网格）；制图绿线网格保留为日后人格化选项。
- **语义色收编 eval 族降饱和对**：danger `#ff3b30`→`#b84230`，ok/online 绿 `#1b7a3d`/`#34c759`/`#e8f8ef` 散字面量 → `--wb-ok` / `--wb-ok-soft`。琥珀 `#f5a623` 保留为标注特性功能色（双端一致信号，不动）。
- **结构缝回调**：V5 全面去线矫枉过正——缝（pane 分界 1px `--wb-seam`）≠ 已退役的卡片描边。落在侧栏 head/footer、Annotations 段界、设置头、扩展面板头。
- **元数据 mono 档** `--wb-font-mono`（标注行 cap/tags 首消费，双端共享表同源）。
- 字体保持 Apple 系统栈；单 light 主题，不做 dark。

**Why**: 审美参照系是 owner 自己的 my-todos（DESIGN.md 自称 Linear Light，accent `#5e6ad2`）与 areta eval harness（shadcn 中性 + Geist + 降饱和语义色）；token 管道（生成器 → shadcn 桥 → Tailwind + 注入端钉值）让换皮只动值不动组件，本轮即验证。

**顺带修复**: 扩展面板（`#panel-list`）此前不在 `lib/ann-list.css` 作用域内——行/空态从未吃到共享样式，本轮补入第三消费端。
