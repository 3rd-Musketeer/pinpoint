---
name: pinpoint-build
description: 在 pinpoint 里写 article（设计文档）：建 project、写 index.mdx 的 section 与画布、写帧和组件、写 concept 词条；也覆盖改存量页的帧与 board.json。用户说“写一篇文章”“加一节”“把这几帧放进文章”“加个概念”“搭个原型”“加一屏”“改 board”时，先读本 skill 再动手：目录是定死的，帧的写法有几条硬约束，跳过容易白干。
---

# pinpoint-build

新工作都写成 article（文章）：一个 project 下有多篇文章，一篇文章由 section（节）组成，一节里可以放一个画布组件 `<Canvas>`，画布里列出这一节的帧。正文里还可以放图 `<Figure>`：帧画界面的样子，进画布视图、给 owner 标注；图讲一件事怎么运转，只在正文里。每篇文章有两个看法：读者看的文章页 `/<project>/<article>/`，和把所有带画布的节按行排开、集中修改用的画布视图。本 skill 讲文件放在哪、怎么写、怎么查错；文章内容怎么写不归本 skill 管。

读标注、处理正文评论走 [`pinpoint-annotate`](../pinpoint-annotate/SKILL.md)。命令里 `ppnt` 和 `pinpoint` 是同一个入口。机制的权威：project、画布视图、页 id 与错误在 [`docs/projects.md`](../../docs/projects.md)；帧、组件、编译在 [`docs/board-schema.md`](../../docs/board-schema.md)；`Section`、`Canvas`、`[[ ]]` 的站点写法在 [`site/README.md`](../../site/README.md)；词的意思在 [`CONTEXT.md`](../../CONTEXT.md)。

## 1. 放进哪个 project

先跑 `ppnt list <关键词>`。它列出 project（下面每篇文章一行 `<project>/<article>`）和存量页，关键词也匹配文章的 id 和标题。

- 主题已经有 project：在它的 `docs/pinpoint/articles/` 下新建一个目录，就是一篇新 article。不用再登记，服务、站点和 CLI 每次都重读磁盘。
- 还没有：在这个主题自己的根目录（它所属的仓库或 topic）下建 `docs/pinpoint/project.json`，内容是 `{ "id": "browser-use", "title": "Areta browser use" }`，再登记：

```shell
pinpoint add <project 根目录> --project
```

project 是一组相关的文章和 concept，id 是网址的第一段 `/<project>/`。登记时 id 只取 `project.json`，`--project` 不能和 `--title`、`--page`（把条目挂到存量页上的选项）同用；id 是保留名（清单见 [`docs/projects.md`](../../docs/projects.md)“保留名”）或撞了已有条目时，登记退非零，registry 不动。

## 2. 目录（定死）

```text
<project 根>/docs/pinpoint/
  project.json
  articles/<article id>/
    index.mdx                  # 正文
    <帧 id>.jsx                # 帧
    components/<Name>.jsx      # 本篇专用组件
    figures/<图 id>.jsx        # 正文里的图；可选同名 .js（交互）、.css
    article.css                # 可选，注入本篇每一帧
    article.js                 # 可选，注入本篇每一帧
    assets/                    # 图片等资源
  concepts/<名字>.md           # wiki 词条
  components/<Name>.jsx        # project 内几篇共用的组件
```

- project id 和 article id 都匹配 `^[a-z0-9][a-z0-9-]*$`。article id 不能叫 `concepts`。
- `articles/` 下只放目录，每个目录必须有 `index.mdx`；`concepts/` 下只放 `.md`。放错的东西不进列表，同时记一条布局错误。文章目录里多放的文件（比如资料来源笔记）不影响构建。
- 样式和资源只有文章这一级：没有 project 级的 css 和 `assets/`。
- 标注和评论不在这里，在本机的 pinpoint 数据目录。
- 已有的文章目录不改名：目录名是文章地址和页 id 的后半段，改名后旧页 id 下的标注和评论整桶成孤儿。确要改名，按 [`docs/projects.md`](../../docs/projects.md)“文章目录改名”手工挪桶。换 project id 用 `pinpoint rename <旧 id> <新 id>`，它连每篇文章的桶一起搬。

## 3. 写 index.mdx

```mdx
---
title: 浏览器任务里的付款和提交前确认
summary: 一句话导语，project 首页和 [[ ]] 弹出卡片里显示它。
---

开头的正文……

<Section id="card" title="确认卡：用户看到什么">

这一节的正文……

<Canvas frames={["submit-confirm", "submit-confirm-done"]} />

</Section>
```

- frontmatter 每行一条单行的 `key: value`：`title`（缺省用 article id）、`summary`、`order`（project 首页上的排序，可省）。多行值、列表、`|` 或 `>` 开头的值都是布局错误。
- `Section`、`Canvas`、`Figure` 由站点提供，不用 import。
- `Section` 的 `id` 必填，在本篇内唯一。它同时是网页里的锚点和画布视图里这一行的 id。Section 不能嵌套；`##` 小标题不是节。
- 两套号按同一个顺序数。文章页显示节号 1、2、3；画布视图、`ppnt` 和标注用编号：节字母 A、B、C 加节内帧序号，如 `C2` 是第 3 节的第 2 帧。全部 Section 一起数，纯文字的节也占一个号和一个字母，所以第一节是纯文字时，画布视图从 B 开始。正文里不写字母编号。
- `Canvas` 写在 Section 里，一节最多一个。`frames` 写字面量数组，每一项是本篇目录下某个 `<帧 id>.jsx` 的 id。没有 Canvas 的节不进画布。
- `frames` 不能引别的文章或存量页的帧（`"<页 id>/<帧 id>"` 会报错）。要用别处的帧，把帧文件和它 import 的组件复制进本篇目录。
- `Canvas` 可以带字面量 `shell`：`app`（缺省，手机壳）、`lock`、`doc`、`comp`（裸组件，不带机壳）。它管这一节的所有帧。
- 同一个界面要比较几种做法：在同一节里多放几帧并排，选定以后删掉落选的帧。没有专门的变体机制。

### 图（`<Figure>`）

要在正文里讲清一件事怎么运转（时序、数据流、状态怎么变），用图；要给界面画样子、让 owner 标注，用帧和 Canvas。图不进画布视图，不能做画布标注。

- 写法：`<Figure src="figures/message-flow.jsx" caption="消息怎么走" />`，节里节外都能写。`src` 只能是 `figures/<图 id>.jsx`，两个属性都写字面量字符串，同一个图在一篇里只用一次。
- 文件放在 `articles/<article>/figures/`：`<图 id>.jsx` 像帧一样默认导出一个返回 JSX 的函数，守同样的 lint 四禁，通常画一张内联 SVG；要逐步演示、能点，加同名 `<图 id>.js`，导出 `mount(root)`，里面调 `import { steps } from 'pinpoint/figure'`；样式写同名 `<图 id>.css`。
- 颜色只用调色板变量 `--fig-bg`、`--fig-panel`、`--fig-ink`、`--fig-ink-2`、`--fig-muted`、`--fig-hair`、`--fig-accent`、`--fig-accent-soft`、`--fig-err`，深浅色才会跟着文章页切换。SVG 的 `viewBox` 约定、中文字宽（`textWidth`）、`steps()` 的标记写法见 [`docs/projects.md`](../../docs/projects.md)“图”，起手照抄那里的模板或 e2e 固件 `e2e/project-site/docs/pinpoint/articles/commit-confirm/figures/`。
- 自查：`ppnt check <project>/<article>` 把图和帧一起编，lint 与编译错误报图文件和行；`ppnt shot <project>/<article> --figure <图 id>` 拍浅色、深色各一张 PNG，并报图在浏览器里的运行错误；`ppnt show <project>` 的布局错误里列出缺文件、属性写错、编译失败和运行出错的图。

## 4. 帧和组件

帧的写法和存量页相同，全文在 board-schema。写文章时要守的是这些：

- 一帧是一个 `<帧 id>.jsx`，默认导出一个返回 JSX 的函数。文件顶层只允许 `import`、`function` 声明、`export default`，再加可选的一行 `export const shell = "comp";`。
- lint 四禁，违反了 `ppnt build` 直接失败并报文件与行：帧和组件里 `import preact/hooks`、`onX` 事件属性、`fetch(`，以及帧文件顶层的其他语句。一个状态画一帧。
- iOS 帧：根元素是 `.ios-app`（锁屏是 `.ios-lockscreen`），正文写在里面；机壳、状态栏、home 条由 loader 提供，帧里不写。`.ios-sheet`、`.ios-tabbar`、`.ios-sheet-backdrop` 与 `.ios-app` 同级，不放进 `.ios-app`。自定义顶栏和底栏的 inset 用 `--ios-safe-top` / `--ios-safe-bottom`，不写死像素。原因和症状见 board-schema“iOS 帧的硬约束”，画打开的 sheet 要写的 `open` 和 sheet 的内部结构也在那一节。
- 一节里混着手机帧和裸组件帧时，在组件帧的文件顶层写 `export const shell = "comp";`。它只管这一帧，盖过 `<Canvas shell>`。不写的话，这一帧会被套进手机壳，工作台上显示 `ContractError … expected an ios-app` 的错误面板。
- 文章没有 board.json，也就没有 board 里的 `comp` + `props` 条目。要展示组件的某个状态，就写一帧只渲染这个组件（`return <CardState state="approve" />;`），再加上帧级 shell。
- 组件是印章：输入 props 和 children，输出 HTML，没有状态、事件和副作用。kit 的系统组件一律写 `import { Nav } from 'pinpoint/kit'`。本篇和 project 的组件写 `import { X } from './components/X.jsx'`，查找顺序是本篇 `components/X.jsx`、project 的 `docs/pinpoint/components/X.jsx`；两处都没有时编译器会落到 kit 的同名印章，这只是兜底，不要靠它引 kit。只有本篇用就放本篇，几篇共用就放 project；跨 project 复用要手动把文件搬进 kit（`content/kits/ios/jsx/`，每个文件首行注释写了 props）。把组件挪到 project 时删掉各篇里的副本，因为本篇的同名文件优先。
- 本篇的样式写进 `article.css`，不要每帧各写一份。从别的文章复制组件时，一起复制它用到的那部分 `article.css`；组件里写死的 `/sites/<别的页 id>/assets/…` 路径也要改成本篇的。
- 资源放 `assets/`，帧里写绝对路径 `/sites/<project>_<article>/assets/<文件>`。不写 `./assets/…`：工作台把帧内联进自己的页面，相对路径会解析到别处，图片加载失败。
- 屏内交互用内联 `<script data-preview-script>` 或同名 sidecar `<帧 id>.js`（导出 `mount(root)`），写法见 board-schema“交互 frame”。
- 帧 id 用描述内容的短词（`submit-confirm`），不起成编号的样子（`c1b-detail`）。已有的帧不改名：帧 id 是源文件名，也是标注的锚点。

## 5. `[[ ]]` 和 concept

- `[[名字]]` 指向本 project 的 article（按 id）或 concept（按 `name`）。两者共用一个命名空间，比较时不分大小写，撞名是布局错误。
- `[[名字|显示文字]]` 换显示的文字；`[[project:名字]]` 指别的 project 里的 article 或 concept。
- 找不到目标的是空 ref，合法：页面上显示成虚线，project 首页和文章的概念抽屉会列出全部空 ref。还没定义的词可以先写成 `[[ ]]`，之后再补 concept。
- concept 是一个词的定义，一个文件一个：

```markdown
---
name: 确认卡
status: 收敛中
boundary: 一句话说清它管什么、不管什么。
---

定义正文。正文里也能写 [[ ]]。
```

- `name` 缺省用文件名，是 `[[ ]]` 的解析键；文件名（去掉 `.md`）是网址 `/<project>/concepts/<文件名>/`。`status` 只能是 `占位`、`收敛中`、`已固定` 之一。`boundary` 缺省取正文第一段。每个值都是单行。

## 6. 看结果、查错

命令的第一个参数是地址：一篇文章写 `<project>/<article>`（例如 `browser-use/payment-confirm`），一个 project 写 `<project>`。文章网址也认。画布视图每次从 `index.mdx` 自动生成，不要写 board.json。

- `ppnt check <project>/<article>`：汇报前的验证，一条命令看全。布局错误（frontmatter、`<Section>` / `<Canvas>` / `<Figure>` 写法、跨页引帧、缺帧）、每一帧和每个图的 lint 与编译错误、正文渲染错误（没定义的组件 `<Foo />`、没定义的变量）各一行，形如 `文件:行  错误  code  说明`；空 ref 是提示。有错误退 1，只有提示退 0。写 `ppnt check <project>` 查整个 project，`--json` 给结构化输出。
- `ppnt show <project>/<article>`：每节一行 §n、字母、节 id、标题、帧数和 open 数，下面是帧（编号、帧 id、源文件）和网址。owner 说“第 2 节”“B1”时在这里对上。`ppnt show <project>` 列文章、概念、空 ref 和布局错误。
- `ppnt shot <project>/<article>`：文章页整页的 PNG，命令打印文件路径和尺寸。`ppnt shot <project>/<article> §2` 截文章页上的第 2 节；`B1`、`C` 或帧 id 截画布视图上的一帧、一节；`--canvas` 截整个画布视图；`--figure <图 id>` 截正文里的一个图，浅色、深色各一张。改了组件或 `article.css`，把用到它的帧都截一遍。服务要在跑；文章站点还在启动（503）时命令自己等，最多 `--timeout` 秒（缺省 60）。
- `ppnt build <project>/<article>`：编译这篇的全部帧和图到 dist，逐帧、逐图报 ok 或错误。`check` 已经编过一遍，`build` 用于要更新 dist 或 `--watch` 时。
- 文章页 `https://pinpoint.localhost/<project>/<article>/`：第一次打开显示“站点启动中”，就绪后自己刷新。用脚本或 `curl` 读文章页时，这几秒返回的是 503，等到 200 再读；服务重启后也一样。页级错误在页顶错误条，属于某一节的错误在那一节的卡片里，缺源文件的帧显示“缺帧 <id>”占位格。正文渲染出错时文章页可能只显示到正文开头，状态码仍是 200，所以查错看 `ppnt check`，不看状态码。
- 画布视图 `https://pinpoint.localhost/?page=<project>_<article>`，加 `&section=<节 id>` 落到那一节。`?page=` 后面是页 id：文章地址的斜杠换成下划线，标注和评论也按它分桶。工作台左栏“文章”组按 project 列出每篇文章，点它也进画布视图；没有画布的文章点了在新标签页打开文章页。
- project 首页 `https://pinpoint.localhost/<project>/`：文章列表、概念和全部空 ref。
- `https://pinpoint.localhost/<project>/llms.txt`：全部文章的 MDX 原文和概念，就是别的 agent 读到的样子。
- 站点打不开，先跑 `pinpoint status`。
- 要在不碰 owner 常驻服务和数据的环境里试（测试、冒烟）：另起一个服务，用 `PINPOINT_DATA_DIR`、`PINPOINT_REGISTRY`、`PINPOINT_ORIGIN`、`PORT`、`PINPOINT_SITE_PORT` 指到别处，做法见 [`docs/registry.md`](../../docs/registry.md)“隔离运行”。不要用 `pinpoint start` 起第二个服务：它经 portless 注册 `pinpoint.localhost`，会撞上 owner 的路由。在 pinpoint 自己的 worktree 里试改动时，命令写成 `node bin/pinpoint.mjs …`（`ppnt` 是同一个入口）：全局的 `pinpoint` 跑的是 canonical clone 的代码。
- 每个命令的选项和例子：`ppnt <命令> --help`。

文章页上，每个有 Canvas 的节显示成一张画布卡片：头部是节号、节标题、帧数和这一节 open 状态的画布标注数，图注只有帧 id，缩略图不能操作。点卡片里的帧，在文章页上打开这一节的画布浮层，里面的帧可以操作，但不能标注；点卡片头的“打开画布 →”，进画布视图并定位到这一节。画布标注只在画布视图里做；在文章页上选中正文写的是正文评论。两种进同一个队列，处理见 pinpoint-annotate。

改完的检查，都过了才汇报：

1. `ppnt check <project>/<article>` 退 0。
2. 改过的帧和节都用 `ppnt shot` 看过图；改过的图用 `ppnt shot <project>/<article> --figure <图 id>` 看过浅色和深色，没有报运行错误；改了正文，`ppnt shot <project>/<article>` 看一遍文章页。
3. 汇报改了哪些文件、还有什么没解决。评审和关闭标注是 owner 的事。

`~/.pinpoint/dist/` 是编译产物，不要手改，重编就会覆盖。

## 7. 存量页

存量页是文章模型之外的原型页：一个带 `board.json` 的帧目录（或登记的 HTML 文件、网址），在工作台左栏“页面”组里，`ppnt list` 里类型不是 project 的条目就是。它的地址就是它的 id，也是页 id。新工作写成文章，不新建存量页。要把存量页转成文章：`pinpoint migrate <页 id> --project <根>`，每个 board section 成为一节，旧页和它的标注留在原处，见 [`docs/projects.md`](../../docs/projects.md)“从存量页迁移”。改存量页时：

- 帧和组件的写法与第 4 节相同。存量页的组件在 `<存量页目录>/components/`，没有 project 这一层；页级资源登记在 board.json 的 `assets`。
- 新帧要登记进 board.json 的 `sections[].screens`。存量页没有 `check`：改完跑 `ppnt build <页 id>` 到全绿，`ppnt show <页 id>` 看编号对照，`ppnt shot <页 id> B1` 截图。
- board 的字段、`shell: "comp"` 的组件墙、goto 见 board-schema；页内 tab 见 ADR 0041，多 tab 页上位置引用写 `flow:B3`；组件页与交互页的分法见 ADR 0040。
- 往 tracked 目录里放实例内容之前，先读 board-schema“模板与实例”：实例页住你自己的目录，经 `pinpoint add` 登记。
