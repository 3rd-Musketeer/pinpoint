---
name: pinpoint-build
description: 在 pinpoint 里写 article（设计文档）：建 project、写 index.mdx 的 section 与画布、写帧和组件、写 concept 词条；也覆盖改存量 page 的帧与 board.json。用户说“写一篇文章”“加一节”“把这几帧放进文章”“加个概念”“搭个原型”“加一屏”“改 board”时，先读本 skill 再动手：目录是定死的，帧的写法有几条硬约束，跳过容易白干。
---

# pinpoint-build

新工作都写成 article：一个 project 下有多篇 article，一篇 article 由 section 组成，section 里可以放一个画布组件，画布里放帧。本 skill 讲文件放在哪、怎么写、怎么查错；文章内容怎么写不归本 skill 管。

读标注、处理正文评论走 [`pinpoint-annotate`](../pinpoint-annotate/SKILL.md)。机制的权威：project、文章画布、页 id 与错误在 [`docs/projects.md`](../../docs/projects.md)；帧、组件、编译在 [`docs/board-schema.md`](../../docs/board-schema.md)；`Section`、`Canvas`、`[[ ]]` 的站点写法在 [`site/README.md`](../../site/README.md)；词的意思在 [`CONTEXT.md`](../../CONTEXT.md)。

## 1. 放进哪个 project

先跑 `ppnt list <关键词>`。它同时列 page 和 project，关键词也匹配文章的 id 和标题。

- 主题已经有 project：在它的 `docs/pinpoint/articles/` 下新建一个目录，就是一篇新 article。不用再登记，服务、站点和 CLI 每次都重读磁盘。
- 还没有：在这个主题自己的根目录（它所属的仓库或 topic）下建 `docs/pinpoint/project.json`，内容是 `{ "id": "browser-use", "title": "Areta browser use" }`，再登记：

```shell
pinpoint add <project 根目录> --project
```

project 是一组相关的 article 和 concept，id 是网址的第一段 `/<project>/`。登记时 id 只取 `project.json`，`--project` 不能和 `--title`、`--page` 同用；id 是保留名或撞了已有条目时，登记退非零，registry 不动。

## 2. 目录（定死）

```text
<project 根>/docs/pinpoint/
  project.json
  articles/<article id>/
    index.mdx                  # 正文
    <帧 id>.jsx                # 帧
    components/<Name>.jsx      # 本篇专用组件
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
- `Section` 和 `Canvas` 由站点提供，不用 import。
- `Section` 的 `id` 必填，在本篇内唯一。它同时是网页里的锚点和画布的 section id。Section 不能嵌套。
- 节字母 A、B… 按正文里全部 Section 的顺序编，纯文字的节也占一个字母。所以卡片、画布图注和 `ppnt` 里的 `C2` 与正文的节对得上。
- `Canvas` 写在 Section 里，一节最多一个。`frames` 写字面量数组，每一项是本篇目录下某个 `<帧 id>.jsx` 的 id。没有 Canvas 的节不进画布。
- `frames` 不能引别的页的帧（`"<page>/<screen>"` 会报错）。要用别处的帧，把帧文件和它 import 的组件复制进本篇目录。
- `Canvas` 可以带字面量 `shell`：`app`（缺省，手机壳）、`lock`、`doc`、`comp`（裸组件，不带机壳）。它管这一节的所有帧。
- 同一个界面要比较几种做法：在同一节里多放几帧并排，选定以后删掉落选的帧。没有专门的变体机制。

## 4. 帧和组件

帧的写法和存量 page 相同，全文在 board-schema。写文章时要守的是这些：

- 一帧是一个 `<帧 id>.jsx`，默认导出一个返回 JSX 的函数。文件顶层只允许 `import`、`function` 声明、`export default`，再加可选的一行 `export const shell = "comp";`。
- lint 四禁，违反了 `ppnt build` 直接失败并报文件与行：帧和组件里 `import preact/hooks`、`onX` 事件属性、`fetch(`，以及帧文件顶层的其他语句。一个状态画一帧。
- iOS 帧：根元素是 `.ios-app`（锁屏是 `.ios-lockscreen`），正文写在里面；机壳、状态栏、home 条由 loader 提供，帧里不写。`.ios-sheet`、`.ios-tabbar`、`.ios-sheet-backdrop` 与 `.ios-app` 同级，不放进 `.ios-app`。自定义顶栏和底栏的 inset 用 `--ios-safe-top` / `--ios-safe-bottom`，不写死像素。原因和症状见 board-schema“iOS 帧的硬约束”。
- 一节里混着手机帧和裸组件帧时，在组件帧的文件顶层写 `export const shell = "comp";`。它只管这一帧，盖过 `<Canvas shell>`。不写的话，这一帧会被套进手机壳，工作台上显示 `ContractError … expected an ios-app` 的错误面板。
- 文章没有 board.json，也就没有 board 里的 `comp` + `props` 条目。要展示组件的某个状态，就写一帧只渲染这个组件（`return <CardState state="approve" />;`），再加上帧级 shell。
- 组件是印章：输入 props 和 children，输出 HTML，没有状态、事件和副作用。帧里写 `import { X } from './components/X.jsx'`，查找顺序是本篇 `components/X.jsx`、project 的 `docs/pinpoint/components/X.jsx`、`pinpoint/kit` 的同名印章。只有本篇用就放本篇，几篇共用就放 project；跨 project 复用要手动把文件搬进 kit（`content/kits/ios/jsx/`，每个文件首行注释写了 props）。把组件挪到 project 时删掉各篇里的副本，因为本篇的同名文件优先。
- 本篇的样式写进 `article.css`，不要每帧各写一份。从别的文章复制组件时，一起复制它用到的那部分 `article.css`；组件里写死的 `/sites/<别的页>/assets/…` 路径也要改成本篇的。
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

每篇文章的画布是一个自动生成的页，页 id 是 `<project>_<article>`（例如 `browser-use_payment-confirm`）。board 每次从 `index.mdx` 派生，不要写 board.json。`ppnt` 命令里的页参数都用这个 id。

- `pinpoint list <project>`：列文章（每篇下面一行“画布 <页 id>”）、概念和布局错误，有错误时退 1。画布写法的错误（跨页引帧、缺帧、Canvas 写在节外、shell 写错）也在这里。
- `ppnt list <project>_<article> --frames`：编号、帧 id、源文件的对照。
- `ppnt build <project>_<article>`：编译这篇的全部帧，逐帧报 ok 或 lint、编译错误。
- `ppnt shot C2 --page <project>_<article>`：一帧的 PNG，命令会打印文件路径；写 `C` 截整节。改了组件或 `article.css`，把用到它的帧都截一遍。
- 文章页 `https://pinpoint.localhost/<project>/<article>/`：第一次打开显示“站点启动中”，就绪后自己刷新。页级错误在页顶错误条，属于某一节的错误在那一节的卡片里，缺源文件的帧显示“缺帧 <id>”占位格。
- 画布视图 `https://pinpoint.localhost/?page=<project>_<article>`，加 `&section=<节 id>` 落到那一节。
- project 首页 `https://pinpoint.localhost/<project>/`：文章列表、概念和全部空 ref。写完 `[[ ]]` 想确认哪些还是空 ref，看这一页。
- `https://pinpoint.localhost/<project>/llms.txt`：全部文章的 MDX 原文和概念，就是别的 agent 读到的样子。
- 站点打不开，先跑 `pinpoint status`。

文章页上，每个有 Canvas 的节显示成一张卡片：头部是节字母、节标题、帧数和未处理标注数。点卡片里的帧，打开这一节的 overlay，里面的帧可以交互；点卡片头的“打开画布”，进画布视图并定位到这一节。标注只在画布视图里做，正文上选中文字是评论。

改完的检查，都过了才汇报：

1. `pinpoint list <project>` 的布局错误是“无”。
2. `ppnt build <project>_<article>` 每帧都是 ok。
3. 改过的帧都用 `ppnt shot` 看过图。
4. 汇报改了哪些文件、还有什么没解决。评审和关闭标注是 owner 的事。

`~/.pinpoint/dist/` 是编译产物，不要手改，重编就会覆盖。

## 7. 存量 page

存量 page 是一个带 `board.json` 的帧目录，`ppnt list` 里类型不是 project 的条目就是。新工作不建新 page；改存量 page 时：

- 帧和组件的写法与第 4 节相同。页内组件在 `<页目录>/components/`，没有 project 这一层；页级资源登记在 board.json 的 `assets`。
- 新帧要登记进 board.json 的 `sections[].screens`，改完跑 `ppnt build <页>`，查错和截图同第 6 节。
- board 的字段、`shell: "comp"` 的组件墙、goto 见 board-schema；页内 tab 见 ADR 0041，多 tab 页上位置引用写 `flow:B3`；组件页与交互页的分法见 ADR 0040。
- 往 tracked 目录里放实例内容之前，先读 board-schema“模板与实例”：实例页住你自己的目录，经 `pinpoint add` 登记。
