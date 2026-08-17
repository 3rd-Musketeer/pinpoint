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
    { "id": "msg-lock", "title": "锁屏通知", "shell": "lock" }
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
    { "id": "cart", "title": "购物车" },
    { "id": "pay", "title": "支付" }
  ]
}
```

- `layout`: `row`（并排，适合 flow / AB 对比）| `column`（纵排）
- `shell`: 可写在 section（整段锁屏）或单个 screen
- `id` → `[data-ann-section]` / annotation `section`
- `title` → `.wb-lib-cap`；screen `title` → `.wb-screen-cap`（**只写文案**，字号来自 board tokens，勿设 font-size）

### 2.1 title 规矩（2026-08-17）

title 是单行短名词短语，只回答“这是什么”。引用编号由系统按 board 顺序自动派生
（section = A/B/C，frame = A1/B2，显示在 title 左侧），**不要在 title 里手写编号**，
否则画面上编号会出现两次。

- 单行：契约层硬拦换行（`validateBoard` 报错），说明文字一律进 `note`。
- 短：名词短语，不用「·」拼接多段信息，不写图例、设计意图、对比结论。
- 正例：`锁屏通知`、`同日型基线 vs 当日 sankey`、`阴性对照（这种天不推）`。
- 反例：`★ SPIKE · B 形态 · 同日型基线 vs 当日 sankey — 直通带 = 照常的部分；彩色斜带 = 挤占……`
  （这是把整组图例塞进了 section title；正确做法是 title = `同日型基线 vs 当日 sankey`，
  图例迁进 section 的 `note`。）

### 2.2 Note（帧/组说明）

note 是原型自身的持久说明，不是处理后会删除的评审 Annotation。两级挂载：

```json
{
  "id": "msg-flow",
  "title": "锁屏 → 消息 → 回复",
  "note": "整组图例：直通带 = 照常的部分；斜带 = 被挤占。",
  "screens": [
    {
      "id": "msg-thread",
      "title": "查看消息",
      "note": "场景：用户点开通知。\n交互：进入对应会话。\n验证：入口 Context 正确传入。"
    }
  ]
}
```

- section `note` 承载整组共用的说明（图例、对比结论、数据来源）；screen `note`
  回答“为什么存在、如何交互、验证什么”。属于整组的内容不要逐帧重复。
- `note` 可多行（上限 12000 字符），**不渲染在画布上**——选中 frame / section 后
  在 Workbench 右栏 detail 面板阅读与编辑（点图注选 frame，点 section 大标题选 section）。
- HTTP API：`GET/PUT /api/frame-notes/<pageId>/<screenId>` 与
  `GET/PUT /api/section-notes/<pageId>/<sectionId>`，PUT 带 `baseRevision` 防并发覆盖。
- 浏览器与 Agent 共同以该页 `board.json` 为 SSOT；浏览器保存带 revision，遇到并发修改不覆盖。
- 先用一个自由文本字段；可以采用“场景 / 交互 / 验证”写法，不要拆成更多 schema 字段。
- 评审意见仍走 Annotation，不要写进 `note`。
- 导出图片当前不含 note（note 注入导出图随导出系统重构另立）。

Canonical：[`previews/library/board.json`](../../previews/library/board.json)。顶层必须是 `sections[]`，不接受扁平 `{ "id", "screens" }`。

### 2.3 导出 Frame 图片

导出属于 Workbench，不在单个 screen 里实现截图逻辑。唯一入口 = 画布 HUD 的「导出」
钮 → picker 对话框（当前页 proto tree 任意多选，section 行整选；实时预览；背景三档
画布 / 白底 / 透明）。输出固定 PNG 2×：单张直出 PNG，多张服务端打包 zip。
图注（引用号 + 屏名 + 尺寸）是图纸内容，导出永随（decisions 2026-08-15d）；
note 自 2026-08-17 起收编右栏 detail 面板、不上画布，导出图不含 note（注入另立）。
Agent / CLI 使用同一条隔离 Chromium 渲染链路：

```bash
npm run export -- --page library --section brew-flow --frame timer
npm run export -- --page library --section brew-flow
```

- 默认：PNG、2×、Canvas 背景（`#faf8f4`）、输出到 gitignored `exports/`。
- Frame 导出 = 图注 + 当前手机状态 + 尺寸行，48 CSS px 安全边距，不带标注、侧栏或相邻 Frame。
- Section 保持 `row` / `column` 和 Frame 顺序，带 Section / Frame 标题。
- 导出先克隆 live DOM，再在只含目标的页面截图，因此打开的 sheet / Ask User、选中态、输入值、内部滚动和 canvas 会被保留。
- 透明背景只能用 PNG。超大 2× Section 会明确提示改用 1×，不得静默换行、裁切或压扁 flow。
- 可用参数：`--scale 1|2`、`--background canvas|white|transparent`、`--format png|webp`、`--output <path>`。`--with-notes` 已退役，传了也只是空占位。

## 3. 加 workbench page

1. 建 `previews/<pageId>/board.json` + 若干 `*.html`（交互屏可加同名 `*.js`）
2. `previews/_index.json` 的 `pages[]` 增加：

```json
{ "id": "<pageId>", "title": "My Flow", "mode": "ios" }
```

**完整单页 HTML 文档**（汇报页、说明页这类自带 `<head>` 和全套样式的）用 `"mode": "html"` + `"shell": "doc"`，参考 `previews/doc-library/`。两点与 iOS 板不同：

1. **承载方式**：doc 走 iframe，文档原样渲染，loader 不包装也不做 fragment 校验——内联会让它的 `body{}` 规则失效、`<style>` 漏进 workbench。
2. **不画布化**：汇报页必须在读者真实的窗口尺寸下读，所以文档 1:1 铺满 stage，没有缩放、平移、画板与 Frame 标题。2026-08-16f 阶段 6 起，doc 屏是**条目**：一屏一个文档条目（`role` 缺省 `product`，`"draft"` 标草稿），侧栏「内容」区一次选中一个、stage 形态跟选中条目走（画布 / 阅读器页内切换），选择按页记住（`activeEntryIdByPage`），深链 `?page=<id>&entry=<screenId>` 直达。画布的 Frame 导出在这里也隐掉了——它出的图不等于真实版面；出图用「内容」区文档/草稿条目行上 hover 浮现的 **导出** 钮（HTML 完整 / 去 CSS HTML / 长图 PNG）。注意坍缩：纯单 doc 屏页的「内容」区整区不出（也就没有导出钮），多条目页才有条目行。

**混合板**（阶段 6，阶段 7 出「内容」区形态）：同一份 `board.json` 可以同时有 app/lock 屏和 doc 屏——app/lock 屏合成一个「画布」条目（只它们上画布，选中时条目行下挂 frame 树），每个 doc 屏各是一个文档/草稿条目；「内容」区分产物组（画布/文档/网页条目 + 类型 tag）与草稿组（纯标题行）。页级 `"mode"` 只剩两个用途：给 `board.json` 校验提供缺省壳、以及深链 `?mode=` 提示；stage 形态不再看它。

screen 可用 `"src"` 指向任意 URL，配合 `previews/` 下的符号链接就能把仓库外的汇报页挂进来。

要能标注，页尾接一段只在 loopback / `.localhost` 拉 `/annotate.js` 并（独立打开时）调
`pinpoint.setFloatingToolbar(true)` 的脚本即可——同一份文件 `file://` 打开、导出 PNG、
外发副本都不带标注 UI、不联网。**正文不必打 `wb-html-surface` / `data-ann-surface`**：
独立文档 / HTML 板 iframe 里，annotate 把整份 body 当可标注区域。Web 板 fragment 仍由
loader 包 `.wb-html-surface`，那是画布命中边界，不是作者要记的标记。标注落在文档自己的
page key 下（默认 entry `pinpoint` 的桶，路径从 `/health` 的 `dataDir` 读）。

**doc 正文可以 mention 画布上的 frame**（阶段 5）：写一个空挂载点
`<div data-pinpoint-frame="<pageId>/<screenId>"></div>`（值就是 `@frame:` 指示器里的身份；
组件库写法 `components/<comp>/<variant>`），annotate client 会把它水合成活 frame
（iframe → `/api/frame`，同一份 fragment + 机壳 + 可交互脚本）。挂载点保持空、别放子
节点（有子节点会被当作导出烤图产物而跳过水合）；样式隔离天然（iframe），高度自适应内容。
文档里对嵌入 frame 的标注与画布同桶同账本、两处实时渲染——所以评审稿可以直接引用活原型
而不是截图。doc 导出时挂载点烤成 2× 静态 PNG（`html-no-css` 换成文本引用），产物不联网、
不可交互。示例：`previews/mention-demo/`（实例本地页，模板不带）。

Pages 是单一混排列表（模板页 + registry 条目；2026-08-16 阶段 2 起 iOS/Web/HTML Seg 已退役），Component Library 作为系统行居首。

3. 刷新；manifest 自动生成导航，`pageId` 同时是 annotate 的 `pageId`。不要自写第二套 loader。

Manifest 是 page id / title / order / default / mode 的 SSOT；`board.json` 只写 `sections[]`。长期实例可用 gitignored `previews/_index.local.json` 覆盖整份清单（结构相同），模板文件保持干净。

### 3.1 仓库外的项目：registry dir entry

要评审的项目不在本仓库时，不要把文件复制进来——用 CLI 在本机 registry 登记一个 `dir` entry：

```bash
pinpoint add /abs/path/to/your-app/dist --title "Your App" --board ios
# 没 `npm link` 过就用 node bin/pinpoint.mjs add ...
```

CLI 会从目录名派生 id（slug 化，冲突自动追加 `-2`/`-3`；`--id` 显式指定且冲突时报错而不是覆盖），原子写入 `~/.pinpoint/registry.json`（`--registry` / `PINPOINT_REGISTRY` 覆盖文件位置），并在服务可达时自动 `POST /registry/reload`——**不用重启服务**；服务没跑则下次启动生效。单个 `.html` 文件同理（kind `file`，只 serve 该文件，恒 doc 壳，`--board ios` 会被拒）；SPA / 自己起服务的应用登记 URL（kind `url`）——阶段 4 起它经同源代理以 doc 壳嵌进 workbench Pages（活应用 iframe 阅读器，标注照常；机制与盲区见 [pinpoint-annotate](../pinpoint-annotate/SKILL.md) §2），不经浏览器扩展也能标。

**归属既有 Page（2026-08-16f 阶段 8）**：`pinpoint add ./draft.html --page <pageId> [--draft]` 让条目**不自成 Pages 行**——它作为目标页「内容」区的 doc 条目出现（`--draft` 落草稿组，缺省落产物组；role 缺省 product）。`<pageId>` 必须可解析（本地 manifest 页或另一 registry 条目 id，CLI 直接校验，不可解析响亮报错）；url 条目恒为独立页，`--page` 与之互斥。典型场景：在别的项目写完一页草稿 HTML，直接登记进既有线程页当草稿。阅读器 / 标注（落条目自己的桶）/ 导出（条目行 hover 钮）全部复用 doc 管线；从 registry 删掉该条目即从侧栏消失，不留死行。

- 服务把该目录**只读** serve 在 `https://pinpoint.localhost/sites/your-app/`：registry 即白名单，未知 id / `..` 穿越 / symlink 逃逸一律 404；目录回落 `index.html`。
- HTML 响应在 `</body>` 前自动注入 `window.__pinpointEntry='your-app'` + `/annotate.js`；`?annotate=off` 原样输出磁盘字节（导出管线和 workbench 内联加载走它）。
- 该 entry 自动成为 workbench 页面（跳过 workbench 自己的 `pinpoint` entry；`previews/` 里同 id 的页面优先；**带 `page` 归属字段的条目例外**——它不进 Pages，而是并入目标页的「内容」区，见上）。`board` 字段选壳：`ios` / `html`，缺省 `html`（残留 `web` 归一到 `html`）。
- 页面结构仍由它自己的 `board.json` + screens 决定（从 `/sites/<id>/board.json` 拉取）——schema 与本仓页面完全相同，编辑对象是登记目录里的磁盘文件，serve 只读不影响改稿。**没有 `board.json` 也能打开**：服务合成 doc 阅读板，目录顶层每个 `*.html` 一屏（侧栏切版本）；磁盘 `board.json` 一旦补上立即优先。要机壳画布（`board:"ios"`）则必须手写 `board.json`。
- 标注落在 `~/.pinpoint/your-app/` 桶，与本仓 `pinpoint` 桶互不干扰。
- 验证：`curl -s https://pinpoint.localhost/registry | jq '.entries[] | select(.id=="your-app")'` 能看到 entry；`curl -s https://pinpoint.localhost/sites/your-app/ | grep __pinpointEntry` 能看到注入；workbench 侧栏出现该页（CLI 触发的 reload 会让打开的 workbench 自动刷新 Pages）。

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
- title 里手写编号 / 用「·」拼接多段信息 / 塞图例与意图（title = 单行短名词短语，说明进 note，见 §2.1）
- 把待处理的评审意见写成 note（note 是长期设计说明）
- 组件 HTML 复制进 screen（用 `data-ios-include`）
- 把一次性 flow 构图提前抽进 Library（先屏后组件，见 §4.0）
- 为「整理文件」而抽组件、却仍在 screen 里留复制体
