# project：目录、登记与读取

project 是文章模型的顶层：一个 project 下面有多篇 article（设计文档）和多条 wiki 词条（代码里叫 concept）。
project 只是装一批文章的容器，承载信息的是文章（ADR 0044）：读者面前不显示 project 标题，`title` 只写短名字。
一个 project 在 registry 里登记成一条 `kind: "project"` 的条目，`path` 是 project 根目录，
内容住在根目录下的 `docs/pinpoint/`。article 与 wiki 词条的定义见 [`CONTEXT.md`](../CONTEXT.md)。

## 目录

目录结构是定死的：

```text
<project 根>/docs/pinpoint/
  project.json                 # { "id": "browser-use", "title": "Areta browser use", "sources": {…} }
  articles/<article id>/
    index.mdx                  # 正文，frontmatter 写 title、summary、order
    <帧 id>.jsx
    <帧 id>.html               # HTML 帧，它引用的相对资源放在旁边（见“HTML 帧”）
    components/<Name>.jsx      # 本篇专用
    figures/<图 id>.jsx        # 正文里的图，可带同名 .js、.css（见“图”）
    assets/
  wiki/<名字>.md               # wiki 词条，frontmatter 写 name、status、boundary
```

- `project.json` 必须有。`id` 与 registry 条目 id 同一个模式 `^[a-z0-9][a-z0-9-]*$`，并且不能是保留名（见下面“保留名”一节）。`title` 可选，缺省用登记时的标题；它是一个短名字（Vault、Areta browser use），不写成一句描述。带全角或半角冒号、或超过 24 个字符时 `ppnt check` 给一条提示（`project_title_long`，不是错误）。`sources` 可选，登记 project 根之外 HTML 帧可以引用的目录，见“HTML 帧”。
- article id 就是 `articles/` 下的目录名，同一个模式。`wiki` 和 `concepts` 不能当 article id：`/<project>/wiki/` 是 wiki 页，`/<project>/concepts/` 是它的旧地址（301 到 `/<project>/wiki/`）。
- 每个 article 目录必须有 `index.mdx`。`articles/` 下只放目录；目录名不合模式、名叫 `wiki` 或 `concepts`、缺 `index.mdx`、或是散文件，这一项不进 `articles`，同时记一条布局错误。以 `.` 开头的名字忽略。
- `wiki/` 下只放 `<名字>.md`；子目录和其他文件不进 `concepts`（读取结果里 wiki 词条的字段名），同时记一条布局错误 `wiki_not_md`。以 `.` 开头的名字忽略。
- 旧的 `concepts/` 目录（2026-10-15 之前的名字）不读，记一条布局错误 `wiki_dir_renamed`，提示改名成 `wiki/`（ADR 0045）。
- wiki 词条有两个名字：`name`（frontmatter，缺省用文件名）是显示名，也是 `[[ ]]` 的解析键；`slug`（文件名去掉 `.md`）是 URL 段，词条页是 `/<project>/wiki/<slug>/`，`/<project>/wiki/` 列出这个 project 的全部词条。

## frontmatter

`index.mdx` 与 `wiki/*.md` 开头可以有 `---` 包起来的 frontmatter，每行一条 `key: value`：

| 文件 | 字段 | 缺省 |
| --- | --- | --- |
| `articles/<id>/index.mdx` | `title`、`summary`（可选）、`order`（project 首页上的排序，可选）、`date`（`YYYY-MM-DD`，首页上的时间，可选） | `title` 缺省用 article id；没写 `order` 的排在后面，同序按 article id；`date` 缺省或写错时用 `index.mdx` 的修改时间（写错不报错） |
| `wiki/<名字>.md` | `name`、`status`（占位 / 收敛中 / 已固定）、`boundary`（一句边界） | `name` 缺省用文件名 |

每个值是单行字符串，可以用单引号或双引号包起来，不带引号时 ` #` 之后算注释。下面这些写法都记一条布局错误，该键不进结果、字段按缺省处理：

- 空值（`key:`），因此块列表 `tags:` 加下一行 `- a` 是两条错误；
- 以 `>`、`|`、`[`、`{`、`&`、`*`、`!` 开头的值（块标量、流式列表 / 映射、锚点、标签）；
- 不是 `key: value` 的行、重复的键、没闭合的引号；
- 没有结束的 `---`：整份文件当作没有 frontmatter，另记一条错误。

`status` 只能是 `占位`、`收敛中`、`已固定` 三者之一，写了别的值记一条错误、`status` 不出现。其他键照常解析，读取模块不使用。

Astro 也会按 YAML 解析同一段 frontmatter。为了让站点和 CLI 看到同一个标题，站点的 title、summary、name、status、boundary 必须取 `listProjects` 的结果（或调用同一个 `parseFrontmatter`），不另读 Astro 解析出的 frontmatter。frontmatter 只写上面的子集时，两边解析结果相同。例外是 `order`：它只用于 project 首页的文章排序，站点直接读 Astro 解析出的值（`site/src/lib/site-data.js`）。

## 命名空间

`[[名字]]` 既能指向 article 也能指向 wiki 词条，所以同一个 project 里 article id 与词条的 `name` 共用一个命名空间，两条词条也不能同名。比较时不分大小写、去掉首尾空白（Obsidian 同规则）：article `confirm-card` 与词条 `Confirm-Card` 算撞名。撞名的双方都照常列出，同时记一条布局错误。

## 登记

新 project 用脚手架，它写 `project.json`、建空的 `articles/` 和 `wiki/`，再登记：

```shell
ppnt new project <project 根> [--id <id>] [--title <标题>]
ppnt new article <project>/<article> [--title <标题>]   # 写 articles/<article>/index.mdx：frontmatter + 一节
ppnt new article <article>                             # 不写 project：进默认 project notes，没登记就先建好并登记
```

两个命令都不覆盖已有文件，细节见 [`docs/registry.md`](registry.md)“CLI”；默认 project `notes` 在哪、怎么改，见那里的“默认 project `notes`”。已经有 `project.json` 的 project 直接登记：

```shell
pinpoint add <project 根> --project
```

- id 只取 `project.json` 的 `id`。`--id` 可以写，但必须与它相同；要换 id 用 `ppnt mv <旧 id> <新 id>`，它连 `project.json` 一起改。
- 标题只有一个来源：`project.json` 的 `title`。登记表里的 `title` 是登记时抄下的副本（`project.json` 没写 title 时用目录名），读取时 `project.json` 的 `title` 优先。所以 `--project` 不接受 `--title`。
- `--project` 不能与 `--title`、`--board` 同用：project 不是页，没有壳。
- 登记前检查 `project.json` 存在、id 合法、不是保留名、不撞既有条目 id；不过关就退非零，registry 不动。article 层面的问题（撞名、缺 `index.mdx`）不拦登记，在读取时报。

| 命令 | 对 project 条目做什么 |
| --- | --- |
| `ppnt mv <id> <新根>` | 换根目录（新根以 `/`、`.`、`~` 开头）。新根的 `project.json` id 必须仍是 `<id>`，否则拒绝 |
| `ppnt mv <旧 id> <新 id>` | 改 id：登记表、`project.json` 的 `id`、每个文章桶一起改，见下面“改 id 与文章桶”；新 id 是保留名时拒绝 |
| `ppnt mv <project>/<a> <project2>/<b>` | 搬一篇文章：换 project 和 / 或改文章 id，见下面“`ppnt mv` 搬文章” |
| `pinpoint remove <id>` | 只删登记，project 目录不动。每个文章桶 `<id>_<文章>/` 守其他条目的桶规则：有一个桶里有标注行就整单拒绝（列出哪些桶几行），全空就跟着删 |
| `pinpoint list` | 页表之后列 project：首行 id · 标题 · 文章数 · wiki 词条数 · 布局错误数，次行根目录，下面每篇文章缩进一行 `<project>/<article>`。关键词也匹配文章 id 与标题 |
| `pinpoint show <project id>` | 列这个 project 的文章（地址、标题、节数、帧数、open 数、网址）、wiki 词条（name、status、boundary）、空 ref 和布局错误；有布局错误时退 1。`pinpoint list <project id>` 同义 |
| `pinpoint check <project id>` | 验证整个 project：布局错误、每篇文章全部帧的编译与 lint、正文渲染错误、空 ref，一条一行带文件和行号；有错误退 1。见 [`docs/registry.md`](registry.md)“CLI” |
| `pinpoint status` | `project` 一行：个数与布局错误数，有错误时是“注意”，逐条列在下面，不算失败 |

### 改 id 与文章桶

project id 本身不是桶，project 的桶是每篇文章的 `<id>_<文章>/`。`ppnt mv <旧 id> <新 id>` 对 project 条目这样做：

- 扫数据根下所有 `<旧 id>_<文章>/`，按盘上的桶扫，不按现有文章扫，所以文章已删的孤儿桶也一起带走。带 `_` 的模板页 id 不算。
- 预检：任何一个 `<新 id>_<文章>/` 已存在，或撞上模板页 id，就整单拒绝，登记表、`project.json`、桶都不动。
- 每个桶一次 `rename`，单桶原子，逐行打印搬了什么。搬完改写桶里账本的旧地址：行上的 `pageId`，`@prose.json` 的 `path`（`/<旧 id>/<文章>/` 换成 `/<新 id>/<文章>/`）。
- 按页 id 存的派生物：`shot/`、`check/` 里的图跟着搬；`dist/`、`render/` 里的 HTML 写死了 `/sites/<旧页 id>/`，删掉。有 dist 的文章按新页 id 重编一次，和 `ppnt build <页>` 用同一个编译器。派生物都能再生，搬不动或删不掉时只在 stderr 警告并点名留在旧名下的目录，桶和 `project.json` 照常做完。
- 源文件不改。`docs/pinpoint/` 下写死了 `/sites/<旧 id>_` 的文件（帧里引用资源的绝对地址）逐个列在警告里，作者自己改成新地址或相对路径。
- 工作台在浏览器里记的偏好（上次打开的页、tab）是 localStorage，不在服务端，`mv` 碰不到；旧页 id 的那几条自然失效。

### `ppnt mv` 搬文章

一篇文章换 project、改文章 id，或两样一起：

```shell
ppnt mv notes/quick-idea browser-use/payment-retry   # 换 project 并改 id
ppnt mv notes/quick-idea browser-use/                # 目标写 <project>/：保留文章 id
ppnt mv browser-use/a browser-use/b --dry-run        # 只列计划
```

源也认页 id 和文章网址。实现在 `bin/cli/mv.js`（ADR 0045）。

- 预检，任何一条不过就一个字节不动：源文章的 `index.mdx` 在；目标 project 登记了；目标文章 id 合法、不是保留名；目标目录 `articles/<b>/` 不在；目标桶 `<p2>_<b>/` 里没有标注行（有就是别的文章留下的孤儿，提示换 id 或 `ppnt prune`）；目标页 id 不撞模板页。
- 换 project 时还查 HTML 帧：`{ id, src }` 写法的帧在原 project 里找得到、在新 project 里找不到（`<source 名>:` 没在新 `project.json` 的 `sources` 里登记，或相对 project 根的文件在新根下不在），就拒绝并逐帧列出原因。先在新 project 登记 source 或放好文件，再搬。没有跳过这一步的开关：搬过去就是坏帧。
- 做的事：文章目录整个搬到 `<p2 根>/docs/pinpoint/articles/<b>/`（跨卷时复制再删）；目录里写死的 `/sites/<p>_<a>/` 换成 `/sites/<p2>_<b>/`（`.jsx`、`.js`、`.css`、`.mdx`、`.md`、`.html`、`.json`）；桶 `<p>_<a>/` 改名成 `<p2>_<b>/`（目标桶在而没有标注行时先删掉它），账本里行上的 `pageId` 与 `@prose.json` 的 `path` 改写，和 project 改 id 用同一个函数；`shot/`、`check/` 缓存跟着搬，`dist/`、`render/` 删掉，有 dist 的按新页 id 重编。
- 不做的事：别的文章和 wiki 词条里指向它的 `[[a]]`、`[[p:a]]` 不改，逐条列在 stderr（文件:行）。
- 服务不用重启：project 目录在 watcher 里，搬完的文章一会儿就出现在新地址。

project 条目与存量页的条目共用 registry 的 id 命名空间（同一个 `entries` 数组），但 project 没有页 id：不出现在工作台左栏的“页面”组、`GET /registry` 的 `entries` 和 `/sites/` 里。

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
  "concepts": [{ "name": "confirm-card", "slug": "confirm-card", "status": "收敛中", "boundary": "…", "file": "/abs/…/wiki/confirm-card.md" }],
  "errors": []
}
```

- 文章另带 `mtimeMs`（`index.mdx` 的修改时间），frontmatter 的 `date` 合法时带 `date`；首页用它们排序，见下面“首页”。
- `concepts` 是 wiki 词条。article 按 id、词条按 `name` 用 `String.prototype.localeCompare`（运行环境的缺省 locale）排序。`summary`、`status`、`boundary` 没写时不出现。
- 读取从不抛错。根目录不存在、缺 `docs/pinpoint/`、`project.json` 缺失或坏掉、id 与登记的不一致、撞名、frontmatter 看不懂、目录里放错东西，都写进这个 project 的 `errors`。每条是对象 `{ code, message, path?, section?, frame?, line? }`（`src/shared/project-errors.js`）：`code` 是种类，给程序分辨用；`message` 是显示的那句话；文章和 wiki 词条的错误带 `path`，相对 `docs/pinpoint/`（`articles/x/index.mdx`、`articles/x`、`wiki/a.md`）；画布写法的错误另带 `section`、`frame`、`line`（见“画布视图”）。根目录、`docs/pinpoint/`、`project.json` 和撞名是 project 自己的错误，没有 `path`，根目录、`docs/pinpoint/`、`project.json` 这三处的 message 里写绝对路径，因为这三处本身就是相对路径的起点。拼成一行字只在显示的那一头做，用 `formatProjectError`：有 `path` 的写成 `articles/x/index.mdx：…`。`pinpoint list`、`/health`、站点错误条、工作台左栏的 tooltip 都这样显示。根目录或 `docs/pinpoint/` 不在时 `articles` 与 `concepts` 为空；`project.json` 坏了照样读文章。
- `canvasSections` 是画布上的节数：带 `<Canvas>` 且列了帧的节。0 表示这篇没有画布，工作台左栏点它直接打开正文（见下面“工作台左栏”）。
- 每次调用都重读磁盘，加文章不用 reload。

同一模块还导出 `readProjectJson(root)`、`CONCEPT_STATUSES`、`PROJECT_CONTENT_DIR`（`docs/pinpoint`）。不读盘的规则放在叶子模块 `src/shared/project-ids.js`，服务、CLI、站点和工作台都从这里取：

- `articlePageId(projectId, articleId)` → `<project>_<article>`：一篇文章的页 id，也是它的标注桶（画布标注与正文评论共用）；`parseArticlePageId` 拆回来，`ARTICLE_PAGE_ID_PATTERN` 是它的形状，见“画布视图”。一个页 id 现在指不指得到东西（文章要 project 登记了、`index.mdx` 在盘上）只问 `src/server/lib/page-resolve.js`：`resolvePage(registry, id, { manifestIds })` 答它是登记条目、模板页、文章还是什么都不是，`pageIdIsLive` 是它的布尔版。服务收标注时的桶校验、`ppnt prune`、`status` / `check` 的整桶孤儿报告、`/sites/<id>/`、`/api/frame` 都用它。
- `refKey(name)`：`[[ ]]` 命名空间的比较键（NFC、去首尾空白、小写）。解析 `[[名字]]` 时拿它同时比 article id 与 wiki 词条的 `name`。
- `RESERVED_TOP_SEGMENTS`、`isReservedProjectId`、`RESERVED_ARTICLE_IDS`：保留名，见下面“保留名”。
- `SECTION_ID_PATTERN`、`FRAME_ID_PATTERN`、`CANVAS_SHELLS`、`sectionLetter`：正文画布写法的规则与节字母。
- `CANVAS_LEDGER`（`@canvas`）、`PROSE_LEDGER`（`@prose`）：桶里两本固定账本的名字。

frontmatter 子集的解析器 `parseFrontmatter(text)` → `{ data, body, errors }` 在 `src/server/lib/frontmatter.js`。

HTTP：`GET /api/projects` 返回 `listProjects` 的数组，`GET /api/projects/<id>` 返回一个 project，没登记 404。`GET /health` 的 `registry.projects` 是 project 条目数，顶层 `projects` 是 `{count, errors}`，errors 是给 `pinpoint status` 显示的字符串，每条是 `<project id>: ` 加 `formatProjectError` 的结果。

## 首页

网址 `/`（不带参数；带参数的 `/` 是旧的画布视图地址，302 到 `/workbench/`）。站点页面 `site/src/pages/index.astro`，排序是 `src/shared/article-feed.js` 的 `articleFeed`（纯函数，有单测）。

- 列出所有登记 project 的全部文章，按最近修改时间倒序。一篇文章的时间：frontmatter 写了合法的 `date`（`YYYY-MM-DD`，按当天本地零点）就用它，否则用 `index.mdx` 的修改时间。时间相同按 project id、再按 article id。
- 每条：文章标题（进文章页）、summary（没写就不出）、所属 project 的短名小标签（进 `/<project>/`，那个 project 的文章列表）、日期（`YYYY-MM-DD`，本地时区）。
- project 首页 `/<project>/` 保留，是“这个文件夹里的文章”，仍按 `order` 排。
- 顶栏右边的“工作台”进 `/workbench/`。首页不注入标注客户端。

## 画布视图

每篇 article 的画布视图由正文派生：带 `<Canvas>` 的节按顺序各成一行，工作台用这篇的页 id 打开它。正文里怎么写见 `site/README.md` 与 `skills/pinpoint-build`，这里只记机制。

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

- 一节最多一个 `<Canvas>`；没有 Canvas 的节不进画布。帧 id = 本篇目录下的 `<帧 id>.jsx`，或 `<帧 id>.html`（见下面“HTML 帧”）。
- `frames` 只认字面量数组，每一项只认字面量字符串，或 `{ id, src }` 字面量对象（HTML 帧）；`shell` 可选，只认字面量字符串，取值同 board 的 section `shell`（`app` 缺省 / `lock` / `doc` / `comp`）。
- 帧级 shell：一节里混着手机帧和组件帧时，组件帧的文件在顶层写一行 `export const shell = "comp";`。取值和 `<Canvas shell>` 一样，只认这一行的字面量字符串。它只管这一帧，盖过 `<Canvas shell>`。服务静态读这一行（`readFrameShell`），不执行帧文件。编译器的帧 lint 放行这一行。
- 解析用站点同一套 MDX 解析器（`unified` + `remark-parse` + `remark-mdx`），只读结构，不渲染正文。实现在 `src/server/lib/article-canvas.js`。哪个节点属于哪一节、第几节、节字母，由 `src/shared/article-structure.js` 的 `articleStructure(tree)` 走一遍 mdast 得出；站点的 remark 步骤（节号、给 `<Canvas>` 注入 `section`）和 `ppnt comments` / `locate` 判断正文评论的引文落在哪一节（`articleSectionSpans`）用的是同一个走法，所以三处数出来的节对得上。

### HTML 帧

帧也可以是一整份 HTML 页面，用来在画布上放生成出来的网页：一个页面的几个版本、同一份 brief 在几个模型上的产出、几张 demo 页、一份叠着 A–F 几种做法的文件。

```mdx
<Canvas frames={["landing", { id: "brochure", src: "examples/brochure.html" }, { id: "catalog", src: "skill:preview.html" }]} />
```

```json
{ "id": "hosted", "title": "Hosted pages", "sources": { "skill": "../areta-pages/skill" } }
```

- 字符串 `"landing"`：本篇目录下有 `landing.jsx` 就是 JSX 帧，否则是 `landing.html`。两个文件都在是错误 `frame_source`。
- `{ id, src }`：别处的一个 HTML 文件，帧 id 由 `id` 给。文件留在原处，不复制，画布显示的就是那份文件。对象只认 `id`、`src` 两个键，值只认字面量字符串。`src` 有两种写法：
  - `"examples/brochure.html"`：相对 project 根。
  - `"skill:preview.html"`：`<source 名>:<路径>`，路径相对 `project.json` 里 `sources.skill` 登记的目录。用来引用 project 根外面的文件，比如另一个仓里的示例页。
- `sources`（`project.json`，可选）：`{ "<名字>": "<目录>" }`。名字匹配 `^[a-z0-9][a-z0-9-]*$`，不能叫 `root`；目录写绝对路径或相对 project 根。值不是字符串、名字不合规则、目录不在，都是 project 错误 `project_sources`（没有 `path`，`ppnt check` 指 `project.json`），这个名字不能用。
- `src` 的路径以 `/` 开头、含 `..` 或 `.` 段、含 `\`、不以 `.html` 或 `.htm` 结尾、用了没登记的 source 名、解析（含符号链接）后在 project 根或那个 source 目录外面，都是错误 `frame_src`；本篇目录下的 `<帧 id>.html` 是符号链接、真实落点在文章目录外面或是隐藏文件，也是 `frame_src`。这两种帧不进画布，服务也不出。文件不在是 `frame_missing`，这一帧照进画布。相对 project 根的路径不能以 `<名字>:` 开头，那是 source 写法。
- 节没写 `shell` 时，HTML 帧套 `doc` 机壳；写了就用节的（存量的 HTML 片段帧放进手机壳就是这样）。JSX 帧和 HTML 帧可以在同一节，帧 id 在一篇里唯一。
- 服务：本篇目录下的帧是 `/sites/<页 id>/<帧 id>.html`，project 根下的帧是 `/sites/<页 id>/@root/<路径>`，source 下的帧是 `/sites/<页 id>/@source/<名字>/<路径>`。地址的目录就是文件所在的目录，页面里写的相对路径（css、js、图片、`data/`）照原样取到。文章目录、project 根、source 目录三处出文件用同一条规则（`src/server/lib/servable-file.js`）：路径按文本和按真实路径（跟符号链接）都要在那个目录里；任何一段以 `.` 开头、文件是文章正文 `index.mdx`，都 404，符号链接的真实落点也算。project 根和 source 目录只在这篇有帧住在里面时开放（帧文件要在盘上，缺文件的 `{ id, src }` 帧不算）。开放的是整个目录，不收窄到帧引用到的文件，因为页面运行时 fetch 的资源从文本里算不出来。workspace 里别的文件不出。别的站点的网页来的请求（`Sec-Fetch-Site: cross-site`）一律 403，见 [`docs/registry.md`](registry.md)“dir 与 file 条目”。Astro 的 `fs.allow` 不变，这些文件不经站点出。页面原样服务，不编译。画布视图里注入标注客户端，卡片和浮层（`annotate=off`）不注入。
- 宽度：卡片和浮层按手机 402（画布视图手机屏的宽度）或桌面 1280 排页面，缺省手机（owner 2026-10-14 定）。卡片头的“手机 / 桌面”切换这张卡片里的 HTML 帧，浮层头有同一个开关，两边同步。宽度由 pinpoint 管，页面自己不放宽度切换。卡片只露第一屏（402 × 874 或 1280 × 800，缩小显示）。浮层里页面占满可用高度，在帧里整页滚动、可以点；浮层放不下时按宽度缩小。
- 画布视图：HTML 帧是这篇的文档条目，和存量页的 doc 屏一样不进画布那一行，窗口 / 手机视口照用。按 A 标注页面里的元素（文档页标注），锚点是 CSS 路径加元素文字，和存量页的文档条目一样。账本在这篇的桶里，按页面路径分本（`<文件>~<hash>.json`）。
- 编号：HTML 帧和 JSX 帧一起在节内编号。`ppnt comments` 把 HTML 帧的标注归到帧下面（`## B1 · long-page`），摘录写源文件和行。`ppnt shot B1` 按 402 宽截整页，先等页面里懒加载的 iframe 和图片加载完，`--marks` 在元素上标出标注号。`ppnt shot <project>/<article> --canvas` 给每个 HTML 帧各截一张，见 [`docs/registry.md`](registry.md)“`ppnt shot`”。
- `ppnt check`：页面里的相对路径指到的文件不在，是警告 `html_asset_missing`；服务出不来，是错误 `html_asset_outside`：指到范围外面、符号链接指出去、`.` 开头的文件、`index.mdx`。范围是这一帧所在的目录：本篇目录、project 根，或那个 source 目录。check 和服务用同一个函数判，check 不报的文件，服务一定出得来。

### 页 id

`articlePageId(projectId, articleId)`（`src/shared/project-ids.js`）= `<project id>_<article id>`，例如 `browser-use_payment-confirm`。

- project id 与 article id 都匹配 `^[a-z0-9][a-z0-9-]*$`，没有 `_`。所以拆分无歧义，两篇文章不会得到同一个页 id；registry 条目 id 也不含 `_`，不会撞。
- 结果匹配 `PAGE_ID_PATTERN`（`^[a-zA-Z0-9_-]+$`），所以 `?page=`、标注桶、`/sites/<id>/`、`ppnt` 都认它。`parseArticlePageId(id)` 拆回 `{ projectId, articleId }`。
- 唯一可能撞的是 `content/previews/_index.json` 里带 `_` 的模板页。读取时逐篇检查，撞了记一条布局错误，模板页优先。
- `listProjects` 的每篇 article 多一个字段 `pageId`；`pinpoint show <project>/<article>` 打出它（“页 id”一行）。CLI 的目标写斜杠形 `<project>/<article>`，页 id 也认。

### board 从哪来

- board 每次从 `index.mdx` 现派生（`src/server/lib/article-board.js` 的 `deriveArticleBoard`）。按 Section 顺序，只含有 Canvas 的节。每节是 `{ id, title, layout: "row", letter, shell?, screens: [{ id, shell? }] }`。screen 的 `shell` 来自帧文件的 `export const shell`。`letter` 是正文里的节字母，见下面“给站点卡片的接口”。顶层带 `title`（文章 title）和 `article: { project, id, url }`。
- 本篇的 `article.css`、`article.js` 存在就进 `assets`，和手写 board 的 `assets` 一样注入每帧。
- 编译时派生的 board 写进 `<dist>/<页 id>/board.json`，从不写回文章目录。
- 组件：帧里写 `import { X } from './components/X.jsx'`。本篇 `components/X.jsx` 没有就用 `pinpoint/kit` 的同名印章。没有 project 级的组件（ADR 0045）：`docs/pinpoint/components/` 不参与编译，盘上还有这个目录时记一条布局错误 `project_components_dir`，提示挪进用到它的文章或 kit。
- 编译目标 `resolvePageTarget(<页 id>, { registry })` 返回 `kind: "article"`，`pageDir` 是文章目录，`urlBase` 是 `/sites/<页 id>/`。之后编译、`/sites/<页 id>/`（board.json、帧、资源）、`/api/frame`、工作台、`ppnt build / comments / locate / mark / shot / show`、编号（`boardRefs`）都和存量页一样工作。
- dist 是否过期：比对现派生的 board 与 dist 里那份，不看 `index.mdx` 的 mtime，因为改正文不等于改画布。
- watch：服务把每个登记 project 的 `docs/pinpoint/` 加进 watcher。`articles/<文章>/` 下的帧、组件、`article.css` / `article.js` 变更会重编这篇并通知工作台。帧里的 `export const shell` 改了，派生 board 就变了，这篇整页重编。`index.mdx` 变更时先比对派生 board：没变就不编、不通知，变了就整页重编。`ppnt build <页 id> --watch` 只盯文章目录。

### 不进“页面”组

画布视图属于文章，不出现在工作台左栏的“页面”组（Pages 列表）、`GET /registry` 的 `entries` 和 `ppnt list` 的存量页表里；左栏“文章”组列出它们，见下一节。`GET /registry` 另带 `articles: [{ id, title, project, article, url }]`，工作台把它放进清单的 `articles`。`pageEntry` 认得这份清单，所以 `/?page=<页 id>` 能打开，加 `&section=<节 id>` 能定位到那一节。同 id 的模板页或登记页优先。

画布视图的底部横条在页名后面多一个“阅读正文”，同一标签页回到文章页，后退回画布，与文章页顶栏的“画布视图”对称。画布当前所在的节（`?section=` 落点、大纲点的节，或滚动后视口中间的节）是这块板上的节时，地址带锚点 `/<project>/<article>/#<节 id>`，否则落到文章顶部；正文里 `<Section>` 的 id 就是 DOM id，所以锚点对得上。只有清单 `articles` 里的页出这个钮，存量页不出。地址由 `src/workbench/lib/article-groups.js` 的 `articleCanvasReadUrl` 算。

### 工作台左栏

工作台左栏“页面”tab 分两组：上面“文章”组，下面“页面”组。“页面”组列存量页：置顶、最近与全部页。存量页是和文章并列的入口，两组长期并存（owner 2026-10-14 定）。

- “文章”组读 `GET /api/projects`：每个登记的 project 是一行可折叠的标题（`project.json` 的 title），下面每篇文章一行，照 `listProjects` 的顺序。折叠是本机偏好 `prefs.articleProjectsCollapsed`。模型是 `src/workbench/lib/article-groups.js`，组件是 `src/workbench/app/ArticlesSection.jsx`。
- 有画布的文章（`canvasSections > 0`，且清单的 `articles` 认得它的页 id）：点行在工作台打开画布视图 `<project>_<article>`，和 `/workbench/?page=` 是同一个，选中态与页面行一样。没有画布的文章：点行在新标签页打开文章页。
- 行尾“阅读”钮（tooltip“阅读正文”）在新标签页打开 `/<project>/<article>/`。常态不显示，行 hover 或键盘焦点进到行时出现。右键菜单有“阅读正文”，有画布的再加“复制 @page”。
- project 有布局错误时，标题行尾显示错误个数，tooltip 列前三条。
- 文章不归档、不置顶。画布视图不进“最近”，“最近”只算“页面”组里的存量页。
- 实时更新：`registry:update`（登记或移除 project）和 `projects:update` 都让左栏重读 `/api/projects`。`projects:update` 由 `preview-hmr` 发，载荷 `{ project }`：project 目录里有文件新建、修改或删除，并且列表那一层变了（project 标题、文章增删、文章标题与摘要、`canvasSections`、布局错误）。只改正文或帧内容不发。Vite 6 对新建和删除不调 `handleHotUpdate`，所以 `preview-hmr` 另外监听 watcher 的 `add` / `unlink`：新建的文章或帧在这里重编，画布视图收到 `preview:update`。

### 标注桶

一篇文章的画布标注和正文评论共用一个桶，桶 id 就是这篇的页 id。文章目录删了、改名了，或 project 的登记删了，这个页 id 就指不到文章，桶整桶皆孤儿：`ppnt comments <页 id>` 列出它，`ppnt prune <页 id>` 清理（连桶目录一起删）。文章还在时 `prune` 只删桶里表面已死的账本：HTML 帧移出了 Canvas、源文件不在了或服务不出（见“HTML 帧”），它那本文档页标注账本就是孤儿；`@canvas.json` 与 `@prose.json` 恒活。文章页（`/<project>/<article>/`）注入的标注客户端以它为桶，只跑正文评论；project 首页、wiki 页、不存在的文章不注入。`resolveRequestEntry` 认文章的页 id（project 登记了、这篇的 index.mdx 在盘上），project id 本身不是桶。

### 错误

下面这些写法都记进这个 project 的 `errors`，格式是 `articles/<文章>/index.mdx：第 N 行：…`。`pinpoint show <project>`、`pinpoint check <project>` 和站点错误条会显示它们，读取本身不抛错。

- 跨页引用 `"<页 id>/<帧 id>"`：提示先把帧复制进本篇目录。
- 帧文件不存在：帧仍进画布，工作台上那一格出错误面板。
- HTML 帧写坏：`frame_source`（同一个 id 两种文件都有）、`frame_src`（`src` 不合规则、source 没登记，或在可服务的目录外面），见“HTML 帧”。`project.json` 的 `sources` 写坏是 project 自己的错误 `project_sources`。
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

- `letter` 是这一节在正文里的字母。正文所有 Section 一起数，纯文字的节也占一个字母（上例的 A 是纯文字的 `why`）。派生 board 的每节带同一个 `letter`，`boardRefs` 用它编号，所以工作台图注、大纲和 `ppnt` 的 `B1` 对得上。文章页不显示字母：目录、节标题和卡片用节号，第 n 个字母就是第 n 节（上例 `confirm` 在文章上是 2），卡片和浮层的图注只有帧 id。
- 没有源文件的帧带 `"missing": true`，画布上那一格是错误面板。
- HTML 帧带 `"shell": "doc"`（节写了 `shell` 时用节的），`{ id, src }` 写法的再带 `src`（正文里的原样，`shared/x.html` 或 `skill:preview.html`）。卡片按 `doc` 量尺寸，宽度见“HTML 帧”。
- 帧文件写了 `export const shell` 的帧带 `shell`。卡片按每帧自己的 shell 量尺寸：帧的 `shell`，没有就用节的。
- `errors` 是 `[{ code, message, path?, line?, section?, frame? }]`，就是 `listProjects` 里这篇的布局错误（`path` 在 `articles/<文章>` 下的那些）。属于某一节的错误带 `section`（节 id），属于某一帧的再带 `frame`。不属于任何节的错误是页级错误：frontmatter、页 id 撞名、MDX 写坏、Canvas 在节外、重复的节 id。站点按 `section` 分到卡片和页顶错误条，显示 `message`。
- `figures` 是正文里的图，每个 `<Figure>` 一项，见下面“图”。图的错误（`code` 以 `figure_` 开头）也在 `errors` 里，站点把它们显示在图的位置，不分到卡片和页顶错误条。
- 文章不存在或 project 没登记时，`sections` 为空，`errors` 说明原因。
- 帧卡片和画布浮层的 iframe 用 `/api/frame?page=<pageId>&screen=<帧 id>&annotate=off&embed=card`，打开画布用 `/workbench/?page=<pageId>&section=<节 id>`，这一桶的画布账本是 `GET /annotations/%40canvas?entry=<pageId>`。
- `embed=card` 是站点读帧的契约（`frame-doc.js` 的 `markEmbedStage`）：不出图注，不注入标注客户端，`<html>` 带 `data-pp-embed="card"`，第一个机壳带 `data-pp-stage="phone|comp|doc"`，手机机身带 `data-pp-device`。站点只认这几个属性量尺寸，不认工作台的 class 名；只加属性，机壳以下的 DOM 与画布同构。`embed` 只接受 `card`，别的值 400。

## 图

图是正文里的一张示意图或一段可交互演示，用 `<Figure>` 写进正文，占满正文栏宽。它不是帧：不进画布视图，没有编号，不能做画布标注（owner 2026-10-14 定：演示先放正文，之后要标注再讨论放画布）。图由 agent 自己画，写成 JSX 和 SVG，pinpoint 不提供图表 DSL（owner 2026-10-14 定：给 agent 一块画布，agent 自己画 SVG）。

### 写法

```mdx
<Figure src="figures/message-flow.jsx" caption="消息怎么走：点“下一步”一条一条看" />
```

- 写在正文任何地方，节里节外都行。属性只有 `src` 和 `caption`，都只认字面量字符串。`caption` 可省，显示在图下面。
- `src` 只能写成 `figures/<图 id>.jsx`，图 id 的规则和帧 id 相同，是文件名。同一个图在一篇文章里只放一次。
- 图的文件都在文章目录的 `figures/` 下：

| 文件 | 必须 | 是什么 |
| --- | --- | --- |
| `figures/<图 id>.jsx` | 是 | 图本身：默认导出一个返回 JSX 的函数，编译成静态 HTML |
| `figures/<图 id>.js` | 否 | sidecar，在浏览器里跑：`export default function mount(root) { … }`，`root` 是图的根元素，返回 `unmount` |
| `figures/<图 id>.css` | 否 | 这个图的样式，只在图页里生效 |

- `.jsx` 和帧守同一套规则：lint 四禁（`preact/hooks`、`onX` 属性、`fetch(`、顶层只许 `import`、`export default` 和函数声明），数据写在函数体里。组件写 `../components/<Name>.jsx`，查找序和帧一样（本篇、kit）；用了 `pinpoint/kit` 的图会加载 `ios-kit.css`。
- 交互和动画放进 sidecar。sidecar 不经编译器打包，只在编译时检查语法；它可以 `import` 同目录的模块和 `pinpoint/figure`。

### 画图的约定

一个最小的图：

```jsx
import { textWidth } from 'pinpoint/figure';

export default function Lanes() {
  const actors = ['用户', 'agent', '网站'];
  return (
    <div class="fig-scroll">
      <svg viewBox="0 0 640 120" role="img" aria-label="三个角色">
        {actors.map((name, i) => {
          const x = 110 + i * 210;
          const w = textWidth(name, 13) + 28;
          return (
            <g class="lane">
              <rect x={x - w / 2} y="8" width={w} height="28" rx="14" />
              <text x={x} y="27" text-anchor="middle">{name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
```

```css
.lane rect { fill: var(--fig-panel); stroke: var(--fig-hair); }
.lane text { font-size: 13px; font-weight: 600; }
```

- `viewBox` 宽 640 左右（正文栏约 720 px，图页有 20 px 内边距），SVG 宽度 100%，按栏宽缩放。字号按 `viewBox` 单位写，正文 12.5–13，标题 13–14。
- 窄屏上 SVG 跟着缩，字会小到看不清：外面包一层 `<div class="fig-scroll">`，SVG 保持最小宽度（缺省 560，用 `--fig-min-width` 改），窄屏上横向滚动。
- 中文字宽约等于字号，其余字符约 0.58 个字号。给文字留框、居中时用 `textWidth(text, fontSize)` 算，它在编译期运行。
- 颜色只用调色板变量，不写死色值，深浅色就会跟着文章页切换。箭头的 `marker` 每种颜色定义一个，id 加上图自己的前缀，避免和别的图重名。
- 图页给 `svg text` 设了 `fill: var(--fig-ink)`，权重为 0，图里任何选择器都能盖过它。

调色板（`content/kits/figure/figure.css`，值与 `site/src/styles/site.css` 的 token 相同，单测守）：

| 变量 | 用在 |
| --- | --- |
| `--fig-bg` | 图的底色，和文章页底色相同 |
| `--fig-panel` | 浅底块、节点底色 |
| `--fig-ink` / `--fig-ink-2` | 主要文字和线条 / 次要文字、普通箭头 |
| `--fig-muted` | 注释、轴、不重要的字 |
| `--fig-hair` | 细线、边框、生命线 |
| `--fig-accent` / `--fig-accent-soft` | 强调：当前一步、主角 / 强调色的浅底 |
| `--fig-err` | 出错 |
| `--fig-font` | 字体栈（含中文） |

### 逐步演示：`steps()`

`pinpoint/figure`（`content/kits/figure/figure.js`，不依赖任何库）的 `steps(root, options)` 给图加上“上一步 / 播放 / 下一步”：

- `.jsx` 里给每一步的元素写 `data-step="n"`（从 1 数，同一步可以有多个元素），说明写在其中一个元素的 `data-note` 上；这一步里带 `data-travel` 的 `line` / `path` 上会有一个圆点走一趟。
- sidecar 写 `export default function mount(root) { return steps(root, { autoplay: 2200 }); }`。`autoplay` 是滚到眼前时自动播一遍、每步停多久（毫秒），`interval` 是点“播放”后每步停多久，`labels` 换控件上的字。
- 第 0 步是全貌，所有元素照常显示，没有 JS 时图也是这个样子。第 n 步时根元素带 class `fig-stepping`，每个 `[data-step]` 带 `is-past`、`is-now` 或 `is-future`：后面的步隐藏，前面的步变淡，`is-now` 的样子由图自己写（比如 `.is-now line { stroke: var(--fig-accent); }`）。
- 系统开了“减少动态效果”时不走圆点，也不自动播放。根元素的 `data-step` 是当前步，测试和截图读它。

样例：`e2e/project-site/docs/pinpoint/articles/commit-confirm/figures/`（`message-flow` 是逐步演示，`wait-sequence` 是静态时序图）。

### 图页与站点

- 图页 `/api/frame?page=<页 id>&figure=<图 id>&embed=figure[&theme=light|dark]`：没有机壳、图注和标注客户端，`<html data-pp-embed="figure">`，`<base>` 是 `/sites/<页 id>/`，import map 把 `pinpoint/figure` 指到 `/kits/figure/figure.js`。`figure` 与 `embed=figure` 必须一起写，图只属于文章。源码比编译记录新就先重编。
- 图页把根元素的高度用 `postMessage` 报给文章页（`{ source: 'pp-figure', type: 'size' | 'error' | 'ready' }`），sidecar 跑完后 `<html>` 带 `data-figure-ready`。深浅色跟着外层文章页的 `<html data-theme>`，单独打开时用 `theme` 参数或系统设置。
- 文章页上每个图是一个懒加载的同源 iframe（`Figure.astro`，`site/src/lib/figure-client.js`），iframe 内容高度等于图的高度，没有滚动条，图里可以点、可以操作。根元素 `<figure data-pp-figure="<图 id>" data-pp-nocomment>`，`data-state` 是 `loading`、`ready` 或 `error`。图和图注里选字不出正文评论。
- 站点给每个 `<Figure>` 注入序号 `n`（正文顺序，写坏的也占），`articleCanvas` 的 `figures` 按同一个序号给出 `{ index, id?, caption?, section?, line?, missing?, errors }`，两边都用 `src/shared/article-structure.js` 的 `articleFigures` 数。
- 编译产物在 `<dist>/<页 id>/figures/<图 id>.html` 和 `<图 id>.json`（编译记录，含全部输入的 mtime），不进 `build.json`。`ppnt build <页 id>` 整页编译时一起编图，逐个报 `ok 图 <图 id>`；只编挑中的屏时不碰图。

### 图的错误

| 种类（`code`） | 什么时候 | 在哪里看到 |
| --- | --- | --- |
| `figure_src`、`figure_caption`、`figure_prop`、`figure_duplicate`、`figure_missing` | `src` 写错、属性不是字面量或不认识、同一个图放了两次、源文件不在 | `listProjects` 的布局错误（带 `line`、所在的 `section`，认得出时带 `figure`）；文章页上显示在图的位置，不进画布卡片和页顶错误条；生产构建失败 |
| `figure_compile` | `.jsx` 编不过或 lint 不过，sidecar 有语法错误 | 图页回 500，图的位置写原因（文件与行）；`ppnt check`（code 同帧：`compile`、`lint_*`，另有 `figure_export`、`figure_render`，带图文件和行）；`ppnt build`；`ppnt show <project>` |
| `figure_runtime` | sidecar 在浏览器里抛错 | 图的位置写原因（sidecar 的行号）；图页把这一版第一次出的错报给服务（`POST /api/figure-error`），`ppnt show <project>` 列出，重编后清掉 |

`ppnt show <project>`（同 `ppnt list <project>`）和 `ppnt show <project>/<article>` 会先把过期的图重编，再把编译错误和记下的运行错误列进布局错误。`ppnt check` 不写 dist、不跑图，只报编译错误。

### 自查

```shell
ppnt shot e2e-project/commit-confirm --figure message-flow
```

图页按正文栏宽 760 px 打开，浅色、深色各拍一张（`<数据根>/shot/<页 id>/figure-<图 id>.png` 和 `…-dark.png`），关掉动画、不自动播放。图编不过、在浏览器里报错或控制台有错误时，命令打出原因并退 1。目标照 `shot` 的规则写（第一个参数），`--figure` 不和帧、节的引用同用。

## 从存量页迁移

一个存量页（registry 的 dir 条目或模板页）转成一篇 article，里面每个 board section 是一节，节里一个画布组件（owner 2026-10-13 定：一个存量页对应一篇文章）。`pinpoint migrate` 把存量页的源码复制进 project，写出只有结构的正文，再逐帧和旧页对比。先看计划：

```shell
pinpoint migrate <页 id> --project <project 根> --dry-run
```

再写：

```shell
pinpoint migrate <页 id> --project <project 根> --article <文章 id>
```

- project 根下要已有 `docs/pinpoint/project.json`，没有就报错退出（先 `ppnt new project <根>`）。project 不登记也能迁，登记了才能在服务里打开画布和正文。
- 文章 id 缺省用存量页的 id，新文章的页 id 是 `<project>_<article>`。`articles/<文章 id>/` 已存在就拒绝，不覆盖。
- 旧页的文件和登记都不动。标注不迁：旧页的标注留在旧页的桶里，新文章用新桶 `<project>_<article>`，命令输出里也写明这一点。
- 新桶 `<project>_<article>` 在数据目录里已经有标注行（删掉或改了名的文章留下的孤儿桶）时拒绝，`--dry-run` 也一样：迁完这个 id 又是活页，旧行会挂到新文章上。换 `--article`，或先 `ppnt prune <project>_<article>`。`ppnt new article` 做同一条检查（`src/server/lib/orphans.js` 的 `staleBucketProblem`）。

### 怎么对应

| 存量页 | 文章 |
| --- | --- |
| board 的一个 section | 一个 `<Section id title>`，里面一行占位注释 `{/* 正文 */}` 和一个 `<Canvas frames>`。section 的 shell（含 html 页的缺省 doc）写成 `<Canvas shell>`；节里有旧页上不是 doc 的 HTML 帧时，`<Canvas shell>` 用这个 HTML 帧的壳。没有帧的 section 只留 `<Section>` |
| 页 tab | 每个 tab 第一节前加一行 `## <tab 标题>`。二级标题不占节字母，节字母全文统一排（A、B、C…），旧页是每个 tab 各从 A 起 |
| `<帧>.jsx`、sidecar `<帧>.js` | 同名复制 |
| `<帧>.html` | 同名复制，页面引用的相对资源（css、js、图片，css 和 js 里再引用的）照原相对路径复制，表里记为“资源”；引用的文件不在盘上，记一条“注意” |
| 单屏 shell（和整节最终的 `<Canvas shell>` 不同） | 复制的帧文件末尾补一行 `export const shell = "…";`。补在末尾，前面的行号不变，`data-pp-id` 和旧页一致 |
| comp 屏（`comp` + `props`） | 生成 `<帧>.jsx`：import 那个组件（页内 `./components/<Name>.jsx`，没有就从 `pinpoint/kit`），props 写成属性。节是 comp 墙、或这一屏是 comp 时，文件里写 `export const shell = "comp";` |
| 帧 import 的组件和其他文件 | 按编译器的依赖记录（传递）照原相对路径复制，相对 import 不用改；没被用到的组件不复制 |
| `assets.css` | `article.css`。只有一份就是改名；几份按顺序拼起来，`@import` 提到最前 |
| `assets.js` | `article.js`。只有一份就是改名；几份照原路径复制，`article.js` 依次 import 它们 |
| 引用到的静态文件（图片、字体、音视频、pdf） | 复制到 `assets/<原相对路径>`（原本就在 `assets/` 下的不再套一层） |

地址改写：页地址 `/sites/<页>/x`（模板页是 `/previews/<页>/x`）换成 `/sites/<新页 id>/…`，静态文件指到 `assets/x`，迁走的源文件指到新名字（页级 css 指到 `article.css`）。css 里的相对 `url()` 按 css 自己的位置重算。帧和组件里写的相对静态文件路径在运行时按页地址解析，所以按页根算，改成 `./assets/x`。拼出来的地址（`` `/sites/<页>/icons/${name}.svg` ``）找不到单个文件，就把 `icons/` 整个目录复制到 `assets/icons/`。

帧标题、section 的 `layout: "column"`、screen 的 `role` 不带过来，输出里各记一条“注意”。

### 拦下

下面这些情况一个文件都不写，逐条列出后退 1：帧没有源文件、HTML 帧引用了页目录外的文件、`.` 开头的隐藏文件或 `index.mdx`（都是服务不出的文件，规则同“HTML 帧”一节；列出文件和行）、HTML 帧在旧页的壳和整节最终的 `<Canvas shell>` 不同（HTML 帧不能单帧写 shell，没写 `<Canvas shell>` 时是 doc，所以同一节里 doc 和 app 的 HTML 帧也拦）、帧或组件 import 了页目录外的文件（kit 除外）、comp 屏的组件在页内和 kit 都找不到、同一帧出现在两节、section 或帧的 id 不合文章的规则、两份文件要写到同一个路径。

所有要复制的文件都要在页目录内，帧、组件、依赖、`assets.css`、`assets.js`、HTML 帧的资源和搬进 `assets/` 的静态文件都一样。路径带 `..` 越出页目录，或者是 symlink、真实位置在页目录外，都拦下。要写的每个路径也都要在新文章目录内。写的时候先核对全部目标，再逐个写，已有的文件不覆盖。

### 校验

写完之后从新的 `index.mdx` 派生 board（和服务同一条路），逐帧编译到临时目录，与旧页的渲染逐行比，打一张表：编号 · 帧 · 来源（复制 / comp 生成）· shell · 编译 · 与旧页。最后一列是“相同”、“只差地址”或“差 n 行”。“只差地址”指把旧页 HTML 里的旧地址换成新地址，再去掉几份资源合并后重复的注入行，两边逐字相同。有帧编不过、或某帧的 shell 和旧页不同，退 1，文件照样写，修好后跑 `ppnt build <新页 id>`。

编译只写临时目录，不写数据目录的 dist。project 登记后，服务的 watcher 会自己编这篇。

命令最后列出下一步，按顺序编号：project 没登记时先登记；`ppnt check` 验证整篇；`ppnt shot <新地址> --canvas` 和 `ppnt shot <旧页 id>` 对比；把每节的 `{/* 正文 */}` 换成文字；旧页还有几条没关的标注、怎么处理；撤旧页由 owner 定（dir 条目是 `ppnt remove <旧页 id>`，模板页要改 pinpoint 仓库）。`--dry-run` 只提示去掉它再跑；有帧编不过时，第二步换成“修好再验证”。

实现在 `src/server/lib/page-migrate.js`（`planPageMigration`、`writeMigration`、`verifyMigration`），命令在 `bin/cli/migrate.js`。

## 保留名

project id 是站点 URL 的第一段（文章 `/<project>/<article>/`、首页 `/<project>/`、wiki `/<project>/wiki/<slug>/`、`/<project>/llms.txt`），不能占服务已用的首段。唯一的清单是 `src/shared/project-ids.js` 的 `RESERVED_TOP_SEGMENTS`（外加前缀 `test-results*`、`playwright-report*`），服务路由（`article-routes.js`）和登记校验（`isReservedProjectId`）用同一份。清单包括：

- 服务自己的前缀 `api sites workbench kits assets annotate _astro`；
- 服务路由 `health registry events annotations images image save previews lib`；
- vite 按仓库根服务静态文件，仓库根的顶层目录也都是首段：`src content node_modules bin docs e2e scripts skills site tasks prototypes`，以及 e2e 产物目录前缀。`projects.test.js` 与 `article-routes.test.js` 都检查仓库根的每个顶层目录都在清单里，新增顶层目录时测试会提醒补上；
- Astro 的 `_image`。

article id `wiki` 与 `concepts` 保留（`RESERVED_ARTICLE_IDS`：`wiki` 是 wiki 页的第二段，`concepts` 是它 301 过去的旧地址），只在 `src/shared/project-ids.js` 里。

## 固件

- `e2e/project-site/`：project `e2e-project`，两篇文章（`commit-confirm`、`takeover`）、两条 wiki 词条（`confirm-card`、`takeover-banner`），没有布局错误。正文里有指向文章、词条和一个空 ref 的 `[[ ]]`。`commit-confirm` 有画布：三个 Section，其中两节有 Canvas（`confirm`：`confirm-sheet`、`confirm-done`；`variants`：`card-plain`，`shell="comp"`）。帧用到本篇组件 `ConfirmCard`、`Banner` 和 kit 的 `Nav`，本篇有 `article.css`。`commit-confirm` 还有两个图：第一节前的静态时序图 `wait-sequence`，第一节 `why` 里的逐步演示 `message-flow`（带 sidecar 和样式）。
- `site/fixtures/projects/demo/`：`payments` 有两个图（节外的静态时序图 `pay-sequence`，`overview` 节里的 `message-flow`）；`site/fixtures/projects/broken/` 有一个源文件不在的图。
- `site/fixtures/projects/clash/`：project `clash`，article `confirm-card` 与 wiki 词条 `Confirm-Card`（`wiki/confirm.md`）撞名，读取时恰好一条布局错误；站点构建拒绝它，服务与 CLI 的单测也用它。

- `e2e/html-site/`：project `e2e-html`，一篇 `pages`：一节放本篇的 `long-page.html`（很长）、project 根下的 `shared/catalog.html` 和 source `kit`（`e2e/html-source/`）下的 `widget.html`，一节放手机 JSX 帧。HTML 帧的 e2e 用它。
- `e2e/prose-site/`：project `e2e-prose`，一篇 `notes`（两节，同一句话各出现一次，带一张画布卡片），正文评论的 e2e 用它；e2e 登记的是本轮复制出的副本，spec 会改正文。

`e2e-project`、`e2e-prose` 与 `e2e-html` 常驻 e2e 的共享 registry 固件（project 不进“页面”组）；`clash` 不登记。
