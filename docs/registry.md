# registry 与注入契约

**登记过才注入。** annotate client 只落在登记过的目标上，其余一切打开的是逐字节相同、
零标注面的页面。登记表装两类东西：project（文章的家，目录与读取见 [`docs/projects.md`](projects.md)）和存量页的来源
（目录、单个 HTML 文件、网址）。本文是这条契约的完整形状：登记表长什么样、怎么写、client 有哪几条投递路径。
词的定义见 [`CONTEXT.md`](../CONTEXT.md)；登记 project 的步骤见
[`skills/pinpoint-build/SKILL.md`](../skills/pinpoint-build/SKILL.md) 第 1 节。

## 登记表

`src/server/lib/registry.js` 读 `~/.pinpoint/registry.json`（`PINPOINT_REGISTRY` 覆盖路径）。
形状 `{"version":1,"entries":[...]}`，另有可选的 `folders` / `pageFolders` /
`pageOrder` 三段（见下面“分组层”）。存量页的条目
`{id, title?, kind: "dir"|"file"|"url", path? | url?, board?, page?, role?, folder?, order?}`。
`kind: "project"` 的条目只有 `{id, title?, kind, path}`，`path` 是 project 根目录；
它与其他条目共用 id 命名空间，但没有自己的页 id 和桶，`loadRegistry` 把它放进 `projects` 而不是 `entries`。
目录、登记与读取见 [`docs/projects.md`](projects.md)。

- `id` 必须匹配 `^[a-z0-9][a-z0-9-]*$` 且唯一；`title` 缺省等于 id。
- `board`（`ios`/`html`）只给 dir 条目的默认壳播种（缺省与遗留值 `web` 都归一成 `html`）；
  file 条目永远在阅读器里打开，不带板。
- `page` + `role`（`"product"` 默认 | `"draft"`）是挂靠字段：带 `page` 的条目**不**自己成为“页面”组的一行，
  而是并进目标存量页的“内容”区（`role:"draft"` 时进草稿组）。url 条目永远是独立页，
  所以对它写 `page` 是非法的（会被显著跳过）。
- 条目的 `kind` 一路透传到 workbench 的 page manifest 和 board 条目上，所以 url 条目的
  document 条目在“内容”区带“网页”类型 tag。
- 文件缺失时用默认的只含 pinpoint 一条的登记表（`{id:"pinpoint", kind:"dir", path:<仓库根>}`）。
  JSON 坏了或顶层形状不对就回落到默认并记下 error；单条非法只跳过那一条；
  dir / file 路径不存在是 warning，不是删除。
- 全部状态可见：`GET /health`（registry 摘要，那里的 `entries` 是**数量**）与
  `GET /registry`（完整 `entries` 列表）。
- `GET /registry` 返回 `pageTimes`，条目也带 `addedAt`（登记时刻）、`mtime`（内容修改，目录递归取最大）、`annotatedAt`（逐页标注变动）。新增登记写入 `addedAt`，移动保留；历史添加时间未知时不补造。URL 页的内容修改时间未知。
- 标注账本的 `page_updated_at` 保留逐页时间，新增、修改和删除标注都会更新；无变化或冲突拒绝的保存不更新。旧单页账本可使用保存时间，旧混合账本无法准确归属时留空。

## 分组层（文件夹）

**owner 自己建夹、把存量页拖进去，一层，不嵌套**（2026-09-04 owner 定）。文章不进文件夹。同一份登记表多三段顶层字段：

```json
{
  "version": 1,
  "entries": [{ "id": "weekly-review", "kind": "dir", "path": "…", "folder": "design", "order": 0 }],
  "folders": [{ "id": "design", "name": "设计稿", "collapsed": true }],
  "pageFolders": { "library": "design" },
  "pageOrder": { "library": 1 }
}
```

- `folders[]` 是那一层夹：`{id, name?, collapsed?, order?}`。折叠只留 `true`，`name` 是自由文本、
  缺省等于 id。夹 id 与条目 id 是同一套模式（`^[a-z0-9][a-z0-9-]*$`），但**两个命名空间各自独立**——
  条目的 `folder` 只引用 `folders[]` 里的 id，夹 id 撞上某个条目 id 不是冲突。
  数组顺序就是左栏顺序（拖动重排 = 整表按新顺序写回）。
- 条目的 `folder` / `order`：归属哪个夹、手动次序（`order` 只在 workbench 的排序档是“默认”时生效）。
- `pageFolders{}` / `pageOrder{}` 装的是**不在登记表里的** manifest 页（Component Library 等来自
  `content/previews/_index[.local].json`）——它们没有条目可以写字段，归属与次序只能记在顶层。
  键撞上某个 registry 条目 id 时那条映射是死数据（条目自己的字段才算数），读侧 warn 掉。
- **分组从不决定一个页存不存在。** 指着不存在的夹是 warning + 那个条目变散页（丢“页面”组的一行比丢一层
  分组难查得多），坏 `order` 同样只 warn 掉；夹自己 id 重复或不合模式才是 error，且只毙那一条，
  另一个夹与所有页照旧。顶层形状不对（`folders` 不是数组、`pageFolders` 不是对象）是 error，条目照常读。
- **删夹永远不删页**：指着它的条目丢掉 `folder` 字段变成散页，`pageFolders` 里的映射一并去掉。
- `GET /registry` 的载荷带 `folders` / `pageFolders` / `pageOrder` 三段；`/health` 的 registry 摘要里
  `folders` / `pageFolders` 是**数量**（与那里的 `entries` 是数量同一条惯例，完整清单永远走 `GET /registry`）。

### workbench 的三条写接口

左栏的拖放不绕 CLI。三条 PUT 与 `POST /registry/reload` 是同一条即时生效路径——一次原子写 →
reload 共享 store → 广播 HMR 的 `registry:update`（打开着的 workbench 立刻重排左栏）——
应答直接就是重载后的完整 `/registry` 载荷，调用方不用再打一次 GET：

| 端点 | body | 做什么 |
| --- | --- | --- |
| `PUT /registry/folders` | `{folders:[…]}` | 整表替换：新建 / 改名 / 删除 / 折叠 / 重排共用这一条 |
| `PUT /registry/entries/:id/folder` | `{folder: id｜null, order?}` | 一个页进夹 / 出夹（`null` = 拖成散页） |
| `PUT /registry/order` | `{ids:[…]}` | 按给定顺序写 `order` 0、1、2… |

`:id` 是 registry 条目就改条目自己的字段，是本地 manifest 页就落 `pageFolders` / `pageOrder`。
“id 认不认识”的名单 = registry 条目 + `content/previews/_index[.local].json` 里的模板页
（服务自报的 root 下读，与 CLI 的 `--page` 共用 `src/server/lib/page-manifest.js`）。
未知 id、未知文件夹、坏 `order`、重复或带未知字段的 folders 一律
`400 {error:"bad_request", message:"<一句人话>"}`，且登记表一个字节不动；
静态快照（测试里的 `loadRegistry` 结果）答 `409 registry_not_writable`，与 reload 的 409 同款。

## 写入走 CLI；文件夹操作也可以来自 workbench

**条目**的写入（登记、重指、改 id、删除）只有 CLI 一个入口。**文件夹**有两个：CLI 的 `pinpoint folder`
和 workbench 左栏的拖放（走上面那三条 PUT）——写的是同一份登记表、同一条原子写，谁先谁后都行。

`bin/pinpoint.mjs`（`npm link` 一次把 `pinpoint` 放上 PATH）：

```bash
pinpoint add    <dir|file.html|http(s)-url> [--title X] [--board ios|html] [--id xxx] [--page pageId] [--draft]
pinpoint add    <project 根> --project
pinpoint move   <id> <dir|file.html|http(s)-url>
pinpoint rename <旧 id> <新 id>
pinpoint remove <id>
pinpoint list   [关键词…]
pinpoint folder list | add <名称> [--id xxx] | rename <id> <新名称> | rm <id> | move <页 id> <夹 id|none>
```

`list` 只读：每页一行 id · 标题 · 类型 · 标注计数 · 文件夹，次行源路径；project 下面每篇文章一行 `<project>/<article>`。带关键词时在 id、标题、路径、文件夹名上宽松匹配（英文复数自动去 s），也匹配文章的 id 和标题，给 agent 把 owner 的口头说法对上地址。

`add` 原子追加到登记文件（`--registry` 覆盖路径，给脚本和测试用）。`--page` 把条目挂到一个既有页上
而不是在“页面”组新增一行——目标必须能解析（本地 manifest 页或另一个 registry 条目 id，写之前就查），
对 url 目标会被拒绝；`--draft` 必须搭配 `--page`，把条目放进草稿组。

**`--page` 是“挂到既有页 `<id>`”，不是“指定本条目的 id”。** 本条目自己的 id 用 `--id`。
反例：`pinpoint add ./v2 --id weekly-review-v2` 是让这个条目自己叫 weekly-review-v2；
`pinpoint add ./v2 --page weekly-review` 是把它塞进 weekly-review 那一页的“内容”区、
自己不成“页面”组的一行。

`move` 原地改一个既有条目的落点（dir / file / url 三种目标，校验方式与 `add` 一致：路径必须存在、
单文件必须是 .html、URL 必须 http(s)），**id 与 title 原样保留**——标注桶按页 id 寻址（条目自成存量页时桶是 `~/.pinpoint/<id>/`，挂靠条目（带 `page` 字段）用宿主存量页的桶），
所以换路径不动既有标注。kind 跟着新目标走，`board` 只在 dir 上留着
（改成 file / url 时丢掉，那两种壳是定死的）；挂在某页上的条目不能改指 url（url 恒为独立页），
会被响亮拒绝。未知 id、目标不存在都整单失败，registry 一个字节不动。

`rename` 换的是 id 本身。id 同时是三个地方的地址——登记表里的条目 id、标注桶
`~/.pinpoint/<id>/`、以及页面资源的 URL 前缀 `/sites/<id>/`——手改其中一个另外两个就错位，
所以 `rename` 一次改齐，并且**四件事都能做才动手**（预检不过时 registry 一个字节不动）：

1. **登记表**：条目换 id，位置、kind、落点、title 全部保留；其它条目的 `page` 字段指着旧 id 的
   跟着改（挂靠指向一个不存在的页，那个条目会静默从 workbench 里消失）。新 id 已存在就整单失败。
2. **标注桶**：`~/.pinpoint/<旧 id>/` 改名成 `~/.pinpoint/<新 id>/`。旧桶不存在就跳过；
   新桶已存在是硬冲突（两个桶不会自动合并），响亮拒绝。
3. **资源前缀**（只有 dir 条目有）：条目目录下所有 `*.html` / `*.css` / `*.js` 里的
   `/sites/<旧 id>/` 换成 `/sites/<新 id>/`，跳过 `node_modules` 与逃出条目目录的 symlink，
   打印改了几个文件、分别是哪些。file / url 条目没有目录可扫，这一步跳过。
   相对路径不用改——`src/workbench/lib/sidecar-css.js` 装配 fragment 时按 `pageBaseUrl` 重写。
4. **重载**：与 `add` / `move` 同一条即时生效路径。

**把两个条目并成一个 = `rename` + `move`**：先把要保留的那个条目 `rename` 成目标 id，
再把另一个条目的内容 `move` 到同一个落点（或用 `pinpoint remove` 把它从登记表里删掉）。
`rename` 自己不做合并——目标 id 已被占用时它一律拒绝，不会去动别人的标注桶。

project 条目没有自己的桶，`rename` 与 `remove` 对它按每篇文章的桶 `<id>_<文章>/` 做，见
[`docs/projects.md`](projects.md)“rename 与文章桶”。

`remove <id>` 把条目从登记表里删掉，**只删登记，不删文件**——源文件 / URL 留在原地，
重新 `add` 同一个目标即恢复登记。三种情况拒绝动手（registry 一个字节不动）：id 不存在；
还有条目挂着它（`page` 等于它，先把那些条目 remove 掉）；标注桶 `~/.pinpoint/<id>/` 里
还有标注行（先在工作台处理，或 `pinpoint prune <id>` 清掉孤儿账本）。桶不存在或只剩
空账本 / `_seq.json` 时放行，并顺手删掉这个空桶。

**撞 id 是错误，不是自动改名。** 裸 `pinpoint add` 派生出的 id 或显式 `--id` 撞上既有条目时，
CLI 打印“id 已存在，指向 `<path>`；更新路径用 `pinpoint move <id> <新路径>`，要新条目请显式
`--id <其他 id>`”并退非零。自动改名会开一个空桶、让既有标注变成孤儿，所以一律报错。

`folder` 管的是上面那层分组，五个子命令：

- `folder list` 只读，打一张表：夹 id / 名称 / 页数 / 是否折叠。页数 = 指着这个夹的 registry 条目
  加上 `pageFolders` 里指着它的 manifest 页。登记表还不存在时它打一张空表，不算失败。
- `folder add <名称> [--id xxx]` 建夹。id 缺省由名称 slug 派生（`Design Drafts` → `design-drafts`）；
  中文名派生不出 slug，必须显式 `--id`。撞既有夹 id 一律报错并指路 `folder rename`。
- `folder rename <id> <新名称>` 只改显示名，id 不变——条目的 `folder` 引用因此不用跟着改。
- `folder rm <id>` 删夹，并打印夹里的哪几个页变成了散页。**没有任何页会被删。**
- `folder move <页 id> <夹 id｜none>` 一个页进夹 / 出夹。页 id 可以是 registry 条目 id，
  也可以是本地 manifest 页 id（后者落 `pageFolders`）；`none` = 移出来变散页。

`list` 之外的四个子命令要求登记表**已经存在**：整表写回不带默认的 pinpoint 条目，
给一份不存在的登记表播种会写出一份没有 workbench 自己那条的表。先 `pinpoint add` 登记点什么，
再建夹。未知的页、未知的夹、撞车的夹 id 都在写之前拒绝，registry 一个字节不动。

写侧在 `src/server/lib/registry-store.js`（`addRegistryEntry` / `updateRegistryEntry` /
`renameRegistryEntry` / `removeRegistryEntry` / `writeRegistryFolders` / `setEntryFolder` /
`assignRegistryOrder`
共用同一条原子写）：严格校验（id 唯一、kind 合法、dir/file 路径存在、
url 是 http(s)、page/role 合法、未知字段拒写）、tmp+rename、2 空格 JSON。
这个 store 同时是服务端的活视图：annotate / sites / export 三处插件共享同一个实例
（在 `vite.config.js` 里接线），`POST /registry/reload` 原地换快照——CLI 在 add 成功后、
服务 `/health` 有响应时会自己调它，所以新条目不重启就能 serve、注入、分桶；
已打开的 workbench 经 HMR 的 `registry:update` 事件学到（那个事件同时重挂当前板，
挂靠条目会立刻出现或消失）。静态快照会答 `409 registry_not_reloadable`。

`add`、`move`、`rename`、`remove` 与 `folder` 的写子命令写盘后都走同一条即时生效：探活 `/health`，可达就 `POST /registry/reload` 并打印
重载结果（重载了几条 / 服务在用的是另一个 registry 文件 / 服务没在跑，下次启动生效）。

服务本身的起停在 `pinpoint status｜start｜stop｜restart`，见 [`AGENTS.md`](../AGENTS.md) 的
“起服务与验收”。

## 三条投递路径

这一节讲存量页和 workbench 的投递；文章页的注入走 `src/server/article-proxy.js`，只跑正文评论，见 [`docs/projects.md`](projects.md)“标注桶”。

client 只有一份：`src/client/annotate.js`，构建（`src/server/lib/annotate-bundle.js`，esbuild 打包
共享库 + minify + 预压缩）成自包含 IIFE 后按内容哈希 serve 在 `/annotate.<hash>.js`
（`Cache-Control: immutable`，pinpoint 生成的注入点都引用它）；老地址 `/annotate.js` 发同一份
产物（ETag + no-cache），留给内容页里的手写标签。

### 1 · workbench 自己的页面

`ios-kit.js` 只在 loopback / `.localhost` 主机上自注入 annotate 客户端（serve 时字面量被换成
当前哈希地址；退出方式：`<html data-annotate="off">`）。
独立文档抄同一段尾部脚本，并在不是被嵌入时调 `pinpoint.setFloatingToolbar(true)`——
见 `content/previews/doc-library/sample-report.html`。

还有一层（ADR 0027）：`src/server/preview-inject.js` 给任何含 `<!doctype` 的 `content/previews/**.html`
响应自动注入 client（`?annotate=off` 豁免，片段没有 doctype 天然放行）。previews 的注入
**不带 entry 标记**，账本 ENTRY 保持缺省 `'pinpoint'`。

### 2 · dir 与 file 条目 → `/sites/`

`src/server/sites-api.js` 把登记目录只读地服务在 `/sites/<entry-id>/<path…>`（只接 GET/HEAD，
其余 405）。登记表就是白名单：未知 id 404；`..` 按文本拒绝，symlink 逃逸按 realpath 包含判定；
目录回落到 `index.html`。HTML 的 GET 响应在 `</body>` 前注入
`<script>window.__pinpointEntry='<页桶 id>'</script><script src="/annotate.<hash>.js"></script>`
——值是条目的标注桶 id，即 `entry.page || entry.id`：条目自成页时是自己的 id，
挂靠条目是宿主存量页的 id（一个页 id 一个桶）。
（没有 `</body>` 就追加在末尾）；`?annotate=off` 给出磁盘上的原始字节——
workbench 的内联片段加载器与导出渲染走的就是它。

**file 条目**共用同一条注入 / annotate=off 管线，但只对那一个登记文件：
`/sites/<entry-id>/` 和 `/sites/<entry-id>/<basename>` 都服务它，其它任何拼法
（穿越、同目录的兄弟文件）一律 404。file 条目也出现在“页面”组里，永远是 doc 壳。

没有自带 `board.json` 的条目照样可读：`/sites/<id>/board.json` 服务一份合成的 doc 板
（`src/server/lib/synth-board.js`）——file 条目一屏，dir 条目按顶层 `*.html` 排序各一屏。
磁盘上的 `board.json` 永远优先。`ios` 板的 dir、以及没有任何顶层 HTML 的 dir 不合成（404）。
合成板里屏的 `src` 做 percent-encode，好让 iframe URL、`location.pathname`、
导出管线算标注 page key 的那个 hash 三者逐字节一致。

### 3 · url 条目 → 两条并存的路径，落进同一个桶

**同源代理内嵌** — `src/server/lib/site-proxy.js` 把登记的 origin 代理在
`/sites/<entry-id>/` 下。来自 pinpoint 自己来源的请求，所有方法 / 头 / body 透传（dir 与 file 仍只接 GET/HEAD），
于是活的应用在 workbench 的 doc 壳 iframe 里同源渲染，侧栏经既有的 ann-bridge 直接驱动它的
annotate 实例。别的来源的写请求和 websocket 回 403，GET / HEAD 不带 Origin 转发；规则与文章代理同一份
`src/server/lib/proxy-origin.js`，见 [`docs/design.md`](design.md)“服务路由（文章站点）”。

响应手术：`Set-Cookie` 重基（去掉 Domain，Path 加/补前缀）、3xx 的 `Location`（以及来自 pinpoint 自己来源的请求
`Referer`）在前缀与目标 origin 之间改写、CSP / CSP-Report-Only / X-Frame-Options / COOP / COEP
整体剥离——页面必须能进 iframe 并跑内联 bootstrap，安全边界由登记表白名单承担
（上游 TLS 校验关闭：localhost 开发 origin 用的是私有信任的 CA）。HTML 响应里根绝对的
`src` / `href` / `action` / `poster` / `formaction` / `srcset` / `imagesrcset` / `xlink:href`、
`<object data>`、`<meta refresh>`、`<style>` 正文和 `style="…"` 属性都改写到前缀上；
CSS 响应改写 `url(/…)` 与 `@import "/…"`。

HTML 改写够不着的地方——JS 里的 `fetch('/api/…')`、XHR、`EventSource`、`WebSocket`、`sendBeacon`——
由一段**重基 bootstrap** 兜底：作为 `<head>` 的第一个脚本注入（`proxyBootstrapSnippet`，内联
`src/shared/proxy-rebase.js`），给这五个 API 打补丁，把根绝对（以及指向自身 / 目标 origin 的绝对）URL
重基到前缀上，按名字豁免 annotate client 自己的端点（`REBASE_EXEMPT_*`：`/annotate.js`（老地址）
与哈希地址 `/annotate.<hash>.js`（严格形状，与 annotate-bundle 的产物地址正则同形）、
`/save`、`/image`、`/annotations[…]`、`/images/…`、`/events`、`/sites/…`）。

bootstrap 还会**虚拟化 URL**：在任何页面脚本跑之前 `history.replaceState` 回不带前缀的应用路径
（`virtualAppPath`）。因为 SPA 路由直接读 `location.pathname`——那是原生 getter，补丁拦不住——
不虚拟化就会掉进它们的 catch-all。副作用是好的：标注账本因此落在应用路径（`/`、`/global`、…），
与应用在自己 origin 上直接注入 annotate client 时的账本逐字节同 key。前缀下的 WS upgrade（自己的来源）在 vite 的
httpServer `'upgrade'` 上转发到目标 origin（通用兜底；SSE 走普通 HTTP 转发）。

url 条目出现在“页面”组里（永远 doc 壳）：`/sites/<id>/board.json` 永远是合成的单屏板
（`src = sites/<id>/`），盖住上游任何同名文件。`?annotate=off` 只去掉 annotate client，
bootstrap 与 URL 改写留着——它们是代理机制的一部分，没有它们页面能渲染但所有运行时调用都打错 origin。

已知盲区：DOM 里赋值的 URL（`img.src = '/x.png'`，属性赋值没有补丁拦得住）、不带引号的属性、
协议相对（`//…`）URL、目标路由与豁免名单撞名、与 workbench 共享的 storage（localStorage /
indexedDB，同源内嵌即同一 storage 分区），以及虚拟化的两个坑——`location.reload()` 重载的是虚拟
URL（内嵌 iframe 刷新会去加载不带前缀的路径）、硬导航（`location.href = '/x'`）会跳出代理
（被 router 拦截的 SPA 链接没问题）。

所有 annotate API 路由对跨源请求答 `Access-Control-Allow-Origin: *`（不带凭证）并处理 `OPTIONS` 预检，
应用在自己 origin 上直接注入 annotate client 时靠它访问 API。

## 导出的纯净性

文档导出接受 `sites/<entry-id>/…` 形式的 src，并保证不含注入的 client：管线请求 `?annotate=off`、
在渲染浏览器里 abort 掉 `**/annotate.js`、并用 `stripAnnotateBootstrap` 从导出的 HTML 里
删掉注入片段（连 `__pinpointEntry` 标记一起）。

## CLI

`ppnt` 和 `pinpoint` 是同一个入口（`bin/pinpoint.mjs`），命令一览是 `ppnt --help`，每个命令的选项和例子是 `ppnt <命令> --help`。这一节写所有命令共用的约定：怎么写目标、找不到目标时怎么办、退出码，以及 `check`、`comments`、`show`、`shot` 这几个读文章的命令各给什么。

### 目标和引用

命令的第一个位置参数是目标，`--page <目标>` 是它的旧写法，照认。目标有这几种写法：

- 一篇文章：`<project>/<article>`（如 `browser-use/payment-confirm`）。文章网址（`https://pinpoint.localhost/<project>/<article>/`、带 `#锚点` 的也行）、画布视图网址（`/?page=<页 id>`）和页 id `<project>_<article>` 都认，输出一律打斜杠形。
- 一个 project：`<project>`。`show`、`check`、`comments` 接受它，`locate`、`mark`、`reply`、`build`、`shot` 不接受（标注和帧都在文章里）。
- 存量页：它的 id。

目标后面跟引用。节写 `§2`（文章页上的节号）、字母 `B` 或节 id；第 n 节就是第 n 个字母，纯文字的节也占一个，所以 `§2` 和 `B` 同义。帧写 `B1` 或帧 id。一条标注写 `#3`，或带上文章写 `<project>/<article>#3`；带文章的引用自己就是目标，这时可以不写第一个参数。

解析在 `bin/cli/address.js`：`parseAddress` 只看字面，`resolveAddress` 再对照 registry 和磁盘判断它是文章、project、存量页，还是不在的文章。像引用的写法（`#3`、`B1`、`§2`、`@a:…`）不会被当成目标。

### 找不到目标、写错参数

- 没写目标，或目标指不到任何东西：命令报错，列出最多 15 个候选地址（文章打斜杠形，存量页打 id），退 2。不会取 registry 的第一页代替。
- `<project>/<article>` 的 project 登记了、这篇不在：报“project X 里没有 articles/Y/index.mdx”，只列这个 project 的文章。
- 写了命令不认的选项、选项缺值、参数个数不对：打一行错误、一行用法，再指向 `ppnt <命令> --help`，退 2。`list` 的关键词里出现 `--x` 也算写错，不当关键词。

退出码：0 成功；1 运行时失败（有验证错误、服务没在跑、标注写入冲突）；2 用法错或找不到目标。

### `ppnt check <project>[/<article>]`：验证

汇报前跑一次，看全这篇（或整个 project）的问题。不写 dist，不需要服务在跑（`src/server/lib/article-check.js` 的 `checkProject`）。

- 布局错误：`listProjects` 读出的 `errors`，code 定义在 `src/shared/project-errors.js`，各种写法见 [`docs/projects.md`](projects.md)“读取”和“画布视图”。
- 帧：正文里每个 `<Canvas>` 列的帧都编一遍，包括因布局错误不进画布视图的节。code 是 `lint_hooks`、`lint_event_attr`、`lint_fetch`、`lint_top_level`（lint 四禁）、`compile`（esbuild）、`frame_export`、`frame_render`。几帧共用的组件出错只报一次。
- 图：正文里每个源文件在的 `<Figure>` 也编一遍，规则和 code 同帧，另有 `figure_export`、`figure_render`；诊断带 `figure`（图 id）。图的写法错误已在布局错误里；运行错误要在浏览器里跑过图才有，`check` 不跑，看 `ppnt show <project>`。
- 正文渲染（`src/server/lib/mdx-check.js`）：用站点同一套 MDX 编译和 remark 步骤把正文编成函数再渲染一次。`mdx_component_missing` 是没定义的组件（`<Foo />`），`mdx_render` 是渲染时抛的错（没定义的变量 `{x}`），`mdx_compile` 是编不过；行号指 `index.mdx`。正文里有 `import` 时跳过渲染，报一条 `mdx_import` 警告。站点给 MDX 的组件只有 `Section`、`Canvas`、`Figure`、`Ref`，与 `site/src/pages/[project]/[article]/index.astro` 对齐，单测守着这一点。
- 空 ref：提示级，code `empty_ref`。

每条诊断一行 `文件:行  级别  code  说明（节 · 帧）`，最后一行是计数。有错误退 1，只有警告和提示退 0。`--json` 输出 `{ target, ok, counts, articles, frames, figures, diagnostics: [{ severity, code, file, line, message, article?, section?, frame?, figure? }] }`，`file` 是绝对路径。

站点那一头，正文渲染出错时文章页的状态码不可靠：Astro 开发服务器边渲染边发，多数时候 200 已经发出，响应停在正文开头（`<div class="article-body">` 之后什么都没有）；少数时候是 500。所以查正文错误用 `check`，不用状态码。

带 `--status`、`--frame`、`--mode`、`--group-by`，写成 `<目标>#n`，或目标写成页 id（`<project>_<article>`、存量页 id）时，`check` 列标注队列（同 `comments`），并在 stderr 打一行提示改用 `comments`。

### `ppnt comments <目标>`：标注队列

画布标注和正文评论，字段和分组见 [`docs/annotation.md`](annotation.md)。目标是一篇文章、一个存量页，或整个 project（逐篇列出有条目的文章，`--frame` 不能和 project 同用）。抬头是各状态的计数，所以单独看计数不用别的命令。选项：`--status`、`--frame`、`--mode excerpt|image|both`、`--group-by frame|component`、`--json`。

### `ppnt show <project>[/<article>]`

只读盘，只有正文里的图过期时先重编它（写 dist）。一篇文章：每节一行 §n、字母、节 id、标题、帧数（或“纯文字”）、open 数，下面是帧（编号、帧 id、源文件）和网址（文章页锚点、画布视图），最后是这篇的布局错误。一个 project：文章（斜杠地址、节数、帧数、open 数、网址）、概念、空 ref（带出处的文件和行）、布局错误，有布局错误退 1。两种的布局错误里都有图的编译错误和浏览器里记下的运行错误（`figure_compile`、`figure_runtime`）。存量页的 id 给编号、帧 id、源文件的对照。`--json` 给同一份数据。

### `ppnt shot <目标> [引用…]`

- 只写文章：文章页整页（1440 宽，按页面高度截全），存 `<数据目录>/shot/<页 id>/article.png`。
- `§2`：文章页上第 2 节的 `<section>`，存 `article-<节 id>.png`。纯文字的节写字母或节 id 也截文章页。
- `B1`、`B`、帧 id、节 id：画布视图上的帧或节，同以前。`--canvas` 截整个画布视图。存量页不写引用就是整个画布。
- `--figure <图 id>`：正文里的一个图，浅色、深色各一张（`figure-<图 id>.png`、`figure-<图 id>-dark.png`），不和引用同用；图编不过或在浏览器里运行出错时打出原因、退 1（[`docs/projects.md`](projects.md)“图”）。

截文章页前命令轮询文章网址：503（站点启动中）就等，刚登记时的 404 最多等 10 秒，502（站点起不来）直接报错并带上原因，200 才截；等的上限是 `--timeout` 秒，缺省 60。打开后等图片、画布卡片里的 iframe 和字体加载完再截。每张图打印一行 `引用 → 路径 · 宽×高`。

## 隔离运行（测试 / 不碰 owner 的服务）

owner 的常驻服务是 `https://pinpoint.localhost`，数据根和登记表是 `~/.pinpoint/`。agent 要试写一篇文章、跑一轮冒烟，又不想动这两样时，另起一个服务，所有路径和地址都用环境变量指到别处。

不要用 `pinpoint start` 或 `just dev` 起第二个服务。它们走 `npm run dev`，也就是 `portless run --name pinpoint`，注册的是和 owner 同一条 `pinpoint.localhost` 路由，会和常驻服务撞上；常驻服务健康时，`pinpoint start` 还会报错退出、什么也不起。直接起 vite（`npm run dev:app`），不经 portless。

| 变量 | 管什么 | 缺省 |
| --- | --- | --- |
| `PINPOINT_DATA_DIR` | 数据根：标注桶、dist、截图、日志（服务和 CLI 都认） | `~/.pinpoint` |
| `PINPOINT_REGISTRY` | 登记表文件（服务、站点、CLI 都认；CLI 的 `--registry` 优先） | `~/.pinpoint/registry.json` |
| `PINPOINT_ORIGIN` | CLI 找服务的地址：`add` 后的热重载、`comments --mode image`、`shot`、`mark`、`reply`；设了它，`pinpoint status` 只探这个地址，不看 portless 路由 | `https://pinpoint.localhost` |
| `PORT` | 服务（vite）监听的端口，端口被占就启动失败（`strictPort`） | 5199 |
| `PINPOINT_SITE_PORT` | 服务按需拉起的 Astro 文章站点端口。这个端口上已经有服务在答时，pinpoint 直接拿来用，所以要挑一个空端口，不要和 owner 的 4530 共用 | 4530 |
| `PINPOINT_SITE_CACHE` | Astro 的缓存目录，可选。站点的内容库按 `PINPOINT_SITE_PORT` 分在 `site/.astro-cache/<端口>/`，不用为隔离再设它 | `site/.astro-cache/<端口>` |

在 pinpoint 仓库里（要有 `node_modules`）起服务。下面的命令里，`<数据目录>` 是一个空的临时目录，端口换成空闲的：

```shell
PINPOINT_DATA_DIR=<数据目录> PINPOINT_REGISTRY=<数据目录>/registry.json PORT=5750 PINPOINT_SITE_PORT=5755 npm run dev:app
```

另开一个终端，CLI 带上同一组变量，再加 `PINPOINT_ORIGIN`：

```shell
PINPOINT_DATA_DIR=<数据目录> PINPOINT_REGISTRY=<数据目录>/registry.json PINPOINT_ORIGIN=http://127.0.0.1:5750 pinpoint add <project 根> --project
```

之后的 `ppnt list`、`ppnt check`、`ppnt shot`、`ppnt comments` 都带同样的前缀。文章在 `http://127.0.0.1:5750/<project>/<article>/`，画布在 `http://127.0.0.1:5750/?page=<project>_<article>`。

在 pinpoint 自己的 feat worktree 里，`pinpoint` / `ppnt` 换成 `node bin/pinpoint.mjs`：全局装的 `pinpoint` 指向 canonical clone，跑的是那里的 CLI 代码。

文章站点按需拉起：服务起来后第一次请求文章，站点进程才 spawn，就绪前文章页返回 503 和“站点启动中”页（浏览器里会自己刷新），通常几秒。页面里的脚本、样式这类 GET 子资源不拿 503：站点在起或在重启时，它们等站点就绪再转发，最多等 15 秒。代理复用到上游刚关掉的空闲连接（ECONNRESET）时换新连接重发，不把它当成站点没了。服务重启（包括 vite 因为 `src/server/` 下的文件改动自动重启）会连站点一起重启，又是这样几秒。脚本里读文章页要轮询到 200。`pinpoint add --project` 登记新 project 不重启站点，新文章一秒内可读（2026-10-13 隔离运行实测）。

停服务在它的终端按 Ctrl-C，站点进程组跟着停。不要按命令行 `pkill`：这个服务和 owner 的常驻服务命令行一样。e2e 的固件就是这样隔离的（`playwright.config.js` 的 webServer `env`）。在 feat worktree 里想用 owner 真实数据的一份副本亲手试，用 `just preview`，见 AGENTS.md“分支与推送”。
