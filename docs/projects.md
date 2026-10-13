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
| `pinpoint rename <旧 id> <新 id>` | 登记表、`project.json` 的 `id`、每个文章桶一起改，见下面“rename 与文章桶”；新 id 是保留名时拒绝 |
| `pinpoint remove <id>` | 只删登记，project 目录不动。每个文章桶 `<id>_<文章>/` 守其他条目的桶规则：有一个桶里有标注行就整单拒绝（列出哪些桶几行），全空就跟着删 |
| `pinpoint list` | 页表之后列 project：首行 id · 标题 · 文章数 · 概念数 · 布局错误数，次行根目录，下面每篇文章缩进一行。关键词也匹配文章 id 与标题 |
| `pinpoint list <project id>` | 列这个 project 的文章（标题、摘要、文件）、概念（name、status、boundary、文件）和布局错误；有布局错误时退 1 |
| `pinpoint status` | `project` 一行：个数与布局错误数，有错误时是“注意”，逐条列在下面，不算失败 |

### rename 与文章桶

project id 本身不是桶，project 的桶是每篇文章的 `<id>_<文章>/`。`pinpoint rename <旧 id> <新 id>` 对 project 条目这样做：

- 扫数据根下所有 `<旧 id>_<文章>/`，按盘上的桶扫，不按现有文章扫，所以文章已删的孤儿桶也一起带走。带 `_` 的模板页 id 不算。
- 预检：任何一个 `<新 id>_<文章>/` 已存在，或撞上模板页 id，就整单拒绝，登记表、`project.json`、桶都不动。
- 每个桶一次 `rename`，单桶原子，逐行打印搬了什么。搬完改写桶里账本的旧地址：行上的 `pageId`，`@prose.json` 的 `path`（`/<旧 id>/<文章>/` 换成 `/<新 id>/<文章>/`）。
- 按页 id 存的派生物：`shot/`、`check/` 里的图跟着搬；`dist/`、`render/` 里的 HTML 写死了 `/sites/<旧页 id>/`，删掉。有 dist 的文章按新页 id 重编一次，和 `ppnt build <页>` 用同一个编译器。
- 源文件不改。`docs/pinpoint/` 下写死了 `/sites/<旧 id>_` 的文件（帧里引用资源的绝对地址）逐个列在警告里，作者自己改成新地址或相对路径。
- 工作台在浏览器里记的偏好（上次打开的页、tab）是 localStorage，不在服务端，rename 碰不到；旧页 id 的那几条自然失效。

### 文章目录改名

`articles/a` 改名成 `articles/b` 不会自动处理，也没有专门的命令：改名还要改别的文章里的 `[[a]]`，CLI 做不全。改名后 `<project>_a` 不再是页，它的桶整桶皆孤儿（`ppnt status --page <project>_a` 与 `ppnt check <project>_a` 会列出来）。要保留标注，先停服务，手工把桶和缓存挪过去：

```shell
mv ~/.pinpoint/<project>_a ~/.pinpoint/<project>_b      # 桶；PINPOINT_DATA_DIR 设了就换成它
rm -rf ~/.pinpoint/dist/<project>_a                     # dist 写死旧地址，重编即可
ppnt build <project>_b
```

手工挪时，桶里行上的 `pageId` 和 `@prose.json` 的 `path` 还是旧值（project rename 会改写它们，手工挪不会）。不要这些标注的话，直接 `ppnt prune <project>_a`。

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
  "articles": [{ "id": "commit-confirm", "title": "提交前确认", "summary": "…", "pageId": "e2e-project_commit-confirm", "dir": "/abs/…/articles/commit-confirm", "file": "/abs/…/articles/commit-confirm/index.mdx", "canvasSections": 3 }],
  "concepts": [{ "name": "confirm-card", "slug": "confirm-card", "status": "收敛中", "boundary": "…", "file": "/abs/…/concepts/confirm-card.md" }],
  "errors": []
}
```

- article 按 id、concept 按 `name` 用 `String.prototype.localeCompare`（运行环境的缺省 locale）排序。`summary`、`status`、`boundary` 没写时不出现。
- 读取从不抛错。根目录不存在、缺 `docs/pinpoint/`、`project.json` 缺失或坏掉、id 与登记的不一致、撞名、frontmatter 看不懂、目录里放错东西，都写进这个 project 的 `errors`。每条是对象 `{ code, message, path?, section?, frame?, line? }`（`src/shared/project-errors.js`）：`code` 是种类，给程序分辨用；`message` 是显示的那句话；文章和概念的错误带 `path`，相对 `docs/pinpoint/`（`articles/x/index.mdx`、`articles/x`、`concepts/a.md`）；画布写法的错误另带 `section`、`frame`、`line`（见“文章的画布”）。根目录、`docs/pinpoint/`、`project.json` 和撞名是 project 自己的错误，没有 `path`，根目录、`docs/pinpoint/`、`project.json` 这三处的 message 里写绝对路径，因为这三处本身就是相对路径的起点。拼成一行字只在显示的那一头做，用 `formatProjectError`：有 `path` 的写成 `articles/x/index.mdx：…`。`pinpoint list`、`/health`、站点错误条、工作台左栏的 tooltip 都这样显示。根目录或 `docs/pinpoint/` 不在时 `articles` 与 `concepts` 为空；`project.json` 坏了照样读文章。
- `canvasSections` 是画布上的节数：带 `<Canvas>` 且列了帧的节。0 表示这篇没有画布，工作台左栏点它直接打开正文（见下面“工作台左栏”）。
- 每次调用都重读磁盘，加文章不用 reload。

同一模块还导出 `readProjectJson(root)`、`CONCEPT_STATUSES`、`PROJECT_CONTENT_DIR`（`docs/pinpoint`）。不读盘的规则放在叶子模块 `src/shared/project-ids.js`，服务、CLI、站点和工作台都从这里取，不再各抄一份：

- `articlePageId(projectId, articleId)` → `<project>_<article>`：一篇文章的页 id，也是它的标注桶（画布标注与正文评论共用）；`parseArticlePageId` 拆回来，`ARTICLE_PAGE_ID_PATTERN` 是它的形状，见“文章的画布”。一个页 id 现在是不是一页（文章画布页要 project 登记了、`index.mdx` 在盘上）只问 `src/server/lib/page-resolve.js`：`resolvePage(registry, id, { manifestIds })` 答它是登记条目、模板页、文章画布页还是不是页，`pageIdIsLive` 是它的布尔版。服务收标注时的桶校验、`ppnt prune`、`status` / `check` 的整桶孤儿报告、`/sites/<id>/`、`/api/frame` 都用它。
- `refKey(name)`：`[[ ]]` 命名空间的比较键（NFC、去首尾空白、小写）。解析 `[[名字]]` 时拿它同时比 article id 与 concept `name`。
- `RESERVED_TOP_SEGMENTS`、`isReservedProjectId`、`RESERVED_ARTICLE_IDS`：保留名，见下面“保留名”。
- `SECTION_ID_PATTERN`、`FRAME_ID_PATTERN`、`CANVAS_SHELLS`、`sectionLetter`：正文画布写法的规则与节字母。
- `CANVAS_LEDGER`（`@canvas`）、`PROSE_LEDGER`（`@prose`）：桶里两本固定账本的名字。

frontmatter 子集的解析器 `parseFrontmatter(text)` → `{ data, body, errors }` 在 `src/server/lib/frontmatter.js`。

HTTP：`GET /api/projects` 返回 `listProjects` 的数组，`GET /api/projects/<id>` 返回一个 project，没登记 404。`GET /health` 的 `registry.projects` 是 project 条目数，顶层 `projects` 是 `{count, errors}`，errors 是给 `pinpoint status` 显示的字符串，每条是 `<project id>: ` 加 `formatProjectError` 的结果。

## 文章的画布

每篇 article 的画布是一个由正文派生的页。正文里怎么写见 `site/README.md` 与 `skills/pinpoint-build`，这里只记机制。

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

```jsx
// confirm-bare.jsx：和手机帧同在一节，这一帧单独是裸组件
export const shell = "comp";

export default function ConfirmBare() {
  return <ConfirmCard />;
}
```

- 一节最多一个 `<Canvas>`；没有 Canvas 的节不进画布。帧 id = 本篇目录下的 `<帧 id>.jsx`。
- `frames` 只认字面量数组，每一项只认字面量字符串；`shell` 可选，只认字面量字符串，取值同 board 的 section `shell`（`app` 缺省 / `lock` / `doc` / `comp`）。
- 帧级 shell：一节里混着手机帧和组件帧时，组件帧的文件在顶层写一行 `export const shell = "comp";`。取值和 `<Canvas shell>` 一样，只认这一行的字面量字符串。它只管这一帧，盖过 `<Canvas shell>`。服务静态读这一行（`readFrameShell`），不执行帧文件。编译器的帧 lint 放行这一行。
- 解析用站点同一套 MDX 解析器（`unified` + `remark-parse` + `remark-mdx`），只读结构，不渲染正文。实现在 `src/server/lib/article-canvas.js`。哪个节点属于哪一节、第几节、节字母，由 `src/shared/article-structure.js` 的 `articleStructure(tree)` 走一遍 mdast 得出；站点的 remark 步骤（节标题字母、给 `<Canvas>` 注入 `section`）和 `ppnt check` / `locate` 判断正文评论的引文落在哪一节（`articleSectionSpans`）用的是同一个走法，所以三处数出来的节对得上。

### 页 id

`articlePageId(projectId, articleId)`（`projects.js`）= `<project id>_<article id>`，例如 `browser-use_payment-confirm`。

- project id 与 article id 都匹配 `^[a-z0-9][a-z0-9-]*$`，没有 `_`。所以拆分无歧义，两篇文章不会得到同一个页 id；registry 条目 id 也不含 `_`，不会撞。
- 结果匹配 `PAGE_ID_PATTERN`（`^[a-zA-Z0-9_-]+$`），所以 `?page=`、标注桶、`/sites/<id>/`、`ppnt` 都认它。`parseArticlePageId(id)` 拆回 `{ projectId, articleId }`。
- 唯一可能撞的是 `content/previews/_index.json` 里带 `_` 的模板页。读取时逐篇检查，撞了记一条布局错误，模板页优先。
- `listProjects` 的每篇 article 多一个字段 `pageId`；`pinpoint list <project>` 在每篇文章下打一行“画布 <页 id>”。

### board 从哪来

- board 每次从 `index.mdx` 现派生（`src/server/lib/article-board.js` 的 `deriveArticleBoard`）。按 Section 顺序，只含有 Canvas 的节。每节是 `{ id, title, layout: "row", letter, shell?, screens: [{ id, shell? }] }`。screen 的 `shell` 来自帧文件的 `export const shell`。`letter` 是正文里的节字母，见下面“给站点卡片的接口”。顶层带 `title`（文章 title）和 `article: { project, id, url }`。
- 本篇的 `article.css`、`article.js` 存在就进 `assets`，和手写 board 的 `assets` 一样注入每帧。
- 编译时派生的 board 写进 `<dist>/<页 id>/board.json`，从不写回文章目录。
- 组件：帧里写 `import { X } from './components/X.jsx'`。本篇 `components/X.jsx` 没有就用 project 的 `docs/pinpoint/components/X.jsx`，再没有就用 `pinpoint/kit` 的同名印章。
- 编译目标 `resolvePageTarget(<页 id>, { registry })` 返回 `kind: "article"`，`pageDir` 是文章目录，`urlBase` 是 `/sites/<页 id>/`。之后编译、`/sites/<页 id>/`（board.json、帧、资源）、`/api/frame`、工作台、`ppnt build / check / locate / mark / shot / list --frames / status --page`、编号（`boardRefs`）都按普通页工作。
- dist 是否过期：比对现派生的 board 与 dist 里那份，不看 `index.mdx` 的 mtime，因为改正文不等于改画布。
- watch：服务把每个登记 project 的 `docs/pinpoint/` 加进 watcher。`articles/<文章>/` 下的帧、组件、`article.css` / `article.js` 变更会重编这篇并通知工作台。帧里的 `export const shell` 改了，派生 board 就变了，这篇整页重编。`index.mdx` 变更时先比对派生 board：没变就不编、不通知，变了就整页重编。project `components/` 变更时，这个 project 的每一篇都重编。`ppnt build <页 id> --watch` 只盯文章目录。

### 不进 Pages

画布页属于文章，不出现在工作台左栏的“页面”组（Pages 列表）、`GET /registry` 的 `entries` 和 `ppnt list` 的页表里；左栏另有“文章”组列出它们，见下一节。`GET /registry` 另带 `articles: [{ id, title, project, article, url }]`，工作台把它放进清单的 `articles`。`pageEntry` 认得这份清单，所以 `/?page=<页 id>` 能打开，加 `&section=<节 id>` 能定位到那一节。同 id 的模板页或登记页优先。

### 工作台左栏

2026-10-13 起，工作台左栏“页面”tab 分两组：上面“文章”，下面“页面”。“页面”组就是原来的置顶、最近、文件夹与散页，存量页迁成文章之后撤掉。

- “文章”组读 `GET /api/projects`：每个登记的 project 是一行可折叠的标题（`project.json` 的 title），下面每篇文章一行，照 `listProjects` 的顺序。折叠是本机偏好 `prefs.articleProjectsCollapsed`。模型是 `src/workbench/lib/article-groups.js`，组件是 `src/workbench/app/ArticlesSection.jsx`。
- 有画布的文章（`canvasSections > 0`，且清单的 `articles` 认得它的画布页）：点行在工作台打开画布页 `<project>_<article>`，和 `/?page=` 是同一个页，选中态与页面行一样。没有画布的文章：点行在新标签页打开正文。
- 行尾“阅读”钮（tooltip“阅读正文”）在新标签页打开 `/<project>/<article>/`。常态不显示，行 hover 或键盘焦点进到行时出现。右键菜单有“阅读正文”，有画布的再加“复制 @page”。
- project 有布局错误时，标题行尾显示错误个数，tooltip 列前三条。
- 文章不归档、不置顶、不进文件夹、不能拖。文章画布不进“最近”，“最近”只算 Pages 列表里的页。
- 实时更新：`registry:update`（登记或移除 project）和 `projects:update` 都让左栏重读 `/api/projects`。`projects:update` 由 `preview-hmr` 发，载荷 `{ project }`：project 目录里有文件新建、修改或删除，并且列表那一层变了（project 标题、文章增删、文章标题与摘要、`canvasSections`、布局错误）。只改正文或帧内容不发。Vite 6 对新建和删除不调 `handleHotUpdate`，所以 `preview-hmr` 另外监听 watcher 的 `add` / `unlink`：新建的文章或帧在这里重编，画布页收到 `preview:update`。

### 标注桶

一篇文章的画布标注和正文评论共用一个桶，桶 id 就是画布页 id。文章目录删了、改名了，或 project 不再登记，这个页 id 就不再是页，桶整桶皆孤儿：`ppnt status --page <页 id>` 与 `ppnt check <页 id>` 列出它，`ppnt prune <页 id>` 清理。文章还在时 `prune` 只删桶里表面已死的账本，`@canvas.json` 与 `@prose.json` 恒活。文章页（`/<project>/<article>/`）注入的标注客户端以它为桶，只跑正文评论；project 首页、概念页、不存在的文章不注入。`resolveRequestEntry` 认画布页 id（project 登记了、这篇的 index.mdx 在盘上），project id 本身不是桶。

### 错误

下面这些写法都记进这个 project 的 `errors`，格式是 `articles/<文章>/index.mdx：第 N 行：…`。`pinpoint list <project>` 和站点错误条会显示它们，读取本身不抛错。

- 跨页引用 `"<page>/<screen>"`：提示先把帧迁进本篇目录。
- 帧文件不存在：帧仍进画布，工作台上那一格出错误面板。
- 一节两个 `<Canvas>`：只用第一个。
- 重复的节 id：第二个不进画布。
- 其他都是错误：`frames` 或 `shell` 不是字面量、`shell` 取值不对、`frames` 为空、帧 id 不合法、同一帧出现在两节、`<Canvas>` 写在 Section 外、Section 嵌套、MDX 本身写坏。
- 帧级 shell 写坏（不是那一行字面量、取值不对、写了两次）：错误带节和帧，行号是那个 `<Canvas>` 的行，末尾注明帧文件里的行（`（<帧>.jsx 第 N 行）`）。这一帧照进画布，用节的 shell。

### 给站点卡片的接口

`articleCanvas(projectId, articleId, { registry? })`（`article-board.js`；站点经 `site/src/lib/projects-source.js` 取）。`registry` 缺省读 `loadRegistry()`。HTTP 是 `GET /api/projects/<project>/articles/<article>/canvas`，project 没登记时 404：

```json
{
  "pageId": "e2e-project_commit-confirm",
  "project": "e2e-project",
  "article": "commit-confirm",
  "sections": [
    { "id": "confirm", "title": "确认卡", "letter": "B",
      "frames": [{ "id": "confirm-sheet", "ref": "B1" }, { "id": "confirm-done", "ref": "B2" }] },
    { "id": "variants", "title": "卡片做法", "letter": "C", "shell": "comp",
      "frames": [{ "id": "card-plain", "ref": "C1" }] },
    { "id": "mixed", "title": "手机和裸卡片", "letter": "D",
      "frames": [{ "id": "mixed-phone", "ref": "D1" }, { "id": "mixed-bare", "ref": "D2", "shell": "comp" }] }
  ],
  "errors": []
}
```

- `letter` 是这一节在正文里的字母。正文所有 Section 一起数，纯文字的节也占一个字母（上例的 A 是纯文字的 `why`）。派生 board 的每节带同一个 `letter`，`boardRefs` 用它编号，所以工作台图注、大纲、`ppnt` 的 `B1` 和文章节标题对得上。
- 没有源文件的帧带 `"missing": true`，画布上那一格是错误面板。
- 帧文件写了 `export const shell` 的帧带 `shell`。卡片按每帧自己的 shell 量尺寸：帧的 `shell`，没有就用节的。
- `errors` 是 `[{ code, message, path?, line?, section?, frame? }]`，就是 `listProjects` 里这篇的布局错误（`path` 在 `articles/<文章>` 下的那些）。属于某一节的错误带 `section`（节 id），属于某一帧的再带 `frame`。不属于任何节的错误是页级错误：frontmatter、页 id 撞名、MDX 写坏、Canvas 在节外、重复的节 id。站点按 `section` 分到卡片和页顶错误条，显示 `message`。
- 文章不存在或 project 没登记时，`sections` 为空，`errors` 说明原因。
- 帧卡片和画布浮层的 iframe 用 `/api/frame?page=<pageId>&screen=<帧 id>&annotate=off&embed=card`，打开画布用 `/?page=<pageId>&section=<节 id>`，这一桶的画布账本是 `GET /annotations/%40canvas?entry=<pageId>`。
- `embed=card` 是站点读帧的契约（`frame-doc.js` 的 `markEmbedStage`）：不出图注，不注入标注客户端，`<html>` 带 `data-pp-embed="card"`，第一个机壳带 `data-pp-stage="phone|comp|doc"`，手机机身带 `data-pp-device`。站点只认这几个属性量尺寸，不认工作台的 class 名；只加属性，机壳以下的 DOM 与画布同构。`embed` 只接受 `card`，别的值 400。

## 从存量页迁移

一个存量页（registry 的 dir 条目或模板页）迁成一篇 article，里面每个 board section 是一节，节里一个画布（2026-10-13 owner 定：存量 page = 一篇 article）。`pinpoint migrate` 把页的源码复制进 project，写出只有结构的正文，再逐帧和旧页对比。先看计划：

```shell
pinpoint migrate <页 id> --project <project 根> --dry-run
```

再写：

```shell
pinpoint migrate <页 id> --project <project 根> --article <文章 id>
```

- project 根下要已有 `docs/pinpoint/project.json`，没有就报错退出。project 不登记也能迁，登记了才能在服务里打开画布和正文。
- 文章 id 缺省用页 id，画布页 id 是 `<project>_<article>`。`articles/<文章 id>/` 已存在就拒绝，不覆盖。
- 旧页的文件和登记都不动。标注不迁：旧页的标注留在旧页的桶里，新文章用新桶 `<project>_<article>`，命令输出里也写明这一点。
- 新桶 `<project>_<article>` 在数据目录里已经有标注行（删掉或改了名的文章留下的孤儿桶）时拒绝，`--dry-run` 也一样：迁完这个 id 又是活页，旧行会挂到新文章上。换 `--article`，或先 `ppnt prune <project>_<article>`。

### 怎么对应

| 存量页 | 文章 |
| --- | --- |
| board 的一个 section | 一个 `<Section id title>`，里面一行占位注释 `{/* 正文 */}` 和一个 `<Canvas frames>`。section 的 shell（含 html 页的缺省 doc）写成 `<Canvas shell>`。没有帧的 section 只留 `<Section>` |
| 页 tab | 每个 tab 第一节前加一行 `## <tab 标题>`。二级标题不占节字母，节字母全文统一排（A、B、C…），旧页是每个 tab 各从 A 起 |
| `<帧>.jsx`、sidecar `<帧>.js` | 同名复制 |
| 单屏 shell（和节的不同） | 复制的帧文件末尾补一行 `export const shell = "…";`。补在末尾，前面的行号不变，`data-pp-id` 和旧页一致 |
| comp 屏（`comp` + `props`） | 生成 `<帧>.jsx`：import 那个组件（页内 `./components/<Name>.jsx`，没有就从 `pinpoint/kit`），props 写成属性。节是 comp 墙、或这一屏是 comp 时，文件里写 `export const shell = "comp";` |
| 帧 import 的组件和其他文件 | 按编译器的依赖记录（传递）照原相对路径复制，相对 import 不用改；没被用到的组件不复制 |
| `assets.css` | `article.css`。只有一份就是改名；几份按顺序拼起来，`@import` 提到最前 |
| `assets.js` | `article.js`。只有一份就是改名；几份照原路径复制，`article.js` 依次 import 它们 |
| 引用到的静态文件（图片、字体、音视频、pdf） | 复制到 `assets/<原相对路径>`（原本就在 `assets/` 下的不再套一层） |

地址改写：页地址 `/sites/<页>/x`（模板页是 `/previews/<页>/x`）换成 `/sites/<画布页>/…`，静态文件指到 `assets/x`，迁走的源文件指到新名字（页级 css 指到 `article.css`）。css 里的相对 `url()` 按 css 自己的位置重算。帧和组件里写的相对静态文件路径在运行时按页地址解析，所以按页根算，改成 `./assets/x`。拼出来的地址（`` `/sites/<页>/icons/${name}.svg` ``）找不到单个文件，就把 `icons/` 整个目录复制到 `assets/icons/`。

帧标题、section 的 `layout: "column"`、screen 的 `role` 不带过来，输出里各记一条“注意”。

### 拦下

下面这些情况一个文件都不写，逐条列出后退 1：`.html` 帧（文章只认 `.jsx`）、帧没有源文件、帧或组件 import 了页目录外的文件（kit 除外）、comp 屏的组件在页内和 kit 都找不到、同一帧出现在两节、section 或帧的 id 不合文章的规则、两份文件要写到同一个路径。

### 校验

写完之后从新的 `index.mdx` 派生 board（和服务同一条路），逐帧编译到临时目录，与旧页的渲染逐行比，打一张表：编号 · 帧 · 来源（复制 / comp 生成）· shell · 编译 · 与旧页。最后一列是“相同”、“只差地址”或“差 n 行”。“只差地址”指把旧页 HTML 里的旧地址换成新地址，再去掉几份资源合并后重复的注入行，两边逐字相同。有帧编不过、或某帧的 shell 和旧页不同，退 1，文件照样写，修好后跑 `ppnt build <画布页>`。

编译只写临时目录，不写数据目录的 dist。project 登记后，服务的 watcher 会自己编这篇。

实现在 `src/server/lib/page-migrate.js`（`planPageMigration`、`writeMigration`、`verifyMigration`），命令在 `bin/cli/migrate.js`。

## 保留名

project id 是站点 URL 的第一段（文章 `/<project>/<article>/`、首页 `/<project>/`、概念 `/<project>/concepts/<slug>/`、`/<project>/llms.txt`），不能占服务已用的首段。唯一的清单是 `src/shared/project-ids.js` 的 `RESERVED_TOP_SEGMENTS`（外加前缀 `test-results*`、`playwright-report*`），服务路由（`article-routes.js`）和登记校验（`isReservedProjectId`）用同一份。清单包括：

- 2026-10-13 定的 `api sites workbench kits assets annotate _astro`；
- 服务路由 `health registry events annotations images image save previews lib`；
- vite 按仓库根服务静态文件，仓库根的顶层目录也都是首段：`src content node_modules bin docs e2e scripts skills site tasks prototypes`，以及 e2e 产物目录前缀。`projects.test.js` 与 `article-routes.test.js` 都检查仓库根的每个顶层目录都在清单里，新增顶层目录时测试会提醒补上；
- Astro 的 `_image`。

article id `concepts` 保留（`RESERVED_ARTICLE_IDS`，它是概念页的第二段），只在 `projects.js` 里。

## 固件

- `e2e/project-site/`：project `e2e-project`，两篇文章（`commit-confirm`、`takeover`）、两个概念（`confirm-card`、`takeover-banner`），没有布局错误。正文里有指向文章、概念和一个空 ref 的 `[[ ]]`。`commit-confirm` 有画布：三个 Section，其中两节有 Canvas（`confirm`：`confirm-sheet`、`confirm-done`；`variants`：`card-plain`，`shell="comp"`）。帧用到本篇组件 `ConfirmCard`、project 共用组件 `Banner` 和 kit 的 `Nav`，本篇有 `article.css`。
- `e2e/project-collide/`：project `e2e-collide`，article `confirm-card` 与 concept `Confirm-Card` 撞名，读取时恰好一条布局错误。

- `e2e/prose-site/`：project `e2e-prose`，一篇 `notes`（两节，同一句话各出现一次，带一张画布卡片），正文评论的 e2e 用它；e2e 登记的是本轮复制出的副本，spec 会改正文。

`e2e-project` 与 `e2e-prose` 常驻 e2e 的共享 registry 固件（project 不是页，不进 Pages）；`e2e-collide` 不登记。
