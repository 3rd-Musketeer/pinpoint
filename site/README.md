# site/：article 站点（Astro）

pp3 的文章层。内容不在这里：站点读 registry 里登记的 project（`kind: "project"`），每个 project 的内容在 `<project 根>/docs/pinpoint/`（结构见 `tasks/2026-10-13-pp3/briefs/common.md` §1）。这里只放站点代码。

## 跑起来

```bash
npm run site:dev      # http://127.0.0.1:4530，PINPOINT_SITE_PORT 改端口；registry 取 PINPOINT_REGISTRY，否则 ~/.pinpoint/registry.json
npm run site:build    # 产物在 site/dist/；PINPOINT_SITE_OUT、PINPOINT_SITE_CACHE 改产物与缓存目录
npm run test:site     # 用 site/fixtures/ 构建两遍：路由、[[ ]] 解析、空 ref、撞名报错
```

pinpoint 服务这样拉起：`PINPOINT_SITE_VITE_BASE=/_astro/ npm run -s site:dev -- --port <端口> --host 127.0.0.1 --ignore-lock`。

- `--ignore-lock`：Astro 7 检测到 agent 环境会自己转后台并退出，服务要的是它管得住的前台子进程。agent 手动起 dev 也要带上。脚本里不内置这个参数，重复传会让 Astro 读成数组、判定失效。
- `PINPOINT_SITE_VITE_BASE`：服务自己是 Vite，占着 `/@vite/`、`/@fs/`、`/@id/`、`/node_modules/` 和根路径的 HMR socket。设了它，Astro dev 的内部资源和 HMR 都走 `/_astro/…`；页面 URL 仍是 `/<project>/…`（`astro.config.mjs` 里的中间件把 base 外的请求补上前缀）。站点 `base` 始终是 `/`。

开发服务器启动时把各 project 根加进 Vite `fs.allow`；之后新登记的 project 要重启 dev 才能加载其中的静态资源。内容文件和 registry 改了会自动重载。

## 路由

| URL | 内容 |
| --- | --- |
| `/<project>/` | 文章列表、概念、空 ref 列表 |
| `/<project>/<article>/` | 文章：左目录（sections）、正文、右评论栏（M2 占位）、概念抽屉 |
| `/<project>/concepts/<名字>/` | 概念：状态、定义、正文、用到它的文章 |
| `/<project>/llms.txt` | agent 视图：全部文章 MDX 原文（保留 `[[ ]]`）与概念 |

article id `concepts` 保留给概念路由，用了构建报错。

## 写文章（`articles/<id>/index.mdx`）

frontmatter：`title`（缺省用 id）、`summary`（导语，也是 popup 和列表里的一句话）、`order`（列表次序，可省）。

下面两个组件不用 import，站点自动提供：

- `<Section id="flow" title="付款前的确认">…</Section>`：一节。`id` 必填，字母数字 `_` `-`，文中唯一，就是 DOM id（`#flow`）和画布的 section id；字母引用号 A、B … 按出现顺序自动编，目录从这里来。不能嵌套。
- `<Canvas frames={["ask", "confirm"]} />`：这一节的画布卡片，写在 `<Section>` 里，一节最多一个。帧 id 是本篇目录下的 `<帧 id>.jsx`，不能写 `<page>/<screen>`。`shell="comp"` 这类非手机机壳按帧自己的盒子显示。卡片显示节字母、节标题、帧号范围与帧数，每帧一个懒加载 iframe（`/api/frame?page=<画布页>&screen=<帧>&annotate=off`），卡片里不能点、不能标注；点帧或“打开画布 →”到画布页并定位到这一节（`/?page=<画布页>&section=<节 id>`）。该节有未处理（open）的画布标注时头部显示条数，读不到标注就不显示。缺帧、跨页引用这类错误在卡片里列出。有画布节的文章，顶栏多一个“画布视图”。

## `[[ ]]` 引用

- `[[名字]]`：本 project 的 article（按 id）或 concept（按 `name`）。两者共用命名空间，撞名构建失败（dev 下页面顶上显示错误）。
- `[[project:名字]]`：别的 project；前缀不是已登记的 project id 时，整串当名字。
- `[[名字|显示文字]]`：换显示文字。
- 找不到目标的是空 ref：虚线样式，列在 project 首页和文章的概念抽屉里。代码里的 `[[ ]]` 不解析。

popup：article 显示标题、摘要、读全文；concept 显示定义、状态、用到它的文章；空 ref 显示还没有页。

## 概念（`concepts/<名字>.md`）

frontmatter：`name`（缺省用文件名，`[[ ]]` 按它解析）、`status`（占位 / 收敛中 / 已固定）、`boundary`（一句边界；缺省取正文第一段）。字段规则与解析器在 `docs/projects.md`，站点只用 `listProjects` 读出的值。概念页地址用文件名：`/<project>/concepts/<slug>/`。正文里也能写 `[[ ]]`。

## 代码地图

- `src/lib/projects-source.js`：唯一读 registry / project 的地方，用服务与 CLI 共用的 `loadRegistry` + `listProjects`（`src/server/lib/projects.js`）。文章的 title、summary 与概念的 name、slug、status、boundary 都取它的结果，不取 Astro 自己的 YAML 解析。
- `src/lib/loaders.js`、`src/content.config.js`：三个内容集合 projects / articles / concepts。
- `src/lib/remark-pinpoint.js`：`[[ ]]` → `<Ref>`，`<Section>` 编字母。
- `src/lib/refs.js`：解析、命名空间检查、引用的 HTML（纯函数，有单测）。名字按 `refKey` 比较（不分大小写），与 `listProjects` 的撞名检查一致。
- `src/lib/site-data.js`：页面用的索引（used-by、空 ref）。
- `src/lib/canvas-source.js`：唯一取文章画布（`articleCanvas`、`articlePageId`）的地方。包 E 合入前由 `canvas-stub.js` 从 MDX 读出同形状的数据，合入后改这一行 import。
- `src/lib/canvas-card.js`：卡片模型与 URL（纯函数，有单测）；`canvas-card-client.js`：浏览器端量帧尺寸、读未处理标注数。
