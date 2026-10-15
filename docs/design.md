# DESIGN — pinpoint 设计语言正典

当前有效的设计语言只写在这里；被取代就改本文，不留尸骸。

分工：本文 = **现在是什么样**（正典）。为什么这么变、什么时候定的 → [docs/adr/](adr/)（索引与格式见 [adr/README.md](adr/README.md)）。某个 token 值的理由 → `scripts/tokens/source.mjs` 注释（全站一份 token 源，ADR 0046）。UI 文案（写什么字）→ workspace 的 topics/text-quality/ui-text.md，本文引用不复制。

工作台外壳的形态是画布满铺 + 浮动玻璃面板 + 底部横条 + 右栏标注列表，见 [adr/0031](adr/0031-shell-glass-panel-bottom-strip-on-demand-list.md)。文章站点（`site/`）与工作台共用一份 token 源，色彩、字体与排印、圆角三节两边都管；文章页的布局与组件写法见 `site/README.md`。

## 原则

1. **装饰即功能**：每个视觉元素必须回答“它标记、组织或反馈什么真实信息”。答不上来就删（判例：铭牌铆钉、画布角十字，ADR 0012）。
2. **层级靠线宽与明度阶梯，不靠颜色数量**。三级线各有语义：发丝（格内细分）→ 结构缝 `--wb-seam`（pane 分界）→ 图框（sheet 边界）。
3. **复古感由字体与编号体系承载**（mono + tabular-nums + 字距 + A1、B3 这类编号词汇），不由质感贴皮承载（做旧、铆钉、假材质）。
4. **丰富由真实数据产生**；系统的职责是 hold 住它，不加戏。
5. **全场只允许一个签名物**。一个是意图，十个是噪音。
6. **情感来自行为的周密**（hover 联动、即时回显、克制动效），不来自表皮。

## 色彩

全站一套调色板（ADR 0046）：工作台、注入端、文章站点、图 kit 都从 `scripts/tokens/source.mjs` 生成（`npm run build:tokens`），改值只改源。产物：`src/workbench/wb-tokens.css`（`--wb-*`）、`src/shared/ann-tokens.js`（注入端的字面量钉值）、`site/src/styles/tokens.css`（`--pp-*`）、`content/kits/figure/figure-palette.css`（`--fig-*`）。帧内容（iOS 屏、文档纸面、kit 里被评审的组件）是被评审的内容，不跟随。

- **两层**：基础色阶只在源里引用；组件用语义 token。中性 = Radix gray 12 档（纯灰）；强调 = 绿 A 青绿，以 `#0e8f6c` 为第 9 档的 12 档色阶；评论高亮与警示 = Radix amber。
- **语义色**（亮 / 暗）：页面底 `#ffffff` / `#111111`；浅面 `surface` gray 2 `#f9f9f9`（画布纸 `--wb-stage-bg`、卡片底、代码块）；浮起的面 `surface-raised` 白 / gray 3；控件底 `fill` gray 3；发丝线 `border` gray 5 `#e0e0e0`；结构缝与表头线 `border-strong` gray 7 `#cecece`；正文 gray 12 `#202020`；次要字与元数据 gray 11 `#646464`（白底 5.92:1）。
- **强调色**：色块（选中描边、图里的强调线、焦点环）用 green 9 `#0e8f6c`；实底压白字（主按钮、钉子底的“标注”段、工作台 `--wb-accent`）用 green 10 `#008564`，暗色同值；正文里的强调字（链接、`[[ ]]` 芯片、节号、帧引用号、agent 名）用 green 11 `#007658`（白底 5.6:1），暗色 `#2eb289`；浅底（目录当前项、状态胶囊、芯片悬停）green 3；选中行与文本选区 green 4。强调色是可交互 / 当前 / 系统标注语义；工作台全页唯一实心 on 态仍是横条上的“标注”段。chrome 与 iOS kit 内容分色，内容侧 `#007aff` 不变。
- **功能色**：危险 `#c0392b`（暗色作字 `#ff7b6b`）只给失效 / 过期 / 危险确认；琥珀 `#f5a623` 只标“正在圈选”（hover ghost / target / lasso）；警示字 amber 11；评论高亮 amber 3 / 选中 amber 4。
- **标注四态**（钉子与列表行首序号圆，`--ann-st-*` / 站点 `--pp-status-*`）：open `#1f5f8f`、check `#b85a14`、done `#7a4fd0`、close `#8d8d8d`，白字；暗色 `#5b9fd6` / `#d9782a` / `#8a5ae0` / `#8a8a8a`，open、check、close 的数字是深字 `#202020`（`--ann-st-*-fg`，≥ 4.5:1 单测守）。
- **hover / 浅填充**由正文色混出（`--wb-hover` 5%、`--wb-fill` 6%），网格线由强调色混出（`--wb-grid-1` 9%、`--wb-grid-2` 4%，暗色 16% / 7%），不另立色相。
- **亮暗**：每个语义 token 一对值。站点与图 kit 输出三段（默认亮；系统暗且没手动选亮；`data-theme="dark"`），顶栏 ◐ 切换；注入端同样认 `data-theme`；工作台只跟系统 `prefers-color-scheme`。色块上的字用 `--wb-on-accent`，不用 `--wb-surface`（暗色下 surface 是深灰）。
- 注入端跑在别人的页面里，钉值必须是字面量：`annotate-css.js` 把 `ann-tokens.js` 生成的声明串拼进 `[data-ann-ui]` 与 `#ann-sidebar`，所有 `var(--wb-*, 兜底)` 的兜底等于亮色钉值。`src/client/annotate.test.js` 逐个比对两端的亮暗值和全部兜底。

## 材质

- 全场只有一种材质：F2 磨砂玻璃。配方 = `--wb-glass` 白 88%（`rgba(255,255,255,.88)`；暗色为 `rgba(34,34,34,.88)`）+ `--wb-glass-blur`（`blur(20px) saturate(1.2)`）+ 0.5px 上缘内高光 + `--wb-sh-3` + 圆角 `--wb-r-glass` 14。CSS 类是 `.wb-glass`（`index.html`），token 在 `src/workbench/wb-tokens.css`。
- **常驻浮起的表面一律用 F2**：左栏面板、底部横条、右下按需卡、注入端的 `#ann-sidebar` 与工具条。注入端读不到 workbench 的 `--wb-*`，所以那份配方在 `src/client/annotate-css.js` 里是字面量；两端不许分家，对账靠 `src/client/annotate.test.js` 的单测（字面量与 tokens 逐个比对）。
- 玻璃做的是材质感，不是真透视。更透的两档（白 62% / 白 38%）在评审时否掉：正文压在深色内容上读不清，一块常驻面板也不该有那种透视强度（ADR 0031）。要更透就是错的方向，不要试。
- 反模式：做旧质感、假材质、装饰性描边（ADR 0008）。磨砂玻璃是唯一材质（ADR 0031），不算反模式。
- 瞬时浮层（菜单、对话框、评论卡）仍是白面 + 阴影阶梯 `--wb-sh-*`，不上玻璃：它们只掠过，不需要与画布共存。大纲浮层是例外：它用 `.wb-glass`，因为打开时要盖在画布上读一长段目录，和左栏、横条同一份材质。Portal 到 body，层级 `--wb-z-float`，宽不超过 320，最大高度 60vh，内部滚动，从底部的条向上弹。

## 字体与排印

- 系统字栈（Apple，`--pp-font` = `--wb-font`，补 Noto Sans SC 兜底）。mono（ui-monospace / SF Mono，带 PingFang 兜底）给机器精度信息：编号、日期、尺寸、id、引用号；读数 tabular-nums。
- **字号阶梯**（`--pp-fs-*`，取 Tailwind 的 12–36，下面补界面小字 11、13）：11、12、13、14、16、18、20、24、30、36。文章站点只用这几档；行高四档 `--pp-lh-*`：1.2 界面行、1.35 标题、1.5 界面正文、1.8 文章正文。
- **工作台字阶三档 + 元数据**（ADR 0031），之外不另起字号：

  | token | 值 | 用在哪 |
  |---|---|---|
  | `--wb-t-title` | 600 13px/1.2 | 标题：左栏 wordmark、横条页名、弹出列表头、页面信息对话框、导出页标题 |
  | `--wb-t-row` | 500 13px/1.2 | 列表行，正色 `--wb-fg`，不是 muted |
  | `--wb-t-body` | 400 12.5px/1.45 | 正文（标注正文、说明） |
  | （无 token） | 11px mono | 元数据，配 `--wb-faint`；字重随位置（行尾计数 400 11px/1，区头 600 加字距） |

- 两种消费方式。手写 CSS（`index.html` 的行与面板几何）写 `font:var(--wb-t-*) var(--wb-font)`，元数据写 `11px` 字面量配 `var(--wb-font-mono)`。React 组件走 Tailwind：`wb-tw.css` 的 `@theme inline` 只把颜色、圆角、字体栈与字重接到 `--wb-*`，字号没有对应的 utility，所以组件里写的是与某一档相同的字面量（`text-[13px] font-medium`）——值必须落在上面几档上，不要在类名里发明新字号。
- 区头 / eyebrow：11px semibold mono + 字距，英文大写（左栏段头）。
- 图标 = SVG 线性（lucide 族，约 1.7px 描边），emoji 不当图标。
- 文案不用“·”拼合信息：层级用版面表达（分行 / eyebrow / chip / 字重）。判据与案例归 workspace 的 topics/text-quality/ui-text.md 第 8 条。

### 文章正文排版

文章页与 wiki 词条页的 `<main>` 带 `pp-prose`（`Base.astro` 的 `prose`）。基础规则是 vendor 进来的 Tailwind Typography 0.5.20 prose（`site/src/styles/vendor/tailwind-typography.css`，MIT，原样入库），适配在 `site.css`“正文排版”一节，尺度走 `--pp-prose-*`。CSS 分三层（`layers.css`）：base（元素默认）< prose（vendor 与适配）< 不分层的组件，所以芯片、画布卡片、评论栏总用站点自己的样式；画布卡片、图、页顶错误条带 `not-prose`，不吃正文规则。

- 正文 16px / 1.8，段距 1em，文字块行宽 40em（约 40 个汉字）；`text-autospace` 在中西文之间自动加间距，`text-spacing-trim` 挤压相邻全角标点。
- 标题一律 600、字距 0、`text-wrap: balance`：h1 32px，h2 22px，h3 18px；节号与 h2 同字号、同基线，用强调字色。标题区下方一条发丝线；lede 17px 正文色；project 标签与 lede 隔 16px。
- 行内代码浅底（`--pp-fill`）、去掉反引号；引用块不用斜体、不加引号；目录编号悬挂，当前项强调浅底。
- **表格是宽块**：渲染时包一层 `.pp-table-scroll`（`site/src/lib/rehype-table-scroll.js`），外层不受 40em 限制，最宽到正文栏（与画布卡片左右对齐，上限 `--pp-prose-wide` 72em）。表格 `table-layout: auto`、`width: auto`，不压到正文栏宽：窄表不撑满；宽表先用满正文栏，长格列收到最窄还放不下才横向滚动，底部一条细滚动条提示还有内容：只在溢出时出现，6px 高、药丸圆角、中性灰（`--pp-scrollbar`，悬停 `--pp-scrollbar-hover`），macOS“滚动时显示滚动条”下也常显（Chrome、Safari 走 `::-webkit-scrollbar`，Firefox 走标准属性），不用阴影（owner 2026-10-15：右侧阴影太夸张）。首列与其余列之间是一条发丝线。表头与首列（维度列）不折行，首列滚动时钉在左边；有长格（超过 9 个字宽）的列由 rehype 标 `.wrap`，文字区最窄 9em（约 9 个汉字一行，长格最多折三四行）、宽裕时 12em，其余列不折行；整列是数字的列右对齐。字号 .875em、表头 600、表头线加行线，取 Tailwind Typography 的表格规则。做法同 Notion 宽块、Tufte fullwidth、Stripe 文档的宽表。正文栏是目录栏和评论栏之间的那一列：1440 宽下 712px（`.layout` 上限 1360px 减两侧栏和间距），比 40em 文字块（640px）宽 72px；vault 第 6 节那种六列对比表在 1440、1280、1024 下都要横向滚动。
- **`[[ ]]` 芯片**：已有页 = 强调字 600 + 左侧 6px 实心圆点，不画下划线，悬停与焦点加强调浅底；空 ref = 灰字 + 虚线下划线 + 空心圆点，虚线是两者的区分。

## 外壳布局

画布铺满整个视口，chrome 全是压在它上面的浮层。`.wb` 只当定位容器，没有 flex 分栏。

- **左栏 = 浮动玻璃面板**（`#wbside`）。四缘距视口 `--wb-chrome-gap` 12px，下沿停在横条上方同一间距（`bottom = gap × 2 + --wb-strip-h`）。宽度 `--wb-side-w` 默认 252，拖拽范围 200–480，持久化（ADR 0016 的左栏那一半保留）。splitter 随面板浮起，常态不画线，hover 或拖拽时才现握把；折叠后贴左缘变成一条“点开”条。
- **底部横条**（`#wbstrip`）。居中的胶囊，高 `--wb-strip-h` 38，四段用 1px 结构缝隔开，从左到右一条读下来：在哪一页（Pages 开关 + 页名 + 类型标）→ 在哪一帧（‹ 1/6 › + map）→ 画布怎么看（缩放 · 回中 · 导出）→ 在干什么（交互｜标注 + 计数）。宽度由 `app/Strip.jsx` 量测后回写 `--wb-strip-w`，画布 dock 靠它对齐。文档条目选中时中段前面多一个视口两段（窗口｜手机，`#wbviewport`，见下一条）；文档形态（两种视口都是）收起画布工具那一段，换成条目步进（‹ n / N ›，`#wbentry-nav`）：按大纲顺序在本板条目间前后切换，退到画布条目时形态切回画布、这一段收起；只有一个条目的板不出这一段。横条本体留着。顶部不放任何东西，只有一个例外：直接打开的文章画布（首页“工作台”、左栏进的 `/workbench/?page=<project>_<article>`）左上角放“← 文章标题”（`#wbback`，`app/ArticleBack.jsx`），同一标签页回正文，落到画布当前所在的节（owner 2026-10-15：“返回文章按钮放在左上角比较直觉”）。它是一块 `.wb-glass`，高同页 tab 条（`--wb-tabbar-h` 32），圆角 `--wb-r-glass`，13/500 正色，图标 `arrow-left`；左栏展开时停在面板右边（`left = gap × 2 + --wb-side-w`），收起时贴左缘，层级 `--wb-z-panel`；`chromeInsets` 把它的下沿算进上方留白。存量页、模板页没有它；文章页画布浮层里的嵌入版（`?embed=overlay`）也没有，那里关浮层就回到正文原位，左栏和左栏开关也不出。
- **页 tab 条**（`#wbtabbar`，ADR 0041）。与底部横条平行的第二条胶囊，同一套磨砂（`.wb-glass`）与居中，高 `--wb-tabbar-h` 32，叠在横条正上方，间距 6px（`bottom = --wb-chrome-gap + --wb-strip-h + 6px`）。层级用同一档 `--wb-z-strip`（容器 `.wb-tabbar-root` 铺满 `.wb` 不吃事件，条自己吃）。≥ 2 个 tab 就渲染，不论条目类型；不到 2 个 tab 时只有带画布的页渲染（`boardShowsTabBar`）。≥ 2 个 tab 时，每个 tab 是一个标题钮（浅面 + 字重，不用实心 accent；全页唯一的实心 on 态仍是“标注”段）再紧挨一个大纲钮（`section-nav` 图标，aria-label 为“<标题>的大纲”）。不到 2 个 tab 时不列标题，条上只有一个大纲钮（aria-label“大纲”）。单 tab 的纯 doc 页不渲染。点大纲钮打开浮层，里面是那个 tab 的 section 与帧；有画布的页上，文档条目只出现在第一个 tab 的浮层里，单 tab 页的浮层是整棵树。纯文档的多 tab 页没有帧，每个 tab 的浮层列这个 tab 的文档；不到 2 篇文档的 tab 不带大纲钮（`tabHasOutline`）。切 tab 打开那个 tab 的默认条目（有画布是画布，否则第一篇文档），横条的 ‹ n / N › 只数这个 tab 的条目。点一帧切到那个 tab 并聚焦，然后关浮层；点 section 与 `?section=` 落点走同一条路（`focusSection`：切 tab、即时定位并选中这个 section），落到同一处；点条目也关浮层再切条目。Esc 或点外面关闭，同一时刻只开一个。`chromeInsets` 的底部占位取横条与 tab 条里更高的那条，回中、定位和 fit 都避开它；手机视口的文档屏也减掉这一带再居中、再缩放。窗口视口的文档照常 1:1 铺满，tab 条和横条一样浮在文档上。分享页也是 ≥ 2 个 tab 才出条（导出只含画布，全是文档的 tab 不算），大纲在分享页自己的左侧玻璃面板里，不走这个浮层。
- **模式 = 两段槽式控件**：“交互”选中是白面（槽式分段的常规选中语言），“标注”选中是实心 accent。
- **视口 = 文档条目怎么被看**（`lib/viewport.js`）。owner 的裁决是“doc 本身就是要展示的终态，而 prototype app 有多屏，所以 doc 可以只展示 html 本身，而 app 需要 section + frames”，要在手机上看的页面“应该给 html / url 加一个切换不同 viewport 的功能”；手机视图：“html doc 的手机视图就不需要画布了，直接就是一个自适应大小（大约 viewport 高度 90%）的手机 screen，不需要状态栏和灵动岛；在画布上容易乱跑”。所以文档条目有两种看法，都是文档形态、都没有画布，横条中段的两段槽式控件切换，默认窗口：**窗口** = 文档 1:1 铺满整个视口（就是上面那条文档形态）；**手机** = 同一份文档装进一块手机屏，居中摆在舞台上——iframe 的 CSS 视口恒为 402 × 874（iPhone 17 Pro CSS px，与 iOS frame 同一个 preset），媒体查询与排版是真实手机布局；整块屏用 `transform: scale(k)` 缩到可用区（视口减掉底部横条那一带）高度的九成，横向在整个视口宽度里居中（左栏浮着，不让位，与窗口同一条规则），k 上限 1、窗口变了跟着重算（`phoneScaleFor`）；机壳跟设置里的“机壳 无 / 有”走——无 = 裸圆角屏（kit 的屏角）+ `--wb-sh-board` 板影，有 = kit 的钛框 + 黑边框——两种都不带状态栏 / 岛 / home 条，文档不是 app；网格、缩放、回中、图注、尺寸行、帧导航、导出都是画布工具，这里一样没有，中段只剩视口两段。视口是页的偏好（`prefs.viewportByPage[pageId]`，只记手机、回窗口删 key），不进 registry、不进 URL；切换重装当前板，选中的条目跟着回来。标注锚点是元素选择器，两种视口共用同一本账本，钉子跟着元素走（在手机里跟着 k 一起缩）。手机视口不给画布条目：app 屏本来就在机壳里。
- **右栏 = 标注列表**（`#wbann-pop`）。列表常用，所以固定成右栏；钉子与评论卡在画布上，列表是第二个入口。几何与左栏对称：右缘、上缘距视口 `--wb-chrome-gap`，下沿停在横条上方同一间距，宽 `--wb-annpanel-w` 320，同一份 `.wb-glass`。仍然浮起、不挤压画布（与左栏、文档形态同一条规则）；`chromeInsets` 把它的实际矩形算进右侧留白，所以回中、定位和 fit 都在它左边的可用区里算，画布 dock 也让到它左边。横条右端计数钮切换，开着时保持：点条目定位并打开标注，不自动收起；再按计数钮或 Esc 关闭。frame / section 不显示详情面板。“···”菜单在栏顶展开，会盖住下面的筛选段，点栏标题收起。
- **画布 dock**（section-nav + minimap）停在画布右下角、横条正上方。它不在横条正上方，因为那是底部 composer 的地盘。
- **浮起的 chrome 不许压住内容**。fit-to-view、回中、定位、首访聚焦都在“视口减掉 chrome 实际 bounding box”的可用区里算（`board-nav` 的 `chromeInsets`，量的是实际矩形而不是 token 常量，折叠与拖宽自动跟上）；composer 两侧按实际占位让开。这条只管画布：**文档形态不让位**——文档 1:1 铺满整个视口，面板与横条照样浮在文档上，文档底下不露画布（owner 2026-09-05：“html 不需要画布承载；我预期这个侧栏是 float 在画布上的，而不是挤压 html 的位置”）。被面板压住的正文靠收起面板来看。几何断言一律比 bounding box，不靠可见性断言（ADR 0023）。

## 层级

外壳里每一个带 z-index 的元素都从 `--wb-z-*` 阶梯挑一档（`scripts/build-tokens.mjs` 生成 `src/workbench/wb-tokens.css`），代码里不写数字。见 [adr/0034](adr/0034-named-z-scale-and-stacking-rules.md)。

| token | 值 | 元素 | 压谁 / 不压谁 |
|---|---|---|---|
| `--wb-z-marks` | 10 | `#ann-overlay` 静止：钉子、命中框、结果蓝框、hover ghost | 在所有 shell 浮层之下 |
| `--wb-z-panel` | 20 | `.wb-side` 左栏玻璃面板；`#wb-ann-gutter`；`.wb-back` 文章画布左上角的“← 文章标题” | 压静止的钉子 |
| `--wb-z-dock` | 30 | `.wb-splitter`；`#wbdock`（按需列表 / detail 停靠槽） | 压面板 |
| `--wb-z-hud` | 40 | `.wb-canvas-dock`（section nav + minimap） | 压停靠槽 |
| `--wb-z-marks-active` | 50 | `#ann-overlay` 抬升态：点亮的气泡、flash | 压面板、停靠槽、HUD；不压横条（ADR 0031：列表不盖被定位的气泡） |
| `--wb-z-strip` | 60 | `.wb-strip` 底部横条；`.wb-tabbar-root` 页 tab 切换条（叠在横条上方） | shell 浮层里最上 |
| `--wb-z-composer` | 70 | `#ann-chrome`：写标注的输入框及其 lasso / tip | 外壳里最高，压过横条；只有 portal 浮层与 top layer 在它之上 |
| `--wb-z-float` | 100 | Portal 到 body 的浮层：tooltip、row-menu、PageSortMenu、页 tab 条的大纲浮层（`#wboutline-pop`） | 在整个外壳之上 |
| `--wb-z-float-2` | 110 | 从浮层里再开的菜单（AnnPopover 的“···”） | 压 float |
| `--wb-z-cap` | 30 | `.wb-screen-cap.has-frame-menu` | 画布内子阶梯：`.wb-library` 是 transform 上下文，只和帧内容比 |
| `--wb-z-frame-menu` | 50 | frame “···”菜单面板 | 画布内子阶梯，压 cap |

阶梯之外的两层不编号。**top layer** = 原生 `<dialog>` showModal（导出 picker 等）与 `#ann-overlay` 挂进 modal 或挂在 body 时的 popover。**客座层** = `#ann-toolbar` / `#ann-sidebar` / `#ann-export-overlay` 的 21474836xx：注入到别人页面时和宿主竞争用的，workbench 里不出现，数字保留不动。

两条结构规则，`src/workbench/layering.test.js` 解析源码守，`e2e/workbench.spec.js` 读计算样式守：

- R1 `.wb { isolation:isolate; }`：外壳自成一个堆叠上下文，页内各档只在它里面比；body 上的 portal 与 top layer 天然在整个外壳之上。
- R2 `.wb-stage-wrap` 永远不能成为堆叠上下文：不许出现 z-index、transform、filter、backdrop-filter、opacity<1、contain、isolation、will-change、perspective、mix-blend-mode、clip-path、mask。它的孩子（`#wbstage`、`#ann-overlay`、`#ann-chrome`、`#wb-ann-gutter`、`#wbdock`、`.wb-canvas-dock`）靠 z token 与 `.wb-side` / `.wb-strip` 交错。

新元素先挑 token；没有合适的档就在 `scripts/build-tokens.mjs` 的工作台模板里加一档并写注释，不写数字。`src/client/annotate.js` 里 `var(--wb-z-*, N)` 的兜底数必须与 token 同值（独立文档页不加载 `wb-tokens.css`）。overlay 与 chrome 内部（`#ann-marks`、气泡、`#ann-tip`、`#ann-box` 等）的 z-index 只在各自盒子内部比，不进阶梯。workbench 挂法下 `#ann-chrome` 是 `#ann-overlay` 在 `.wb-stage-wrap` 里的兄弟，两者同一父级 inset:0，坐标一致；modal / body 挂载时 chrome 留在 overlay 内随它进 top layer。

## 左栏结构

从上到下：head → icon tabs → 段 → 行。设置视图在同一块面板里整屏替换（齿轮进，头部“‹ 预览”返回）。

- **head**：产品名 wordmark 13/600 + 一颗连接小点（绿通红断，整句话退进 title）+ 右端齿轮。连接状态只占一个小点。
- **两组**（owner 2026-10-13 定）：“页面”tab 顶上是“文章”组，按 project → 文章列出；下面是“页面”组，列存量页的置顶、最近与全部页。两组长期并存，存量页照常从“页面”组进（owner 2026-10-14 定）。两组的组头与段头同一档 eyebrow，但转正色（`--wb-fg`），比组内的“最近”段头高一级；“页面”组上沿一条 `--wb-seam` 结构缝。project 标题行 = chevron + `library` 图标 + 标题 + 布局错误个数（danger 色，tooltip 列前三条）；文章行缩进 24，行首 `newspaper`（有画布，点了开画布视图）或 `file-text`（没有画布，点了在新标签页开文章页）。机制与数据见 `docs/projects.md`“工作台左栏”。
- **导航**：顶部两个 icon tab：“页面 / 已归档”，悬停显示名称，选中项浅灰底；左右方向键循环切换，Home / End 到首尾。左栏没有搜索框。右键归档/恢复只改变浏览器导航偏好，源文件及标注不动。
- Pinpoint 自身组件隐藏滚动条，保留滚动与键盘操作；不修改被评审内容的滚动条。
- **时间与排序**：记录添加时间、最后修改时间、最后标注时间。“最近”按三者最大值取前五页，单纯打开不改变顺序。排序 icon 打开单层菜单：名称 A–Z / Z–A、三种时间各自从新到旧 / 从旧到新，每组用分隔线隔开，最后是登记顺序（模板页在前，登记页按登记表的书写顺序）。选中项打勾，点击生效并关闭，偏好持久化。未知时间在两个方向下均排末尾；页面行显示当前排序对应时间，登记顺序与名称档显示最近变动。
- **模板页**（`content/previews/` 的范例页）默认不显示，开关在预览设置；当前页正好是模板页时它照旧显示，否则选中态没有落点。
- **frame 树**在页 tab 条的大纲浮层里：延伸线结构（14px rail 槽位、字母与导线同轴、逐行拼接、末行收 └ 角，ADR 0014），点击定位 frame，与标注列表焦点双向同步，计数徽标红 = 含失效锚点。产物 / 草稿分组跟这棵树一起住在浮层里；单 tab 的纯 doc 页没有这条，条目切换走横条的 ‹ n / N ›。
- **行状态**：行高 27，`--wb-t-row` 13/500 正色；hover = `--wb-hover` 4%；选中 = `--wb-sel`（accent 10%）+ 600 字重，正色不退灰。选中与 hover 必须一眼分得开，这是这一档的全部目的。
- **行的构件**：页面行与最近行行首一个 14px 类型图标（owner 2026-09-05 定的映射，`lib/page-groups.js` `PAGE_KIND_ICONS`）：画布 = `smartphone`、文档 = `file-text`，每一行都有，淡色、选中转正色；横条的类型标带同一个图标，两处一套词。标题从 8 + 14 + 7 = 29px 起，dir / file / 模板页一律如此。标题单行省略，行尾 11px mono tabular 淡色元数据（昨天 / 周二 / 8-31），没有值就留空不许标题借位。
- 行级动作（查看信息、复制 @page、归档、重命名）全在右键菜单，行尾不挂 hover 钮（ADR 0024）。例外一处：文章行的“阅读”钮（owner 2026-10-13 点名要“旁边有一个‘阅读’钮打开正文”）。它常态透明、不占标题宽度，行 hover 或键盘焦点进到行时才出现，这时标题让出右端 30px 再省略；同一个动作也在文章行的右键菜单里。

## 设置

齿轮进入，头部“‹ 预览”返回。行 = 56px 标签列 + 槽式分段。两段四行，按“这个设置作用在谁身上”分：

- **iOS 预览**：预览主题（Light / Dark，切被预览页面 `.ios-root` 的 `data-theme`）、机壳（无 / 有，值仍是 screen / bezel）、时间（系统 / 固定，固定时带时间输入）。三个只对 iOS kit 的内容有效，网页和文档页上没作用。
- **界面**：显示模板页（ADR 0032 的开关）。以后改 pinpoint 自己的设置都进这一段。

缩放在横条上（− / +）；画布纹理、Text 字号、锁屏字标字体是固定值，钉在标记里（`.wb-stage-wrap` 的网格、`.ios-root` 的 `data-text-size`、`<html data-lock-font>`），不进设置。手机外框在设置里叫“机壳”，因为词典里 frame 是帧。

## 画布（图纸人格）

- 双线网格 24 / 120px + sheet 外框。两档线色是 token：`--wb-grid-1` = accent 9%（120px 主线）、`--wb-grid-2` = accent 4%（24px 发丝线），`index.html` 不写字面 color-mix。没有内图框与角部十字。
- **图注三档字**（ADR 0031）：区头 13/600 正色、屏名 12/500 淡、引用号 10.5 mono accent。引用号与屏名在同一行。画布基准是 scale 0.5，所以 `--wb-cap-*` 写的是观感值的两倍（26 / 24 / 21）。
- **尺寸行**在 frame 下方居中，mono 小字，只在这一帧 hover / 选中 / focus 时出（常驻太吵）。用 opacity 不用 display，行高留着、出没不推版面。导出快照与 `/api/frame` 没有 hover 语境，那两处照常显示。
- **“···”菜单钮**跟在屏名后面，是图注那条 flex 的末位；常态透明，这一帧 hover、焦点进图注、菜单开着时才现，按钮始终在 tab 序里。
- **frame 环两档**：hover = 2px accent 30%，选中 = 2px 实心 accent + 6px accent 14% 晕，选中压过 hover。hover 环用 outline 不用 box-shadow——doc 与组件机身自带 `--wb-sh-board`，box-shadow 会把板影顶掉。section 选中 = 大标题转 accent。这两档与标注的琥珀框天然分色：环是 accent、在机身外缘，标注框是琥珀、在元素上。
- 引用法：section 用字母，frame 用数字（A1 / A2 / B3）。人对 agent 说 A2；机器引用仍走 `@frame:id`。
- 比例读法：zoom 100% 视觉为原稿一半，写作 1:2（视觉 = zoom × 0.5，0.5 烘在基准，ADR 0025）。

画布定位：frame / section、小地图、回中与标注定位共用临界阻尼弹簧（damping 1、response 0.4s；response 不是固定时长）。从静止出发平滑减速收稳；连续定位从当前画面位置承接速度转向。滚轮、指针按下、导航键、缩放与页面切换可以接管；减少动态效果时直接到位。标注定位先完成一次 frame 移动，再展开评论与高亮，不先跳 section。

## 钉子与评论卡

画布上的钉子是标注的主体表达，不是列表的缩影（ADR 0031）。

- **钉子** `.ann-badge`：22px accent 实心圆 + 白字 mono + 2px 白描边 + 投影，常显、可点，两种模式下都在。白环让它在深色屏、彩色卡、白纸上都切得出来，所以常显不打折。聚焦或 hover 时补一圈 accent 32% 外晕。
- **评论卡** `.ann-bubble`：hover 钉子 120 ms 才出（扫过不闪），离开给 90 ms 宽限，指针可以移到卡上继续读；摆在钉子右边，右边放不下翻到左边。一次只出一张。
- 卡的形状：186 宽白面 + `--wb-sh-2` + 圆角 8，11px 正文，上面一条 11px mono 眉标 = 序号（accent）+ 这条指着什么（淡色）。一次只出一张卡，所以卡上没有作者标和卡头。
- **渲染开关**默认开，三态（隐藏批注 / 叠在页面 / 右侧通道）收在弹出列表头部的“···”里。右侧通道是文档形态用的：iframe 收窄，卡摊在父级 gutter 里，此时多张卡同时在，眉标里的序号是它们与钉子之间唯一的对应。
- **弹出列表**（“这页的标注”）：头部保留标题、总数和“···”；显示方式只通过菜单选项的勾选表达，不重复显示状态。分割线下为“清空未关闭标注”和“清空无效标注”，两次确认，确认文案显示数量。清空只带走当前 page 未关闭的 open / check / done（决定 #11：close 是执行历史），已关闭的留在账本里，计数与可点性只数未关闭；清空无效只处理当前 page 所有原目标与结果目标都失效的标注；隐藏、未加载、显式删除的执行记录保留。
- 整行点击定位并打开标注，列表随之关闭。行尾动作只有收尾：open / check / done 行一颗完成勾（单击即 close，不二次确认，toast 带“撤销”回关前原态）；close 行（展开后）是“重新打开”回 open。行上没有删除，硬删只走列表头的清空与 composer 的删除钮。工作台弹层与注入侧栏 `#ann-sidebar` 的行件同款。
- **输入框**：按照目标 DOM 完整边界弹出，多目标整体避让，随滚动更新；空间不足停靠底部，不自动移动画布。正文以目标 pill 与文本混排，附图在上，正文自动增高最多十行，超出内部滚动。底部左侧 `+` 收纳改文案与移动，右侧删除图标（已有标注）、取消与黑色保存按钮；顶部不重复展示编号、section 和目标文本。整体使用白底、26px 圆角、细边框与弱阴影，输入区无独立底色或聚焦描边。引用 pill 最宽 120px，完整文本通过 hover 查看；所选意图用可移除 pill 表达。没有引用模式切换、顶部 indicator 条或拖动区。保留图片粘贴及移除。
- 输入框只在两种挂法下进 top layer：挂进原生 modal，或挂在 body（独立文档页）。在 workbench 里它留在 `.wb-stage-wrap`，按“层级”一节的阶梯排。原生 modal 内标注时，输入框保持在该 modal 的可交互子树中。关闭 modal 后恢复页面挂载。
- **执行结果**：结果 DOM 蓝框带原标注序号；增加/修改/移动/删除写入同一标注的执行记录，删除明确显示“已删除”。蓝框表示 agent 的操作位置，不表示用户接受。不做追加评论、stacked blocks 或版本历史；不满意时删除再标。
- 锚点失效 = 整卡红描边 + 红浅面 + 文本退灰 + 序号钉转红，不用 tag。

## 选中模型

- 画布点选：点 frame 图注（cap / dim 行）选 frame，点 section 大标题选 section，点板空白清选中；frame 内部点击永远留给原型交互，标注模式下选择让位给标注客户端（所以标注模式下选中的 frame 只可能是进模式之前选好的那一枚）。选中态 = 持久 accent 环 / 标题转 accent，与定位反馈的 flash 环分工。
- section 和 frame 只有标题，没有说明字段和详情浮层；画布与大纲只定位、高亮。旧字段加载时忽略。
- title 规矩：单行短名词短语；编号系统派生（A / B1）禁手写；禁“·”拼接。契约层硬拦换行，画布 caption 两行截断兜底。

## 地址栏参数（深链）

工作台的地址是 `/workbench/`（ADR 0044），参数接在它后面；生成工作台地址的代码一律用 `src/shared/workbench-url.js`（站点的浏览器端脚本用 `site/src/lib/canvas-card.js` 里对过账的字面量）。解析与生成只在 `src/workbench/lib/page-url.js`（`parseDeepLink` / `deepLinkQuery`），写回在 `src/workbench/url-sync.js`，读取在 `stage.js` 的 boot。

| 参数 | 含义 | 落地后留不留 |
|---|---|---|
| `page` | 打开哪一页；页不存在停在“页面不存在”面板（登记表一变就重新解析：登记上了直接打开，还没有就留在面板） | 留（镜像当前页） |
| `mode` | 页的 manifest 形态提示（`ios` / `html`，残留 `web` 归一到 `html`） | 留 |
| `entry` | 板内条目（画布 `@canvas` / 文档屏 id）；默认条目省略 | 留（镜像当前条目） |
| `tab` | 多 tab 页的活动 tab（ADR 0041）；第一个 tab 省略；只在这次打开生效，不写偏好 | 留（镜像当前 tab） |
| `section` | 落点 section：打开画布条目、先切到它所在的 tab，再即时定位并选中这个 section，与导航器 / 大纲点 section 同一个结果。这次打开里它赢过存档视口（缩放沿用存档）；同时给了 `tab` / `entry` 时 section 说了算；页里没有这个 id 就照常打开、`console.warn` 一条 | 不留：它是一次性落点指令，不是状态。落地后地址栏只剩 page / entry / tab，平移之后不会拿着一个已经不对的 section，刷新也不会被拽回去 |

`section` 给链接生成方用（文章页 section 卡上的“打开画布”）：`deepLinkQuery(pageId, mode, entryId, tabId, sectionId)`。

## 导出

- 单入口：底部横条的“导出”钮 → 原生 dialog（`ExportPicker.jsx`），导出整个画布为离线可交互 HTML（`<页 id>__interactive.html`，ADR 0033）。导出只收画布帧；钮在画布工具段里，文档形态（HTML 帧、doc 屏）整段收起，没有导出钮。先扫描 HTTPS 静态依赖，逐项批准后冻结；没有远程资源就直接下载。
- 可交互 HTML 不另做版式，就是这份外壳：满铺画布 + 浮动玻璃面板（大纲）+ 底部横条（面板开关 · 页名 · ‹ n/N › · 缩放 · 回中），平移 / 缩放 / 定位语义与画布相同；窄屏面板收起、帧竖排。分享面没有标注、Section Navigator、minimap 与拖宽。
- 帧和 section 的图片归 agent：`ppnt shot` 的画布截图与 `ppnt comments --mode image` 走服务端渲染（`/api/export-image`），图注（编号 + 帧名 + 尺寸）永随图；`ppnt shot <project>/<article>` 截的是文章页本身。
- 文章用文章页的链接分享，不走导出。

## 组件惯用式

页面右键菜单提供“查看信息”：白底模态，源路径或源 URL 优先展示，完整换行、可选择、可复制。其余信息为来源类型、页面 ID、登记名称（与显示名不同时）、页面链接、页面定义地址、登记文件、添加时间、最后修改时间和最后标注时间。URL 页不推断本地源码目录；内置组件库标明自动生成。关闭按钮、Esc 和点击遮罩均可关闭；查看信息不切换当前页。

- 常驻浮起的外壳表面用 F2 玻璃（见“材质”）；瞬时浮层 = 白面 + 阴影阶梯 `--wb-sh-*`，无发丝描边。
- 玻璃卡的 `backdrop-filter` 给 `position:fixed` 的后代造了包含块，卡自己又 `overflow:hidden`：卡里的菜单必须 Portal 出去，否则会被卡的下沿裁掉，DOM 断言全绿而人点不到。
- 分段 / 单选 = 槽式（灰槽 + 白面选中项）；瞬时动作组只借槽皮，不给单选态。
- ghost 优先，主行动才实心；hover / focus-visible / active / disabled 全态；过渡 ≤ 150 ms，尊重 reduced-motion。
- 危险动作两段确认：armed 红字 3s。
- 圆角全站一套阶梯（ADR 0046，`--pp-r-*` 与 `--wb-r-*` 同值）：4 槽内小按钮、芯片悬停底、行内代码 / 6 按钮、列表行、分段控件槽 / 8 工作台卡片、菜单项、卡片里的帧、代码块与错误条 / 12 文章卡片、评论线程、浮层面板、输入框 / 16 画布画板、文章画布卡、画布浮层 / 20 模态。浮动玻璃族单独一档 14（阶梯之外，只给这一族）；药丸 999 只属于 badge / tag / 计数 / 底部横条；手机机身 22 是机身形状，不进阶梯；写标注的输入框 26 是它自己的形状。
- 失败面板 = 实底 + `--wb-sh-3` + radius 14 + 标题 14/600，不用虚线框（虚线框读起来像拖放区）；它居中的是减掉 chrome 的可用区，不是整个视口。

主动点击标注跳转时，按目标 DOM（含多目标/结果目标）与 composer 的组合外接矩形，按完整画布宽度、仅扣除底栏的视野居中（侧栏开合不改变水平中心）。优先右侧并排，其次下方；空间不足保留缩放并让目标居中，composer 沿用边缘停靠。只在跳转时滚动一次，输入/换行不触发画布移动；缩略图的整帧聚焦不变。

## 服务路由（文章站点）

本机只有一个地址：文章和工作台、标注 API、`/sites/` 同在 `pinpoint.localhost`。服务按 URL 首段分流，代码在 `src/server/lib/article-routes.js`（判定）与 `src/server/article-proxy.js`（转发）。

| 首段 | 去向 |
| --- | --- |
| 不带参数的 `/` | 文章站点的 blog 首页：所有登记 project 的全部文章（ADR 0044） |
| `workbench`（`/workbench/`） | 工作台：改写成仓库根的 `index.html`；壳页带 `<base href="/">`，板里相对站点根的地址照旧解析。旧地址 `/?<参数>`、`/index.html[?<参数>]` 302 到 `/workbench/`，参数原样带上（`src/server/lib/workbench-routes.js`） |
| 登记过的 project id（registry kind `project`） | 文章站点：Astro 开发服务器，路径原样，站点不设 base |
| `_astro`（含 HMR websocket）、`_image` | Astro 开发服务器自己的 vite 内部路径与图片端点 |
| 其他一切 | pinpoint 原有的中间件链，行为不变 |

- **为什么 Astro 的内部路径在 `/_astro/` 下。** pinpoint 自己也是 vite，`/@vite/`、`/@fs/`、`/@id/`、`/node_modules/`、`/src/` 和 `/` 上的 HMR websocket 都归它。服务拉起站点时设环境变量 `PINPOINT_SITE_VITE_BASE=/_astro/`，`site/astro.config` 把它设成 vite 的 `base`，Astro 的内部路径就整体落在 `/_astro/` 下；Astro 自己的 `base` 仍是 `/`，文章链接照常写 `/<project>/<article>/`。上游请求一律带 `/_astro` 前缀，vite 剥掉前缀再交给 Astro，所以 `Astro.url` 与地址栏一致。
- **保留首段。** project id 不能取服务已占用的首段。完整列表是 `RESERVED_TOP_SEGMENTS`（同一文件），加上 `test-results-*`、`playwright-report-*`；包含 vite 按仓库根静态服务的顶层目录。单测核对仓库根的每个目录都在表里。
- **来源。** 浏览器对 websocket 不做同源限制，Astro 的 vite 只在请求带 Origin 时要 token，不看 Origin 是谁，所以挡跨站靠代理。规则在 `src/server/lib/proxy-origin.js`：Origin 是 pinpoint 自己的来源（`https://pinpoint.localhost`、`PINPOINT_ORIGIN`、portless 给的 `PORTLESS_URL`、服务直连端口上的 `127.0.0.1` / `localhost` / `[::1]`，e2e 走的就是这个）时，改写成站点自己的地址再转发；别的来源发来的 websocket upgrade 和非 GET / HEAD 请求回 403，也不拉起站点；别的来源的 GET / HEAD 照常转发，但不带 Origin，vite 就不回 CORS 头，别的网页读不到响应。没有 Origin 的请求（命令行工具）照常。
- **站点能读的文件。** 站点 vite 的 `server.fs.allow` 只放站点目录、仓库的 `node_modules` 和每个 project 的 `docs/pinpoint/`（`site/astro.config.mjs`）。`/_astro/@fs/<绝对路径>` 读 project 根下的其他文件、或仓库里的源码，都回 403。
- **注入。** 文章页的 HTML 响应注入标注客户端，与 `/sites/` 同一份 `injectAnnotateClient`，entry 是这篇的页 id `<project>_<article>`，带 `__pinpointProse`，客户端只跑正文评论；project 首页、wiki 页不注入；`?annotate=off` 单请求不注入；非 HTML 原样透传。
- **生命周期。** 第一次有文章请求时才拉起站点（`src/server/lib/site-dev-server.js`）：命令默认 `npm run -s site:dev -- --port {port} --host 127.0.0.1 --ignore-lock`，`PINPOINT_SITE_CMD` 覆盖；端口默认 4530，`PINPOINT_SITE_PORT` 覆盖；日志在 `<数据根>/logs/site-dev.log`。站点死了按退避自动重启；连续两次没就绪就退出，或 60 秒内退出五次，就停在 failed，之后的文章请求每 5 秒最多重试一次。服务停时整个进程组一起停。端口上已经有服务在答时直接用它。
- **站点没就绪时。** 浏览器打开文章拿到一张“站点启动中”页（503，每秒自动刷新）；起不来时那张页写原因、命令、日志路径和日志末尾（502，每 5 秒重试）。`pinpoint status` 有一行“文章站点”：没拉起过是正常，起不来算失败。
