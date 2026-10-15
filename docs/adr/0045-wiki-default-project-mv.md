# 0045 · 概念改叫 wiki；删掉 project 级共用组件；默认 project `notes`；`ppnt mv` 合并 `rename` 与 `move`

Status: 现行 · Date: 2026-10-15 · Revises-in-part: 0042（`concepts/` 目录与概念页地址、project 级 `components/`）、0044（project 仍要先建再写） · Scope: `src/server/lib/projects.js`、`src/shared/project-ids.js`、`src/server/lib/article-routes.js`、`src/server/article-proxy.js`、`src/server/lib/article-board.js`、`src/server/lib/page-compiler.js`、`src/server/preview-hmr.js`、`site/src/pages/[project]/wiki/`、`bin/cli/new.js`、`bin/cli/mv.js`、`bin/cli/registry.js`、`bin/cli/uses.js`、两个 skill

**起因**：0044 把 project 退成一批文章的容器之后，owner 继续往 KISS 收（2026-10-15）：“project 这个概念我提的有点早了，其实他就是 folder，用来管理一批 article，真正重要且承载信息的应该是 article”。project 留着，但围着它长出来的机制要么改名、要么删掉，要么不再要求先想好放哪。

**Decided**（2026-10-15 owner，加实现时自定的部分）：

- **`[[ ]]` 指向的词条叫 wiki**。owner：“`[[ ]]` 概念表……这个是不是可以叫 wiki”。目录 `docs/pinpoint/concepts/` 改成 `docs/pinpoint/wiki/`，地址 `/<project>/concepts/<slug>/` 改成 `/<project>/wiki/<slug>/`，旧地址 301 到新地址；界面上的“概念”改叫 wiki，一条叫“wiki 词条”。`[[ ]]` 的写法和命名空间不变。不留读旧 `concepts/` 目录的兼容：盘上还有这个目录时，`ppnt check` 报布局错误 `wiki_dir_renamed`，提示改名。`/<project>/wiki/` 是这个 project 的词条列表（实现自定）。代码里的标识符（`project.concepts`、`kind: 'concept'`、`CONCEPT_STATUSES`）不改名（实现自定）：它们是内部接口，改名只是搬字，CONTEXT.md 写明别名。
- **删掉 project 级共用组件**。owner：project 级共用组件没人用，跨文章复用走 kit。组件查找序从“本篇 → project `docs/pinpoint/components/` → kit”收成“本篇 → kit”。盘上还有 project 级 `components/` 时，`ppnt check` 报布局错误 `project_components_dir`，提示挪进用到它的文章或 kit。
- **默认 project `notes`**。owner：“允许 default project，让我可以无压力的随时丢文章到 ppnt 而不用思考放哪个 proj 放哪里”，位置“放到 workspace/notes/ 下”。`ppnt new article <id>`（不带 `/`）建在 id 为 `notes` 的 project 里；它没登记时，命令先在默认根目录建好骨架并登记（id `notes`，title `Notes`）。默认根目录不写死在代码里：环境变量 `PINPOINT_DEFAULT_PROJECT` 给出，缺省 `~/notes`，和 `PINPOINT_DATA_DIR`、`PINPOINT_REGISTRY` 同一种配置方式（实现自定）。登记过之后以登记表为准，环境变量只在第一次建的时候用。owner 机器上的 `notes` 登记在 `~/workspace/mori-ws/notes/`。
- **`ppnt mv <源> <目标>` 合并 `rename` 与 `move`**。owner：“cli 的命令要服从最佳实践，unix-like，ppnt move-article 感觉很不优雅”。按目标的写法决定做什么，像 Unix `mv`：
  - `<project>/<a> <project2>/<b>`：文章换 project 和 / 或改 id，目录搬过去，标注桶 `<p>_<a>` 迁到 `<p2>_<b>`，账本里的 `pageId` 和 `path` 改写；目标已存在或目标桶非空就拒绝。
  - `<project> <新 id>`：project 改 id（原 `rename`）。
  - `<project> <路径>`：目标以 `/`、`.`、`~` 开头时是磁盘路径，换 project 根（原 `move`）。
  - 存量页的 id 同理：`<页 id> <新 id>`、`<页 id> <路径>`。
  - `rename`、`move` 两个命令删掉，不留别名。`--dry-run` 只列计划。
  - 文章搬到别的 project 时，HTML 帧的 `{ id, src }` 在新 project 里找不到（source 名没登记、相对 project 根的文件不在）就拒绝，列出缺什么；没有 `--force`（实现自定）：搬过去就是坏帧，先在新 project 的 `project.json` 登记 `sources` 或把文件放过去，再搬。别的文章里指向它的 `[[ ]]` 不改，逐个列成注意。

**Why**：读者和 agent 打交道的是文章；project 只是文件夹，文件夹不该要求先命名、先登记，也不该有自己的一层组件。wiki 是这类词条最常见的叫法，“概念”和日常说话里的概念混在一起。`mv` 一个命令做“换名”和“换位置”，是 Unix 用户已经会的心智：源和目标写什么，结果就是什么。

**否掉的**：

- 读旧 `concepts/` 目录做兼容：两种目录并存，`[[ ]]` 解析和地址都要多一层判断；owner 只有三个 project，改一次目录名就完。
- 默认 project 的根目录写进 `~/.pinpoint/` 下的新配置文件：现有配置全是环境变量，多一种配置文件就多一处要查；登记之后登记表就是答案，用不上配置文件。
- `mv` 留 `rename`、`move` 当别名：两种写法并存，skill 和文档要讲两遍，agent 会继续用旧名字。
