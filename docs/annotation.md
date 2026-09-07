# 标注：路由、账本、控制面

标注是人 → agent 的反馈回路，也是这个仓存在的理由。本文说一条标注长什么样、它落到哪个文件、
以及读到一条标注之后该去改哪个源文件。词的定义见 [`CONTEXT.md`](../CONTEXT.md)；
标注 → 读 → 改的操作流程见 [`skills/pinpoint-annotate/SKILL.md`](../skills/pinpoint-annotate/SKILL.md)。

## 一条标注的字段

| 字段 | 含义 |
|---|---|
| `entry` | registry 条目 id —— 这份文档住在哪个桶（缺省 `pinpoint`） |
| `pageId` | workbench 的页 = `data-vpage`（`library`、`components`，或自定义） |
| `section` | board 的 section `id`（遗留名：`group`） |
| `screenId` | frame / 屏文件的 id |
| `content` | 标注正文（遗留名：`comment`） |
| `path` | 壳页面，通常是 `index.html` |

元素标注一律写 `targets: [{ ref, selector, text }]`；稳定 ref 是 `i1`、`i2`、…，删除后永不重编号。
顶层的 `selector` / `text` 是第一个 target 的兼容镜像。`[@t:iN]` 只在那一条标注内解析，
永远不进 `mentions[]`；`[@a:id]` 保持它的跨标注含义。

## 读到标注去改哪里

- Component Library 的标注 → 改 `content/kits/ios/components/<id>/`。
- 流程节点带 `data-ios-from="bubble/outgoing"` → 优先改那个组件的源文件。
- 流程屏的标注 → 只改 `content/previews/<pageId>/<screen>.html`。
- `/sites/<entry-id>/` 下做的标注 → 改登记目录里磁盘上的那个文件（服务本身是只读的）。

overlay 是 stage 作用域的；画布与侧栏只显示当前页的标注。`goToMark` 需要时先切页，
再经 `src/workbench/lib/board-navigation.js` 聚焦到所属 frame；只有没有 `screenId` 的遗留标注
才回落到把裸锚点居中。

画布只画**活的锚点**。HTML 改过之后选择器解析不到了，标注仍留在侧栏，标成**锚点失效**
（不留幽灵 frame）。失效是渲染时算出来的，不是存下来的。

## 账本与桶

标注按条目分桶落在 `~/.pinpoint/<entry-id>/*.json`（**磁盘就是事实源**），形状是 `annotations[]`。
条目来自 `~/.pinpoint/registry.json`（`PINPOINT_REGISTRY` 覆盖）；本仓自己标注在 entry `pinpoint` 下。
默认桶的确切路径从 `GET /health` 的 `dataDir` 字段读；`PINPOINT_DATA_DIR` 整体覆盖数据根
（e2e 用的就是它）。改名前的 `HTML_ANNOTATE_DATA_DIR` / `HTML_ANNOTATE_REGISTRY` 在新名字缺席时
仍生效，并打一条弃用警告。

`POST /save` 要带 `baseRevision`（整数 ≥ 0；不匹配返回 `409 revision_conflict` 并附磁盘上的文档）；
清空走同一条保存队列、传 `annotations: []`（没有 `/clear` 路由）。显式传一个未登记的 `entry` 是
响亮的 `400 unknown_entry`——配错永远不会静默落进错误的桶。

浏览器的 `localStorage` 缓存不是权威。启动时 client 从磁盘水合；`GET /events`（SSE，
`event: annotations`，payload 带 `entry` / `page` / `revision`）让已打开的浏览器近实时同步。
`GET /annotations`（不带 page）是调试用的聚合，把每个桶摊平成 `[{entry, ...doc}]`；
按页读要带 `?entry=<id>`，`GET /images/<name>` 也是。

页面 key 的公式在 `src/shared/annotate-page-key.js`：
`decodeURIComponent(filename) + '~' + hash31(pathname).toString(36)`，所以同名文件在不同目录
各有各的账本。SPA 换路由时账本（entry / page / localStorage key）不重载就重新定位——
优先 Navigation API 的 `navigate` 事件，回落到打过补丁的 `pushState`/`replaceState` + `popstate`；
只改 hash 不重新定位，切换前发出的同步 / 水合响应按 epoch 丢弃，所以标注不会落到上一条路由上。

桶归属由 client 这样决定：`window.__pinpointEntry` → `<html data-pinpoint-entry>` → `'pinpoint'`；
API 调用打的是脚本被加载的那个 origin。

## 控制面

在非 workbench 页面（`/sites/`、扩展注入）上浮动工具条默认隐藏——**A** 键切标注模式。
主入口是**pinpoint 工具栏图标**，它打开标注**侧面板**（Chrome Side Panel，浏览器原生分屏，
页面保有自己的视口；owner 2026-08-11 的判断：页面内的 `#ann-sidebar` 浮层会压掉页面右侧 280px）。
面板是一个扩展壳（`extension/sidepanel.html/js`）iframe 着服务托管的 `panel.html`：
壳向标签页的 content script 要 `pinpoint:page-info`（经 `chrome.scripting` 幂等重注 content script
来自愈陈旧标签页），把各种死路映射成本地提示（服务没起 / 页面不支持 / 页面 client 过旧 → ⌘R /
未登记 / workbench 壳页），并把面板命令（`jump`/`edit`/`del`/`mode`）经 content script 那座
CSP 安全的 DOM `CustomEvent('pinpoint:command')` 桥转给 client。面板页经 annotate API 读账本、
经 SSE 实时更新；所有写入都留在页面 client 里（面板永远不是第二个写入方）。

工具条与侧面板各带一个**「打开 workbench」**入口（2026-09-04）：`/sites/` 页面与扩展注入页
都在 workbench 之外，之前只能靠记住 URL 走回去。工具条的钮（`#ann-workbench`）在新标签页开
`<服务 origin>/index.html`，origin 取自注入脚本自己的 `src`；面板的同名链接（`#panel-workbench`）
走面板自己的 origin（面板页由服务托管）。两处都在 workbench 壳页与被嵌入的 frame 里隐藏——
那里已经在 workbench 里，同「只留一个控制面」的规矩。

页面内的 `#ann-sidebar` 留给没有扩展的场合（`/sites/` 直开、**S** 键、工具条的「列表」钮）：
head 上是「交互 | 标注」分段开关，列出当前账本的标注按 `n` 排序，点击跳转，hover 出编辑 / 删除，
失效锚点带标记；打开状态作为 localStorage 的浏览偏好保存，默认关闭；
凡是存在 `window.workbench` 或文档跑在 frame 里的地方一律抑制——和工具条同一条「只留一个控制面」的规矩。

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
三行说明（标题 / 出处 / 原因）+ 固定两个动作「回到 Pages」「重试」。动作只写 data 契约
（`data-err-home` / `data-err-retry` + `data-err-page` / `data-err-screen`），点击由挂在 stage 上的
委托监听执行——板每次装载整替换 `innerHTML`，监听不能挂面板自己身上。「回到 Pages」落到
Component Library 并展开左栏；「重试」失效对应的 `board` / `screen` 查询后原地重装。
左栏「页面清单读取失败」同样带一个「重试」（`pages.js` 的 `retryPageManifest`）。

fragment 里的 **CSS 资源 url 与 JS sidecar 同规则**（2026-09-04）：`<style>` 块里的 `@import` 与
`<link rel=stylesheet>` 的相对 url，在装配时被 `src/workbench/lib/sidecar-css.js` 改写成
`pageBaseUrl` 前缀的绝对路径，和 `resolveSidecarUrl` 处理 `./x.js` 是同一条规则；已经是
`/sites/…` 或 http(s) 的原样保留。不改写就只有 CSS 走样——`@import` 按 workbench 文档
（`index.html`）解析，`./x.css` 会打到站点根。组件页不改写（它的片段来自 `kits/`）。

资源没进来时在那个 frame 上出一条 `.wb-asset-err`，把打不开的 url 写出来，不留静默空卡：
CSS 侧没有 `onerror` 可听，所以装载后对 `/` 开头的同源 url 探一次存在性；JS 侧报的是作者
显式写了 `src` 的 sidecar，约定式的 `<screenId>.js`（`data-preview-mount` 隐式探的那条）
允许缺席、不报。

## 图片导出

图片导出归 workbench（ADR 0015）。单一入口：HUD 的「导出」钮打开导出 picker
（`src/workbench/app/ExportPicker.jsx`，原生 dialog）——当前页的 proto 树（section 行整选，
frame 任意多选，带 A1 引用号）、实时预览（`/api/export-image` 走 scale 1 + debounce）、
背景三态（画布 / 白底 / 透明）。输出固定 **PNG 2×**；图注（引用号 + 标题 + dim 行）永远随图走。
旧的「干净画面 / 带说明」预设、WebP 与 1× 选项、per-frame / per-section 触发器、
以及「复制 PNG」都已退役。note 自 ADR 0026 起挪进 detail 面板，不进导出——
重新注入随导出系统重构（见 `BACKLOG.md`）。

选中一个 frame 直接下载 PNG，多个则服务端打包（`POST /api/export-zip`，store-only 写入器
`src/server/lib/zip-store.js`）。agent 的 CLI 用同一个 Chromium 渲染器：
`npm run export -- --page <page> --section <section> [--frame <screen>]`。
不要把截图逻辑加进单个屏的片段里。
