# 标注：路由、账本、控制面

标注是人 → agent 的反馈回路，也是这个仓存在的理由。反馈有两种：画布标注（owner 在画布视图或存量页上钉在元素上）和
正文评论（owner 在文章页上选中正文写下）。一个页 id 一个桶，两种排在同一个队列里：一套 `#n`、一个状态机。
本文说一条标注长什么样、它落到哪个文件、以及读到一条标注之后该去改哪个源文件；“标注”在字段名和本文里泛指队列里的每一条。词的定义见 [`CONTEXT.md`](../CONTEXT.md)；
标注 → 读 → 改的操作流程见 [`skills/pinpoint-annotate/SKILL.md`](../skills/pinpoint-annotate/SKILL.md)。

## 一条标注的字段

| 字段 | 含义 |
|---|---|
| `entry` | 页 id —— 这一条住在哪个桶（一个页 id 一个桶，ADR 0036；兜底 `pinpoint`）。文章是 `<project>_<article>` |
| `pageId` | 画布所属的页 id，DOM 上是 `data-vpage` |
| `section` | 节 id：画布视图的一行，或存量页 board 的 section（遗留名：`group`） |
| `screenId` | 帧 id（帧源文件名） |
| `content` | 标注正文（遗留名：`comment`） |
| `n` | 对外序号：按桶（= 页）单调取号（桶目录下 `_seq.json` 的 `next`），页内跨账本唯一、永不复用；旧标注首次读到时按创建顺序补号写回。列表、跳转、`/status` 端点都用它 |
| `status` | `open` / `check` / `done` / `close`，缺省 `open`；转换规则见下文“标注状态机” |
| `lastRect` | 锚点最后一次解析成功的矩形 `{ x, y, w, h, screenId? }`；锚点失效且仍有它时画幽灵框。客户端记录、随下一次保存合并落盘 |
| `path` | 壳页面，通常是 `index.html` |
| `messages` | 线程：`[{ who: "owner" \| "agent", text, at }]`，见下面“线程” |

元素标注一律写 `targets: [{ ref, selector, text, ppId? }]`；稳定 ref 是 `i1`、`i2`、…，删除后永不重编号。
顶层的 `selector` / `text` 是第一个 target 的兼容镜像。`ppId`（决定 #15）是编译页锚点的
源码稳定 id（`data-pp-id` 的值，命中元素或最近带标祖先）：解析时先按 `[data-pp-id="…"]`
找、多命中取文本最接近的，找不到再回落 cssPath + 文本；只要那行源码还在，帧结构怎么改
锚都不漂。存量 HTML 页与工作台 chrome 没有 `data-pp-id`，target 不带 `ppId`，行为不变；
存量编译页标注不带 `ppId` 的，owner 下次在工作台编辑保存该条时自动补上（不跑迁移脚本，
账本不因此整体重写，补 `ppId` 不算目标变更、不会把 check / done 顶回 open）。
`[@t:iN]` 只在那一条标注内解析，
永远不进 `mentions[]`；`[@a:id]` 保持它的跨标注含义。

## 线程

每条标注都有线程，不分种类：画布标注、存量页的文档标注（`board: "html"` 的 HTML 文档，锚点是 cssPath + 引文）、正文评论都一样。`content` 是 owner 的第一句，之后的来回追加在 `messages`。

- 写入：`POST /annotations/<账本>/<id|n>/reply`，body 带 `entry`、`baseRevision`、`text`，在线程末尾追加一条 `who: "agent"` 的消息，状态不动（`src/server/lib/annotation-store.js` 的 `appendMessage`）。CLI 是 `ppnt reply`，和写状态合成一步是 `ppnt mark … --note`。
- 保存不丢回复：owner 在标注框里改正文时，客户端整本保存的快照可能早于 agent 的回复。`save` 把盘上已有、快照里没有的 agent 消息合并回去（`keepAgentMessages`），所以 owner 改完这一条，状态按状态机回 `open`，agent 的回复还在。
- 显示：工作台的标注列表（`src/workbench/app/AnnPopover.jsx`）和注入侧栏在每一行下面列出回复（“agent：…”），标注框在输入框下面列出整个线程（`#ann-thread`），画布上的气泡也带回复；文章页的右栏是正文评论的线程。SSE 推来改动后不刷新就出现。
- 读：`ppnt comments` 在每条下面列出回复，`--json` 里是 `messages`。

## 读到标注去改哪里

锚点定位看编译产物里的两个属性：`data-pp-id`（形如 `Nav.jsx:18@2`，源文件:行 + 同行第几个
实例）与 `data-pp-comp`（组件名）。带 `ppId` 的标注，`ppnt comments` / `locate` 直接按它取锚点
（多命中按文本择近）；没有 `ppId` 的标注（存量页的 `.html` 帧）走 cssPath 链。

- 锚点带 `data-pp-comp` → 改组件文件（文章：本篇或 project 的 `components/<Name>.jsx`；存量页：`<存量页目录>/components/<Name>.jsx`），所有引用它的帧一起变。
- 锚点只带 `data-pp-id` → 改该帧的源文件 `<帧 id>.jsx`（在文章目录或存量页目录里）。
- 正文评论 → 改 `index.mdx` 里被评的那段，或这一节画布组件里的帧。
- `/sites/<entry-id>/` 下做的标注 → 改登记目录里磁盘上的那个文件（服务本身是只读的）。

标注层（`#ann-overlay`）是 stage 作用域的；画布与侧栏只显示当前页 id 的标注。`goToMark` 需要时先切页，
再经 `src/workbench/lib/board-navigation.js` 聚焦到所属 frame；只有没有 `screenId` 的遗留标注
才回落到把裸锚点居中。

画布只画**活的锚点**（`close` 不画）。HTML 改过之后选择器解析不到的，标注仍留在侧栏，
标成**锚点失效**；存有 `lastRect` 的在画布上留一个幽灵框（虚线框 + 序号，点列表行仍跳到
最后位置）。失效是渲染时算出来的，不是存下来的。

## 账本与桶

**一个页 id 一个桶**（ADR 0036）：`~/.pinpoint/<页 id>/*.json`（**磁盘就是事实源**），形状是
`annotations[]`。页 id：文章是 `<project>_<article>`；存量页是 registry 条目 id（挂靠条目
`entry.page` 用宿主存量页的 id），`content/previews/_index.json` 的模板页用自己的 id。`pinpoint` 桶只是“不属于任何页”的兜底（SPA fallback 页等），不是页。
registry 来自 `~/.pinpoint/registry.json`（`PINPOINT_REGISTRY` 覆盖）。数据根的确切路径从
`GET /health` 的 `dataRoot` 字段读；`PINPOINT_DATA_DIR` 整体覆盖数据根（e2e 用的就是它）。

账本 = 桶内的一个表面：
- **画布**是一本固定名 `@canvas.json`，不跟工作台 pathname 走（`/` 与 `/index.html`
  同一本）；mention 帧也写这本（桶 = 被引用帧所属的页），与画布双向实时同步。
- **文档、直开页、url 条目**仍是一个 pathname 一本，命名规则见
  `src/shared/annotate-page-key.js`。
- 文章的桶里还有正文评论的固定账本 `@prose.json`，见下文“正文评论”。
- 工作台切活动页 = 换桶重新 hydrate；`#n` 按桶编号，一个页 id 一套序列。

`POST /save` 要带 `baseRevision`（整数 ≥ 0；不匹配返回 `409 revision_conflict` 并附磁盘上的文档）；
清空走同一条保存队列、传 `annotations: []`（没有 `/clear` 路由）。显式传一个未登记的 `entry` 是
响亮的 `400 unknown_entry`——配错永远不会静默落进错误的桶。

保存撞上 `409 revision_conflict` 时，两个客户端都把本窗口的改动接到盘上的最新版再存，agent 在这之间经状态端点和回复端点写的
check / done 与回复都留在盘上，owner 的改动也落盘。正文评论客户端重放没落盘的操作（见下文“正文评论”）。画布客户端
（`annotate.js`）按行做三方合并（`src/shared/ledger-rebase.js`），三方是本窗口现在的行、本窗口最后确认的盘上版本（水合、
保存应答、远端同步时记下）和 409 带回的盘上版本：

- owner 在本窗口改过的字段用本窗口的，没改过的用盘上的；`lastRect` 只跟本窗口的几何走。
- `status` 在本窗口改过（关闭、重新打开）用本窗口的，否则用盘上的。owner 改了正文或目标的那一条，服务端照状态机回 `open`。
- `messages` 用盘上的全部；`n` 用盘上的。
- owner 在本窗口删掉的行保持删除，别处新加的行留下，本窗口新建、盘上没有的行接在最后。

保存在途时经 SSE 先到的更新版本、换账本时交给 outbox 的快照，都按同一条规则合并后再存。

离开页面不丢写（画布 `annotate.js` 与正文 `prose-comments.js` 同一套，`src/client/lib/save-request.js`）：
每次 `/save` 在请求体不超过 30000 字节时带 `keepalive`，关页或导航走之后在途的保存照样送达；更大的请求体走普通 fetch，
离开时可能丢。`pagehide` 与 `visibilitychange` 转 hidden 时，没落盘的写立刻发出：没有在途保存就照常同步；
有在途保存、之后又改过，就把整份快照以 `revision` 为底发一次，带 `after` = 在途那次的 `saveId`（每次 `/save` 都带一个
`saveId`）。服务端记着每本账本最后一次保存写出的 revision 和 `saveId`（只在内存里）：盘上正好是 `after` 那次写出的下一版时，
快照照样落盘；快照先到就按 `baseRevision` 落盘，在途那次随后 409。两份请求走各自的连接，谁先到盘上都是最后一版。
服务重启丢了这份记录时，快照按普通 `baseRevision` 判，最坏回到 409。
换账本时排进 outbox、尚未发出的快照也在这时发。还在防抖里的 lastRect（锚点几何缓存，不是 owner 的改动）不发。

浏览器的 `localStorage` 缓存不是权威。启动时 client 从磁盘水合；`GET /events`（SSE，
`event: annotations`，payload 带 `entry` / `page` / `revision`）让已打开的浏览器近实时同步。
`GET /annotations`（不带 page）是调试用的聚合，把每个页桶摊平成 `[{entry, ...doc}]`；
按页读要带 `?entry=<页 id>`，`GET /images/<name>` 也是。

**孤儿**：一本账本对应的表面已不存在（文档文件删了、条目移走了、存量页不在 registry 与
manifest 里了、文章目录删了或 project 的登记删了 = 整桶皆孤儿）。`ppnt comments`
把孤儿单独列出、不计入 open 等计数；`GET /registry` 的页信息给每页孤儿数（页信息
面板显示）；清理只经 `ppnt prune <页> [--dry-run]`，直接删除、不备份。孤儿行照样能回复、写状态：
`ppnt mark` / `reply` 的 `#n`、`#a-#b`、`@a:<id>`、`<页>#n` 也指得到它们（状态和线程端点按账本加序号找行，
不看画布）；`--status` 批量展开和帧、节展开只走活的行。

页面 key 的公式在 `src/shared/annotate-page-key.js`：
`decodeURIComponent(filename) + '~' + hash31(pathname).toString(36)`，所以同名文件在不同目录
各有各的账本。SPA 换路由时账本（entry / page / localStorage key）不重载就重新定位——
优先 Navigation API 的 `navigate` 事件，回落到打过补丁的 `pushState`/`replaceState` + `popstate`；
只改 hash 不重新定位，切换前发出的同步 / 水合响应按 epoch 丢弃，所以标注不会落到上一条路由上。

桶归属由 client 这样决定：注入方（`/sites/`、`/previews/`、url 代理、`/api/frame`）
注入的 `window.__pinpointEntry` = 页 id；工作台画布实例没有标记，桶 = 活动页 id
（切页 = 换桶）；文章页注入的是这篇的页 id；都没有的兜底是 `'pinpoint'`。API 调用打的是脚本被加载的那个 origin。

## 正文评论

文章页（`/<project>/<article>/`）上，owner 选中正文文字点“评论”，评论进右栏线程。它和这篇画布视图上的画布标注是同一个队列：

- 桶 = 这篇的页 id `<project>_<article>`（`src/shared/project-ids.js` 的 `articlePageId`），账本固定名 `@prose.json`，与画布的 `@canvas.json` 同桶，`#n` 是同一套序列，状态机相同。
- 一行的形状：`{ id, n, type: "prose", status, content, quote: { exact, prefix, suffix, start? }, section, path, created_at, messages: [{ who: "owner" | "agent", text, at }] }`。`content` 是 owner 的第一句，之后的来回在 `messages`。
- 锚点是 W3C TextQuote 式（`src/shared/text-quote.js`）：选中文字 + 前后各 32 字，`section` 和 `start`（选中时在规范化文本里的位置）只是提示。正文先抽成规范化文本：两个 CJK 字之间的空白（软换行、块边界）算没有，其余空白连成一个空格。源文件改了折行，中文引文照样定位。存下的引文定位前按同一条规则规范化，旧数据里“换行存成空格”的引文也能定位。每次加载都重新定位：逐字找 `exact`，多处时按前后文吻合度挑，同分看节，再同分取离 `start` 最近的一处。`exact` 一处都找不到就在右栏标“失效”，显示存下的引文，不画高亮。不做模糊匹配。画布卡片（`[data-pp-canvas]`）、脚本、错误条不进文本，选区落在那里不出“评论”。
- 注入：`article-proxy` 只给文章页注入，带 `window.__pinpointProse`；客户端见到它只跑正文评论（`src/client/prose-comments.js`），不起画布标注的工具条、侧栏和元素标注。project 首页、概念页不注入。
- 右栏：pending / closed 两段筛选（与画布列表同一口径），每条线程是序号钉（状态色）+ 状态字 + 引文 + 消息（“你” / agent，时间）+ 回复框，行尾“完成”（→ close）或“重新打开”（→ open）。点高亮聚焦线程，点线程定位高亮。
- 写入：客户端把改动记成操作（新建、回复、改状态），存盘撞上 409 时重放到磁盘最新版再存，agent 刚写的回复不会被旧快照盖掉。其他拒绝时，新评论退回草稿，回复退回输入框，右栏写出原因。owner 回复或改了引文算 owner 编辑，服务端把状态回 open。
- 同步：SSE 断了自己重连，连上后重新水合，补上断线期间的改动。页面进 bfcache 时关掉 SSE；从画布按“返回”回来（`pageshow` 且 `persisted`）时重开并重新水合。离开页面时排着的操作立刻发出（见上面“离开页面不丢写”）；重放时 owner 的同一条回复（原文与 `at` 相同）不追加第二遍。
- agent：`ppnt comments <project>/<article>` 把正文评论单独成组（引文、节、`index.mdx` 里的落脚行、线程）；`ppnt reply <project>/<article>#<n> "<回复>"` 走 `POST /annotations/@prose/<id|n>/reply`（见上面“线程”），在线程末尾追加 agent 消息，状态不动，经 SSE 实时出现在右栏；回复并改状态用 `ppnt mark … --note`。

## 控制面

在非 workbench 页面（`/sites/`）上浮动工具条默认隐藏——**A** 键切标注模式。

工具条带一个**“打开 workbench”**入口：`/sites/` 页面在工作台之外，工具条的钮（`#ann-workbench`）在新标签页开
`<服务 origin>/index.html`，origin 取自注入脚本自己的 `src`；在 workbench 壳页与被嵌入的
frame 里隐藏——那里已经在 workbench 里，同“只留一个控制面”的规矩。

页面内的 `#ann-sidebar`（**S** 键、工具条的“列表”钮）：
head 上是“交互 | 标注”分段开关，列出当前账本的标注按 `n` 排序，点击跳转，行尾动作与
工作台列表同款（open / check / done 行 hover 出完成勾，close 行 hover 出“重新打开”），
失效锚点带标记；打开状态作为 localStorage 的浏览偏好保存，默认关闭；
凡是存在 `window.workbench` 或文档跑在 frame 里的地方一律抑制——和工具条同一条“只留一个控制面”的规矩。

## workbench 偏好

活动页、每页的活动条目、缩放、侧栏、主题都留在浏览器 `localStorage`（`pinpoint-wb`）——
这是浏览者状态，不同步。每页的条目选择在 `pageViewports` 的兄弟键 `activeEntryIdByPage` 里；
视口存档仍按 `pageId` 存，且只作用于画布条目（doc 条目 1:1 渲染）。

- **侧栏**：左栏经 head 开关 / 舞台左缘 rail（`#wbside-expand`）/ splitter 折叠
  （折叠时单击展开，双击折叠）；右侧标注栏经它自己的 head 开关 / 舞台右缘 rail
  （`#wbann-expand`，带计数钉）折叠，经自己的 splitter（`#wbannsplit`，260–440，默认 308，
  双击复位）调宽；低于 280 翻成紧凑行——藏 cap、文本单行、底栏 dropdown 只留图标。
  偏好键：`sideCollapsed`、`sideWidth`、`annPanelCollapsed`、`annPanelWidth`。
- **视口存档**：每页的 `pageViewports[pageId]` 存滚动位置与缩放（缩放单一来源，没有顶层 `canvasZoom`）。
- **文档的视口（窗口｜手机）**：`viewportByPage[pageId]`，只记 `phone`、回窗口删 key（`lib/viewport.js`）；
  两种视口都是文档形态，上面那条存档对它们都不生效（手机屏的缩放系数按窗口尺寸现算，不存）。
- **舞台平移**：Space+拖或中键拖，任意位置都行；左键拖只在板的空白 chrome 上生效
  （不在 `.ios-stage` / `.wb-comp-stage` 里），这样 frame 的点击和滚动才正常。
  显式平移在标注模式和有草稿时也生效，输入框里的空格仍用于输入；失焦会结束拖动。
- **画布工具条**：常驻右下角；Section Navigator 与分层的 Canvas → Section → Frame 小地图是两个
  独立的持久开关。打开的面板停靠右侧，按工具条顺序竖着堆。Ctrl/meta + 滚轮缩放。
  两种导航模式都必须经 `src/workbench/lib/board-navigation.js` 解析几何与聚焦策略；
  永远不要用 `.wb-screen` 包装元素导航——row 布局会让它 `display: contents`。
- **HMR**：模板页 `content/previews/<page>/**` 与 registry 条目目录里的源码、board 改动会重编该页并重摆板，
  `.js`（sidecar）改动整页刷新；kit 印章 `content/kits/ios/jsx/**` 改动全量重编所有页。

## 画布标注的几何缓存

画布标注保留 DOM，缓存未缩放的目标矩形、裁剪和箭头端点。测量时集中读取，再写入标注节点；
普通平移更新公共 `translate3d`，纯缩放按当前视口投影缓存。两者都不重新解析或测量内容锚点，
也不重建标注节点或评论列表。frame 级可见性裁剪减少离屏投影，编号、边框和评论保持屏幕尺寸。
手机内部裁剪继续生效；草稿位于独立层，避免叠加两次滚动位移。

视口与内容通知合并到一个 rAF 调度入口。frame 内滚动或局部内容变化只重测依赖该 frame 的标注，
依赖包含全部目标、区域基准和箭头端点。外层布局变化单独刷新 frame 边界；内部未变的相邻 frame
沿用目标几何并修正整体偏移。隐藏、删除和重新出现会更新锚点有效性，不会删除账本记录。
全局样式、无法限定范围的选择器变化、页面替换和显式 `pinpoint.render()` 保留全量刷新。

锚点解析按页面与 frame 缓存，同一刷新共享有效性结果。纯几何更新不通知评论列表；正文保存与
远端账本更新复用几何未变的节点和行模型，只测量新增或目标已改变的标注。保存请求包含完整
账本和 revision，缓存不写入持久化数据。文档形态按自己的视口定位，原型 HTML 保持挂载。

`e2e/canvas-pan.spec.js` 覆盖平移手势、连续缩放、草稿、内部滚动、区域、跨 frame 多目标、
箭头、锚点失效恢复、全局样式和单条保存，以及 1000 条模拟标注。回归门槛约束目标读取、
节点复用、对齐和保存请求；墙钟帧间隔单独采样，不用机器负载敏感的毫秒数作为 CI 门槛。

## 装载失败与 sidecar 资源

板装载失败（`board.json` 404 / 契约错误）与单屏装载失败走同一个面板（`.wb-screen-err`）：
三行说明（标题 / 出处 / 原因）+ 固定两个动作“回到 Pages”“重试”。动作只写 data 契约
（`data-err-home` / `data-err-retry` + `data-err-page` / `data-err-screen`），点击由挂在 stage 上的
委托监听执行——板每次装载整替换 `innerHTML`，监听不能挂面板自己身上。“回到 Pages”落到
默认页（第一个可装载的页）并展开左栏；“重试”失效对应的 `board` / `screen` 查询后原地重装。
左栏“页面清单读取失败”同样带一个“重试”（`pages.js` 的 `retryPageManifest`）。

fragment 里的 **CSS 资源 url 与 JS sidecar 同规则**（2026-09-04）：`<style>` 块里的 `@import` 与
`<link rel=stylesheet>` 的相对 url，在装配时被 `src/workbench/lib/sidecar-css.js` 改写成
`pageBaseUrl` 前缀的绝对路径，和 `resolveSidecarUrl` 处理 `./x.js` 是同一条规则；已经是
`/sites/…` 或 http(s) 的原样保留。不改写就只有 CSS 走样——`@import` 按 workbench 文档
（`index.html`）解析，`./x.css` 会打到站点根。组件页不改写（它的片段来自 `kits/`）。

资源没进来时在那个 frame 上出一条 `.wb-asset-err`，把打不开的 url 写出来，不留静默空卡：
CSS 侧没有 `onerror` 可听，所以装载后对 `/` 开头的同源 url 探一次存在性；JS 侧报的是作者
显式写了 `src` 的 sidecar，约定式的 `<screenId>.js`（`data-preview-mount` 隐式探的那条）
允许缺席、不报。

## 导出

用户面只有一种导出：横条“导出”钮把整个画布导出为离线可交互 HTML（`src/workbench/app/ExportPicker.jsx`，
原生 dialog；ADR 0033）。文章本身用文章页的链接分享。服务端帧图片渲染器（`/api/export-image`）给 agent 用：
`ppnt shot` 的画布截图与 `ppnt comments --mode image` 走它。文章页截图（`ppnt shot <project>/<article>`、`§2`）不经它：CLI 用 Playwright 打开文章页，等站点就绪、图片和画布卡片加载完再截。不要把截图逻辑加进单个帧里。

可交互 HTML 导出（`POST /api/export-page-html`）只内联 `data-preview-script` 脚本，脚本里不能有 `import` / `fetch` / `XMLHttpRequest` / `WebSocket`，否则整页导出拒绝；要用图标库就把用到的节点内联进脚本（Pinpoint `plugins` 页的 `pk.js` 是样例（源目录由 registry 解析））。

可交互 HTML（`<page>__interactive.html`）打开后就是 workbench 的画布（ADR 0033）：满铺的网格画布 +
左侧浮动玻璃面板（页名 + 大纲，横条最左的钮收起 / 展开）+ 底部横条（‹ n / N › 帧导航、缩放读数、回中）。
滚轮滚动，ctrl / ⌘ + 滚轮围绕光标缩放，空格 + 拖或中键拖平移，空白画布上直接拖也能平移。窄屏（≤ 760px）
面板默认收起、帧竖排按屏宽适配、单指滚动。没有标注面：它是分享面，不是工作面。运行时在
`src/client/share-runtime.js`，内联进导出文件，不依赖服务。

## 标注状态机

每条标注带 `status`：`open`（缺省）→ `check` / `done`（升档）→ `close`。owner 完成单击可从
`open` / `check` / `done` 任一态直接入 `close`。`close` 不删，账本里留着。
缺 `status` 或值不认识的标注读作 `open`。

转换规则（服务端校验，非法转换 `409 illegal_transition`）：

- 新标注恒为 `open`（客户端声明什么都不算）；
- owner 编辑正文或目标 → 保存时状态回 `open`（服务端强制，与客户端一致）；
- `open` / `check` → `check` / `done` 只经
  `POST /annotations/<page>/<id>/status`——`id` 是稳定 ID 或纯数字的对外序号 `n`，body 带
  `entry`、`baseRevision`、`status: check|done`。
  revision 不匹配 `409 revision_conflict`，其余 status `400 invalid_status`，找不到标注
  `404 annotation_not_found`。这是 `ppnt mark` 的后端；
- `open` / `check` / `done` → `close`：owner 在列表行（工作台弹层或注入侧栏）或标注框里点“完成”——
  单击，toast 带“撤销”5 秒，不二次确认；撤销回关闭前的原态（`close → open` / `check` / `done`），
  再编辑也回 `open`。

UI 随状态走：颜色即状态 —— 画布钉子与列表行首序号圆共用一组状态色变量
（`--ann-st-*`，SSOT = `src/shared/ann-status.js`）：open 蓝灰、check 琥珀、done 绿、
close 灰，白字共用，不做角标；列表行另出 check / done / close 文字灰标。
旧账本里可能还有 `note` 字段（2026-09 以前 agent 写的备注），原样留在盘上，界面与 CLI 都不读（ADR 0038）。列表顶部有两段状态筛选（2026-09-24 owner 定）：pending = open / check / done，
都在等 owner 验收；closed = owner 确认做完的。两段各带计数，0 计数弱化但可点，落空显示
“没有 <段名> 的标注”。默认 pending；选择按页记 localStorage，刷新保留，认不出的旧值读成 pending。画布钉子跟随筛选：pending 不画 close 钉，closed 只画灰钉。行点“完成”后
离开 pending 视图，撤销后回来。工作台右下角计数、弹层标题计数、注入侧栏标题计数都只数
pending。
锚点失效不是免死牌：幽灵框照样会被 `clearInvalid()` 清掉。

composer 默认将目标作为正文内 pill，磁盘仍存 `[@t:iN]`，目标仍在本条 `targets`。`changeTo` 只表示修改文案的意图，可包含多个目标，不应把整段用户指令直接用作替换文本。移动保留实际目的地和箭头。正文自动增高最多十行，附图通过粘贴加入；底栏 + 菜单提供改文案/移动。

标注框没有保存和取消（2026-09-24 owner 定）。正文输入停 600 ms 自动存一次；Esc、右上角 X、Enter 结束这一条，都先存再关，⇧Enter 换行。框开着时点别的钉子、点列表行、切页、退出标注模式，也都先存再走。只在内容和上次存的不一样时写账本：打开再关掉不改状态，一改就按状态机回 `open`。新建的写了内容才落账本、拿到 `#n`，空着关掉就丢；已有的清空正文不存，保留原文，删除走框里的垃圾桶。框开着时 hover 别的元素照常出高亮框，点下去给这条加目标（多目标），不开新标注。

`clearInvalid()` 仅作用当前页，要求所有目标都无法解析且所属 frame 已加载。隐藏目标仍存在，保留；缺失/加载中的 frame 保留。该保守判定不是任意外部 SPA 加载状态的识别器。

页面置顶和归档属于 viewer 偏好，存于 `pinpoint-wb.pagePreferences`，不同浏览器不同步。归档不改 registry、源文件或标注，恢复保留原置顶及文件夹归属。

composer 会避让可见的 Pinpoint 面板，而非透明的全屏停靠容器。原生 modal 的 inert 约束通过把 overlay 挂入当前 modal 处理，不能仅靠 z-index；modal 关闭后恢复挂载。图片粘贴、正文中间插入目标和原生弹窗输入均有用户故事 E2E。
