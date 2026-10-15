# 0043 · pp3 第二天：`check` 是验证、`comments` 是队列，`mark --note` 回复，HTML 帧，图与节号

Status: 部分被修订（HTML 帧的画布入口见下方 2026-10-15 修订） · Date: 2026-10-14 · Supersedes-in-part: 0035（`check` 只读列标注）、0038（`check` 列标注、`mark` 不收 `--note`） · Relates-to: 0042（补充文章模型） · Scope: `bin/cli/validate.js`、`bin/cli/annotate.js`、`bin/ppnt-shot.js`、`src/server/lib/article-check.js`、`src/server/lib/mdx-check.js`、`src/server/lib/html-frame-assets.js`、`src/server/lib/project-sources.js`、`src/server/lib/article-canvas.js`、`content/kits/figure/`、`site/src/components/Figure.astro`、`site/src/lib/figure*.js`、`site/src/lib/canvas-card.js`、`site/src/lib/canvas-overlay.js`、`src/workbench/lib/viewport.js`、两个 skill

**2026-10-15 局部修订（e3da969）**：一篇文章一张画布，HTML 帧与 JSX 帧按节并排；HTML 帧是可滚动、交互、标注的活卡片，图注行的“全页”打开页面浮层，两处共用页面账本。文章正文里的缩略卡片只用来打开画布，点帧打开整张画布并定位、选中它；文章上的画布浮层同样可以标注。下面保留原决定及 owner 当时的原话，画布入口与标注能力以本修订为准。源路径、CLI 截图策略和账本决定沿用；现行机制见 [设计语言的文章画布](../design.md#外壳布局)与 [HTML 帧](../projects.md#html-帧)。

**起因**：0042 落地后第一天按文章写作、处理评论，agent 踩到几处：`ppnt check` 一词三义（标注清单、标注状态 check、agent 心里的“验证”），汇报前验证一篇文章要 3 条命令；`mark` 写状态时没法顺手说明改了什么；生成出来的整份网页放不进画布；正文里没有地方放讲机制的图。决定过程和原话在 `tasks/2026-10-13-pp3/README.md` 与 `research/cli.md`（实例目录，不进 git）。

**Decided**（2026-10-14 owner，加实现时自定的部分）：

- **`check` 是验证，标注队列是 `comments`**（owner：“同意”，即 research/cli.md 方案 A）。`ppnt check <project>[/<article>]` 一次报布局错误、每一帧和每个图的 lint 与编译错误、正文渲染错误和空 ref，每条带文件、行和 code，有错误退 1。`ppnt comments <目标>` 列画布标注和正文评论。`check` 只做验证。
- **`mark --note` 是回复加写状态**：每条标注都有线程，`ppnt mark <目标> <引用…> check|done --note "<回复>"` 先把这句话追加进线程，再写状态；回复没写进去时那一条的状态不写。`ppnt reply` 只回复、不改状态。0038 退役的是存在标注上的 `note` 字段，这条不恢复它：回复是线程里的一条消息，owner 在工作台和文章右栏看得到。
- **HTML 帧**：帧可以是一整份 HTML 页面。`<Canvas frames>` 里写字符串时找本篇目录下的 `.jsx`，没有再找 `.html`；写 `{ id, src }` 指向 project 根下别处的 HTML 文件；要引 project 根外的文件（比如另一个仓里的示例页），先在 `project.json` 的 `sources` 里给目录起名，再写 `src: "<名字>:<路径>"`。文件留在原处，不编译，服务直接给源文件。画布视图里它是文档条目，标注锚点是 CSS 路径加元素文字，账本在这篇的桶里按页面路径分本。
- **手机宽度统一成 402**：卡片、画布浮层和 `ppnt shot` 看 HTML 帧时的手机宽度是 402，和画布视图手机屏同宽，第一屏高 874；桌面宽 1280。宽度由 pinpoint 管，页面里不放宽度切换。
- **图由 agent 画 SVG**：正文里讲机制用 `<Figure>`，agent 自己画内联 SVG，逐步演示用 `pinpoint/figure` 的 `steps()`，颜色只用调色板 `--fig-*`。owner：“不如现在的效果，给 agent 提供画布，agent 自己画 svg”。图先放正文、不进画布、不能标注；owner：“先放正文，之后需要标注了再讨论如何放画布”。
- **文章页用节号，画布用字母**：文章页的目录和节标题写 1、2、3；画布视图、`ppnt` 和标注仍用 A1、B3。第 n 节就是第 n 个字母。owner：“目录不要用字母，用数字吧”。

**否掉的**：

- `check` 保持标注清单、验证另起 `verify`（research/cli.md 方案 B）：现有用法不变，但“check”三义还在，agent 会继续拿 `check` 去验证。
- 图用 Mermaid 一类渲染库：owner 看过实测图后认为不如 agent 直接画的 SVG；beautiful-mermaid 解析失败时还不报错，照样出一张缺了边的图。
