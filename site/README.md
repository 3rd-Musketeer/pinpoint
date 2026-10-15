# site/：文章站点（Astro）

渲染首页（全部文章）、文章页、project 首页、wiki 页和 `llms.txt`。内容不在这里：站点读 registry 里登记的 project（`kind: "project"`），每个 project 的内容在 `<project 根>/docs/pinpoint/`（结构见 [`docs/projects.md`](../docs/projects.md)“目录”）。这里只放站点代码。

## 跑起来

```bash
npm run site:dev      # http://127.0.0.1:4530，PINPOINT_SITE_PORT 改端口；registry 取 PINPOINT_REGISTRY，否则 ~/.pinpoint/registry.json
npm run site:build    # 产物在 site/dist/；PINPOINT_SITE_OUT、PINPOINT_SITE_CACHE 改产物与缓存目录
npm run test:site     # 用 site/fixtures/ 构建两遍：路由、[[ ]] 解析、空 ref、撞名报错
```

pinpoint 服务这样拉起：`PINPOINT_SITE_VITE_BASE=/_astro/ npm run -s site:dev -- --port <端口> --host 127.0.0.1 --ignore-lock`。

- `--ignore-lock`：Astro 7 检测到 agent 环境会自己转后台并退出，服务要的是它管得住的前台子进程。agent 手动起 dev 也要带上。脚本里不内置这个参数，重复传会让 Astro 读成数组、判定失效。
- `PINPOINT_SITE_VITE_BASE`：服务自己是 Vite，占着 `/@vite/`、`/@fs/`、`/@id/`、`/node_modules/` 和根路径的 HMR socket。设了它，Astro dev 的内部资源和 HMR 都走 `/_astro/…`；页面 URL 仍是 `/<project>/…`（`astro.config.mjs` 里的中间件把 base 外的请求补上前缀）。站点 `base` 始终是 `/`。

每个站点进程的 Astro root 是 `site/.astro-cache/<端口>/`（build 是 `site/.astro-cache/build/`），代码照旧从 `site/src` 读。Astro 把 dev 的内容库（`.astro/data-store.json`）和生成的类型固定放在 root 下；同一个 checkout 起两个站点（e2e 两组、隔离运行、owner 的服务）时，各自的端口各自一份，不会读到别的 registry 的内容。

开发服务器启动时把站点目录、仓库的 `node_modules` 和各 project 的 `docs/pinpoint/` 加进 Vite `fs.allow`，project 根下的其他文件和仓库源码不经 `/@fs/` 服务；之后新登记的 project 要重启 dev 才能加载其中的静态资源。内容文件和 registry 改了会自动重载；registry 重载后 loader 把新登记的 project 目录也加进监听（`src/lib/loaders.js` 的 `watchAll`），所以站点起来之后才登记的 project，新建的文章同样一秒内可读。重读一次只跑一个，跑的时候来的改动攒到跑完再读一遍；加进新目录后也再读一遍，接住加进监听之前就写好的文件。刚写好的文章可能先有零点几秒是 503“内容同步中”：Astro 的内容库写盘后立即生效，渲染模块表（`.astro/content-modules.mjs`）只靠文件 watcher 刷新，这段时间里 `render()` 会抛错，文章页认出这种情况回 503 并自动刷新（`src/lib/render-article.js`）。

## 路由

| URL | 内容 |
| --- | --- |
| `/` | 首页：所有登记 project 的全部文章，最近改过的在前；每条标题、summary、project 小标签（进 `/<project>/`）、日期。排序规则见 `docs/projects.md`“首页” |
| `/<project>/` | project 首页：这个 project 的文章列表、wiki 词条、空 ref 列表 |
| `/<project>/<article>/` | 文章：顶栏从“全部文章”起、不显示 project 标题，project 是标题下的小标签，标签页标题只有文章标题；左目录（sections）、正文、右评论栏（`[data-pp-rail]`，经 pinpoint 打开时由注入的标注客户端填，见 `docs/annotation.md`“正文评论”）、wiki 抽屉 |
| `/<project>/wiki/` | 这个 project 的 wiki 词条列表 |
| `/<project>/wiki/<名字>/` | wiki 词条：状态、定义、正文、用到它的文章。旧地址 `/<project>/concepts/<名字>/` 由服务 301 到这里（`src/server/lib/article-routes.js`），不经站点 |
| `/<project>/llms.txt` | agent 视图：全部文章 MDX 原文（保留 `[[ ]]`）与 wiki 词条 |

article id `wiki` 和 `concepts` 保留给 wiki 路由，用了构建报错。

## 写文章（`articles/<id>/index.mdx`）

frontmatter：`title`（缺省用 id）、`summary`（导语，也是 popup 和列表里的一句话）、`order`（project 首页的列表次序，可省）、`date`（`YYYY-MM-DD`，首页按它排，可省）。

下面三个组件不用 import，站点自动提供：

- `<Section id="flow" title="付款前的确认">…</Section>`：一节。`id` 必填，字母数字 `_` `-`，文中唯一，就是 DOM id（`#flow`）和画布视图里这一行的 id。节号 1、2 … 按出现顺序自动编，目录和节标题前的号码从这里来。画布上同一节是字母（第 n 节 = 第 n 个字母，A、B …），字母只出现在画布、`ppnt` 和标注里，文章页不显示。不能嵌套。
- `<Canvas frames={["ask", "confirm"]} />`：这一节的画布组件，在文章页上显示成一张画布卡片。写在 `<Section>` 里，一节最多一个。帧 id 是本篇目录下的 `<帧 id>.jsx` 或 `<帧 id>.html`，不能写 `<页 id>/<帧 id>`；project 根下别处的 HTML 页面写成 `{ id: "catalog", src: "skill/preview.html" }`，`project.json` 的 `sources` 登记的目录下写成 `src: "skill:preview.html"`（HTML 帧，规则见 `docs/projects.md`“HTML 帧”）。`shell="comp"` 这类非手机机壳按帧自己的盒子显示。一张卡片里所有帧同一个缩放（手机机壳 438 px 显示成 158 px），组件帧和旁边的手机按真实比例比。卡片头显示节号、节标题与帧数，图注只有帧 id，每帧一个懒加载 iframe（`/api/frame?page=<页 id>&screen=<帧 id>&annotate=off&embed=card`），卡片里的缩略图不能点、不能标注。点帧、点“打开画布 →”都在文章上打开整张画布的浮层（见下），定位到这一帧 / 这一节，不跳转；修饰键或中键点“打开画布 →”照常在新标签页开画布视图（`/workbench/?page=<页 id>&section=<节 id>`）。该节画布上有待验收的标注（open / check / done）时头部显示“N 条标注”，读不到标注就不显示；注入的正文评论客户端经 SSE 跟着账本改动，数字不刷新就变。画布错误只显示一次：属于某一节的（跨页引用、缺帧……）列在那张卡片里，页级的（frontmatter、写在 `<Section>` 外的 `<Canvas>`……）在页顶错误条，这时那个 Canvas 不出卡片。缺源文件的帧照占位置，显示占位格“缺帧 <id>”。画布错误也是 project 错误，所以生产构建会失败，开发服务器照常显示。有画布节的文章，顶栏多一个“画布视图”，同样在文章上开浮层，从正在读的那一节开（它没有画布就取后面第一个有画布的节）。直接打开的画布视图（首页“工作台”、工作台左栏）左上角有“← 文章标题”，回到文章页，带画布当前节的锚点（`#<节 id>`）。卡片根节点是 `[data-pp-canvas]`，节 id 在 `data-pp-section`（`data-section` 只属于 `<Section>`）。有 HTML 帧的卡片，头部多一个“手机 / 桌面”开关（`[data-pp-width]`，缺省手机），HTML 帧按 402 或 1280 宽排版、只露第一屏，卡片根节点的 `data-doc-width` 是当前宽度（`phone` / `desktop`）。HTML 帧的 iframe 经 `/api/frame` 跳到页面自己的地址（`/sites/<页 id>/…?annotate=off`），所以页面里的相对资源由 pinpoint 服务给，不经 Astro 的 `/@fs/`。
- `<Figure src="figures/message-flow.jsx" caption="…" />`：正文里的图，静态示意图和可交互演示都用它，节里节外都能写。源文件在文章目录的 `figures/` 下，pinpoint 像编帧一样编它；文章页上是一个占满正文栏宽的懒加载 iframe（`/api/frame?page=<页 id>&figure=<图 id>&embed=figure`），高度跟着图的内容，没有滚动条，可以点、可以操作，深浅色跟着文章页切换。图注在图下面。图的错误显示在图的位置，不进画布卡片和页顶错误条；它们也是 project 错误，生产构建会失败。图和图注里选字不出评论。写法、调色板、逐步演示与错误见 `docs/projects.md`“图”。

## `[[ ]]` 引用

- `[[名字]]`：本 project 的 article（按 id）或 wiki 词条（按 `name`，代码里叫 concept）。两者共用命名空间，撞名构建失败（dev 下页面顶上显示错误）。
- `[[project:名字]]`：别的 project；前缀不是已登记的 project id 时，整串当名字。
- `[[名字|显示文字]]`：换显示文字。
- 样式：已有页的引用是强调色字加左侧实心圆点，不画下划线，悬停和键盘焦点时加强调浅底；找不到目标的是空 ref：灰字、虚线下划线、空心圆点，虚线是两者的区分。
- 找不到目标的是空 ref：列在 project 首页、`llms.txt` 和文章的 wiki 抽屉里。首页和 `llms.txt` 的列表出自同一个函数（`site-data.js` 的 `projectEmptyRefs`），文章和 wiki 词条正文里写的都算。代码里的 `[[ ]]` 不解析。

popup：article 显示标题、摘要、读全文；wiki 词条显示定义、状态、用到它的文章；空 ref 显示“空 ref”标记和一句说明（`client.js` 里的界面文案）。

- 打开：鼠标悬停 120 ms，或键盘 Tab 到 ref 上。指针移进 popup 不关；离开 ref 和 popup 200 ms 后关。Esc 关。同时只有一个。
- 点击：有目标页的 ref（article / wiki 词条）直接去那一页；修饰键照常开新标签页。空 ref 点击打开 popup。
- 触屏没有悬停：点一下先开 popup，再点同一个 ref 才去那一页（popup 里也有链接）。
- popup 挂在 `document.body` 上，不进 `#article`：正文评论客户端监听 `#article` 的 DOM 变动，挂进去每次悬停都会整篇重画。

## 画布浮层

从文章进画布不跳页：顶栏“画布视图”、卡片“打开画布 →”、卡片里点帧、右栏的画布标注卡片，都在文章上开整张画布的浮层（`CanvasOverlay.astro` + `lib/canvas-overlay-client.js`，owner 2026-10-15 定）。关掉回到打开前的滚动位置。

- 内容：一份嵌入版工作台，`/workbench/?page=<页 id>&section=<节 id>&embed=overlay`（`canvas-overlay.js` 的 `embedCanvasSrc`）。画布上能做的这里都能做：交互、标注、平移、缩放、大纲、标注列表。嵌入版不出左栏、左栏开关和“← 文章标题”（`src/workbench/embed.js`，样式挂在 `html.wb-embed`）。第一次打开时装上，关了也留着，再开不重装，直接定位。
- 头部：节号、节标题（跟着画布当前所在的节换）、“整页打开”（离开正文，同一标签页开画布视图的这一节）、关闭。
- 定位：节由地址里的 `&section=` 落点（再开时调 `workbench.focusSection`）；从帧进来再 `workbench.focusFrame` 到那一帧；从右栏的画布标注进来，等画布标注客户端水合完、认得这个 `#n`，再 `pinpoint.goToMark` 跳过去并打开它，与工作台标注列表点行同一条路。工作台或账本 20 秒内没好就只开着画布，不再定位。
- 地址：`#canvas=<节 id>[&frame=<帧 id>][&ann=<#n>]`（按 URLSearchParams 解析，`canvas-overlay.js` 的 `canvasHash` / `parseCanvasHash`）。打开时压一条历史，后退就关，前进再打开。直接带这个 hash 打开文章（刷新、分享）也会打开浮层，这时关闭只去掉 hash，不离开文章。画布里换了节（平移、大纲、定位），停稳 300 ms 后用 replaceState 把 hash 和头部换成那一节，不多压历史。旧地址 `#overlay=<节 id>[&frame=<帧 id>]` 照样打开，打开时改写成 `#canvas=`。
- 关闭：Esc、点面板外的暗色区域、关闭按钮。焦点在画布里时，Esc 先归画布里的那一层（标注框、标注列表、大纲、菜单、对话框、导航器、标注模式），没有这些层时工作台经 `postMessage`（`source: "pinpoint-workbench"`，同源）请文章页关浮层；画布选中不算一层。关闭后焦点回到点开它的入口。
- 打开期间：焦点困在浮层里（首尾哨兵把 Tab 绕回来，画布 iframe 是其中一站），页面不滚动（`html.pp-ov-lock`）。
- 手机宽度（≤ 600 px）：整屏 sheet。
- 浮层是 `document.body` 下的 `<dialog data-pp-overlay data-pp-nocomment>`，不在 `#article` 里；在浮层头选字不出正文“评论”。
- 浮层里做的标注进这篇的 `@canvas` 账本，右栏和卡片头的标注数经 SSE 跟着出现。

## 弹层与 Esc

`lib/layers.js` 是文章页的弹层栈：popup、浮层打开时各压一层，Esc 在 document 捕获阶段交给最上面一层，关掉它并 `preventDefault`。浮层打开时收起 popup。注入的正文评论客户端（`src/client/prose-comments.js`）见到 `defaultPrevented` 的 Esc 不动；草稿只在焦点就在草稿框里时被 Esc 取消，所以关 popup 不会扔掉写了一半的评论。

## wiki 词条（`wiki/<名字>.md`）

frontmatter：`name`（缺省用文件名，`[[ ]]` 按它解析）、`status`（占位 / 收敛中 / 已固定）、`boundary`（一句边界；缺省取正文第一段）。字段规则与解析器在 `docs/projects.md`，站点只用 `listProjects` 读出的值。词条页地址用文件名：`/<project>/wiki/<slug>/`。正文里也能写 `[[ ]]`。

## 样式与正文排版

- 颜色、字体、字号、圆角、正文尺度都是 `--pp-*`，来自生成的 `src/styles/tokens.css`（源 `scripts/tokens/source.mjs`，`npm run build:tokens`）；`site.css` 不写颜色字面量。值与写法的正典是 `docs/design.md`“色彩”“字体与排印”和“组件惯用式”的圆角一条。
- 引入顺序（`Base.astro`）：`layers.css`（声明 `@layer base, prose`）→ `tokens.css` → `vendor/tailwind-typography.css`（Tailwind Typography 0.5.20，MIT，原样入库）→ `site.css`。组件规则不分层，总能盖过正文规则。
- 文章页、wiki 词条页的 `<main>` 带 `pp-prose`；画布卡片、图、页顶错误条带 `not-prose`。新组件放进正文里时也加 `not-prose`。
- 表格：渲染时 `src/lib/rehype-table-scroll.js`（`astro.config.mjs` 的 `rehypePlugins`）给每个 `<table>` 包一层 `.pp-table-scroll`。表格是宽块：不受 40em 行宽限制，最宽到正文栏（与画布卡片对齐）；按内容取宽，窄表不撑满，宽表放不下才横向滚动；表头和首列不折行、首列 sticky；有长格的列加 `.wrap`（文字区最窄 9em、宽裕时 12em），其余列不折行；整列是数字的列加 `.num` 右对齐。

## 代码地图

- `src/lib/projects-source.js`：站点进服务端代码的唯一入口。读 registry / project 用服务与 CLI 共用的 `loadRegistry` + `listProjects`（`src/server/lib/projects.js`），画布卡片的数据用 `articleCanvas`（`src/server/lib/article-board.js`，契约见 `docs/projects.md`“画布视图”）。文章的 title、summary 与 wiki 词条的 name、slug、status、boundary 都取它的结果，不取 Astro 自己的 YAML 解析。id 规则、`refKey`、节字母这类纯规则从 `src/shared/project-ids.js` 取；浏览器端脚本只 import `src/lib/` 下的文件（`fs.allow` 不放仓库源码）。
- `src/lib/loaders.js`、`src/content.config.js`：三个内容集合 projects / articles / concepts（concepts 是 wiki 词条）。
- `src/pages/[project]/[article]/index.astro`：文章页。正文末尾的 `<div data-pp-article-end hidden>` 是正文结束标记：`ppnt shot` 截到的页面里没有它，就判定正文中途断了（渲染出错），提示跑 `ppnt check`。
- 仓库 `src/shared/remark-pinpoint.js`：`[[ ]]` → `<Ref>`，`<Section>` 编节号，给 `<Canvas>` 注入所在节的 id 和节号。哪一节、第几节由 `src/shared/article-structure.js` 决定，服务端派生画布视图用的是同一个走法：文章第 n 节就是画布视图上的第 n 个字母，节号和编号对得上。`ppnt check` 编正文用的是同一个步骤；它不读盘，文件属于哪个 project 由调用方给（`astro.config.mjs` 传 `projectIdForFile`，经 `projects-source.js`）。
- 仓库 `src/shared/refs.js`：解析、跳过代码（围栏与行内代码，和 remark 步骤同口径；`ppnt check` 报空 ref 用同一份）、命名空间检查、引用的 HTML（纯函数，有单测）。名字按 `refKey` 比较（不分大小写），与 `listProjects` 的撞名检查一致。站点和 `ppnt check` 都从这里取。
- `src/lib/site-data.js`：页面用的索引（used-by、空 ref）。
- `src/lib/site-errors.js`：布局错误在站点上怎么显示。错误从 `listProjects` 到内容集合一路是对象（`src/shared/project-errors.js`），这里拼成 `project "<id>": …` 一行；文章页的错误条按 `path` 分出这篇自己的错误。
- `src/lib/canvas-card.js`：卡片模型、URL 与标注数（纯函数，有单测）；`canvas-card-client.js`：浏览器端量帧尺寸（只认嵌入帧页的 `data-pp-stage`）、画卡片头的标注数（自己读一次账本，之后听正文评论客户端发的 `pp:canvas-ledger`，浮层关上时再读一次）。
- `src/lib/figure.js`：图的模型与 URL（纯函数，有单测）；`figure-client.js`：浏览器端按图页报上来的高度设 iframe 高度、记图的状态；`components/Figure.astro`：图的外壳。`remark-pinpoint.js` 给每个 `<Figure>` 注入序号 `n`，模型按它从 `articleCanvas` 的 `figures` 取这个图。
- `src/lib/canvas-overlay.js`：浮层的 hash、嵌入版工作台的地址与消息、顶栏入口取哪一节（纯函数，有单测）；`canvas-overlay-client.js`：浮层的浏览器端；`components/CanvasOverlay.astro`：浮层空壳，经 `Base.astro` 的 `overlay` 槽放在 `#article` 之外。
- `src/lib/layers.js`：弹层栈（Esc 只关最上层）。`src/lib/client.js`：深浅色、目录高亮、`[[ ]]` popup、wiki 抽屉。
