# 0042 · pp3：article 是主体，project → article → section → 组件

Status: 现行（HTML 帧、`check` / `comments` 分工、`mark --note`、图和节号由 0043 补充） · Date: 2026-10-13 · Scope: `src/server/lib/projects.js`、`src/server/lib/article-board.js`、`src/server/lib/article-canvas.js`、`src/server/lib/article-routes.js`、`src/server/article-proxy.js`、`src/server/lib/site-dev-server.js`、`site/`、`src/client/prose-comments.js`、`src/shared/text-quote.js`、`src/shared/prose-thread.js`、`bin/cli/annotate.js`、`bin/cli/list.js`、`skills/pinpoint-build/`、`skills/pinpoint-annotate/`

**起因**：owner 和 agent 对齐设计时产出的 task、ADR、docs，也要拿去和团队对齐、给同事和投资人讲解。owner 2026-10-13：“我希望任何人都可以读这份文档，我，同事，Agent，投资人。所以我希望可分享，而且分享出去别人能看懂”。到 0041 为止，pinpoint 的主体是 page（画布 + section + 帧），只能在本机工作台里看，没有可以发出去的正文。owner 要的是反过来：以文档为主体，画布是文档的一个视图（“这应该算是 pp3 了，大重构”）。决定过程是一轮 grilling 加一个 probe，原话和 milestone 在 `tasks/2026-10-13-pp3/README.md`（实例目录，不进 git）。

**Decided**（2026-10-13 owner，加实现时自定的部分）：

- **层级**：project → article → section → 组件（今天只有画布）。owner：“article - sections - components（canvas、...）”“我觉得还是要有 project 的概念，这是最基本的”。article 是 owner 与 agent 对齐设计的权威，task 与 ADR 是它的投影；owner：“task & adrs 是投影，当然如果实现的过程中改了机制，回来该文档就行”。
- **article 和 concept 是两种东西**：article 是一篇设计文档（blog），concept 是一个词的定义（wiki 词条，有 占位 / 收敛中 / 已固定 三种状态和一句边界）。`[[名字]]` 两种都能指，同一 project 内共用命名空间，比较不分大小写，撞名报错（owner 选 A）。找不到目标的是空 ref，合法，照 Obsidian（owner：“允许创建空 ref，这样就可以梳理出需要哪些机制”）。跨 project 写 `[[project:名字]]`（实现自定）。
- **源文件是 MDX**：正文是 markdown，`<Section>`、`<Canvas>` 是站点提供的组件。帧仍是 pp2 的 `.jsx` 印章，同一份源码。
- **目录定死，放在看得见的地方**：`<project 根>/docs/pinpoint/{project.json, articles/<id>/{index.mdx, <帧>.jsx, components/, assets/, article.css, article.js}, concepts/<名字>.md, components/}`。owner：“定义好我们接受的目录结构，不要太自由”“也可以不隐藏”。project 跟着它的 task 或仓库住，经 registry 登记（kind `project`，`pinpoint add <根> --project`）；owner：“保持现在的 registry 机制”。
- **文章层用 Astro**（4A）：内容集合、路由、`[[ ]]`、`/llms.txt` 从 areta-ost handbook 搬到仓根 `site/`；pinpoint 管画布、标注和托管。
- **一个地址**（3A）：pinpoint 服务按需拉起 Astro 开发服务器并同源代理，文章在 `https://pinpoint.localhost/<project>/<article>/`。project id 不能取服务已占用的首段，清单只有一份（`article-routes.js` 的 `RESERVED_TOP_SEGMENTS`）。
- **section 就是画布的一行**（5A）：文章的 section 与画布的 section 是同一个东西，编号 A1 = 第一节的第一帧。节字母按正文全部 Section 数，纯文字的节也占一个字母。
- **board 由 MDX 派生**：section 的成员和顺序只写在 MDX 里（`<Canvas frames={[…]}>`），board 每次现派生，编进 dist，不写回源目录。owner：“应该是围绕 article 而不是围绕 board，board 我更倾向于是自动构建的”。帧只能引本篇目录里的文件，跨页引用报错。
- **每篇文章的画布是一个自动生成的页**，页 id `<project>_<article>`：两段都不含 `_`，拆分无歧义，也不会撞 registry 条目 id。这个 id 同时是 `?page=`、`/sites/<id>/`、`ppnt` 的页参数和标注桶。画布页不进左栏 Pages。
- **正文里的画布是卡片**，不是无缝嵌入：卡片只显示对应那一节，点开到画布视图并定位到该节（`?page=…&section=<节 id>`），复用现有画布。owner：“为了简单起见……点击后在大的画布里定位到 section”。卡片里点帧打开这一节的 overlay，帧可以交互；owner：“类似于查看图片的逻辑，并且需要允许跟这些 frame 交互”。hover 高亮那套标注只在画布页做；owner：“标注流程依旧是单独在画布页的”。
- **正文评论进同一个队列**：选中正文文字评论，锚点是引文 + 前后文（W3C TextQuote 式），正文改了每次重新定位，找不到标“失效”。评论进这篇的桶（账本 `@prose.json`，与 `@canvas.json` 同桶、同一套 `#n` 和状态机）。owner：“确实可以共享一个标注队列”。agent 经 `ppnt reply` 在线程里回复，回复不改状态；owner：“agent 可以 reply”。
- **第一版只做本机**：能写、能读、能评论。owner：“第一版先不做公网发布，本地先做完”。分享方式定为链接，不导出静态文件；链接先只读，评论只在本机，发布只由 owner 触发。
- **变体不设机制**：一节里多放几帧，选完删掉。owner：“variants 也不用单独设计机制了，也就是在 section 里加一段的事儿，选完了删了就行”。页内 tab（0041）不动；owner：“先不动吧，画布有 tab 不影响我们说的这些能力”。
- **版本进 BACKLOG**：固定链接先显示当前内容。owner 要的是“固定链接 + 可以选择发布的版本”，但“我们现在可以暂时不实现版本机制，backlog”。

**Why（帧怎么进文章，2026-10-13 probe）**：Astro MDX 能复用同一份帧 `.jsx`，三条路实测：

- 把 pinpoint 编译器当库调用（`renderScreenHtml` + `set:html`）：输出与 pinpoint 逐字节相同，但要新导出单帧编译函数，裸 HTML 片段会和文章 CSS 互相干扰。
- Astro 原生 import：能渲染，但 `data-pp-id` 编号、`data-pp-comp`、kit 路径三处都和 pinpoint 不同，帧 lint 也不跑；要对齐就得把编译器逻辑抄一份，两边会越抄越远。
- iframe 卡片指向 `/api/frame?…&annotate=off`：同源，实测 200，帧自带机壳和样式，文章页不需要任何编译能力。第一版走这条。

**否掉的**：

- 源文件直接写 HTML：表达力无限，但每篇都在重写样式，agent 写出来每篇长得不一样，也不好 diff。
- Markdoc（只能用登记过的标签）：渲染一致，但每种块都要先登记，表达力比 MDX 窄，也接不上现有的 JSX 印章。
- pinpoint 自己编译 MDX、不引入 Astro（4B）：只有一套构建，但内容集合、路由、`[[ ]]` 都要重写，第一篇文章要等更久。代价是两套构建并存；两边写的是同一种 MDX，以后换底层，文章源文件基本不用改。
- 文章和画布分开放、文章引用现有 page 的 section：一篇文章的画布会散在几个 page 里，集中修改时要来回跳；owner 定了文章是权威，section 就属于文章。
- 文章 section 与画布分组各自独立（5B）：一节里可以嵌多组帧，但“section”有两个意思，说“B 段”时都要先说清是哪一层。
- 两个端口各跑各的（3B）：卡片和评论要跨源。
- section 成员仍写在 `board.json`、MDX 只按 id 引用：画布、编号、`ppnt` 全部现成，但同一节的标题和成员写在两个文件里，会对不上。
- 发布时冻结成静态导出：owner 改为链接分享（“可以做链接分享，而不是导出静态文件了”）。
- 正文直接嵌入可交互、可标注的帧：owner 要卡片代表画布，标注只在画布页做；overlay 里的标注进 BACKLOG。
- 隐藏目录 `docs/.ppnt/`：`rg` 默认跳过隐藏目录，agent 搜不到文章；owner：“也可以不隐藏”。

**代价**：

- 两套构建并存：pinpoint 编译帧，Astro 渲染正文。卡片里的帧是 iframe，每帧约 67 KB，靠懒加载；卡片高度固定。
- 文章必须由 pinpoint 托管才能看到卡片和评论；Astro 单独起只看得到正文。
- 帧不能跨文章引用，共用的帧要复制，复制之后两边各改各的。
- 没有版本：owner 改了，拿到链接的人马上看到。
- 正文评论只做逐字匹配，引文被改写就标“失效”，不做模糊匹配。
