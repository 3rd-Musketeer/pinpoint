# 0014 · 左栏大纲 + 延伸线结构

Status: 现行 · Date: 2026-08-15 · Scope: `workbench/app/Sidebar.jsx`

Supersedes: ADR 0013（左栏内容）

**Decided**（owner 在 `previews/outline-variants` 四案对比后拍定 V2）: 左栏 Pages 之下加大纲区——当前页 section → frame 树，行 = 引用号 + 屏名 + 计数徽标（红 = 含失效锚点）；点击 = 定位 frame 并打 focus 环，与右栏标注卡焦点双向同步（v1 不做卡片过滤）。层次处理 = 延伸线：14px rail 槽位，section 字母与竖向导线同轴，spine 贯穿整行逐行拼接，段头接续线自字母下缘起笔，末行收 └ 角；选中染整行、线压染色之上。
**Why**: 左栏原先只回答「我在哪一页」，不回答「这页里有什么、标注集中在哪」；大纲让 A1 引用体系从图注标签变成可导航地址。延伸线胜出：与画布网格同一套线的语言（制图引线），且不引入新交互元素（V4 折叠的收纳能力等 section 真多再补）。
**Consequences**: 修订 08-15b 的「第一批左栏只做 Pages + 设置」→ Pages + 大纲 + 设置。大纲数据从 board.json 派生，无新机制。rail / spine 槽位几何即正式 React 组件结构，禁用绝对定位 magic number 画法。四案对比板 `previews/outline-variants/` 保留作判例档案。
