---
name: pinpoint-build
description: 在 pinpoint 里写 article（设计文档）：建文章（缺省进 notes，要归类时 ppnt mv）、合并或退役文章、写 index.mdx 的 section 与画布、写帧和组件、写 wiki 词条；也覆盖改存量页的帧与 board.json。用户说“写一篇文章”“加一节”“把这几帧放进文章”“加个 wiki 词条”“搭个原型”“加一屏”“改 board”“把这两篇合成一篇”“这篇下线”时，先读本 skill 再动手：目录是定死的，帧的写法有几条硬约束，跳过容易白干。
---

# pinpoint-build

新工作都写成 article（文章）。文章是主体；project 只是装一批文章的容器，读者只在文章标题下看到它的小标签。一篇文章由 section（节）组成，一节里可以放一个画布组件 `<Canvas>`，画布里列出这一节的帧。正文里还可以放图 `<Figure>`：帧画界面的样子，进画布视图、给 owner 标注；图讲一件事怎么运转，只在正文里。每篇文章有两个看法：读者看的文章页 `/<project>/<article>/`，和把所有带画布的节按行排开、集中修改用的画布视图。本 skill 讲文件放在哪、怎么写、怎么查错，以及画哪些帧（第 3 节“画哪些帧”）；正文的文字怎么写不归本 skill 管。

读标注、处理正文评论走 [`pinpoint-annotate`](../pinpoint-annotate/SKILL.md)。命令里 `ppnt` 和 `pinpoint` 是同一个入口。机制的权威：project、画布视图、页 id 与错误在 [`docs/projects.md`](../../docs/projects.md)；帧、组件、编译在 [`docs/board-schema.md`](../../docs/board-schema.md)；`Section`、`Canvas`、`[[ ]]` 的站点写法在 [`site/README.md`](../../site/README.md)；词的意思在 [`CONTEXT.md`](../../CONTEXT.md)。

## 1. 建一篇文章

不用先想放哪个 project。随手写一篇，直接建，文章进默认 project `notes`：

```shell
ppnt new article quick-idea --title 一个想法     # 建出 notes/quick-idea
```

它写出 `articles/quick-idea/index.mdx`：frontmatter 带 title，正文是一节 `<Section id="overview">`，并打印文章页网址和下一步。这一节可以直接改成你的第一节，帧放进它或新加的节都行（节和画布的写法见第 3 节，帧见第 4 节）。之后命令里这篇写成 `notes/quick-idea`，文章页是 `/notes/quick-idea/`。不用再登记，服务、站点和 CLI 每次都重读磁盘。`notes` 是一个普通 project，根目录在 owner 机器上是 `~/workspace/mori-ws/notes/`，文章在 `<根>/docs/pinpoint/articles/` 下；`ppnt list notes` 的“根目录”一行打印它。`notes` 还没登记时命令先建好并登记它，输出第一行说明建在哪。

主题已经有自己的 project（`ppnt list <关键词>` 列出 project 和下面每篇文章 `<project>/<article>`），就直接建在那里：

```shell
ppnt new article browser-use/payment-confirm --title 付款确认
```

要归类时再搬，用 `ppnt mv`。它连标注桶一起搬，HTML 帧的文档页标注和附件也按新地址迁移，页 id 和画布视图地址跟着换成新的，先加 `--dry-run` 看计划：

```shell
ppnt mv notes/quick-idea browser-use/                 # 搬进已有的 project，保留文章 id
ppnt mv notes/quick-idea browser-use/payment-retry    # 搬过去并改 id
```

`[[ ]]` 不会自动改，命令逐条列出指向它的引用。规则只有一条：同一个 project 里写 `[[名字]]`，跨 project 写 `[[<project id>:名字]]`。所以留在 `notes` 里指向它的要改成 `[[browser-use:quick-idea]]`，它自己指向 `notes` 里别的文章的也要加上 `notes:`。

文章目录或 `index.mdx` 是 symlink 时，搬文章、改 project id 均在写入前拒绝；先把链接换成真实目录或普通 `index.mdx` 文件，再重试。搬迁失败返回非零；提示“已回滚”后可重试原命令。若提示“回滚未完成”，先保留现有目录和恢复副本；若提示桶内容冲突，先另存并合并并发保存的反馈与附件，再按 stderr 给出的 `manifest.json` 中 `target` / `backup` 恢复关键数据。带 `writeThrough` 的条目把备份字节恢复到其 `realpath`，保留原链接，再重试。

目标 project 还没有时，先在主题的根目录（它所属的仓库或 topic，例如 `topics/browser-use/`）建一个。命令在 `<根>/docs/pinpoint/` 下写 `project.json`、建空的 `articles/` 和 `wiki/`，再登记；然后照上面搬：

```shell
ppnt new project <project 根目录> --title "Areta browser use"     # id 缺省取目录名，--id 指定
```

project 的 title 只写一个短名字，例如 Vault、Areta browser use，不写成一句描述：读者在首页和文章标题下看到的是它的小标签。title 带冒号（全角或半角）或超过 24 个字符时，`ppnt check` 给一条提示。两个 `new` 命令都不覆盖已有文件：`project.json` 已经在就沿用它、只补登记；`index.mdx` 已经在就报错退出。文章 id 以前用过、它的桶里还留着旧标注（文章删了或改了名）时 `new article` 也报错退出，不接旧标注：换一个 id；要不要 `ppnt prune` 清掉旧标注由 owner 定。id 是保留名（清单见 [`docs/projects.md`](../../docs/projects.md)“保留名”）或撞了已有的 project 时退 2，什么都不写。手写 `project.json` 的 project 用 `ppnt add <根> --project` 登记。

### 合并、退役文章

把 A 的内容并进 B、再让 A 下线，没有命令代办，按这个顺序做。顺序反了的典型后果：B 的 `index.mdx` 已经引用 A 的帧，A 的目录却先挪走了，B 构建失败，每一帧报“没有源文件”。

1. 先处理 A 的标注：`ppnt comments <project>/<A>` 里 open 的先回掉或标掉。A 下线后它的桶整桶成孤儿，没处理的反馈就丢了。
2. 把 B 要用的帧源文件、它们 import 的 `components/`、引用的 `assets/`（截图、logo）复制进 B 的目录；帧 id 和 B 已有的撞了就改名，`index.mdx` 里跟着改。只有文章这一级有资源，复制漏一个就构建失败。
3. 帧里写死了 A 的页 id 的路径（例如 `/sites/<project>_<A>/assets/shots/x.jpg`）改成 B 的页 id。
4. 改 B 的 `index.mdx`，引用复制过来的帧。跑 `ppnt check <project>`，0 个错误才往下走。
5. 再让 A 下线：把 A 的目录移出 `articles/`（例如移到 project 外的 `retired/<日期>-<原因>/`）。别的文章里的 `[[A]]` 改成 `[[B]]`，或删掉。
6. 再跑一次 `ppnt check <project>`，确认 A 留下的引用都清干净了。A 的孤儿桶要不要用 `ppnt prune` 清掉，由 owner 定。

只是换 project 或改 id，整篇照搬，用上面的 `ppnt mv`，不走这套。

## 2. 目录（定死）

```text
<project 根>/docs/pinpoint/
  project.json
  articles/<article id>/
    index.mdx                  # 正文
    <帧 id>.jsx                # 帧
    <帧 id>.html               # 或整份网页当帧（HTML 帧）
    components/<Name>.jsx      # 本篇专用组件
    figures/<图 id>.jsx        # 正文里的图；可选同名 .js（交互）、.css
    article.css                # 可选，注入本篇每一帧
    article.js                 # 可选，注入本篇每一帧
    assets/                    # 图片等资源
  wiki/<名字>.md               # wiki 词条
```

- project id 和 article id 都匹配 `^[a-z0-9][a-z0-9-]*$`。article id 不能叫 `wiki` 或 `concepts`。
- `articles/` 下只放目录，每个目录必须有 `index.mdx`；`wiki/` 下只放 `.md`。放错的东西不进列表，同时记一条布局错误。文章目录里多放的文件（比如资料来源笔记）不影响构建。
- 样式、资源和组件只有文章这一级：没有 project 级的 css、`assets/` 和 `components/`。几篇文章都要用的组件放进 kit。
- 标注和评论不在这里，在本机的 pinpoint 数据目录。
- 文章目录不要手动改名或挪走：目录名是文章地址和页 id 的后半段，手动改了，旧页 id 下的标注和评论整桶成孤儿。改文章 id、换 project 用 `ppnt mv <project>/<a> <project2>/<b>`（目标写 `<project2>/` 保留 id），见第 1 节；别的文章里的 `[[a]]` 它只列出来，要自己改。换 project id 用 `ppnt mv <旧 id> <新 id>`，换 project 根目录用 `ppnt mv <id> <新路径>`。合并或退役文章要挪走目录，按第 1 节“合并、退役文章”的顺序做。

## 3. 写 index.mdx

```mdx
---
title: 浏览器任务里的付款和提交前确认
summary: 一句话导语，首页、project 首页和 [[ ]] 弹出卡片里显示它。
---

开头的正文……

<Section id="card" title="确认卡：用户看到什么">

这一节的正文……

<Canvas frames={["submit-confirm", "submit-confirm-done"]} />

</Section>
```

- frontmatter 每行一条单行的 `key: value`：`title`（缺省用 article id）、`summary`、`order`（project 首页上的排序，可省）、`date`（`YYYY-MM-DD`，首页按它排；可省，缺省用 `index.mdx` 的修改时间）。多行值、列表、`|` 或 `>` 开头的值都是布局错误。
- `Section`、`Canvas`、`Figure` 由站点提供，不用 import。
- `Section` 的 `id` 必填，在本篇内唯一。它同时是网页里的锚点和画布视图里这一行的 id。Section 不能嵌套；`##` 小标题不是节。
- 两套号按同一个顺序数。文章页显示节号 1、2、3；画布视图、`ppnt` 和标注用编号：节字母 A、B、C 加节内帧序号，如 `C2` 是第 3 节的第 2 帧。全部 Section 一起数，纯文字的节也占一个号和一个字母，所以第一节是纯文字时，画布视图从 B 开始。正文里不写字母编号。
- `Canvas` 写在 Section 里，一节最多一个。`frames` 写字面量数组，每一项是本篇目录下一个帧的 id（`<帧 id>.jsx` 或 `<帧 id>.html`），或 HTML 帧的 `{ id, src }`（见本节最后一条）。没有 Canvas 的节不进画布。
- `frames` 不能引别的文章或存量页的帧（`"<页 id>/<帧 id>"` 会报错）。要用别处的帧，把帧文件和它 import 的组件复制进本篇目录。
- `Canvas` 可以带字面量 `shell`：`app`（缺省，手机壳）、`lock`、`doc`、`comp`（裸组件，不带机壳）。它管这一节的所有帧。
- 生成出来的整份网页也能当帧（HTML 帧）：本篇目录下的 `<帧 id>.html` 直接写 id；页面在 project 根下别处，写 `{ id: "catalog", src: "<相对 project 根的路径>" }`；在 project 根外面（比如另一个仓里的示例页），先在 `project.json` 的 `sources` 里给那个目录起个名字（`"sources": { "skill": "<目录>" }`），再写 `src: "skill:preview.html"`。文件都留在原处，不复制。页面里的相对资源照原样取，断了的 `ppnt check` 会报。页面和资源要真的在那个目录里：符号链接指到外面、`.` 开头的文件，服务都不出，check 报错。文章页卡片缺省按手机宽 402 排缩略图，卡片头的“手机 / 桌面”开关切到桌面宽 1280，页面里不用放宽度切换。节没写 `shell` 时 HTML 帧套 `doc` 机壳，写了就用节的；JSX 帧和 HTML 帧可以在同一节，HTML 帧照样占一个编号（如 `B2`）。画布视图里 HTML 帧是活卡片，与其他帧按节并排，能滚动、交互和标注；图注行的“全页”打开页面浮层，横条可切窗口 / 手机视口，关闭回画布。这一帧的视口偏好也决定卡片尺寸，缺省窗口 1280 × 800，手机 402 × 874；`ppnt shot <project>/<article> B2` 按 402 宽截它的整页。规则见 docs/projects.md“HTML 帧”。 页面浮层保留最近两份文档；回收前提交并保存标注草稿，保存未完成或失败时暂缓回收，活卡片也遵守同一保存条件。再次打开已回收的页面会重置滚动位置、表单值和脚本状态，标注与视口偏好保留。

文章页每个有画布的节显示一张缩略卡片，卡片里的页面只展示，不接交互和标注。点帧打开这篇文章的整张画布，定位并选中它；点“打开画布 →”定位到这一节。画布浮层和直接打开的工作台都能交互、标注，Esc 或关闭浮层回到正文原位（2026-10-15，e3da969）。

### 画哪些帧

- 一个界面状态画一帧。
- 同一个界面要比较几种做法：在同一节里多放几帧并排，选定以后删掉落选的帧。没有专门的变体机制。
- 画“现状”（产品今天长什么样）用真机截图，不凭记忆重画：截图放进 `assets/`，用一帧显示它，这一帧写 `export const shell = "comp";`，截图自带状态栏，不再套机壳。
- 边界情况（corner case）先在对话里列出分歧和选项，和 owner 对齐；owner 定了以后每条画一帧。
- 容易搞错的情况要画对比：正确和容易做错的两种各占一节，上下两行并排，同一步放在同一列，两行只有落点（这一步最后停在哪里）不同。

### 图（`<Figure>`）

要在正文里讲清一件事怎么运转（时序、数据流、状态怎么变），用图；要给界面画样子、让 owner 标注，用帧和 Canvas。图不进画布视图，不能做画布标注。

- 写法：`<Figure src="figures/message-flow.jsx" caption="消息怎么走" />`，节里节外都能写。`src` 只能是 `figures/<图 id>.jsx`，两个属性都写字面量字符串，同一个图在一篇里只用一次。
- 文件放在 `articles/<article>/figures/`：`<图 id>.jsx` 像帧一样默认导出一个返回 JSX 的函数，守同样的 lint 四禁，通常画一张内联 SVG；要逐步演示、能点，加同名 `<图 id>.js`，导出 `mount(root)`，里面调 `import { steps } from 'pinpoint/figure'`；样式写同名 `<图 id>.css`。
- 颜色只用调色板变量 `--fig-bg`、`--fig-panel`、`--fig-ink`、`--fig-ink-2`、`--fig-muted`、`--fig-hair`、`--fig-accent`、`--fig-accent-soft`、`--fig-err`，深浅色才会跟着文章页切换。SVG 的 `viewBox` 约定、中文字宽（`textWidth`）、`steps()` 的标记写法见 [`docs/projects.md`](../../docs/projects.md)“图”，起手照抄那里的模板或 e2e 固件 `e2e/project-site/docs/pinpoint/articles/commit-confirm/figures/`。
- 自查：`ppnt check <project>/<article>` 把图和帧一起编，lint 与编译错误报图文件和行；`ppnt shot <project>/<article> --figure <图 id>` 拍浅色、深色各一张 PNG，并报图在浏览器里的运行错误；`ppnt show <project>` 的布局错误里列出缺文件、属性写错、编译失败和运行出错的图。

## 4. 帧和组件

JSX 帧的写法和存量页相同，全文在 board-schema。HTML 帧是现成的整份页面，不编译，下面这些只管 JSX 帧和组件：

- 一帧是一个 `<帧 id>.jsx`，默认导出一个返回 JSX 的函数。文件顶层只允许 `import`、`function` 声明、`export default`，再加可选的一行 `export const shell = "comp";`。
- lint 四禁，违反了 `ppnt build` 直接失败并报文件与行：帧和组件里 `import preact/hooks`、`onX` 事件属性、`fetch(`，以及帧文件顶层的其他语句。
- iOS 帧：根元素是 `.ios-app`（锁屏是 `.ios-lockscreen`），正文写在里面；机壳、状态栏、home 条由 loader 提供，帧里不写。`.ios-sheet`、`.ios-tabbar`、`.ios-sheet-backdrop` 与 `.ios-app` 同级，不放进 `.ios-app`。自定义顶栏和底栏的 inset 用 `--ios-safe-top` / `--ios-safe-bottom`，不写死像素。原因和症状见 board-schema“iOS 帧的硬约束”，画打开的 sheet 要写的 `open` 和 sheet 的内部结构也在那一节。
- 一节里混着手机帧和裸组件帧时，在组件帧的文件顶层写 `export const shell = "comp";`。它只管这一帧，盖过 `<Canvas shell>`。不写的话，这一帧会被套进手机壳，工作台上显示 `ContractError … expected an ios-app` 的错误面板。
- 文章没有 board.json，也就没有 board 里的 `comp` + `props` 条目。要展示组件的某个状态，就写一帧只渲染这个组件（`return <CardState state="approve" />;`），再加上帧级 shell。
- 组件是印章：输入 props 和 children，输出 HTML，没有状态、事件和副作用。kit 的系统组件一律写 `import { Nav } from 'pinpoint/kit'`。本篇的组件放在本篇 `components/`，写 `import { X } from './components/X.jsx'`；本篇没有时编译器会落到 kit 的同名印章，这只是兜底，不要靠它引 kit。没有 project 级的组件：几篇文章都要用的组件手动把文件搬进 kit（pinpoint 仓库的 `content/kits/ios/jsx/`，每个文件首行注释写了 props，并在同目录的 `index.js` 里导出），帧里改写 `import { X } from 'pinpoint/kit'`，搬完删掉各篇里的副本，因为本篇的同名文件优先。kit 在 pinpoint 仓库里，搬进去就是改那个仓库，照它的 `AGENTS.md` 提交。project 的 `docs/pinpoint/components/` 不参与编译，`ppnt check` 报 `project_components_dir`。
- 自 2026-10-15 起，编译读取 JSX 帧、组件、图及其 import 时，源码的真实路径须留在登记的 project 根内；存量页限制在登记目录，模板限制在 previews 根内。根内 symlink 和登记根自身的 symlink 可用；kit 组件与图运行时按各自的仓内根检查。`sources` 只为 HTML 帧登记目录，不给 JSX import 跨根权限。源文件越界后，HTTP 服务会丢弃旧帧产物或重编报错。
- 本篇的样式写进 `article.css`，不要每帧各写一份。每一帧（包括 `comp`）都包在 kit 的 `.ios-root` 里，kit 用 `.ios-root button` 清掉了按钮的颜色、底色和边框，它比单个类名优先；自己的按钮样式写成 `.ios-root .<类名>`，或用 kit 的按钮印章。从别的文章复制组件时，一起复制它用到的那部分 `article.css`；组件里写死的 `/sites/<别的页 id>/assets/…` 路径也要改成本篇的。
- 资源放 `assets/`，帧里写绝对路径 `/sites/<project>_<article>/assets/<文件>`。不写 `./assets/…`：工作台把帧内联进自己的页面，相对路径会解析到别处，图片加载失败。
- 品牌和 App logo 必须由 `ppnt logo add <文章地址> <品牌>...` 写入本篇 `assets/logos/`，不手画品牌 path；先用 `ppnt logo search <词>` 离线查名字与变体。一篇文章里同一品牌只用一张图，并且只经过一个组件渲染：有 App 图标时统一用 `--app` 的 PNG（国家默认 us，国内 App 加 `--country cn`）；没有 App 图标时统一用白底、0.5 px 描边、25% 圆角方块和居中的彩色 logo，内图宽高为外框的 72%；都没有时用 `--placeholder`。外面是否再包框也必须全文一致。单色 SVG 用 CSS mask 取品牌色，`img` 的 `currentColor` 不继承外层颜色。品牌色和来源见 `assets/logos/logos.json`，命令末尾打印含本篇全部已登记品牌的 JSX 帧和 MDX 引用示例，分批添加后可整体更新同一个组件。通用 UI 图标用 lucide。
- 自 2026-10-16 起，`ppnt logo add` 把超过方框 25% 的白底对比度加权墨迹面积缩到 25%（线性尺寸最多缩小 20%），留白写进 SVG 的方形 viewBox；组件仍用 72% 内框，App PNG 与 placeholder 铺满。单色图按 manifest 品牌色计算；已有文章对含 SVG 的品牌重跑 `ppnt logo add` 即可更新，不带 `--app` 会保留已有 App PNG 和来源，无需改组件或重新下载 App 图标；只有 App PNG 的品牌不必重跑。
- 屏内交互用内联 `<script data-preview-script>` 或同名 sidecar `<帧 id>.js`（导出 `mount(root)`），写法见 board-schema“交互 frame”。
- 帧 id 用描述内容的短词（`submit-confirm`），不起成编号的样子（`c1b-detail`）。已有的帧不改名：帧 id 是源文件名，也是标注的锚点。

## 5. `[[ ]]` 和 wiki 词条

- `[[名字]]` 指向本 project 的 article（按 id）或 wiki 词条（按 `name`）。两者共用一个命名空间，比较时不分大小写，撞名是布局错误。
- `[[名字|显示文字]]` 换显示的文字；`[[project:名字]]` 指别的 project 里的 article 或 wiki 词条，`project` 写 project id，`名字` 和不带前缀时一样按 article id 或 wiki 词条的 `name` 解析（如 `[[vault:确认卡]]`）。
- 找不到目标的是空 ref，合法：页面上显示成虚线，project 首页和文章的 wiki 抽屉会列出全部空 ref。还没定义的词可以先写成 `[[ ]]`，之后再补 wiki 词条。
- wiki 词条是一个词的定义，一个文件一个，放在 `wiki/` 下。文件名是网址的一段，用短的英文小写加连字符（`wiki/confirm-card.md`），显示名写进 `name`：

```markdown
---
name: 确认卡
status: 收敛中
boundary: 一句话说清它管什么、不管什么。
---

定义正文。正文里也能写 [[ ]]。
```

- `name` 缺省用文件名，是 `[[ ]]` 的解析键；文件名（去掉 `.md`）是网址 `/<project>/wiki/<文件名>/`。词条只从 `wiki/` 读：project 里有 `concepts/` 目录时 `ppnt check` 报 `wiki_dir_renamed`，把目录改名成 `wiki/` 即可。`status` 只能是 `占位`、`收敛中`、`已固定` 之一。`boundary` 缺省取正文第一段。每个值都是单行。

## 6. 看结果、查错

命令的第一个参数是地址：一篇文章写 `<project>/<article>`（例如 `browser-use/payment-confirm`），一个 project 写 `<project>`。文章网址也认。画布视图每次从 `index.mdx` 自动生成，不要写 board.json。

- `ppnt check <project>/<article>`：汇报前的验证，一条命令看全。布局错误（frontmatter、`<Section>` / `<Canvas>` / `<Figure>` 写法、跨页引帧、缺帧）、每一帧和每个图的 lint 与编译错误、正文渲染错误（没定义的组件 `<Foo />`、没定义的变量）各一行，形如 `文件:行  错误  code  说明`；空 ref 和太长的 project title 是提示。有错误退 1，只有提示退 0。写 `ppnt check <project>` 查整个 project，`--json` 给结构化输出。
- `ppnt show <project>/<article>`：每节一行 §n、字母、节 id、标题、帧数和 open 数，下面是帧（编号、帧 id、源文件）和网址。owner 说“第 2 节”“B1”时在这里对上。`ppnt show <project>` 列文章、wiki 词条、空 ref 和布局错误。
- `ppnt shot <project>/<article>`：文章页整页的 PNG，命令打印文件路径和尺寸。`ppnt shot <project>/<article> §2` 截文章页上的第 2 节；`B1`、`C` 或帧 id 截画布视图上的一帧、一节；`--canvas` 按截图策略输出：HTML 帧各按自己的地址截一张整页（402 宽），另有 JSX 帧时才加一张画布视图图，全是 HTML 帧时不出画布图，命令打一行“说明：”；HTML 帧里懒加载的 iframe 和图片会等它们加载完再截，15 秒还没加载完时打一行“注意”列出它们、退 1；`--figure <图 id>` 截正文里的一个图，浅色、深色各一张。服务要在跑；文章站点还在启动（503）时命令自己等，最多 `--timeout` 秒（缺省 60）。截到的文章页在正文中途断了（正文渲染出错）时，图照样存下，命令打一行“注意”指向 `ppnt check`，退 1。
- `ppnt show <project> --uses <组件>`：用到这个组件的帧和图，最后给出每篇的截图命令。改了组件，照它截一遍；改了 `article.css`，截这篇的全部帧（`ppnt shot <project>/<article> --canvas`）。
- `ppnt open <project>/<article> --print`：打印文章页和画布视图的网址；后面加 `§2` 给那一节，写 `<project>` 给 project 首页、`llms.txt`、每篇文章和每个 wiki 词条页。不带 `--print` 时用浏览器打开。
- `ppnt build <project>/<article>`：编译这篇的全部帧和图到 dist，逐帧、逐图报 ok 或错误。`check` 已经编过一遍，`build` 用于要更新 dist 或 `--watch` 时。
- 文章页 `https://pinpoint.localhost/<project>/<article>/`（隔离服务换成它的地址，`ppnt open` 打印的就是对的）：第一次打开显示“站点启动中”，就绪后自己刷新。用脚本或 `curl` 读文章页时，这几秒返回的是 503，等到 200 再读；服务重启后也一样。刚写好的文章先是 404，可能再有零点几秒是 503“内容同步中”，同样等到 200。页级错误在页顶错误条，属于某一节的错误在那一节的卡片里，缺源文件的帧显示“缺帧 <id>”占位格。正文渲染出错时文章页可能只显示到正文开头，状态码仍是 200，所以查错看 `ppnt check`，不看状态码。
- 画布视图 `https://pinpoint.localhost/workbench/?page=<project>_<article>`，加 `&section=<节 id>` 落到那一节。`?page=` 后面是页 id：文章地址的斜杠换成下划线，标注和评论也按它分桶。工作台左栏“文章”组按 project 列出每篇文章，点它也进画布视图；没有画布的文章点了在新标签页打开文章页。这样直接打开的画布视图左上角有“← 文章标题”，回到文章页的当前节。
- 首页 `https://pinpoint.localhost/`：所有 project 的全部文章，最近改过的在前（frontmatter 写了 `date: YYYY-MM-DD` 用它，否则用 `index.mdx` 的修改时间）。工作台在 `https://pinpoint.localhost/workbench/`。
- project 首页 `https://pinpoint.localhost/<project>/`：这个 project 的文章列表、wiki 词条和全部空 ref；`/<project>/wiki/` 只列 wiki 词条。
- `https://pinpoint.localhost/<project>/llms.txt`：全部文章的 MDX 原文和 wiki 词条，就是别的 agent 读到的样子。
- 站点打不开，先跑 `pinpoint status`。
- 要在不碰 owner 常驻服务和数据的环境里试（测试、冒烟）：`ppnt dev --sandbox [<目录>] [--port <端口>]` 起一个隔离服务，前台常驻（agent 放到后台跑），数据目录、登记表、端口都是自己的，默认 project `notes` 的源码放在 `<数据目录>/notes`；端口缺省自己找空的，文章站点端口是服务端口 +5，`--site-port` 另指。就绪后它打印一行 `source <目录>/env.sh`；在别的 shell 里先执行这一行，之后的 `ppnt` 都对着这个服务。停它用 Ctrl-C 或 `kill` 它打印的 pid。细节见 [`docs/registry.md`](../../docs/registry.md)“隔离运行”。第二个服务只用这条路起：`pinpoint start` 经 portless 注册 `pinpoint.localhost`，会撞上 owner 的路由。在 pinpoint 自己的 worktree 里试改动时，命令写成 `node bin/pinpoint.mjs …`（`ppnt` 是同一个入口）：全局的 `pinpoint` 跑的是 canonical clone 的代码。
- 每个命令都认 `--json`，stdout 只有一个 JSON。退出码：0 成功；1 有问题（验证错误、截到半篇、引用没命中、服务没答）；2 用法错或找不到目标。
- 每个命令的选项和例子：`ppnt <命令> --help`。

文章页上，每个有 Canvas 的节显示成一张画布卡片：头部是节号、节标题、帧数和这一节待验收（open / check / done）的画布标注数，图注只有帧 id，缩略图不能操作。点卡片头的“打开画布 →”或顶栏的“画布视图”，在文章页上打开画布浮层：里面是整张画布视图，能操作、能标注，定位到那一节，关掉回到正文原位，地址带 `#canvas=<节 id>`。点卡片里的某一帧同样打开整张画布、定位并选中这一帧，地址多 `&frame=<帧 id>`（owner 2026-10-15：“现在的画布上既然已经支持交互，那就没必要单独搞一个预览模式了”）。HTML、iOS / 组件帧直接在画布上交互和标注；HTML 卡片上按住空格拖动或中键拖动平移画布，松开恢复页面交互；“全页”打开页面浮层。画布标注在画布视图（或这个浮层）里做；在文章页上选中正文写的是正文评论。两种进同一个队列，文章右栏把画布标注按所属卡片的位置穿插在正文评论之间，处理见 pinpoint-annotate。

改完的检查，都过了才汇报：

1. `ppnt check <project>/<article>` 退 0。
2. 改过的帧和节都用 `ppnt shot` 看过图；改过的图用 `ppnt shot <project>/<article> --figure <图 id>` 看过浅色和深色，没有报运行错误；改了正文，`ppnt shot <project>/<article>` 看一遍文章页。
3. 汇报改了哪些文件、还有什么没解决。评审和关闭标注是 owner 的事。

`~/.pinpoint/dist/` 是编译产物，不要手改，重编就会覆盖。
文章卡片和其他嵌入帧以请求进入时的源码与依赖代次为最低目标，过期时编译后显示；后续保存通过编译完成通知自动更新，SSE 重连或 bfcache 恢复会补刷已加载卡片，连续保存不会让单次请求无限等待，断连会停止它自己的等待。机制见 [`docs/board-schema.md`](../../docs/board-schema.md)“源码与 dist”。

## 7. 存量页

存量页是文章模型之外的原型页：一个带 `board.json` 的帧目录（或登记的 HTML 文件），在工作台左栏“页面”组里，`ppnt list` 里类型不是 project 的条目就是。它的地址就是它的 id，也是页 id。存量页和文章并列，照常能看、能改、能标注；新工作写成文章。需要时把存量页转成文章：`pinpoint migrate <页 id> --project <根>`，每个 board section 成为一节，旧页和它的标注留在原处，命令最后列出下一步（登记、验证、对比截图、补正文、处理旧页的标注），见 [`docs/projects.md`](../../docs/projects.md)“从存量页迁移”。改存量页时：

- 帧和组件的写法与第 4 节相同。存量页的组件在 `<存量页目录>/components/`，没有 project 这一层；页级资源登记在 board.json 的 `assets`。
- 新帧要登记进 board.json 的 `sections[].screens`。存量页没有 `check`：改完跑 `ppnt build <页 id>` 到全绿，`ppnt show <页 id>` 看编号对照，`ppnt shot <页 id> B1` 截图。
- board 的字段、`shell: "comp"` 的组件墙、goto 见 board-schema；页内 tab 见 ADR 0041，多 tab 页上位置引用写 `flow:B3`。
- 往 tracked 目录里放实例内容之前，先读 board-schema“模板与实例”：实例页住你自己的目录，经 `pinpoint add` 登记。
