---
name: pinpoint-annotate
description: 读取 Pinpoint 的画布标注、文档页标注和文章正文评论、判断改帧、改组件还是改正文、改完验证截图、在标注的线程里回复、写回状态，全程不需要浏览器工具。用户要求查看或处理标注、评论，或给出 #12、B3、§2、browser-use/payment-confirm#12、@frame、@a 引用时使用。
---

# 处理标注和正文评论

`ppnt comments` 读 → 判断改哪里 → 改、`ppnt check` 验、`ppnt shot` 看 → `ppnt mark <目标> <引用> done --note "<改了什么>"` 一步回复并写状态。
总入口 [`AGENTS.md`](../../AGENTS.md)；写文章、改存量页见 [`pinpoint-build`](../pinpoint-build/SKILL.md)；
字段、账本与状态机的权威是 [`docs/annotation.md`](../../docs/annotation.md)。

## 一篇文章，一个队列

每篇 article（文章）有一个标注桶，桶里的条目排成一个队列：共用一套 `#n` 序号（永不复用）和同一个状态机。命令里文章写成
`<project>/<article>`（如 `browser-use/payment-confirm`），文章网址和页 id `<project>_<article>` 也认；存量页写它的 id。
文章的桶里有三种条目：

- **画布标注**：owner 在画布视图（`/?page=<project>_<article>`，这篇所有带画布的节按行排开）上钉在 JSX 帧或其中元素上的标注，锚点是编译时打的 `data-pp-id`。存量页画布上的标注也是这一种。
- **文档页标注**：钉在一整份 HTML 页面里的元素上的标注。文章的 HTML 帧（`<Canvas frames>` 里的 `.html` 帧或 `{ id, src }`）在画布视图里是文档条目，owner 在那里标注；存量页的文档条目（`board: "html"` 的页、`shell: "doc"` 的条目）也是这一种。锚点是 CSS 路径加元素文字。
- **正文评论**：owner 在文章页（`/<project>/<article>/`，读者读文章的网页）上选中一段正文写的评论。它带引文（选中的文字和前后文）、
  节 id。文章页上的画布卡片和画布浮层不收标注。
  要在 UI 上照人的做法发一条（测试时）：在文章页用鼠标拖选一段正文，点浮出的“评论”，在右栏的输入框里写，点“发送”。

三种条目都有一个线程，owner 写的正文在前，之后是 owner 与 agent 的来回。agent 的回复 owner 不用刷新就能看到，
正文评论在文章页右栏，画布标注和文档页标注在工作台的标注列表和标注卡里。

`ppnt comments <project>/<article>` 一次列出这个桶里的全部条目，正文评论单独成一组，每条下面列出线程里已有的回复。

引用写法：`#12`（本桶序号）、`browser-use/payment-confirm#12`（带上文章，跨桶也用它；`<页 id>#12` 同义）、
`B3`（编号 = 该帧全部标注）、`B` 或 `§2`（整节）、裸帧 id / 节 id（与 `B3` / `B` 同义）、`@frame:<页 id>/<帧 id>`（自带页，可以不写目标）、
`@a:<id>`（兼容写法）。多条用空格分隔，区间 `#3-#7`。

`B3` 这类编号是节字母加节内帧序号，按画布顺序现算，调序、插帧、删帧后就指向别的帧。文章页上 owner 看到的是节号 1、2、3：第 n 节就是第 n 个字母，纯文字的节也占，owner 说“第 2 节”就写 `§2`，等于 `B`。帧 id 不变，也是源文件名。
所以对 owner 当场说话用编号；写进 README、交接稿、验收记录这类留存文字时写 id，或写成
“D2（c1b-detail-time）”。节号、字母、节 id、帧和源文件的对照用 `ppnt show <project>/<article>` 查，`comments` 的帧标题也
同时给编号和 id。

多 tab 的存量页（`board.json` 写了 `tabs`，ADR 0041）：编号按 tab 各自从 A 重来，位置引用写 `<tab>:B3` / `<tab>:B`
（如 `flow:B3`）。裸 `B3` 只在一个 tab 里存在时能用，几个 tab 里都有就报错并列出候选。帧 id、节 id 仍是裸的。
`ppnt show <页 id>` 按 tab 分组列出；`ppnt shot <页 id>` 每个 tab 出一张（`<页 id>--<tab>.png`），指定引用就只出它所在的 tab。

## 0. 先确定地址

owner 常用口头说法指一篇文章或一个存量页（“付款那篇文章”“routines 原型”），不给地址。先跑
`ppnt list <关键词>`：按 id、标题、源路径、文件夹宽松匹配（英文复数自动去 s），列出 project（下面每篇文章一行
`<project>/<article>`）和存量页，关键词也匹配文章的 id 和标题。
只匹配到一个就用它；匹配到多个或一个都没有，把候选列给 owner 问，不要猜。每个命令的第一个参数都是这个地址；
没写或写错时命令报错并列出候选，不会替你挑一篇。

## 1. `ppnt comments <project>/<article>` 读

默认列出 open 状态的条目。画布标注按帧分组：序号、帧号、正文、意图、源码摘录。正文评论另成一组：序号、引文、
节 id、`index.mdx` 里的落脚行和整个线程；引文中间夹着 markdown 记号时，落脚行可能只给到文件和节。

`--frame B3` 收窄到一帧，`--group-by component` 按组件分组（组头给共用帧数），`--status all` 看 check / done / close，
`--json` 给结构化输出。`<project>/<article>#3` 只列这一条；写 `<project>` 逐篇列出整个 project 里有条目的文章。桶在 `~/.pinpoint/<页 id>/`：画布标注（含 mention 帧）在 `@canvas.json`，正文评论在 `@prose.json`，
文档页标注按页面路径各有一本（`<文件>~<hash>.json`，文章的每个 HTML 帧一本）。清单末尾可能出现“孤儿标注”组：表面已不存在的账本（文件删了、那一屏从 board 删了、页没了），
不计入计数。还没关的孤儿照样要回：`ppnt mark <目标> '#n' check|done --note "<回复>"` 和 `ppnt reply` 用 `#n` 或 `@a:<id>` 都指得到它们，
比如说明那一屏已经删了、意见落到了哪里。`--status open` 这类批量写法不会带上孤儿。清理孤儿账本归 owner 走 `ppnt prune`。`comments` 只读，无副作用；不要为读标注重启服务。

JSX 帧的源码摘录读 dist。dist 不在或落后于源码时，`comments` 和 `locate` 先编一次，在 stderr 打一行说明，摘录照常出来。HTML 帧不编译，摘录直接取那份 HTML 源文件。

画布标注的锚点在 `.jsx` 帧上是 `data-pp-id`（形如 `Nav.jsx:18@2`，源文件：行 + 同行第几个实例；组件锚点
给帧实例与组件定义两段）。文档页标注（文章的 HTML 帧、存量页的 `.html` 帧和文档条目）的锚点是 cssPath + 文本摘录，`comments` 把它归到所在的帧下面（`## B1 · <帧 id>`）。锚点已失效的标注仍保留原正文，
画布上留 lastRect 幽灵框。失效不等于已解决，照常处理。

## 2. 判断改哪里

- 画布标注的锚点落在组件（`data-pp-comp`）且共用多帧 → 改组件文件，所有引用帧一起变。文章的组件在
  `articles/<article>/components/` 或 project 的 `docs/pinpoint/components/`，存量页在 `<存量页目录>/components/`。
- 画布标注只影响一帧 → 改那一帧的 `<帧 id>.jsx`（存量页的 `.html` 帧就是那个片段文件）。
- 文档页标注 → 改那份 HTML 页面：文章本篇目录下的 `<帧 id>.html`，或 `{ id, src }` 指向的文件（相对 project 根，或 `project.json` 的 `sources` 登记的目录），`comments` 的摘录给出路径和行；存量页的文档条目改它登记目录里的那个文件。HTML 帧没有 dist，改完不用编译。
- 正文评论 → 改 `index.mdx` 里被评的那段，或者这一节 `<Canvas>` 里的帧。
- 意图字段：`changeTo` 是改文案（结合目标 pill 与上下文，多目标逐个处理，不要把整段指令当替换
  文本）；`move` 是移动，结合 `to_selector` / `to_point` 理解位置；`images` 是参考图，读实际图片。
- 不改代码就能回答的问题（设计取向、取舍）：用 `ppnt mark <目标> <引用> check --note "<回答>"` 回在线程里，
  条目留给 owner 处置。

## 3. 改、编译、看图

改源码（不碰 `~/.pinpoint/dist/`；kit 只在确要改所有文章和存量页时动）→ `ppnt check <project>/<article>` 退 0
（布局、全部帧的 lint 与编译、正文渲染，每条错误指到文件与行，lint 规则见 build skill 的“lint 四禁”）→
`ppnt shot <project>/<article> B1` 看改过的帧，`ppnt shot <project>/<article> §2` 看文章页上改过的那一节
（或 `ppnt comments <project>/<article> --mode image`）对照看效果。存量页没有 `check`，用 `ppnt build <页 id>` 到全绿。
改不动或没道理的条目留着不动，原因在最后的汇报里说。

正文改了以后，每条评论按引文重新定位。被评的那句改写掉了，右栏会把那条评论标成“失效”，显示原来的引文。
按评论改写后出现“失效”是预期的，不用为它保留原句；照常回复、写状态。

## 4. 回复并写状态

```shell
ppnt mark browser-use/payment-confirm '#3' done --note "按钮文案改成“确认付款”，见 B1"
ppnt mark hosted-pages '#2' check --note "这处保留：两个版本的标题长度一致"
```

`mark` 的第一个参数是目标（文章地址或存量页 id），后面跟引用和状态；引用里已经带了 `<project>/<article>#n` 时可以不写目标。
zsh 里单独的 `#3` 要加引号。

- `--note "<文字>"` 先把这句话写进线程，再写状态。回复里写清改了什么、在哪里能看到；回复没写进去时状态也不改，命令逐条打印结果。
- 看了但不改，包括只回答、没改文件 → `check`。改完 → `done`。
- 只回一句、状态不动：`ppnt reply browser-use/payment-confirm#3 "<回复>"`，一次回一条，三种条目都可以。
- 服务端按 `baseRevision` 校验：冲突或非法转换逐条报 409，不影响其余条目，按提示重读再写。
- 文章右栏和画布列表的 pending 段数的是 open、check、done 三态：它们都在等 owner 验收。只有 owner 点了完成的 close 进 closed 段。
- CLI 只写 check 和 done：owner 编辑正文、目标，或在线程里回复时，条目自动回 open；close 只有 owner 在
  工作台或文章右栏做。

每个命令都认 `--json`（stdout 只有一个 JSON）。退出码：0 成功；1 有问题（引用没命中、某条没写进去、服务没答）；2 用法错或找不到目标。

最后在对话里汇报：每条标注和评论做了什么（done / check / 未动 + 原因）。清理与关闭留给 owner。
登记、移动源路径、注入与代理问题见 [`docs/registry.md`](../../docs/registry.md)。
