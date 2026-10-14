# site/：article 站点（Astro）

pp3 的文章层。内容不在这里：站点读 registry 里登记的 project（`kind: "project"`），每个 project 的内容在 `<project 根>/docs/pinpoint/`（结构见 [`docs/projects.md`](../docs/projects.md)“目录”）。这里只放站点代码。

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

开发服务器启动时把站点目录、仓库的 `node_modules` 和各 project 的 `docs/pinpoint/` 加进 Vite `fs.allow`，project 根下的其他文件和仓库源码不经 `/@fs/` 服务；之后新登记的 project 要重启 dev 才能加载其中的静态资源。内容文件和 registry 改了会自动重载。

## 路由

| URL | 内容 |
| --- | --- |
| `/<project>/` | 文章列表、概念、空 ref 列表 |
| `/<project>/<article>/` | 文章：左目录（sections）、正文、右评论栏（`[data-pp-rail]`，经 pinpoint 打开时由注入的标注客户端填，见 `docs/annotation.md`“正文评论”）、概念抽屉 |
| `/<project>/concepts/<名字>/` | 概念：状态、定义、正文、用到它的文章 |
| `/<project>/llms.txt` | agent 视图：全部文章 MDX 原文（保留 `[[ ]]`）与概念 |

article id `concepts` 保留给概念路由，用了构建报错。

## 写文章（`articles/<id>/index.mdx`）

frontmatter：`title`（缺省用 id）、`summary`（导语，也是 popup 和列表里的一句话）、`order`（列表次序，可省）。

下面两个组件不用 import，站点自动提供：

- `<Section id="flow" title="付款前的确认">…</Section>`：一节。`id` 必填，字母数字 `_` `-`，文中唯一，就是 DOM id（`#flow`）和画布的 section id。节号 1、2 … 按出现顺序自动编，目录和节标题前的号码从这里来。画布上同一节是字母（第 n 节 = 第 n 个字母，A、B …），字母只出现在画布、`ppnt` 和标注里，文章页不显示。不能嵌套。
- `<Canvas frames={["ask", "confirm"]} />`：这一节的画布卡片，写在 `<Section>` 里，一节最多一个。帧 id 是本篇目录下的 `<帧 id>.jsx`，不能写 `<page>/<screen>`。`shell="comp"` 这类非手机机壳按帧自己的盒子显示。一张卡片里所有帧同一个缩放（手机机壳 438 px 显示成 158 px），组件帧和旁边的手机按真实比例比。卡片头显示节号、节标题与帧数，图注只有帧 id，每帧一个懒加载 iframe（`/api/frame?page=<画布页>&screen=<帧>&annotate=off&embed=card`），卡片里的缩略图不能点、不能标注。点帧在文章上打开这一节的画布浮层（见下），不跳转；“打开画布 →”到画布页并定位到这一节（`/?page=<画布页>&section=<节 id>`）。该节有未处理（open）的画布标注时头部显示条数，读不到标注就不显示。画布错误只显示一次：属于某一节的（跨页引用、缺帧……）列在那张卡片里，页级的（frontmatter、写在 `<Section>` 外的 `<Canvas>`……）在页顶错误条，这时那个 Canvas 不出卡片。缺源文件的帧照占位置，显示占位格“缺帧 <id>”。画布错误也是 project 错误，所以生产构建会失败，开发服务器照常显示。有画布节的文章，顶栏多一个“画布视图”。卡片根节点是 `[data-pp-canvas]`，节 id 在 `data-pp-section`（`data-section` 只属于 `<Section>`）。

## `[[ ]]` 引用

- `[[名字]]`：本 project 的 article（按 id）或 concept（按 `name`）。两者共用命名空间，撞名构建失败（dev 下页面顶上显示错误）。
- `[[project:名字]]`：别的 project；前缀不是已登记的 project id 时，整串当名字。
- `[[名字|显示文字]]`：换显示文字。
- 找不到目标的是空 ref：虚线样式，列在 project 首页、`llms.txt` 和文章的概念抽屉里。首页和 `llms.txt` 的列表出自同一个函数（`site-data.js` 的 `projectEmptyRefs`），文章和概念正文里写的都算。代码里的 `[[ ]]` 不解析。

popup：article 显示标题、摘要、读全文；concept 显示定义、状态、用到它的文章；空 ref 显示还没有页。

- 打开：鼠标悬停 120 ms，或键盘 Tab 到 ref 上。指针移进 popup 不关；离开 ref 和 popup 200 ms 后关。Esc 关。同时只有一个。
- 点击：有目标页的 ref（article / concept）直接去那一页；修饰键照常开新标签页。空 ref 点击打开 popup。
- 触屏没有悬停：点一下先开 popup，再点同一个 ref 才去那一页（popup 里也有链接）。
- popup 挂在 `document.body` 上，不进 `#article`：正文评论客户端监听 `#article` 的 DOM 变动，挂进去每次悬停都会整篇重画。

## 画布浮层

点卡片里的某一帧，在文章上打开这一节的浮层（`CanvasOverlay.astro` + `lib/canvas-overlay-client.js`），像看图一样，不跳转。

- 头部：节号、节标题、帧数，上一节 / 下一节，“打开画布 →”（`/?page=<画布页>&section=<节 id>`），关闭。
- 帧：这一节的全部帧并排，图注是帧 id。所有帧同一个缩放：能放进浮层高度（窄屏还要放进宽度）的最大值，不超过真实大小（`canvas-overlay.js` 的 `overlayScale`）。手机帧量机身（`data-pp-device`），组件帧量组件台（`data-pp-stage`）。放不下就横向滚动。点的那一帧滚到中间，高亮 1.6 s。
- 帧可交互：iframe 是新开的 `/api/frame?…&annotate=off&embed=card`，指针和焦点都放开，帧里的预览脚本照常跑。卡片里的缩略图仍不可交互。
- 地址：`#overlay=<节 id>[&frame=<帧 id>]`（按 URLSearchParams 解析）。点帧时压一条历史，后退就关；前进再打开。直接带这个 hash 打开文章也会打开浮层，这时关闭只去掉 hash，不离开文章。换节用 replaceState，不多压历史。
- 关闭：Esc（焦点在帧里也行，帧把 Esc 转给文章页）、点面板外的暗色区域、关闭按钮。关闭后焦点回到点的那一帧；换过节就回到当前节卡片里的那一帧，页面滚到那张卡片。
- 打开期间：焦点困在浮层里（首尾哨兵把 Tab 绕回来），页面不滚动（`html.pp-ov-lock`）。← / → 或按钮在有画布的节之间走（纯文字的节跳过），焦点在帧的编辑框里时左右键留给帧。
- 手机宽度（≤ 600 px）：整屏 sheet，帧按宽度缩，横向滑动、一帧一停。
- 浮层是 `document.body` 下的 `<dialog data-pp-overlay data-pp-nocomment>`，不在 `#article` 里；在浮层里选字不出正文“评论”。
- 浮层里不做标注（在 BACKLOG）。

## 弹层与 Esc

`lib/layers.js` 是文章页的弹层栈：popup、浮层打开时各压一层，Esc 在 document 捕获阶段交给最上面一层，关掉它并 `preventDefault`。浮层打开时收起 popup。注入的正文评论客户端（`src/client/prose-comments.js`）见到 `defaultPrevented` 的 Esc 不动；草稿只在焦点就在草稿框里时被 Esc 取消，所以关 popup 不会扔掉写了一半的评论。

## 概念（`concepts/<名字>.md`）

frontmatter：`name`（缺省用文件名，`[[ ]]` 按它解析）、`status`（占位 / 收敛中 / 已固定）、`boundary`（一句边界；缺省取正文第一段）。字段规则与解析器在 `docs/projects.md`，站点只用 `listProjects` 读出的值。概念页地址用文件名：`/<project>/concepts/<slug>/`。正文里也能写 `[[ ]]`。

## 代码地图

- `src/lib/projects-source.js`：站点进服务端代码的唯一入口。读 registry / project 用服务与 CLI 共用的 `loadRegistry` + `listProjects`（`src/server/lib/projects.js`），文章画布用 `articleCanvas`（`src/server/lib/article-board.js`，契约见 `docs/projects.md`“文章的画布”）。文章的 title、summary 与概念的 name、slug、status、boundary 都取它的结果，不取 Astro 自己的 YAML 解析。id 规则、`refKey`、节字母这类纯规则从 `src/shared/project-ids.js` 取；浏览器端脚本只 import `src/lib/` 下的文件（`fs.allow` 不放仓库源码）。
- `src/lib/loaders.js`、`src/content.config.js`：三个内容集合 projects / articles / concepts。
- `src/lib/remark-pinpoint.js`：`[[ ]]` → `<Ref>`，`<Section>` 编节号，给 `<Canvas>` 注入所在节的 id 和节号。哪一节、第几节由 `src/shared/article-structure.js` 决定，服务端派生画布用的是同一个走法：文章第 n 节就是画布上的第 n 个字母，节号和画布编号对得上。
- `src/lib/refs.js`：解析、命名空间检查、引用的 HTML（纯函数，有单测）。名字按 `refKey` 比较（不分大小写），与 `listProjects` 的撞名检查一致。
- `src/lib/site-data.js`：页面用的索引（used-by、空 ref）。
- `src/lib/site-errors.js`：布局错误在站点上怎么显示。错误从 `listProjects` 到内容集合一路是对象（`src/shared/project-errors.js`），这里拼成 `project "<id>": …` 一行；文章页的错误条按 `path` 分出这篇自己的错误。
- `src/lib/canvas-card.js`：卡片模型与 URL（纯函数，有单测）；`canvas-card-client.js`：浏览器端量帧尺寸（只认嵌入帧页的 `data-pp-stage` / `data-pp-device`）、读未处理标注数。
- `src/lib/canvas-overlay.js`：浮层的 hash、缩放、上一节 / 下一节（纯函数，有单测）；`canvas-overlay-client.js`：浮层的浏览器端；`components/CanvasOverlay.astro`：浮层空壳，经 `Base.astro` 的 `overlay` 槽放在 `#article` 之外。
- `src/lib/layers.js`：弹层栈（Esc 只关最上层）。`src/lib/client.js`：深浅色、目录高亮、`[[ ]]` popup、概念抽屉。
