# 0016 · 侧栏宽度策略（V2 拍定并落地）

Status: 现行（已落地） · Date: 2026-08-16 · Scope: `src/workbench/boot-prefs.js`、`src/workbench/stage.js`、`index.html`

**Decided**（owner 体验板 V1/V2/V3 可拖 mock 对比后拍板）: 右栏（标注工作台）补 splitter 拖拽，clamp 260–440、默认 308；宽度 <280 进紧凑态（卡片藏 cap、文本单行 truncate、底栏批注 dropdown 收 图标+值），拖回自动恢复；双击 splitter 复位 308；`annPanelWidth` 偏好持久化。左栏维持现状（200–480 + 折叠）。rail 档（56px 图标列）与窗口过窄自动让位：**不做**。
**Why**: 两栏夹画布挤小中间屏。内容分析结论——左栏 200 是「大纲可读」下限（屏名不足 5 字失去意义），右栏 260 是卡片舒适下限；窄态诉求由紧凑断点 / 折叠接，不由更窄宽度接。V1（min 卡死）做不到「想窄但保留列表」；V3 rail 对树形内容只剩字母、定位语义弱，且左栏窄诉求已被折叠 + 浮钮覆盖。
**契约**: 体验板 `previews/sidebar-variants/sidebar.html`「侧栏宽度：分析 + 方案」V2 mock（px 读数 chip 是演示道具，真实实现只有 aria-valuenow）。
**落地**: `boot-prefs.js`（ANN_W_* + applyAnnWidth + compact 类开关）、`stage.js`（#wbannsplit 拖拽/键盘/双击复位，镜像 #wbsplit，左拖 = 变宽）、`index.html`（--wb-ann-w + 紧凑样式 scope `#wbann-side.compact`；共享行 `lib/ann-list.css` 不动）、`AnnPanel.jsx`（dropdown 文案包 `.wb-ann-bubble-lbl`）。e2e 55 → 60，unit 173 持平；活体 16 断言 PASS。
