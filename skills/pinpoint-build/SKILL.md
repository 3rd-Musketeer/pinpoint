---
name: pinpoint-build
description: 在本仓库（pinpoint workbench）里搭预览内容：加 page / section / screen / 组件，改 board.json，做屏内手势动画（内联 data-preview-script 或 sidecar mount 两种形态）。只要任务涉及新增或修改 previews/ 下的屏、kits/ios/components/ 下的组件、页面清单 previews/_index.json，或用户说「加一屏」「加个 flow」「搭个对比」「做个交互」「写 board」，就先读本 skill 再动手——文件结构和挂载规则有几条不直观的硬约束（overlay 同级、safe area 接 token、fragment 无 bezel、脚本不进 ios-kit.js），跳过本 skill 很容易踩坑。
---

# pinpoint-build

在这个仓库里**搭预览内容**。总入口约定见根目录 [`AGENTS.md`](../../AGENTS.md)；标注评审走 [`pinpoint-annotate`](../pinpoint-annotate/SKILL.md)。

## 0. 服务

```bash
npm run dev    # https://pinpoint.localhost/index.html
curl -s https://pinpoint.localhost/health
```

## 1. 加 screen（已有 section）

1. 写 `previews/<pageId>/<screenId>.html` — **只写屏内 fragment**（loader 负责手机壳）。正文在 `.ios-app` / `.ios-lockscreen`；**sheet / tabbar / backdrop 与之同级**（见 §1.1），不要写进滚动层。
2. 需要手势 / 动画时：同文件 `data-preview-script`，或 sidecar `previews/<pageId>/<screenId>.js` + 根节点 `data-preview-mount`（见 §7）。**不要**改 `ios-kit.js`——kit 只承载通用原语，产品逻辑放进 kit 会让所有页互相污染。
3. 在该页 `board.json` 的对应 `sections[].screens` 里追加 id 或对象。

字符串简写：

```json
"screens": ["settings", "onboard"]
```

带标题 / 单屏 shell：

```json
"screens": [
    { "id": "msg-lock", "title": "1 · 锁屏通知", "shell": "lock" }
]
```

文件名 = screen `id` + `.html`（sidecar = 同名 `.js`）。

### 1.1 Overlay 挂载（sheet / tabbar）

`.ios-app` 是**滚动层**（`overflow-y: auto`）。`.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 用 `position: absolute` 相对 **`.ios-screen`（手机视口）** 定位，所以必须与 `.ios-app` 同级、落在 fragment 顶层：

```html
<div class="ios-app" data-preview-mount>
  <div class="ios-nav">…</div>
  <div class="ios-page">
    <div class="ios-cell tappable" data-sheet-open="detail">…</div>
  </div>
</div>
<!-- overlay：关闭 </div> 之后，禁止塞回 .ios-app -->
<div class="ios-sheet-backdrop"></div>
<div class="ios-sheet" id="detail">
  <div class="ios-grabber"></div>
  <div class="ios-sheet-body">
    …
    <button type="button" class="ios-btn" data-sheet-close>Done</button>
  </div>
</div>
<!-- 有底栏时同样同级： -->
<!-- <div class="ios-tabbar">…</div> -->
```

范例：[`previews/library/home.html`](../../previews/library/home.html)（tab 页 + sheet + tabbar 全套）。

错挂的症状（用来自查）：sheet 关着仍占滚动溢出、滚到底能看见；开着时 panel 贴内容底而非手机底，画面变暗但 sheet 超出视口。

Sidecar 里查 sheet：`root` = `.ios-app`，overlay 不在 `root` 内，用 `root.closest('.ios-screen')` 或 `document`。

### 1.2 Chrome / safe area

顶底 inset 是 **Variables**（`ios-kit.css` `.ios-root`），不是随手写的像素：

| Token | 用途 |
|---|---|
| `--ios-safe-top` | 内容顶 inset（避 Dynamic Island） |
| `--ios-safe-bottom` | Home Indicator inset |
| `--ios-sb-h` | 状态栏高度本身（≠ safe-top） |

- 自定义顶栏对齐 `.ios-navbar`：`padding-top: var(--ios-safe-top)`，`height: calc(var(--ios-safe-top) + 44px)`。
- 自定义底栏 / composer：padding 含 `var(--ios-safe-bottom)`（与 `.ios-tabbar` / sheet 同理）。
- 优先复用 `.ios-nav` / `.ios-navbar`；自写 chrome 时**禁止**写死 `54` / `62` / `34`，也**禁止**用空 spacer div 代替 token。

数字以 `ios-kit.css` 为 SSOT；换机型 / 调 chrome 只改 token，screen 不跟改。

## 2. 加 section

在 `previews/<pageId>/board.json` 的 `sections[]` 追加：

```json
{
  "id": "checkout",
  "title": "结算流程",
  "layout": "row",
  "screens": [
    { "id": "cart", "title": "1 · 购物车" },
    { "id": "pay", "title": "2 · 支付" }
  ]
}
```

- `layout`: `row`（并排，适合 flow / AB 对比）| `column`（纵排）
- `shell`: 可写在 section（整段锁屏）或单个 screen
- `id` → `[data-ann-section]` / annotation `section`
- `title` → `.wb-lib-cap`；screen `title` → `.wb-screen-cap`（**只写文案**，字号来自 board tokens，勿设 font-size）

### 2.1 Frame Note（帧说明）

Frame Note 是原型自身的持久说明，不是处理后会删除的评审 Annotation。直接写在 screen entry 的 `note`：

```json
{
  "id": "msg-thread",
  "title": "2 · 查看消息",
  "note": "场景：用户点开通知。\n交互：进入对应会话。\n验证：入口 Context 正确传入。"
}
```

- `title` 回答“这是哪一步”；`note` 回答“为什么存在、如何交互、验证什么”。
- `note` 可多行，显示在 frame 下方；Workbench 内也可行内编辑。
- 浏览器与 Agent 共同以该页 `board.json` 为 SSOT；浏览器保存带 revision，遇到并发修改不覆盖。
- 先用一个自由文本字段；可以采用“场景 / 交互 / 验证”写法，不要拆成更多 schema 字段。
- 评审意见仍走 Annotation，不要写进 `note`。

Canonical：[`previews/library/board.json`](../../previews/library/board.json)。顶层必须是 `sections[]`，不接受扁平 `{ "id", "screens" }`。

### 2.2 导出 Frame / Section 图片

导出属于 Workbench，不在单个 screen 里实现截图逻辑。每个 Frame 标题右侧常驻 `…`
菜单，选择「导出图片…」；Section 标题旁常驻弱显示图片按钮。两者都不依赖 hover。
Agent / CLI 使用同一条隔离 Chromium 渲染链路：

```bash
npm run export -- --page library --section brew-flow --frame timer
npm run export -- --page library --section brew-flow --with-notes --format png
```

- 默认：2× WebP、Canvas 背景（`#faf8f4`）、输出到 gitignored `exports/`。
- Frame「干净画面」只导当前手机状态 + 48 CSS px 安全边距，不带标题、Frame Note、标注、侧栏或相邻 Frame。
- Section 保持 `row` / `column` 和 Frame 顺序，带 Section / Frame 标题；「带说明」再加入 Frame Notes。
- 导出先克隆 live DOM，再在只含目标的页面截图，因此打开的 sheet / Ask User、选中态、输入值、内部滚动和 canvas 会被保留。
- 透明背景只能用 PNG。超大 2× Section 会明确提示改用 1×，不得静默换行、裁切或压扁 flow。
- 可用参数：`--scale 1|2`、`--background canvas|white|transparent`、`--format webp|png`、`--output <path>`。

## 3. 加 workbench page

1. 建 `previews/<pageId>/board.json` + 若干 `*.html`（交互屏可加同名 `*.js`）
2. `previews/_index.json` 的 `pages[]` 增加：

```json
{ "id": "<pageId>", "title": "My Flow", "mode": "ios" }
```

网站 / web app 画板用 `"mode": "web"` + `"shell": "web"`（fragment 可为任意**非**完整文档 HTML；loader 包成 `.wb-html-stage` > `.wb-html-surface`，默认宽 960）。参考 `previews/web-library/`。

**完整单页 HTML 文档**（汇报页、说明页这类自带 `<head>` 和全套样式的）用 `"mode": "html"` + `"shell": "doc"`，参考 `previews/doc-library/`。两点与 iOS / Web 板不同：

1. **承载方式**：doc 走 iframe，文档原样渲染，loader 不包装也不做 fragment 校验——内联会让它的 `body{}` 规则失效、`<style>` 漏进 workbench。
2. **不画布化**：汇报页必须在读者真实的窗口尺寸下读，所以文档 1:1 铺满 stage，没有缩放、平移、画板、Frame 标题与 Frame Note；同一页里的多个 screen 变成**侧栏的版本列表**，一次只显示一个（每页记住上次看的那个）。画布的 Frame 导出在这里也隐掉了——它出的图不等于真实版面；出图用侧栏 Versions/Document 旁的 **导出**（HTML 完整 / 去 CSS HTML / 长图 PNG）。

screen 可用 `"src"` 指向任意 URL，配合 `previews/` 下的符号链接就能把仓库外的汇报页挂进来。

要能标注，页尾接一段只在 loopback / `.localhost` 拉 `/annotate.js` 并（独立打开时）调
`iOSAnnotate.setFloatingToolbar(true)` 的脚本即可——同一份文件 `file://` 打开、导出 PNG、
外发副本都不带标注 UI、不联网。**正文不必打 `wb-html-surface` / `data-ann-surface`**：
独立文档 / HTML 板 iframe 里，annotate 把整份 body 当可标注区域。Web 板 fragment 仍由
loader 包 `.wb-html-surface`，那是画布命中边界，不是作者要记的标记。标注落在文档自己的
page key 下（默认 entry `pinpoint` 的桶，路径从 `/health` 的 `dataDir` 读）。

侧栏 **iOS / Web / HTML** switch 会隔离三套 Pages 列表；Component Library 只出现在 iOS。

3. 刷新；manifest 自动生成导航，`pageId` 同时是 annotate 的 `pageId`。不要自写第二套 loader。

Manifest 是 page id / title / order / default / mode 的 SSOT；`board.json` 只写 `sections[]`。长期实例可用 gitignored `previews/_index.local.json` 覆盖整份清单（结构相同），模板文件保持干净。

### 3.1 仓库外的项目：registry dir entry

要评审的项目不在本仓库时，不要把文件复制进来——在本机 registry（`~/.html-annotate/registry.json`，`HTML_ANNOTATE_REGISTRY` 可覆盖）登记一个 `dir` entry：

```json
{ "id": "your-app", "title": "Your App", "kind": "dir", "path": "/abs/path/to/your-app/dist", "board": "web" }
```

- 服务把该目录**只读** serve 在 `https://pinpoint.localhost/sites/your-app/`：registry 即白名单，未知 id / `..` 穿越 / symlink 逃逸一律 404；目录回落 `index.html`。
- HTML 响应在 `</body>` 前自动注入 `window.__pinpointEntry='your-app'` + `/annotate.js`；`?annotate=off` 原样输出磁盘字节（导出管线和 workbench 内联加载走它）。
- 该 entry 自动成为 workbench 页面（跳过 workbench 自己的 `pinpoint` entry；`previews/` 里同 id 的页面优先）。`board` 字段选 board：`ios` / `web` / `html`，缺省 `web`。
- 页面结构仍由它自己的 `board.json` + screens 决定（从 `/sites/<id>/board.json` 拉取）——schema 与本仓页面完全相同，编辑对象是登记目录里的磁盘文件，serve 只读不影响改稿。
- 标注落在 `~/.html-annotate/your-app/` 桶，与本仓 `pinpoint` 桶互不干扰。
- 验证：`curl -s https://pinpoint.localhost/registry | jq '.entries[] | select(.id=="your-app")'` 能看到 entry；`curl -s https://pinpoint.localhost/sites/your-app/ | grep __pinpointEntry` 能看到注入；workbench 侧栏出现该页。目标项目是 SPA / 自己起服务、想按 origin 评审时改用 `url` entry + 浏览器扩展，见 [pinpoint-annotate](../pinpoint-annotate/SKILL.md) §2。

## 4. 加 component

Component Library ≈ Figma Components：**可复用 / 可单独评审的原子**，不是「所有 UI 的仓库」。
默认先写在 screen 里；满足下面任一条件再抽到 `kits/ios/components/`。

### 4.0 何时进 Library / 何时留在 screen

| 进 `kits/ios/components/<id>/` | 留在 `previews/<page>/…` |
|---|---|
| **跨屏复用**（同一块会出现在 ≥2 个 screen / page） | 只服务这一屏 / 这一段 flow 的构图与文案 |
| **要并排看 variants**（形态 A/B、密度、状态），且评审对象是这块本身 | 整页叙事、流程步骤、一次性探索稿 |
| 预期标注会说「改这个组件 / 这个 widget」，希望打在 Library 或带 `data-ios-from` | 标注对象是整屏布局、文案语气、flow 顺序 |
| 边界已经稳：有清晰名字、若干稳定 variant | 边界还在变——先在 screen 里长成形，再抽 |

心智：

1. **Screen 是构图**（page → section → frame）；**Component 是原子**（可 include 的一块）。
2. **先屏后组件**：探索期直接写 HTML；第二次要用、或要单独开 variant 墙时再抽。
3. **抽了就必须引用**：screen 用 `data-ios-include`，禁止再复制一份 HTML（否则「改组件」类反馈会只改到一处）。
4. **`system: true` 只给 kit 原语**（button / list / nav…），少而稳；产品组件一律 `system: false`（实例本地的可放 `kits/ios/components/`，模板发布靠 `_index.json` / exclude 隔离）。

正例：`bubble`（消息气泡，多屏 include 复用）；variant 墙类组件——一个 `meta.json` 挂多份 variant HTML 并排评审（参考模板自带组件的 `catalog.html` 形态）。  
反例：某 flow 独有的 onboard 文案块、只出现一次的设置页分区——留在 screen。

### 4.1 怎么加

```
kits/ios/components/<id>/
  meta.json
  <variant>.html
```

```json
{
  "id": "bubble",
  "title": "Message Bubble",
  "system": false,
  "layout": "row",
  "variants": [
    { "id": "incoming", "title": "Incoming" },
    { "id": "outgoing", "title": "Outgoing" }
  ]
}
```

- 可选 `kits/ios/components/_index.json` 排序；不在清单里的目录会自动发现、排在后面（`PREVIEW_TEMPLATE_ONLY=1` 时只认清单）
- Component Library 页自动合成（`/components/board.json`），无需手动注册

## 5. 在 screen 里引用组件

```html
<div data-ios-include="bubble/outgoing" data-text="好的，我先看。"></div>

<div data-ios-include="your-card/default"
     data-text="冲煮完成"
     data-slot-detail="总时长 3:12 · 粉水比 1:16"></div>
```

- `data-text` → 填 `[data-ios-slot="text"]`
- 任意 `data-slot-<name>` → 填同一组件里的 `[data-ios-slot="<name>"]`；用来复用同一组件的文案/状态，不要为每组文字复制一个 variant
- Slot 只替换节点内容，不改属性或样式；结构和视觉仍由 component variant 统一拥有
- 改组件源 → Library 页和引用它的 flow 一起 HMR
- **不要**把组件 HTML 复制进 screen——复制体会让后续「改组件」类反馈只改到一处

## 6. Caption / HMR

- Caption 字号：`--wb-cap-section` / `--wb-cap-screen`（相对 `--wb-phone-w`）。只写文案。
- HMR：`previews/<page>/board.json|*.html|*.js`、`kits/ios/components/**` → 当前板自动刷新。

## 7. 可交互屏（A+B）

Workbench 用 `innerHTML` 挂屏，**裸 `<script>` 不会执行**——这是两种形态存在的原因。自定义手势跟屏走。

**A · 短逻辑（同文件内联）**

```html
<div class="ios-app">…</div>
<script data-preview-script>
  root.querySelector('[data-x]').addEventListener('click', function () { … });
  // optional: return function unmount() { … }
</script>
```

或 module 形态：

```html
<script type="module" data-preview-script>
  export default function mount(root) {
    // …
    return function unmount() { … };
  }
</script>
```

**B · 长逻辑（sidecar，推荐）**

1. `previews/<pageId>/<screenId>.js`：

```js
export default function mount(root) {
  // bind on root
  return function unmount() { /* remove listeners、clearInterval */ };
}
```

2. 屏根节点加 `data-preview-mount`（自动加载同名 `.js`），或 `<script type="module" data-preview-script src="./screenId.js">`。

- `root` = 该屏 `.ios-app` / `.ios-lockscreen`（可用 `data-preview-root="css"` 覆盖）
- `mount` 返回的 `unmount` 会在换板 / HMR 时调用——有定时器、全局监听时必须返回
- 样板：[`previews/library/timer.html`](../../previews/library/timer.html) + [`timer.js`](../../previews/library/timer.js)（B），[`previews/library/recipe.html`](../../previews/library/recipe.html)（A）

## 8. 反模式

- 扁平 `board.json`（缺 `sections[]`）
- 把 `.ios-sheet` / `.ios-sheet-backdrop` / `.ios-tabbar` 放进 `.ios-app`（见 §1.1）
- 手写 safe-area 像素或不接 `--ios-safe-*`（见 §1.2）
- 改 loader chrome / bezel / `ios-kit.css` 去「对齐」一条标注
- 产品手势 / 屏状态写进 `ios-kit.js`
- 手写 `.wb-lib-cap` / `.wb-screen-cap` 的 font-size
- 把待处理的评审意见写成 Frame Note（Frame Note 是长期设计说明）
- 组件 HTML 复制进 screen（用 `data-ios-include`）
- 把一次性 flow 构图提前抽进 Library（先屏后组件，见 §4.0）
- 为「整理文件」而抽组件、却仍在 screen 里留复制体
