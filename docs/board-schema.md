# board.json 契约与编译机制

一个页一份 `board.json`。本文是 pp2 机制的**唯一权威**：board 字段、源码与 dist、帧与组件、
交互、派生与边界——别的文档只链接这里，不复述。做法见
[`skills/pinpoint-build/SKILL.md`](../skills/pinpoint-build/SKILL.md)；词见 [`CONTEXT.md`](../CONTEXT.md)。
活的参照：`e2e/jsx-site/`（帧 + components/ + comp 墙 + kit）、`e2e/ios-site/`（多 section 全壳型）。

## 源码与 dist

- 页目录 = 源码：`<screenId>.jsx`（或存量 `.html`）、`components/<Name>.jsx`、页级 css / js、`board.json`。
- 每屏按 `<screenId>.jsx` → `<screenId>.html` 找源码；都没有该屏报「源码不存在」，其余照编。
- `ppnt build <页>` 编出 `~/.pinpoint/dist/<entry>/<screenId>.html` 与 `build.json`
  （`builtAt` / `sources` / `errors`）。dist 不进 git、不放回页目录，重编即得。
- 服务只对屏 HTML 出 dist（`/sites/<entry>/<screenId>.html`；模板页 `/previews/<page>/…` 同理），
  css / js / 图片等其余资源仍从源目录出。没编过的页先懒编译一次；编译失败或没编过的屏 500 带
  错误文本，画布出 `.wb-screen-err` 面板——重跑 `ppnt build` 即修。
- board.json 响应附 `dist: { builtAt, stale }`，`stale` = 任一源文件的 mtime 晚于 `builtAt`。
- watch（服务与 `ppnt build --watch` 同一条管线）：`.jsx` / `.html` / board.json / 页级 css 变更 →
  重编该页 + 板软刷新；sidecar `.js` 变更 → 重编 + 整页 reload（ES module 缓存）。

**`.jsx` 帧**：默认导出一个返回 JSX 的函数；顶层只许 `import`、`function` 声明、`export default`。
内核 Preact，esbuild 转译后 `renderToString` 出静态 HTML 片段。编译期给每个宿主元素打
`data-pp-id="<文件>:<行>#<n>"`（同一 `文件:行` 按文档顺序从 1 编号，永不复用），给组件根元素打
`data-pp-comp="<Name>"`（只打用户命名的组件）——它们是标注锚点与 `ppnt check` / `locate` 的地址。
存量 `.html` 帧原样编译，锚点仍是 cssPath + 文本摘录。

**lint 四禁**（编译失败，报文件与行，帧与组件都查）：`import preact/hooks`、`onX` 事件属性、
`fetch(`、帧文件顶层的其它语句。组件是印章：输入 props 和 children 输出 HTML，没有状态、事件、
副作用；一个交互状态就是一帧。

**组件**：页内组件住 `<page>/components/<Name>.jsx`，命名导出（或默认导出）印章函数，帧文件显式
import；variant 用 props 表达，不用一 variant 一文件。同名时页内覆盖 kit。跨页复用 = 手动把文件
搬进 kit，没有自动提升机制。

**kit**：`content/kits/ios/` = `ios-kit.css` + `ios-kit.js` + `jsx/`（系统组件的 JSX 印章）。
帧经 `import { Nav } from 'pinpoint/kit'` 引用；组件清单在 `content/kits/ios/jsx/index.js`，
props 在各文件首行注释。

## board 字段

```json
{
  "sections": [
    { "id": "msg-flow", "title": "锁屏 → 消息 → 回复", "layout": "row", "shell": "lock",
      "screens": [
        { "id": "msg-lock", "title": "锁屏通知" },
        { "id": "composer-pill", "title": "pill", "comp": "Composer", "props": { "state": "pill" } }
      ] }
  ],
  "assets": { "css": ["pk.css"], "js": ["pk.js"] }
}
```

- 顶层是 **`sections[]`**，不是扁平的 `{ id, screens }`。section 带 `id` / `title` /
  `layout`（`row` 并排 | `column` 纵排）/ `shell`（可下放到单个 screen）。
- `screens[]` 收字符串简写或对象；对象的 `comp` + `props` 走 comp 屏（见下节），不找屏文件。
- **`shell`**：`app`（默认手机壳）/ `lock`（锁屏，配 `.ios-lockscreen`）/ `doc`（整份 HTML 文档）/
  `comp`（组件 variants 墙）。
- **`assets`**：页级资源，路径相对页目录；编译器把 css 注入每帧开头（`@import`）、js 注入每帧末尾
  （`data-preview-script` module），存量帧手写了同 URL 行的不重复注入。
- `section.id` 写进 DOM 的 `[data-ann-section]`，成为标注的 `section` 字段。
- **title 规矩**（ADR 0026）：单行短名词短语，只回答「这是什么」。编号由系统按 board 顺序派生
  （section = A/B，frame = A1/B2），手写必重复；禁「·」拼接多段信息，不写图例与设计意图。
  `validateBoard` 硬拦 title 换行；画布 caption 两行截断 + hover 全文兜底。
- section 与 frame 只保留标题，没有说明字段或详情浮层；旧 `note` 字段加载时忽略。
- **screen `role`**（`"product"` 默认 | `"draft"`）把 doc 屏标成产物还是草稿，只影响条目派生。

## comp section（variants 墙）

section 写 `"shell": "comp"` 后，它的 screen 条目直接喂组件：

```json
{ "id": "composer-pill", "title": "pill", "comp": "Composer", "props": { "state": "pill" } }
```

- `comp` 先在页目录 `components/<Name>.jsx`（命名导出或默认导出）找，没有再回 `pinpoint/kit`；
  都没有进错误面板。`props` 只允许 JSON 值；`title` 缺省用 `id`。
- 这种屏用无机壳的 comp 画板（不出尺寸行），归画布条目，截图时和普通帧一样。

## iOS 帧的硬约束

`.jsx` 与存量 `.html` 帧共同遵守：

- **overlay 与 `.ios-app` 同级**。`.ios-app` 是滚动层（`overflow-y:auto`），`.ios-sheet` /
  `.ios-sheet-backdrop` / `.ios-tabbar` 用 `position:absolute` 相对 `.ios-screen`（手机视口）定位，
  所以必须落在 fragment 顶层、`.ios-app` 之外。错挂的症状：sheet 关着仍占滚动溢出、开着时贴内容底
  而非手机底。sidecar 里 overlay 不在 `root` 内，用 `root.closest('.ios-screen')` 或 `document` 取。
- **safe area 走 token**：`--ios-safe-top`（避 Dynamic Island）/ `--ios-safe-bottom`（Home 条）/
  `--ios-sb-h`（状态栏本身），变量在 `ios-kit.css`。自定义顶栏 `padding-top: var(--ios-safe-top)`、
  `height: calc(var(--ios-safe-top) + 44px)`；底栏 / composer 的 padding 含 `var(--ios-safe-bottom)`。
  禁止写死 `54` / `62` / `34`，禁止空 spacer div 顶位。换机型只改 token。
- **glass chrome**：`.ios-glass` / `.ios-glass-pill`；`.ios-glass--liquid` 只加在稀疏的 chrome 上，
  不铺满整页。
- **图注只写文案**：字号来自 `--wb-cap-section` / `--wb-cap-screen` / `--wb-cap-ref`（都是
  `--wb-phone-w` 的分数），引用号与 dim 行由 loader 派生，屏里不设 font-size、不写编号。

## 交互 frame（A+B）

workbench 用 `innerHTML` 挂帧，裸 `<script>` 永远不执行；产品手势归屏自己，kit 只提供
tabs / sheet / segmented / clock。

| 式 | 何时用 | 怎么写 |
|---|---|---|
| **A · 内联** | 逻辑短 | 帧里 `<script data-preview-script>{`…`}</script>`（`.html` 帧写经典 `<script data-preview-script>`） |
| **B · sidecar** | 逻辑长 | 同名 `<screenId>.js` 导出 `default function mount(root)`，帧根标 `data-preview-mount` |

- `root` = 那屏的 `.ios-app` / `.ios-lockscreen`（`data-preview-root="css"` 可覆盖）；显式写
  `<script type="module" data-preview-script src="./screenId.js">` 也认。
- `mount` 可返回 `unmount`（换板 / HMR 先调它）；有定时器、全局监听必须返回。
- `data-preview-script` 的产物语义随离线导出走：脚本里不能有 `import` / `fetch` / `XMLHttpRequest` /
  `WebSocket`，否则整页导出拒绝。
- **不把产品手势写进 `ios-kit.js`**，也不为它开 loader 特例。

## goto

元素写 `goto="<screenId>"`（或图纸号），编译成产物上的 `data-goto` 属性——帧间 flow 边的数据层；
画线与播放模式未做，运行时尚不消费。

## doc 屏与 mention

`shell: "doc"` 的屏是**完整独立文档**，走 iframe 1:1 铺满舞台（内联会丢它的 `body{}` 规则、漏 CSS
进 workbench），无画布、无缩放、无 frame 标题；条目派生见下。文档可用
`<div data-pinpoint-frame="<pageId>/<screenId>"></div>` mention 一个活 frame——doc 的 annotate
client 把空挂载点水合成 `/api/frame` 的 iframe，标注绑定对象不绑视图，画布与文档同一份账本、
实时同步。anchor 解析把含 stage 段的选择器归一成 frame 内 `:scope` 链
（`src/shared/frame-anchor.js`），frame 在板上换位置锚点自愈。

## 从 board 派生出来的东西

层级：**page → entries → canvas → section → frame**；screen 是 frame 里的内容（`screenId` = frame id）。
条目派生在 `src/workbench/lib/board-entries.js`：app / lock / comp 屏合成一个 canvas 条目（id
`@canvas`），每个 doc 屏各成一个 document 条目。舞台形态跟选中的条目走，选择持久化在
`prefs.activeEntryIdByPage`，深链 `?page=<id>&entry=<screenId>`。A1 引用体系、frame 树、截图清单
只覆盖 canvas 条目下的屏。

## 导出与截图

用户面只有一个：整个画布导出为离线可交互 HTML（横条「导出」钮，ADR 0033）。
帧与 section 的图片归 agent 面：`ppnt shot`（`--marks` 烤序号钉）与 `check --mode image` 走同一条
服务端渲染链（`/api/export-image`），屏里不写截图逻辑。图注（引用号 + 屏名 + 尺寸）永随图。

## 模板与实例

进 git 的只有模板：框架代码 + kit + `content/previews/` 的示例页（页 id / 标题 / 顺序在
`content/previews/_index.json`，可为空）。owner 在这台机器上的东西靠 `.git/info/exclude` 挡在
git 之外，清单：`prototypes/`（经 registry 登记进 Pages）、`tasks/`、`BACKLOG.md`、`TODO.md`、
`.archive/`。exclude 不进共享的 `.gitignore`。实例页不住 `content/previews/`——它们住各自
owning topic 的 `prototypes/`（或磁盘任何地方），经 `pinpoint add` 进 registry。往 tracked 文件里
夹带实例内容（页面、组件、机器本地的 registry 内容）是这个仓最容易犯也最难回收的错。
`PREVIEW_TEMPLATE_ONLY=1` 把实例内容藏起来，e2e 与发布校验跑在这个模式下。

## 编辑面

| 可以改 | 不要改 |
|---|---|
| `<page>/<screenId>.jsx`（帧）与存量 `.html` | 手机机壳 / bezel / 状态栏（归 loader） |
| `<page>/components/<Name>.jsx`（页内组件） | 把组件 HTML 复制粘贴进帧里 |
| `<page>/board.json`（含 `assets`） | `ios-kit.js` 里的产品手势 |
| `<page>/<screenId>.js`（sidecar `mount(root)`） | 图注 font-size、屏里手写引用号 |
| `content/kits/ios/jsx/`（手动升 kit 时） | 为「修一条标注」去动 `ios-kit.css` 或 loader |
| 经 `pinpoint add` 登记 registry 条目 | 往 tracked 文件里夹带实例内容 |

## 反例

- 扁平 `board.json`（缺 `sections[]`）；把 sheet / backdrop / tabbar 嵌进 `.ios-app`。
- 手写 safe-area 像素；在屏里设图注字号或手写编号；title 塞图例。
- 把产品手势或屏状态写进 `ios-kit.js`；为普通改稿预抽「以后可能复用」的组件。
- 手改 `~/.pinpoint/dist/`；往未登记页面手工注入 `/annotate.js`（改用 `pinpoint add`）。
- 把机器本地的 registry 内容或实例私有页面提交进 tracked 文件。
