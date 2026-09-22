# board.json 契约与编辑面

一个页一份 `board.json`。本文是这份文件的形状、它派生出什么、以及哪些文件可以改。
词的定义见 [`CONTEXT.md`](../CONTEXT.md)；加页 / 加屏 / 加组件的做法见
[`skills/pinpoint-build/SKILL.md`](../skills/pinpoint-build/SKILL.md)。

活的参照：[`content/previews/library/board.json`](../content/previews/library/board.json)。

```json
{
  "sections": [
    {
      "id": "onboard",
      "title": "Onboarding",
      "layout": "column",
      "screens": ["onboard"]
    },
    {
      "id": "msg-flow",
      "title": "锁屏 → 消息 → 回复",
      "layout": "row",
      "screens": [
        { "id": "msg-lock", "title": "锁屏通知", "shell": "lock" },
        { "id": "msg-thread", "title": "查看消息" }
      ]
    }
  ]
}
```

## 字段

- 顶层是 **`sections[]`**，不是扁平的 `{ id, screens }`。
- 屏的源码按 `<screenId>.jsx` → `<screenId>.html` 的顺序找（pp2：源码编译成 dist 后 serve；
  存量 `.html` 原样当片段，`.jsx` 是默认导出一个返回 JSX 的函数的帧文件）。
- 默认壳是 **app**。锁屏壳：section 或 screen 上写 `"shell": "lock"` + `.ios-lockscreen`。
  HTML 文档壳写 `"shell": "doc"`。组件 variants 墙写 `"shell": "comp"`（见下「comp section」）。
- 顶层可写 **`assets: { css?: string[], js?: string[] }`**（pp2）：页级资源，路径相对页目录。
  编译器把 css 注入每帧开头（`@import`）、js 注入每帧末尾（`data-preview-script` module）；
  存量帧手写了同 URL 行的不重复注入。
- `section.id` 会写进 DOM 的 `[data-ann-section]`，成为标注的 `section` 字段。
- **title 规矩**（ADR 0026）：单行短名词短语，只回答「这是什么」。编号由系统按 board 顺序派生
  （A / B1），手写必重复；禁「·」拼接多段信息。
  `validateBoard` 硬拦 title 里的换行；画布 caption 两行截断 + hover 全文兜底。
- section 与 frame 只保留标题，不提供说明字段或详情浮层。
  旧 `sections[].note` / `screens[].note` 加载时忽略（退役 410 端点已于 pp2 切片 3 连端点删除）。
- **screen `role`**（`"product"` 默认 | `"draft"`）把一个 doc 屏标成草稿还是产物。它只影响条目派生，
  不改变加载与壳语义。

## comp section（variants 墙，pp2）

section 写 `"shell": "comp"` 后，它的 screen 条目不再对应屏文件，而是直接喂组件：

```json
{ "id": "composer-pill", "title": "pill", "comp": "Composer", "props": { "state": "pill" } }
```

- `comp` 是组件名：编译器先在页目录 `components/<Name>.jsx`（命名导出 `Name` 或默认导出）找，
  没有再回 `pinpoint/kit`（`content/kits/ios/jsx/<Name>.jsx`，kit 的系统组件 JSX 印章）。
  `props` 只允许 JSON 值；`title` 缺省用 `id`。找不到组件的屏进错误面板。
- 组件是印章：输入 props 和 children 输出 HTML，无状态无事件无副作用；variant 全用 props 表达。
- 这种屏用无机壳的 comp 画板（不出尺寸行），归画布条目，导出 picker 里和普通帧一样出现。

## 从 board 派生出来的东西

层级：**page → entries → canvas → section → frame**；screen 是 frame 里的内容（`screenId` = frame id）。

条目派生在 `src/workbench/lib/board-entries.js`：app / lock 屏合成一个 canvas 条目（id `@canvas`），
每个 doc 屏各成一个 document 条目（id = screenId）。A1 引用体系、左栏「内容」区的 frame 树、
导出树，三者都只覆盖 canvas 条目下的屏。

舞台形态跟**选中的条目**走（`store.activeEntryId`），不跟页走。选择持久化在
`prefs.activeEntryIdByPage`，深链是 `?page=<id>&entry=<screenId>`（canvas 条目 id 是 `@canvas`，
作为默认值不写进 URL）。manifest 里的 `mode` 现在只做两件事：给 board 的默认壳播种、
给 `?mode=` 深链提示。

左栏第二层是「内容」区（`#wbcontents`，`app/Sidebar.jsx` 里的 `Contents`）：产物组
（canvas 条目带 frame 树 + document / web 条目带 mono 类型 tag 画布 / 文档 / 网页）加草稿组
（纯标题行）。坍缩规则在纯函数 `contentsModel` 里：纯画布页出树不出条目行；单个纯 doc 页整区隐藏；
单个网页条目保留行只为显示 tag。

## 两种壳

| 壳 | 输入 | 画板 | 用于 |
|---|---|---|---|
| **iOS** | body 片段 | 手机机壳 | 手机原型 |
| **HTML** | **完整独立文档** | 整视口 iframe，**无画布** | 一页式报告与文稿，例 `content/previews/doc-library/` |

HTML 屏用 `shell: "doc"`。文件保留自己的 `<!doctype>`、`<head>`、`<style>`，所以它**装在 iframe 里
而不是内联**——内联会丢掉它的 `body{}` 规则、并把它的 CSS 漏进 workbench。加载器因此对 doc 屏
跳过片段检查。

**doc 条目不是画布。** 报告要按读者真实窗口宽度读，所以文档 1:1 铺满舞台：不缩放、不平移、
无画板、无 frame 标题、也没有画布 frame 导出（导出来对不上真实版式）。文档从「内容」区
自己那行导出（hover 图标钮；HTML 完整 / 去除 CSS 的 HTML / 整页长 PNG，920×2，长图禁标注）——
对话框直接对准那个条目，哪怕当前选中的是画布条目。HTML 档显示文本 token 估算（本地 `bpe-lite`），
图片档按导出像素给视觉 token 估算（Gemini / OpenAI / Anthropic 三套公式）。
一份 `board.json` 里的多个 doc 屏在「内容」区里是**平铺的条目**（产物 / 草稿两组），
一次显示一个、按页记住选了哪个，不是并排摆着。屏的 `"src"` 可以指向任意 URL，
所以 `content/previews/` 下一个 symlink 就够评审一份住在仓外的文档。

## 交互 frame（A+B 两式）

workbench 用 `innerHTML` 挂载屏 HTML，所以裸 `<script>` 永远不执行。产品手势归屏自己；
kit 只提供 tabs / sheet / segmented / clock。

| 式 | 何时用 | 怎么写 |
|---|---|---|
| **A · 内联** | 逻辑短 | `<script data-preview-script>`（经典式：`root` 在作用域里）或 `<script type="module" data-preview-script>export default function mount(root){…}</script>` |
| **B · sidecar** | 逻辑长 | `content/previews/<page>/<screenId>.js` 导出 `default function mount(root)`；root 标 `data-preview-mount`，或写 `<script type="module" data-preview-script src="./screenId.js">` |

- `root` = 那个屏的 `.ios-app` / `.ios-lockscreen`（可用 `data-preview-root="css"` 覆盖）。
  sheet 住在 `root` 之外——用 `root.closest('.ios-screen')` 取。
- `mount` 可以返回一个 `unmount` 函数（或 `{ unmount }`）；重载板与 HMR 会先调它。
- 例子：`content/previews/library/recipe.html`（A 式）、`content/previews/library/timer.html` + `timer.js`（B 式）。
- **不要**把产品手势加进 `ios-kit.js`，也不要在 `afterMount` 里给它开特例。

## 在文档里 mention 活 frame

doc 正文可以嵌一个画布 frame：`<div data-pinpoint-frame="<pageId>/<screenId>"></div>`。
doc 的 annotate client 把每个空挂载点水合成一个指向 `GET /api/frame?page=<id>&screen=<id>` 的 iframe——
那是 `src/server/lib/frame-doc.js` 组装出的自包含文档（片段 + `src/shared/frame-shell.js` 的共享机壳 + ios-kit +
`src/client/frame-boot.js` 运行时 + annotate 注入）。被 mention 的 doc 壳屏改为 302 到屏自身的 URL
（同 pathname = 同账本）。

frame iframe 里的 annotate 实例带两个标记：`__pinpointFrame`（pageId / screenId / section）与
`__pinpointLedger`（嵌入方 workbench 的 pathname，由水合器经 query 参数传入，默认 `/index.html`）。
它的标注读写的是**画布板的账本**，所以同一个 frame 上的标注在文档和画布是同一份，经 SSE 双向同步。
锚点选择器仍是普通 cssPath 字符串；解析时把任何含 stage 段（`.ios-stage` / `.wb-comp-stage` /
`.wb-html-stage`）的选择器归一成 frame 内的 `:scope` 链（`src/shared/frame-anchor.js`）——
所以 frame 在板上换位置锚点会自愈，存量行不需要迁移。
侧栏的标注 / 交互开关从 doc 实例级联进每个嵌入的 frame iframe（`iframe[data-pinpoint-frame-iframe]`）。
doc 正文自己的标注仍用文档自己的账本，两个命名空间不混。
文档导出时把挂载点烤成静态 2× PNG（`src/server/lib/export-doc-bake.js` 的 `parseMentionMounts` 一族；
html-no-css 档换成文本引用）。

## 编辑面

| 可以改 | 不要改 |
|---|---|
| `content/previews/<pageId>/<screenId>.jsx`（pp2 帧文件：默认导出一个返回 JSX 的函数；顶层只许 import / export default / 函数声明） | 手机机壳 / bezel / 状态栏（归加载器） |
| `content/previews/<pageId>/<screenId>.html`（存量 iOS 片段：`.ios-app` + 同级 overlay；HTML：任何非文档片段） | `ios-kit.js` 里的产品手势 |
| `content/previews/<pageId>/components/<Name>.jsx`（页内组件：命名导出的印章函数；帧文件显式 import，跨页复用时手动搬进 kit） | 把组件 HTML 粘贴复制进屏里 |
| `content/previews/<pageId>/*.js`（屏的 sidecar `mount(root)`） | 手写 `.wb-lib-cap` / `.wb-screen-cap` 的 `font-size` |
| `content/previews/<pageId>/board.json`（含顶层 `assets`） | 为了「修好一条标注」去动 `ios-kit.css` |
| `content/kits/ios/jsx/<Name>.jsx`（kit 系统组件 JSX 印章，帧经 `pinpoint/kit` 引用） | 往 tracked 文件里夹带实例内容 |
| 加页时改 `content/previews/_index.json`（`mode`：`ios` \| `html`） | |
| 经 `pinpoint add`（或小心手改）改 `~/.pinpoint/registry.json` 登记仓外评审目标 | |

`content/previews/` 是**纯模板**（ADR 0027）：只放进 git 的示例页，页 id / 标题 / 顺序 / 默认页在
`content/previews/_index.json`。实例页不住这里——它们住各自 owning topic 的 `prototypes/`（或磁盘任何地方），
经 registry 进来。

组件包含支持 `data-text` → `[data-ios-slot="text"]`，以及具名的 `data-slot-<name>` →
`[data-ios-slot="<name>"]`。两个屏共用一个组件和状态模型、只是文案或进度不同时用具名槽；
不要只为了换文案 fork 出一个视觉 variant。

图注只写文案，字号来自 `--wb-cap-section` / `--wb-cap-screen` / `--wb-cap-ref`
（都是 `--wb-phone-w` 的分数）。引用号（A1 体系）和 dim 行由 `screen-load.js` 派生——
永远不要在屏里写死。

## 反模式

- 没有 `sections[]` 的扁平 `board.json`
- 把 sheet / backdrop / tabbar 嵌进 `.ios-app`（它们必须是片段顶层的同级元素）
- 为了满足一条标注去改加载器的机壳
- 把产品手势或屏的状态写进 `ios-kit.js`
- 在屏 HTML 或临时 CSS 里设图注字号
- 往未登记的页面手工注入 `/annotate.js`——改用 `pinpoint add` 登记一个 dir / file / url 条目；
  未登记的面按契约保持干净
- 把机器本地的 registry 内容或实例私有页面提交进 tracked 文件
