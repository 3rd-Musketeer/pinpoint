# CONTEXT — pinpoint 词汇表

pinpoint 是一个本地服务：agent 把设计写成文章，owner 和其他读者在浏览器里读文章、看文章里的界面帧，owner 用评论和标注把反馈交回 agent。本文给每个词一条定义。

每条的格式：**词** · 它住在哪个文件或符号 · 定义 · 要避开的说法。两个人（或两个 agent）对同一个词理解不同时，以本文为准；发现新词或新歧义就补一条。代码和 CLI 里有些名字与这里的词不同（`page`、`screen`、`entry`），对应关系写在各条里。

## 文章模型

文章是主体，project 是装一批文章的容器。一篇文章由若干 section 组成；section 里可以放一个画布组件和图，画布组件列出这一节的帧，帧是一个 JSX 文件或一整份 HTML 页面。文章有两个看法：读者在文章站点上看的文章页，和在工作台里集中修改用的画布视图。工作台另外还装着存量页，那是文章模型之外的原型页，相关的词放在本文最后一节。

**project（项目）** · `<project 根>/docs/pinpoint/project.json`；读取 `src/server/lib/projects.js` 的 `listProjects`
装一批相关文章和 wiki 词条的容器：承载信息的是文章，project 只负责把它们归在一起（ADR 0044）。读者面前不显示 project 的标题，只在 blog 首页和文章标题下放一个小标签，点进 `/<project>/` 这个 project 的文章列表；所以 title 只写短名字（Vault、Areta browser use），不写成一句描述。id 是所有网址的第一段：`/<project>/`（project 首页）、`/<project>/<article>/`、`/<project>/wiki/<slug>/`、`/<project>/llms.txt`。写文章不用先挑 project：`ppnt new article <article>` 把文章建进默认 project `notes`（owner 机器上在 `~/workspace/mori-ws/notes/`；没登记时命令先建好它，位置见 `docs/registry.md`“默认 project `notes`”，ADR 0045），要归类时 `ppnt mv notes/<article> <project>/` 连标注一起搬。主题已有 project 时直接 `ppnt new article <project>/<article>`。project 住在它所属的仓库或 topic 里，用 `ppnt new project <根>` 建出骨架并登记一次（手写的 project 用 `pinpoint add <根> --project` 登记），之后加文章不用再登记。
要避开：拿 project 指存量页或 board；把 project 当成文章的上级主题去写导语或描述。

**article（文章）** · `<project 根>/docs/pinpoint/articles/<article id>/index.mdx`
一篇设计文档，写成 MDX，形态像 blog post，任何人拿到链接就能读。文章是 owner 与 agent 对齐设计的权威：task 和 ADR 是它的投影，实现时改了机制就回来改文章。一篇文章的帧、组件、样式和资源都放在自己的目录里。
要避开：拿 doc 指文章（doc 是存量页的一种舞台形态）；拿“页”指文章（页 id 是文章的一个地址，见下）。

**文章页** · 网址 `/<project>/<article>/`；渲染在 `site/`（Astro）
读者读一篇文章的网页：左边是目录，中间是正文和画布卡片，右边是评论栏。目录和节标题前显示节号 1、2、3。顶栏左边是回首页的“全部文章”，不显示 project 标题；project 是标题下的小标签。浏览器标签页的标题只有文章标题。顶栏的“wiki”打开 wiki 抽屉，列出本篇引用的 wiki 词条和空 ref；有画布的文章，顶栏还有“画布视图”。
要避开：把文章页和画布视图混称“文章画布”。

**首页（全部文章）** · 网址 `/`；`site/src/pages/index.astro`，排序 `src/shared/article-feed.js`
blog 式的文章列表：所有登记 project 的全部文章，最近改过的在前（frontmatter 写了 `date` 用它，否则用 `index.mdx` 的修改时间）。每条是标题、summary、所属 project 的小标签和日期。顶栏的“工作台”进工作台。
要避开：拿“首页”单指 project 首页 `/<project>/`（那是一个 project 的文章列表，说“project 首页”）。

**section（节）** · `index.mdx` 里的 `<Section id title>`；结构由 `src/shared/article-structure.js` 的 `articleStructure` 数出
文章正文的一节。带画布组件的节同时是画布视图里的一行，两者是同一个东西：同一个 id，同一个顺序。`id` 在本篇内唯一，也是网页锚点和画布视图的定位参数 `&section=<id>`。纯文字的节只出现在文章页，不进画布视图。
要避开：“区”“段”“group”；拿 section 指 `##` 小标题（小标题不是节，不占节号）。CLI 帮助里写作“段”（`段 B`、`段 id`）。

**section 组件** · 站点提供的 MDX 组件，写在 `<Section>` 里，不用 import
放进一节里的非文字内容：画布组件 `<Canvas>` 和图 `<Figure>`。图也能写在节外。
要避开：不加“section”只说“组件”——单说“组件”指帧用的 JSX 组件，见“组件”。

**画布组件（`<Canvas>`）** · `index.mdx`：`<Canvas frames={["a", "b"]} shell="app" />`
一节里的帧清单：列出这一节有哪些帧、什么顺序、套什么机壳（`shell`：`app` 手机、`lock` 锁屏、`doc` 整份文档、`comp` 裸组件）。一节最多一个。画布视图里一行的成员和顺序只写在这里。
要避开：拿 Canvas 指整个画布视图。

**图（`<Figure>`）** · `index.mdx`：`<Figure src="figures/<图 id>.jsx" caption="…" />`；源文件 `articles/<article>/figures/<图 id>.jsx`（可选同名 `.js`、`.css`）
正文里的一张示意图或一个可交互演示，由 agent 自己画（通常是内联 SVG），讲一件事怎么运转。文章页上它占满正文栏宽，是一个同源 iframe（`/api/frame?page=<页 id>&figure=<图 id>&embed=figure`），高度跟着内容，可以点，深浅色跟着文章页。颜色只用调色板 `--fig-*`；逐步演示用 `pinpoint/figure` 的 `steps()`。图不是帧：不进画布视图，没有编号，不能做画布标注，图里和图注里也不出正文评论。图的错误（缺文件、属性写错、编译失败、运行时报错）显示在图的位置，`ppnt show <project>` 也列出它们。
要避开：拿“帧”或“画布”指图；单说“图”指画布卡片里的帧缩略图或 `ppnt shot` 的截图。

**帧（frame）** · `articles/<article>/<帧 id>.jsx` 或 `.html`
画布上的一格，也是装这一格内容的源文件。帧通常是一个 JSX 文件；也可以是一整份 HTML 页面（HTML 帧），放在本篇目录下，或用 `{ id, src }` 指向 project 根下别处、或 `project.json` 的 `sources` 登记的目录下的文件。卡片缺省按手机宽 402 排这个页面，卡片头的“手机 / 桌面”开关切到桌面宽 1280；画布视图里它是一个文档条目，不在画布那一行。帧 id 就是文件名（不带扩展名），HTML 帧用 `{ id, src }` 写时是 `id`，不变；它同时是标注的锚点，所以已有的帧不改名。一个界面状态画一帧；同一个界面的几种做法就在同一节里并排放几帧，选定后删掉落选的。
要避开：拿 frame 指 iframe（卡片里的 iframe 只是显示手段）；“屏”。代码里同一个东西叫 screen：`screenId`、`/api/frame?screen=`；`@frame:<页 id>/<帧 id>` 是帧的引用写法。

**组件** · `articles/<article>/components/<Name>.jsx`（本篇）、`content/kits/ios/jsx/`（kit）
帧 import 的 JSX 函数：输入 props 和 children，输出 HTML，没有状态、事件和副作用（文档里也叫“印章”）。帧写 `./components/X.jsx` 时找本篇；kit 的组件写 `pinpoint/kit`。跨文章复用的组件放进 kit。没有 project 级的组件：project 里有 `docs/pinpoint/components/` 目录时，它不参与编译，`ppnt check` 报布局错误 `project_components_dir`（ADR 0045）。
要避开：拿“组件”指 section 组件或工作台自己的 React 组件（后者说“工作台组件”）。

**画布卡片** · 站点 `site/src/components/Canvas.astro`，DOM 根 `[data-pp-canvas]`
画布组件在文章页上的样子：每个有画布组件的节一张卡片，头部是节号、节标题、帧数和这一节待验收（open / check / done）的画布标注数，下面是这一节的帧缩略图。缩略图不能操作、不能标注。点一帧打开这一帧的预览（画布浮层的单帧形态），点卡片头的“打开画布 →”打开整张画布、定位到这一节。
要避开：把卡片说成“嵌入的画布”或“截图”——卡片里的帧是实时渲染的，但只是看。

**画布浮层** · 站点 `CanvasOverlay.astro`；地址 `#canvas=<节 id>[&frame=<帧 id>][&view=frame][&ann=<#n>]`
在文章页上打开的整张画布视图：里面是一份嵌入版工作台（`?embed=overlay`，没有左栏），能交互、标注、平移、缩放，Esc 或关闭按钮回到正文原来的滚动位置，不离开文章页。顶栏“画布视图”、卡片“打开画布 →”、右栏的画布标注打开它。带 `view=frame` 时是**单帧预览**：卡片里点一帧打开，只看这一帧（HTML 帧是它的页面浮层，iOS / 组件帧单独放大），头部“看整张画布”切到整张画布。
要避开：单说 overlay（board-schema 里 overlay 指 iOS 的 sheet、tabbar，标注客户端里 `#ann-overlay` 是钉子层）。

**画布视图** · 工作台 `/workbench/?page=<页 id>`，加 `&section=<节 id>` 落到那一节；board 由 `src/server/lib/article-board.js` 的 `deriveArticleBoard` 从正文派生
一篇文章的全部带画布的节按行排开的那张大画布，一行一节，用来集中修改和做画布标注。它由 `index.mdx` 自动生成，作者不写 board.json。工作台左栏的文章行打开它；文章页顶栏的“画布视图”和卡片的“打开画布 →”在文章上以画布浮层打开它，修饰键点才在新标签页整页打开。直接打开时左上角有“← 文章标题”回正文。没有画布节的文章没有画布视图。
要避开：“画布页”“文章画布页”“文章画布”（指同一个东西，统一说画布视图）；拿“页”单指它；单说“画布”而不说明是画布组件、画布卡片还是画布视图。

**页 id** · `src/shared/project-ids.js` 的 `articlePageId(projectId, articleId)`
工作台和标注桶用的地址。一篇文章的页 id 是 `<project>_<article>`（如 `browser-use_payment-confirm`）：画布视图用它打开（`/workbench/?page=`），这篇的画布标注和正文评论都进它的桶。`ppnt` 里文章写成斜杠形 `<project>/<article>`，页 id 也认，输出一律打斜杠形（见“引用地址”）。没有画布的文章也有页 id，正文评论照样进它的桶。project id 和 article id 都不含 `_`，所以拆分无歧义。存量页的页 id 是它自己的 id。
要避开：拿 project id 当页 id（project 本身没有桶）。代码和 CLI 里它叫 page / entry：`@page:`、`?page=`、`pageId`、标注字段 `entry`、`?entry=`、`window.__pinpointEntry`。代码里的 `entry` 还指 board 条目和 registry 条目，在存量页一节。

**节号与编号** · 节号由 remark 步骤 `src/shared/remark-pinpoint.js` 编；编号由 `src/workbench/lib/board-refs.js` 的 `boardRefs` 现算
两套给人看的号，按同一个顺序数：
- 节号是文章页上的 1、2、3：目录、节标题、画布卡片和浮层头部用它。
- 编号是画布视图、`ppnt` 和标注里的字母加数字：节字母 A、B、C，帧在节内从 1 数，拼成 A1、B3。

第 n 节就是第 n 个字母：全部节一起数，纯文字的节也占一个号和一个字母（这个字母在画布视图里没有对应的行），所以第一节是纯文字时，画布视图从 B 开始，B2 是文章第 2 节的第 2 帧。两套号都随增删、调序变化，所以当场对话用号，留存的文字（README、交接稿、验收记录）写 id：节 id、帧 id，或“D2（c1b-detail-time）”。对照用 `ppnt show <project>/<article>`：每节一行节号、字母、节 id，下面是帧的编号和帧 id。
要避开：把 id 起成编号的样子（`c1b-detail`）；在文章正文里写字母编号；“图纸号”“引用号”“canvas ref”（都指编号）。CLI 的 `<引用>` 参数比编号宽，`#12`、`§2`、帧 id 也算，见“引用地址”。

**wiki 词条** · `<project 根>/docs/pinpoint/wiki/<slug>.md`；词条页 `/<project>/wiki/<slug>/`，词条列表 `/<project>/wiki/`
一个词的定义：短，带状态（占位 / 收敛中 / 已固定）和一句边界，被多篇文章引用。`name`（frontmatter，缺省用文件名）是显示名和 `[[ ]]` 的解析键，文件名是网址里的 `slug`。界面上一个 project 的全部词条合称 wiki（project 首页的“wiki”、文章页顶栏的“wiki”抽屉、`ppnt list` 的“N 条 wiki”）。词条只从 `wiki/` 读：project 里有 `concepts/` 目录时 `ppnt check` 报布局错误 `wiki_dir_renamed`；地址 `/<project>/concepts/<slug>/` 301 到 `/<project>/wiki/<slug>/`（ADR 0045）。代码里仍叫 concept：`project.concepts`、`kind: 'concept'`、`CONCEPT_STATUSES`、内容集合 `concepts`。
要避开：把 wiki 词条叫文章的一种（它没有节和画布）；在界面和文档里再说“概念”“concept 页”。

**`[[ ]]` 引用与空 ref** · `src/shared/refs.js`；比较键 `refKey`
`[[名字]]` 在正文里指向本 project 的一篇文章（按 article id）或一条 wiki 词条（按 `name`）；两者共用一个命名空间，不分大小写，撞名是布局错误。`[[名字|显示文字]]` 换显示的字，`[[project:名字]]` 指别的 project。指向的东西还不存在时是空 ref：合法，显示成虚线，project 首页列出全部空 ref，用来梳理还缺哪些词条和机制。鼠标停在引用上弹出卡片：文章显示标题和摘要，wiki 词条显示定义和状态，空 ref 的卡片说明目标不存在。
要避开：把空 ref 当错误去删。

**画布标注** · 画布视图上的标注客户端 `src/client/annotate.js`；账本 `@canvas.json`
owner 在画布视图里按 A 进标注模式，点选或圈选帧里的元素（这些元素是这条标注的目标），hover 时元素高亮，写下的标注钉在元素上；标注可以带意图（改文案、移动、参考图）。锚点是编译产物里的 `data-pp-id`（源文件:行），所以 `ppnt comments` 和 `ppnt locate` 能直接给出源码位置。HTML 帧上的标注是文档页标注，见下一条。每条标注都有线程：agent 改完用 `ppnt mark … done --note "<改了什么>"` 一步回复并写状态，owner 在工作台的标注列表和标注框里看到。画布标注只在画布视图里做；文章页的卡片和浮层上不做。
要避开：“批注”；把正文评论也叫画布标注。

**文档页标注** · 同一个标注客户端；账本按页面路径分本（`<文件>~<hash>.json`，规则在 `src/shared/annotate-page-key.js`）
钉在一整份 HTML 页面里的元素上的标注：文章的 HTML 帧在画布视图里是一张卡片，owner 双击它开页面浮层、按 A 标注；存量页的文档条目（`shell: "doc"` 的屏、HTML 文件页）也是这样。HTML 帧不编译，没有 `data-pp-id`，锚点是元素的 CSS 路径加元素文字；`ppnt comments` 把它归到所在的帧下面，摘录给出那份 HTML 源文件和行。改它就改那份 HTML：本篇目录下的 `<帧 id>.html`，或 `{ id, src }` 指向的文件。线程、`#n` 和状态机与画布标注相同。
要避开：以为它只属于存量页；去找 dist 里的产物改（HTML 帧没有 dist）。

**正文评论** · 文章页上的 `src/client/prose-comments.js`；账本 `@prose.json`；字段 `type: "prose"`
owner 在文章页上选中一段正文写下的评论，出现在右边评论栏。锚点是引文（选中文字加前后文），正文改了以后每次按引文重新定位，找不到就标“失效”：这是显示标记，不是状态，失效的评论照常回复、写状态。每条评论是一个线程：owner 的第一句加之后 owner 与 agent 的来回；agent 改完用 `ppnt mark … done --note "<回复>"` 一步回复并写状态，只回复不改状态用 `ppnt reply`。
要避开：把“失效”说成已解决；把正文评论叫“文档页标注”（那是钉在 HTML 页面元素上的标注）。

**标注队列** · 一个桶里的全部条目
同一篇文章的画布标注、文档页标注和正文评论排在一个队列里：一套 `#n` 序号、一个状态机，`ppnt comments <project>/<article>` 一次列出全部。CLI 和字段名里“标注”泛指队列里的每一条；只说其中一种时写“画布标注”“文档页标注”或“正文评论”。
要避开：以为每种各有各的序号。

**标注状态** · 状态色 `src/shared/ann-status.js`；转换校验在服务端
每一条有四态：open（owner 写下）→ check（agent 看了、不改）或 done（agent 改完）→ close（owner 点完成，可撤销）。agent 只经 `ppnt mark` 写 check / done；owner 编辑正文、目标，或在线程里回复，条目自动回 open；close 只由 owner 点。pending 指 open、check、done 三态，都在等 owner 验收。
要避开：把 done 说成“已验收”（验收是 close）。

**`#n`（标注序号）** · 桶目录下的 `_seq.json`
队列里每一条的对外编号，按桶单调递增，永不复用；跨桶写 `<页 id>#12`。随机 `id` 是内部主键，`@a:<id>` 也能引用。`#` 只属于标注序号：编译锚点 `data-pp-id` 的同行实例后缀用 `@`（`Nav.jsx:18@2`）。
要避开：把锚点后缀写成 `#`。

**桶与账本** · 桶 `~/.pinpoint/<页 id>/`（数据根可由 `PINPOINT_DATA_DIR` 覆盖）；账本文件名规则 `src/shared/annotate-page-key.js`
桶是一个页 id 的全部标注，一个页 id 一个目录，磁盘是事实源，浏览器 localStorage 只是缓存。账本是桶里的一个文件：文章的桶里有 `@canvas.json`（画布标注）和 `@prose.json`（正文评论），有 HTML 帧时每个页面路径另有一本（文档页标注）；存量页的文档条目同样按路径各有一本。`pinpoint` 桶收不属于任何页 id 的标注，它不是页。
要避开：把标注写进仓库——桶在本机数据目录，不进 git。

**孤儿** · 页在不在看 `src/server/lib/page-resolve.js` 的 `pageIdIsLive`，活页桶里的账本看 `src/server/lib/orphans.js`
表面已经不存在的账本：文章目录删了或改了名、project 不再登记（整桶）；文章的 HTML 帧移出了 Canvas、源文件删了或服务不出、存量页的文件删了或页不在了。`ppnt comments` 把它们单独列出，不计数。桶目录在盘上就能读写：pending 的孤儿照样用 `ppnt mark` / `reply` 回，整桶孤儿也一样；任何写入都不新建页已不在的桶。清理只经 `ppnt prune <页 id>`，由 owner 决定，页已不在时连桶目录一起删。
要避开：以为孤儿只能删、不能回；agent 替 owner 去 prune。

**工作台（workbench）** · `https://pinpoint.localhost/workbench/`（壳页是仓库根的 `index.html`；旧地址 `/?page=…`、`/index.html` 跳过来）；左栏 `src/workbench/app/Sidebar.jsx`、`ArticlesSection.jsx`
看画布视图和存量页、做画布标注的那个应用：满屏画布，左栏浮动面板，底部横条，右栏标注列表。左栏“页面”tab 里有两组：上面“文章”组按 project 列出每篇文章，点有画布的文章行打开它的画布视图，没有画布的在新标签页打开文章页，行尾“阅读”钮总是在新标签页打开文章页；下面“页面”组列存量页（置顶、最近、全部页）。
要避开：“Pages”单指工作台（Pages 列表只是“页面”组）。

## 资产与服务

**kit** · `content/kits/ios/`（`ios-kit.css`、`ios-kit.js`、`jsx/`）
积累下来的设计规范：tokens、基础样式、系统组件的 JSX 印章。帧写 `import { Nav } from 'pinpoint/kit'` 引用。跨文章复用的组件手动搬进这里。现在只有 iOS 一份。
要避开：把 kit 当成产品本身。

**源码与 dist** · dist 在 `~/.pinpoint/dist/<页 id>/`；编译器 `src/server/lib/page-compiler.js`
源码是作者写的帧、组件、图和样式（以及存量页的 `board.json` 和 `.html` 片段帧）。JSX 帧、图和存量页的片段帧由 `ppnt build` 编成 dist 里的静态 HTML，不进 git，不放回源目录；画布、卡片、画布标注和截图读 dist，dist 落后时重编，不手改。文章的 HTML 帧不编译，服务直接给源文件。
要避开：拿“产物”单说 dist（存量页的大纲里“产物”另有所指，见存量页一节）。

**registry（登记表）** · `~/.pinpoint/registry.json`（`PINPOINT_REGISTRY` 覆盖）；读 `src/server/lib/registry.js`，写 `src/server/lib/registry-store.js`
声明哪些仓外内容进 pinpoint：project（`kind: "project"`）和存量页的来源（`kind: "dir" | "file"`）。它同时是三件事的白名单：服务什么、往哪注入标注客户端、标注落哪个桶。写入只经 `pinpoint add / mv / remove`。
要避开：手改 registry 文件。

**登记过才注入** · 注入片段 `src/server/lib/annotate-snippet.js`
标注客户端是服务注入到网页里的一段脚本，画布标注的工具和正文评论栏都由它提供。它只注入登记过的目标：文章页（只跑正文评论）、画布视图（含其中的 HTML 帧）、`/sites/` 下的存量页。其余 URL 返回逐字节相同、没有标注面的页面；`?annotate=off` 让单次请求不带客户端（卡片、浮层、导出走这条）。
要避开：往没登记的页面手工插 `/annotate.js`。

**`/sites/<页 id>/`** · `src/server/sites-api.js`
服务上按页 id 划分的地址空间：文章的帧资源在 `/sites/<project>_<article>/assets/…`，存量页的目录和文件也在这里。
要避开：拿 site 指用户自己的网站（那个说目标应用）；把 `/sites/` 和文章站点 `site/` 混为一谈。

**template 与 instance（模板与实例）** · 实例目录靠 `.git/info/exclude` 挡在 git 外
template 是进 git 的部分：框架代码、kit、`content/previews/` 的示例页。instance 是这台机器上 owner 自己的内容：`prototypes/`、`tasks/`、`BACKLOG.md`、`TODO.md`、`.archive/`。`PREVIEW_TEMPLATE_ONLY=1` 把实例藏起来，e2e 跑在这个模式下。
要避开：拿 instance 指“一个标注客户端实例”（那个说客户端实例）。

## 引用地址

人和 agent 在对话里互指用这些短地址，`ppnt` 都认。一篇文章写 `<project>/<article>`（文章网址和页 id 也认），这是 `ppnt` 命令的第一个参数；编号和 `#12` 只在一篇文章（或一个存量页）里有意义，所以写在它后面。把第一个引用写成 `<project>/<article>#12` 或 `@frame:<页 id>/<帧 id>` 时可以不写第一个参数，其余引用以它为准。命令不猜目标：没写或写错就报错并列出候选。

- `#12`（本桶标注序号）、`<project>/<article>#12`（带上文章，跨桶也用它；`<页 id>#12` 同义）、`@a:<id>`（标注内部 id）。
- `B3`（编号，一帧）、`B` 或 `§2`（一节，`§n` 是文章页上的节号）、裸帧 id、裸节 id。多 tab 的存量页写 `<tab>:B3`。
- `@frame:<页 id>/<帧 id>`、`@section:<页 id>/<节 id>`、`@page:<页 id>`。

标注正文里指自己的目标用 `[@t:iN]`（第 N 个目标），它只在那一条标注内解析，不算对别的标注的引用（`mentions[]`）。

## 存量页（页 / board）

存量页是文章模型之外的原型页，和文章并列，是工作台的常规入口：一个带 `board.json` 的帧目录（或一个 HTML 文件），经 registry 登记，在工作台左栏的“页面”组里，不带参数的 `ppnt list` 里类型不是 project 的条目都是。新工作写成文章；存量页照常能看、能改、能标注，需要时转成文章，跑 `pinpoint migrate <页 id> --project <根>`：每个 board section 成为一节，节里一个画布组件，旧页和它的标注留在原处（做法见 `docs/projects.md`“从存量页迁移”）。下面这些词只在存量页上遇到。

**存量页** · `content/previews/_index.json`（模板页）或 registry 的 dir / file 条目
工作台“页面”组里的一行，页 id 是它自己的 id。一个存量页可以同时有画布和文档。代码、CLI 帮助和 `docs/board-schema.md` 里单说的“页”（`<页>`、Pages、`pageId`）多半指存量页或页 id。
要避开：“册”；单说“页”而不说明是存量页还是画布视图。

**board** · 存量页目录里的 `board.json`；契约 `src/workbench/lib/preview-contracts.js`，字段见 `docs/board-schema.md`
一个存量页的内容定义：顶层是 `sections[]`（或 `tabs[]`），每个 section 有 `id`、`title`、`layout` 和 `screens[]`。文章没有手写的 board，画布视图的 board 由正文派生。
要避开：拿 board 指工作台里的画布区域。

**board section** · `board.json` 的 `sections[]`
存量页画布上的一行帧，和文章的节是同一种东西，只是没有正文。`section.id` 写进 DOM 的 `[data-ann-section]`，成为标注的 `section` 字段。
要避开：以为存量页的 section 有节号（存量页只有字母编号）。

**页内 tab** · `board.json` 的 `tabs: [{id, title, sections}]`（ADR 0041）
把一个存量页的 section 分成几组视图（如“组件”“交互”）。各 tab 共用组件、资源和标注，id 整页唯一；编号按 tab 各自从 A 数，位置引用写 `flow:B3`。工作台在横条上方用 tab 条切换，≥ 2 个 tab 就有这条，tab 里全是文档也一样；切到一个 tab 打开它的第一个条目，横条的 n / N 只数这个 tab 的条目。转成文章时每个 tab 变成一个 `##` 小标题，节字母改成全文统一排，所以编号会变，帧 id 不变。
要避开：把 tab 说成独立的页或 board。

**comp 屏与组件墙** · `board.json` 里 `shell: "comp"` 的 section，屏条目写 `comp` + `props`
存量页上展示组件状态的写法：屏条目直接调用一个组件，不需要帧文件。文章里没有这种条目，同样的需求写一帧只渲染这个组件，再加 `export const shell = "comp";`。
要避开：在文章的 `<Canvas>` 里写 `comp` + `props`。

**条目（board entry）** · `src/workbench/lib/board-entries.js`
工作台从 board 派生的可选中单位：画布类的屏合成一个画布条目（id `@canvas`），每个 `shell: "doc"` 的屏各成一个文档条目。舞台形态跟着选中的条目走。地址参数 `?entry=`。文章画布上 HTML 帧也在画布条目里（卡片）；它的文档条目是页面浮层，不列在大纲里，双击卡片打开。
要避开：和 registry 条目混用；代码里两者都叫 entry，`board-entries.js` 里的是这一个。

**registry 条目** · `~/.pinpoint/registry.json` 的 `entries[]`
登记表里的一条：`{id, title?, kind: "dir" | "file", path, board?}`，每一条是“页面”组里的一行存量页，页 id 就是它的 `id`（`pinpoint add --id` 指定）。
要避开：和 board 条目混用。

**画布形态与文档形态** · 舞台按选中的条目切换
画布形态是手机机壳排在可缩放平移的画布上；文档形态是整份 HTML 在 iframe 里 1:1 铺满舞台，没有缩放和帧标题。一个存量页可以两种都有。
要避开：“web 模式”；拿 doc 指文章。

**视口** · `src/workbench/lib/viewport.js`，偏好 `prefs.viewportByPage`（文章画布上按帧，`prefs.viewportByFrame`）
文档条目怎么看：窗口（1:1 铺满）或手机（装进一块 402 × 874 的手机屏，居中缩放）。两种都是文档形态，没有画布。文章画布上的 HTML 卡片按这一帧的视口定宽度。
要避开：拿视口指 `pageViewports`（那是每页画布的滚动与缩放存档）；把手机视口说成帧。

**产物与草稿** · 大纲浮层里的两组；屏上 `role: "draft"`
存量页大纲里的分组：产物是交付物（画布、文档，带类型标），草稿是过程里派生出来的整页 HTML。两组没有机制耦合。
要避开：拿“产物”说 dist。
