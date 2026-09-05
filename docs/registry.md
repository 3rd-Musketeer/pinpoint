# registry 与注入契约

**登记过才注入。** annotate client 只落在登记过的目标上，其余一切打开的是逐字节相同、
零标注面的页面。本文是这条契约的完整形状：登记表长什么样、怎么写、client 有哪几条投递路径。
词的定义见 [`CONTEXT.md`](../CONTEXT.md)；登记与验证的操作步骤见
[`skills/pinpoint-annotate/SKILL.md`](../skills/pinpoint-annotate/SKILL.md) §2。

## 登记表

`src/server/lib/registry.js` 读 `~/.pinpoint/registry.json`（`PINPOINT_REGISTRY` 覆盖路径）。
形状 `{"version":1,"entries":[...]}`（2026-09-04 起还有可选的 `folders` / `pageFolders` /
`pageOrder` 三段，见下面「分组层」），条目
`{id, title?, kind: "dir"|"file"|"url", path? | url?, board?, page?, role?, folder?, order?}`。

- `id` 必须匹配 `^[a-z0-9][a-z0-9-]*$` 且唯一；`title` 缺省等于 id。
- `board`（`ios`/`html`）只给 dir 条目的默认壳播种（缺省与遗留值 `web` 都归一成 `html`）；
  file 条目永远在阅读器里打开，不带板。
- `page` + `role`（`"product"` 默认 | `"draft"`）是挂靠字段：带 `page` 的条目**不**自己成为一行 Pages，
  而是并进目标页的「内容」区（`role:"draft"` 时进草稿组）。url 条目永远是独立页，
  所以对它写 `page` 是非法的（会被显著跳过）。
- 条目的 `kind` 一路透传到 workbench 的 page manifest 和 board 条目上，所以 url 条目的
  document 条目在「内容」区带「网页」类型 tag。
- 文件缺失时用默认的只含 pinpoint 一条的登记表（`{id:"pinpoint", kind:"dir", path:<仓库根>}`）。
  JSON 坏了或顶层形状不对就回落到默认并记下 error；单条非法只跳过那一条；
  dir / file 路径不存在是 warning，不是删除。
- 全部状态可见：`GET /health`（registry 摘要，那里的 `entries` 是**数量**）与
  `GET /registry`（完整 `entries` 列表 + `service.directOrigin`）。
- `GET /registry` 还给 dir / file 条目附 `mtime`（内容 mtime，dir 递归取最大），
  给 Pages 的「最近更新」排序用（ADR 0029）。

## 分组层（文件夹）

2026-09-04 裁决 5a：**owner 自己建夹、把页拖进去，一层，不嵌套。** 同一份登记表多三段顶层字段：

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
- 条目的 `folder` / `order`：归属哪个夹、手动次序（`order` 只在 workbench 的排序档是「默认」时生效）。
- `pageFolders{}` / `pageOrder{}` 装的是**不在登记表里的** manifest 页（Component Library 等来自
  `content/previews/_index[.local].json`）——它们没有条目可以写字段，归属与次序只能记在顶层。
  键撞上某个 registry 条目 id 时那条映射是死数据（条目自己的字段才算数），读侧 warn 掉。
- **分组从不决定一个页存不存在。** 指着不存在的夹是 warning + 那个条目变散页（丢一行 Pages 比丢一层
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
「id 认不认识」的名单 = registry 条目 + `content/previews/_index[.local].json` 里的模板页
（服务自报的 root 下读，与 CLI 的 `--page` 共用 `src/server/lib/page-manifest.js`）。
未知 id、未知文件夹、坏 `order`、重复或带未知字段的 folders 一律
`400 {error:"bad_request", message:"<一句人话>"}`，且登记表一个字节不动；
静态快照（测试里的 `loadRegistry` 结果）答 `409 registry_not_writable`，与 reload 的 409 同款。

## 写入走 CLI；文件夹操作也可以来自 workbench

**条目**的写入（登记、重指、改 id）只有 CLI 一个入口。**文件夹**有两个：CLI 的 `pinpoint folder`
和 workbench 左栏的拖放（走上面那三条 PUT）——写的是同一份登记表、同一条原子写，谁先谁后都行。

`bin/pinpoint.mjs`（`npm link` 一次把 `pinpoint` 放上 PATH）：

```bash
pinpoint add    <dir|file.html|http(s)-url> [--title X] [--board ios|html] [--id xxx] [--page pageId] [--draft]
pinpoint move   <id> <dir|file.html|http(s)-url>
pinpoint rename <旧 id> <新 id>
pinpoint folder list | add <名称> [--id xxx] | rename <id> <新名称> | rm <id> | move <页 id> <夹 id|none>
```

`add` 原子追加到登记文件（`--registry` 覆盖路径，给脚本和测试用）。`--page` 把条目挂到一个既有页上
而不是新增一行 Pages——目标必须能解析（本地 manifest 页或另一个 registry 条目 id，写之前就查），
对 url 目标会被拒绝；`--draft` 必须搭配 `--page`，把条目放进草稿组。

**`--page` 是「挂到既有页 `<id>`」，不是「指定本条目的 id」。** 本条目自己的 id 用 `--id`。
反例：`pinpoint add ./v2 --id weekly-review-v2` 是让这个条目自己叫 weekly-review-v2；
`pinpoint add ./v2 --page weekly-review` 是把它塞进 weekly-review 那一页的「内容」区、
自己不成一行 Pages。

`move` 原地改一个既有条目的落点（dir / file / url 三种目标，校验方式与 `add` 一致：路径必须存在、
单文件必须是 .html、URL 必须 http(s)），**id 与 title 原样保留**——标注桶按 id 寻址
（`~/.pinpoint/<id>/`），所以换路径不动既有标注。kind 跟着新目标走，`board` 只在 dir 上留着
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
再把另一个条目的内容 `move` 到同一个落点（或直接从登记表里删掉那一条）。
`rename` 自己不做合并——目标 id 已被占用时它一律拒绝，不会去动别人的标注桶。

**撞 id 是错误，不是自动改名。** 裸 `pinpoint add` 派生出的 id 或显式 `--id` 撞上既有条目时，
CLI 打印「id 已存在，指向 `<path>`；更新路径用 `pinpoint move <id> <新路径>`，要新条目请显式
`--id <其他 id>`」并退非零。历史行为是静默追加 `-2`，那会开一个空桶、让既有标注孤儿化
（2026-09-01 实迁踩到）。

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
`renameRegistryEntry` / `writeRegistryFolders` / `setEntryFolder` / `assignRegistryOrder`
共用同一条原子写）：严格校验（id 唯一、kind 合法、dir/file 路径存在、
url 是 http(s)、page/role 合法、未知字段拒写）、tmp+rename、2 空格 JSON。
这个 store 同时是服务端的活视图：annotate / sites / export 三处插件共享同一个实例
（在 `vite.config.js` 里接线），`POST /registry/reload` 原地换快照——CLI 在 add 成功后、
服务 `/health` 有响应时会自己调它，所以新条目不重启就能 serve、注入、分桶；
已打开的 workbench 经 HMR 的 `registry:update` 事件学到（那个事件同时重挂当前板，
挂靠条目会立刻出现或消失）。静态快照会答 `409 registry_not_reloadable`。

`add`、`move`、`rename` 与 `folder` 的写子命令写盘后都走同一条即时生效：探活 `/health`，可达就 `POST /registry/reload` 并打印
重载结果（重载了几条 / 服务在用的是另一个 registry 文件 / 服务没在跑，下次启动生效）。

服务本身的起停在 `pinpoint status｜start｜stop｜restart`，见 [`AGENTS.md`](../AGENTS.md) 的
「起服务与验收」。

## 三条投递路径

client 只有一份：`src/client/annotate.js`，serve 成 `/annotate.js`。

### 1 · workbench 自己的页面

`ios-kit.js` 只在 loopback / `.localhost` 主机上自注入 `/annotate.js`（退出方式：`<html data-annotate="off">`）。
独立文档抄同一段尾部脚本，并在不是被嵌入时调 `pinpoint.setFloatingToolbar(true)`——
见 `content/previews/doc-library/sample-report.html`。

自 ADR 0027 起还有一层：`src/server/preview-inject.js` 给任何含 `<!doctype` 的 `content/previews/**.html`
响应自动注入 client（`?annotate=off` 豁免，片段没有 doctype 天然放行）。previews 的注入
**不带 entry 标记**，账本 ENTRY 保持缺省 `'pinpoint'`，与手工注入段时代逐字节一致。

### 2 · dir 与 file 条目 → `/sites/`

`src/server/sites-api.js` 把登记目录只读地服务在 `/sites/<entry-id>/<path…>`（只接 GET/HEAD，
其余 405）。登记表就是白名单：未知 id 404；`..` 按文本拒绝，symlink 逃逸按 realpath 包含判定；
目录回落到 `index.html`。HTML 的 GET 响应在 `</body>` 前注入
`<script>window.__pinpointEntry='<id>'</script><script src="/annotate.js"></script>`
（没有 `</body>` 就追加在末尾）；`?annotate=off` 给出磁盘上的原始字节——
workbench 的内联片段加载器与导出渲染走的就是它。

**file 条目**共用同一条注入 / annotate=off 管线，但只对那一个登记文件：
`/sites/<entry-id>/` 和 `/sites/<entry-id>/<basename>` 都服务它，其它任何拼法
（穿越、同目录的兄弟文件）一律 404。file 条目也出现在 Pages 里，永远是 doc 壳。

没有自带 `board.json` 的条目照样可读：`/sites/<id>/board.json` 服务一份合成的 doc 板
（`src/server/lib/synth-board.js`）——file 条目一屏，dir 条目按顶层 `*.html` 排序各一屏。
磁盘上的 `board.json` 永远优先。`ios` 板的 dir、以及没有任何顶层 HTML 的 dir 不合成（404）。
合成板里屏的 `src` 做 percent-encode，好让 iframe URL、`location.pathname`、
导出管线算标注 page key 的那个 hash 三者逐字节一致。

### 3 · url 条目 → 两条并存的路径，落进同一个桶

**同源代理内嵌（不需要扩展）** — `src/server/lib/site-proxy.js` 把登记的 origin 代理在
`/sites/<entry-id>/` 下。所有方法 / 头 / body 透传（dir 与 file 仍只接 GET/HEAD），
于是活的应用在 workbench 的 doc 壳 iframe 里同源渲染，侧栏经既有的 ann-bridge 直接驱动它的
annotate 实例。

响应手术：`Set-Cookie` 重基（去掉 Domain，Path 加/补前缀）、3xx 的 `Location`（以及请求的
`Referer`）在前缀与目标 origin 之间改写、CSP / CSP-Report-Only / X-Frame-Options / COOP / COEP
整体剥离——页面必须能进 iframe 并跑内联 bootstrap，安全边界由登记表白名单承担
（上游 TLS 校验关闭：localhost 开发 origin 用的是私有信任的 CA）。HTML 响应里根绝对的
`src` / `href` / `action` / `poster` / `formaction` / `srcset` / `imagesrcset` / `xlink:href`、
`<object data>`、`<meta refresh>`、`<style>` 正文和 `style="…"` 属性都改写到前缀上；
CSS 响应改写 `url(/…)` 与 `@import "/…"`。

HTML 改写够不着的地方——JS 里的 `fetch('/api/…')`、XHR、`EventSource`、`WebSocket`、`sendBeacon`——
由一段**重基 bootstrap** 兜底：作为 `<head>` 的第一个脚本注入（`proxyBootstrapSnippet`，内联
`src/shared/proxy-rebase.js`），给这五个 API 打补丁，把根绝对（以及指向自身 / 目标 origin 的绝对）URL
重基到前缀上，按名字豁免 annotate client 自己的端点（`REBASE_EXEMPT_*`：`/annotate.js`、`/save`、
`/image`、`/annotations[…]`、`/images/…`、`/events`、`/sites/…`）。

bootstrap 还会**虚拟化 URL**：在任何页面脚本跑之前 `history.replaceState` 回不带前缀的应用路径
（`virtualAppPath`）。因为 SPA 路由直接读 `location.pathname`——那是原生 getter，补丁拦不住——
不虚拟化就会掉进它们的 catch-all。副作用是好的：标注账本因此落在应用路径（`/`、`/global`、…），
与扩展在应用自己 origin 上注入出的账本逐字节同 key。前缀下的 WS upgrade 在 vite 的
httpServer `'upgrade'` 上转发到目标 origin（通用兜底；SSE 走普通 HTTP 转发）。

url 条目出现在 Pages 里（永远 doc 壳）：`/sites/<id>/board.json` 永远是合成的单屏板
（`src = sites/<id>/`），盖住上游任何同名文件。`?annotate=off` 只去掉 annotate client，
bootstrap 与 URL 改写留着——它们是代理机制的一部分，没有它们页面能渲染但所有运行时调用都打错 origin。

已知盲区：DOM 里赋值的 URL（`img.src = '/x.png'`，属性赋值没有补丁拦得住）、不带引号的属性、
协议相对（`//…`）URL、目标路由与豁免名单撞名、与 workbench 共享的 storage（localStorage /
indexedDB，同源内嵌即同一 storage 分区），以及虚拟化的两个坑——`location.reload()` 重载的是虚拟
URL（内嵌 iframe 刷新会去加载不带前缀的路径）、硬导航（`location.href = '/x'`）会跳出代理
（被 router 拦截的 SPA 链接没问题）。

**浏览器扩展（应用自己 origin 那条路）** — `extension/` 是一个 MV3 扩展，content script
（只在顶层 frame，匹配 `localhost` / `*.localhost` / `127.0.0.1`）先探 `https://pinpoint.localhost/registry`、
再探页面自己的 origin，谁先返回 JSON 用谁。当 `location.origin` 与某个 registry url 条目**精确相等**时，
它打上 `<html data-pinpoint-entry="...">`（页面的 CSP 会挡掉 content script 注入的内联 `<script>`；
`window.__pinpointEntry` 仍是同源注入方的契约，两者都在时它赢），并从 `service.directOrigin`
——也就是 API 的普通 loopback 绑定——加载 `annotate.js`。这一步绕的是 Chrome ≥130：
它拿扩展自己的 CSP 校验 content script 注入的脚本，而那份 CSP 只放行
`http://localhost:*` / `http://127.0.0.1:*`，不放行远端 https origin。
没有任何候选返回登记表 = 服务没起 = 什么都不注入。
所有 annotate API 路由对跨源请求答 `Access-Control-Allow-Origin: *`（不带凭证）并处理 `OPTIONS` 预检。

一次性安装：`chrome://extensions` → Load unpacked → 选本仓 `extension/`，细节见
[`extension/README.md`](../extension/README.md)。

## 导出的纯净性

文档导出接受 `sites/<entry-id>/…` 形式的 src，并保证不含注入的 client：管线请求 `?annotate=off`、
在渲染浏览器里 abort 掉 `**/annotate.js`、并用 `stripAnnotateBootstrap` 从导出的 HTML 里
删掉注入片段（连 `__pinpointEntry` 标记一起）。
