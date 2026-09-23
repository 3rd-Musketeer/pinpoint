# 标注：路由、账本、控制面

标注是人 → agent 的反馈回路，也是这个仓存在的理由。本文说一条标注长什么样、它落到哪个文件、
以及读到一条标注之后该去改哪个源文件。词的定义见 [`CONTEXT.md`](../CONTEXT.md)；
标注 → 读 → 改的操作流程见 [`skills/pinpoint-annotate/SKILL.md`](../skills/pinpoint-annotate/SKILL.md)。

## 一条标注的字段

| 字段 | 含义 |
|---|---|
| `entry` | 页 id —— 这份文档住在哪个页桶（桶 = 页，ADR 0036；兜底 `pinpoint`） |
| `pageId` | workbench 的页 = `data-vpage`（`library`、`components`，或自定义） |
| `section` | board 的 section `id`（遗留名：`group`） |
| `screenId` | frame / 屏文件的 id |
| `content` | 标注正文（遗留名：`comment`） |
| `n` | 对外序号：按桶（= 页）单调取号（桶目录下 `_seq.json` 的 `next`），页内跨账本唯一、永不复用；旧标注首次读到时按创建顺序补号写回。列表、跳转、`/status` 端点都用它 |
| `status` | `open` / `check` / `done` / `close`，缺省 `open`；转换规则见下文“标注状态机” |
| `note` | agent 在 check / done 时留的一句话，可选 |
| `lastRect` | 锚点最后一次解析成功的矩形 `{ x, y, w, h, screenId? }`；锚点失效且仍有它时画幽灵框。客户端记录、随下一次保存合并落盘 |
| `path` | 壳页面，通常是 `index.html` |

元素标注一律写 `targets: [{ ref, selector, text }]`；稳定 ref 是 `i1`、`i2`、…，删除后永不重编号。
顶层的 `selector` / `text` 是第一个 target 的兼容镜像。`[@t:iN]` 只在那一条标注内解析，
永远不进 `mentions[]`；`[@a:id]` 保持它的跨标注含义。

## 读到标注去改哪里

锚点定位看编译产物里的两个属性：`data-pp-id`（形如 `Nav.jsx:18@2`，源文件:行 + 同行第几个
实例）与 `data-pp-comp`（组件名）。

- 锚点带 `data-pp-comp` → 改 `<页>/components/<Name>.jsx`，所有引用它的帧一起变。
- 锚点只带 `data-pp-id` → 改该帧的源文件 `<页>/<screenId>.jsx`。
- `/sites/<entry-id>/` 下做的标注 → 改登记目录里磁盘上的那个文件（服务本身是只读的）。

overlay 是 stage 作用域的；画布与侧栏只显示当前页的标注。`goToMark` 需要时先切页，
再经 `src/workbench/lib/board-navigation.js` 聚焦到所属 frame；只有没有 `screenId` 的遗留标注
才回落到把裸锚点居中。

画布只画**活的锚点**（`close` 不画）。HTML 改过之后选择器解析不到的，标注仍留在侧栏，
标成**锚点失效**；存有 `lastRect` 的在画布上留一个幽灵框（虚线框 + 序号，点列表行仍跳到
最后位置）。失效是渲染时算出来的，不是存下来的。

## 账本与桶

**桶 = 页**（2026-09-23 起，ADR 0036）：一个页一个桶 `~/.pinpoint/<pageId>/*.json`
（**磁盘就是事实源**），形状是 `annotations[]`。pageId = 这条内容在 Pages 列表里属于
哪一行：registry 条目 id（挂靠条目 `entry.page` 用宿主页 id）、`content/previews/_index.json`
的模板页用自己的 id。`pinpoint` 桶只是「不属于任何页」的兜底（SPA fallback 页等），不是页。
registry 来自 `~/.pinpoint/registry.json`（`PINPOINT_REGISTRY` 覆盖）。数据根的确切路径从
`GET /health` 的 `dataRoot` 字段读；`PINPOINT_DATA_DIR` 整体覆盖数据根（e2e 用的就是它）。

账本 = 桶内的一个表面：
- **画布**是一本固定名 `@canvas.json`，不跟工作台 pathname 走（`/` 与 `/index.html`
  同一本）；mention 帧也写这本（桶 = 被引用帧所属的页），与画布双向实时同步。
- **文档、直开页、url 条目**仍是一个 pathname 一本，命名规则见
  `src/shared/annotate-page-key.js`。
- 工作台切活动页 = 换桶重新 hydrate；`#n` 按页（桶）编号，一页一套序列。

`POST /save` 要带 `baseRevision`（整数 ≥ 0；不匹配返回 `409 revision_conflict` 并附磁盘上的文档）；
清空走同一条保存队列、传 `annotations: []`（没有 `/clear` 路由）。显式传一个未登记的 `entry` 是
响亮的 `400 unknown_entry`——配错永远不会静默落进错误的桶。

浏览器的 `localStorage` 缓存不是权威。启动时 client 从磁盘水合；`GET /events`（SSE，
`event: annotations`，payload 带 `entry` / `page` / `revision`）让已打开的浏览器近实时同步。
`GET /annotations`（不带 page）是调试用的聚合，把每个页桶摊平成 `[{entry, ...doc}]`；
按页读要带 `?entry=<页 id>`，`GET /images/<name>` 也是。

**孤儿**（storage-unify）：一本账本对应的表面已不存在（文档文件删了、条目移走了、
页不在 registry 与 manifest 里了 = 整桶皆孤儿）。`ppnt status --page` 与 `check`
把孤儿单独列出、不计入 open 等计数；`GET /registry` 的页信息给每页孤儿数（页信息
面板显示）；清理只经 `ppnt prune <页> [--dry-run]`，直接删除、不备份。

页面 key 的公式在 `src/shared/annotate-page-key.js`：
`decodeURIComponent(filename) + '~' + hash31(pathname).toString(36)`，所以同名文件在不同目录
各有各的账本。SPA 换路由时账本（entry / page / localStorage key）不重载就重新定位——
优先 Navigation API 的 `navigate` 事件，回落到打过补丁的 `pushState`/`replaceState` + `popstate`；
只改 hash 不重新定位，切换前发出的同步 / 水合响应按 epoch 丢弃，所以标注不会落到上一条路由上。

桶归属由 client 这样决定：注入方（`/sites/`、`/previews/`、url 代理、`/api/frame`）
注入的 `window.__pinpointEntry` = 页 id；工作台画布实例没有标记，桶 = 活动页 id
（切页 = 换桶）；都没有的兜底是 `'pinpoint'`。API 调用打的是脚本被加载的那个 origin。
存量账本（previews 直开页与 mention 帧旧落 pinpoint 桶、画布账本按工作台 pathname
分本）由 `scripts/migrate-ledgers.mjs` 一次性迁到页桶 —— 迁移是这次模型切换的一部分。

## 控制面

在非 workbench 页面（`/sites/`）上浮动工具条默认隐藏——**A** 键切标注模式。

工具条带一个**“打开 workbench”**入口（2026-09-04）：`/sites/` 页面在 workbench 之外，
之前只能靠记住 URL 走回去。工具条的钮（`#ann-workbench`）在新标签页开
`<服务 origin>/index.html`，origin 取自注入脚本自己的 `src`；在 workbench 壳页与被嵌入的
frame 里隐藏——那里已经在 workbench 里，同“只留一个控制面”的规矩。

页面内的 `#ann-sidebar`（**S** 键、工具条的“列表”钮）：
head 上是“交互 | 标注”分段开关，列出当前账本的标注按 `n` 排序，点击跳转，hover 出编辑 / 删除，
失效锚点带标记；打开状态作为 localStorage 的浏览偏好保存，默认关闭；
凡是存在 `window.workbench` 或文档跑在 frame 里的地方一律抑制——和工具条同一条“只留一个控制面”的规矩。

（浏览器扩展与它的 Chrome Side Panel 控制面已于 pp2 切片 3 退役。）

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
- **HMR**：`content/previews/<page>/**`（html / js / board）或 `content/kits/ios/components/**` 的改动会刷新板。

## 画布标注的几何缓存

以下行为随 `feat/canvas-performance` 提供，尚未发布。

画布标注保留 DOM，缓存未缩放的目标矩形、裁剪和箭头端点。测量时集中读取，再写入标注节点；
普通平移更新公共 `translate3d`，纯缩放按当前视口投影缓存。两者都不重新解析或测量内容锚点，
也不重建标注节点或评论列表。frame 级可见性裁剪减少离屏投影，编号、边框和评论保持屏幕尺寸。
手机内部裁剪继续生效；草稿位于独立层，避免叠加两次滚动位移。

视口与内容通知合并到一个 rAF 调度入口。frame 内滚动或局部内容变化只重测依赖该 frame 的标注，
依赖包含全部目标、区域基准和箭头端点。外层布局变化单独刷新 frame 边界；内部未变的相邻 frame
沿用目标几何并修正整体偏移。隐藏、删除和重新出现会更新锚点有效性，不会删除账本记录。
全局样式、无法限定范围的选择器变化、页面替换和显式 `pinpoint.render()` 保留全量刷新。

锚点解析按页面与 frame 缓存，同一刷新共享有效性结果。纯几何更新不通知评论列表；正文保存与
远端账本更新复用几何未变的节点和行模型，只测量新增或目标已改变的标注。保存请求仍包含完整
账本及原有 revision，缓存不写入持久化数据。文档页面沿用原来的视口定位；未卸载原型 HTML。

`e2e/canvas-pan.spec.js` 覆盖平移手势、连续缩放、草稿、内部滚动、区域、跨 frame 多目标、
箭头、锚点失效恢复、全局样式和单条保存，以及 200 / 1000 条模拟标注。回归门槛约束目标读取、
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

用户面只剩一种导出：横条“导出”钮把整个画布导出为离线可交互 HTML（`src/workbench/app/ExportPicker.jsx`，
原生 dialog；ADR 0033）。图片 picker、zip 打包（`/api/export-zip`）、文档导出三模式都在 pp2 切片 3 退役。
服务端帧图片渲染器（`/api/export-image`、`scripts/export-preview.mjs`）保留给 agent：`ppnt shot`
与 `ppnt check --mode image` 走它，不再是用户面入口。不要把截图逻辑加进单个屏的片段里。

可交互 HTML 导出（`POST /api/export-page-html`）只内联 `data-preview-script` 脚本，脚本里不能有 `import` / `fetch` / `XMLHttpRequest` / `WebSocket`，否则整页导出拒绝；要用图标库就把用到的节点内联进脚本（Pinpoint `plugins` 页的 `pk.js` 是样例（源目录由 registry 解析））。

可交互 HTML（`<page>__interactive.html`）打开后就是 workbench 的画布（ADR 0033）：满铺的网格画布 +
左侧浮动玻璃面板（页名 + 大纲，横条最左的钮收起 / 展开）+ 底部横条（‹ n / N › 帧导航、缩放读数、回中）。
滚轮滚动，ctrl / ⌘ + 滚轮围绕光标缩放，空格 + 拖或中键拖平移，空白画布上直接拖也能平移。窄屏（≤ 760px）
面板默认收起、帧竖排按屏宽适配、单指滚动。没有标注面：它是分享面，不是工作面。运行时在
`src/client/share-runtime.js`，内联进导出文件，不依赖服务。

## 标注状态机（pp2，2026-09-22 起）

每条标注带 `status`：`open`（缺省）→ `check` / `done`（升档）→ `close`。owner 完成单击可从
`open` / `check` / `done` 任一态直接入 `close`。`close` 不删，账本里留着。
存量 `result` 字段读侧归一成 `done` 并摘掉；显式迁移走 `scripts/migrate-annotation-status.mjs`
（默认 dry-run，`--apply` 前整根备份），不在启动时自动迁。

转换规则（服务端校验，非法转换 `409 illegal_transition`）：

- 新标注恒为 `open`（客户端声明什么都不算）；
- owner 编辑正文或目标 → 保存时状态回 `open`（服务端强制，与客户端一致）；
- `open` / `check` → `check` / `done` 只经
  `POST /annotations/<page>/<id>/status`——`id` 是稳定 ID 或纯数字的对外序号 `n`，body 带
  `entry`、`baseRevision`、`status: check|done`、可选 `note`（agent 留的一句话）。
  revision 不匹配 `409 revision_conflict`，其余 status `400 invalid_status`，找不到标注
  `404 annotation_not_found`。这是 `ppnt mark` 的后端；
- `open` / `check` / `done` → `close`：owner 在工作台列表对行点“完成”——单击，toast 带
  “撤销”5 秒，不二次确认；撤销回关闭前的原态（`close → open` / `check` / `done`），
  再编辑也回 `open`。

UI 随状态走：画布钉子 open = 现状、check = 空心灰描边、done = 右上角小勾、close 不画；
列表行出 `#n` 序号与 check / done 灰标，行 hover 出 `note`；close 行收进“已关闭 n”开关组
（N = 0 时开关也常驻，不可展开）。
锚点失效不是免死牌：幽灵框照样会被 `clearInvalid()` 清掉。

composer 默认将目标作为正文内 pill，磁盘仍存 `[@t:iN]`，目标仍在本条 `targets`。`changeTo` 只表示修改文案的意图，可包含多个目标，不应把整段用户指令直接用作替换文本。移动保留实际目的地和箭头。正文自动增高最多十行，附图通过粘贴加入；顶部拖动与 indicator 控件退役，底栏 + 菜单提供改文案/移动。

`clearInvalid()` 仅作用当前页，要求所有目标都无法解析且所属 frame 已加载。隐藏目标仍存在，保留；缺失/加载中的 frame 保留。该保守判定不是任意外部 SPA 加载状态的识别器。

页面置顶和归档属于 viewer 偏好，存于 `pinpoint-wb.pagePreferences`，不同浏览器不同步。归档不改 registry、源文件或标注，恢复保留原置顶及文件夹归属。

composer 会避让可见的 Pinpoint 面板，而非透明的全屏停靠容器。原生 modal 的 inert 约束通过把 overlay 挂入当前 modal 处理，不能仅靠 z-index；modal 关闭后恢复挂载。图片粘贴、正文中间插入目标和原生弹窗输入均有用户故事 E2E。
