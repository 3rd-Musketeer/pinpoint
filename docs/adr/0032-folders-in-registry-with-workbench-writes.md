# 0032 · Pages 分组 = 手动文件夹，登记表因此有了第二个写入口

Status: 现行 · Date: 2026-09-04 · Scope: `src/server/lib/registry.js`、`src/server/lib/registry-store.js`、`src/server/annotate-api.js`（registry 路由）、`bin/`、`docs/registry.md`、`src/workbench/app/Sidebar.jsx`

**Decided**（owner 2026-09-04 原话：“要不还是我自己手动建文件夹吧，然后支持拖放就行，这样最简单”）:

- **文件夹由 owner 手动建，页靠拖放入夹。只有一层，不嵌套。**
- **存在登记表里**：`~/.pinpoint/registry.json` 顶层加 `folders: [{id, name, collapsed}]`，条目加 `folder` 字段。
  模板页不是 registry 条目，所以另有一份按 page id 索引的 `pageFolders`，让它们也能入夹。
- **顺序**：文件夹在前，散页在后。夹内沿用 Pages 既有的三档排序（ADR 0029），手动 `order` 只在“默认”档
  生效——另外两档按时间和名字排，手动顺序在那里没有可以落脚的位置。
- **删夹不删页**：夹删掉，里面的页退回散页区。
- **登记表从此有两个写入口**：文件夹相关的写（建夹 / 改名 / 删夹 / 把页放进夹 / 夹内排序 / 折叠状态）由
  workbench 经服务端的文件夹专用接口完成——拖放要当场生效，走 CLI 不成立；条目本身的增删与重指仍然
  只走 CLI（`add` / `move` / `rename`）。`docs/registry.md` 的“写入走 CLI”一节改成这个口径，CLI 补
  `pinpoint folder`。
- **“已归档”不是一个功能**：它就是 owner 自己建的一个叫这个名字的夹。
- **模板页默认不显示**：`content/previews/_index.json` 的三个 manifest 页（Component Library /
  Example Library / Example HTML）默认藏起来，设置里给一个开关。它们是模板资产，不是 owner 每天要找的页。

**Why**: Pages 已经是 26 行平铺，其中大部分不再用，而 owner 每天要做的事就是从里面找出正在做的那几页。
左栏最前面三行还恰好是从不打开的模板页。分组要解决的是这件事，不是“把列表变整齐”。

**Rejected**:

- **按来源路径自动分组**：两条规则都对着 registry 里的 26 条真实条目量过——① 取路径上最近的一个标记
  目录（`prototypes/`、`repos/` 这一类），② 一张模式表。两条都能分对 24 到 26 条，也就是说自动分组做得到。
  owner 仍然选手动，理由是“这样最简单”：自动规则要解释、要维护，分错的时候没有直接的改法，而手动
  文件夹的心智成本是零。做得到不等于该做。
- **归档标记位**：一个 `archived` 布尔字段加一个折叠区。手动文件夹能表达同一件事，不必再引入一个只有
  一种取值的维度。
- **`pinpoint group`**：随自动分组一起作废。
