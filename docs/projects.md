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
- 每个 article 目录必须有 `index.mdx`。`articles/` 下只放目录，以 `.` 开头的文件忽略。
- `concepts/` 下只读 `*.md`，其他文件忽略。concept 的 `name` 缺省用文件名（不带 `.md`）。

## frontmatter

`index.mdx` 与 `concepts/*.md` 开头可以有 `---` 包起来的 frontmatter，每行一条 `key: value`：

| 文件 | 字段 | 缺省 |
| --- | --- | --- |
| `articles/<id>/index.mdx` | `title`、`summary`（可选） | `title` 缺省用 article id |
| `concepts/<名字>.md` | `name`、`status`（占位 / 收敛中 / 已固定）、`boundary`（一句边界） | `name` 缺省用文件名 |

值可以用单引号或双引号包起来，不带引号时 ` #` 之后算注释。列表、嵌套、多行值都不支持：读到这样的行记一条布局错误，该字段按缺省处理。其他键照常解析，读取模块不使用。

## 命名空间

`[[名字]]` 既能指向 article 也能指向 concept，所以同一个 project 里 article id 与 concept `name` 共用一个命名空间，两个 concept 也不能同名。比较时不分大小写、去掉首尾空白（Obsidian 同规则）：article `confirm-card` 与 concept `Confirm-Card` 算撞名。撞名的双方都照常列出，同时记一条布局错误。

## 登记

```shell
pinpoint add <project 根> --project
```

- id 只取 `project.json` 的 `id`。`--id` 可以写，但必须与它相同；要换 id 先改 `project.json`，或用 `pinpoint rename`。标题取 `--title`，否则取 `project.json` 的 `title`，再否则取目录名。
- `--project` 不能与 `--board`、`--page`、`--draft` 同用：project 不是页，没有壳，也不挂到别的页上。
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

`registry` 是 `loadRegistry` 的结果或服务的 registry store，读的是它的 `projects`（`loadRegistry` 把 `kind: "project"` 的条目放在这里，不放进 `entries`）。返回形状：

```json
{
  "id": "e2e-project",
  "title": "E2E Project",
  "root": "/abs/project-site",
  "dir": "/abs/project-site/docs/pinpoint",
  "articles": [{ "id": "commit-confirm", "title": "提交前确认", "summary": "…", "dir": "/abs/…/articles/commit-confirm", "file": "/abs/…/articles/commit-confirm/index.mdx" }],
  "concepts": [{ "name": "confirm-card", "slug": "confirm-card", "status": "收敛中", "boundary": "…", "file": "/abs/…/concepts/confirm-card.md" }],
  "errors": []
}
```

- article 按 id 排序，concept 按 `name` 排序。`summary`、`status`、`boundary` 没写时不出现。`slug` 是 concept 的文件名（不带 `.md`）。
- 读取从不抛错。根目录不存在、缺 `docs/pinpoint/`、`project.json` 缺失或坏掉、id 与登记的不一致、撞名、frontmatter 看不懂，都写进这个 project 的 `errors`（字符串，路径相对 `docs/pinpoint/`）。根目录或 `docs/pinpoint/` 不在时 `articles` 与 `concepts` 为空；`project.json` 坏了照样读文章。
- 每次调用都重读磁盘，加文章不用 reload。

HTTP：`GET /api/projects` 返回 `listProjects` 的数组，`GET /api/projects/<id>` 返回一个 project，没登记 404。`GET /health` 的 `registry.projects` 是 project 条目数，顶层 `projects` 是 `{count, errors}`，errors 每条前缀 `<project id>: `。

## 保留名

project id 是站点 URL 的第一段（文章 `/<project>/<article>/`、首页 `/<project>/`、概念 `/<project>/concepts/<名字>/`、`/<project>/llms.txt`），不能占服务已用的首段。清单是 `projects.js` 的 `RESERVED_PROJECT_IDS`：

- 2026-10-13 定的 `api sites workbench kits assets annotate _astro`；
- 服务路由 `health registry events annotations images image save previews lib`；
- vite 按仓库根服务静态文件，仓库根的顶层目录也都是首段：`src content node_modules bin docs e2e scripts skills site tasks`。`projects.test.js` 检查仓库根的每个顶层目录都在清单里，新增顶层目录时测试会提醒补上。

## 固件

- `e2e/project-site/`：project `e2e-project`，两篇文章（`commit-confirm`、`takeover`）、两个概念（`confirm-card`、`takeover-banner`），没有布局错误。正文里有指向文章、概念和一个空 ref 的 `[[ ]]`。
- `e2e/project-collide/`：project `e2e-collide`，article `confirm-card` 与 concept `Confirm-Card` 撞名，读取时恰好一条布局错误。

两个固件都没有登记进 e2e 的共享 registry 固件。
