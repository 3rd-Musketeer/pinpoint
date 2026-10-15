# 0044 · project 退为一批文章的容器；`/` 是 blog 首页，工作台挪到 `/workbench/`

Status: 现行 · Date: 2026-10-15 · Revises-in-part: 0042（project 是文章模型的顶层、读者面前显示 project 标题；工作台在 `/`） · Scope: `site/src/pages/index.astro`、`site/src/pages/[project]/[article]/index.astro`、`site/src/layouts/Base.astro`、`site/src/lib/canvas-card.js`、`src/shared/article-feed.js`、`src/shared/workbench-url.js`、`src/server/lib/workbench-routes.js`、`src/server/workbench-routes.js`、`src/server/lib/article-routes.js`、`src/server/lib/projects.js`、`src/server/lib/article-check.js`、`index.html`、`bin/cli/`、两个 skill

**起因**：0042 把 project 定成文章模型的顶层，文章页顶栏和大标题上方都写着 project 标题。agent 给 project 起的 title 常常是一句描述，和文章标题挤在一起，读者看到两遍主题。owner 2026-10-15：“我想 KISS，project 这个概念我提的有点早了，其实他就是 folder，用来管理一批 article，真正重要且承载信息的应该是 article”。

**Decided**（2026-10-15 owner，加实现时自定的部分）：

- **project 是装一批文章的容器**，承载信息的是文章。“project”这个词、CLI、`project.json`、`ppnt` 的写法这次都不改名，改不改另定。
- **读者面前不显示 project 标题**。文章页顶栏从“全部文章”（`/`）起，去掉 project 标题那段和大标题上方的 project 小字；project 换成标题下的一个小标签，链到 `/<project>/`。浏览器标签页的标题只用文章标题。project 首页 `/<project>/` 保留，是这个文件夹里的文章列表。
- **project 的 title 只写短名字**（Vault、Areta browser use）。title 带全角或半角冒号、或超过 24 个字符时，`ppnt check` 给一条提示，不算错误。
- **`/` 是 blog 首页**（owner 选 A）：所有登记 project 的全部文章，按最近修改时间倒序。frontmatter 写了合法的 `date`（`YYYY-MM-DD`）就用它，否则用 `index.mdx` 的修改时间；`date` 写错不报错（实现自定）。每条是标题、summary、project 小标签和日期。首页顶栏有“工作台”入口（实现自定）。
- **工作台挪到 `/workbench/`**：画布视图是 `/workbench/?page=<页 id>`，`mode`、`entry`、`tab`、`section` 照旧。旧地址 `/?<参数>` 和 `/index.html[?<参数>]` 302 到 `/workbench/`，参数原样带上；不带参数的 `/` 是首页。`/sites/…`、`/annotate.js`、`/api/…`、`/kits/…`、`/previews/…` 不变。
- **壳页仍是仓库根的 `index.html`**，服务把 `/workbench/` 改写成它（实现自定）。板和清单里的地址是相对站点根写的（`sites/<id>/…`、`previews/…`、帧片段里的资源），壳页加 `<base href="/">`，它们照旧按 `/` 解析。

**Why**：读者打开链接是为了读文章，project 只回答“这篇和哪几篇放在一起”，用一个小标签就够了。首页按时间列出全部文章，最近在改的设计一眼可见，像 blog 的首页。工作台是 owner 和 agent 改稿的地方，不是读者的入口，所以让出 `/`。旧链接散在 task、ADR 和聊天记录里，302 让它们照常能打开。

**否掉的**：

- 把 `index.html` 搬进 `workbench/` 目录：仓库里按壳页路径读样式与 token 的代码（`frame-doc.js` 等）都要跟着改，`<base>` 的问题也还在。
- 首页按 project 分组：project 退为容器后，分组又把 project 标题摆回读者面前。
