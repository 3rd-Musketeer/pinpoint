---
name: pinpoint-annotate
description: 读取 Pinpoint 的画布标注和文章正文评论、判断改帧、改组件还是改正文、改完编译截图、在评论线程里回复、写回状态，全程不需要浏览器工具。用户要求查看或处理标注、评论，或给出 #12、B3、plugins#12、@frame、@a 引用时使用。
---

# 处理标注和正文评论

`ppnt check` 读 → 判断改哪里 → 改、`ppnt build`、`ppnt shot` 看 → 正文评论用 `ppnt reply` 回一句 → `ppnt mark` 写状态。
总入口 [`AGENTS.md`](../../AGENTS.md)；写文章、搭页见 [`pinpoint-build`](../pinpoint-build/SKILL.md)；
字段、账本与状态机的权威是 [`docs/annotation.md`](../../docs/annotation.md)。

## 一个页，一个队列

每个页有一个标注桶，桶里的条目共用一套 `#n` 序号（永不复用）和同一个状态机。article 的页 id 是
`<project>_<article>`（如 `browser-use_payment-confirm`），它的桶里有两种条目：

- **画布标注**：owner 在画布视图（`/?page=<project>_<article>`）上钉在帧或元素上的标注，和存量 page 的标注一样。
- **正文评论**：owner 在文章页（`/<project>/<article>/`）上选中一段正文写的评论。它带引文（选中的文字和前后文）、
  节 id 和一个线程（owner 与 agent 的来回）。

`ppnt check <project>_<article>` 一次列出这两种，正文评论单独成一组。

引用写法：`#12`（本页序号）、`plugins#12`（跨页）、`B3`（图纸号 = 该帧全部标注）、
`B`（整段）、裸帧 id / 段 id（与 `B3` / `B` 同义）、`@frame:<page>/<screen>`、`@a:<id>`（兼容写法）。
多条用空格分隔，区间 `#3-#7`。

`B3` 这类编号是显示编号：按 board 顺序现算，调序、插帧、删帧后就指向别的帧。帧 id 不变，也是源文件名。
所以对 owner 当场说话用编号；写进 README、交接稿、验收记录这类留存文字时写 id，或写成
“D2（c1b-detail-time）”。编号与 id、源文件的对照用 `ppnt list <页> --frames` 查，`check` 的帧标题也
同时给两者。

多 tab 的存量页（`board.json` 写了 `tabs`，ADR 0041）：编号按 tab 各自从 A 重来，位置引用写 `<tab>:B3` / `<tab>:B`
（如 `flow:B3`）。裸 `B3` 只在一个 tab 里存在时能用，几个 tab 里都有就报错并列出候选。帧 id、段 id 仍是裸的。
`ppnt list <页> --frames` 按 tab 分组列出；`ppnt shot` 整页每个 tab 出一张（`<页>--<tab>.png`），指定引用就只出它所在的 tab。

## 0. 先确定是哪一页

owner 常用口头说法指页（“routines 原型”“付款那篇文章”），不给页 id。先跑
`ppnt list <关键词>`：按 id、标题、源路径、文件夹宽松匹配（英文复数自动去 s），列出 page 和 project，
关键词也匹配文章的 id 和标题。匹配到文章时它只列出所属的 project，页 id 要再跑 `pinpoint list <project>`，每篇文章下面一行“画布 <页 id>”。
只匹配到一个就用它；匹配到多个或一个都没有，把候选列给 owner 问，不要猜。其他命令找不到页时也会列出最接近的候选。

## 1. `ppnt check <页>` 读

默认列出 open 状态的条目。画布标注按帧分组：序号、帧号、正文、意图、源码摘录。正文评论另成一组：序号、引文、
节 id、`index.mdx` 里的落脚行和整个线程；引文中间夹着 markdown 记号时，落脚行可能只给到文件和节。

`--frame B3` 收窄到一帧，`--group-by component` 按组件分组（组头给共用帧数），`--status all` 看 check / done / close，
`--json` 给结构化输出。桶在 `~/.pinpoint/<页>/`：画布标注（含 mention 帧）在 `@canvas.json`，正文评论在 `@prose.json`，
存量页的文档按路径各有一本。清单末尾可能出现“孤儿标注”组：表面已不存在的账本（文件删了 / 页没了），
不计入计数、不要去 mark 它们，清理归 owner 走 `ppnt prune`。`check` 只读，无副作用；不要为读标注重启服务。

画布标注的锚点在编译页是 `data-pp-id`（形如 `Nav.jsx:18@2`，源文件：行 + 同行第几个实例；组件锚点
给帧实例与组件定义两段）；存量 `.html` 页是 cssPath + 文本摘录。锚点已失效的标注仍保留原正文，
画布上留 lastRect 幽灵框。失效不等于已解决，照常处理。

## 2. 判断改哪里

- 画布标注的锚点落在组件（`data-pp-comp`）且共用多帧 → 改组件文件，所有引用帧一起变。文章的组件在
  `articles/<article>/components/` 或 project 的 `docs/pinpoint/components/`，存量页在 `<页目录>/components/`。
- 画布标注只影响一帧 → 改那一帧的 `<帧 id>.jsx`（存量 `.html` 页就是那个片段文件）。
- 正文评论 → 改 `index.mdx` 里被评的那段，或者这一节 `<Canvas>` 里的帧。
- 意图字段：`changeTo` 是改文案（结合目标 pill 与上下文，多目标逐个处理，不要把整段指令当替换
  文本）；`move` 是移动，结合 `to_selector` / `to_point` 理解位置；`images` 是参考图，读实际图片。
- 不改代码就能回答的问题（设计取向、取舍）：画布标注直接在对话里回答；正文评论用 `ppnt reply` 回在线程里。
  这两种都把条目留给 owner 处置。

## 3. 改、编译、看图

改源码（不碰 `~/.pinpoint/dist/`；kit 只在确要改所有页时动）→ `ppnt build <页>` 到全绿 →
`ppnt shot <帧> --page <页>`（或 `ppnt check <页> --mode image`）对照看效果。lint / 编译错误指到文件与行，
规则见 build skill 的“lint 四禁”。改了文章的 `index.mdx`，再跑一次 `pinpoint list <project>`，布局错误要是“无”。
改不动或没道理的条目留着不动，原因在最后的汇报里说。

正文改了以后，每条评论按引文重新定位。被评的那句改写掉了，右栏会把那条评论标成“失效”，显示原来的引文。
按评论改写后出现“失效”是预期的，不用为它保留原句；照常回复、写状态。

## 4. 回复正文评论

```shell
ppnt reply '#3' "<回复>" --page <project>_<article>
```

文章的条目一律带 `--page <project>_<article>`，`locate`、`mark`、`shot` 也一样：跨页写法 `<project>_<article>#3`
目前解析不到正文评论。回复是线程里的一条 agent 消息，owner 不用刷新就能在右栏看到，它不改状态。回复里写清你改了什么、在哪里能看到。一次只回一条；画布标注没有线程，对它 `reply` 会报错退出，状态改用 `ppnt mark`。

## 5. `ppnt mark <ref…> done|check`

- 看了但不改，包括只在线程里回复、没改文件 → `check`。
- 改完 → `done`。
- 服务端按 `baseRevision` 校验：冲突或非法转换逐条报 409，不影响其余条目，按提示重读再写。
- CLI 不接受 `open` / `close`：owner 编辑正文、目标，或在评论线程里回复时，条目自动回 open；close 只有 owner 在
  工作台或文章右栏做。

最后在对话里汇报：每条标注和评论做了什么（done / check / 未动 + 原因）。清理与关闭留给 owner。
登记新页面、移动源路径、注入与代理问题见 [`docs/registry.md`](../../docs/registry.md)。
