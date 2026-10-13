# project：目录、登记与读取

project 是 pp3 的顶层：一个 project 下面有多篇 article（设计文档）和多个 concept（wiki 词条）。
一个 project 在 registry 里登记成一条 `kind: "project"` 的条目，`path` 是 project 根目录，
内容住在根目录下的 `docs/pinpoint/`。article 与 concept 的定义见 [`CONTEXT.md`](../CONTEXT.md)。

## 目录

目录结构是定死的（2026-10-13 grilling）：

```text
<project 根>/docs/pinpoint/
  project.json                 # { "id": "browser-use", "title": "…" }
  articles/<article id>/
    index.mdx                  # 正文，frontmatter 写 title、summary
    <帧 id>.jsx
    components/<Name>.jsx      # 本篇专用
    assets/
  concepts/<名字>.md           # frontmatter 写 name、status、boundary
  components/<Name>.jsx        # project 内共用；跨 project 进 kit
```

- `project.json` 必须有。`id` 与 page id 同一个模式 `^[a-z0-9][a-z0-9-]*$`，并且不能是保留名（见下面“保留名”一节）。`title` 可选，缺省用登记时的标题。
- article id 就是 `articles/` 下的目录名，同一个模式。`concepts` 不能当 article id，`/<project>/concepts/` 已被概念页占用。
- 每个 article 目录必须有 `index.mdx`。`articles/` 下只放目录；目录名不合模式、名叫 `concepts`、缺 `index.mdx`、或是散文件，这一项不进 `articles`，同时记一条布局错误。以 `.` 开头的名字忽略。
- `concepts/` 下只放 `<名字>.md`；子目录和其他文件不进 `concepts`，同时记一条布局错误。以 `.` 开头的名字忽略。
- concept 有两个名字：`name`（frontmatter，缺省用文件名）是显示名，也是 `[[ ]]` 的解析键；`slug`（文件名去掉 `.md`）是 URL 段，概念页是 `/<project>/concepts/<slug>/`。

## frontmatter

`index.mdx` 与 `concepts/*.md` 开头可以有 `---` 包起来的 frontmatter，每行一条 `key: value`：

| 文件 | 字段 | 缺省 |
| --- | --- | --- |
| `articles/<id>/index.mdx` | `title`、`summary`（可选） | `title` 缺省用 article id |
| `concepts/<名字>.md` | `name`、`status`（占位 / 收敛中 / 已固定）、`boundary`（一句边界） | `name` 缺省用文件名 |

每个值是单行字符串，可以用单引号或双引号包起来，不带引号时 ` #` 之后算注释。下面这些写法都记一条布局错误，该键不进结果、字段按缺省处理：

- 空值（`key:`），因此块列表 `tags:` 加下一行 `- a` 是两条错误；
- 以 `>`、`|`、`[`、`{`、`&`、`*`、`!` 开头的值（块标量、流式列表 / 映射、锚点、标签）；
- 不是 `key: value` 的行、重复的键、没闭合的引号；
- 没有结束的 `---`：整份文件当作没有 frontmatter，另记一条错误。

`status` 只能是 `占位`、`收敛中`、`已固定` 三者之一，写了别的值记一条错误、`status` 不出现。其他键照常解析，读取模块不使用。

Astro 也会按 YAML 解析同一段 frontmatter。为了让站点和 CLI 看到同一个标题，站点的 title、summary、name、status、boundary 必须取 `listProjects` 的结果（或调用同一个 `parseFrontmatter`），不另读 Astro 解析出的 frontmatter。frontmatter 只写上面的子集时，两边解析结果相同。

## 命名空间

`[[名字]]` 既能指向 article 也能指向 concept，所以同一个 project 里 article id 与 concept `name` 共用一个命名空间，两个 concept 也不能同名。比较时不分大小写、去掉首尾空白（Obsidian 同规则）：article `confirm-card` 与 concept `Confirm-Card` 算撞名。撞名的双方都照常列出，同时记一条布局错误。

## 登记

```shell
pinpoint add <project 根> --project
```

- id 只取 `project.json` 的 `id`。`--id` 可以写，但必须与它相同；要换 id 先改 `project.json`，或用 `pinpoint rename`。
- 标题只有一个来源：`project.json` 的 `title`。登记表里的 `title` 是登记时抄下的副本（`project.json` 没写 title 时用目录名），读取时 `project.json` 的 `title` 优先。所以 `--project` 不接受 `--title`。
- `--project` 不能与 `--title`、`--board`、`--page`、`--draft` 同用：project 不是页，没有壳，也不挂到别的页上。
- 登记前检查 `project.json` 存在、id 合法、不是保留名、不撞既有条目 id；不过关就退非零，registry 不动。article 层面的问题（撞名、缺 `index.mdx`）不拦登记，在读取时报。

| 命令 | 对 project 条目做什么 |
| --- | --- |
| `pinpoint move <id> <新根>` | 换根目录。新根的 `project.json` id 必须仍是 `<id>`，否则拒绝 |
| `pinpoint rename <旧 id> <新 id>` | 登记表、标注桶、`project.json` 的 `id` 一起改；新 id 是保留名时拒绝 |
| `pinpoint remove <id>` | 只删登记，project 目录不动；标注桶的规则与其他条目相同 |
| `pinpoint list` | 页表之后列 project：首行 id · 标题 · 文章数 · 概念数 · 布局错误数，次行根目录，下面每篇文章缩进一行。关键词也匹配文章 id 与标题 |
| `pinpoint list <project id>` | 列这个 project 的文章（标题、摘要、文件）、概念（name、status、boundary、文件）和布局错误；有布局错误时退 1 |
| `pinpoint status` | `project` 一行：个数与布局错误数，有错误时是“注意”，逐条列在下面，不算失败 |

project 条目与 page 条目共用 registry 的 id 命名空间（同一个 `entries` 数组），但不是页：不出现在工作台的 Pages、`GET /registry` 的 `entries`、`/sites/`、`--page` 挂靠目标和左栏文件夹里。

## 读取

`src/server/lib/projects.js` 是唯一的读侧，Astro 站点、服务和 CLI 都用它：

- `listProjects(registry)`：按登记顺序返回全部 project。
- `findProject(registry, id)`：一个 project，没登记返回 `null`。

`registry` 是 `loadRegistry({ path, root })`（`src/server/lib/registry.js`；`path` 缺省读 `PINPOINT_REGISTRY` 或 `~/.pinpoint/registry.json`）的结果，或服务的 registry store（`src/server/lib/registry-store.js` 的 `createRegistryStore`）。读的是它的 `projects`：`loadRegistry` 把 `kind: "project"` 的条目放在这里，不放进 `entries`。站点进程不经过服务时，自己调 `loadRegistry` 再调 `listProjects`。返回形状：

```json
{
  "id": "e2e-project",
  "title": "E2E Project",
  "root": "/abs/project-site",
  "dir": "/abs/project-site/docs/pinpoint",
  "articles": [{ "id": "commit-confirm", "title": "提交前确认", "summary": "…", "pageId": "e2e-project_commit-confirm", "dir": "/abs/…/articles/commit-confirm", "file": "/abs/…/articles/commit-confirm/index.mdx" }],
  "concepts": [{ "name": "confirm-card", "slug": "confirm-card", "status": "收敛中", "boundary": "…", "file": "/abs/…/concepts/confirm-card.md" }],
  "errors": []
}
```

- article 按 id、concept 按 `name` 用 `String.prototype.localeCompare`（运行环境的缺省 locale）排序。`summary`、`status`、`boundary` 没写时不出现。
- 读取从不抛错。根目录不存在、缺 `docs/pinpoint/`、`project.json` 缺失或坏掉、id 与登记的不一致、撞名、frontmatter 看不懂、目录里放错东西，都写进这个 project 的 `errors`（字符串）。文章和概念的错误以相对 `docs/pinpoint/` 的路径开头（`articles/x/index.mdx：…`）；根目录、`docs/pinpoint/`、`project.json` 这三处的错误带绝对路径，因为这三处本身就是相对路径的起点。根目录或 `docs/pinpoint/` 不在时 `articles` 与 `concepts` 为空；`project.json` 坏了照样读文章。
- 每次调用都重读磁盘，加文章不用 reload。

同一模块还导出这几个，站点需要时直接用：

- `parseFrontmatter(text)` → `{ data, body, errors }`：上面那套 frontmatter 子集。
- `refKey(name)`：`[[ ]]` 命名空间的比较键（NFC、去首尾空白、小写）。解析 `[[名字]]` 时拿它同时比 article id 与 concept `name`。
- `RESERVED_PROJECT_IDS`（转出 article-routes.js 的表）、`RESERVED_ARTICLE_IDS`、`CONCEPT_STATUSES`、`PROJECT_CONTENT_DIR`（`docs/pinpoint`）。
- `articlePageId`、`parseArticlePageId`、`ARTICLE_PAGE_ID_PATTERN`：文章画布的页 id，见“文章的画布”。

HTTP：`GET /api/projects` 返回 `listProjects` 的数组，`GET /api/projects/<id>` 返回一个 project，没登记 404。`GET /health` 的 `registry.projects` 是 project 条目数，顶层 `projects` 是 `{count, errors}`，errors 每条前缀 `<project id>: `。

## 文章的画布

每篇 article 的画布是一个由正文派生的页（pp3 M1）。正文里怎么写见 common-m1 §1 的定法，这里只记机制。

### 写法

```mdx
<Section id="confirm" title="确认卡">
正文……
<Canvas frames={["confirm-sheet", "confirm-done"]} />
</Section>

<Section id="variants" title="卡片做法">
<Canvas frames={["card-plain"]} shell="comp" />
</Section>
```

- 一节最多一个 `<Canvas>`；没有 Canvas 的节不进画布。帧 id = 本篇目录下的 `<帧 id>.jsx`。
- `frames` 只认字面量数组，每一项只认字面量字符串；`shell` 可选，只认字面量字符串，取值同 board 的 section `shell`（`app` 缺省 / `lock` / `doc` / `comp`）。
- 解析用站点同一套 MDX 解析器（`unified` + `remark-parse` + `remark-mdx`），只读结构，不渲染正文。实现在 `src/server/lib/article-canvas.js`。

### 页 id

`articlePageId(projectId, articleId)`（`projects.js`）= `<project id>_<article id>`，例如 `browser-use_payment-confirm`。

- project id 与 article id 都匹配 `^[a-z0-9][a-z0-9-]*$`，没有 `_`。所以拆分无歧义，两篇文章不会得到同一个页 id；registry 条目 id 也不含 `_`，不会撞。
- 结果匹配 `PAGE_ID_PATTERN`（`^[a-zA-Z0-9_-]+$`），所以 `?page=`、标注桶、`/sites/<id>/`、`ppnt` 都认它。`parseArticlePageId(id)` 拆回 `{ projectId, articleId }`。
- 唯一可能撞的是 `content/previews/_index.json` 里带 `_` 的模板页。读取时逐篇检查，撞了记一条布局错误，模板页优先。
- `listProjects` 的每篇 article 多一个字段 `pageId`；`pinpoint list <project>` 在每篇文章下打一行“画布 <页 id>”。

### board 从哪来

- board 每次从 `index.mdx` 现派生（`src/server/lib/article-board.js` 的 `deriveArticleBoard`）。按 Section 顺序，只含有 Canvas 的节。每节是 `{ id, title, layout: "row", letter, shell?, screens: [{ id }] }`。`letter` 是正文里的节字母，见下面“给站点卡片的接口”。顶层带 `title`（文章 title）和 `article: { project, id, url }`。
- 本篇的 `article.css`、`article.js` 存在就进 `assets`，和手写 board 的 `assets` 一样注入每帧。
- 编译时派生的 board 写进 `<dist>/<页 id>/board.json`，从不写回文章目录。
- 组件：帧里写 `import { X } from './components/X.jsx'`。本篇 `components/X.jsx` 没有就用 project 的 `docs/pinpoint/components/X.jsx`，再没有就用 `pinpoint/kit` 的同名印章。
- 编译目标 `resolvePageTarget(<页 id>, { registry })` 返回 `kind: "article"`，`pageDir` 是文章目录，`urlBase` 是 `/sites/<页 id>/`。之后编译、`/sites/<页 id>/`（board.json、帧、资源）、`/api/frame`、工作台、`ppnt build / check / locate / mark / shot / list --frames / status --page`、编号（`boardRefs`）都按普通页工作。
- dist 是否过期：比对现派生的 board 与 dist 里那份，不看 `index.mdx` 的 mtime，因为改正文不等于改画布。
- watch：服务把每个登记 project 的 `docs/pinpoint/` 加进 watcher。`articles/<文章>/` 下的帧、组件、`article.css` / `article.js` 变更会重编这篇并通知工作台。`index.mdx` 变更时先比对派生 board：没变就不编、不通知，变了就整页重编。project `components/` 变更时，这个 project 的每一篇都重编。`ppnt build <页 id> --watch` 只盯文章目录。

### 不进 Pages

画布页属于文章，不出现在工作台左栏 Pages、`GET /registry` 的 `entries` 和 `ppnt list` 的页表里。`GET /registry` 另带 `articles: [{ id, title, project, article, url }]`，工作台把它放进清单的 `articles`。`pageEntry` 认得这份清单，所以 `/?page=<页 id>` 能打开，加 `&section=<节 id>` 能定位到那一节。同 id 的模板页或登记页优先。

### 标注桶

一篇文章的画布标注和正文评论共用一个桶，桶 id 就是画布页 id。文章页（`/<project>/<article>/…`）注入的标注客户端以它为桶；project 首页、概念页仍以 project id 为桶。`resolveRequestEntry` 认这两种桶。

### 错误

下面这些写法都记进这个 project 的 `errors`，格式是 `articles/<文章>/index.mdx：第 N 行：…`。`pinpoint list <project>` 和站点错误条会显示它们，读取本身不抛错。

- 跨页引用 `"<page>/<screen>"`：提示先把帧迁进本篇目录。
- 帧文件不存在：帧仍进画布，工作台上那一格出错误面板。
- 一节两个 `<Canvas>`：只用第一个。
- 重复的节 id：第二个不进画布。
- 其他都是错误：`frames` 或 `shell` 不是字面量、`shell` 取值不对、`frames` 为空、帧 id 不合法、同一帧出现在两节、`<Canvas>` 写在 Section 外、Section 嵌套、MDX 本身写坏。

### 给站点卡片的接口

`articleCanvas(projectId, articleId, { registry? })`（`article-board.js`，`projects.js` 转出）。`registry` 缺省读 `loadRegistry()`。HTTP 是 `GET /api/projects/<project>/articles/<article>/canvas`，project 没登记时 404：

```json
{
  "pageId": "e2e-project_commit-confirm",
  "project": "e2e-project",
  "article": "commit-confirm",
  "sections": [
    { "id": "confirm", "title": "确认卡", "letter": "B",
      "frames": [{ "id": "confirm-sheet", "ref": "B1" }, { "id": "confirm-done", "ref": "B2" }] },
    { "id": "variants", "title": "卡片做法", "letter": "C", "shell": "comp",
      "frames": [{ "id": "card-plain", "ref": "C1" }] }
  ],
  "errors": []
}
```

- `letter` 是这一节在正文里的字母。正文所有 Section 一起数，纯文字的节也占一个字母（上例的 A 是纯文字的 `why`）。派生 board 的每节带同一个 `letter`，`boardRefs` 用它编号，所以工作台图注、大纲、`ppnt` 的 `B1` 和文章节标题对得上。
- 没有源文件的帧带 `"missing": true`，画布上那一格是错误面板。
- `errors` 是 `[{ message, line?, section?, frame? }]`。属于某一节的错误带 `section`（节 id），属于某一帧的再带 `frame`。不属于任何节的错误是页级错误：frontmatter、页 id 撞名、MDX 写坏、Canvas 在节外、重复的节 id。`message` 与 `listProjects` 里这篇的布局错误是同一句，只去掉 `articles/<文章>/index.mdx：` 前缀。
- 文章不存在或 project 没登记时，`sections` 为空，`errors` 说明原因。
- 帧卡片的 iframe 用 `/api/frame?page=<pageId>&screen=<帧 id>&annotate=off`，打开画布用 `/?page=<pageId>&section=<节 id>`，这一桶的画布账本是 `GET /annotations/%40canvas?entry=<pageId>`。

## 保留名

project id 是站点 URL 的第一段（文章 `/<project>/<article>/`、首页 `/<project>/`、概念 `/<project>/concepts/<slug>/`、`/<project>/llms.txt`），不能占服务已用的首段。唯一的清单是 `src/server/lib/article-routes.js` 的 `RESERVED_TOP_SEGMENTS`（外加前缀 `test-results*`、`playwright-report*`），服务路由和登记校验用同一份；`projects.js` 的 `RESERVED_PROJECT_IDS`、`isReservedProjectId` 只是它的转出口。清单包括：

- 2026-10-13 定的 `api sites workbench kits assets annotate _astro`；
- 服务路由 `health registry events annotations images image save previews lib`；
- vite 按仓库根服务静态文件，仓库根的顶层目录也都是首段：`src content node_modules bin docs e2e scripts skills site tasks prototypes`，以及 e2e 产物目录前缀。`projects.test.js` 与 `article-routes.test.js` 都检查仓库根的每个顶层目录都在清单里，新增顶层目录时测试会提醒补上；
- Astro 的 `_image`。

article id `concepts` 保留（`RESERVED_ARTICLE_IDS`，它是概念页的第二段），只在 `projects.js` 里。

## 固件

- `e2e/project-site/`：project `e2e-project`，两篇文章（`commit-confirm`、`takeover`）、两个概念（`confirm-card`、`takeover-banner`），没有布局错误。正文里有指向文章、概念和一个空 ref 的 `[[ ]]`。`commit-confirm` 有画布：三个 Section，其中两节有 Canvas（`confirm`：`confirm-sheet`、`confirm-done`；`variants`：`card-plain`，`shell="comp"`）。帧用到本篇组件 `ConfirmCard`、project 共用组件 `Banner` 和 kit 的 `Nav`，本篇有 `article.css`。
- `e2e/project-collide/`：project `e2e-collide`，article `confirm-card` 与 concept `Confirm-Card` 撞名，读取时恰好一条布局错误。

两个固件都没有登记进 e2e 的共享 registry 固件。
