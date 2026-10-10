# 0041 · 页内 tab：page → tab → section

Status: 现行 · Date: 2026-10-10 · Scope: `src/workbench/lib/board-tabs.js`、`src/workbench/lib/preview-contracts.js`（`validateBoardTabs`）、`src/workbench/lib/board-refs.js`、`src/server/lib/ann-refs.js`、`src/server/lib/offline-page-export.js`、`src/client/share-runtime.js`、`src/workbench/app/TabBar.jsx`、`bin/cli/{list,annotate}.js`、`bin/ppnt-shot.js`

**起因**：0040 把“组件页”和“交互页”分成两种页，底层一样。同一个原型常常既要一面组件墙，也要正式流程，
有时还要一块试验场；拆成几个独立的页就得重复登记、`components/` 和资源各复制一份，标注也散在几个账本里。
owner 的裁决：这是同一个页里的视图分组，不是几块板。

**Decided**（2026-10-10 owner，加实现时自定的部分）：

- tab 只是 section 的视图分组。一个页的所有 tab 共用 `components/`、资源和同一个标注账本；section id 与
  screen id 在整页内唯一（跨 tab 也不许重复）。tab 不是独立的 board。
- `board.json` 写 `tabs: [{ id, title, sections }]`，与顶层 `sections` 二选一，不能并存。tab id 在页内唯一、
  是 id 的样子；每个 tab 至少一个 section。不写 `tabs` 的存量 board 一字不改。
- 编号按 tab 各自从 A 重来：每个 tab 里 section 是 A、B…，帧是 A1、B3…（ADR 0026、0038 的编号规则作用域
  由“整页”改为“每个 tab”）。
- 版本不做特殊工具。“playground”只是起了这个名字的 tab，没有版本、分支、回滚语义。
- 读板只走一个归一步：`flattenTabs`（`board-tabs.js`）把 `tabs` 摊成带 `tabId` 的 section 列表加 `tabs` 清单，
  幂等，存量 board 原样返回。校验与编译覆盖所有 tab；工作台只挂活动 tab 的 section。
- **工作台**：活动 tab 按页存本机偏好（`activeTabByPage`），深链 `?tab=<id>`（第一个 tab 不写）。切换 = 重挂那个
  tab 的 section；大纲、导航器、minimap、‹ ›、缩放与视口存档都按活动 tab 走，视口存档的键是 `页::tab`。
  凡是要定位别的 tab 里的帧（标注跳转、大纲点击、`window.workbench.focusFrame`），先切 tab 再定位；
  跨 tab 时 `focusFrame` 返回 Promise，同 tab 内仍同步返回 boolean。
- **切换条**（`#wbtabbar`）：与底部横条平行的第二条胶囊，居中叠在横条正上方，层级用同一档 `--wb-z-strip`；
  不足 2 个 tab 的页整条不存在。其他 tab 的帧不挂载，所以不会出现幽灵钉子；落在未挂载 tab 里的标注不算
  “锚点失效”。
- **引用与 CLI**：多 tab 页上位置引用写 `<tab>:B3` / `<tab>:B`；帧 id 与 section id 仍是裸的（页内唯一）。
  裸 `B3` 只在恰好一个 tab 里存在时解析成功，多个 tab 里都有就报错并列出候选
  （“B3 在多个 tab 里有，写 comps:B3 或 flow:B3”）。单 tab 与存量页的行为不变，写 tab 前缀会报“这页没有 tab”。
  `ppnt list --frames` 按 tab 分组；`check --frame`、`locate`、`mark`、`shot` 沿用同一套解析。账本格式不变。
- **`ppnt shot` 整页**：每个 tab 渲染一张，文件名 `<页>--<tab>.png`；指定了某个引用就只渲染它所在的 tab。
  单 tab / 存量页仍是 `<页>.png`。理由：一张图不能同时摆下两个 tab，而 shot 的作用是让 agent 看到改了什么，
  所以宁可多出图也不静默漏掉一个 tab。
- **分享页 / 离线导出**：包含全部 tab，同款切换条（叠在横条上方，单 tab 页不出）；在原生脚本里翻
  `data-tab-hidden` 属性、重收集、回中，不依赖 React。分享页的深链 `#frame-<id>` 指到别的 tab 的帧时先切 tab。

**否掉的**：

- 每个 tab 做成独立的 board / 独立的页：`components/`、资源、标注账本都要分开或同步，而 owner 要的就是同页共享。
- 全页统一编号（A…Z 跨 tab 连续）：新增或调序一个 tab 会让另一个 tab 的编号全变，口头说“C2”要先问哪个 tab；
  按 tab 重来后，口头说法 `flow:B3` 自带作用域。
- 给 tab 加版本 / playground 语义（快照、回滚、实验标记）：没有人要这个机制，名字足够表达；真要版本，用 git。

**代价**：多 tab 页的位置引用多一个前缀；工作台里一次只看得到一个 tab，要并排比较两个 tab 的帧得靠把它们放进同一个
tab。
