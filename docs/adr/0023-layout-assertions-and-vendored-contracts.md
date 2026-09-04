# 0023 · 布局断言比几何不靠点击 + vendored 组件内部契约成文

Status: 现行 · Date: 2026-08-17 · Scope: `e2e/workbench.spec.js`、`workbench/app/ui/`

**Decided**（owner 2026-08-17 提问「这是不是一个潜在要修复的架构/系统性问题」后批准三件修复）：

- **布局/自适应断言一律比 bounding box，不靠点击**。Playwright 点击不检查祖先 `overflow` 裁剪，「能点到」证明不了「人能看到」——本次的实证：复制按钮被裁出栏外，e2e 与 agent 首轮排查的「点击 + 读剪贴板」断言却都通过，测试和排查犯了同一个错。e2e 辅助 = `withinContainerViolations`（workbench.spec.js），左右栏默认宽 + 紧凑宽各一档已生效；以后写 UI 布局用例照此断言。
- **vendored 组件已知内部契约成文**：`AGENTS.md`「Vendored 组件已知内部契约」小节 + 各 `ui/` 组件头注。「source-owned, edit freely」只覆盖包装层；Radix Primitive 的内部 DOM 契约是上游的，只有 computed style 可见。新增条目带日期与来路；登记处长到 5+ 条再评估更结构化对策（契约测试）。

**Why**: ScrollArea `display:table` 内层把 Page 行按自然宽 274px 排版（栏宽 250），行尾 copy 钮被 `overflow-x:hidden` 裁出——同类摩擦第二次出现（首次 = frame-menu Popper wrapper 需中和），证明「行为归组件、几何归 CSS」的收编分工默认了组件内部无害，这个默认不成立。
