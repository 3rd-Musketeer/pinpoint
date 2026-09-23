# CONTEXT — pinpoint 词汇表

一个词一条定义，附它住在哪个文件或符号里，以及要避开的同义词。
两个人（或两个 agent）对同一个词理解不同时，以本文为准；发现新词或新歧义就补一条。

## 对象层

**page（页）**
Pages 列表里的一行 = 一件正在做的事。页自身没有类型：一个页可以同时装画布、文档和网页。
`pageId` 同时是标注地址 `@page:<id>` 和 DOM 上的 `data-vpage`。
住在 `content/previews/_index.json`（模板页）或 `~/.pinpoint/registry.json`（登记进来的页）。
要避开：“册”（owner 明确否掉的自造词，ADR 0021）、“project”、“board”当页用。

**board（板）**
一个页的内容定义，就是那份 `board.json`：顶层是 `sections[]`，不是扁平的 `{id, screens}`。
契约在 `src/workbench/lib/preview-contracts.js`，schema 见 `docs/board-schema.md`。
要避开：拿 board 指画布那块区域——那叫 canvas。

**section（区）**
board 里的一组屏，有 `id` / `title` / `layout`。`section.id` 会写进 DOM 的
`[data-ann-section]`，成为标注的 `section` 字段。引用号里 section 是字母（A、B）。

**screen（屏）**
一个 frame 里装的内容，也就是那个帧源文件本身（`<pageId>/<screenId>.jsx`，存量页是
`<screenId>.html`）。`screenId` 就是 frame 的 id——同一个东西的两个名字，看你说的是内容还是位置。

**frame（帧）**
画布上的一个取景框，装一个 screen。引用号里 frame 是数字，和 section 字母拼成 A1 / B3。
人对 agent 说“改 A2”，机器仍走 `@frame:<pageId>/<screenId>`。
要避开：拿 frame 指 iframe——mention 水合出来的那个 iframe 是实现手段，不是这个词。

**folder（文件夹）**
Pages 列表里 owner 手动建的一层分组，页靠拖放入夹；只有一层，不嵌套。
住在 `~/.pinpoint/registry.json` 顶层 `folders[]` 与条目的 `folder` 字段（2026-09-04 定，实现中）。
要避开：“project”“group”当文件夹用；“归档”——那只是 owner 自己建的一个夹，不是功能。

**entry（条目）· 这个词有两个意思，别混**
- **board entry**：`src/workbench/lib/board-entries.js` 从 board 派生出来的可选中单位。
  app / lock 屏合成**一个** canvas entry（id 恒为 `@canvas`），每个 `shell: "doc"` 的屏各成一个
  document entry（id = screenId）。舞台形态跟着选中的 entry 走，不跟着页走。
- **registry entry**：`~/.pinpoint/registry.json` 里的一条登记，形状
  `{id, title?, kind: "dir"|"file"|"url", path?|url?, board?, page?, role?}`。
  它是标注分桶的单位，`entry` 字段写进每条标注。
两者在代码里都叫 entry，读代码时靠上下文分：`board-entries.js` 里的是前者，
`registry*.js` 与标注记录里的是后者。

**canvas（画布）与 doc（文档）· 两种形态，不是两种页**
canvas = 迭代态：手机机壳、可缩放平移的图纸面。doc = 表达态：整份独立 HTML 在 iframe 里 1:1
铺满舞台，没有缩放、没有画板、没有 frame 标题。同一个页可以两种都有，切哪个由选中的 board entry 决定。
要避开：“web 模式”——那个壳 2026-08-16 已连壳退役（ADR 0017），只在历史文档里出现。

**viewport（视口）**
文档条目怎么被看：窗口 = 整份 HTML 在 iframe 里 1:1 铺满舞台；手机 = 同一份 HTML 装进一块
402 × 874 的手机屏，整块屏缩到可用区高度的九成、居中摆在舞台上，机壳跟设置走但不带
状态栏 / 岛 / home 条。两种都是 doc 形态，不是 canvas——没有网格、缩放、图注、导出。
页的偏好，住 `prefs.viewportByPage`（`src/workbench/lib/viewport.js`，横条 `#wbviewport`
切换），不进 registry。只对文档条目有意义。
要避开：拿 viewport 指 `pageViewports`——那是每页画布的滚动位置与缩放存档，不是这个词；
也别拿它指浏览器窗口本身——“窗口”只是这两种看法之一的名字；也别把手机视口说成
“frame”——它不在画布上，没有引用号。

**产物与草稿**
左栏“内容”区的两组。产物 = 交付物（画布 / 文档 / 网页，条目上带类型 tag）；
草稿 = 过程里派生出来的整页 HTML（screen 上 `role: "draft"`）。两者没有机制耦合——
选中一版之后回灌是 agent 改代码的动作，pinpoint 不提供这个功能。

## 资产层

**kit**
积累下来的设计规范：tokens、primitive、产品组件。今天只有 `content/kits/ios/`
（`ios-kit.css` + `ios-kit.js` + `jsx/`——系统组件的 JSX 印章，帧经 `pinpoint/kit` 引用）。
kit 是第一个 kit，不是产品本身。

**component（组件）**
先住页里的印章：`<page>/components/<Name>.jsx`，命名导出一个纯函数，输入 props 和 children、
输出 HTML，没有状态、事件、副作用（lint 四禁挡着）；帧文件显式 `import` 它，同名时页内覆盖 kit。
variant 用 props 表达，variants 墙是 board.json 里 `shell: "comp"` 的 section，screen 条目内联
`comp` + `props`。跨页复用 = 手动把文件搬进 kit（`content/kits/ios/jsx/`），之后走 `pinpoint/kit`，
没有自动提升（2026-09-22 pp2 决定，取代 ADR 0028 的 kit 集中归属；机制见 `docs/board-schema.md`）。
要避开：拿“组件”指 workbench 自己的 React 组件——那个说 workbench 组件。

**source 与 dist（源码与编译产物）· pp2**
源码 = 页目录里 agent 写的东西（`.jsx` 帧、`components/`、页级 css / js、board.json；存量 `.html` 也是源码）。
dist = `ppnt build` 编出来的静态 HTML 帧，住 `~/.pinpoint/dist/<entry>/`，不进 git，不放回页目录。
标注、导出、mention、`/sites/` 下的屏 HTML 只认 dist；看 dist 走 `ppnt render`。
页级资源在 board.json 的 `assets`，由编译器注入每帧。
要避开：拿“产物”单说 dist——左栏的“产物”仍是交付物（见上），说编译结果就说 dist。

**标注状态（status）· pp2**
一条标注四态：open（owner 写下）→ check（agent 看了、不改，带一行 note）/ done（agent 改完）→ close（owner 单击确认，可撤销）。
owner 编辑正文或目标自动回 open。只有 `ppnt mark` 写 check / done，close 只在工作台；close 不删，默认收起。
取代 review-refinements 的“结果指示”（蓝框）。
要避开：把 done 说成“已验收”——验收是 close。

**`#n`（标注序号）· pp2**
标注对外引用号，按 registry entry 单调计数、永不复用，跨页写 `<entry>#12`。随机 `id` 留作内部主键，`@a:<id>` 继续兼容。
`#` 只属于标注序号：编译锚点 `data-pp-id` 的同行实例后缀用 `@`（`Nav.jsx:18@2`），两套符号不共用。
要避开：把锚点后缀写成 `#`——那是标注号的地盘。

**template 与 instance（模板与实例）**
template = 进 git 的那部分：框架代码 + Example Library + system 组件，`content/previews/` 里只有它。
instance = 这台机器上 owner 自己的内容：`prototypes/`、`tasks/`、`BACKLOG.md`、`TODO.md`、
`.archive/`、以及一批 owner-local 的 kit 组件，全部靠 `.git/info/exclude` 挡在 git 之外。
`PREVIEW_TEMPLATE_ONLY=1` 把实例内容藏起来，e2e 与发布校验跑在这个模式下。
要避开：拿 instance 指“一个 annotate client 实例”——那个说 client 实例。

## 服务层

**registry（登记表）**
`~/.pinpoint/registry.json`（`PINPOINT_REGISTRY` 可覆盖），声明哪些仓外内容进 pinpoint。
读侧宽容（`src/server/lib/registry.js`），写侧严格 + 原子（`src/server/lib/registry-store.js`）。
它同时是三件事的白名单：serve 什么、往哪注入、标注落哪个桶。

**site（`/sites/`）**
登记条目在服务上的 URL 空间：`/sites/<entry-id>/<path…>`。dir / file 条目是只读静态服务，
url 条目走同源代理（`src/server/lib/site-proxy.js`）。
要避开：拿 site 指用户自己那个网站——那个说 target origin 或目标应用。

**injection（注入）· 登记过才注入**
annotate client 只落在登记过的目标上，其余一切 URL 打开的是逐字节相同、零标注面的页面。
`?annotate=off` 让单次请求不带 client（导出管线走这条）。
注入片段的唯一事实源是 `src/server/lib/annotate-snippet.js`。

**bucket 与 ledger（桶与账本）**
- **bucket（桶）**：一个 registry entry 一个目录 `~/.pinpoint/<entry-id>/`，磁盘就是事实源。
- **ledger（账本）**：桶里的一个 JSON 文件 = 一个页面路径的标注集合。
  文件名（page key）= `decodeURIComponent(filename) + '~' + hash31(pathname).toString(36)`
  （`src/shared/annotate-page-key.js`），所以同名文件在不同目录各有各的账本。
浏览器 `localStorage` 只是缓存，不是权威。

**mention（提及）与 embed（嵌入）**
mention 是语义：doc 正文用 `<div data-pinpoint-frame="<pageId>/<screenId>"></div>` 引用一个活 frame。
embed 是实现：doc 自己的 annotate client 把挂载点水合成一个指向 `/api/frame` 的 iframe。
标注绑对象不绑视图，所以 frame 里的标注在画布和文档两个面都看得到、实时同步。
要避开：把 mention 说成“截图”或“副本”——它引用的是活对象。

**REV**
按字母递增的页面版次，配一条更改栏。**没有实现**：2026-08-15 缓期进 BACKLOG（ADR 0013），
启动信号是异步多轮验收成为常态。见到 REV 这个词，它指的是设计储备，不是现有功能。

## 引用地址

`@page:<pageId>` · `@section:<pageId>/<sectionId>` · `@frame:<pageId>/<screenId>` · `@a:<annotationId>`。
pp2 起 CLI 还认 `B3`（图纸号）和 `#12`（标注序号），见资产层“`#n`”。
这四个是人和 agent 在对话里互指的短地址。标注正文里指自己的目标用 `[@t:iN]`，
它只在那一条标注内解析，永远不进 `mentions[]`。
